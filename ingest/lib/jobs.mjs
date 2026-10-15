// 수집 작업. 각 작업은 raw 에만 쓰고, 해석은 DB(SQL)가 한다.

import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { STATUS, DartStopError, BudgetError } from './dart.mjs';

// 공시검색 대상: 발행공시(지분·채무증권 신고서) + 주요사항보고서
export const FILING_TYPES = [
  { ty: 'C', detail: 'C001' },   // 증권신고서(지분증권)
  { ty: 'C', detail: 'C002' },   // 증권신고서(채무증권)
  { ty: 'B', detail: 'B001' },   // 주요사항보고서
];

export const ymd = (d) => d.replaceAll('-', '');

export function todayKst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// [from, to] 을 월 단위 구간으로 자른다 (공시검색은 회사 미지정 시 3개월 제한)
export function monthChunks(from, to) {
  const chunks = [];
  let start = from;
  while (start <= to) {
    const d = new Date(`${start}T00:00:00Z`);
    const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const end = monthEnd < to ? monthEnd : to;
    chunks.push([start, end]);
    start = addDays(end, 1);
  }
  return chunks;
}

// 실행 기록 감싸기 ---------------------------------------------------------
export async function withRun({ db, dart }, job, params, fn) {
  const runId = await db.rpc('ingest_start_run', { p_job: job, p_params: params });
  const ctx = { runId, fetched: 0, written: 0 };
  const calls0 = dart.calls;
  let status = 'success';
  let error = null;
  try {
    await fn(ctx);
  } catch (e) {
    status = e instanceof BudgetError ? 'partial' : 'failed';
    error = e.message;
    if (!(e instanceof BudgetError)) ctx.thrown = e;
  }
  await db.rpc('ingest_finish_run', {
    p_run_id: runId,
    p_status: status,
    p_api_calls: dart.calls - calls0,
    p_rows_fetched: ctx.fetched,
    p_rows_written: ctx.written,
    p_error: error,
  });
  const summary = { job, runId, status, apiCalls: dart.calls - calls0, fetched: ctx.fetched, written: ctx.written, error };
  console.log(JSON.stringify(summary));
  if (ctx.thrown) throw ctx.thrown;
  return summary;
}

// 1. 접속 확인 ------------------------------------------------------------
export async function probe(env) {
  return withRun(env, 'probe', {}, async (ctx) => {
    const day = addDays(todayKst(), -1);
    const body = await env.dart.json('list', { bgn_de: ymd(addDays(day, -6)), end_de: ymd(day), page_count: 1 });
    ctx.fetched = Number(body.total_count ?? 0);
    console.log(`probe: OpenDART status=${body.status} total_count=${body.total_count ?? 0}`);
    if (![STATUS.OK, STATUS.NO_DATA].includes(body.status)) {
      throw new DartStopError(`probe 실패 status=${body.status} ${body.message}`);
    }
  });
}

// 2. 회사 고유번호 (corpCode.xml) -----------------------------------------
export async function corpCodes(env) {
  return withRun(env, 'corp-codes', {}, async (ctx) => {
    const zip = await env.dart.binary('corpCode.xml');
    const files = unzipSync(zip);
    const name = Object.keys(files).find((f) => f.toLowerCase().endsWith('.xml'));
    const xml = strFromU8(files[name]);
    const parser = new XMLParser({ parseTagValue: false, trimValues: true });
    const list = [].concat(parser.parse(xml)?.result?.list ?? []);
    ctx.fetched = list.length;
    const items = list.map((x) => ({
      corp_code: String(x.corp_code ?? ''),
      corp_name: String(x.corp_name ?? ''),
      corp_eng_name: x.corp_eng_name ? String(x.corp_eng_name) : null,
      stock_code: x.stock_code ? String(x.stock_code) : null,
      modify_date: x.modify_date ? String(x.modify_date) : null,
    })).filter((x) => x.corp_code && x.corp_name);
    for (let i = 0; i < items.length; i += 2000) {
      ctx.written += await env.db.rpc('ingest_put_corp_codes', { p_items: items.slice(i, i + 2000) });
    }
  });
}

// 3. 공시 목록 (list.json) -------------------------------------------------
export async function filings(env, { from, to }) {
  return withRun(env, 'filings', { from, to }, async (ctx) => {
    for (const [bgn, end] of monthChunks(from, to)) {
      for (const t of FILING_TYPES) {
        let page = 1;
        let totalPage = 1;
        do {
          const body = await env.dart.json('list', {
            bgn_de: ymd(bgn), end_de: ymd(end),
            pblntf_ty: t.ty, pblntf_detail_ty: t.detail,
            page_no: page, page_count: 100,
          });
          if (body.status === STATUS.NO_DATA) break;
          if (body.status !== STATUS.OK) {
            await env.db.rpc('ingest_log_issue', {
              p_stage: 'ingest', p_code: `list_${body.status}`,
              p_detail: { bgn, end, ...t, page, message: body.message },
            });
            break;
          }
          totalPage = Number(body.total_page ?? 1);
          const items = (body.list ?? []).map((x) => ({ ...x, _pblntf_ty: t.ty, _pblntf_detail_ty: t.detail }));
          ctx.fetched += items.length;
          if (items.length) ctx.written += await env.db.rpc('ingest_put_filings', { p_run_id: ctx.runId, p_items: items });
          page++;
        } while (page <= totalPage);
      }
      console.log(`filings: ${bgn}~${end} 누적 ${ctx.fetched}건`);
    }
  });
}

// 4. 상세 API (DB 가 정한 대기 목록을 회사·API 단위로 호출) ----------------
export async function details(env, { maxGroups = 100000 } = {}) {
  return withRun(env, 'details', { maxGroups }, async (ctx) => {
    const skipped = new Set();
    let done = 0;
    while (done < maxGroups) {
      const pending = (await env.db.rpc('ingest_pending_details', { p_limit: 200 }))
        .filter((g) => !skipped.has(`${g.endpoint}:${g.corp_code}`));
      if (!pending.length) break;
      for (const g of pending) {
        if (done >= maxGroups) break;
        done++;
        const body = await env.dart.json(g.endpoint, {
          corp_code: g.corp_code, bgn_de: ymd(g.bgn_de), end_de: ymd(g.end_de),
        });
        if (![STATUS.OK, STATUS.NO_DATA].includes(body.status)) {
          skipped.add(`${g.endpoint}:${g.corp_code}`);
          await env.db.rpc('ingest_log_issue', {
            p_stage: 'ingest', p_code: `${g.endpoint}_${body.status}`, p_corp_code: g.corp_code,
            p_detail: { bgn_de: g.bgn_de, end_de: g.end_de, message: body.message },
          });
          continue;
        }
        const items = [];
        if (Array.isArray(body.group)) {
          for (const grp of body.group) {
            for (const item of grp.list ?? []) items.push({ group_title: grp.title ?? null, item });
          }
        } else {
          for (const item of body.list ?? []) items.push({ group_title: null, item });
        }
        ctx.fetched += items.length;
        ctx.written += await env.db.rpc('ingest_put_api_items', {
          p_run_id: ctx.runId, p_endpoint: g.endpoint, p_corp_code: g.corp_code,
          p_status_code: body.status, p_items: items, p_rcept_nos: g.rcept_nos,
        });
        if (done % 50 === 0) console.log(`details: ${done}개 그룹 처리, 항목 ${ctx.fetched}건`);
      }
    }
  });
}

// 5. 변환 (raw → core) -----------------------------------------------------
export async function refresh(env) {
  return withRun(env, 'refresh', {}, async (ctx) => {
    const res = await env.db.rpc('ingest_refresh');
    console.log(`refresh: ${JSON.stringify(res)}`);
    ctx.written = Object.values(res ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
  });
}

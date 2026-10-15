// 수집 작업. 각 작업은 raw 에만 쓰고, 해석은 DB(SQL)가 한다.

import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { STATUS, DartStopError, BudgetError, DocError } from './dart.mjs';

// 공시검색 대상: 발행공시 전체 + 주요사항보고서
// 실측: 발행공시는 상세유형(C001/C002)을 줘도 발행공시 전체가 돌아와서 유형(C)만 지정한다.
export const FILING_TYPES = [
  { ty: 'C' },                   // 발행공시 (증권신고서·정정·발행조건확정·실적보고 등)
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
// types: FILING_TYPES 중 일부만 (예: [{ ty: 'C' }])
// include: 보고서명 정규식. 지정하면 맞는 공시만 저장한다 (과거 백필에서 DB 용량 절약)
export async function filings(env, { from, to, types = FILING_TYPES, include = null }) {
  const re = include ? new RegExp(include) : null;
  return withRun(env, 'filings', { from, to, types, include }, async (ctx) => {
    for (const [bgn, end] of monthChunks(from, to)) {
      for (const t of types) {
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
          const items = (body.list ?? [])
            .filter((x) => !re || re.test(String(x.report_nm ?? '')))
            .map((x) => ({ ...x, _pblntf_ty: t.ty, _pblntf_detail_ty: t.detail ?? null }));
          ctx.fetched += (body.list ?? []).length;
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

// 6. 정기보고서 잔액 (회사채·기업어음·단기사채 미상환 잔액) --------------------
// 기준 보고서: 오늘 날짜로 제출이 끝났을 가장 최근 정기보고서
//   11월 15일~ : 당해 3분기(11014) / 8월 15일~ : 반기(11012) / 5월 16일~ : 1분기(11013)
//   4월 1일~ : 전년 사업보고서(11011) / 그 전 : 전년 3분기(11014)
export function latestPeriod(today = todayKst()) {
  const y = Number(today.slice(0, 4));
  const md = today.slice(5);
  if (md >= '11-15') return { year: y, reprt: '11014' };
  if (md >= '08-15') return { year: y, reprt: '11012' };
  if (md >= '05-16') return { year: y, reprt: '11013' };
  if (md >= '04-01') return { year: y - 1, reprt: '11011' };
  return { year: y - 1, reprt: '11014' };
}

export async function periodic(env, { maxCalls = 3000, period = latestPeriod() } = {}) {
  const periodKey = `${period.year}-${period.reprt}`;
  return withRun(env, 'periodic', { maxCalls, periodKey }, async (ctx) => {
    const start = env.dart.calls;
    while (env.dart.calls - start < maxCalls) {
      const targets = await env.db.rpc('ingest_periodic_targets', { p_period_key: periodKey, p_limit: 300 });
      if (!targets.length) break;
      for (const t of targets) {
        if (env.dart.calls - start >= maxCalls) break;
        const body = await env.dart.json(t.endpoint, {
          corp_code: t.corp_code, bsns_year: period.year, reprt_code: period.reprt,
        });
        const ok = [STATUS.OK, STATUS.NO_DATA].includes(body.status);
        const items = ok ? body.list ?? [] : [];
        ctx.fetched += items.length;
        ctx.written += await env.db.rpc('ingest_put_periodic', {
          p_run_id: ctx.runId, p_endpoint: t.endpoint, p_corp_code: t.corp_code,
          p_period_key: periodKey, p_status_code: body.status, p_items: items,
        });
        if (!ok) {
          await env.db.rpc('ingest_log_issue', {
            p_stage: 'ingest', p_code: `${t.endpoint}_${body.status}`, p_corp_code: t.corp_code,
            p_detail: { periodKey, message: body.message },
          });
        }
      }
      console.log(`periodic ${periodKey}: 호출 ${env.dart.calls - start}회, 항목 ${ctx.fetched}건`);
    }
  });
}

// 7. 신고서 원문 (document.xml) -------------------------------------------
// 압축을 풀어 파일별로 raw.documents 에 넣는다. 파싱은 별도 단계.
// rceptNos 를 주면 그 공시만, 아니면 DB 대기 목록(ref.document_fetch_rules)에서 가져온다.
const MAX_DOC_CHARS = 1_000_000;

function decodeXml(bytes) {
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 200));
  const enc = head.match(/encoding="([^"]+)"/i)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(enc).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function documents(env, { rceptNos = null, maxDocs = 500 } = {}) {
  return withRun(env, 'documents', { rceptNos, maxDocs }, async (ctx) => {
    let queue = rceptNos ? rceptNos.map((r) => ({ rcept_no: r })) : null;
    let done = 0;
    while (done < maxDocs) {
      if (!queue || !queue.length) {
        if (rceptNos) break;
        queue = await env.db.rpc('ingest_pending_documents', { p_limit: 100 });
        if (!queue.length) break;
      }
      const { rcept_no } = queue.shift();
      done++;
      try {
        const zip = await env.dart.binary('document.xml', { rcept_no });
        const files = unzipSync(zip);
        let bytes = 0;
        const names = Object.keys(files);
        for (const name of names) {
          const text = decodeXml(files[name]);
          bytes += files[name].length;
          await env.db.rpc('ingest_put_document', {
            p_run_id: ctx.runId, p_rcept_no: rcept_no, p_section: `file:${name}`,
            p_content: text.slice(0, MAX_DOC_CHARS),
          });
        }
        await env.db.rpc('ingest_mark_document', { p_run_id: ctx.runId, p_rcept_no: rcept_no, p_status: 'ok', p_files: names.length, p_bytes: bytes });
        ctx.fetched += 1;
        ctx.written += names.length;
      } catch (e) {
        if (!(e instanceof DocError)) throw e;
        await env.db.rpc('ingest_mark_document', {
          p_run_id: ctx.runId, p_rcept_no: rcept_no, p_status: e.status === '014' ? 'missing' : 'error', p_files: 0, p_bytes: 0,
        });
        await env.db.rpc('ingest_log_issue', { p_stage: 'ingest', p_code: `document_${e.status}`, p_rcept_no: rcept_no, p_detail: { message: e.message } });
      }
      if (done % 50 === 0) console.log(`documents: ${done}건`);
    }
  });
}

// 8. 한국은행 ECOS 금리 ----------------------------------------------------
// 항목코드는 ECOS 항목 목록에서 ref.rate_series.item_pattern(항목명)으로 찾는다.
const ECOS_BASE = process.env.ECOS_BASE ?? 'https://ecos.bok.or.kr/api';

async function ecosJson(key, path) {
  const res = await fetch(`${ECOS_BASE}/${path.replace('{KEY}', key)}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);
  return res.json();
}

export async function rates(env, { from = '2019-01-01', key = process.env.ECOS_API_KEY } = {}) {
  if (!key) {
    console.log('rates: ECOS_API_KEY 가 없어 건너뜀');
    return null;
  }
  return withRun(env, 'rates', { from }, async (ctx) => {
    const series = await env.db.rpc('ingest_rate_series');
    const itemLists = new Map();
    const today = ymd(todayKst());
    for (const s of series) {
      if (!itemLists.has(s.stat_code)) {
        const body = await ecosJson(key, `StatisticItemList/{KEY}/json/kr/1/1000/${s.stat_code}`);
        const rows = body?.StatisticItemList?.row ?? [];
        if (!rows.length) throw new Error(`ECOS 항목 목록 없음 ${s.stat_code}: ${JSON.stringify(body).slice(0, 200)}`);
        itemLists.set(s.stat_code, rows);
      }
      const rows = itemLists.get(s.stat_code);
      const re = new RegExp(s.item_pattern);
      const item = rows.find((r) => re.test(r.ITEM_NAME) && r.CYCLE === s.cycle) ?? rows.find((r) => re.test(r.ITEM_NAME));
      if (!item) {
        await env.db.rpc('ingest_log_issue', { p_stage: 'ingest', p_code: 'ecos_item_not_found', p_detail: { series: s.series_key, pattern: s.item_pattern } });
        continue;
      }
      const cycle = item.CYCLE ?? s.cycle;
      const start = s.last_dt ? addDays(s.last_dt, -7) : from;
      const fmt = (d) => (cycle === 'M' ? ymd(d).slice(0, 6) : ymd(d));
      const body = await ecosJson(key,
        `StatisticSearch/{KEY}/json/kr/1/100000/${s.stat_code}/${cycle}/${fmt(start)}/${cycle === 'M' ? today.slice(0, 6) : today}/${item.ITEM_CODE}`);
      const data = body?.StatisticSearch?.row ?? [];
      ctx.fetched += data.length;
      const items = data.map((r) => ({
        dt: r.TIME.length === 6 ? `${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}-01` : `${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}-${r.TIME.slice(6, 8)}`,
        value: r.DATA_VALUE,
      }));
      for (let i = 0; i < items.length; i += 2000) {
        ctx.written += await env.db.rpc('ingest_put_rates', { p_series_key: s.series_key, p_items: items.slice(i, i + 2000) });
      }
      console.log(`rates: ${s.series_key} (${item.ITEM_NAME}, ${cycle}) ${items.length}건`);
    }
  });
}

// 9. 인사이트 요약 (DB 사실 → AI 요약 또는 규칙 문장) -------------------------
import { buildSummaries } from './insights.mjs';

export async function insights(env) {
  return withRun(env, 'insights', {}, async (ctx) => {
    const out = await buildSummaries({ db: env.db });
    ctx.written = Object.values(out).filter((v) => v !== 'same').length;
  });
}

// 10. 과거 회사채 신고서 (회사별 공시검색) ---------------------------------
// 회사 미지정 검색은 파생결합증권까지 모두 받아야 해서 비싸다. 공모채 이력·잔액이 있는 회사만 회사별로 받는다.
export async function historyBonds(env, { from = '2019-01-01', to = '2024-09-30', maxPages = 5, include = '증권신고서\\(채무증권\\)' } = {}) {
  const periodKey = `${from}~${to}`;
  const re = new RegExp(include);
  return withRun(env, 'history-bonds', { from, to }, async (ctx) => {
    for (;;) {
      const corps = await env.db.rpc('ingest_history_bond_corps', { p_period_key: periodKey, p_limit: 300 });
      if (!corps.length) break;
      for (const { corp_code } of corps) {
        let page = 1;
        let totalPage = 1;
        let status = STATUS.NO_DATA;
        do {
          const body = await env.dart.json('list', {
            corp_code, bgn_de: ymd(from), end_de: ymd(to), pblntf_ty: 'C', page_no: page, page_count: 100,
          });
          status = body.status;
          if (body.status !== STATUS.OK) break;
          totalPage = Number(body.total_page ?? 1);
          const items = (body.list ?? [])
            .filter((x) => re.test(String(x.report_nm ?? '')))
            .map((x) => ({ ...x, _pblntf_ty: 'C', _pblntf_detail_ty: null }));
          ctx.fetched += items.length;
          if (items.length) ctx.written += await env.db.rpc('ingest_put_filings', { p_run_id: ctx.runId, p_items: items });
          page++;
        } while (page <= Math.min(totalPage, maxPages));
        await env.db.rpc('ingest_put_periodic', {
          p_run_id: ctx.runId, p_endpoint: 'history_bond_list', p_corp_code: corp_code,
          p_period_key: periodKey, p_status_code: status === STATUS.OK ? '000' : status, p_items: [],
        });
      }
      console.log(`history-bonds: 공시 ${ctx.written}건 저장`);
    }
  });
}

// 수집기 종단 테스트: 모의 OpenDART + 모의 Supabase RPC(PGlite) 로 `ingest/run.mjs dev` 를 실행한다.
// 응답 형식은 OpenDART 개발가이드의 필드 정의를 따른다. 실제 형식 확인은 Actions 실행으로 한다.
// 실행: npm run test:ingest

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
const migDir = join(root, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'));
}

// 모의 OpenDART -----------------------------------------------------------
const calls = [];
const listData = {
  C002: [
    { corp_code: '00000001', corp_name: '테스트채권', stock_code: ' ', corp_cls: 'E', report_nm: '증권신고서(채무증권)',
      rcept_no: '20260901000001', flr_nm: '테스트채권', rcept_dt: '20260901', rm: '' },
    { corp_code: '00000001', corp_name: '테스트채권', stock_code: ' ', corp_cls: 'E', report_nm: '[발행조건확정]증권신고서(채무증권)',
      rcept_no: '20260905000001', flr_nm: '테스트채권', rcept_dt: '20260905', rm: '정' },
  ],
  B001: Array.from({ length: 150 }, (_, i) => ({
    corp_code: i === 0 ? '00000002' : `0000${String(1000 + i)}`, corp_name: i === 0 ? '테스트메자닌' : `기타${i}`,
    stock_code: '123456', corp_cls: 'K',
    report_nm: i === 0 ? '주요사항보고서(전환사채권발행결정)' : '주요사항보고서(자기주식취득결정)',
    rcept_no: `2026091000${String(1000 + i)}`, flr_nm: 'x', rcept_dt: '20260910', rm: '',
  })),
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.searchParams;
  calls.push(url.pathname);
  const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url.pathname === '/api/corpCode.xml') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><result>` +
      ['00000001:테스트채권:', '00000002:테스트메자닌:123456'].concat(
        Array.from({ length: 1200 }, (_, i) => `0001${String(i).padStart(4, '0')}:회사${i}:`))
        .map((s) => { const [c, n, st] = s.split(':'); return `<list><corp_code>${c}</corp_code><corp_name>${n}</corp_name><stock_code>${st}</stock_code><modify_date>20260101</modify_date></list>`; })
        .join('') + `</result>`;
    res.end(Buffer.from(zipSync({ 'CORPCODE.xml': strToU8(xml) })));
    return;
  }
  if (url.pathname === '/api/list.json') {
    const all = listData[p.get('pblntf_detail_ty')] ?? [];
    if (!all.length) return json({ status: '013', message: '조회된 데이타가 없습니다.' });
    const size = Number(p.get('page_count')), page = Number(p.get('page_no'));
    return json({ status: '000', message: '정상', page_no: page, page_count: size, total_count: all.length,
                  total_page: Math.ceil(all.length / size), list: all.slice((page - 1) * size, page * size) });
  }
  if (url.pathname === '/api/bdRs.json') {
    return json({ status: '000', message: '정상', group: [
      { title: '일반사항', list: [
        { rcept_no: '20260901000001', corp_code: '00000001', tm: '1', fta: '30,000,000,000' },
        { rcept_no: '20260905000001', corp_code: '00000001', tm: '1', fta: '50,000,000,000' } ] },
      { title: '인수인정보', list: [
        { rcept_no: '20260905000001', actsen: '대표', actnmn: '엔에이치투자증권', udtamt: '50,000,000,000', udtprc: '150,000,000' } ] },
    ] });
  }
  if (url.pathname === '/api/cvbdIsDecsn.json') {
    return json({ status: '000', message: '정상', list: [
      { rcept_no: '20260910001000', corp_code: '00000002', bd_tm: '2', bd_knd: '무기명식 이권부 무보증 사모 전환사채', bd_fta: '50,000,000,000' } ] });
  }
  return json({ status: '013', message: '조회된 데이타가 없습니다.' });
});

// 모의 Supabase RPC (PostgREST 흉내: 이름 붙은 인자 → 함수 호출) ------------
const rpc = http.createServer(async (req, res) => {
  const fn = req.url.match(/\/rest\/v1\/rpc\/(\w+)/)?.[1];
  let body = '';
  for await (const c of req) body += c;
  const args = body ? JSON.parse(body) : {};
  try {
    const meta = (await db.query(
      `select p.proretset, coalesce(p.proargnames, '{}') as names,
              coalesce((select array_agg(format_type(t, null)) from unnest(p.proargtypes) t), '{}') as types,
              format_type(p.prorettype, null) as rettype
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [fn])).rows[0];
    const names = Object.keys(args);
    const params = names.map((k) => {
      const v = args[k];
      if (Array.isArray(v) && meta.types[meta.names.indexOf(k)] === 'text[]') return `{${v.map((s) => `"${s}"`).join(',')}}`;
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    });
    const argSql = names.map((k, i) => `${k} => $${i + 1}::${meta.types[meta.names.indexOf(k)]}`).join(', ');
    await db.exec('set role service_role');
    const r = await db.query(meta.proretset ? `select * from public.${fn}(${argSql})` : `select public.${fn}(${argSql}) as v`, params);
    await db.exec('reset role');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(meta.proretset ? r.rows : r.rows[0]?.v ?? null));
  } catch (e) {
    await db.exec('reset role');
    res.statusCode = 400;
    res.end(JSON.stringify({ message: e.message }));
  }
});

await new Promise((r) => server.listen(0, r));
await new Promise((r) => rpc.listen(0, r));

const child = spawn(process.execPath, [join(root, 'ingest', 'run.mjs'), 'dev', '--days', '45'], {
  env: { ...process.env,
    OPENDART_BASE: `http://127.0.0.1:${server.address().port}/api`,
    OPENDART_API_KEY: 'test-key',
    SUPABASE_URL: `http://127.0.0.1:${rpc.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const code = await new Promise((r) => child.on('close', r));

const q = async (sql) => (await db.query(sql)).rows;
const checks = [
  ['수집기 종료 코드 0', code, 0],
  ['회사 마스터 적재', (await q(`select count(*)::int c from raw.corp_codes`))[0].c, 1202],
  ['corp_code 앞자리 0 보존', (await q(`select count(*)::int c from raw.corp_codes where corp_code = '00000001'`))[0].c, 1],
  ['공시 목록 적재 (B001 2페이지 포함)', (await q(`select count(*)::int c from raw.filings`))[0].c, 152],
  ['상세 API: 그룹형 3항목 + 목록형 1항목', (await q(`select count(*)::int c from raw.api_items`))[0].c, 4],
  ['상세 API 그룹명 보존', (await q(`select string_agg(distinct group_title, ',' order by group_title) s from raw.api_items where endpoint='bdRs'`))[0].s, '인수인정보,일반사항'],
  ['bdRs 는 회사 단위 1회 호출', calls.filter((c) => c === '/api/bdRs.json').length, 1],
  ['무관 공시(자기주식)는 상세 호출 안 함', calls.filter((c) => c.includes('IsDecsn') && !c.includes('cvbd')).length, 0],
  ['대기 목록 소진', (await q(`select count(*)::int c from public.ingest_pending_details()`))[0].c, 0],
  ['회사 변환 (core.companies)', (await q(`select count(*)::int c from core.companies`))[0].c, 1202],
  ['법인구분 반영 (코스닥)', (await q(`select market from core.companies where corp_code='00000002'`))[0].market, '코스닥'],
  ['실행 기록 성공', (await q(`select string_agg(job || ':' || status, ',' order by run_id) s from ops.ingest_runs`))[0].s,
    'probe:success,corp-codes:success,filings:success,details:success,refresh:success'],
  ['인증키가 로그에 없음', out.includes('test-key'), false],
];

let failed = 0;
for (const [name, actual, expected] of checks) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}
if (failed) console.log(`\n--- 수집기 출력 ---\n${out}`);
console.log(`\n${checks.length - failed}/${checks.length} passed`);
server.close(); rpc.close();
process.exit(failed ? 1 : 0);

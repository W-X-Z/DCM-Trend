// 딜 발굴 데스크 SQL 시험: 마이그레이션을 PGlite 에 올리고 public.desk_* 함수와 mart.v_desk_* 뷰를 확인한다.
// 실행: npm run test:desk   (부서의 실행 코드 시험은 python3 -m unittest desk.tests.test_desk)

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
const migDir = join(root, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'));
}
await db.exec(readFileSync(join(root, 'tests', 'fixtures', 'bbb0_20250410_20260410.sql'), 'utf8'));

let failed = 0;
async function check(name, fn, expected) {
  let actual;
  try { actual = await fn(); } catch (e) { actual = `ERROR: ${e.message}`; }
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      기대 ${JSON.stringify(expected)}\n      실제 ${JSON.stringify(actual)}`}`);
}
const one = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
const j = (o) => JSON.stringify(o);

await db.exec('set role service_role');

// 실행 기록 -------------------------------------------------------------
await check('실행 시작 전에는 오늘 돈 실행이 없다', () => one(`select public.desk_ran_today('daily')`), false);
await one(`select public.desk_run_start('r1', 'daily')`);
await check('도는 실행이 있으면 오늘 돈 것으로 본다', () => one(`select public.desk_ran_today('daily')`), true);
await check('종류가 다르면 따로 센다', () => one(`select public.desk_ran_today('brief')`), false);
const cid = await one(`select public.desk_call_start($1::jsonb)`, [j({ run_id: 'r1', agent: 'monitor.screener', dept: 'monitor', slot: 2, model: 'm', item: 'x' })]);
await db.query(`select public.desk_call_finish($1, $2::jsonb)`, [cid, j({ status: 'ok', input_tokens: 10, output_tokens: 5, searches: 0, cost_usd: 0.01, summary: '신호 1' })]);
await db.query(`select public.desk_run_finish('r1', 'failed', 0.01, '{"signals":1}'::jsonb)`);
await check('실패한 실행은 오늘 돈 것으로 보지 않는다', () => one(`select public.desk_ran_today('daily')`), false);
await check('호출 기록', async () => (await db.query(`select agent, slot, status, summary, cost_usd::text from mart.v_desk_calls`)).rows,
  [{ agent: 'monitor.screener', slot: 2, status: 'ok', summary: '신호 1', cost_usd: '0.01' }]);

// 뉴스 -----------------------------------------------------------------
await check('뉴스 검색어 기본값', () => one(`select jsonb_array_length(public.desk_news_queries())`), 12);
const news = [
  { url_hash: 'h1', url: 'https://example.com/1', title: '가나다, 공장 증설에 500억 투자', snippet: '조달 방안 미정', source: 'example.com', published_at: new Date().toISOString(), query: '공장 증설 투자', grp: '투자·증설' },
  { url_hash: '', url: 'https://example.com/2', title: '해시 없는 기사' },
];
await check('뉴스 넣기: 해시 없는 줄은 버린다', () => one(`select public.desk_news_put($1::jsonb)`, [j(news)]), 1);
await check('뉴스 넣기: 같은 기사는 다시 넣지 않는다', () => one(`select public.desk_news_put($1::jsonb)`, [j(news)]), 0);

// 입력 묶음과 본 것 ------------------------------------------------------
await check('입력 묶음의 칸', async () => Object.keys(await one(`select public.desk_inputs(3)`)).sort(), ['board', 'data', 'filings', 'news', 'rules']);
await check('입력 묶음: 안 읽은 기사', async () => (await one(`select public.desk_inputs(3) -> 'news'`)).map((n) => [n.ref, n.title, n.snippet]),
  [['h1', '가나다, 공장 증설에 500억 투자', '조달 방안 미정']]);
await db.query(`select public.desk_seen_put('r1', $1::jsonb)`, [j([{ src_type: 'news', src_ref: 'h1' }, { src_type: 'news', src_ref: 'h1' }])]);
await check('입력 묶음: 읽은 기사는 다시 주지 않는다', () => one(`select jsonb_array_length(public.desk_inputs(3) -> 'news')`), 0);

// 신호 -----------------------------------------------------------------
const sig = [{ src_type: 'news', src_ref: 'h1', src_dt: '2026-11-21', corp_code: '', corp_name: '가나다', need: '투자·증설', what: '500억 증설', why: '조달 미정', strength: 3, url: 'https://example.com/1' }];
await check('신호 넣기', () => one(`select public.desk_signals_put('r1', $1::jsonb)`, [j(sig)]), 1);
await check('신호 넣기: 같은 신호는 한 번만', () => one(`select public.desk_signals_put('r1', $1::jsonb)`, [j(sig)]), 0);
await check('최근 신호', async () => (await one(`select public.desk_recent_signals(14)`)).map((s) => [s.corp_name, s.need, s.strength, s.dt, s.corp_code ?? null]),
  [['가나다', '투자·증설', 3, '2026-11-21', null]]);

// 대상 보드 --------------------------------------------------------------
await db.exec('reset role');
const corp = (await db.query(`select corp_code, corp_name from mart.v_deals where product_type = 'bond' and rating_group is not null order by deal_dt desc limit 1`)).rows[0];
await db.exec('set role service_role');
const lid = Number(await one(`select public.desk_lead_put($1::jsonb)`, [j({ corp_code: corp.corp_code, corp_name: corp.corp_name, need: '차환·상환', hypothesis: '가설', signals: sig, questions: ['q'], kill: 'k', priority: 1, run_id: 'r1' })]));
await check('보드: 새 대상은 대기', async () => (await one(`select public.desk_open_leads()`)).map((l) => [l.corp_name, l.status, l.origin, l.hypothesis]), [[corp.corp_name, '대기', 'daily', '가설']]);
await db.query(`select public.desk_lead_put($1::jsonb)`, [j({ lead_id: lid, research: { checks: {} } })]);
await check('보드: 준 칸만 고친다', async () => { const l = (await one(`select public.desk_open_leads()`))[0]; return [l.hypothesis, l.research, l.brief, l.status]; }, ['가설', { checks: {} }, null, '대기']);
await check('보드: 게시 전에는 화면에 없다', () => one(`select count(*)::int from mart.v_desk_briefs`), 0);
await db.query(`select public.desk_lead_put($1::jsonb)`, [j({ lead_id: lid, status: '게시', brief: { headline: '왜 지금' }, brief_md: '# 본문', verify: { state: '유지' } })]);
await check('보드: 게시하면 화면에 나온다', async () => (await db.query(`select corp_name, headline, verify_state, brief_md, published_at is not null as pub from mart.v_desk_briefs`)).rows,
  [{ corp_name: corp.corp_name, headline: '왜 지금', verify_state: '유지', brief_md: '# 본문', pub: true }]);
await check('보드: 게시된 대상은 대기 목록에서 빠진다', () => one(`select jsonb_array_length(public.desk_open_leads())`), 0);
await check('입력 묶음: 최근 보드', async () => (await one(`select public.desk_inputs(3) -> 'board'`)).map((b) => [b.corp_code, b.status]), [[corp.corp_code, '게시']]);
await check('보드: 없는 상태는 거절', () => one(`select public.desk_lead_put($1::jsonb)`, [j({ lead_id: lid, status: '완료' })]).then(() => 'ok').catch(() => '거절'), '거절');

// 회사 데이터 묶음 --------------------------------------------------------
await check('회사 묶음의 칸', async () => Object.keys(await one(`select public.desk_company($1)`, [corp.corp_code])).sort(),
  ['deals', 'expansions', 'filings', 'maturities', 'news', 'overview', 'short_debt']);
await check('회사 묶음: 개요와 조달 이력', async () => { const d = await one(`select public.desk_company($1)`, [corp.corp_code]); return [d.overview.corp_name, d.deals.length > 0, d.deals[0].product]; },
  [corp.corp_name, true, '회사채 공모']);
await check('회사 묶음: 없는 회사', async () => { const d = await one(`select public.desk_company('99999999')`); return [d.overview, d.deals]; }, [null, []]);
await check('유사 사례: 등급이 있으면 같은 등급군 공모채 기준', async () => (await one(`select public.desk_comps($1, 600)`, [corp.corp_code])).basis.startsWith('같은 등급군('), true);
await check('유사 사례: 자기 회사는 뺀다', async () => (await one(`select public.desk_comps($1, 600)`, [corp.corp_code])).bonds.some((b) => b.corp_name === corp.corp_name), false);
await check('회사 찾기', async () => (await one(`select public.desk_find_company($1, 1)`, [corp.corp_name]))[0].corp_code, corp.corp_code);

// 권한 -----------------------------------------------------------------
await db.exec('reset role; set role anon');
await check('anon: 부서 함수는 못 부른다', () => one(`select public.desk_lead_put('{}'::jsonb)`).then(() => 'ok').catch(() => '거절'), '거절');
await check('anon: 부서 표는 못 읽는다', () => one(`select count(*) from desk.leads`).then(() => 'ok').catch(() => '거절'), '거절');
await check('anon: 화면용 뷰는 읽는다', () => one(`select count(*)::int from mart.v_desk_briefs`), 1);
await check('anon: 뉴스 원본은 못 읽는다', () => one(`select count(*) from raw.news`).then(() => 'ok').catch(() => '거절'), '거절');

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);

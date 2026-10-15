// 딜 변환 테스트: 실제 OpenDART 응답 일부(tests/fixtures/dart_api_sample_202609.json)를
// 수집 RPC 로 적재하고 public.ingest_refresh() 결과를 검증한다.
// 실행: npm run test:transforms

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

const fx = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'dart_api_sample_202609.json'), 'utf8'));
await db.exec('set role service_role');
const runId = (await db.query(`select public.ingest_start_run('test') as id`)).rows[0].id;
await db.query(`select public.ingest_put_filings($1, $2::jsonb)`, [runId, JSON.stringify(fx.filings)]);
const groups = new Map();
for (const it of fx.items) {
  const k = `${it.endpoint}|${it.corp_code}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push({ group_title: it.group_title, item: it.item });
}
for (const [k, items] of groups) {
  const [endpoint, corp] = k.split('|');
  await db.query(`select public.ingest_put_api_items($1, $2, $3, '000', $4::jsonb, $5::text[])`,
    [runId, endpoint, corp, JSON.stringify(items), `{${[...new Set(items.map((i) => i.item.rcept_no))].join(',')}}`]);
}
const refreshed = (await db.query(`select public.ingest_refresh() as r`)).rows[0].r;
await db.exec('reset role');

const results = [];
async function check(name, sql, expected) {
  let actual;
  try {
    const rows = (await db.query(sql)).rows;
    actual = rows.length === 1 && Object.keys(rows[0]).length === 1 ? Object.values(rows[0])[0] : rows.map((r) => Object.values(r).join('|'));
  } catch (e) { actual = `ERROR: ${e.message}`; }
  results.push({ ok: JSON.stringify(actual) === JSON.stringify(expected), name, actual, expected });
}

await check('변환 건수', `select '${JSON.stringify(refreshed).replace(/'/g, "''")}'::jsonb - 'companies' - 'docs' - 'fixes'`,
  { ipo: 1, bond: 2, mezz: 3, equity: 1 });
await check('회사 보강: corpCode 없이 공시만으로 회사 생성·시장 구분',
  `select market from core.companies where corp_code = '01764099'`, '코스닥');

// 회사채 (GS 22-1, 22-2)
await check('회사채 딜 키·금액·만기',
  `select deal_key, amount_eok, tenor_months, payment_dt::text, sub_type from mart.v_deals where product_type = 'bond' order by deal_key`,
  ['bond:00500254:22-1|500.0|24|2026-10-21|일반회사채', 'bond:00500254:22-2|1000.0|36|2026-10-21|일반회사채']);
await check('회사채 공시 연결: 최초 신고일·발행조건확정일·최신 공시',
  `select announce_dt::text || '|' || pricing_dt::text || '|' || status || '|' || latest_rcept_no from mart.v_deals where deal_key = 'bond:00500254:22-1'`,
  '2026-10-08|2026-10-15|priced|20261015000311');
await check('회사채 인수단: 표준명·역할',
  `select firm_std || ':' || role from core.deal_underwriters where deal_key = 'bond:00500254:22-2' order by firm_std`,
  ['KB증권:대표주관', '대신증권:대표주관', '키움증권:인수', '하나증권:인수']);
await check('회사채 수수료 bp (정액 표기 파싱)',
  `select string_agg(fee_bp::text, ',' order by deal_key) from mart.v_deals where product_type = 'bond'`, '24.0,18.0');
await check('회사채 NH 대표주관 표시',
  `select string_agg(deal_key || ':' || nh_lead, ',' order by deal_key) from mart.v_deals where product_type = 'bond'`,
  'bond:00500254:22-1:true,bond:00500254:22-2:false');
await check('회사채 자금용도',
  `select use_of_funds ->> '채무상환자금' from core.bond_terms where deal_key = 'bond:00500254:22-1'`, '50000000000');

// 메자닌
await check('메자닌 3종 조건',
  `select deal_key, amount_eok, coupon_pct, ytm_pct, conv_price, shares_ratio_pct, is_public, status
     from mart.v_deals where product_type = 'mezz' order by deal_key`,
  ['mezz:00366137:EB-4|162.5|0.0|0.0|6872||false|announced',
   'mezz:01370322:BW-2|100.0|0.0|0.0|7427|11.95|false|completed',
   'mezz:01764099:CB-2|300.0|0.0|0.0|32823|13.71|false|completed']);
await check('메자닌 기준일 = 이사회 결의일, 정관 잔여한도',
  `select deal_dt::text || '|' || articles_remaining_krw from mart.v_deals where deal_key = 'mezz:01764099:CB-2'`,
  '2026-09-14|49400000000');
await check('메자닌 0%/0% 특성',
  `select txt_value from mart.v_deal_features where deal_key = 'mezz:01764099:CB-2' and feature = 'zero_coupon'`, 'true');

// 유상증자
await check('유증: 제3자배정·금액(자금목적 합)·희석률',
  `select deal_key, sub_type, amount_krw, dilution_pct, is_public from mart.v_deals where product_type = 'equity'`,
  ['equity:00270113:20260914000397|제3자배정|990000000|3.50|false']);
await check('IPO 신고서(다비오)는 유증이 아니라 IPO 로',
  `select string_agg(product_type, ',') from core.deals where corp_code = '01706509'`, 'ipo');
await check('IPO: 공모가·주식수·구주매출·주관사',
  `select v.sub_type || '|' || v.offer_price || '|' || t.shares_offered || '|' || coalesce(t.secondary_pct::text, '-') || '|' || coalesce(v.lead_managers, '-') || '|' || v.deal_dt
     from mart.v_deals v join core.ipo_terms t using (deal_key) where v.product_type = 'ipo'`,
  '일반|12300|1000000|-|대신증권|2026-11-13');

// 트렌드 뷰가 실제 변환 결과로 동작
await check('메자닌 월간 트렌드 (2026-09, 코스닥 사모)',
  `select kind || ':' || deal_count || ':' || zero_coupon_count from mart.v_mezz_trend_monthly where month = '2026-09-01' order by kind`,
  ['BW:1:1', 'CB:1:1']);
await check('변환 재실행해도 결과 동일 (멱등)',
  `select (public.ingest_refresh() - 'companies' - 'docs' - 'fixes')::text`, '{"ipo": 1, "bond": 2, "mezz": 3, "equity": 1}');

// 원문 파싱 결과 반영 (GS 제22회 발행조건확정 신고서에서 파서가 뽑은 값)
await db.exec('set role service_role');
await db.query(`select public.ingest_put_doc_fields(null, '20261015000311', 'bond', $1::jsonb)`, [JSON.stringify([
  { field: 'rating_raw', series: null, value: 'AA0' },
  { field: 'band_type', series: null, value: '개별민평' },
  { field: 'band_low_bp', series: null, value: '-30' },
  { field: 'band_high_bp', series: null, value: '30' },
  { field: 'final_spread_bp_by_tenor', series: '2', value: '-11' },
  { field: 'final_spread_bp_by_tenor', series: '3', value: '-10' },
  { field: 'amount_initial', series: '22-1', value: '50000000000' },
  { field: 'amount_initial', series: '22-2', value: '50000000000' },
  { field: 'demand_count', series: '22-1', value: '36' },
  { field: 'demand_krw', series: '22-1', value: '650000000000' },
  { field: 'competition_ratio', series: '22-1', value: '13' },
  { field: 'competition_ratio', series: '22-2', value: '10.2' },
])]);
const docs = (await db.query(`select (public.ingest_refresh() -> 'docs')::text as d`)).rows[0].d;
await db.exec('reset role');
await check('원문 값 반영 건수', `select '${docs}'::jsonb ->> 'bond_docs'`, '2');
await check('원문: 등급·밴드·확정 가산금리·경쟁률',
  `select deal_key || '|' || rating || '|' || band_type || '|' || band_low || '~' || band_high || '|' || final_spread_bp || '|' || competition_ratio
     from mart.v_deals where product_type = 'bond' order by deal_key`,
  ['bond:00500254:22-1|AA0|개별민평|-30~30|-11|13', 'bond:00500254:22-2|AA0|개별민평|-30~30|-10|10.2']);
await check('원문: 증액 판단 (22-2 500억 → 1,000억)',
  `select string_agg(deal_key || ':' || is_increased, ',' order by deal_key) from mart.v_deals where product_type = 'bond'`,
  'bond:00500254:22-1:false,bond:00500254:22-2:true');

// 한 딜의 값이 여러 공시에 나뉜 경우: 필드마다 가장 최근 공시 값, 최초 신고금액은 가장 이른 공시 값
const regNo = (await db.query(
  `select rcept_no from core.deal_filings where deal_key = 'bond:00500254:22-1' and role = 'registration' order by rcept_no limit 1`)).rows[0]?.rcept_no;
await db.exec('set role service_role');
await db.query(`select public.ingest_put_doc_fields(null, $1, 'bond', $2::jsonb)`, [regNo, JSON.stringify([
  { field: 'coupon_pct', series: '22-1', value: '3.1' },          // 확정 공시에는 없는 값 → 채택
  { field: 'competition_ratio', series: '22-1', value: '99' },    // 확정 공시(13배)가 더 최근 → 버림
  { field: 'amount_initial', series: '22-1', value: '45000000000' },
])]);
await db.query(`select public.ingest_refresh()`);
await db.exec('reset role');
await check('여러 공시 병합: 금리는 이전 공시, 경쟁률은 최근 공시, 최초 금액은 가장 이른 공시',
  `select coupon_pct || '|' || competition_ratio || '|' || is_increased from mart.v_deals where deal_key = 'bond:00500254:22-1'`,
  '3.1|13|true');

// 같은 공시를 고친 파서로 다시 읽으면, 이번에 나오지 않은 필드(이전 run 값)는 쓰지 않는다
await db.exec('set role service_role');
const run2 = (await db.query(`select public.ingest_start_run('test-reparse') as id`)).rows[0].id;
await db.query(`select public.ingest_put_doc_fields($1, '20261015000311', 'bond', $2::jsonb)`, [run2, JSON.stringify([
  { field: 'final_spread_bp_by_tenor', series: '2', value: '-12' },
])]);
await db.exec('reset role');
await check('다시 읽은 공시: 새 값만 사용',
  `select coalesce(core.doc_value('20261015000311', 'rating_raw'), '-') || '|' || core.doc_value('20261015000311', 'final_spread_bp_by_tenor', '2')`,
  '-|-12');
await check('파서 버전을 올린 규칙의 공시는 다시 대기열로',
  `select count(*)::int from public.ingest_pending_documents(1000) p where p.purpose in ('bond', 'ipo')`,
  (await db.query(`select count(*)::int as n from raw.filings f join ref.document_fetch_rules r on r.is_active and r.purpose in ('bond', 'ipo') and f.report_nm ~ r.report_pattern and (r.lookback_days is null or f.rcept_dt >= current_date - r.lookback_days)`)).rows[0].n);

// 원천 입력 오류 보정: 납입일 칸에 만기일을 적은 회사채 → 청약일
await db.exec(`update core.deals set payment_dt = '2028-10-21' where deal_key = 'bond:00500254:22-1'`);
await db.exec(`update core.bond_terms set tenor_months = 0 where deal_key = 'bond:00500254:22-1'`);
const fixed = (await db.query(`select core.apply_sanity_fixes() ->> 'bond_payment_dt' as n`)).rows[0].n;
await check('보정: 납입일 ≥ 만기일이면 청약일로, 만기 개월 다시 계산',
  `select '${fixed}' || '|' || payment_dt || '|' || tenor_months from mart.v_deals where deal_key = 'bond:00500254:22-1'`,
  '1|2026-10-21|24');

// 유상증자: API 값이 최종 정정본에만 있는 경우, 결정일은 원 결정 공시(비고 '정') 날짜
await db.exec('set role service_role');
const runEq = (await db.query(`select public.ingest_start_run('test-eq') as id`)).rows[0].id;
await db.query(`select public.ingest_put_filings($1, $2::jsonb)`, [runEq, JSON.stringify([
  { rm: '정', flr_nm: '테스트', corp_cls: 'K', rcept_dt: '20260801', rcept_no: '20260801000001', corp_code: '01764099', corp_name: '테스트', report_nm: '주요사항보고서(유상증자결정)', stock_code: '' },
  { rm: '', flr_nm: '테스트', corp_cls: 'K', rcept_dt: '20260910', rcept_no: '20260910000002', corp_code: '01764099', corp_name: '테스트', report_nm: '[기재정정]주요사항보고서(유상증자결정)', stock_code: '' },
])]);
await db.query(`select public.ingest_put_api_items($1, 'piicDecsn', '01764099', '000', $2::jsonb, $3::text[])`, [runEq, JSON.stringify([
  { group_title: null, item: { rcept_no: '20260910000002', corp_code: '01764099', ic_mthn: '제3자배정증자', nstk_ostk_cnt: '100,000', bfic_tisstk_ostk: '10,000,000', fdpp_op: '1,000,000,000' } },
]), '{20260910000002}']);
await db.query(`select public.ingest_refresh()`);
await db.exec('reset role');
await check('유상증자 정정본만 있는 딜: 결정일 = 원 결정 공시일, 원 공시 연결',
  `select v.deal_dt || '|' || (select string_agg(rcept_no || ':' || role, ',' order by rcept_no) from core.deal_filings df where df.deal_key = v.deal_key)
     from mart.v_deals v where v.deal_key = 'equity:01764099:20260910000002'`,
  '2026-08-01|20260801000001:decision,20260910000002:amendment');

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      expected: ${JSON.stringify(r.expected)}\n      actual:   ${JSON.stringify(r.actual)}`}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

// SQL 로직 테스트: 마이그레이션 + 실제 공시 픽스처를 PGlite(인메모리 Postgres)에 올리고 기대값을 검증한다.
// 실행: npm test
// Supabase 없이 로컬·CI에서 돌아가므로, ref 규칙이나 mart 뷰를 고친 뒤 바로 확인할 수 있다.

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite({ extensions: { pg_trgm } });

// Supabase 기본 역할을 흉내 낸다
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$;
`);

const migDir = join(root, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'));
}
await db.exec(readFileSync(join(root, 'tests', 'fixtures', 'bbb0_20250410_20260410.sql'), 'utf8'));

let failed = 0;
const results = [];
async function check(name, sql, expected, pick = (rows) => rows) {
  let actual;
  try {
    const { rows } = await db.query(sql);
    actual = pick(rows);
  } catch (e) {
    actual = `ERROR: ${e.message}`;
  }
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  results.push({ ok, name, actual, expected });
}
const one = (rows) => Object.values(rows[0])[0];
const col = (rows) => rows.map((r) => Object.values(r)[0]);

// 1. 파싱 헬퍼 ----------------------------------------------------------
await check('등급 파싱: 전망 표기 제거', `select core.parse_rating('BBB0(S/N)')`, 'BBB0', one);
await check('등급 파싱: 복수 등급이면 낮은 쪽', `select core.parse_rating('A+ (한국기업평가), A0 (NICE신용평가)')`, 'A0', one);
await check('등급 파싱: 노치 생략 표기', `select core.parse_rating('BBB')`, 'BBB0', one);
await check('등급 파싱: 단기등급(A1) 무시', `select core.parse_rating('A1')`, null, one);
await check('금액 파싱: 원화 괄호', `select core.parse_krw('금 삼백억원(\\30,000,000,000)')::text`, '30000000000', one);
await check('날짜 파싱: 한글', `select core.parse_date_kr('2026년 04월 23일')::text`, '2026-04-23', one);
await check('날짜 파싱: 8자리', `select core.parse_date_kr('20260423')::text`, '2026-04-23', one);
await check('날짜 파싱: 실패 시 null', `select core.parse_date_kr('미정')`, null, one);
await check('증권사 표준화', `select core.normalize_firm('엔에이치투자증권 주식회사')`, 'NH투자증권', one);
await check('증권사 표준화: 사명 변경 전', `select core.normalize_firm('하이투자증권㈜')`, 'iM증권', one);
await check('공시 분류: 발행조건확정',
  `select row(product_type, role)::text from core.classify_filing('[발행조건확정]증권신고서(채무증권)')`,
  '(bond,final_terms)', one);
await check('공시 분류: CB 결정',
  `select row(product_type, sub_type, role)::text from core.classify_filing('주요사항보고서(전환사채권발행결정)')`,
  '(mezz,CB,decision)', one);
await check('공시 분류: 유증 정정',
  `select row(product_type, role)::text from core.classify_filing('[기재정정]주요사항보고서(유상증자결정)')`,
  '(equity,amendment)', one);

// 2. 유사 딜 (합격 기준: 108 증권신고서의 BBB0 14건 재현) --------------
await check('108 유사 딜 = 신고서 BBB0 14건',
  `select count(*)::int from mart.similar_deals('bond:FX_ELAND:108')`, 14, one);
await check('108 유사 딜에 다른 등급(A+) 제외',
  `select count(*)::int from mart.similar_deals('bond:FX_ELAND:108') where deal_key like '%SAMCHEOK%'`, 0, one);
await check('108 유사 딜 상위 5건 (만기·금액·구분 일치 → 최근순)',
  `select deal_key from mart.similar_deals('bond:FX_ELAND:108') limit 5`,
  ['bond:FX_JOONGANG:51', 'bond:FX_ELAND:107', 'bond:FX_SLLJA:22', 'bond:FX_SLLJA:21', 'bond:FX_JOONGANG:46'], col);
await check('가상 조건 검색 (BBB0·1년·300억, 2026-04-10 기준)',
  `select count(*)::int from mart.find_comps('bond', '{"rating_notch":9,"tenor_months":12,"amount_krw":30000000000}', '2026-04-10')`,
  14, one);

// 3. 트렌드 -------------------------------------------------------------
await check('14건 중 미달 6건',
  `select sum(undersub_count)::int from mart.v_bond_trend_monthly
    where rating_group = 'BBB' and month between '2025-07-01' and '2026-02-01'`, 6, one);
await check('14건 중 고정금리 밴드 12건',
  `select sum(fixed_band_count)::int from mart.v_bond_trend_monthly
    where rating_group = 'BBB' and month between '2025-07-01' and '2026-02-01'`, 12, one);
await check('14건 중 증액 10건',
  `select sum(increased_count)::int from mart.v_bond_trend_monthly
    where rating_group = 'BBB' and month between '2025-07-01' and '2026-02-01'`, 10, one);
await check('2026-02 BBB 일반회사채: 3건·1,840억·가중금리 7.516%',
  `select row(deal_count, (amount_krw / 1e8)::int, avg_yield_pct_w)::text from mart.v_bond_trend_monthly
    where month = '2026-02-01' and rating_group = 'BBB' and category = '일반회사채'`,
  '(3,1840,7.516)', one);
await check('캐피탈은 금융채로 분리 (현업 합의 대상)',
  `select string_agg(distinct category, ',') from mart.v_bond_trend_monthly where month = '2025-09-01'`,
  '금융채,일반회사채', one);

// 4. 수수료·리그테이블·주목할 딜 ----------------------------------------
await check('108 수수료 30bp', `select fee_bp::text from mart.v_deals where deal_key = 'bond:FX_ELAND:108'`, '30.0', one);
await check('2026 회사채 대표주관 1위 NH',
  `select firm from mart.v_league_table_yearly where product_type = 'bond' and year = 2026 and lead_rank = 1`,
  'NH투자증권', one);
await check('중앙일보 51 = 미달',
  `select reason from mart.v_notable_deals where deal_key = 'bond:FX_JOONGANG:51'`, ['미달'], col);
await check('삼척블루파워 = 증액·대형·첫 발행',
  `select reason from mart.v_notable_deals where deal_key like 'bond:FX_SAMCHEOK%' order by reason`,
  ['대형', '증액', '첫 발행'], col);

// 5. 회사 검색·개요 ----------------------------------------------------
await check('회사 검색: 딜 있는 회사 우선',
  `select corp_name from mart.search_companies('이랜드')`, ['이랜드월드', '이랜드리테일'], col);
await check('회사 검색: 앞부분 일치 우선',
  `select corp_name from mart.search_companies('중앙') limit 1`, '중앙일보', one);
await check('회사 개요: 이랜드월드 회사채 5건·최근 등급 BBB0',
  `select row(bond_deal_count, latest_bond_rating)::text from mart.v_company_overview where corp_code = 'FX_ELAND'`,
  '(5,BBB0)', one);

// 6. 권한 (화면 = anon 은 mart 만) --------------------------------------
await db.exec('set role anon');
await check('anon: mart 뷰 조회 가능', `select count(*)::int from mart.v_deals`, 17, one);
await check('anon: mart 함수 실행 가능',
  `select count(*)::int from mart.similar_deals('bond:FX_ELAND:108')`, 14, one);
await check('anon: 지표 정의 조회 가능', `select count(*)::int from mart.v_metric_catalog`, 14, one);
await check('anon: core 직접 조회 불가', `select count(*) from core.deals`, 'permission denied',
  () => 'allowed');
results[results.length - 1].ok = String(results[results.length - 1].actual).includes('permission denied');
if (results[results.length - 1].ok) failed--;
await db.exec('reset role');

// 결과 출력 -------------------------------------------------------------
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${r.name}`);
  if (!r.ok) console.log(`      expected: ${JSON.stringify(r.expected)}\n      actual:   ${JSON.stringify(r.actual)}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

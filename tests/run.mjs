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

// 6. 수집 경로 (service_role 이 public.ingest_* 로 적재) -----------------
await db.exec('set role service_role');
await check('수집: 실행 시작', `select public.ingest_start_run('test', '{"days":31}') > 0 as ok`, true, one);
await check('수집: 공시 목록 적재',
  `select public.ingest_put_filings(1, '[
     {"corp_code":"T0000001","corp_name":"이랜드월드","stock_code":" ","corp_cls":"E","report_nm":"증권신고서(채무증권)",
      "rcept_no":"T20260413000001","flr_nm":"이랜드월드","rcept_dt":"20260413","rm":"",
      "_pblntf_ty":"C","_pblntf_detail_ty":"C002"},
     {"corp_code":"T0000001","corp_name":"이랜드월드","stock_code":" ","corp_cls":"E","report_nm":"[발행조건확정]증권신고서(채무증권)",
      "rcept_no":"T20260417000001","flr_nm":"이랜드월드","rcept_dt":"20260417","rm":"정",
      "_pblntf_ty":"C","_pblntf_detail_ty":"C002"},
     {"corp_code":"T0000002","corp_name":"레이크머티리얼즈","stock_code":"281740","corp_cls":"K","report_nm":"주요사항보고서(전환사채권발행결정)",
      "rcept_no":"T20260513000001","flr_nm":"레이크머티리얼즈","rcept_dt":"20260513","rm":"",
      "_pblntf_ty":"B","_pblntf_detail_ty":"B001"},
     {"corp_code":"T0000003","corp_name":"무관회사","stock_code":"","corp_cls":"E","report_nm":"주요사항보고서(자기주식취득결정)",
      "rcept_no":"T20260513000002","flr_nm":"무관회사","rcept_dt":"20260513","rm":"",
      "_pblntf_ty":"B","_pblntf_detail_ty":"B001"}
   ]'::jsonb)`, 4, one);
await check('수집: 상세 API 대기 = 회사·API별로 묶음 (무관 공시 제외)',
  `select endpoint || ':' || corp_code || ':' || bgn_de || '~' || end_de || ':' || array_length(rcept_nos, 1)
     from public.ingest_pending_details() order by endpoint`,
  ['bdRs:T0000001:2026-04-13~2026-04-17:2', 'cvbdIsDecsn:T0000002:2026-05-13~2026-05-13:1'], col);
await check('수집: 상세 응답 적재 (그룹형)',
  `select public.ingest_put_api_items(1, 'bdRs', 'T0000001', '000',
     '[{"group_title":"일반사항","item":{"rcept_no":"T20260417000001","tm":"108","fta":"50,000,000,000"}},
       {"group_title":"인수인정보","item":{"rcept_no":"T20260417000001","actnmn":"엔에이치투자증권","udtamt":"30,000,000,000"}}]'::jsonb,
     array['T20260413000001','T20260417000001'])`, 2, one);
await check('수집: 같은 응답 재적재 시 중복 없음',
  `select public.ingest_put_api_items(1, 'bdRs', 'T0000001', '000',
     '[{"group_title":"일반사항","item":{"rcept_no":"T20260417000001","tm":"108","fta":"50,000,000,000"}}]'::jsonb,
     array['T20260417000001'])`, 0, one);
await check('수집: 호출 완료 공시는 대기에서 빠짐',
  `select string_agg(endpoint, ',') from public.ingest_pending_details()`, 'cvbdIsDecsn', one);
await db.query(`select public.ingest_put_api_items(1, 'cvbdIsDecsn', 'T0000002', '013', '[]'::jsonb, array['T20260513000001'])`);
await check('수집: 데이터 없음(013)도 재호출 안 함',
  `select count(*)::int from public.ingest_pending_details()`, 0, one);
await db.exec('reset role');
await db.exec('set role anon');
await check('수집 함수는 anon 호출 불가', `select public.ingest_stats()`, 'permission denied', () => 'allowed');
results[results.length - 1].ok = String(results[results.length - 1].actual).includes('permission denied');
if (results[results.length - 1].ok) failed--;
await db.exec('reset role');
await db.exec(`delete from raw.detail_fetches; delete from raw.api_items; delete from raw.filings; delete from ops.ingest_runs;`);

// 6-2. 사업 확장 기업: 목적 글로 분류, 정정은 최신본, 지주사 중복·금융사 제외 ------------
await db.exec(`
  insert into core.companies (corp_code, corp_name, market, induty_code) values
    ('XP_CAP', '확장공업', '코스닥', '29'), ('XP_RENT', '임대산업', '코스닥', '29'), ('XP_HQ', '사옥전자', '유가증권', '26'),
    ('XP_MNA', '인수테크', '코스닥', '58'), ('XP_MIN', '소수지분', '코스닥', '58'), ('XP_SUB', '정리홀딩스', '코스닥', '70'),
    ('XP_PAR', '지주회사', '유가증권', '70'), ('XP_FIN', '테스트캐피탈', '기타', '64'), ('XP_OLD', '정정만공업', '코스닥', '29')
  on conflict (corp_code) do nothing;
  insert into raw.filings (rcept_no, corp_code, corp_name, report_nm, rcept_dt, payload) values
    ('XP0000000001', 'XP_CAP', '확장공업', '신규시설투자등', current_date - 40, '{}'),
    ('XP0000000002', 'XP_CAP', '확장공업', '[기재정정]신규시설투자등', current_date - 10, '{}'),
    ('XP0000000003', 'XP_RENT', '임대산업', '주요사항보고서(유형자산양수결정)', current_date - 20, '{}'),
    ('XP0000000004', 'XP_HQ', '사옥전자', '주요사항보고서(유형자산양수결정)', current_date - 20, '{}'),
    ('XP0000000005', 'XP_MNA', '인수테크', '주요사항보고서(타법인주식및출자증권양수결정)', current_date - 30, '{}'),
    ('XP0000000006', 'XP_MIN', '소수지분', '주요사항보고서(타법인주식및출자증권양수결정)', current_date - 30, '{}'),
    ('XP0000000007', 'XP_SUB', '정리홀딩스', '주요사항보고서(타법인주식및출자증권양수결정)', current_date - 30, '{}'),
    ('XP0000000008', 'XP_PAR', '지주회사', '신규시설투자등(자회사의 주요경영사항)', current_date - 10, '{}'),
    ('XP0000000009', 'XP_FIN', '테스트캐피탈', '신규시설투자등', current_date - 10, '{}'),
    ('XP0000000010', 'XP_CAP', '확장공업', '신규시설투자등', current_date - 500, '{}'),
    ('XP0000000011', 'XP_OLD', '정정만공업', '[기재정정]신규시설투자등', current_date - 50, '{}');
  insert into raw.doc_fields (rcept_no, purpose, field, value) values
    ('XP0000000001', 'disclosure', '투자 대상:text', '청주 2공장 생산시설'), ('XP0000000001', 'disclosure', '투자금액:krw', '50000000000'),
    ('XP0000000001', 'disclosure', '자기자본 대비:pct', '25.5'), ('XP0000000001', 'disclosure', '투자 목적:text', '생산능력 확대'),
    ('XP0000000002', 'disclosure', '투자 대상:text', '청주 2공장 생산시설'), ('XP0000000002', 'disclosure', '투자금액:krw', '60000000000'),
    ('XP0000000002', 'disclosure', '자기자본 대비:pct', '30.6'), ('XP0000000002', 'disclosure', '투자 목적:text', '생산능력 확대'),
    ('XP0000000008', 'disclosure', '투자 대상:text', '자회사 신공장'), ('XP0000000008', 'disclosure', '투자금액:krw', '60000000000'),
    ('XP0000000009', 'disclosure', '투자 대상:text', '전산센터'), ('XP0000000009', 'disclosure', '투자금액:krw', '9000000000'),
    ('XP0000000010', 'disclosure', '투자 대상:text', '옛 공장'), ('XP0000000010', 'disclosure', '투자금액:krw', '1000000000'),
    ('XP0000000011', 'disclosure', '투자 대상:text', '2023년 결정 공장'), ('XP0000000011', 'disclosure', '투자금액:krw', '7000000000');
  insert into raw.api_items (endpoint, corp_code, rcept_no, item, item_hash) values
    ('tgastInhDecsn', 'XP_RENT', 'XP0000000003', '{"ast_sen":"토지 및 건물","ast_nm":"강남 빌딩","inh_pp":"부동산 임대를 통한 수익 창출","inhdtl_inhprc":"30,000,000,000","inhdtl_tast_vs":"12.5"}', 'h3'),
    ('tgastInhDecsn', 'XP_HQ', 'XP0000000004', '{"ast_sen":"토지 및 건물","ast_nm":"판교 빌딩","inh_pp":"본사 사옥 확보","inhdtl_inhprc":"20,000,000,000","inhdtl_tast_vs":"8.1","dl_pym":"1. 지급형태: 현금\\n2. 자금조달 방법 : 자기자금 및 차입"}', 'h4'),
    ('otcprStkInvscrInhDecsn', 'XP_MNA', 'XP0000000005', '{"iscmp_cmpnm":"대상(주)","iscmp_rl_cmpn":"-","atinh_eqrt":"100","inh_pp":"사업다각화 및 신성장동력 확보","inhdtl_inhprc":"15,000,000,000","inhdtl_ecpt_vs":"40.2"}', 'h5'),
    ('otcprStkInvscrInhDecsn', 'XP_MIN', 'XP0000000006', '{"iscmp_cmpnm":"협력사(주)","iscmp_rl_cmpn":"-","atinh_eqrt":"4.8","inh_pp":"사업 시너지","inhdtl_inhprc":"5,000,000,000"}', 'h6'),
    ('otcprStkInvscrInhDecsn', 'XP_SUB', 'XP0000000007', '{"iscmp_cmpnm":"자회사(주)","iscmp_rl_cmpn":"자회사","atinh_eqrt":"95","inh_pp":"종속회사에 대한 지배력 강화","inhdtl_inhprc":"5,000,000,000"}', 'h7');
`);
await check('사업 확장: 목적 글로 분류',
  `select string_agg(corp_code || ':' || cat, ',' order by corp_code) from core.v_expansion_events where corp_code like 'XP\\_%'`,
  'XP_CAP:생산·설비 증설,XP_FIN:생산·설비 증설,XP_HQ:연구·업무시설,XP_MIN:소수 지분 투자,XP_MNA:인수·신사업,XP_OLD:생산·설비 증설,XP_PAR:생산·설비 증설,XP_RENT:임대·투자,XP_SUB:계열 지분 정리', one);
await check('사업 확장: 정정은 최신 금액, 결정일은 최초 공시, 1년 지난 결정 제외, 정정본만 있으면 진행 중 표시',
  `select string_agg(corp_code || '|' || amount_krw::bigint || '|' || (current_date - decided_dt) || '|' || is_amendment, ',' order by corp_code) from core.v_expansion_events where corp_code in ('XP_CAP', 'XP_OLD')`,
  'XP_CAP|60000000000|40|false,XP_OLD|7000000000|50|true', one);
await check('사업 확장: 화면 목록은 확장만, 지주사 중복·금융사 제외, 자금 조달 문구',
  `select string_agg(corp_code || coalesce(':' || funding_note, ''), ',' order by corp_code) from mart.v_expansion_events where corp_code like 'XP\\_%'`,
  'XP_CAP,XP_HQ:자기자금 및 차입,XP_MNA,XP_OLD', one);
await check('사업 확장: 회사별 묶음과 결정 후 조달 없음',
  `select string_agg(corp_code || ':' || event_count || ':' || no_funding_after || ':' || has_new_decision, ',' order by corp_code) from mart.v_expansion_companies where corp_code like 'XP\\_%'`,
  'XP_CAP:1:true:true,XP_HQ:1:true:true,XP_MNA:1:true:true,XP_OLD:1:true:false', one);

// 7. 권한 (화면 = anon 은 mart 만) --------------------------------------
await db.exec('set role anon');
await check('anon: mart 뷰 조회 가능', `select count(*)::int from mart.v_deals`, 17, one);
await check('anon: mart 함수 실행 가능',
  `select count(*)::int from mart.similar_deals('bond:FX_ELAND:108')`, 14, one);
await check('anon: 지표 정의 조회 가능', `select count(*)::int from mart.v_metric_catalog`, 18, one);
{
  // 모든 mart 뷰를 anon 으로 읽을 수 있어야 한다 (뷰 안에서 부르는 함수가 ref·core 를 읽으면 권한 오류)
  await db.exec('reset role');
  const views = (await db.query(`select table_name from information_schema.views where table_schema = 'mart' order by 1`)).rows.map((r) => r.table_name);
  await db.exec('set role anon');
  const failedViews = [];
  for (const v of views) {
    try { await db.query(`select * from mart.${v} limit 1`); } catch (e) { failedViews.push(`${v}: ${e.message}`); }
  }
  try { await db.query(`select * from mart.insight_facts() limit 1`); } catch (e) { failedViews.push(`insight_facts: ${e.message}`); }
  results.push({ name: `anon: mart 뷰 ${views.length}개 모두 조회 가능`, ok: failedViews.length === 0, actual: failedViews, expected: [] });
}
await check('anon: core 직접 조회 불가', `select count(*) from core.deals`, 'permission denied',
  () => 'allowed');
results[results.length - 1].ok = String(results[results.length - 1].actual).includes('permission denied');
if (results[results.length - 1].ok) failed--;

// 8. 피드백: anon 은 보내기만, 읽기는 불가 --------------------------------
await check('피드백: anon 이 보낼 수 있음',
  `select mart.submit_feedback('improve', '  만기 화면에 풋 금액도 보여 주세요  ', '인더스트리1부', '/maturities', 'c1', '1280x800') > 0`, true, one);
await check('피드백: 잘못된 유형은 거절', `select mart.submit_feedback('spam', '내용입니다')`, 'ERROR: invalid kind');
await check('피드백: 같은 브라우저 1분 3건 제한',
  `select mart.submit_feedback('etc', 'a2', null, null, 'c1'), mart.submit_feedback('etc', 'a3', null, null, 'c1'), mart.submit_feedback('etc', 'a4', null, null, 'c1')`,
  'ERROR: too many');
await check('피드백: anon 은 저장된 피드백을 읽지 못함', `select count(*) from ops.feedback`, 'permission denied', () => 'allowed');
results[results.length - 1].ok = String(results[results.length - 1].actual).includes('permission denied');
if (results[results.length - 1].ok) failed--;
await db.exec('reset role');
await check('피드백: 앞뒤 공백 정리·한국 시간 보기',
  `select kind_label || '|' || body || '|' || author || '|' || page from ops.v_feedback where client_id = 'c1' and kind_label = '개선 의견'`,
  '개선 의견|만기 화면에 풋 금액도 보여 주세요|인더스트리1부|/maturities', one);

// 결과 출력 -------------------------------------------------------------
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${r.name}`);
  if (!r.ok) console.log(`      expected: ${JSON.stringify(r.expected)}\n      actual:   ${JSON.stringify(r.actual)}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

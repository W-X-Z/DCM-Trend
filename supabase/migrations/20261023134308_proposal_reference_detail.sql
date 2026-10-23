-- 제안서 상세 참고 데이터 (공개 자료, 출처 URL 포함. 값은 출처 페이지에서 확인한 것만)
--   ref.policy_meetings.panels   회의 장표 아래 표·분포: FOMC 9월 SEP·점도표, 한은 8월 경제전망·점도표
--   ref.policy_rate_history      한·미 정책금리 변경 이력(2019~) → 금리 동향 차트
--   ref.research_notes           하우스 최근 의견(주제별 요약, 원문 인용 아님) → 금리 전망 장표
--   ref.research_forecasts       NH 5/28 전망표의 미국 기준금리·미국채 10년 행 추가
--   ref.market_events            한·미 소비자물가 발표일(일정 장표 달력)

alter table ref.policy_meetings add column if not exists panels jsonb not null default '[]'::jsonb;

update ref.policy_meetings set panels = $j$[
  {"kind":"table","title":"9월 SEP 주요 전망 (중간값, %)","columns":["구분","2026","2027","2028","장기"],
   "rows":[
     {"label":"실질 GDP 성장률","cells":["2.3 (2.2)","2.4 (2.3)","2.2 (2.2)","2.0 (2.0)"]},
     {"label":"실업률","cells":["4.1 (4.3)","4.1 (4.3)","4.1 (4.2)","4.2 (4.2)"]},
     {"label":"PCE 물가","cells":["3.7 (3.6)","2.3 (2.3)","2.1 (2.0)","2.0 (2.0)"]},
     {"label":"근원 PCE 물가","cells":["3.4 (3.3)","2.5 (2.5)","2.2 (2.1)","–"]},
     {"label":"연방기금금리","cells":["4.1 (3.8)","4.1 (3.6)","3.9 (3.4)","3.2 (3.1)"]}],
   "note":"괄호는 6월 전망. 자료: Federal Reserve, Summary of Economic Projections(2026.9.16)"},
  {"kind":"dots","title":"9월 점도표 분포 (명, 연말 목표범위 중간값)","groups":["2026년 말","2027년 말","2028년 말"],
   "levels":[
     {"rate":"4.375","counts":[4,8,0]},{"rate":"4.125","counts":[12,6,4]},{"rate":"3.875","counts":[2,0,5]},
     {"rate":"3.625","counts":[0,3,3]},{"rate":"3.375","counts":[0,0,1]},{"rate":"3.125","counts":[0,1,4]}],
   "note":"중간값 2026·2027년 4.1%, 2028년 3.9%. 자료: Federal Reserve(2026.9.16)"}
]$j$::jsonb
where kind = 'FOMC' and meeting_dt = '2026-09-16';

update ref.policy_meetings set panels = $j$[
  {"kind":"table","title":"한국은행 8월 경제전망 (%)","columns":["구분","2026","2027","10월 평가"],
   "rows":[
     {"label":"GDP 성장률","cells":["3.3","2.9","두 해 모두 상당폭 상회"]},
     {"label":"소비자물가","cells":["2.7","2.3","올해 부합, 내년 상회"]},
     {"label":"근원물가","cells":["2.5","2.5","올해 부합, 내년 상회"]}],
   "note":"5월 전망 GDP 2.6·2.1%, 근원물가 2.4·2.3%. 수정 전망은 11/26 공표. 자료: 한국은행 통화정책방향(2026.8.27, 10.22)"},
  {"kind":"dots","title":"금통위 점도표 (6개월 후 기준금리, 점 21개)","groups":["8월","5월"],
   "levels":[
     {"rate":"3.50","counts":[6,0]},{"rate":"3.25","counts":[10,2]},{"rate":"3.00","counts":[5,10]},
     {"rate":"2.75","counts":[0,7]},{"rate":"2.50","counts":[0,2]}],
   "note":"중간값 8월 3.25%, 5월 3.00%. 10월은 미공표(2·5·8·11월 공표). 자료: 한국은행 발표 보도(헤럴드경제·SBS Biz 2026.8.27, 경향신문 2026.5.28)"}
]$j$::jsonb
where kind = '금통위' and meeting_dt = '2026-10-22';

-- 한·미 정책금리 이력 -----------------------------------------------------------
create table if not exists ref.policy_rate_history (
  country      text not null check (country in ('KR', 'US')),
  effective_dt date not null,
  rate_low     numeric not null,
  rate_high    numeric not null,
  source_url   text,
  primary key (country, effective_dt)
);
comment on table ref.policy_rate_history is '한국은행 기준금리·미 연준 목표범위 변경 이력(차트용). 한국은 결정일, 미국은 적용일';

insert into ref.policy_rate_history (country, effective_dt, rate_low, rate_high, source_url) values
  ('KR', '2019-01-01', 1.75, 1.75, 'https://m.dailian.co.kr/news/view/811608'),
  ('KR', '2019-07-18', 1.50, 1.50, 'https://m.dailian.co.kr/news/view/811608'),
  ('KR', '2019-10-16', 1.25, 1.25, 'https://www.newsis.com/view/NISX20191016_0000800169'),
  ('KR', '2020-03-17', 0.75, 0.75, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10057026&menuNo=400069'),
  ('KR', '2020-05-28', 0.50, 0.50, 'https://kbmaeil.com/article/202005280279610'),
  ('KR', '2021-08-26', 0.75, 0.75, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10066202&menuNo=400069'),
  ('KR', '2021-11-25', 1.00, 1.00, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10067647&menuNo=400069'),
  ('KR', '2022-01-14', 1.25, 1.25, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10068514&menuNo=400069'),
  ('KR', '2022-04-14', 1.50, 1.50, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10070041&menuNo=400069'),
  ('KR', '2022-05-26', 1.75, 1.75, 'https://www.bok.or.kr/eng/bbs/E0000627/view.do?nttId=10070767&menuNo=400022&pageIndex=1'),
  ('KR', '2022-07-13', 2.25, 2.25, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10071641&menuNo=400069'),
  ('KR', '2022-08-25', 2.50, 2.50, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10072397&menuNo=400069'),
  ('KR', '2022-10-12', 3.00, 3.00, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10073229&menuNo=400069'),
  ('KR', '2022-11-24', 3.25, 3.25, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10074009&menuNo=400069'),
  ('KR', '2023-01-13', 3.50, 3.50, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10074985&menuNo=400069&pageIndex=1'),
  ('KR', '2024-10-11', 3.25, 3.25, 'https://www.bok.or.kr/eng/bbs/E0000627/view.do?nttId=10087411&menuNo=400022'),
  ('KR', '2024-11-28', 3.00, 3.00, 'https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=10088272&menuNo=400423'),
  ('KR', '2025-02-25', 2.75, 2.75, 'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=10089951&menuNo=200690&programType=newsData'),
  ('KR', '2025-05-29', 2.50, 2.50, 'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=10091639&menuNo=200690&programType=newsData'),
  ('KR', '2026-07-16', 2.75, 2.75, 'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=11062942&menuNo=200690&programType=newsData'),
  ('KR', '2026-08-27', 3.00, 3.00, 'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=11064191&menuNo=200690&programType=newsData&relate=Y&depth=200690'),
  ('US', '2018-12-20', 2.25, 2.50, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2019-08-01', 2.00, 2.25, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2019-09-19', 1.75, 2.00, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2019-10-31', 1.50, 1.75, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2020-03-04', 1.00, 1.25, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2020-03-16', 0.00, 0.25, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2022-03-17', 0.25, 0.50, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2022-05-05', 0.75, 1.00, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2022-06-16', 1.50, 1.75, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2022-07-28', 2.25, 2.50, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2022-09-22', 3.00, 3.25, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2022-11-03', 3.75, 4.00, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2022-12-15', 4.25, 4.50, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2023-02-02', 4.50, 4.75, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2023-03-23', 4.75, 5.00, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2023-05-04', 5.00, 5.25, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2023-07-27', 5.25, 5.50, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2024-09-19', 4.75, 5.00, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2024-11-08', 4.50, 4.75, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2024-12-19', 4.25, 4.50, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2025-09-18', 4.00, 4.25, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2025-10-30', 3.75, 4.00, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2025-12-11', 3.50, 3.75, 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
  ('US', '2026-09-17', 3.75, 4.00, 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm')
on conflict (country, effective_dt) do nothing;

-- 하우스 최근 의견 ----------------------------------------------------------------
create table if not exists ref.research_notes (
  note_id      int generated always as identity primary key,
  house        text not null,
  topic        text not null,         -- 미국 기준금리 / 한국 기준금리 / 국고채 / 우량 회사채 / 비우량 회사채
  text         text not null,         -- 요약 (원문 인용 아님)
  published_dt date not null,
  source_title text not null,
  source_url   text not null,
  collected_dt date not null default current_date
);
comment on table ref.research_notes is '리서치 하우스의 주제별 최근 의견 요약 (공개 리포트·보도, 출처 URL)';

insert into ref.research_notes (house, topic, text, published_dt, source_title, source_url) values
  ('NH투자증권', '미국 기준금리', '10월 동결 후 12월 한 차례 추가 인상, 이후 동결 경로 제시. 4분기 중 2027년 인상 우려는 완화될 것으로 보고 미국채 10년 상단을 5.3~5.6%로 제시',
   '2026-10-01', '파이낸셜뉴스 The Market Feared 3.75%, but the BOK Will Stop at 3.50% (NH 채권 월간 10월: 복합위기와 트리거)', 'https://en.fnnews.com/news/202610020853232919'),
  ('NH투자증권', '한국 기준금리', '10월 동결은 인상 종료가 아닌 쉼표로 해석. 11월 3.25%, 2027년 2월 3.50%를 끝으로 인상 사이클 종료(최종금리 3.50% 유지). 7·8월 인상 효과는 9~12개월 시차를 두고 2027년 2분기부터 반영',
   '2026-10-22', '한국금융신문 증권가 금리 동결에도 추가인상 방향 유지…최종금리 3.5% 전망 우세', 'https://www.fntimes.com/html/view.php?ud=202610221419059181179ad43907_18'),
  ('NH투자증권', '국고채', '당분간 국고채는 미국 금리와 동조화. 인상 부담은 2027년 1분기 말~2분기 초에 정점을 지나고, 2분기 이후 인상 사이클 마무리 국면 진입',
   '2026-10-01', '파이낸셜뉴스 The Market Feared 3.75%, but the BOK Will Stop at 3.50% (NH 채권 월간 10월: 복합위기와 트리거)', 'https://en.fnnews.com/news/202610020853232919'),
  ('NH투자증권', '우량 회사채', '금리 레벨 상승으로 캐리 수요가 우량물에 유입. 회사채 순상환 지속과 발행어음·IMA 자금이 수요를 지지하며, 국고채 금리 안정 시 스프레드 축소 여지',
   '2026-06-01', 'NH투자증권 2026 하반기 전망 FICC 크레딧 (최성종·김준수·이세현)', 'https://feat.page/nhsec/ficc-credit-2026-h2'),
  ('NH투자증권', '비우량 회사채', 'BBB+ 이하는 발행사별 유동성 대응 점검 필요, 가격 조건에 따른 수요 차별화. 2년 이하 만기 위주로 보유하고 국고채 금리 하락 확인 후 듀레이션 확대',
   '2026-06-01', 'NH투자증권 2026 하반기 전망 FICC 크레딧 (최성종·김준수·이세현)', 'https://feat.page/nhsec/ficc-credit-2026-h2');

-- NH 5/28 전망표 행 추가 (같은 표의 미국 기준금리·미국채 10년) ----------------------
insert into ref.research_forecasts (house, published_dt, source_title, source_url, series_key, series_label, period, period_order, basis, is_actual, value_pct)
select f.house, f.published_dt, f.source_title, f.source_url, x.series_key, x.series_label, x.period, x.period_order, x.basis, x.period_order = 1, x.value_pct
from (select distinct house, published_dt, source_title, source_url from ref.research_forecasts where house = 'NH투자증권' and published_dt = '2026-05-28') f
cross join (values
  ('us_policy', '미국 기준금리', '1Q26', 1, '기말', 3.75), ('us_policy', '미국 기준금리', '2Q26', 2, '기말', 3.75), ('us_policy', '미국 기준금리', '3Q26', 3, '기말', 3.75),
  ('us_policy', '미국 기준금리', '4Q26', 4, '기말', 3.50), ('us_policy', '미국 기준금리', '2026', 5, '기말', 3.50), ('us_policy', '미국 기준금리', '2027', 6, '기말', 3.25),
  ('us_policy', '미국 기준금리', '2028', 7, '기말', 3.25),
  ('ust10y', '미국채 10년', '1Q26', 1, '평균', 4.19), ('ust10y', '미국채 10년', '2Q26', 2, '평균', 4.60), ('ust10y', '미국채 10년', '3Q26', 3, '평균', 4.40),
  ('ust10y', '미국채 10년', '4Q26', 4, '평균', 4.30), ('ust10y', '미국채 10년', '2026', 5, '평균', 4.37), ('ust10y', '미국채 10년', '2027', 6, '평균', 4.08),
  ('ust10y', '미국채 10년', '2028', 7, '평균', 4.00)
) as x(series_key, series_label, period, period_order, basis, value_pct)
where not exists (select 1 from ref.research_forecasts r where r.house = f.house and r.published_dt = f.published_dt and r.series_key = x.series_key);

-- 소비자물가 발표일 ---------------------------------------------------------------
alter table ref.market_events drop constraint if exists market_events_kind_check;
alter table ref.market_events add constraint market_events_kind_check check (kind in ('금통위', 'FOMC', '정기보고서', 'CPI'));
insert into ref.market_events (event_dt, kind, title, note, source_url) values
  ('2026-11-03', 'CPI', '韓 10월 소비자물가 발표', '국가데이터처', 'https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1060'),
  ('2026-12-02', 'CPI', '韓 11월 소비자물가 발표', '국가데이터처', 'https://mods.go.kr/boardDownload.es?bid=213&list_no=446338&seq=2'),
  ('2026-12-31', 'CPI', '韓 12월 소비자물가 발표', '국가데이터처', 'https://mods.go.kr/boardDownload.es?bid=213&list_no=446338&seq=2'),
  ('2026-11-10', 'CPI', '美 10월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2026-12-10', 'CPI', '美 11월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-01-13', 'CPI', '美 12월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-02-11', 'CPI', '美 1월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-03-10', 'CPI', '美 2월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-04-13', 'CPI', '美 3월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-05-12', 'CPI', '美 4월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-06-10', 'CPI', '美 5월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-07-14', 'CPI', '美 6월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-08-11', 'CPI', '美 7월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm'),
  ('2027-09-14', 'CPI', '美 8월 CPI 발표', 'BLS, 미국 시간', 'https://www.bls.gov/schedule/news_release/cpi.htm');

-- 화면용 ----------------------------------------------------------------------------
create or replace view mart.v_policy_meetings as
select kind, meeting_dt, title, decision, vote, points, sources, panels from ref.policy_meetings;

create or replace view mart.v_policy_rate_history as
select country, effective_dt, rate_low, rate_high from ref.policy_rate_history;

create or replace view mart.v_research_notes as
select house, topic, text, published_dt, source_title, source_url from ref.research_notes;

grant select on mart.v_policy_meetings, mart.v_policy_rate_history, mart.v_research_notes to anon, authenticated;

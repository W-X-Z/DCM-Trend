-- 제안서 'II-1 금리 동향 및 전망' 장표용 참고 데이터 (공개 자료, 출처 URL 포함)
--   ref.policy_meetings   금통위·FOMC 직전 회의 핵심 포인트 (결정문·기자회견·언론 보도 요약, 원문 인용 아님)
--   ref.research_views    region(KR/US)·연말 정책금리 전망 칸 추가 → 증권사별 미국 기준금리 전망
-- 값은 사람이 출처를 확인해 넣는다. 회의가 새로 열리면 같은 (kind, meeting_dt) 를 새로 넣고 지난 회의는 그대로 둔다.

create table ref.policy_meetings (
  kind        text not null check (kind in ('금통위', 'FOMC')),
  meeting_dt  date not null,                -- FOMC 는 결과 발표일(이틀째)
  title       text not null,
  decision    text not null,                -- 예: '동결 (연 3.00%)'
  vote        text,
  points      jsonb not null,               -- [{label, text}]
  sources     jsonb not null,               -- [{title, url, date}]
  collected_dt date not null default current_date,
  primary key (kind, meeting_dt)
);
comment on table ref.policy_meetings is '금통위·FOMC 회의 핵심 포인트 요약 (공개 결정문·보도, 출처 URL)';

alter table ref.research_views
  add column region       text not null default 'KR' check (region in ('KR', 'US')),
  add column end_2026_pct numeric,          -- 2026년 말 정책금리 (US 는 연방기금금리 상단)
  add column end_2027_pct numeric;

insert into ref.policy_meetings (kind, meeting_dt, title, decision, vote, points, sources) values
('금통위', '2026-10-22', '10월 통화정책방향 결정회의', '동결 (연 3.00%)', '만장일치 (위원 7인 전원 동결)',
 '[
   {"label":"결정","text":"기준금리 연 3.00% 동결. 7월(2.75%)·8월(3.00%) 연속 25bp 인상 후 첫 동결이며 위원 7인 전원 찬성"},
   {"label":"정책방향","text":"추가 인상 시기는 3분기 GDP·10월 물가 등 지표와 두 차례 인상의 효과를 점검해 결정"},
   {"label":"총재 발언","text":"물가가 목표에 수렴한다는 확신이 들 때까지 대응. 만장일치 동결을 긴축 기조 변화로 해석하지 말 것을 강조"},
   {"label":"성장·물가","text":"올해·내년 성장률은 8월 전망(3.3%·2.9%)을 웃돌 것으로 평가. 물가는 올해 8월 전망(2.7%)에 대체로 부합, 내년은 전망(2.3%) 상회"},
   {"label":"주택·환율","text":"주택관련대출 증가 지속, 서울 중저가·경기 일부 지역 집값 오름세 재확대. 원화는 경상흑자 등으로 큰 폭 강세"},
   {"label":"점도표","text":"10월은 미공표(2·5·8·11월 공표). 8월 6개월 후 중간값 3.25%. 수정 경제전망·점도표는 11/26 회의에서 공표"}
 ]'::jsonb,
 '[
   {"title":"한국은행 통화정책방향 결정 (Monetary Policy Decision)","url":"https://www.bok.or.kr/eng/bbs/E0000634/view.do?nttId=11065825&menuNo=400423&relate=Y&depth=400423&programType=newsDataEng","date":"2026-10-22"},
   {"title":"뉴스핌 [종합] 한은 3.00% 동결에도 긴축 유지","url":"https://www.newspim.com/news/view/20261022000954","date":"2026-10-22"},
   {"title":"헤럴드경제 매파적 동결 택한 한은","url":"https://biz.heraldcorp.com/article/10911206","date":"2026-10-22"}
 ]'::jsonb),
('FOMC', '2026-09-16', '9월 FOMC', '25bp 인상 (3.75~4.00%)', '12-0 만장일치',
 '[
   {"label":"결정","text":"연방기금금리 목표범위 25bp 인상, 3.75~4.00%. 2023년 이후 첫 인상이며 12명 전원 찬성"},
   {"label":"성명서","text":"경제활동은 견조하게 확장, 인플레이션은 여전히 높음. 2% 목표로의 보다 신속한 복귀를 인상 근거로 제시"},
   {"label":"점도표","text":"2026·2027년 말 중간값 4.1%로 연내 1회 추가 인상 시사. 18명 중 16명이 연내 추가 인상 예상, 6월보다 경로 상향"},
   {"label":"기자회견","text":"워시 의장, 이번 인상은 완화 정도를 일부 거둬낸 것이며 금융여건을 긴축적으로 보기 어렵다고 언급. 향후 결정은 예단하지 않음"},
   {"label":"의사록(10/7)","text":"대부분 참석자가 연말까지 한 차례 추가 인상이 적절할 가능성이 높다고 평가. 인상의 성격(보험성·전망 기반)에는 이견"},
   {"label":"경제전망","text":"2026년 성장률 2.3%(6월 2.2%), 실업률 4.1%(6월 4.3%), PCE 물가 3.7%·근원 3.4%"}
 ]'::jsonb,
 '[
   {"title":"Federal Reserve FOMC statement","url":"https://www.federalreserve.gov/monetarypolicy/files/monetary20260916a1.pdf","date":"2026-09-16"},
   {"title":"FOMC Summary of Economic Projections","url":"https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm","date":"2026-09-16"},
   {"title":"한국경제 9월 FOMC 의사록","url":"https://www.hankyung.com/article/202610089590i","date":"2026-10-08"}
 ]'::jsonb);

-- 증권사별 미국 기준금리 전망 (기사 요약, 원문 인용 아님). 연말 금리는 기사에 수준이 나온 경우만(목표범위 상단).
insert into ref.research_views (house, analysts, published_dt, source_kind, source_title, source_url, stance, next_move, terminal_rate_pct, summary, region, end_2026_pct, end_2027_pct) values
  ('NH투자증권', '강승원', '2026-09-17', '기사', '이투데이 연준 인상은 끝 아닌 시작…원화채도 당분간 베어 플랫', 'https://www.etoday.co.kr/news/view/2626639',
   '동결', '연내 동결', null, '9월 인상은 본격적인 긴축 사이클 진입을 피하려는 선제 대응으로 평가. 연내 추가 인상 없이 동결 전망', 'US', null, null),
  ('하나증권', '박준우', '2026-09-17', '기사', '이투데이 연준 인상은 끝 아닌 시작…원화채도 당분간 베어 플랫', 'https://www.etoday.co.kr/news/view/2626639',
   '인상', '12월·내년 3월 인상', 4.50, '일회성 조정이 아닌 인상 사이클 시작으로 판단. 12월과 내년 3월 추가 인상, 최종 4.50% 전망', 'US', null, null),
  ('신영증권', '조용구', '2026-09-17', '기사', '이투데이 연준 인상은 끝 아닌 시작…원화채도 당분간 베어 플랫', 'https://www.etoday.co.kr/news/view/2626639',
   '인상', '10월 인상 가능', 4.25, '고유가를 감안해 10월 인상 가능성을 높게 봄. 최종금리 4.25%가 기본, 내년 1분기 4.50% 위험', 'US', null, null),
  ('메리츠증권', '윤여삼', '2026-09-17', '기사', '이투데이 연준 인상은 끝 아닌 시작…원화채도 당분간 베어 플랫', 'https://www.etoday.co.kr/news/view/2626639',
   '인상', '12월 인상', null, '이번 인상은 불확실성 해소가 아닌 긴축의 시작으로 평가. 12월 추가 인상 예상', 'US', null, null),
  ('신한투자증권', '김찬희', '2026-09-17', '기사', '이투데이 연준 인상은 끝 아닌 시작…원화채도 당분간 베어 플랫', 'https://www.etoday.co.kr/news/view/2626639',
   '동결', '연내 동결', null, '유가 120달러 상회나 기대인플레이션·장기금리 불안이 없으면 연내 동결 전망', 'US', null, null),
  ('현대차증권', '최제민', '2026-10-15', '기사', '파이낸셜뉴스(뉴시스) 韓증시 때린 美 물가 쇼크…증권가 금리 추가 인상', 'https://www.fnnews.com/news/202610150955427353',
   '인상', '12월 인상', null, '12월 인상 후 내년 1회 추가 인상이 기본 시나리오. 서비스 물가 경직성에 10월 인상 가능성도 열어둠', 'US', null, null),
  ('DB금융투자', '박성우', '2026-10-15', '기사', '파이낸셜뉴스(뉴시스) 韓증시 때린 美 물가 쇼크…증권가 금리 추가 인상', 'https://www.fnnews.com/news/202610150955427353',
   '인상', '12월 인상', null, '10월 동결 후 12월 25bp 인상으로 4.00~4.25% 전망. 에너지 가격 불안 지속 시 내년 초 추가 인상 가능', 'US', 4.25, null),
  ('키움증권', '안예하', '2026-10-15', '기사', '파이낸셜뉴스(뉴시스) 韓증시 때린 美 물가 쇼크…증권가 금리 추가 인상', 'https://www.fnnews.com/news/202610150955427353',
   '인상', '12월 인상', null, '12월 인상이 기본. 근원물가 상승세가 이어지면 12월 이후 추가 대응도 불가피', 'US', null, null),
  ('Morgan Stanley', 'Andrew Sheets', '2026-09-18', '기사', 'SBS Biz 모건스탠리 연준, 올해 12월과 내년 3월 추가 인상', 'https://biz.sbs.co.kr/amp/article/20000335557',
   '인상', '12월·내년 3월 인상', 4.50, '12월·내년 3월 각 25bp 인상해 4.25~4.50%에 도달한 뒤 내년 말까지 유지 전망', 'US', null, 4.50);

-- 화면용 ----------------------------------------------------------------------------------
create or replace view mart.v_research_views as
select house, analysts, published_dt, source_kind, source_title, source_url, stance, next_move, terminal_rate_pct, summary,
       region, end_2026_pct, end_2027_pct
from ref.research_views
order by published_dt desc, house;

create or replace view mart.v_policy_meetings as
select kind, meeting_dt, title, decision, vote, points, sources from ref.policy_meetings;

grant select on mart.v_research_views, mart.v_policy_meetings to anon, authenticated;

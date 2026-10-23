-- 제안서 작성용 참고 데이터 (공개 자료, 출처 URL 포함)
--   ref.research_views     증권사 리서치의 기준금리 경로 의견 (기사·리포트 요약, 원문 인용 아님)
--   ref.research_forecasts 리서치 하우스의 분기·연간 금리 전망표 (공개 리포트의 표 값 그대로)
--   ref.market_events      금통위(통화정책방향 결정회의)·FOMC 일정
--   ref.kr_holidays        영업일 계산용 휴일 (관공서 공휴일 + 채권시장 연말 휴장일)
-- 값은 사람이 출처를 확인해 넣고, 갱신 때는 같은 (house, published_dt) 를 지우고 다시 넣는다.

create table ref.research_views (
  view_id           int generated always as identity primary key,
  house             text not null,                  -- 증권사·기관
  analysts          text,
  published_dt      date not null,
  source_kind       text not null check (source_kind in ('기사', '리포트', '세미나')),
  source_title      text not null,
  source_url        text not null,
  stance            text,                           -- 인상 / 동결 / 인하
  next_move         text,                           -- 다음 조정 시점 (예: '11월 인상')
  terminal_rate_pct numeric,                        -- 최종(정점) 기준금리
  summary           text not null,                  -- 의견 요약 (원문 문장 인용 아님)
  collected_dt      date not null default current_date
);
comment on table ref.research_views is '증권사 리서치의 기준금리 경로 의견 요약 (공개 기사·리포트, 출처 URL)';

create table ref.research_forecasts (
  house         text not null,
  published_dt  date not null,
  source_title  text not null,
  source_url    text not null,
  series_key    text not null,                      -- base_rate / ktb3y / ktb10y / corp3y_aa / corp3y_bbb ...
  series_label  text not null,
  period        text not null,                      -- 1Q26 / 2026 / 2027 ...
  period_order  int  not null,
  basis         text not null check (basis in ('기말', '평균')),
  is_actual     boolean not null default false,     -- 표에서 실적(전망 아님)으로 표시된 칸
  value_pct     numeric not null,
  primary key (house, published_dt, series_key, period)
);
comment on table ref.research_forecasts is '공개 리서치 리포트의 금리 전망표 값 (표에 적힌 그대로)';

create table ref.market_events (
  event_dt    date not null,
  end_dt      date,
  kind        text not null check (kind in ('금통위', 'FOMC', '정기보고서')),
  title       text not null,
  note        text,
  source_url  text,
  primary key (event_dt, kind)
);
comment on table ref.market_events is '발행 일정에 영향을 주는 이벤트 (금통위 금리결정회의, FOMC, 정기보고서 제출기한)';

create table ref.kr_holidays (
  dt          date primary key,
  name        text not null,
  source_url  text
);
comment on table ref.kr_holidays is '영업일 계산용 휴일. 주말은 따로 계산';

-- 증권사 의견: 2026-10-22 금통위(3.00% 만장일치 동결) 직후·직전 -----------------------------
insert into ref.research_views (house, analysts, published_dt, source_kind, source_title, source_url, stance, next_move, terminal_rate_pct, summary) values
  ('NH투자증권', '강승원·김민수', '2026-10-22', '기사', '증권가 "금리 동결에도 추가인상 방향 유지…최종금리 3.5% 전망 우세" (한국금융신문)',
   'https://www.fntimes.com/html/view.php?ud=202610221419059181179ad43907_18', '인상', '11월·내년 2월 인상', 3.50,
   '인상 속도는 늦춰졌지만 총재가 추가 인상을 강하게 시사. 내년 2월을 마지막 인상으로 보고 최종금리 3.50% 유지'),
  ('iM증권', '김명실', '2026-10-22', '기사', '증권가 "금리 동결에도 추가인상 방향 유지…최종금리 3.5% 전망 우세" (한국금융신문)',
   'https://www.fntimes.com/html/view.php?ud=202610221419059181179ad43907_18', '인상', '11월·내년 1분기 인상', 3.50,
   '만장일치 동결에도 성장·물가 판단이 강해져 인상 방향 유지. 내년 1분기까지 3.5% 경로'),
  ('한화투자증권', '김성수', '2026-10-22', '기사', '증권가 "금리 동결에도 추가인상 방향 유지…최종금리 3.5% 전망 우세" (한국금융신문)',
   'https://www.fntimes.com/html/view.php?ud=202610221419059181179ad43907_18', '인상', '11월·내년 2월 인상', 3.50,
   '수요 측 모멘텀이 강하고 특별한 신호가 없어 시장의 금리 경로 판단은 그대로. 최종금리 3.5% 유지'),
  ('하나증권', '박준우', '2026-10-22', '기사', '증권가 "금리 동결에도 추가인상 방향 유지…최종금리 3.5% 전망 우세" (한국금융신문)',
   'https://www.fntimes.com/html/view.php?ud=202610221419059181179ad43907_18', '인상', '11월·내년 2월 인상', null,
   '성장·물가 전망이 8월보다 모두 상향. 이번 동결은 인상 사이클 안의 속도 조절'),
  ('교보증권', '백윤민', '2026-10-22', '기사', '증권가 "금리 동결에도 추가인상 방향 유지…최종금리 3.5% 전망 우세" (한국금융신문)',
   'https://www.fntimes.com/html/view.php?ud=202610221419059181179ad43907_18', '인상', '11월·내년 1분기 인상', 3.50,
   '긴축 기조 전환이 아닌 속도 조절. 11월 인상을 포함해 최종 3.50% 전망 유지'),
  ('유진투자증권', '김지나', '2026-10-22', '기사', '증권가 "금리 동결에도 추가인상 방향 유지…최종금리 3.5% 전망 우세" (한국금융신문)',
   'https://www.fntimes.com/html/view.php?ud=202610221419059181179ad43907_18', '인상', '11월·내년 1분기 인상', 3.50,
   '11월과 내년 1분기 인상으로 3.5% 도달 전망. 수요 측 물가 압력이 경로를 가를 핵심 지표'),
  ('신영증권', '조용구', '2026-10-18', '기사', '10명 전원 "이달 동결"…11월부터 두 번 더 올려 3.5% 전망 [금통위 폴] (뉴스1·파이낸셜뉴스)',
   'https://www.fnnews.com/news/202610180605279651', '인상', '내년 2월(늦으면 4월) 마지막 인상', 3.50,
   '내년 2월 마지막 인상으로 3.50% 도달 후 2028년 상반기까지 유지 전망'),
  ('LS증권', '우혜영', '2026-10-18', '기사', '10명 전원 "이달 동결"…11월부터 두 번 더 올려 3.5% 전망 [금통위 폴] (뉴스1·파이낸셜뉴스)',
   'https://www.fnnews.com/news/202610180605279651', '인상', null, 3.50,
   '매파적 동결 예상(인상 소수의견 가능). 3.5% 도달 후 2028년 상반기까지 유지'),
  ('KB증권', '임재균', '2026-10-15', '세미나', '"내년 금리 인상 끝날까"···2027년 채권시장 전망 엇갈려 (서울파이낸스, 금융투자협회 글로벌 채권 포럼)',
   'https://www.seoulfn.com/news/articleView.html?idxno=640196', '인상', '12월 마지막 인상', null,
   '12월 인상이 마지막이며 최종금리는 시장 예상(3.50%)보다 낮을 것. 물가 둔화와 수급 개선으로 금리 하락 예상');

-- NH투자증권 리서치 2026 하반기 전망 (2026-05-28) 금리 전망표 ---------------------------------
insert into ref.research_forecasts (house, published_dt, source_title, source_url, series_key, series_label, period, period_order, basis, is_actual, value_pct)
select 'NH투자증권', '2026-05-28', 'NH투자증권 리서치 2026 하반기 전망: 자산배분 (하재석)', 'https://feat.page/nhsec/asset-allocation-2026-h2',
       s.key, s.label, p.period, p.ord, s.basis, p.actual, (s.vals)[p.ord]
from (values
  ('base_rate', '한국 기준금리', '기말', array[2.50, 2.50, 2.75, 3.00, 3.00, 3.00, 3.00]::numeric[]),
  ('ktb3y',     '국고채 3년',   '평균', array[3.20, 3.75, 3.70, 3.65, 3.58, 3.50, 3.30]::numeric[]),
  ('ktb10y',    '국고채 10년',  '평균', array[3.61, 4.25, 4.15, 4.00, 4.00, 3.80, 3.70]::numeric[])
) as s(key, label, basis, vals)
cross join (values ('1Q26', 1, true), ('2Q26', 2, false), ('3Q26', 3, false), ('4Q26', 4, false),
                   ('2026', 5, false), ('2027', 6, false), ('2028', 7, false)) as p(period, ord, actual);

-- 이벤트 ---------------------------------------------------------------------------------
insert into ref.market_events (event_dt, end_dt, kind, title, source_url)
select d::date, null, '금통위', '통화정책방향 결정회의', 'https://www.tossbank.com/articles/baserate2601'
from unnest(array['2026-01-15','2026-02-26','2026-04-10','2026-05-28','2026-07-16','2026-08-27','2026-10-22','2026-11-26']) d;

insert into ref.market_events (event_dt, end_dt, kind, title, note, source_url)
select s::date, e::date, 'FOMC', 'FOMC', n, 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
from (values
  ('2026-01-27','2026-01-28', null), ('2026-03-17','2026-03-18', '경제전망(SEP)'), ('2026-04-28','2026-04-29', null),
  ('2026-06-16','2026-06-17', '경제전망(SEP)'), ('2026-07-28','2026-07-29', null), ('2026-09-15','2026-09-16', '경제전망(SEP)'),
  ('2026-10-27','2026-10-28', null), ('2026-12-08','2026-12-09', '경제전망(SEP)'),
  ('2027-01-26','2027-01-27', '잠정'), ('2027-03-16','2027-03-17', '잠정·경제전망(SEP)'), ('2027-04-27','2027-04-28', '잠정'),
  ('2027-06-08','2027-06-09', '잠정·경제전망(SEP)'), ('2027-07-27','2027-07-28', '잠정'), ('2027-09-14','2027-09-15', '잠정·경제전망(SEP)'),
  ('2027-10-26','2027-10-27', '잠정'), ('2027-12-07','2027-12-08', '잠정·경제전망(SEP)')
) as x(s, e, n);

-- 휴일: 관공서 공휴일(대체공휴일·선거일 포함) + 채권시장 연말 휴장일(12/31) ---------------------------
insert into ref.kr_holidays (dt, name, source_url)
select d::date, n, u
from (values
  ('2026-01-01','신정','https://kholidayz.com/year/2026'), ('2026-02-16','설날 연휴','https://kholidayz.com/year/2026'),
  ('2026-02-17','설날','https://kholidayz.com/year/2026'), ('2026-02-18','설날 연휴','https://kholidayz.com/year/2026'),
  ('2026-03-02','대체공휴일(삼일절)','https://kholidayz.com/year/2026'), ('2026-05-01','근로자의 날','https://kholidayz.com/year/2026'),
  ('2026-05-05','어린이날','https://kholidayz.com/year/2026'), ('2026-05-25','대체공휴일(부처님오신날)','https://kholidayz.com/year/2026'),
  ('2026-06-03','제9회 전국동시지방선거','https://kholidayz.com/year/2026'), ('2026-07-17','제헌절','https://kholidayz.com/year/2026'),
  ('2026-08-17','대체공휴일(광복절)','https://kholidayz.com/year/2026'), ('2026-09-24','추석 연휴','https://kholidayz.com/year/2026'),
  ('2026-09-25','추석','https://kholidayz.com/year/2026'), ('2026-10-05','대체공휴일(개천절)','https://kholidayz.com/year/2026'),
  ('2026-10-09','한글날','https://kholidayz.com/year/2026'), ('2026-12-25','크리스마스','https://kholidayz.com/year/2026'),
  ('2026-12-31','연말 휴장(채권시장)',null),
  ('2027-01-01','신정','https://kholidayz.com/year/2027'), ('2027-02-08','설날 연휴','https://kholidayz.com/year/2027'),
  ('2027-02-09','대체공휴일(설날)','https://kholidayz.com/year/2027'), ('2027-03-01','삼일절','https://kholidayz.com/year/2027'),
  ('2027-05-03','대체공휴일(노동절)','https://kholidayz.com/year/2027'), ('2027-05-05','어린이날','https://kholidayz.com/year/2027'),
  ('2027-05-13','부처님오신날','https://kholidayz.com/year/2027'), ('2027-07-19','대체공휴일(제헌절)','https://kholidayz.com/year/2027'),
  ('2027-08-16','대체공휴일(광복절)','https://kholidayz.com/year/2027'), ('2027-09-14','추석 연휴','https://kholidayz.com/year/2027'),
  ('2027-09-15','추석','https://kholidayz.com/year/2027'), ('2027-09-16','추석 연휴','https://kholidayz.com/year/2027'),
  ('2027-10-04','대체공휴일(개천절)','https://kholidayz.com/year/2027'), ('2027-10-11','대체공휴일(한글날)','https://kholidayz.com/year/2027'),
  ('2027-12-27','대체공휴일(크리스마스)','https://kholidayz.com/year/2027'), ('2027-12-31','연말 휴장(채권시장)',null)
) as h(d, n, u);
-- 주말에 겹친 공휴일(2026-03-01·06-06·08-15·09-26·10-03, 2027-02-06·02-07·05-01·06-06·07-17·08-15·10-03·10-09·12-25)은
-- 영업일 계산에 영향이 없어 넣지 않았다.

-- 정기보고서 제출기한 (사업보고서 3월 말, 분기·반기 45일. 휴일이면 다음 영업일)
insert into ref.market_events (event_dt, kind, title, note)
values ('2026-03-31', '정기보고서', '사업보고서 제출기한', '12월 결산법인'),
       ('2026-05-15', '정기보고서', '1분기보고서 제출기한', null),
       ('2026-08-14', '정기보고서', '반기보고서 제출기한', null),
       ('2026-11-16', '정기보고서', '3분기보고서 제출기한', '11/14 토요일 → 다음 영업일'),
       ('2027-03-31', '정기보고서', '사업보고서 제출기한', '12월 결산법인'),
       ('2027-05-17', '정기보고서', '1분기보고서 제출기한', '5/15 토요일 → 다음 영업일'),
       ('2027-08-17', '정기보고서', '반기보고서 제출기한', '8/14 토요일, 8/16 대체공휴일 → 다음 영업일'),
       ('2027-11-15', '정기보고서', '3분기보고서 제출기한', '11/14 일요일 → 다음 영업일');

-- 화면용 ----------------------------------------------------------------------------------
create or replace view mart.v_research_views as
select house, analysts, published_dt, source_kind, source_title, source_url, stance, next_move, terminal_rate_pct, summary
from ref.research_views
order by published_dt desc, house;

create or replace view mart.v_research_forecasts as
select house, published_dt, source_title, source_url, series_key, series_label, period, period_order, basis, is_actual, value_pct
from ref.research_forecasts;

create or replace view mart.v_market_events as
select event_dt, end_dt, kind, title, note, source_url from ref.market_events;

create or replace view mart.v_kr_holidays as
select dt, name from ref.kr_holidays;

grant select on mart.v_research_views, mart.v_research_forecasts, mart.v_market_events, mart.v_kr_holidays to anon, authenticated;

-- =====================================================================
-- 16. IPO 판정 뷰
--
-- 공시검색·주요정보 API 의 법인구분(corp_cls)은 "조회 시점" 값이라, 이미 상장한 회사의 과거 IPO 를
-- 비상장(E)으로 구분할 수 없다. 대신 "증권신고서(지분증권) 일반공모인데, 같은 회사의 유상증자 결정
-- 주요사항보고서가 앞뒤로 없는 것"을 IPO 로 본다 (상장사 공모 증자는 결정 공시가 반드시 있음).
-- 판정 규칙을 바꾸려면 이 뷰만 고친다 (core.refresh_ipo_deals 는 이 뷰를 읽는다).
-- =====================================================================

create or replace view core.v_ipo_offers as
with stk as (
  select
    a.corp_code, a.rcept_no,
    sum(core.parse_krw(a.item ->> 'slta'))                                         as amount,
    sum(core.parse_numeric(a.item ->> 'stkcnt'))                                   as shares,
    max(core.parse_numeric(a.item ->> 'slprc')) filter (where a.item ->> 'stksen' ~ '보통')  as price,
    max(core.parse_numeric(a.item ->> 'fv'))                                       as fv,
    max(a.item ->> 'corp_cls')                                                     as corp_cls,
    bool_or(coalesce(a.item ->> 'slmthn', '') ~ '공모')                             as is_public
  from raw.api_items a
  where a.endpoint = 'estkRs' and a.group_title = '증권의종류'
  group by a.corp_code, a.rcept_no
)
select
  'ipo:' || s.corp_code || ':' || s.rcept_no                                       as deal_key,
  s.*,
  to_date(left(s.rcept_no, 8), 'YYYYMMDD')                                         as first_dt,
  (select x.item from raw.api_items x
    where x.endpoint = 'estkRs' and x.group_title = '일반사항' and x.rcept_no = s.rcept_no
    order by x.item_id desc limit 1)                                               as gen,
  c.corp_name
from stk s
join core.companies c on c.corp_code = s.corp_code
where s.is_public
  and not exists (
    select 1 from raw.filings f
    where f.corp_code = s.corp_code
      and f.report_nm ~ '유상증자\s*결정'
      and f.rcept_dt between to_date(left(s.rcept_no, 8), 'YYYYMMDD') - 90
                         and to_date(left(s.rcept_no, 8), 'YYYYMMDD') + 30
  );

comment on view core.v_ipo_offers is 'IPO 로 보는 지분증권 공모 (유상증자 결정 공시가 없는 일반공모)';

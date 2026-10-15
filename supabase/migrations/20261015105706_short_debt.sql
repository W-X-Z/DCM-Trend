-- =====================================================================
-- 12. 만기 구간별 차입 잔액 (정기보고서: 회사채·기업어음·단기사채 미상환 잔액)
--
-- raw.api_items 를 바로 읽는 뷰다(변환 테이블 없음). 회사·상품별 가장 최근 보고기간만 쓴다.
-- 응답 형식(2026-10 실측): remndr_exprtn1 = '미상환잔액', remndr_exprtn2 = 공모 / 사모 / 합계
--   회사채: yy1_below, yy1_excess_yy2_below, ... , sm
--   기업어음: de10_below, de10_excess_de30_below, de30_excess_de90_below, de90_excess_de180_below,
--            de180_excess_yy1_below, yy1_excess_yy2_below, yy2_excess_yy3_below, yy3_excess, sm
--   단기사채: de10_below ... de180_excess_yy1_below, sm, isu_lmt(발행한도), remndr_lmt(잔여한도)
-- 금액 단위는 원.
-- =====================================================================

create or replace view mart.v_company_short_debt as
with items as (
  select
    a.corp_code, a.endpoint, a.period_key, a.item,
    coalesce(a.item ->> 'remndr_exprtn2', a.item ->> 'remndr_exprtn1') as scope
  from raw.api_items a
  where a.endpoint in ('cprndNrdmpBlce', 'entrprsBilScritsNrdmpBlce', 'srtpdPsndbtNrdmpBlce')
),
latest as (
  select i.corp_code, i.endpoint, max(i.period_key) as period_key
  from items i
  group by i.corp_code, i.endpoint
),
x as (
  select i.*
  from items i
  join latest l on l.corp_code = i.corp_code and l.endpoint = i.endpoint and l.period_key = i.period_key
),
n as (
  select
    x.corp_code,
    max(x.period_key)                                                                   as period_key,
    max(core.parse_date_kr(x.item ->> 'stlm_dt'))                                        as stlm_dt,
    sum(core.parse_numeric(x.item ->> 'yy1_below'))  filter (where x.endpoint = 'cprndNrdmpBlce' and x.scope ~ '합계') as bond_1y,
    sum(core.parse_numeric(x.item ->> 'yy1_below'))  filter (where x.endpoint = 'cprndNrdmpBlce' and x.scope ~ '사모') as bond_private_1y,
    sum(core.parse_numeric(x.item ->> 'sm'))         filter (where x.endpoint = 'cprndNrdmpBlce' and x.scope ~ '합계') as bond_total,
    sum(coalesce(core.parse_numeric(x.item ->> 'de10_below'), 0)
      + coalesce(core.parse_numeric(x.item ->> 'de10_excess_de30_below'), 0)
      + coalesce(core.parse_numeric(x.item ->> 'de30_excess_de90_below'), 0))
                                                     filter (where x.endpoint = 'entrprsBilScritsNrdmpBlce' and x.scope ~ '합계') as cp_3m,
    sum(coalesce(core.parse_numeric(x.item ->> 'de10_below'), 0)
      + coalesce(core.parse_numeric(x.item ->> 'de10_excess_de30_below'), 0)
      + coalesce(core.parse_numeric(x.item ->> 'de30_excess_de90_below'), 0)
      + coalesce(core.parse_numeric(x.item ->> 'de90_excess_de180_below'), 0)
      + coalesce(core.parse_numeric(x.item ->> 'de180_excess_yy1_below'), 0))
                                                     filter (where x.endpoint = 'entrprsBilScritsNrdmpBlce' and x.scope ~ '합계') as cp_1y,
    sum(core.parse_numeric(x.item ->> 'sm'))         filter (where x.endpoint = 'srtpdPsndbtNrdmpBlce' and x.scope ~ '합계') as stb
  from x
  group by x.corp_code
)
select
  n.corp_code,
  c.corp_name,
  c.market,
  n.period_key,
  n.stlm_dt,
  nullif(n.bond_1y, 0)          as bond_1y_krw,
  nullif(n.bond_private_1y, 0)  as bond_private_1y_krw,
  nullif(n.bond_total, 0)       as bond_total_krw,
  nullif(n.cp_1y, 0)            as cp_1y_krw,
  nullif(n.cp_3m, 0)            as cp_3m_krw,
  nullif(n.stb, 0)              as stb_krw,
  nullif(coalesce(n.bond_1y, 0) + coalesce(n.cp_1y, 0) + coalesce(n.stb, 0), 0) as total_1y_krw,
  (core.map_value('bond_category_corp', c.corp_name) is not null)                as is_financial
from n
join core.companies c on c.corp_code = n.corp_code;

comment on view mart.v_company_short_debt is '최근 정기보고서 기준 1년 안에 만기가 돌아오는 회사채(공모·사모)·CP·단기사채 잔액';

grant select on mart.v_company_short_debt to anon, authenticated;

-- 금융사 구분(is_financial) 컬럼 추가. 원격 이력과 맞추기 위한 파일 (내용은 20261015105706 과 같음)
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
  exists (select 1 from ref.value_maps v
          where v.domain = 'bond_category_corp' and c.corp_name ~ v.pattern)      as is_financial
from n
join core.companies c on c.corp_code = n.corp_code;

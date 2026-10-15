-- 금리 화면은 차단 출처(ref.rate_source_blocklist)의 조사 값을 쓰지 않는다.
-- 행을 지우지 않고 읽는 쪽에서 거른다. 같은 날짜에 다른 출처의 조사 값이 들어오면 그 값으로 바뀐다.
create or replace view core.v_rates_valid as
select r.*
from raw.rates r
where not (r.source = 'research'
           and exists (select 1 from ref.rate_source_blocklist b where r.source_url ~* b.pattern));

create or replace view mart.v_rates_daily as
select r.series_key, s.label_ko, s.grp, r.dt, r.value
from core.v_rates_valid r
join ref.rate_series s on s.series_key = r.series_key
where s.is_active;

create or replace view mart.v_rate_spreads_daily as
select
  x.dt,
  round((x.aa - x.ktb3y) * 100, 1)     as aa_spread_bp,
  round((x.bbb - x.aa) * 100, 1)       as bbb_aa_gap_bp,
  round((x.ktb10y - x.ktb3y) * 100, 1) as term_spread_bp
from (
  select
    r.dt,
    max(r.value) filter (where r.series_key = 'ktb3y')      as ktb3y,
    max(r.value) filter (where r.series_key = 'ktb10y')     as ktb10y,
    max(r.value) filter (where r.series_key = 'corp3y_aa')  as aa,
    max(r.value) filter (where r.series_key = 'corp3y_bbb') as bbb
  from core.v_rates_valid r
  group by r.dt
) x
where x.ktb3y is not null;

create or replace view mart.v_rate_latest as
select
  s.series_key, s.label_ko, s.grp, s.sort_order,
  l.dt, l.value,
  round((l.value - (select r.value from core.v_rates_valid r where r.series_key = s.series_key and r.dt <= l.dt - 7   order by r.dt desc limit 1)) * 100, 1) as chg_1w_bp,
  round((l.value - (select r.value from core.v_rates_valid r where r.series_key = s.series_key and r.dt <= l.dt - 30  order by r.dt desc limit 1)) * 100, 1) as chg_1m_bp,
  round((l.value - (select r.value from core.v_rates_valid r where r.series_key = s.series_key and r.dt <= l.dt - 91  order by r.dt desc limit 1)) * 100, 1) as chg_3m_bp,
  round((l.value - (select r.value from core.v_rates_valid r where r.series_key = s.series_key and r.dt <= l.dt - 365 order by r.dt desc limit 1)) * 100, 1) as chg_1y_bp,
  l.source,
  l.source_url
from ref.rate_series s
cross join lateral (
  select r.dt, r.value, r.source, r.source_url from core.v_rates_valid r where r.series_key = s.series_key order by r.dt desc limit 1
) l
where s.is_active;


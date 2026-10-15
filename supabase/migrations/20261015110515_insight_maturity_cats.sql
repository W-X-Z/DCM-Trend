-- =====================================================================
-- 15. 인사이트: 만기 도래 금액도 회사채 기본 구분(일반회사채)만 집계
-- =====================================================================

create or replace function mart.insight_facts(p_asof date default current_date)
returns table (
  scope text, fact_key text, label_ko text, unit text, compare text,
  value_now numeric, value_base numeric, change numeric,
  period_now text, period_base text, score numeric, is_notable boolean, priority int, rule_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with prm as (
    select
      date_trunc('month', p_asof)::date as m0,
      coalesce((select array_agg(x) from jsonb_array_elements_text(
                 (select value from ref.params where key = 'bond_trend_categories')) x), '{}') as bond_cats
  ),
  win as (
    select 'now'::text as w, (m0 - interval '3 month')::date as s, m0 as e from prm
    union all select 'yoy', (m0 - interval '15 month')::date, (m0 - interval '12 month')::date from prm
    union all select 'trail', (m0 - interval '15 month')::date, (m0 - interval '3 month')::date from prm
  ),
  d as (
    select w.w, v.*
    from mart.v_deals v
    join win w on v.deal_dt >= w.s and v.deal_dt < w.e
    where v.status <> 'withdrawn'
  ),
  m as (
    select 'bond'::text as scope, d.w, jsonb_build_object(
      'bond_amount',         sum(d.amount_krw),
      'bond_count',          count(*),
      'bond_avg_tenor',      avg(d.tenor_months),
      'bond_long_share',     100.0 * count(*) filter (where d.tenor_months >= 60) / nullif(count(d.tenor_months), 0),
      'bond_fee_bp',         sum(d.fee_krw) / nullif(sum(d.uw_amount_krw) filter (where d.fee_krw is not null), 0) * 1e4,
      'bond_nh_lead_share',  100.0 * sum(d.amount_krw) filter (where d.nh_lead) / nullif(sum(d.amount_krw) filter (where d.lead_managers is not null), 0),
      'bond_increase_share', 100.0 * count(*) filter (where d.is_increased) / nullif(count(d.initial_amount_krw), 0),
      'bond_undersub_share', 100.0 * count(*) filter (where d.is_undersubscribed) / nullif(count(d.competition_ratio), 0),
      'bond_avg_spread',     avg(d.final_spread_bp)) as vals
    from d, prm
    where d.product_type = 'bond' and (cardinality(prm.bond_cats) = 0 or d.sub_type = any (prm.bond_cats))
    group by d.w
    union all
    select 'mezz', d.w, jsonb_build_object(
      'mezz_amount',          sum(d.amount_krw),
      'mezz_count',           count(*),
      'mezz_zero_share',      100.0 * count(*) filter (where d.coupon_pct = 0 and d.ytm_pct = 0) / nullif(count(d.ytm_pct), 0),
      'mezz_refix_low_share', 100.0 * count(*) filter (where d.refix_floor_ratio_pct <= 70) / nullif(count(d.refix_floor_ratio_pct), 0),
      'mezz_public_share',    100.0 * count(*) filter (where d.is_public) / nullif(count(d.is_public), 0))
    from d where d.product_type = 'mezz' group by d.w
    union all
    select 'equity', d.w, jsonb_build_object(
      'equity_amount',        sum(d.amount_krw),
      'equity_count',         count(*),
      'equity_third_share',   100.0 * count(*) filter (where d.sub_type = '제3자배정') / nullif(count(*), 0),
      'equity_avg_dilution',  avg(d.dilution_pct),
      'equity_firm_share',    100.0 * count(*) filter (where d.underwriting_method = '총액인수') / nullif(count(d.underwriting_method), 0))
    from d where d.product_type = 'equity' group by d.w
    union all
    select 'ipo', d.w, jsonb_build_object(
      'ipo_amount',           sum(d.amount_krw),
      'ipo_count',            count(*),
      'ipo_secondary_avg',    avg(d.ipo_secondary_pct),
      'ipo_putback_share',    100.0 * count(*) filter (where d.ipo_has_putback) / nullif(count(*), 0),
      'ipo_above_band_share', 100.0 * count(*) filter (where d.ipo_price_vs_band = '상단 초과') / nullif(count(d.ipo_price_vs_band), 0))
    from d where d.product_type = 'ipo' group by d.w
    union all
    select 'maturity', x.w, jsonb_build_object(
      'mat_amount',    sum(x.amount_krw),
      'mat_companies', count(distinct x.corp_code))
    from (
      select case
               when t.event_dt >= (p.m0 + interval '3 month') and t.event_dt < (p.m0 + interval '6 month') then 'now'
               when t.event_dt >= (p.m0 - interval '9 month') and t.event_dt < (p.m0 - interval '6 month') then 'yoy'
             end as w,
             t.amount_krw, t.corp_code
      from mart.v_maturities t, prm p
      where t.product_type = 'bond' and t.event_type = '만기'
        and (cardinality(p.bond_cats) = 0 or t.sub_type = any (p.bond_cats))
    ) x
    where x.w is not null
    group by x.w
  ),
  rt as (
    select
      s.series_key,
      (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= p_asof order by r.dt desc limit 1)      as v_now,
      (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= p_asof - 30 order by r.dt desc limit 1) as v_m1
    from ref.rate_series s
    where s.is_active
  ),
  rates as (
    select 'rates'::text as scope, w.w, jsonb_build_object(
      'base_rate',  max(case w.w when 'now' then v_now else v_m1 end) filter (where series_key = 'base_rate'),
      'ktb3y',      max(case w.w when 'now' then v_now else v_m1 end) filter (where series_key = 'ktb3y'),
      'ktb10y',     max(case w.w when 'now' then v_now else v_m1 end) filter (where series_key = 'ktb10y'),
      'aa_spread',  (max(case w.w when 'now' then v_now else v_m1 end) filter (where series_key = 'corp3y_aa')
                   - max(case w.w when 'now' then v_now else v_m1 end) filter (where series_key = 'ktb3y')) * 100,
      'bbb_spread', (max(case w.w when 'now' then v_now else v_m1 end) filter (where series_key = 'corp3y_bbb')
                   - max(case w.w when 'now' then v_now else v_m1 end) filter (where series_key = 'corp3y_aa')) * 100) as vals
    from rt cross join (values ('now'), ('m1')) as w (w)
    group by w.w
  ),
  long as (
    select x.scope, x.w, kv.key as fact_key, (kv.value)::numeric as value
    from (select * from m union all select * from rates) x
    cross join lateral jsonb_each_text(x.vals) kv
    where kv.value is not null
  ),
  joined as (
    select
      r.scope, r.fact_key, r.label_ko, r.unit, r.compare, r.min_change, r.priority, r.status,
      n.value as v_now,
      case r.compare
        when 'trail' then case when r.unit in ('krw', 'count') then b.value / 4 else b.value end
        else b.value
      end as v_base
    from ref.insight_rules r
    join long n on n.fact_key = r.fact_key and n.w = 'now'
    left join long b on b.fact_key = r.fact_key
                    and b.w = case r.compare when 'yoy' then 'yoy' when 'trail' then 'trail' else 'm1' end
    where r.is_active
  )
  select
    j.scope, j.fact_key, j.label_ko, j.unit, j.compare,
    round(j.v_now, 4), round(j.v_base, 4),
    round(case
      when j.v_base is null then null
      when j.unit in ('krw', 'count') then (j.v_now - j.v_base) / nullif(j.v_base, 0) * 100
      when j.unit = 'rate' then (j.v_now - j.v_base) * 100
      else j.v_now - j.v_base
    end, 2) as change,
    case
      when j.scope = 'maturity' then to_char(p.m0 + interval '3 month', 'YY.MM') || '~' || to_char(p.m0 + interval '5 month', 'YY.MM') || ' 만기'
      when j.compare = 'm1' then '최신'
      else to_char(p.m0 - interval '3 month', 'YY.MM') || '~' || to_char(p.m0 - interval '1 month', 'YY.MM')
    end,
    case
      when j.scope = 'maturity' then '1년 전 같은 시점 기준'
      when j.compare = 'yoy' then to_char(p.m0 - interval '15 month', 'YY.MM') || '~' || to_char(p.m0 - interval '13 month', 'YY.MM')
      when j.compare = 'trail' then '직전 12개월'
      else '1개월 전'
    end,
    round(abs(case
      when j.v_base is null then 0
      when j.unit in ('krw', 'count') then (j.v_now - j.v_base) / nullif(j.v_base, 0) * 100
      when j.unit = 'rate' then (j.v_now - j.v_base) * 100
      else j.v_now - j.v_base
    end) / nullif(j.min_change, 0), 2) as score,
    coalesce(abs(case
      when j.v_base is null then 0
      when j.unit in ('krw', 'count') then (j.v_now - j.v_base) / nullif(j.v_base, 0) * 100
      when j.unit = 'rate' then (j.v_now - j.v_base) * 100
      else j.v_now - j.v_base
    end) >= j.min_change, false) as is_notable,
    j.priority,
    j.status
  from joined j
  cross join prm p
  order by j.scope, j.priority
$$;


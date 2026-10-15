-- 회사채 발행(트랜치 묶음) 단위 뷰
-- v_deals 는 트랜치(회차 22-1, 22-2 …)마다 한 행이다. 같은 회사·같은 본 회차·같은 납입일을 한 발행으로 묶어
-- 트랜치 구성(만기 조합), 최초→확정 금액, 전체 경쟁률을 보여 준다.
create or replace view mart.v_bond_issues as
with t as (
  select
    v.*,
    coalesce(nullif(split_part(v.series, '-', 1), ''), v.deal_key) as base_series,
    case when v.tenor_months is null then null
         else trim_scale(round(v.tenor_months / 12.0, 1))::text || '년' end as tenor_label,
    case
      when v.tenor_months is null then '만기 미상'
      when v.tenor_months < 24 then '2년 미만'
      when v.tenor_months < 36 then '2년'
      when v.tenor_months < 60 then '3년'
      when v.tenor_months < 84 then '5년'
      when v.tenor_months < 120 then '7년'
      else '10년 이상'
    end as tenor_bucket
  from mart.v_deals v
  where v.product_type = 'bond' and v.status <> 'withdrawn'
)
select
  t.corp_code || ':' || t.base_series || ':' || coalesce(t.deal_dt::text, '') as issue_key,
  t.corp_code,
  max(t.corp_name)                                       as corp_name,
  max(t.market)                                          as market,
  max(t.sub_type)                                        as sub_type,
  t.base_series,
  min(t.pricing_dt)                                      as pricing_dt,
  t.deal_dt,
  max(t.rating)                                          as rating,
  max(t.rating_group)                                    as rating_group,
  max(t.rating_notch)                                    as rating_notch,
  count(*)::int                                          as tranche_count,
  sum(t.amount_krw)                                      as amount_krw,
  sum(t.initial_amount_krw)                              as initial_amount_krw,
  sum(t.demand_krw)                                      as demand_krw,
  round(sum(t.demand_krw) / nullif(sum(t.initial_amount_krw) filter (where t.demand_krw is not null), 0), 2) as competition_ratio,
  bool_or(t.is_increased)                                as is_increased,
  round((sum(t.amount_krw) / nullif(sum(t.initial_amount_krw), 0) - 1) * 100, 1) as increase_pct,
  bool_or(t.is_undersubscribed)                          as is_undersubscribed,
  coalesce(string_agg(t.tenor_label, '+' order by t.tenor_months), '만기 미상') as tenor_combo,
  min(t.tenor_months)                                    as tenor_min,
  max(t.tenor_months)                                    as tenor_max,
  min(t.final_spread_bp)                                 as spread_min_bp,
  max(t.final_spread_bp)                                 as spread_max_bp,
  jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'deal_key', t.deal_key, 'series', t.series, 'tenor_months', t.tenor_months, 'tenor_label', t.tenor_label,
    'tenor_bucket', t.tenor_bucket, 'amount_krw', t.amount_krw, 'initial_amount_krw', t.initial_amount_krw,
    'demand_krw', t.demand_krw, 'competition_ratio', t.competition_ratio, 'final_spread_bp', t.final_spread_bp,
    'coupon_pct', t.coupon_pct, 'band_low', t.band_low, 'band_high', t.band_high, 'is_increased', t.is_increased,
    'is_undersubscribed', t.is_undersubscribed, 'lead_managers', t.lead_managers, 'nh_lead', t.nh_lead))
    order by t.tenor_months nulls last, t.series)        as tranches,
  (select string_agg(distinct trim(x), ', ') from unnest(string_to_array(string_agg(t.lead_managers, ','), ',')) x
    where trim(x) <> '')                                 as lead_managers,
  bool_or(t.nh_lead)                                     as nh_lead,
  bool_or(t.nh_involved)                                 as nh_involved,
  max(t.latest_rcept_no)                                 as latest_rcept_no
from t
group by t.corp_code, t.base_series, t.deal_dt;

grant select on mart.v_bond_issues to anon, authenticated;

-- 딜 발굴 데스크: 유사 사례(공모채)를 같은 종류(일반회사채·금융채·신종자본증권)로 좁힌다.
-- 2026-11-22 첫 실행에서 유통 회사(일반회사채)의 유사 사례에 은행·증권사의 신종자본증권·금융채가 섞였다.
create or replace function public.desk_comps(p_corp_code text, p_months integer default 6)
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (
    select o.corp_code, o.market, o.latest_bond_rating, lb.rating_group, lb.sub_type
    from mart.v_company_overview o
    left join lateral (
      select d.rating_group, d.sub_type from mart.v_deals d
      where d.corp_code = o.corp_code and d.product_type = 'bond' and d.rating_group is not null
      order by d.deal_dt desc nulls last limit 1
    ) lb on true
    where o.corp_code = p_corp_code limit 1
  ),
  b as (
    select d.* from mart.v_deals d, me
    where me.rating_group is not null and d.product_type = 'bond' and d.is_public and d.rating_group = me.rating_group
      and d.sub_type is not distinct from me.sub_type
      and d.corp_code <> me.corp_code and d.status <> 'withdrawn'
      and d.deal_dt >= current_date - make_interval(months => p_months) and d.deal_dt <= current_date + 30
    order by d.deal_dt desc limit 12
  ),
  z as (
    select d.* from mart.v_deals d, me
    where me.rating_group is null and d.product_type = 'mezz' and d.market is not distinct from me.market
      and d.corp_code <> me.corp_code and d.status <> 'withdrawn'
      and d.deal_dt >= current_date - make_interval(months => p_months) and d.deal_dt <= current_date
    order by d.deal_dt desc limit 10
  ),
  q as (
    select d.* from mart.v_deals d, me
    where me.rating_group is null and d.product_type = 'equity' and d.market is not distinct from me.market
      and d.corp_code <> me.corp_code and d.status <> 'withdrawn'
      and d.deal_dt >= current_date - make_interval(months => p_months) and d.deal_dt <= current_date
    order by d.deal_dt desc limit 6
  )
  select jsonb_build_object(
    'basis', (select case when rating_group is not null then '같은 등급군(' || rating_group || ') 공모 ' || coalesce(sub_type, '회사채') || ', 최근 ' || p_months || '개월'
                          else '같은 시장(' || coalesce(market, '미상') || ') 메자닌·유상증자, 최근 ' || p_months || '개월' end from me),
    'bonds', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'corp_name', corp_name, 'deal_dt', deal_dt, 'series', series, 'amount_krw', amount_krw, 'rating', rating, 'tenor_months', tenor_months,
        'yield_pct', yield_pct, 'competition_ratio', competition_ratio, 'final_spread_bp', final_spread_bp, 'is_increased', is_increased,
        'lead_managers', lead_managers, 'url', dart_url)) order by deal_dt desc) from b), '[]'::jsonb),
    'mezz', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'corp_name', corp_name, 'deal_dt', deal_dt, 'sub_type', sub_type, 'amount_krw', amount_krw, 'coupon_pct', coupon_pct, 'ytm_pct', ytm_pct,
        'refix_floor_ratio_pct', refix_floor_ratio_pct, 'put_start_dt', put_start_dt, 'dilution_pct', dilution_pct, 'url', dart_url)) order by deal_dt desc) from z), '[]'::jsonb),
    'equity', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'corp_name', corp_name, 'deal_dt', deal_dt, 'sub_type', sub_type, 'amount_krw', amount_krw, 'shares_ratio_pct', shares_ratio_pct,
        'offer_price', offer_price, 'lead_managers', lead_managers, 'url', dart_url)) order by deal_dt desc) from q), '[]'::jsonb)
  )
$$;

revoke execute on function public.desk_comps(text, integer) from public, anon, authenticated;
grant execute on function public.desk_comps(text, integer) to service_role;

-- 제안서 상세 (대한항공 공모사채 제안서 수준)
-- 1) 원문 파서 v4: 수요예측 참여 내역의 투자자 구분별 건수·수량(운용사(집합)·투자매매중개업자·연기금 등·기타·외국),
--    증권신고서의 증액 한도(최대 발행금액) → core.bond_terms.demand_by_type, amount_max_krw
--    (배정 내역은 증권발행실적보고서에도 '기관투자자' 합계만 있어 공시로는 구할 수 없다)
-- 2) 화면용: v_deals·v_bond_issues 에 붙인다. 트랜치 json 에 투자자 구분별 참여, 발행 단위에 증액 한도
-- 3) ECOS 시리즈: 국고채 2년·CP 91일·미국 정책금리(ECOS_API_KEY 가 있으면 일별로 채워짐)

alter table core.bond_terms add column if not exists demand_by_type jsonb;
alter table core.bond_terms add column if not exists amount_max_krw numeric;
comment on column core.bond_terms.demand_by_type is '수요예측 참여 내역 투자자 구분별 [{t: fund|broker|inst|etc|foreign_y|foreign_n, n: 건수, q: 수량(원)}]';
comment on column core.bond_terms.amount_max_krw is '증액 한도: 증권신고서의 최대 발행금액(발행 전체 합계, 원)';

create or replace function core.try_jsonb(p text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  return case when p is null or p = '' then null else p::jsonb end;
exception when others then
  return null;
end
$$;

-- apply_doc_fields: 현재 정의(밴드 단위 수정 포함)에 두 값을 덧붙인다
do $$
declare
  f text := pg_get_functiondef('core.apply_doc_fields()'::regprocedure);
  a1 text := $q$else rtrim(rtrim(to_char(b.tenor_months / 12.0, 'FM990.0'), '0'), '.') end)) as spread$q$;
  a2 text := $q$final_spread_bp   = coalesce(v.spread, b.final_spread_bp)$q$;
begin
  if position(a1 in f) = 0 or position(a2 in f) = 0 then
    raise exception 'apply_doc_fields 에서 덧붙일 위치를 찾지 못함';
  end if;
  f := replace(f, a1, a1 || $q$,
      core.try_jsonb(coalesce(core.deal_doc_value(b.deal_key, 'demand_by_type', d.series), core.deal_doc_value(b.deal_key, 'demand_by_type'))) as by_type,
      core.parse_numeric(core.deal_doc_value(b.deal_key, 'amount_max_krw')) as amount_max$q$);
  f := replace(f, a2, a2 || $q$,
    demand_by_type    = coalesce(v.by_type, b.demand_by_type),
    amount_max_krw    = coalesce(v.amount_max, b.amount_max_krw)$q$);
  execute f;
end
$$;

update ref.document_fetch_rules set parser_version = 4,
       note = note || ' + 투자자 구분별 참여·증액 한도(v4)'
 where purpose = 'bond';

do $$
declare
  v text := pg_get_viewdef('mart.v_deals'::regclass, true);
  anchor text := E'b.demand_dt\n   FROM core.deals d';
begin
  if position(anchor in v) = 0 then
    raise exception 'v_deals 정의에서 덧붙일 위치를 찾지 못함';
  end if;
  v := replace(v, anchor, E'b.demand_dt,\n    b.demand_by_type,\n    b.amount_max_krw\n   FROM core.deals d');
  execute 'create or replace view mart.v_deals as ' || v;
end
$$;

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
    'is_undersubscribed', t.is_undersubscribed, 'lead_managers', t.lead_managers, 'nh_lead', t.nh_lead,
    'demand_in_band_krw', t.demand_in_band_krw, 'demand_count', t.demand_count, 'yield_pct', t.yield_pct, 'band_type', t.band_type,
    'fee_bp', t.fee_bp, 'maturity_dt', t.maturity_dt, 'demand_by_type', t.demand_by_type))
    order by t.tenor_months nulls last, t.series)        as tranches,
  (select string_agg(distinct trim(x), ', ') from unnest(string_to_array(string_agg(t.lead_managers, ','), ',')) x
    where trim(x) <> '')                                 as lead_managers,
  bool_or(t.nh_lead)                                     as nh_lead,
  bool_or(t.nh_involved)                                 as nh_involved,
  max(t.latest_rcept_no)                                 as latest_rcept_no,
  -- 추가 (2026-10-23, 제안서): 수요예측일·유효수요·밴드·수수료
  min(t.demand_dt)                                       as demand_dt,
  sum(t.demand_in_band_krw)                              as demand_in_band_krw,
  max(t.band_type)                                       as band_type,
  min(t.band_low)                                        as band_low,
  max(t.band_high)                                       as band_high,
  round(sum(t.fee_krw) / nullif(sum(t.uw_amount_krw), 0) * 1e4, 1) as fee_bp,
  sum(t.demand_count)::int                               as demand_count,
  min(t.maturity_dt)                                     as maturity_min_dt,
  -- 추가 (2026-10-23, 제안서 상세): 증액 한도(증권신고서)
  max(t.amount_max_krw)                                  as amount_max_krw
from t
group by t.corp_code, t.base_series, t.deal_dt;

grant select on mart.v_bond_issues to anon, authenticated;

insert into ref.rate_series (series_key, stat_code, item_pattern, cycle, label_ko, grp, sort_order) values
  ('ktb2y',     '817Y002', '^국고채\s*\(2년\)',  'D', '국고채 2년',     '국고채', 35),
  ('cp91',      '817Y002', '^CP\s*\(91일\)',     'D', 'CP 91일',        '단기',   25),
  ('us_policy', '902Y006', '^미국',               'M', '미국 정책금리', '정책',   15)
on conflict (series_key) do nothing;

-- =====================================================================
-- 04. mart : 화면이 읽는 뷰·함수
--
-- 화면(web)은 mart 만 조회한다. 뷰 이름과 컬럼은 화면과의 계약이므로
-- 로직을 바꿀 때 컬럼을 지우거나 이름을 바꾸지 않는다(추가는 가능).
-- 기준일(deal_dt) 규칙은 mart.v_deals 한 곳에서만 정의한다.
-- =====================================================================

-- 딜 통합 뷰 -----------------------------------------------------------
create view mart.v_deals as
with uw as (
  select
    u.deal_key,
    string_agg(distinct coalesce(u.firm_std, u.firm_raw), ', ') filter (where u.role = '대표주관') as lead_managers,
    string_agg(distinct coalesce(u.firm_std, u.firm_raw), ', ')                                      as underwriters,
    sum(u.amount_krw)                                                                               as uw_amount_krw,
    sum(u.fee_krw)                                                                                  as fee_krw,
    bool_or(coalesce(f.is_nh, false))                                                               as nh_involved,
    bool_or(coalesce(f.is_nh, false) and u.role = '대표주관')                                        as nh_lead
  from core.deal_underwriters u
  left join ref.firms f on f.firm_std = u.firm_std
  group by u.deal_key
),
prm as (
  select (value #>> '{}')::numeric as undersub_ratio
  from ref.params where key = 'undersubscribed_ratio'
)
select
  d.deal_key,
  d.product_type,
  p.label_ko                                                    as product_label,
  d.sub_type,
  d.corp_code,
  c.corp_name,
  c.market,
  c.stock_code,
  d.series,
  d.is_public,
  d.status,
  d.announce_dt,
  d.pricing_dt,
  d.payment_dt,
  -- 기준일: 회사채는 납입일, 메자닌·유증은 이사회 결정일
  case when d.product_type = 'bond'
       then coalesce(d.payment_dt, d.pricing_dt, d.announce_dt)
       else coalesce(d.announce_dt, d.payment_dt)
  end                                                           as deal_dt,
  d.amount_krw,
  d.initial_amount_krw,
  round(d.amount_krw / 1e8, 1)                                  as amount_eok,
  coalesce(d.amount_krw > d.initial_amount_krw, false)          as is_increased,
  -- 회사채
  b.bond_name,
  b.rating,
  rs.notch                                                      as rating_notch,
  rs.grade_group                                                as rating_group,
  b.tenor_months,
  coalesce(b.maturity_dt, m.maturity_dt)                        as maturity_dt,
  coalesce(b.coupon_pct, m.coupon_pct)                          as coupon_pct,
  b.yield_pct,
  b.band_type,
  b.band_low,
  b.band_high,
  b.demand_krw,
  b.demand_count,
  b.competition_ratio,
  b.final_spread_bp,
  coalesce(b.competition_ratio < prm.undersub_ratio, false)     as is_undersubscribed,
  -- 메자닌
  m.ytm_pct,
  m.conv_price,
  m.refix_floor_price,
  round(m.refix_floor_price / nullif(m.conv_price, 0) * 100, 1) as refix_floor_ratio_pct,
  m.conv_start_dt,
  m.conv_end_dt,
  m.shares_ratio_pct,
  m.articles_remaining_krw,
  -- 유상증자
  e.dilution_pct,
  e.offer_price,
  e.underwriting_method,
  -- 주관·인수
  coalesce(uw.lead_managers, m.lead_manager)                    as lead_managers,
  uw.underwriters,
  uw.uw_amount_krw,
  uw.fee_krw,
  round(uw.fee_krw / nullif(uw.uw_amount_krw, 0) * 1e4, 1)      as fee_bp,
  coalesce(uw.nh_involved, false)                               as nh_involved,
  coalesce(uw.nh_lead, false)                                   as nh_lead,
  d.first_rcept_no,
  d.latest_rcept_no,
  case when d.latest_rcept_no is not null
       then 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' || d.latest_rcept_no
  end                                                           as dart_url
from core.deals d
join ref.products p on p.product_type = d.product_type
join core.companies c on c.corp_code = d.corp_code
left join core.bond_terms b on b.deal_key = d.deal_key
left join ref.rating_scale rs on rs.rating = b.rating
left join core.mezz_terms m on m.deal_key = d.deal_key
left join core.equity_terms e on e.deal_key = d.deal_key
left join uw on uw.deal_key = d.deal_key
left join prm on true;

comment on view mart.v_deals is '모든 상품 딜을 한 줄씩. 화면의 딜 목록·상세의 기준';

-- 유사 딜용 특성 (세로형) ------------------------------------------------
-- 새 특성을 추가하려면 여기 한 줄 + ref.similarity_rules 한 행
create view mart.v_deal_features as
select v.deal_key, v.product_type, f.feature, f.num_value, f.txt_value
from mart.v_deals v
cross join lateral (values
  ('amount_krw',       v.amount_krw,               null::text),
  ('sub_type',         null::numeric,              v.sub_type),
  ('market',           null,                       v.market),
  ('is_public',        null,                       v.is_public::text),
  ('rating_notch',     v.rating_notch::numeric,    null),
  ('tenor_months',     v.tenor_months::numeric,    null),
  ('band_type',        null,                       v.band_type),
  ('shares_ratio_pct', v.shares_ratio_pct,         null),
  ('zero_coupon',      null,
     case when v.product_type = 'mezz' and v.coupon_pct is not null and v.ytm_pct is not null
          then (v.coupon_pct = 0 and v.ytm_pct = 0)::text end),
  ('has_refix',        null,
     case when v.product_type = 'mezz' then (v.refix_floor_price is not null)::text end),
  ('dilution_pct',     v.dilution_pct,             null)
) as f (feature, num_value, txt_value)
where f.num_value is not null or f.txt_value is not null;

-- 유사 딜 검색 (가상 조건 입력) ------------------------------------------
-- 예) select * from mart.find_comps('bond', '{"rating_notch":9,"tenor_months":12,"amount_krw":30000000000}');
create or replace function mart.find_comps(
  p_product          text,
  p_features         jsonb,
  p_ref_date         date default current_date,
  p_limit            int  default null,
  p_lookback_months  int  default null,
  p_exclude_deal     text default null
)
returns table (deal_key text, score numeric, max_score numeric, matched text[], unmatched text[])
language sql stable
security definer
set search_path = ''
as $$
  with prm as (
    select
      coalesce(p_limit,
               (select (value #>> '{}')::int from ref.params where key = 'comps_limit'), 15)           as lim,
      coalesce(p_lookback_months,
               (select (value #>> '{}')::int from ref.params where key = 'comps_lookback_months'), 12) as lookback
  ),
  rules as (
    select r.*
    from ref.similarity_rules r
    where r.product_type = p_product and r.is_active and p_features ? r.feature
  ),
  cands as (
    select v.deal_key, v.deal_dt
    from mart.v_deals v, prm
    where v.product_type = p_product
      and v.deal_dt <= p_ref_date
      and v.deal_dt >  p_ref_date - make_interval(months => prm.lookback)
      and v.deal_key is distinct from p_exclude_deal
  ),
  evals as (
    select
      c.deal_key, c.deal_dt, r.feature, r.weight, r.is_required,
      case r.match_type
        when 'equal'    then f.txt_value = (p_features ->> r.feature)
        when 'abs_diff' then abs(f.num_value - (p_features ->> r.feature)::numeric) <= r.tolerance
        when 'pct_diff' then abs(f.num_value - (p_features ->> r.feature)::numeric)
                             <= r.tolerance * abs((p_features ->> r.feature)::numeric)
      end as hit
    from cands c
    cross join rules r
    left join mart.v_deal_features f on f.deal_key = c.deal_key and f.feature = r.feature
  )
  select
    e.deal_key,
    sum(case when e.hit then e.weight else 0 end)                               as score,
    sum(e.weight)                                                                as max_score,
    coalesce(array_agg(e.feature order by e.feature) filter (where e.hit), '{}')                   as matched,
    coalesce(array_agg(e.feature order by e.feature) filter (where not coalesce(e.hit, false)), '{}') as unmatched
  from evals e
  group by e.deal_key
  having bool_and(coalesce(e.hit, false) or not e.is_required)
  order by score desc, max(e.deal_dt) desc
  limit (select lim from prm)
$$;

comment on function mart.find_comps is
  '조건(features)과 비슷한 과거 딜. 가중치·허용오차·필수여부는 ref.similarity_rules 에서 조정';

-- 유사 딜 검색 (기존 딜 기준) --------------------------------------------
create or replace function mart.similar_deals(p_deal_key text, p_limit int default null)
returns table (deal_key text, score numeric, max_score numeric, matched text[], unmatched text[])
language sql stable
security definer
set search_path = ''
as $$
  select c.*
  from mart.v_deals t
  cross join lateral mart.find_comps(
    t.product_type,
    (select jsonb_object_agg(f.feature, coalesce(to_jsonb(f.num_value), to_jsonb(f.txt_value)))
       from mart.v_deal_features f where f.deal_key = t.deal_key),
    coalesce(t.announce_dt, t.deal_dt),
    p_limit,
    null,
    t.deal_key
  ) c
  where t.deal_key = p_deal_key
$$;

-- 회사 검색 ------------------------------------------------------------
create or replace function mart.search_companies(q text, lim int default 10)
returns table (corp_code text, corp_name text, stock_code text, market text,
               deal_count bigint, last_deal_dt date, match_score real)
language sql stable
security definer
set search_path = ''
as $$
  select
    c.corp_code, c.corp_name, c.stock_code, c.market,
    coalesce(dc.deal_count, 0),
    dc.last_deal_dt,
    greatest(
      extensions.similarity(c.corp_name, q),
      case when c.corp_name = q then 1.0
           when c.corp_name ilike q || '%' then 0.9
           when c.corp_name ilike '%' || q || '%' then 0.7
           else 0 end
    )::real as match_score
  from core.companies c
  left join (
    select v.corp_code, count(*) as deal_count, max(v.deal_dt) as last_deal_dt
    from mart.v_deals v group by v.corp_code
  ) dc on dc.corp_code = c.corp_code
  where length(trim(q)) > 0
    and (c.corp_name ilike '%' || q || '%' or c.corp_name operator(extensions.%) q)
  order by match_score desc, coalesce(dc.deal_count, 0) desc, (c.stock_code is not null) desc, c.corp_name
  limit lim
$$;

-- 회사 개요 ------------------------------------------------------------
create view mart.v_company_overview as
select
  c.corp_code,
  c.corp_name,
  c.market,
  c.stock_code,
  c.induty_code,
  d.bond_deal_count,
  d.mezz_deal_count,
  d.equity_deal_count,
  d.last_deal_dt,
  r.latest_bond_rating,
  mz.articles_remaining_krw,
  mt.maturity_stlm_dt,
  mt.outstanding_bond_krw,
  mt.outstanding_bond_1y_krw
from core.companies c
left join lateral (
  select
    count(*) filter (where v.product_type = 'bond')   as bond_deal_count,
    count(*) filter (where v.product_type = 'mezz')   as mezz_deal_count,
    count(*) filter (where v.product_type = 'equity') as equity_deal_count,
    max(v.deal_dt)                                    as last_deal_dt
  from mart.v_deals v where v.corp_code = c.corp_code
) d on true
left join lateral (
  select v.rating as latest_bond_rating
  from mart.v_deals v
  where v.corp_code = c.corp_code and v.rating is not null
  order by v.deal_dt desc limit 1
) r on true
left join lateral (
  select v.articles_remaining_krw
  from mart.v_deals v
  where v.corp_code = c.corp_code and v.articles_remaining_krw is not null
  order by v.deal_dt desc limit 1
) mz on true
left join lateral (
  select
    m.stlm_dt                                            as maturity_stlm_dt,
    sum(m.amount_krw)                                    as outstanding_bond_krw,
    sum(m.amount_krw) filter (where m.bucket_order = 1)  as outstanding_bond_1y_krw
  from core.company_bond_maturity m
  where m.corp_code = c.corp_code and m.scope = '합계'
    and m.stlm_dt = (select max(x.stlm_dt) from core.company_bond_maturity x where x.corp_code = c.corp_code)
  group by m.stlm_dt
) mt on true;

-- 회사 만기 구조 (최신 정기보고서) --------------------------------------
create view mart.v_company_maturity as
select m.corp_code, m.stlm_dt, m.scope, m.bucket_order, m.bucket, m.amount_krw
from core.company_bond_maturity m
where m.stlm_dt = (select max(x.stlm_dt) from core.company_bond_maturity x where x.corp_code = m.corp_code);

-- 회사 채무증권 발행 이력 (정기보고서, 사모 포함) ------------------------
create view mart.v_company_debt_issues as
select
  i.*,
  (i.maturity_dt >= current_date and coalesce(i.repaid_status, '') !~ '^(전액)?상환') as is_outstanding
from core.company_debt_issues i;

-- 트렌드: 회사채 ---------------------------------------------------------
create view mart.v_bond_trend_monthly as
select
  date_trunc('month', v.deal_dt)::date                                         as month,
  v.sub_type                                                                    as category,
  v.rating_group,
  count(*)                                                                      as deal_count,
  sum(v.amount_krw)                                                             as amount_krw,
  round(sum(v.yield_pct * v.amount_krw) filter (where v.yield_pct is not null)
        / nullif(sum(v.amount_krw) filter (where v.yield_pct is not null), 0), 3) as avg_yield_pct_w,
  round(avg(v.tenor_months), 1)                                                 as avg_tenor_months,
  round(avg(v.competition_ratio), 2)                                            as avg_competition,
  count(v.competition_ratio)                                                    as demand_known_count,
  count(*) filter (where v.is_undersubscribed)                                  as undersub_count,
  count(*) filter (where v.band_type = '고정금리')                               as fixed_band_count,
  count(v.band_type)                                                            as band_known_count,
  count(*) filter (where v.is_increased)                                        as increased_count
from mart.v_deals v
where v.product_type = 'bond' and v.deal_dt is not null
group by 1, 2, 3;

-- 트렌드: 메자닌 ---------------------------------------------------------
create view mart.v_mezz_trend_monthly as
with prm as (
  select (value #>> '{}')::numeric as refix_low from ref.params where key = 'refix_low_ratio_pct'
)
select
  date_trunc('month', v.deal_dt)::date                                         as month,
  v.sub_type                                                                    as kind,
  v.market,
  v.is_public,
  count(*)                                                                      as deal_count,
  sum(v.amount_krw)                                                             as amount_krw,
  count(*) filter (where v.coupon_pct = 0 and v.ytm_pct = 0)                    as zero_coupon_count,
  round(avg(v.ytm_pct), 2)                                                      as avg_ytm_pct,
  count(*) filter (where v.refix_floor_ratio_pct <= prm.refix_low)              as refix_low_count,
  count(v.refix_floor_ratio_pct)                                                as refix_known_count,
  round(avg(v.shares_ratio_pct), 2)                                             as avg_shares_ratio_pct
from mart.v_deals v
left join prm on true
where v.product_type = 'mezz' and v.deal_dt is not null
group by 1, 2, 3, 4;

-- 트렌드: 유상증자 -------------------------------------------------------
create view mart.v_equity_trend_monthly as
select
  date_trunc('month', v.deal_dt)::date                                         as month,
  v.sub_type                                                                    as method,
  v.market,
  count(*)                                                                      as deal_count,
  sum(v.amount_krw)                                                             as amount_krw,
  round(avg(v.dilution_pct), 2)                                                 as avg_dilution_pct,
  count(*) filter (where v.underwriting_method = '총액인수')                     as firm_commitment_count,
  count(*) filter (where v.underwriting_method = '잔액인수')                     as standby_count,
  count(v.underwriting_method)                                                  as method_known_count
from mart.v_deals v
where v.product_type = 'equity' and v.deal_dt is not null
group by 1, 2, 3;

-- 수수료 ---------------------------------------------------------------
create view mart.v_fee_stats as
select
  v.product_type,
  date_trunc('quarter', v.deal_dt)::date                       as quarter,
  coalesce(v.rating_group, '-')                                as rating_group,
  v.sub_type,
  count(*)                                                     as deal_count,
  sum(v.uw_amount_krw)                                         as uw_amount_krw,
  sum(v.fee_krw)                                               as fee_krw,
  round(sum(v.fee_krw) / nullif(sum(v.uw_amount_krw), 0) * 1e4, 1) as fee_bp
from mart.v_deals v
where v.fee_krw is not null and v.uw_amount_krw > 0
group by 1, 2, 3, 4;

-- 리그테이블 -----------------------------------------------------------
create view mart.v_league_credits as
with u as (
  select
    x.*,
    count(*) filter (where x.role = '대표주관') over (partition by x.deal_key) as n_leads
  from core.deal_underwriters x
)
select
  v.deal_key,
  v.product_type,
  v.deal_dt,
  coalesce(u.firm_std, u.firm_raw)                               as firm,
  coalesce(f.is_nh, false)                                       as is_nh,
  u.role,
  case when u.role = '대표주관' then v.amount_krw / nullif(u.n_leads, 0) end as lead_credit_krw,
  u.amount_krw                                                   as uw_amount_krw,
  u.fee_krw
from u
join mart.v_deals v on v.deal_key = u.deal_key
left join ref.firms f on f.firm_std = u.firm_std;

create view mart.v_league_table_yearly as
with agg as (
  select
    product_type,
    extract(year from deal_dt)::int                              as year,
    firm,
    is_nh,
    count(distinct deal_key) filter (where role = '대표주관')     as lead_deals,
    sum(lead_credit_krw)                                         as lead_credit_krw,
    sum(uw_amount_krw)                                           as uw_amount_krw,
    sum(fee_krw)                                                 as fee_krw
  from mart.v_league_credits
  group by 1, 2, 3, 4
)
select
  agg.*,
  rank() over (partition by product_type, year order by lead_credit_krw desc nulls last) as lead_rank,
  rank() over (partition by product_type, year order by uw_amount_krw desc nulls last)   as uw_rank
from agg;

-- 주목할 딜 ------------------------------------------------------------
create view mart.v_notable_deals as
with prm as (
  select
    (select value from ref.params where key = 'large_deal_krw')                                    as large_krw,
    (select (value #>> '{}')::int from ref.params where key = 'first_issue_min_history_months')    as hist_months,
    (select min(deal_dt) from mart.v_deals)                                                        as first_dt
)
select v.deal_key, v.deal_dt, v.product_type, v.product_label, v.corp_code, v.corp_name, r.reason, r.detail
from mart.v_deals v
cross join prm
cross join lateral (
  select '미달'::text, format('수요예측 경쟁률 %s:1', v.competition_ratio)
   where v.is_undersubscribed
  union all
  select '증액', format('%s억 → %s억', round(v.initial_amount_krw / 1e8), round(v.amount_krw / 1e8))
   where v.is_increased
  union all
  select '대형', format('%s억', round(v.amount_krw / 1e8))
   where v.amount_krw >= (prm.large_krw ->> v.product_type)::numeric
  union all
  select '첫 발행', '수집 기간 내 같은 상품 첫 발행'
   where v.deal_dt >= prm.first_dt + make_interval(months => prm.hist_months)
     and not exists (
       select 1 from mart.v_deals p
       where p.corp_code = v.corp_code and p.product_type = v.product_type and p.deal_dt < v.deal_dt
     )
) as r (reason, detail);

-- 화면용 설정·지표 정의 -------------------------------------------------
-- ref 는 화면에 노출하지 않으므로, 화면이 필요한 항목만 mart 로 연다.
create view mart.v_metric_catalog as
select metric_key, product_type, label_ko, definition_ko, unit, status
from ref.metric_catalog;

create view mart.v_ui_params as
select key, value, status, note
from ref.params
where key in ('trend_default_months', 'bond_trend_categories', 'comps_lookback_months',
              'comps_limit', 'undersubscribed_ratio', 'refix_low_ratio_pct');

create view mart.v_products as
select product_type, label_ko, sort_order from ref.products;

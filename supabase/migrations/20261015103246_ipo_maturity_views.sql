-- =====================================================================
-- 08. IPO 상품, 만기·풋옵션 도래 뷰
--
-- IPO: 증권신고서(지분증권) 주요정보(estkRs) 중 비상장(법인구분 E)·코넥스(N) 회사의 일반공모.
--      상장사 공모 유상증자는 기존 유상증자 변환(piicDecsn 기준)이 맡는다.
--      희망공모가 밴드·수요예측 경쟁률은 원문 파서가 채운다(core.ipo_terms 의 빈 칸).
-- 만기: 공모 회사채 트랜치 만기일(bdRs), 메자닌 사채 만기일·조기상환청구(풋) 시작일.
-- =====================================================================

insert into ref.products (product_type, label_ko, sort_order) values ('ipo', 'IPO', 4);

insert into ref.params (key, value, note) values
  ('large_deal_krw_ipo', '50000000000', '주목할 딜: IPO 대형 기준 금액(원)'),
  ('maturity_window_months', '{"from": 3, "to": 6}', '만기도래 화면 기본 구간(개월 뒤). 영업 리드타임 기준'),
  ('refi_signal_days', '120', '만기 전 이 기간 안에 새 회사채 신고서를 냈으면 "차환 진행"으로 표시');

insert into ref.similarity_rules (product_type, feature, match_type, tolerance, weight, is_required, note) values
  ('ipo', 'sub_type',   'equal',    null, 3, true,  '일반/스팩/리츠/이전상장'),
  ('ipo', 'market',     'equal',    null, 2, false, '상장 시장'),
  ('ipo', 'amount_krw', 'pct_diff', 0.5,  2, false, '공모금액 ±50%');

insert into ref.metric_catalog (metric_key, product_type, label_ko, definition_ko, unit, source) values
  ('ipo_secondary_pct',  'ipo', '구주매출 비중',    '공모 주식 중 구주매출(매출) 주식 비율', '%', 'mart.v_ipo_trend_monthly'),
  ('ipo_putback_share',  'ipo', '환매청구권 부여 비중', '일반청약자 환매청구권(풋백옵션)이 있는 공모 비중', '%', 'mart.v_ipo_trend_monthly'),
  ('ipo_band_position',  'ipo', '밴드 대비 확정가', '확정 공모가가 희망공모가 밴드 상단 초과·이내·하단 미만인 건수', '건', 'mart.v_ipo_trend_monthly'),
  ('maturity_amount',    null,  '만기 도래 금액',   '공모 회사채 트랜치의 만기일 기준 합계. 조기상환·매입소각은 반영 안 됨', '원', 'mart.v_maturities');

-- IPO 조건 ---------------------------------------------------------------
create table core.ipo_terms (
  deal_key            text primary key references core.deals (deal_key) on delete cascade,
  offer_price         numeric,                     -- 확정(또는 신고) 공모가
  face_value          numeric,
  shares_offered      numeric,
  secondary_shares    numeric,                     -- 구주매출 주식 수
  secondary_pct       numeric,
  subscription_dt     date,                        -- 청약 시작일
  has_putback         boolean,                     -- 일반청약자 환매청구권
  band_low            numeric,                     -- 원문 파서
  band_high           numeric,
  demand_ratio        numeric,                     -- 기관 수요예측 경쟁률 (원문 파서)
  demand_count        int,
  lockup_pct          numeric                      -- 의무보유 확약 비율 (원문 파서)
);

alter table core.mezz_terms add column put_start_dt date;   -- 조기상환청구(풋) 최초 행사 가능일 (원문 파서)

-- 딜 통합 뷰: IPO·풋옵션 컬럼을 뒤에 추가 (앞 컬럼은 그대로) ------------------
create or replace view mart.v_deals as
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
  -- 기준일: 회사채·IPO 는 납입일, 메자닌·유증은 이사회 결정일
  case when d.product_type in ('bond', 'ipo')
       then coalesce(d.payment_dt, d.pricing_dt, d.announce_dt)
       else coalesce(d.announce_dt, d.payment_dt)
  end                                                           as deal_dt,
  d.amount_krw,
  d.initial_amount_krw,
  round(d.amount_krw / 1e8, 1)                                  as amount_eok,
  coalesce(d.amount_krw > d.initial_amount_krw, false)          as is_increased,
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
  m.ytm_pct,
  m.conv_price,
  m.refix_floor_price,
  round(m.refix_floor_price / nullif(m.conv_price, 0) * 100, 1) as refix_floor_ratio_pct,
  m.conv_start_dt,
  m.conv_end_dt,
  m.shares_ratio_pct,
  m.articles_remaining_krw,
  e.dilution_pct,
  coalesce(e.offer_price, i.offer_price)                        as offer_price,
  e.underwriting_method,
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
  end                                                           as dart_url,
  -- 추가 (2026-10-15)
  m.put_start_dt,
  i.secondary_pct                                               as ipo_secondary_pct,
  i.has_putback                                                 as ipo_has_putback,
  i.band_low                                                    as ipo_band_low,
  i.band_high                                                   as ipo_band_high,
  i.demand_ratio                                                as ipo_demand_ratio,
  i.subscription_dt                                             as ipo_subscription_dt,
  case when i.offer_price is null or i.band_high is null then null
       when i.offer_price > i.band_high then '상단 초과'
       when i.offer_price = i.band_high then '상단'
       when i.offer_price >= i.band_low then '밴드 내'
       else '하단 미만' end                                       as ipo_price_vs_band
from core.deals d
join ref.products p on p.product_type = d.product_type
join core.companies c on c.corp_code = d.corp_code
left join core.bond_terms b on b.deal_key = d.deal_key
left join ref.rating_scale rs on rs.rating = b.rating
left join core.mezz_terms m on m.deal_key = d.deal_key
left join core.equity_terms e on e.deal_key = d.deal_key
left join core.ipo_terms i on i.deal_key = d.deal_key
left join uw on uw.deal_key = d.deal_key
left join prm on true;

-- 주목할 딜: IPO 대형 기준 추가 --------------------------------------------
create or replace view mart.v_notable_deals as
with prm as (
  select
    (select value from ref.params where key = 'large_deal_krw')
      || jsonb_build_object('ipo', (select value from ref.params where key = 'large_deal_krw_ipo'))  as large_krw,
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
   where v.product_type <> 'ipo'
     and v.deal_dt >= prm.first_dt + make_interval(months => prm.hist_months)
     and not exists (
       select 1 from mart.v_deals p
       where p.corp_code = v.corp_code and p.product_type = v.product_type and p.deal_dt < v.deal_dt
     )
  union all
  select '밴드 ' || v.ipo_price_vs_band, format('공모가 %s원', v.offer_price)
   where v.ipo_price_vs_band in ('상단 초과', '하단 미만')
) as r (reason, detail)
where v.status <> 'withdrawn';

-- IPO 트렌드 ---------------------------------------------------------------
create view mart.v_ipo_trend_monthly as
select
  date_trunc('month', v.deal_dt)::date                                         as month,
  v.sub_type,
  v.market,
  count(*)                                                                      as deal_count,
  sum(v.amount_krw)                                                             as amount_krw,
  round(avg(v.ipo_secondary_pct), 1)                                            as avg_secondary_pct,
  count(*) filter (where v.ipo_has_putback)                                     as putback_count,
  round(avg(v.ipo_demand_ratio), 1)                                             as avg_demand_ratio,
  count(v.ipo_demand_ratio)                                                     as demand_known_count,
  count(*) filter (where v.ipo_price_vs_band = '상단 초과')                      as above_band_count,
  count(*) filter (where v.ipo_price_vs_band in ('상단', '밴드 내'))             as in_band_count,
  count(*) filter (where v.ipo_price_vs_band = '하단 미만')                      as below_band_count,
  count(v.ipo_price_vs_band)                                                    as band_known_count
from mart.v_deals v
where v.product_type = 'ipo' and v.deal_dt is not null and v.status <> 'withdrawn'
group by 1, 2, 3;

-- 만기·풋옵션 도래 ---------------------------------------------------------
-- 회사채: 트랜치 만기일. 메자닌: 사채 만기일과 조기상환청구(풋) 시작일.
-- 메자닌 잔액은 전환·조기상환으로 줄었을 수 있다(공시 기준 최초 발행액).
create view mart.v_maturities as
with prm as (
  select (value #>> '{}')::int as refi_days from ref.params where key = 'refi_signal_days'
)
select
  v.deal_key,
  v.product_type,
  v.product_label,
  v.sub_type,
  v.corp_code,
  v.corp_name,
  v.market,
  v.series,
  v.is_public,
  ev.event_type,
  ev.event_dt,
  (ev.event_dt - current_date)                                  as days_left,
  v.deal_dt                                                     as issue_dt,
  v.maturity_dt,
  v.amount_krw,
  v.tenor_months,
  v.coupon_pct,
  v.yield_pct,
  v.ytm_pct,
  v.rating,
  v.rating_group,
  v.lead_managers,
  v.nh_involved,
  v.nh_lead,
  v.dart_url,
  -- 차환 신호: 이벤트 전 refi_days 안에 같은 회사가 새 회사채 신고서를 냄
  exists (
    select 1 from core.deals n
    where n.corp_code = v.corp_code and n.product_type = 'bond' and n.deal_key <> v.deal_key
      and n.announce_dt between ev.event_dt - prm.refi_days and least(ev.event_dt, current_date)
  )                                                             as refi_signal
from mart.v_deals v
cross join prm
cross join lateral (
  values ('만기'::text, v.maturity_dt), ('풋옵션', v.put_start_dt)
) as ev (event_type, event_dt)
where v.product_type in ('bond', 'mezz')
  and v.status <> 'withdrawn'
  and ev.event_dt is not null
  and ev.event_dt >= current_date - 365;

comment on view mart.v_maturities is '공모 회사채 만기, 메자닌 만기·풋옵션 도래. 1년 전부터 미래 전체';

create view mart.v_maturity_monthly as
select
  date_trunc('month', m.event_dt)::date                         as month,
  m.product_type,
  m.event_type,
  count(*)                                                      as tranche_count,
  count(distinct m.corp_code)                                   as company_count,
  sum(m.amount_krw)                                             as amount_krw,
  count(*) filter (where m.nh_lead)                             as nh_lead_count
from mart.v_maturities m
group by 1, 2, 3;

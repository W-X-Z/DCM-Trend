-- 회사채 수요예측 보강 (제안서 작성용)
-- 1) 원문 파서 v3: '경쟁율' 표기·':1' 없는 경쟁률도 읽고, 유효수요(밴드 안 참여금액)·수요예측일을 새로 읽는다
--    → core.bond_terms.demand_in_band_krw(기존 빈 칸), demand_dt(신규)
-- 2) 수요예측일은 최초 증권신고서의 "수요예측기간은 …" 문장에 가장 확실히 있어 최초 신고서도 원문 대상에 넣는다(최근 3년)
-- 3) 화면용: mart.v_deals·v_bond_issues 에 수요예측일·유효수요·밴드·수수료를 붙인다

alter table core.bond_terms add column if not exists demand_dt date;
comment on column core.bond_terms.demand_dt is '수요예측일 (최초 신고서의 수요예측기간 또는 확정 신고서 문장)';
comment on column core.bond_terms.demand_in_band_krw is '유효수요: 공모희망금리 밴드 안 참여금액 (신청가격 분포 표의 포함 행 합계)';

create or replace function core.apply_doc_fields()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  nb int; ni int; nm int;
begin
  -- 회사채: 필드마다 가장 최근 공시 값
  with dk as (
    select distinct df.deal_key
    from core.deal_filings df
    join core.deals d on d.deal_key = df.deal_key and d.product_type = 'bond'
    where exists (select 1 from raw.doc_fields f where f.rcept_no = df.rcept_no and f.purpose = 'bond')
  ),
  v as (
    select
      b.deal_key,
      core.deal_doc_value(b.deal_key, 'rating_raw')                                     as rating_raw,
      core.deal_doc_value(b.deal_key, 'band_type')                                      as band_type,
      core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'band_low_bp'),  core.deal_doc_value(b.deal_key, 'band_low_pct')))  as band_low,
      core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'band_high_bp'), core.deal_doc_value(b.deal_key, 'band_high_pct'))) as band_high,
      core.parse_numeric(core.deal_doc_value(b.deal_key, 'coupon_pct', d.series))       as coupon,
      core.parse_numeric(core.deal_doc_value(b.deal_key, 'yield_pct', d.series))        as yld,
      core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'demand_count', d.series),      core.deal_doc_value(b.deal_key, 'demand_count')))      as demand_count,
      core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'demand_krw', d.series),        core.deal_doc_value(b.deal_key, 'demand_krw')))        as demand_krw,
      core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'competition_ratio', d.series), core.deal_doc_value(b.deal_key, 'competition_ratio'))) as ratio,
      core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'demand_valid_krw', d.series),  core.deal_doc_value(b.deal_key, 'demand_valid_krw')))  as demand_valid,
      core.parse_date_kr(core.deal_doc_value(b.deal_key, 'demand_dt'))                  as demand_dt,
      core.parse_numeric(core.deal_doc_value(b.deal_key, 'final_spread_bp_by_tenor',
        case when b.tenor_months % 12 = 0 then (b.tenor_months / 12)::text
             else rtrim(rtrim(to_char(b.tenor_months / 12.0, 'FM990.0'), '0'), '.') end)) as spread
    from core.bond_terms b
    join core.deals d on d.deal_key = b.deal_key
    join dk on dk.deal_key = b.deal_key
  )
  update core.bond_terms b set
    rating_raw        = coalesce(v.rating_raw, b.rating_raw),
    rating            = coalesce(core.parse_rating(v.rating_raw), b.rating),
    band_type         = coalesce(v.band_type, b.band_type),
    band_low          = coalesce(v.band_low, b.band_low),
    band_high         = coalesce(v.band_high, b.band_high),
    coupon_pct        = coalesce(v.coupon, b.coupon_pct),
    yield_pct         = coalesce(v.yld, b.yield_pct),
    demand_count      = coalesce(v.demand_count::int, b.demand_count),
    demand_krw        = coalesce(v.demand_krw, b.demand_krw),
    competition_ratio = coalesce(v.ratio, b.competition_ratio),
    demand_in_band_krw = coalesce(v.demand_valid, b.demand_in_band_krw),
    demand_dt         = coalesce(v.demand_dt, b.demand_dt),
    final_spread_bp   = coalesce(v.spread, b.final_spread_bp)
  from v
  where v.deal_key = b.deal_key;
  get diagnostics nb = row_count;

  -- 회사채 최초 신고금액 (증액 판단): 가장 이른 공시의 '정정 전' 값
  update core.deals d set initial_amount_krw = x.amount_initial
  from (
    select d2.deal_key, core.parse_numeric(core.deal_doc_value(d2.deal_key, 'amount_initial', d2.series, true)) as amount_initial
    from core.deals d2
    where d2.product_type = 'bond'
      and exists (select 1 from core.deal_filings df join raw.doc_fields f on f.rcept_no = df.rcept_no and f.field = 'amount_initial'
                  where df.deal_key = d2.deal_key)
  ) x
  where x.deal_key = d.deal_key and x.amount_initial is not null;

  -- IPO: [발행조건확정] 공시에서만
  with dk as (
    select distinct df.deal_key
    from core.deal_filings df
    join core.deals d on d.deal_key = df.deal_key and d.product_type = 'ipo'
    where df.role = 'final_terms'
      and exists (select 1 from raw.doc_fields f where f.rcept_no = df.rcept_no and f.purpose = 'ipo')
  )
  update core.ipo_terms t set
    band_low     = coalesce(core.parse_numeric(core.deal_doc_value(dk.deal_key, 'band_low', '', false, 'final_terms')), t.band_low),
    band_high    = coalesce(core.parse_numeric(core.deal_doc_value(dk.deal_key, 'band_high', '', false, 'final_terms')), t.band_high),
    offer_price  = coalesce(core.parse_numeric(core.deal_doc_value(dk.deal_key, 'offer_price_final', '', false, 'final_terms')), t.offer_price),
    demand_ratio = coalesce(core.parse_numeric(core.deal_doc_value(dk.deal_key, 'demand_ratio', '', false, 'final_terms')), t.demand_ratio)
  from dk
  where dk.deal_key = t.deal_key;
  get diagnostics ni = row_count;

  -- 메자닌 풋옵션: 최초 결정 공시
  with dk as (
    select distinct df.deal_key
    from core.deal_filings df
    join core.deals d on d.deal_key = df.deal_key and d.product_type = 'mezz'
    where exists (select 1 from raw.doc_fields f where f.rcept_no = df.rcept_no and f.purpose = 'mezz')
  )
  update core.mezz_terms m set
    put_start_dt = coalesce(
      core.parse_date_kr(core.deal_doc_value(dk.deal_key, 'put_first_payment_dt', '', true)),
      (coalesce(d.payment_dt, d.announce_dt)
        + make_interval(months => core.parse_numeric(core.deal_doc_value(dk.deal_key, 'put_after_months', '', true))::int))::date,
      m.put_start_dt)
  from dk
  join core.deals d on d.deal_key = dk.deal_key
  where dk.deal_key = m.deal_key;
  get diagnostics nm = row_count;

  return jsonb_build_object('bond_docs', nb, 'ipo_docs', ni, 'mezz_docs', nm);
end
$$;


-- 원문 대상: 확정 신고서는 파서 v3 로 다시 읽고, 최초 신고서(정정·확정 아닌 원본)를 새로 읽는다
update ref.document_fetch_rules set parser_version = 3,
       note = '금리·등급·밴드·확정 가산금리·수요예측(경쟁률·유효수요·수요예측일)'
 where purpose = 'bond' and report_pattern = '^\[발행조건확정\]증권신고서\(채무증권\)';
insert into ref.document_fetch_rules (priority, report_pattern, purpose, lookback_days, is_active, note, parser_version)
values (11, '^증권신고서\(채무증권\)$', 'bond', 1100, true, '최초 증권신고서: 수요예측일(수요예측기간)·공모희망금리 밴드·등급', 3);

-- 화면용 뷰: v_deals 끝에 열 추가 (pg_get_viewdef 로 현재 정의를 그대로 두고 덧붙임)
do $$
declare
  v text := pg_get_viewdef('mart.v_deals'::regclass, true);
  anchor text := E'END AS ipo_price_vs_band\n   FROM core.deals d';
begin
  if position(anchor in v) = 0 then
    raise exception 'v_deals 정의에서 덧붙일 위치를 찾지 못함';
  end if;
  v := replace(v, anchor, E'END AS ipo_price_vs_band,\n    b.demand_in_band_krw,\n    b.demand_dt\n   FROM core.deals d');
  execute 'create or replace view mart.v_deals as ' || v;
end
$$;


-- 발행 단위 뷰: 끝에 열 추가
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
    'fee_bp', t.fee_bp, 'maturity_dt', t.maturity_dt))
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
  min(t.maturity_dt)                                     as maturity_min_dt
from t
group by t.corp_code, t.base_series, t.deal_dt;

grant select on mart.v_bond_issues to anon, authenticated;

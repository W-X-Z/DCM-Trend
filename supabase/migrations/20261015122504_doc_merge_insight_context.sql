-- 원문 값 보강 (2026-10-15 실데이터 점검 결과)
-- 1) 한 딜의 값이 여러 공시에 나뉘어 있다: 첫 [발행조건확정]에 수요예측·확정 가산금리, 두 번째(기준금리 확정)에 확정 금리.
--    → 딜 단위로 필드마다 가장 최근 공시의 값을 쓴다 (core.deal_doc_value). 최초 신고금액·메자닌 풋은 가장 이른 공시.
-- 2) 파서를 고치면 이미 읽은 원문도 다시 읽는다: 규칙(ref.document_fetch_rules)의 parser_version 을 올리면
--    낮은 버전으로 읽은 공시가 다시 대기열에 오른다. 다시 읽을 때 사라진 필드는 쓰지 않는다(공시별 최신 run 만 사용).
-- 3) IPO 확정공모가는 [발행조건확정] 공시(final_terms)에서만 읽는다.
-- 4) 인사이트: 신주 비율은 평균 대신 중간값(극단값 899% 같은 딜 영향 제거), 최대 1건 비중·최대 1건 제외 금액 추가,
--    요약에 쓸 기간별 최대 딜 목록 RPC.

alter table ref.document_fetch_rules add column if not exists parser_version int not null default 1;
alter table raw.document_fetches     add column if not exists parser_version int not null default 1;

-- docparse.mjs 2차: 회차 표 범위, 기준금리 확정 후 이자율, 은행채·무보증 가산금리 문장, 수요예측 단위, IPO 확정가
update ref.document_fetch_rules set parser_version = 2 where purpose in ('bond', 'ipo');

create or replace function public.ingest_mark_document(
  p_run_id bigint, p_rcept_no text, p_status text, p_files int, p_bytes int)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into raw.document_fetches (rcept_no, status, files, bytes, run_id, parser_version)
  values (p_rcept_no, p_status, p_files, p_bytes, p_run_id,
          coalesce((select max(r.parser_version)
                    from raw.filings f
                    join ref.document_fetch_rules r on r.is_active and f.report_nm ~ r.report_pattern
                    where f.rcept_no = p_rcept_no), 1))
  on conflict (rcept_no) do update set
    status = excluded.status, files = excluded.files, bytes = excluded.bytes,
    run_id = excluded.run_id, parser_version = excluded.parser_version, fetched_at = now()
$$;

create or replace function public.ingest_pending_documents(p_limit int default 200)
returns table (rcept_no text, purpose text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (f.rcept_no) f.rcept_no, r.purpose
  from raw.filings f
  join ref.document_fetch_rules r
    on r.is_active and f.report_nm ~ r.report_pattern
   and (r.lookback_days is null or f.rcept_dt >= current_date - r.lookback_days)
  where not exists (
    select 1 from raw.document_fetches d
    where d.rcept_no = f.rcept_no and d.status in ('ok', 'missing') and d.parser_version >= r.parser_version)
  order by f.rcept_no desc, r.priority
  limit p_limit
$$;

-- 공시 하나의 값: 그 공시를 마지막으로 읽은 run 의 값만 (다시 읽을 때 사라진 필드는 버린다)
create or replace function core.doc_value(p_rcept_no text, p_field text, p_series text default '')
returns text
language sql
stable
set search_path = ''
as $$
  select f.value
  from raw.doc_fields f
  where f.rcept_no = p_rcept_no and f.field = p_field and f.series = coalesce(p_series, '')
    and coalesce(f.run_id, 0) = (select max(coalesce(g.run_id, 0)) from raw.doc_fields g where g.rcept_no = p_rcept_no)
$$;

-- 딜 하나의 값: 딜에 연결된 공시 중 값이 있는 가장 최근(또는 가장 이른) 공시
create or replace function core.deal_doc_value(
  p_deal_key text, p_field text, p_series text default '', p_oldest boolean default false, p_role text default null)
returns text
language sql
stable
set search_path = ''
as $$
  select v.value
  from (
    select df.rcept_no, core.doc_value(df.rcept_no, p_field, p_series) as value
    from core.deal_filings df
    where df.deal_key = p_deal_key and (p_role is null or df.role = p_role)
  ) v
  where v.value is not null
  order by case when p_oldest then v.rcept_no end asc, v.rcept_no desc
  limit 1
$$;

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

-- 인사이트 규칙 ------------------------------------------------------------------
update ref.insight_rules
   set label_ko = '신주 비율 중간값', note = '평균은 극단값(수백 %) 한두 건에 끌려가서 중간값을 쓴다'
 where fact_key = 'equity_avg_dilution';

insert into ref.insight_rules (fact_key, scope, label_ko, unit, compare, min_change, priority, is_active, status, note) values
  ('equity_top1_share',     'equity', '최대 1건이 금액에서 차지하는 비중', 'pct', 'yoy', 20, 12, true, 'draft', '한 건이 합계를 좌우하는지'),
  ('equity_amount_ex_top1', 'equity', '유상증자 금액(최대 1건 제외)',      'krw', 'yoy',   15, 14, true, 'draft', null),
  ('ipo_top1_share',        'ipo',    '최대 1건이 공모금액에서 차지하는 비중', 'pct', 'yoy', 20, 12, true, 'draft', null),
  ('ipo_amount_ex_top1',    'ipo',    'IPO 공모금액(최대 1건 제외)',        'krw', 'yoy',   15, 14, true, 'draft', null),
  ('mezz_top1_share',       'mezz',   '최대 1건이 발행금액에서 차지하는 비중', 'pct', 'yoy', 20, 12, true, 'draft', null),
  ('bond_top1_share',       'bond',   '최대 1건이 발행금액에서 차지하는 비중', 'pct', 'yoy', 10, 12, true, 'draft', null)
on conflict (fact_key) do nothing;

create or replace function mart.insight_facts(p_asof date default current_date)
returns table (
  scope text, fact_key text, label_ko text, unit text, compare text,
  value_now numeric, value_base numeric, change numeric,
  period_now text, period_base text, score numeric, is_notable boolean, priority int, rule_status text)
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
      'bond_top1_share',     100.0 * max(d.amount_krw) / nullif(sum(d.amount_krw), 0),
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
      'mezz_top1_share',      100.0 * max(d.amount_krw) / nullif(sum(d.amount_krw), 0),
      'mezz_zero_share',      100.0 * count(*) filter (where d.coupon_pct = 0 and d.ytm_pct = 0) / nullif(count(d.ytm_pct), 0),
      'mezz_refix_low_share', 100.0 * count(*) filter (where d.refix_floor_ratio_pct <= 70) / nullif(count(d.refix_floor_ratio_pct), 0),
      'mezz_public_share',    100.0 * count(*) filter (where d.is_public) / nullif(count(d.is_public), 0))
    from d where d.product_type = 'mezz' group by d.w
    union all
    select 'equity', d.w, jsonb_build_object(
      'equity_amount',         sum(d.amount_krw),
      'equity_amount_ex_top1', sum(d.amount_krw) - max(d.amount_krw),
      'equity_top1_share',     100.0 * max(d.amount_krw) / nullif(sum(d.amount_krw), 0),
      'equity_count',          count(*),
      'equity_third_share',    100.0 * count(*) filter (where d.sub_type = '제3자배정') / nullif(count(*), 0),
      'equity_avg_dilution',   percentile_cont(0.5) within group (order by d.dilution_pct),
      'equity_firm_share',     100.0 * count(*) filter (where d.underwriting_method = '총액인수') / nullif(count(d.underwriting_method), 0))
    from d where d.product_type = 'equity' group by d.w
    union all
    select 'ipo', d.w, jsonb_build_object(
      'ipo_amount',           sum(d.amount_krw),
      'ipo_amount_ex_top1',   sum(d.amount_krw) - max(d.amount_krw),
      'ipo_top1_share',       100.0 * max(d.amount_krw) / nullif(sum(d.amount_krw), 0),
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

-- 요약 문장에 쓸 최근 3개월 상품별 상위 딜 (금액이 한두 건에 쏠렸는지 설명용)
create or replace function public.ingest_insight_top_deals(p_asof date default current_date, p_per_scope int default 2)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with prm as (
    select date_trunc('month', p_asof)::date as m0,
           coalesce((select array_agg(x) from jsonb_array_elements_text(
                      (select value from ref.params where key = 'bond_trend_categories')) x), '{}') as bond_cats
  ),
  d as (
    select v.product_type as scope, v.corp_name, v.sub_type, v.amount_krw,
           100.0 * v.amount_krw / nullif(sum(v.amount_krw) over (partition by v.product_type), 0) as share_pct,
           row_number() over (partition by v.product_type order by v.amount_krw desc nulls last) as rn,
           to_char(p.m0 - interval '3 month', 'YY.MM') || '~' || to_char(p.m0 - interval '1 month', 'YY.MM') as period
    from mart.v_deals v, prm p
    where v.deal_dt >= (p.m0 - interval '3 month') and v.deal_dt < p.m0
      and v.status <> 'withdrawn' and v.amount_krw is not null
      and (v.product_type <> 'bond' or cardinality(p.bond_cats) = 0 or v.sub_type = any (p.bond_cats))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'scope', scope, 'corp_name', corp_name, 'sub_type', sub_type, 'amount_krw', amount_krw,
           'share_pct', round(share_pct, 1), 'rank', rn, 'period', period) order by scope, rn), '[]'::jsonb)
  from d
  where rn <= p_per_scope
$$;

revoke execute on function public.ingest_insight_top_deals(date, int) from public, anon, authenticated;
grant execute on function public.ingest_insight_top_deals(date, int) to service_role;

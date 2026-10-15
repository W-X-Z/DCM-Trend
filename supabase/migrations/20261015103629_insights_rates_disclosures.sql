-- =====================================================================
-- 10. 인사이트(규칙 기반 사실 + AI 요약), 금리, 공시 분류 규칙
--
-- 인사이트: 계산은 SQL(mart.insight_facts), 표시 기준·문구는 ref.insight_rules.
--           AI 요약은 수집기(Actions)가 이 사실만 넣어 만들고 core.insight_summaries 에 저장.
-- 금리: 한국은행 ECOS 일별 금리(raw.rates) → 최신값·변화폭·스프레드. 예측은 하지 않는다.
-- 공시: 회사 화면이 OpenDART 에서 실시간으로 받은 공시를 ref.disclosure_rules 로 분류.
-- =====================================================================

-- 인사이트 규칙 -------------------------------------------------------------
-- compare: yoy   = 최근 3개월 vs 전년 같은 3개월
--          trail = 최근 3개월 vs 직전 12개월 (금액·건수는 3개월 환산)
--          m1    = 최신값 vs 1개월 전 (금리)
-- min_change: 이 이상 바뀌어야 "눈에 띄는 변화". krw·count 는 변화율(%), pct 는 %p, bp·rate 는 bp, months 는 개월
create table ref.insight_rules (
  fact_key     text primary key,
  scope        text not null check (scope in ('bond', 'mezz', 'equity', 'ipo', 'maturity', 'rates')),
  label_ko     text not null,
  unit         text not null check (unit in ('krw', 'count', 'pct', 'months', 'bp', 'rate')),
  compare      text not null check (compare in ('yoy', 'trail', 'm1')),
  min_change   numeric not null,
  priority     int not null default 100,
  is_active    boolean not null default true,
  status       text not null default 'draft' check (status in ('draft', 'agreed')),
  note         text
);

insert into ref.insight_rules (fact_key, scope, label_ko, unit, compare, min_change, priority, note) values
  ('bond_amount',          'bond',     '회사채 발행금액',          'krw',    'yoy',   10, 10, '기본 구분(ref.params.bond_trend_categories)만'),
  ('bond_count',           'bond',     '회사채 발행 건수',         'count',  'yoy',   10, 20, null),
  ('bond_avg_tenor',       'bond',     '회사채 평균 만기',         'months', 'trail',  3, 30, null),
  ('bond_long_share',      'bond',     '5년 이상 장기물 비중',     'pct',    'trail',  5, 40, null),
  ('bond_fee_bp',          'bond',     '회사채 인수수수료율',      'bp',     'trail',  2, 50, null),
  ('bond_nh_lead_share',   'bond',     'NH 대표주관 금액 비중',    'pct',    'trail',  3, 60, '대표주관사가 공시된 딜 금액 중 NH 대표주관 딜 비중'),
  ('bond_increase_share',  'bond',     '증액 발행 비중',           'pct',    'trail', 10, 70, '최초 신고금액이 확인된 딜만'),
  ('bond_undersub_share',  'bond',     '수요예측 미달 비중',       'pct',    'trail',  5, 80, '경쟁률이 확인된 딜만'),
  ('bond_avg_spread',      'bond',     '평균 확정 가산금리',       'bp',     'trail',  5, 90, '스프레드형 밴드 딜만'),
  ('mezz_amount',          'mezz',     '메자닌 발행금액',          'krw',    'yoy',   10, 10, null),
  ('mezz_count',           'mezz',     '메자닌 발행 건수',         'count',  'yoy',   10, 20, null),
  ('mezz_zero_share',      'mezz',     '0%/0% 조건 비중',          'pct',    'trail',  5, 30, null),
  ('mezz_refix_low_share', 'mezz',     '리픽싱 하한 70% 이하 비중', 'pct',   'trail',  5, 40, null),
  ('mezz_public_share',    'mezz',     '공모 메자닌 비중',         'pct',    'trail',  3, 50, null),
  ('equity_amount',        'equity',   '유상증자 금액',            'krw',    'yoy',   15, 10, null),
  ('equity_count',         'equity',   '유상증자 건수',            'count',  'yoy',   15, 20, null),
  ('equity_third_share',   'equity',   '제3자배정 비중',           'pct',    'trail',  5, 30, '건수 기준'),
  ('equity_avg_dilution',  'equity',   '평균 신주 비율',           'pct',    'trail',  3, 40, null),
  ('equity_firm_share',    'equity',   '총액인수 비중',            'pct',    'trail', 10, 50, '인수방법이 확인된 딜만'),
  ('ipo_amount',           'ipo',      'IPO 공모금액',             'krw',    'yoy',   15, 10, '스팩 포함'),
  ('ipo_count',            'ipo',      'IPO 건수',                 'count',  'yoy',   15, 20, null),
  ('ipo_secondary_avg',    'ipo',      '평균 구주매출 비중',       'pct',    'trail',  5, 30, null),
  ('ipo_putback_share',    'ipo',      '환매청구권 부여 비중',     'pct',    'trail', 10, 40, null),
  ('ipo_above_band_share', 'ipo',      '밴드 상단 초과 확정 비중', 'pct',    'trail', 10, 50, '밴드가 확인된 딜만'),
  ('mat_amount',           'maturity', '3~6개월 뒤 공모채 만기 금액', 'krw', 'yoy',   10, 10, '1년 전 같은 시점의 3~6개월 뒤 만기와 비교'),
  ('mat_companies',        'maturity', '3~6개월 뒤 만기 도래 회사 수', 'count', 'yoy', 10, 20, null),
  ('base_rate',            'rates',    '기준금리',                 'rate',   'm1',     1, 10, null),
  ('ktb3y',                'rates',    '국고채 3년',               'rate',   'm1',    10, 20, null),
  ('ktb10y',               'rates',    '국고채 10년',              'rate',   'm1',    10, 30, null),
  ('aa_spread',            'rates',    'AA- 회사채 스프레드(국고 3년 대비)', 'bp', 'm1', 5, 40, null),
  ('bbb_spread',           'rates',    'BBB- 와 AA- 금리 차',      'bp',     'm1',    10, 50, null);

-- 사실 계산 -----------------------------------------------------------------
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

comment on function mart.insight_facts is '상품별 최근 3개월 변화 사실. 표시 기준은 ref.insight_rules';

-- AI 요약 ------------------------------------------------------------------
create table core.insight_summaries (
  id          bigint generated always as identity primary key,
  scope       text not null,                       -- home / bond / mezz / equity / ipo / maturity / rates
  asof        date not null,
  facts_hash  text not null,
  summary     text not null,
  model       text,
  created_at  timestamptz not null default now()
);
create index insight_summaries_scope_idx on core.insight_summaries (scope, created_at desc);

create view mart.v_insight_summaries as
select distinct on (s.scope) s.scope, s.asof, s.summary, s.model, s.created_at
from core.insight_summaries s
order by s.scope, s.created_at desc;

create or replace function public.ingest_insight_facts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from mart.insight_facts() f
$$;

create or replace function public.ingest_summary_hashes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.scope, s.facts_hash), '{}'::jsonb)
  from (select distinct on (scope) scope, facts_hash from core.insight_summaries order by scope, created_at desc) s
$$;

create or replace function public.ingest_put_insight_summary(
  p_scope text, p_asof date, p_facts_hash text, p_summary text, p_model text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into core.insight_summaries (scope, asof, facts_hash, summary, model)
  values (p_scope, p_asof, p_facts_hash, p_summary, p_model)
$$;

-- 금리 ---------------------------------------------------------------------
create view mart.v_rate_series as
select s.series_key, s.label_ko, s.grp, s.sort_order
from ref.rate_series s
where s.is_active;

create view mart.v_rates_daily as
select r.series_key, s.label_ko, s.grp, r.dt, r.value
from raw.rates r
join ref.rate_series s on s.series_key = r.series_key
where s.is_active;

create view mart.v_rate_spreads_daily as
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
  from raw.rates r
  group by r.dt
) x
where x.ktb3y is not null;

create view mart.v_rate_latest as
select
  s.series_key, s.label_ko, s.grp, s.sort_order,
  l.dt, l.value,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 7   order by r.dt desc limit 1)) * 100, 1) as chg_1w_bp,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 30  order by r.dt desc limit 1)) * 100, 1) as chg_1m_bp,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 91  order by r.dt desc limit 1)) * 100, 1) as chg_3m_bp,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 365 order by r.dt desc limit 1)) * 100, 1) as chg_1y_bp
from ref.rate_series s
cross join lateral (
  select r.dt, r.value from raw.rates r where r.series_key = s.series_key order by r.dt desc limit 1
) l
where s.is_active;

-- 통화정책 일정 (운영자가 갱신) ---------------------------------------------
create table ref.policy_events (
  event_dt  date primary key,
  kind      text not null,
  label_ko  text not null,
  source    text
);

insert into ref.policy_events (event_dt, kind, label_ko, source) values
  ('2026-01-15', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)'),
  ('2026-02-26', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)'),
  ('2026-04-10', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)'),
  ('2026-05-28', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)'),
  ('2026-07-16', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)'),
  ('2026-08-27', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)'),
  ('2026-10-22', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)'),
  ('2026-11-26', '금통위', '통화정책방향 결정회의', '한국은행 2026년 일정(언론 보도)');

create view mart.v_policy_events as
select e.event_dt, e.kind, e.label_ko, e.source from ref.policy_events e;

-- 공시 분류 규칙 ------------------------------------------------------------
-- importance: 1 영업에 바로 쓰임 / 2 참고 / 3 정기·지분 변동
create table ref.disclosure_rules (
  rule_id     int generated always as identity primary key,
  priority    int  not null,
  pattern     text not null,                       -- report_nm 정규식
  category    text not null,
  importance  int  not null check (importance between 1 and 3),
  is_active   boolean not null default true,
  note        text
);

insert into ref.disclosure_rules (priority, pattern, category, importance) values
  (10, '회생|파산|부도|해산|상장폐지|관리종목|매매거래정지|거래정지', '리스크', 1),
  (15, '횡령|배임|불성실공시|소송|감사의견|의견거절|부적정|한정의견', '리스크', 1),
  (20, '최대주주\s*변경|최대주주등\s*소유주식\s*변동|경영권', '지배구조', 1),
  (25, '합병|분할|주식교환|주식이전|영업양수|영업양도|자산양수도|타법인\s*주식', '지배구조·M&A', 1),
  (30, '유상증자|무상증자|감자|전환사채|신주인수권부사채|교환사채|증권신고서|일괄신고|투자설명서|증권발행실적|자기주식처분', '자금조달', 1),
  (40, '단일판매|공급계약|신규시설투자|유형자산\s*(양수|양도)|투자판단', '사업·투자', 2),
  (45, '잠정|영업실적|매출액또는손익구조', '실적', 2),
  (50, '자기주식|배당|소각', '주주환원', 2),
  (55, '신용등급|기업설명회|IR', 'IR·신용', 2),
  (60, '사업보고서|반기보고서|분기보고서|감사보고서', '정기보고', 3),
  (70, '대량보유|소유상황보고|특정증권', '지분 변동', 3),
  (99, '.', '기타', 3);

create view mart.v_disclosure_rules as
select r.priority, r.pattern, r.category, r.importance
from ref.disclosure_rules r
where r.is_active;

-- 권한 --------------------------------------------------------------------
revoke execute on function
  public.ingest_insight_facts(),
  public.ingest_summary_hashes(),
  public.ingest_put_insight_summary(text, date, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.ingest_insight_facts(),
  public.ingest_summary_hashes(),
  public.ingest_put_insight_summary(text, date, text, text, text)
to service_role;

grant all on core.insight_summaries to service_role;
grant select on mart.v_insight_summaries, mart.v_rate_series, mart.v_rates_daily, mart.v_rate_spreads_daily,
                mart.v_rate_latest, mart.v_policy_events, mart.v_disclosure_rules to anon, authenticated;
grant execute on function mart.insight_facts(date) to anon, authenticated;

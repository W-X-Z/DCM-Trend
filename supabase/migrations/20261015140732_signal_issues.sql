-- 눈여겨볼 회사 (특이 이슈·고객 접점)
-- 1) 규칙(ref.signal_rules)으로 공시·발행·만기·잔액 데이터에서 후보를 뽑는다 (public.ingest_signal_candidates)
-- 2) 수집기가 후보만 AI 에 넘겨 6~8곳을 고르고 한 줄 근거·대화 소재를 쓴다. 후보에 없는 회사·숫자는 버린다
-- 3) 결과는 날짜별 한 묶음으로 저장하고(core.insight_issue_sets) 화면은 최신 묶음만 읽는다(mart.v_insight_issues)

create table ref.signal_rules (
  signal_key     text primary key,
  kind           text not null check (kind in ('issue', 'touchpoint')),  -- issue: 특이 이슈, touchpoint: 영업 접점
  label_ko       text not null,
  report_pattern text,            -- 공시 기반 신호: 보고서명 정규식 (정정 공시 제외)
  window_days    int,             -- 공시·발행 신호: 최근 며칠
  max_n          int not null default 10,
  priority       int not null default 100,  -- AI 가 실패했을 때 규칙으로 고르는 순서
  is_active      boolean not null default true,
  note           text
);

insert into ref.signal_rules (signal_key, kind, label_ko, report_pattern, window_days, max_n, priority, note) values
  ('refi_due',     'touchpoint', '3~6개월 뒤 공모채 만기, 차환 신고서 아직 없음', null, null, 12, 10, '금융채 제외, 만기 금액 큰 순'),
  ('cp_reliant',   'touchpoint', '공모채 이력 없이 1년 내 단기 차입이 큰 회사', null, null, 10, 20, '정기보고서 미상환 잔액(사모채·CP·전단채) 1,000억 이상, 금융사 제외'),
  ('invest',       'touchpoint', '투자·인수 결정 공시', '(유형자산\s*양수|타법인\s*주식\s*및\s*출자증권\s*(양수|취득)|영업\s*양수|비유동자산\s*취득|신규\s*시설\s*투자|중요한\s*자산\s*양수)', 21, 12, 30, '자금 수요 신호'),
  ('put_due',      'touchpoint', '6개월 안에 메자닌 조기상환청구(풋) 시작', null, null, 10, 40, '상환 재원 마련 수요'),
  ('cb_buyback',   'touchpoint', '전환사채·BW 만기 전 취득(풋 행사 등)', '(자기\s*전환사채\s*만기전\s*취득|자기\s*신주인수권부사채\s*만기전\s*취득)', 21, 8, 50, null),
  ('hybrid',       'touchpoint', '신종자본·조건부자본증권 발행 결정', '(자본으로\s*인정되는\s*채무증권|조건부\s*자본증권)', 30, 8, 60, null),
  ('first_issue',  'touchpoint', '수집 기간 중 처음 발행한 회사', null, 30, 10, 70, 'mart.v_notable_deals 의 첫 발행'),
  ('weak_demand',  'issue',      '회사채 수요예측 미달·IPO 밴드 하단 미만 확정', null, 30, 8, 15, null),
  ('restructure',  'issue',      '합병·분할·주식교환 결정', '(회사\s*합병|회사\s*분할|분할\s*합병|주식\s*교환|주식\s*이전)', 21, 8, 35, null),
  ('distress',     'issue',      '회생·영업정지·해산·감자', '(회생절차|영업정지|해산\s*사유|감자\s*결정|부도)', 30, 8, 45, null),
  ('big_dilution', 'issue',      '신주 비율 30% 이상 유상증자', null, 30, 8, 55, null);


create table core.insight_issue_sets (
  asof            date primary key,
  items           jsonb not null,
  model           text,
  candidates_hash text,
  created_at      timestamptz not null default now()
);

-- 후보 목록 (수집기 전용)
create or replace function public.ingest_signal_candidates(p_asof date default current_date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with r as (select * from ref.signal_rules where is_active),
  disc as (
    select x.signal_key, x.corp_code, x.corp_name, x.event_dt, x.rcept_no, x.facts, x.max_n
    from (
      select distinct on (r.signal_key, f.corp_code)
        r.signal_key, r.max_n, f.corp_code, f.corp_name, f.rcept_dt as event_dt, f.rcept_no,
        jsonb_build_object(
          '공시', regexp_replace(f.report_nm, '^주요사항보고서\((.*)\)$', '\1'),
          '공시일', f.rcept_dt,
          '같은 종류 공시 수', count(*) over (partition by r.signal_key, f.corp_code)) as facts
      from r
      join raw.filings f
        on r.report_pattern is not null
       and f.report_nm ~ r.report_pattern
       and f.report_nm !~ '^\['
       and f.rcept_dt > p_asof - r.window_days and f.rcept_dt <= p_asof
      order by r.signal_key, f.corp_code, f.rcept_no desc
    ) x
  ),
  refi as (
    select 'refi_due'::text as signal_key, m.corp_code, max(m.corp_name) as corp_name, min(m.event_dt) as event_dt, null::text as rcept_no,
      jsonb_build_object(
        '만기 금액', sum(m.amount_krw), '가장 빠른 만기일', min(m.event_dt), '만기 회차 수', count(*),
        '등급', max(m.rating), 'NH 대표주관 이력', bool_or(m.nh_lead)) as facts
    from mart.v_maturities m
    where m.product_type = 'bond' and m.event_type = '만기' and coalesce(m.sub_type, '') <> '금융채'
      and m.event_dt >= (p_asof + interval '3 month')::date and m.event_dt < (p_asof + interval '6 month')::date
    group by m.corp_code
    having not bool_or(m.refi_signal)
  ),
  puts as (
    select 'put_due'::text, m.corp_code, max(m.corp_name), min(m.event_dt), null::text,
      jsonb_build_object('풋 대상 금액', sum(m.amount_krw), '가장 빠른 풋 시작일', min(m.event_dt), '건수', count(*),
                         '종류', string_agg(distinct m.sub_type, ', ')) as facts
    from mart.v_maturities m
    where m.product_type = 'mezz' and m.event_type = '풋옵션'
      and m.event_dt >= p_asof and m.event_dt < (p_asof + interval '6 month')::date
    group by m.corp_code
  ),
  first_issue as (
    select distinct on (n.corp_code) 'first_issue'::text, n.corp_code, n.corp_name, n.deal_dt, v.latest_rcept_no,
      jsonb_build_object('상품', n.product_label, '구분', v.sub_type, '금액', v.amount_krw, '기준일', n.deal_dt,
                         '대표주관', v.lead_managers) as facts
    from mart.v_notable_deals n
    join mart.v_deals v on v.deal_key = n.deal_key
    where n.reason = '첫 발행' and n.deal_dt > p_asof - (select window_days from r where signal_key = 'first_issue') and n.deal_dt <= p_asof
    order by n.corp_code, v.amount_krw desc nulls last
  ),
  weak as (
    select distinct on (v.corp_code) 'weak_demand'::text, v.corp_code, v.corp_name, v.deal_dt, v.latest_rcept_no,
      case when v.product_type = 'bond'
        then jsonb_build_object('상품', '회사채', '회차', v.series, '금액', v.amount_krw, '수요예측 경쟁률', v.competition_ratio,
                                '등급', v.rating, '대표주관', v.lead_managers)
        else jsonb_build_object('상품', 'IPO', '확정공모가', v.offer_price, '희망밴드 하단', v.ipo_band_low,
                                '수요예측 경쟁률', v.ipo_demand_ratio, '대표주관', v.lead_managers)
      end as facts
    from mart.v_deals v
    where ((v.product_type = 'bond' and v.is_undersubscribed) or (v.product_type = 'ipo' and v.ipo_price_vs_band = '하단 미만'))
      and coalesce(v.pricing_dt, v.deal_dt) > p_asof - (select window_days from r where signal_key = 'weak_demand')
      and coalesce(v.pricing_dt, v.deal_dt) <= p_asof
    order by v.corp_code, v.deal_dt desc
  ),
  dilution as (
    select distinct on (v.corp_code) 'big_dilution'::text, v.corp_code, v.corp_name, v.deal_dt, v.latest_rcept_no,
      jsonb_build_object('방식', v.sub_type, '금액', v.amount_krw, '신주 비율(%)', v.dilution_pct, '결정일', v.deal_dt) as facts
    from mart.v_deals v
    where v.product_type = 'equity' and v.dilution_pct >= 30 and v.status <> 'withdrawn'
      and v.deal_dt > p_asof - (select window_days from r where signal_key = 'big_dilution') and v.deal_dt <= p_asof
    order by v.corp_code, v.amount_krw desc nulls last
  ),
  cp as (
    select 'cp_reliant'::text, s.corp_code, s.corp_name, s.stlm_dt, null::text,
      jsonb_build_object('1년 내 만기 차입 합계', s.total_1y_krw, '사모 회사채 1년 내', s.bond_private_1y_krw,
                         'CP 1년 내', s.cp_1y_krw, '전단채', s.stb_krw, '보고서 기준일', s.stlm_dt) as facts
    from mart.v_company_short_debt s
    where not s.is_financial and s.total_1y_krw >= 1e11
      and not exists (select 1 from core.deals d where d.corp_code = s.corp_code and d.product_type = 'bond')
  ),
  allc as (
    select signal_key, corp_code, corp_name, event_dt, rcept_no, facts from disc
    union all select * from refi
    union all select * from puts
    union all select * from first_issue
    union all select * from weak
    union all select * from dilution
    union all select * from cp
  ),
  ranked as (
    select a.*, r.kind, r.label_ko, r.priority, r.max_n,
      o.market, o.bond_deal_count, o.mezz_deal_count, o.equity_deal_count, o.last_deal_dt, o.latest_bond_rating,
      exists (select 1 from mart.v_deals v where v.corp_code = a.corp_code and v.nh_lead) as nh_lead_ever,
      row_number() over (
        partition by a.signal_key
        order by
          case a.signal_key
            when 'refi_due'   then -(a.facts ->> '만기 금액')::numeric
            when 'put_due'    then -(a.facts ->> '풋 대상 금액')::numeric
            when 'cp_reliant' then -(a.facts ->> '1년 내 만기 차입 합계')::numeric
            when 'first_issue' then -coalesce((a.facts ->> '금액')::numeric, 0)
            when 'big_dilution' then -coalesce((a.facts ->> '금액')::numeric, 0)
            else 0
          end,
          (coalesce(o.bond_deal_count, 0) > 0) desc,
          a.event_dt desc) as rn
    from allc a
    join r on r.signal_key = a.signal_key
    left join mart.v_company_overview o on o.corp_code = a.corp_code
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'signal_key', signal_key, 'kind', kind, 'label', label_ko, 'priority', priority,
    'corp_code', corp_code, 'corp_name', corp_name, 'event_dt', event_dt, 'rcept_no', rcept_no,
    'facts', jsonb_strip_nulls(facts),
    'context', jsonb_strip_nulls(jsonb_build_object(
      '시장', market, '공모채 발행 이력(건)', bond_deal_count, '메자닌 이력(건)', mezz_deal_count,
      '유상증자 이력(건)', equity_deal_count, '최근 회사채 등급', latest_bond_rating, 'NH 대표주관 이력', nh_lead_ever)))
    order by priority, rn), '[]'::jsonb)
  from ranked
  where rn <= max_n
$$;

create or replace function public.ingest_issue_hash()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select candidates_hash from core.insight_issue_sets order by asof desc limit 1
$$;

create or replace function public.ingest_put_issue_set(p_asof date, p_items jsonb, p_model text, p_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into core.insight_issue_sets (asof, items, model, candidates_hash)
  values (p_asof, p_items, p_model, p_hash)
  on conflict (asof) do update set
    items = excluded.items, model = excluded.model, candidates_hash = excluded.candidates_hash, created_at = now()
$$;

revoke execute on function public.ingest_signal_candidates(date), public.ingest_issue_hash(), public.ingest_put_issue_set(date, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_signal_candidates(date), public.ingest_issue_hash(), public.ingest_put_issue_set(date, jsonb, text, text)
  to service_role;
grant all on core.insight_issue_sets to service_role;
grant select on ref.signal_rules to service_role;

-- 화면용: 최신 묶음을 순서대로 펼친다
create or replace view mart.v_insight_issues as
select
  s.asof,
  s.model,
  s.created_at,
  x.ord::int                         as rank,
  x.item ->> 'kind'                  as kind,
  x.item ->> 'corp_code'             as corp_code,
  x.item ->> 'corp_name'             as corp_name,
  x.item ->> 'title'                 as title,
  x.item ->> 'why'                   as why,
  x.item ->> 'angle'                 as angle,
  x.item ->> 'signal_key'            as signal_key,
  x.item ->> 'signal_label'          as signal_label,
  (x.item ->> 'event_dt')::date      as event_dt,
  x.item ->> 'rcept_no'              as rcept_no
from (select * from core.insight_issue_sets order by asof desc limit 1) s
cross join lateral jsonb_array_elements(s.items) with ordinality as x (item, ord);

grant select on mart.v_insight_issues to anon, authenticated;

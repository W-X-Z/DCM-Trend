-- 후보 함수: 규칙의 회사명 제외 패턴 적용
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
    select a.*, r.kind, r.label_ko, r.priority, r.max_n, r.exclude_pattern,
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
    where a.corp_name !~ coalesce(r.exclude_pattern, '$^')
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

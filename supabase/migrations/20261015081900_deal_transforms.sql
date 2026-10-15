-- =====================================================================
-- 07. 딜 변환 (raw → core)
--
-- 실제 OpenDART 응답(2026-09~10 수집분)을 보고 작성했다.
-- - 회사채 bdRs: 회사·회차별 최신 신고서 1건만 돌려준다. 금리·등급·수요예측은 "-" → 원문 파싱(별도)으로 채운다.
-- - 메자닌: 결정공시 API 에 조건이 모두 있다. CB/BW/EB 필드명이 조금씩 다르다.
-- - 유상증자: 결정공시에 금액이 없어 자금조달 목적별 금액 합으로 계산한다. 공모는 증권신고서(estkRs)로 보강한다.
-- 매번 상품별로 지우고 다시 만든다(raw 가 원본이므로 규칙이 바뀌면 그대로 재계산).
-- =====================================================================

-- 자금조달 목적 합계 (원)
create or replace function core.purpose_sum(i jsonb)
returns numeric
language sql immutable
set search_path = ''
as $$
  select nullif(
      coalesce(core.parse_krw(i ->> 'fdpp_fclt'), 0)
    + coalesce(core.parse_krw(i ->> 'fdpp_bsninh'), 0)
    + coalesce(core.parse_krw(i ->> 'fdpp_op'), 0)
    + coalesce(core.parse_krw(i ->> 'fdpp_dtrp'), 0)
    + coalesce(core.parse_krw(i ->> 'fdpp_ocsa'), 0)
    + coalesce(core.parse_krw(i ->> 'fdpp_etc'), 0), 0)
$$;

-- "-" 를 null 로
create or replace function core.nz(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(nullif(trim(p), '-'), '')
$$;

-- 회사채 -----------------------------------------------------------------
create or replace function core.refresh_bond_deals()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  delete from core.deals where product_type = 'bond';

  drop table if exists _bond;
  create temp table _bond on commit drop as
  with gen as (
    -- 회사·회차별 최신 일반사항
    select distinct on (a.corp_code, trim(a.item ->> 'tm'))
      a.corp_code, trim(a.item ->> 'tm') as tm, a.rcept_no, a.item
    from raw.api_items a
    where a.endpoint = 'bdRs' and a.group_title = '일반사항'
      and core.nz(a.item ->> 'estk_exstk') is null          -- 주식 연계(공모 CB 등)는 메자닌에서 처리
      and coalesce(a.item ->> 'drcb_at', 'N') <> 'Y'         -- 파생결합사채 제외
      and core.nz(a.item ->> 'tm') is not null
    order by a.corp_code, trim(a.item ->> 'tm'), a.rcept_no desc
  )
  select
    'bond:' || g.corp_code || ':' || g.tm                                        as deal_key,
    g.corp_code, g.tm, g.rcept_no, g.item,
    core.parse_date_kr(g.item ->> 'pymd')                                        as payment_dt,
    core.parse_date_kr(g.item ->> 'rpd')                                         as maturity_dt,
    core.parse_krw(g.item ->> 'fta')                                             as amount_krw,
    c.corp_name
  from gen g
  join core.companies c on c.corp_code = g.corp_code;

  insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status,
                          announce_dt, pricing_dt, payment_dt, amount_krw, initial_amount_krw,
                          first_rcept_no, latest_rcept_no, updated_at)
  select
    b.deal_key, 'bond',
    coalesce(core.map_value('bond_category_name', b.item ->> 'bdnmn'),
             core.map_value('bond_category_corp', b.corp_name), '일반회사채'),
    b.corp_code, b.tm,
    (b.item ->> 'slmth') = '공모',
    case when b.payment_dt <= current_date then 'completed'
         when fl.has_final then 'priced'
         else 'announced' end,
    fl.first_dt, fl.final_dt, b.payment_dt, b.amount_krw, null,
    fl.first_rcept, fl.latest_rcept, now()
  from _bond b
  left join lateral (
    -- 같은 회사의 채무증권 신고서 중 납입일 전 60일 ~ 납입일 사이 공시를 이 딜의 공시로 본다
    select
      min(f.rcept_dt)                                                             as first_dt,
      min(f.rcept_no)                                                             as first_rcept,
      max(f.rcept_no)                                                             as latest_rcept,
      min(f.rcept_dt) filter (where f.report_nm ~ '^\[발행조건확정\]')             as final_dt,
      bool_or(f.report_nm ~ '^\[발행조건확정\]')                                   as has_final
    from raw.filings f
    where f.corp_code = b.corp_code
      and f.report_nm ~ '증권신고서\(채무증권\)'
      and f.rcept_dt between coalesce(b.payment_dt, current_date) - 60 and coalesce(b.payment_dt, current_date) + 3
  ) fl on true;

  insert into core.deal_filings (deal_key, rcept_no, role, rcept_dt)
  select b.deal_key, f.rcept_no, (core.classify_filing(f.report_nm)).role, f.rcept_dt
  from _bond b
  join raw.filings f
    on f.corp_code = b.corp_code
   and f.report_nm ~ '증권신고서\(채무증권\)'
   and f.rcept_dt between coalesce(b.payment_dt, current_date) - 60 and coalesce(b.payment_dt, current_date) + 3
  on conflict do nothing;

  insert into core.bond_terms (deal_key, bond_name, tenor_months, maturity_dt, guarantor, use_of_funds)
  select
    b.deal_key,
    b.item ->> 'bdnmn',
    case when b.maturity_dt is not null and b.payment_dt is not null
         then round((b.maturity_dt - b.payment_dt) / 30.4375)::int end,
    b.maturity_dt,
    core.nz(b.item ->> 'grt_int'),
    (select jsonb_object_agg(u.item ->> 'se', core.parse_krw(u.item ->> 'amt'))
       from raw.api_items u
      where u.endpoint = 'bdRs' and u.group_title = '자금의사용목적'
        and u.rcept_no = b.rcept_no and trim(u.item ->> 'tm') = b.tm)
  from _bond b;

  insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw)
  select distinct on (b.deal_key, u.item ->> 'actnmn', core.map_value('underwriter_role', u.item ->> 'actsen'))
    b.deal_key,
    u.item ->> 'actnmn',
    core.normalize_firm(u.item ->> 'actnmn'),
    core.map_value('underwriter_role', u.item ->> 'actsen'),
    core.map_value('underwriting_method', u.item ->> 'udtmth'),
    core.parse_krw(u.item ->> 'udtamt'),
    case when core.parse_numeric(u.item ->> 'udtprc') <= core.parse_krw(u.item ->> 'udtamt') * 0.1
         then core.parse_numeric(u.item ->> 'udtprc') end
  from _bond b
  join raw.api_items u
    on u.endpoint = 'bdRs' and u.group_title = '인수인정보'
   and u.rcept_no = b.rcept_no and trim(u.item ->> 'tm') = b.tm
  where core.nz(u.item ->> 'actnmn') is not null;

  select count(*) into n from core.deals where product_type = 'bond';
  return n;
end
$$;

-- 메자닌 -----------------------------------------------------------------
create or replace function core.refresh_mezz_deals()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  delete from core.deals where product_type = 'mezz';

  drop table if exists _mezz;
  create temp table _mezz on commit drop as
  with m as (
    select
      a.corp_code, a.rcept_no, a.item, f.rcept_dt,
      case a.endpoint when 'cvbdIsDecsn' then 'CB' when 'bdwtIsDecsn' then 'BW' else 'EB' end as kind,
      coalesce(core.nz(a.item ->> 'bd_tm'), a.rcept_no) as tm
    from raw.api_items a
    join raw.filings f on f.rcept_no = a.rcept_no
    where a.endpoint in ('cvbdIsDecsn', 'bdwtIsDecsn', 'exbdIsDecsn')
  )
  select
    'mezz:' || l.corp_code || ':' || l.kind || '-' || l.tm                      as deal_key,
    l.*,
    fi.first_rcept, fi.first_dt, fi.initial_amount
  from (select distinct on (corp_code, kind, tm) * from m order by corp_code, kind, tm, rcept_no desc) l
  join lateral (
    select min(x.rcept_no) as first_rcept, min(x.rcept_dt) as first_dt,
           (array_agg(core.parse_krw(x.item ->> 'bd_fta') order by x.rcept_no))[1] as initial_amount
    from m x where x.corp_code = l.corp_code and x.kind = l.kind and x.tm = l.tm
  ) fi on true
  where exists (select 1 from core.companies c where c.corp_code = l.corp_code);

  insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status,
                          announce_dt, payment_dt, amount_krw, initial_amount_krw,
                          first_rcept_no, latest_rcept_no, updated_at)
  select
    deal_key, 'mezz', kind, corp_code, tm,
    (item ->> 'bdis_mthn') = '공모',
    case when core.parse_date_kr(item ->> 'pymd') <= current_date then 'completed' else 'announced' end,
    coalesce(core.parse_date_kr(item ->> 'bddd'), first_dt),
    core.parse_date_kr(item ->> 'pymd'),
    core.parse_krw(item ->> 'bd_fta'),
    initial_amount,
    first_rcept, rcept_no, now()
  from _mezz;

  insert into core.deal_filings (deal_key, rcept_no, role, rcept_dt)
  select x.deal_key, f.rcept_no, (core.classify_filing(f.report_nm)).role, f.rcept_dt
  from _mezz x
  join raw.api_items a
    on a.endpoint in ('cvbdIsDecsn', 'bdwtIsDecsn', 'exbdIsDecsn') and a.corp_code = x.corp_code
   and coalesce(core.nz(a.item ->> 'bd_tm'), a.rcept_no) = x.tm
  join raw.filings f on f.rcept_no = a.rcept_no
  on conflict do nothing;

  insert into core.mezz_terms (deal_key, coupon_pct, ytm_pct, maturity_dt, conv_price, refix_floor_price,
                               conv_start_dt, conv_end_dt, shares_to_issue, shares_ratio_pct,
                               articles_remaining_krw, lead_manager_raw, lead_manager, board_dt,
                               purpose_facility_krw, purpose_operating_krw, purpose_debt_krw,
                               purpose_acquisition_krw, purpose_other_krw)
  select
    deal_key,
    core.parse_numeric(item ->> 'bd_intr_ex'),
    core.parse_numeric(item ->> 'bd_intr_sf'),
    core.parse_date_kr(item ->> 'bd_mtd'),
    core.parse_numeric(coalesce(item ->> 'cv_prc', item ->> 'ex_prc')),
    core.parse_numeric(item ->> 'act_mktprcfl_cvprc_lwtrsprc'),
    core.parse_date_kr(coalesce(item ->> 'cvrqpd_bgd', item ->> 'expd_bgd', item ->> 'exrqpd_bgd')),
    core.parse_date_kr(coalesce(item ->> 'cvrqpd_edd', item ->> 'expd_edd', item ->> 'exrqpd_edd')),
    core.parse_numeric(coalesce(item ->> 'cvisstk_cnt', item ->> 'nstk_isstk_cnt', item ->> 'extg_stkcnt')),
    core.parse_numeric(coalesce(item ->> 'cvisstk_tisstk_vs', item ->> 'nstk_isstk_tisstk_vs', item ->> 'extg_tisstk_vs')),
    core.parse_krw(item ->> 'atcsc_rmislmt'),
    core.nz(item ->> 'rpmcmp'),
    core.normalize_firm(core.nz(item ->> 'rpmcmp')),
    core.parse_date_kr(item ->> 'bddd'),
    core.parse_krw(item ->> 'fdpp_fclt'),
    core.parse_krw(item ->> 'fdpp_op'),
    core.parse_krw(item ->> 'fdpp_dtrp'),
    core.parse_krw(item ->> 'fdpp_ocsa'),
    coalesce(core.parse_krw(item ->> 'fdpp_etc'), 0) + coalesce(core.parse_krw(item ->> 'fdpp_bsninh'), 0)
  from _mezz;

  select count(*) into n from core.deals where product_type = 'mezz';
  return n;
end
$$;

-- 유상증자 ---------------------------------------------------------------
-- 정정공시는 같은 회사의 가장 가까운 이전 최초 결정공시(180일 이내)에 붙인다.
create or replace function core.refresh_equity_deals()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  delete from core.deals where product_type = 'equity';

  drop table if exists _eq_dec, _eq, _eq_rs;
  create temp table _eq_dec on commit drop as
  with d as (
    select a.corp_code, a.rcept_no, a.item, f.rcept_dt, (f.report_nm ~ '^\[') as is_amend
    from raw.api_items a
    join raw.filings f on f.rcept_no = a.rcept_no
    where a.endpoint in ('piicDecsn', 'pifricDecsn')
  )
  select d.*,
    coalesce(
      case when not d.is_amend then d.rcept_no end,
      (select max(b.rcept_no) from d b
        where b.corp_code = d.corp_code and not b.is_amend
          and b.rcept_no < d.rcept_no and b.rcept_dt >= d.rcept_dt - 180),
      d.rcept_no) as anchor
  from d;

  create temp table _eq on commit drop as
  select
    'equity:' || x.corp_code || ':' || x.anchor                                                         as deal_key,
    x.corp_code, x.anchor,
    min(x.rcept_dt)                                                                                    as first_dt,
    max(x.rcept_no)                                                                                    as latest_rcept,
    (array_agg(core.nz(x.item ->> 'ic_mthn') order by x.rcept_no desc)
       filter (where core.nz(x.item ->> 'ic_mthn') is not null))[1]                                   as method_raw,
    (array_agg(coalesce(core.parse_numeric(x.item ->> 'nstk_ostk_cnt'), 0) + coalesce(core.parse_numeric(x.item ->> 'nstk_estk_cnt'), 0)
       order by x.rcept_no desc)
       filter (where coalesce(core.parse_numeric(x.item ->> 'nstk_ostk_cnt'), 0) + coalesce(core.parse_numeric(x.item ->> 'nstk_estk_cnt'), 0) > 0))[1] as new_shares,
    (array_agg(coalesce(core.parse_numeric(x.item ->> 'bfic_tisstk_ostk'), 0) + coalesce(core.parse_numeric(x.item ->> 'bfic_tisstk_estk'), 0)
       order by x.rcept_no desc)
       filter (where coalesce(core.parse_numeric(x.item ->> 'bfic_tisstk_ostk'), 0) > 0))[1]          as pre_shares,
    (array_agg(core.purpose_sum(x.item) order by x.rcept_no desc)
       filter (where core.purpose_sum(x.item) is not null))[1]                                         as purpose_amount,
    (array_agg(core.purpose_sum(x.item) order by x.rcept_no)
       filter (where core.purpose_sum(x.item) is not null))[1]                                         as initial_amount,
    (array_agg(x.item order by x.rcept_no desc))[1]                                                    as last_item,
    array_agg(x.rcept_no)                                                                              as rcept_nos
  from _eq_dec x
  where exists (select 1 from core.companies c where c.corp_code = x.corp_code)
  group by x.corp_code, x.anchor;

  -- 공모(증권신고서)와 연결: estkRs 의 주요사항보고서 접수번호가 맞거나,
  -- (실제 응답은 대부분 "-") 같은 회사가 결정 후 60일 안에 낸 지분증권 신고서.
  -- 결정공시 없이 신고서만 있는 IPO·SPAC 은 유상증자 범위가 아니므로 연결되지 않는다.
  create temp table _eq_rs on commit drop as
  select distinct on (e.deal_key)
    e.deal_key, g.rcept_no as rs_rcept, g.item as gen
  from _eq e
  join raw.api_items g
    on g.endpoint = 'estkRs' and g.group_title = '일반사항' and g.corp_code = e.corp_code
  join raw.filings fg on fg.rcept_no = g.rcept_no
  where core.nz(g.item ->> 'rpt_rcpn') = any (e.rcept_nos)
     or fg.rcept_dt between e.first_dt and e.first_dt + 60
  order by e.deal_key, g.rcept_no desc;

  insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status,
                          announce_dt, payment_dt, amount_krw, initial_amount_krw,
                          first_rcept_no, latest_rcept_no, updated_at)
  select
    e.deal_key, 'equity',
    coalesce(core.map_value('equity_method', e.method_raw), e.method_raw),
    e.corp_code, null,
    (rs.deal_key is not null),
    case when core.parse_date_kr(rs.gen ->> 'pymd') <= current_date then 'completed' else 'announced' end,
    e.first_dt,
    core.parse_date_kr(rs.gen ->> 'pymd'),
    coalesce(
      (select sum(core.parse_krw(s.item ->> 'slta')) from raw.api_items s
        where s.endpoint = 'estkRs' and s.group_title = '증권의종류' and s.rcept_no = rs.rs_rcept),
      e.purpose_amount),
    e.initial_amount,
    e.anchor, greatest(e.latest_rcept, rs.rs_rcept), now()
  from _eq e
  left join _eq_rs rs on rs.deal_key = e.deal_key;

  insert into core.deal_filings (deal_key, rcept_no, role, rcept_dt)
  select e.deal_key, f.rcept_no, (core.classify_filing(f.report_nm)).role, f.rcept_dt
  from _eq e
  join raw.filings f on f.rcept_no = any (e.rcept_nos)
  on conflict do nothing;

  insert into core.equity_terms (deal_key, method_raw, new_shares, pre_shares, dilution_pct, offer_price,
                                 underwriting_method, board_dt,
                                 purpose_facility_krw, purpose_operating_krw, purpose_debt_krw,
                                 purpose_acquisition_krw, purpose_other_krw)
  select
    e.deal_key, e.method_raw, e.new_shares, e.pre_shares,
    round(e.new_shares / nullif(e.pre_shares, 0) * 100, 2),
    (select core.parse_numeric(s.item ->> 'slprc') from raw.api_items s
      where s.endpoint = 'estkRs' and s.group_title = '증권의종류' and s.rcept_no = rs.rs_rcept
      order by s.item_id limit 1),
    (select core.map_value('underwriting_method', u.item ->> 'udtmth') from raw.api_items u
      where u.endpoint = 'estkRs' and u.group_title = '인수인정보' and u.rcept_no = rs.rs_rcept
      order by (u.item ->> 'actsen') ~ '대표' desc, u.item_id limit 1),
    e.first_dt,
    core.parse_krw(e.last_item ->> 'fdpp_fclt'),
    core.parse_krw(e.last_item ->> 'fdpp_op'),
    core.parse_krw(e.last_item ->> 'fdpp_dtrp'),
    core.parse_krw(e.last_item ->> 'fdpp_ocsa'),
    coalesce(core.parse_krw(e.last_item ->> 'fdpp_etc'), 0) + coalesce(core.parse_krw(e.last_item ->> 'fdpp_bsninh'), 0)
  from _eq e
  left join _eq_rs rs on rs.deal_key = e.deal_key;

  insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw)
  select distinct on (rs.deal_key, u.item ->> 'actnmn', core.map_value('underwriter_role', u.item ->> 'actsen'))
    rs.deal_key,
    u.item ->> 'actnmn',
    core.normalize_firm(u.item ->> 'actnmn'),
    core.map_value('underwriter_role', u.item ->> 'actsen'),
    core.map_value('underwriting_method', u.item ->> 'udtmth'),
    core.parse_krw(u.item ->> 'udtamt'),
    case when core.parse_numeric(u.item ->> 'udtprc') <= core.parse_krw(u.item ->> 'udtamt') * 0.2
         then core.parse_numeric(u.item ->> 'udtprc') end
  from _eq_rs rs
  join raw.api_items u
    on u.endpoint = 'estkRs' and u.group_title = '인수인정보' and u.rcept_no = rs.rs_rcept
  where core.nz(u.item ->> 'actnmn') is not null;

  select count(*) into n from core.deals where product_type = 'equity';
  return n;
end
$$;

-- 전체 변환 ---------------------------------------------------------------
create or replace function public.ingest_refresh()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  r := jsonb_build_object('companies', core.refresh_companies());
  r := r || jsonb_build_object('bond',   core.refresh_bond_deals());
  r := r || jsonb_build_object('mezz',   core.refresh_mezz_deals());
  r := r || jsonb_build_object('equity', core.refresh_equity_deals());
  return r;
end
$$;

revoke execute on function public.ingest_refresh() from public, anon, authenticated;
grant execute on function public.ingest_refresh() to service_role;
grant execute on all functions in schema core to service_role;

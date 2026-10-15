-- =====================================================================
-- 09. 변환 함수 (2단계): IPO, 정기보고서 잔액, 원문 파서 결과 반영
--
-- 함수 본문에 delete 가 있어 SQL 편집기에서 직접 적용한다 (MCP 는 파괴적 구문을 막음).
-- 적용 후: supabase migration repair --status applied 20261015120000
-- =====================================================================

create or replace function core.refresh_ipo_deals()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  delete from core.deals where product_type = 'ipo';

  drop table if exists _ipo;
  create temp table _ipo on commit drop as
  with stk as (
    -- 증권의종류: 공모 주식 (신고서 1건 = 공모 1건)
    select
      a.corp_code, a.rcept_no,
      sum(core.parse_krw(a.item ->> 'slta'))                                         as amount,
      sum(core.parse_numeric(a.item ->> 'stkcnt'))                                   as shares,
      max(core.parse_numeric(a.item ->> 'slprc')) filter (where a.item ->> 'stksen' ~ '보통')  as price,
      max(core.parse_numeric(a.item ->> 'fv'))                                       as fv,
      max(a.item ->> 'corp_cls')                                                     as corp_cls,
      bool_or(coalesce(a.item ->> 'slmthn', '') ~ '공모')                             as is_public
    from raw.api_items a
    where a.endpoint = 'estkRs' and a.group_title = '증권의종류'
    group by a.corp_code, a.rcept_no
  )
  select
    'ipo:' || s.corp_code || ':' || s.rcept_no                                       as deal_key,
    s.*,
    to_date(left(s.rcept_no, 8), 'YYYYMMDD')                                         as first_dt,
    g.item                                                                           as gen,
    c.corp_name
  from stk s
  join core.companies c on c.corp_code = s.corp_code
  left join lateral (
    select x.item from raw.api_items x
    where x.endpoint = 'estkRs' and x.group_title = '일반사항' and x.rcept_no = s.rcept_no
    order by x.item_id desc limit 1
  ) g on true
  where s.corp_cls in ('E', 'N') and s.is_public;

  insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status,
                          announce_dt, pricing_dt, payment_dt, amount_krw, initial_amount_krw,
                          first_rcept_no, latest_rcept_no, updated_at)
  select
    i.deal_key, 'ipo',
    case when i.corp_name ~ '스팩|기업인수목적' then '스팩'
         when i.corp_name ~ '리츠|부동산투자회사' then '리츠'
         when i.corp_cls = 'N' then '이전상장'
         else '일반' end,
    i.corp_code, null, true,
    case when fl.withdrawn then 'withdrawn'
         when core.parse_date_kr(i.gen ->> 'pymd') <= current_date then 'completed'
         when fl.has_final then 'priced'
         else 'announced' end,
    i.first_dt,
    fl.final_dt,
    core.parse_date_kr(i.gen ->> 'pymd'),
    i.amount, null,
    i.rcept_no, coalesce(fl.latest_rcept, i.rcept_no), now()
  from _ipo i
  left join lateral (
    select
      max(f.rcept_no) filter (where f.report_nm ~ '증권신고서\(지분증권\)')                as latest_rcept,
      min(f.rcept_dt) filter (where f.report_nm ~ '^\[발행조건확정\]')                    as final_dt,
      bool_or(f.report_nm ~ '^\[발행조건확정\]')                                          as has_final,
      bool_or(f.report_nm ~ '철회')                                                       as withdrawn
    from raw.filings f
    where f.corp_code = i.corp_code
      and f.rcept_dt between i.first_dt and i.first_dt + 120
  ) fl on true;

  insert into core.deal_filings (deal_key, rcept_no, role, rcept_dt)
  select i.deal_key, f.rcept_no, (core.classify_filing(f.report_nm)).role, f.rcept_dt
  from _ipo i
  join raw.filings f
    on f.corp_code = i.corp_code
   and f.rcept_dt between i.first_dt and i.first_dt + 120
   and (f.report_nm ~ '증권신고서\(지분증권\)' or f.report_nm ~ '철회')
  on conflict do nothing;

  insert into core.ipo_terms (deal_key, offer_price, face_value, shares_offered, secondary_shares, secondary_pct,
                              subscription_dt, has_putback)
  select
    i.deal_key, i.price, i.fv, i.shares,
    sec.shares,
    round(sec.shares / nullif(i.shares, 0) * 100, 1),
    core.parse_date_kr(i.gen ->> 'sbd'),
    pb.has_putback
  from _ipo i
  left join lateral (
    select sum(core.parse_numeric(x.item ->> 'slstk')) as shares
    from raw.api_items x
    where x.endpoint = 'estkRs' and x.group_title = '매출인에관한사항' and x.rcept_no = i.rcept_no
  ) sec on true
  left join lateral (
    select bool_or(core.nz(x.item ->> 'grtrs') is not null or core.nz(x.item ->> 'exprc') is not null) as has_putback
    from raw.api_items x
    where x.endpoint = 'estkRs' and x.group_title = '일반청약자환매청구권' and x.rcept_no = i.rcept_no
  ) pb on true;

  insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw)
  select distinct on (i.deal_key, u.item ->> 'actnmn', core.map_value('underwriter_role', u.item ->> 'actsen'))
    i.deal_key,
    u.item ->> 'actnmn',
    core.normalize_firm(u.item ->> 'actnmn'),
    core.map_value('underwriter_role', u.item ->> 'actsen'),
    core.map_value('underwriting_method', u.item ->> 'udtmth'),
    core.parse_krw(u.item ->> 'udtamt'),
    case when core.parse_numeric(u.item ->> 'udtprc') <= core.parse_krw(u.item ->> 'udtamt') * 0.1
         then core.parse_numeric(u.item ->> 'udtprc') end
  from _ipo i
  join raw.api_items u
    on u.endpoint = 'estkRs' and u.group_title = '인수인정보' and u.rcept_no = i.rcept_no
  where core.nz(u.item ->> 'actnmn') is not null;

  select count(*) into n from core.deals where product_type = 'ipo';
  return n;
end
$$;

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
  r := r || jsonb_build_object('ipo',    core.refresh_ipo_deals());
  return r;
end
$$;


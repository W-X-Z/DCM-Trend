-- 주요 공시 모아보기 (RM·RA 가 매일 DART 에서 직접 거르던 공시)
-- 1) 공시 규칙(ref.feed_rules)에 묶음(grp)을 붙인다: 신용·상장 위험 / 자금 수요 / 지배구조·M&A / 자산·실적
-- 2) 거래정지는 사유가 상장폐지·실질심사·감사의견일 때만 (병합·분할·단일판매 정지는 뺀다)
-- 3) 거래소 공시 원문에서 금액·자기자본 대비·상대방을 읽는다 (ingest/lib/docparse.mjs parseDisclosure)
-- 4) mart.v_key_filings: 최근 120일 시장 전체 주요 공시 + 읽은 값(facts)

alter table ref.feed_rules add column if not exists grp text;

update ref.feed_rules set grp = '신용·상장 위험'
where rule_key in ('d_rehab', 'd_default', 'd_bond_default', 'd_bankmgmt', 'd_dissolve', 'd_suspend', 'd_halt', 'd_embezzle');
update ref.feed_rules set grp = '자금 수요'
where rule_key in ('d_stdebt', 'd_capex', 'd_cb_buyback', 'd_treasury_sell', 'd_guarantee');
update ref.feed_rules set grp = '지배구조·M&A'
where rule_key in ('d_control', 'd_pledge', 'd_stake_buy', 'd_stake_sell', 'd_merger', 'd_split', 'd_exchange', 'd_biz_buy', 'd_biz_sell');
update ref.feed_rules set grp = '자산·실적'
where rule_key in ('d_asset_buy', 'd_asset_sell', 'd_capcut', 'd_plshock', 'd_noncurrent');

update ref.feed_rules set
  label_ko = '상장폐지 사유·실질심사',
  report_pattern = '^(주권매매거래정지(기간변경)?|기타시장안내)\s*\((상장폐지\s*사유\s*발생|상장적격성\s*실질심사\s*대상\s*결정\)|.*감사의견\s*(거절|부적정|한정))',
  weight = 2.0,
  note = '거래정지·시장안내 중 사유가 상장폐지·실질심사·감사의견인 것만'
where rule_key = 'd_halt';

insert into ref.document_fetch_rules (priority, report_pattern, purpose, lookback_days, is_active, note, parser_version)
select 40,
  '^(단기차입금\s*증가|신규\s*시설\s*투자|최대주주\s*변경\s*$|최대주주\s*변경을\s*수반하는\s*주식\s*양수도|경영권\s*변경|타인에\s*대한\s*(채무보증|담보제공)|매출액\s*또는\s*손익구조|사채\s*원리금|횡령)',
  'disclosure', 75, true, '거래소 공시: 금액·자기자본 대비·상대방', 1
where not exists (select 1 from ref.document_fetch_rules where purpose = 'disclosure');

-- 공시 1건의 읽은 값: 상세 API(raw.api_items) + 원문(raw.doc_fields, 마지막 run)
create or replace function core.disc_facts(p_rcept_no text, p_endpoint text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce((
      select jsonb_object_agg(l.label_ko, core.fmt_field(it.item ->> l.field, l.unit))
        filter (where core.fmt_field(it.item ->> l.field, l.unit) is not null)
      from ref.detail_field_labels l
      cross join lateral (
        select a.item from raw.api_items a
        where a.endpoint = p_endpoint and a.rcept_no = p_rcept_no
        order by a.item_id desc limit 1) it
      where l.endpoint = p_endpoint), '{}'::jsonb)
    || coalesce((
      select jsonb_object_agg(split_part(f.field, ':', 1), core.fmt_field(f.value, coalesce(nullif(split_part(f.field, ':', 2), ''), 'text')))
        filter (where core.fmt_field(f.value, coalesce(nullif(split_part(f.field, ':', 2), ''), 'text')) is not null)
      from raw.doc_fields f
      where f.rcept_no = p_rcept_no and f.purpose = 'disclosure'
        and coalesce(f.run_id, 0) = (select max(coalesce(g.run_id, 0)) from raw.doc_fields g where g.rcept_no = p_rcept_no)), '{}'::jsonb)
$$;

create or replace function core.disc_size(p_rcept_no text, p_endpoint text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select greatest(
    (select max(core.to_num(it.item ->> l.field))
       from ref.detail_field_labels l
       cross join lateral (
         select a.item from raw.api_items a
         where a.endpoint = p_endpoint and a.rcept_no = p_rcept_no
         order by a.item_id desc limit 1) it
      where l.endpoint = p_endpoint and l.is_size),
    (select max(core.to_num(f.value)) from raw.doc_fields f
      where f.rcept_no = p_rcept_no and f.purpose = 'disclosure' and f.field ~ ':krw$'
        and f.field ~ '^(차입금액|투자금액|양수금액|양도금액|계약금액|채무보증금액|담보제공금액|발생 금액|미지급 금액)'))
$$;

revoke execute on function core.disc_facts(text, text), core.disc_size(text, text) from public, anon, authenticated;

create or replace view mart.v_key_filings as
with m as (
  select distinct on (f.rcept_no)
    f.rcept_no, f.rcept_dt, f.corp_code, f.corp_name, f.report_nm,
    r.rule_key, r.label_ko, r.grp, r.endpoint, r.weight
  from raw.filings f
  join ref.feed_rules r
    on r.tag = '공시' and r.is_active and f.report_nm ~ r.report_pattern
   and f.corp_name !~ coalesce(r.exclude_pattern, '$^')
  where f.rcept_dt >= current_date - 120 and f.report_nm !~ '^\['
  order by f.rcept_no, r.weight desc
)
select
  m.rcept_no, m.rcept_dt, m.corp_code, m.corp_name,
  regexp_replace(regexp_replace(m.report_nm, '^주요사항보고서\((.*)\)$', '\1'), '\s{2,}', ' ', 'g') as report_nm,
  m.rule_key, m.label_ko as label, coalesce(m.grp, '기타') as grp, m.weight,
  jsonb_strip_nulls(core.disc_facts(m.rcept_no, m.endpoint)) as facts,
  core.disc_size(m.rcept_no, m.endpoint) as size_krw,
  o.market, o.latest_bond_rating, o.bond_deal_count, o.mezz_deal_count, o.outstanding_bond_krw,
  'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' || m.rcept_no as dart_url
from m
left join mart.v_company_overview o on o.corp_code = m.corp_code;

grant select on mart.v_key_filings to anon, authenticated;

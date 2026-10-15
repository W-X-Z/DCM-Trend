-- =====================================================================
-- 08. 공시 목록 적재 제외 규칙
--
-- 발행공시(C)의 약 75%는 ELS·DLS 등 파생결합증권 일괄신고 공시라 이 서비스와 무관하다.
-- 저장 공간(무료 플랜 500MB)을 아끼기 위해 적재 단계에서 제외한다. 규칙은 행으로 관리한다.
-- =====================================================================

create table ref.filing_skip_rules (
  rule_id         int generated always as identity primary key,
  report_pattern  text not null,
  is_active       boolean not null default true,
  note            text
);

insert into ref.filing_skip_rules (report_pattern, note) values
  ('파생결합',                 'ELS·DLS·ELB 등 파생결합증권·사채'),
  ('주식워런트|상장지수증권',   'ELW·ETN'),
  ('^투자설명서',              '증권신고서와 내용 중복'),
  ('소액공모',                 '소액공모 공시서류·실적보고서');

create or replace function public.ingest_put_filings(p_run_id bigint, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.filings (rcept_no, corp_code, corp_name, stock_code, corp_cls, report_nm, flr_nm,
                           rcept_dt, rm, pblntf_ty, pblntf_detail_ty, payload, run_id, fetched_at)
  select
    x ->> 'rcept_no',
    x ->> 'corp_code',
    x ->> 'corp_name',
    nullif(trim(x ->> 'stock_code'), ''),
    x ->> 'corp_cls',
    trim(x ->> 'report_nm'),
    x ->> 'flr_nm',
    core.parse_date_kr(x ->> 'rcept_dt'),
    nullif(trim(x ->> 'rm'), ''),
    x ->> '_pblntf_ty',
    x ->> '_pblntf_detail_ty',
    x - '_pblntf_ty' - '_pblntf_detail_ty',
    p_run_id,
    now()
  from jsonb_array_elements(p_items) x
  where not exists (
    select 1 from ref.filing_skip_rules s
    where s.is_active and trim(x ->> 'report_nm') ~ s.report_pattern
  )
  on conflict (rcept_no) do update set
    report_nm  = excluded.report_nm,
    rm         = excluded.rm,
    payload    = excluded.payload,
    run_id     = excluded.run_id,
    fetched_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.ingest_put_filings(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_put_filings(bigint, jsonb) to service_role;

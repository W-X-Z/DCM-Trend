-- =====================================================================
-- 06. 수집기 적재 경로
--
-- 수집기(GitHub Actions)는 service_role 키로 아래 public.ingest_* 함수만 호출한다.
-- raw·ops 스키마를 API에 노출하지 않기 위해 적재는 함수(RPC)로만 한다.
-- 어떤 공시에 어떤 상세 API를 부를지는 ref.detail_fetch_rules 가 정한다(수집기는 해석하지 않음).
-- =====================================================================

-- 상세 API 호출 규칙 -----------------------------------------------------
create table ref.detail_fetch_rules (
  rule_id         int generated always as identity primary key,
  priority        int not null,
  report_pattern  text not null,                   -- report_nm 정규식
  endpoint        text not null,                   -- OpenDART API 이름 (확장자 제외)
  is_active       boolean not null default true,
  note            text
);

insert into ref.detail_fetch_rules (priority, report_pattern, endpoint, note) values
  (10, '증권신고서\(채무증권\)',               'bdRs',        '최초·정정·발행조건확정 모두 포함'),
  (20, '증권신고서\(지분증권\)',               'estkRs',      null),
  (30, '전환사채권\s*발행\s*결정',             'cvbdIsDecsn', null),
  (31, '신주인수권부사채권\s*발행\s*결정',     'bdwtIsDecsn', null),
  (32, '교환사채권\s*발행\s*결정',             'exbdIsDecsn', null),
  (40, '유무상증자\s*결정',                    'pifricDecsn', null),
  (41, '유상증자\s*결정',                      'piicDecsn',   '"유무상증자결정"과는 겹치지 않음');

-- 상세 API 호출 기록 (데이터 없음 응답도 기록해 재호출 방지) -------------
create table raw.detail_fetches (
  endpoint     text not null,
  rcept_no     text not null,
  corp_code    text not null,
  status_code  text not null,                      -- OpenDART status: 000 정상, 013 데이터 없음 ...
  item_count   int not null default 0,
  run_id       bigint references ops.ingest_runs (run_id),
  fetched_at   timestamptz not null default now(),
  primary key (endpoint, rcept_no)
);
create index detail_fetches_run_idx on raw.detail_fetches (run_id);
create index api_items_run_idx on raw.api_items (run_id);
create index filings_run_idx on raw.filings (run_id);

-- 실행 시작·종료 ----------------------------------------------------------
create or replace function public.ingest_start_run(p_job text, p_params jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into ops.ingest_runs (job, params) values (p_job, coalesce(p_params, '{}'::jsonb))
  returning run_id
$$;

create or replace function public.ingest_finish_run(
  p_run_id bigint, p_status text, p_api_calls int, p_rows_fetched int, p_rows_written int, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update ops.ingest_runs
     set status = p_status, api_calls = p_api_calls, rows_fetched = p_rows_fetched,
         rows_written = p_rows_written, error = p_error, finished_at = now()
   where run_id = p_run_id
$$;

create or replace function public.ingest_log_issue(
  p_stage text, p_code text, p_rcept_no text default null, p_corp_code text default null, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into ops.issues (stage, code, rcept_no, corp_code, detail)
  values (p_stage, p_code, p_rcept_no, p_corp_code, coalesce(p_detail, '{}'::jsonb))
$$;

-- 회사 마스터 (corpCode.xml) ----------------------------------------------
-- p_items: [{corp_code, corp_name, corp_eng_name, stock_code, modify_date(YYYYMMDD)}]
create or replace function public.ingest_put_corp_codes(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.corp_codes (corp_code, corp_name, corp_eng_name, stock_code, modify_date, fetched_at)
  select
    x ->> 'corp_code',
    x ->> 'corp_name',
    nullif(trim(x ->> 'corp_eng_name'), ''),
    nullif(trim(x ->> 'stock_code'), ''),
    core.parse_date_kr(x ->> 'modify_date'),
    now()
  from jsonb_array_elements(p_items) x
  on conflict (corp_code) do update set
    corp_name     = excluded.corp_name,
    corp_eng_name = excluded.corp_eng_name,
    stock_code    = excluded.stock_code,
    modify_date   = excluded.modify_date,
    fetched_at    = now();
  get diagnostics n = row_count;
  return n;
end
$$;

-- 공시 목록 (list.json) ----------------------------------------------------
-- p_items: list.json 의 list 항목 + 수집기가 붙인 _pblntf_ty, _pblntf_detail_ty
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

-- 상세 API 응답 ------------------------------------------------------------
-- p_items: [{group_title, item}]  (그룹이 없는 응답은 group_title = null)
-- p_rcept_nos: 이번 호출로 확인한 공시들 (응답에 없더라도 호출 기록을 남긴다)
create or replace function public.ingest_put_api_items(
  p_run_id bigint, p_endpoint text, p_corp_code text, p_status_code text,
  p_items jsonb, p_rcept_nos text[] default '{}', p_period_key text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.api_items (endpoint, corp_code, rcept_no, period_key, group_title, item, item_hash, run_id)
  select
    p_endpoint,
    p_corp_code,
    x -> 'item' ->> 'rcept_no',
    p_period_key,
    x ->> 'group_title',
    x -> 'item',
    md5((x -> 'item')::text),
    p_run_id
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  on conflict (endpoint, corp_code, item_hash) do nothing;
  get diagnostics n = row_count;

  insert into raw.detail_fetches (endpoint, rcept_no, corp_code, status_code, item_count, run_id)
  select
    p_endpoint, r, p_corp_code, p_status_code,
    (select count(*) from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      where x -> 'item' ->> 'rcept_no' = r),
    p_run_id
  from unnest(p_rcept_nos) r
  on conflict (endpoint, rcept_no) do update set
    status_code = excluded.status_code,
    item_count  = excluded.item_count,
    run_id      = excluded.run_id,
    fetched_at  = now();

  return n;
end
$$;

-- 상세 API 호출 대기 목록 ----------------------------------------------------
-- (endpoint, corp_code) 단위로 묶어 한 번에 호출할 수 있게 접수일 범위를 함께 준다.
create or replace function public.ingest_pending_details(p_limit int default 500)
returns table (endpoint text, corp_code text, bgn_de date, end_de date, rcept_nos text[])
language sql
stable
security definer
set search_path = ''
as $$
  with matched as (
    select distinct on (f.rcept_no, r.endpoint)
      r.endpoint, f.corp_code, f.rcept_no, f.rcept_dt
    from raw.filings f
    join ref.detail_fetch_rules r
      on r.is_active and f.report_nm ~ r.report_pattern
    where not exists (
      select 1 from raw.detail_fetches d
      where d.endpoint = r.endpoint and d.rcept_no = f.rcept_no
        and d.status_code in ('000', '013')
    )
    order by f.rcept_no, r.endpoint, r.priority
  )
  select m.endpoint, m.corp_code, min(m.rcept_dt), max(m.rcept_dt), array_agg(m.rcept_no order by m.rcept_no)
  from matched m
  group by m.endpoint, m.corp_code
  order by min(m.rcept_dt) desc
  limit p_limit
$$;

-- 현황 --------------------------------------------------------------------
create or replace function public.ingest_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'corp_codes',      (select count(*) from raw.corp_codes),
    'filings',         (select count(*) from raw.filings),
    'filings_min_dt',  (select min(rcept_dt) from raw.filings),
    'filings_max_dt',  (select max(rcept_dt) from raw.filings),
    'api_items',       (select count(*) from raw.api_items),
    'detail_fetches',  (select count(*) from raw.detail_fetches),
    'pending_groups',  (select count(*) from public.ingest_pending_details(100000)),
    'companies',       (select count(*) from core.companies),
    'deals',           (select count(*) from core.deals)
  )
$$;

-- 변환 실행 -----------------------------------------------------------------
-- 딜 변환 함수가 추가되면 여기에 호출을 붙인다.
create or replace function public.ingest_refresh()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_companies int;
begin
  n_companies := core.refresh_companies();
  return jsonb_build_object('companies', n_companies);
end
$$;

-- 권한: service_role 만 호출 ------------------------------------------------
revoke execute on function
  public.ingest_start_run(text, jsonb),
  public.ingest_finish_run(bigint, text, int, int, int, text),
  public.ingest_log_issue(text, text, text, text, jsonb),
  public.ingest_put_corp_codes(jsonb),
  public.ingest_put_filings(bigint, jsonb),
  public.ingest_put_api_items(bigint, text, text, text, jsonb, text[], text),
  public.ingest_pending_details(int),
  public.ingest_stats(),
  public.ingest_refresh()
from public, anon, authenticated;

grant execute on function
  public.ingest_start_run(text, jsonb),
  public.ingest_finish_run(bigint, text, int, int, int, text),
  public.ingest_log_issue(text, text, text, text, jsonb),
  public.ingest_put_corp_codes(jsonb),
  public.ingest_put_filings(bigint, jsonb),
  public.ingest_put_api_items(bigint, text, text, text, jsonb, text[], text),
  public.ingest_pending_details(int),
  public.ingest_stats(),
  public.ingest_refresh()
to service_role;

grant all on raw.detail_fetches to service_role;
grant select on ref.detail_fetch_rules to service_role;

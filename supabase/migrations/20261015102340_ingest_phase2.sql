-- =====================================================================
-- 07. 수집 확장: 정기보고서 잔액, 신고서 원문, 한국은행 금리
--
-- 수집기는 service_role 로 아래 RPC 만 호출한다. 대상 선정·호출 규칙은 ref 에 둔다.
-- =====================================================================

-- 정기보고서 API ------------------------------------------------------------
-- 회사채·단기사채·기업어음 미상환 잔액 (만기 구간별). 회사·보고기간마다 1회 호출.
create table ref.periodic_endpoints (
  endpoint   text primary key,
  label_ko   text not null,
  priority   int  not null,
  is_active  boolean not null default true
);

insert into ref.periodic_endpoints (endpoint, label_ko, priority) values
  ('cprndNrdmpBlce',           '회사채 미상환 잔액',     10),
  ('entrprsBilScritsNrdmpBlce', '기업어음증권 미상환 잔액', 20),
  ('srtpdPsndbtNrdmpBlce',     '단기사채 미상환 잔액',   30);

create table raw.periodic_fetches (
  endpoint     text not null,
  corp_code    text not null,
  period_key   text not null,                      -- 'YYYY-보고서코드' 예: 2026-11012 (반기)
  status_code  text not null,
  item_count   int  not null default 0,
  run_id       bigint references ops.ingest_runs (run_id),
  fetched_at   timestamptz not null default now(),
  primary key (endpoint, corp_code, period_key)
);

-- 대상: 상장사 + 공모채·메자닌 발행 이력이 있는 회사. 이미 받은 (회사, 기간)은 제외.
create or replace function public.ingest_periodic_targets(p_period_key text, p_limit int default 500)
returns table (endpoint text, corp_code text)
language sql
stable
security definer
set search_path = ''
as $$
  with corps as (
    select c.corp_code, 1 as prio from raw.corp_codes c where c.stock_code is not null
    union
    select d.corp_code, 0 from core.deals d where d.product_type in ('bond', 'mezz')
  ),
  t as (
    select e.endpoint, c.corp_code, min(c.prio) as prio, e.priority
    from corps c
    cross join ref.periodic_endpoints e
    where e.is_active
    group by e.endpoint, c.corp_code, e.priority
  )
  select t.endpoint, t.corp_code
  from t
  where not exists (
    select 1 from raw.periodic_fetches f
    where f.endpoint = t.endpoint and f.corp_code = t.corp_code and f.period_key = p_period_key
      and f.status_code in ('000', '013')
  )
  order by t.priority, t.prio, t.corp_code
  limit p_limit
$$;

create or replace function public.ingest_put_periodic(
  p_run_id bigint, p_endpoint text, p_corp_code text, p_period_key text, p_status_code text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.api_items (endpoint, corp_code, rcept_no, period_key, group_title, item, item_hash, run_id)
  select p_endpoint, p_corp_code, x ->> 'rcept_no', p_period_key, null, x, md5(x::text), p_run_id
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  on conflict (endpoint, corp_code, item_hash) do nothing;
  get diagnostics n = row_count;

  insert into raw.periodic_fetches (endpoint, corp_code, period_key, status_code, item_count, run_id)
  values (p_endpoint, p_corp_code, p_period_key, p_status_code, jsonb_array_length(coalesce(p_items, '[]'::jsonb)), p_run_id)
  on conflict (endpoint, corp_code, period_key) do update set
    status_code = excluded.status_code, item_count = excluded.item_count,
    run_id = excluded.run_id, fetched_at = now();
  return n;
end
$$;

-- 신고서 원문 ---------------------------------------------------------------
-- 어떤 공시의 원문을 받을지는 ref.document_fetch_rules 가 정한다 (파서 단계에서 채움).
create table ref.document_fetch_rules (
  rule_id         int generated always as identity primary key,
  priority        int  not null,
  report_pattern  text not null,
  purpose         text not null,                   -- bond_terms / ipo_terms / mezz_put ...
  lookback_days   int,                             -- 접수일 기준 최근 N일만 (null = 전체)
  is_active       boolean not null default false,  -- 파서가 준비되면 켠다
  note            text
);

create table raw.document_fetches (
  rcept_no     text primary key,
  status       text not null,                      -- ok / missing / error
  files        int  not null default 0,
  bytes        int  not null default 0,
  run_id       bigint references ops.ingest_runs (run_id),
  fetched_at   timestamptz not null default now()
);

create or replace function public.ingest_put_document(
  p_run_id bigint, p_rcept_no text, p_section text, p_content text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into raw.documents (rcept_no, section, content, fetched_at)
  values (p_rcept_no, p_section, p_content, now())
  on conflict (rcept_no, section) do update set content = excluded.content, fetched_at = now()
$$;

create or replace function public.ingest_mark_document(
  p_run_id bigint, p_rcept_no text, p_status text, p_files int, p_bytes int)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into raw.document_fetches (rcept_no, status, files, bytes, run_id)
  values (p_rcept_no, p_status, p_files, p_bytes, p_run_id)
  on conflict (rcept_no) do update set
    status = excluded.status, files = excluded.files, bytes = excluded.bytes,
    run_id = excluded.run_id, fetched_at = now()
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
  where not exists (select 1 from raw.document_fetches d where d.rcept_no = f.rcept_no and d.status in ('ok', 'missing'))
  order by f.rcept_no desc, r.priority
  limit p_limit
$$;

-- 한국은행 ECOS 금리 ----------------------------------------------------------
-- 통계표·항목명 정규식으로 정의한다. 항목코드는 수집기가 ECOS 항목 목록에서 이름으로 찾는다.
create table ref.rate_series (
  series_key    text primary key,
  stat_code     text not null,                     -- ECOS 통계표 코드
  item_pattern  text not null,                     -- 항목명 정규식
  cycle         text not null default 'D',
  label_ko      text not null,
  grp           text not null,                     -- 정책 / 국고채 / 회사채 / 단기
  sort_order    int  not null,
  is_active     boolean not null default true
);

insert into ref.rate_series (series_key, stat_code, item_pattern, label_ko, grp, sort_order) values
  ('base_rate',  '722Y001', '기준금리',                 '한국은행 기준금리', '정책',   10),
  ('cd91',       '817Y002', '^CD\s*\(91일\)',           'CD 91일',          '단기',   20),
  ('ktb3y',      '817Y002', '^국고채\s*\(3년\)',        '국고채 3년',       '국고채', 30),
  ('ktb5y',      '817Y002', '^국고채\s*\(5년\)',        '국고채 5년',       '국고채', 40),
  ('ktb10y',     '817Y002', '^국고채\s*\(10년\)',       '국고채 10년',      '국고채', 50),
  ('corp3y_aa',  '817Y002', '^회사채\s*\(3년\s*,\s*AA-\)',  '회사채 3년 AA-',  '회사채', 60),
  ('corp3y_bbb', '817Y002', '^회사채\s*\(3년\s*,\s*BBB-\)', '회사채 3년 BBB-', '회사채', 70);

create table raw.rates (
  series_key  text not null references ref.rate_series (series_key),
  dt          date not null,
  value       numeric not null,
  fetched_at  timestamptz not null default now(),
  primary key (series_key, dt)
);

create or replace function public.ingest_rate_series()
returns table (series_key text, stat_code text, item_pattern text, cycle text, last_dt date)
language sql
stable
security definer
set search_path = ''
as $$
  select s.series_key, s.stat_code, s.item_pattern, s.cycle, (select max(r.dt) from raw.rates r where r.series_key = s.series_key)
  from ref.rate_series s
  where s.is_active
  order by s.sort_order
$$;

-- p_items: [{dt: 'YYYY-MM-DD', value: number}]
create or replace function public.ingest_put_rates(p_series_key text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.rates (series_key, dt, value)
  select p_series_key, (x ->> 'dt')::date, (x ->> 'value')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where x ->> 'value' ~ '^-?[0-9.]+$'
  on conflict (series_key, dt) do update set value = excluded.value, fetched_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

-- 권한 --------------------------------------------------------------------
revoke execute on function
  public.ingest_periodic_targets(text, int),
  public.ingest_put_periodic(bigint, text, text, text, text, jsonb),
  public.ingest_put_document(bigint, text, text, text),
  public.ingest_mark_document(bigint, text, text, int, int),
  public.ingest_pending_documents(int),
  public.ingest_rate_series(),
  public.ingest_put_rates(text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.ingest_periodic_targets(text, int),
  public.ingest_put_periodic(bigint, text, text, text, text, jsonb),
  public.ingest_put_document(bigint, text, text, text),
  public.ingest_mark_document(bigint, text, text, int, int),
  public.ingest_pending_documents(int),
  public.ingest_rate_series(),
  public.ingest_put_rates(text, jsonb)
to service_role;

grant all on raw.periodic_fetches, raw.document_fetches, raw.rates to service_role;
grant select on ref.periodic_endpoints, ref.document_fetch_rules, ref.rate_series to service_role;

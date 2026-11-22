-- =====================================================================
-- 딜 발굴 데스크 (에이전트 부서)
--
-- 공시·뉴스로 시장을 보고 → 자금이 필요해 보이는 회사를 고르고 → 조사해서 → 미팅용 1pager 를 낸다.
-- 실행 코드는 desk/ (Python). 여기에는 저장 표, 부서가 읽는 입력 묶음, 화면용 뷰를 둔다.
--
-- - desk.*        부서의 기록 (실행, 호출, 본 것, 신호, 대상 보드). 노출하지 않는다.
-- - raw.news      뉴스 수집 원본 (검색 API 가 주는 제목·요약 한 줄·출처·주소. 본문은 저장하지 않는다)
-- - ref.desk_news_queries  뉴스 검색어. 현업 합의로 바꾸는 값이라 행으로 둔다
-- - public.desk_* 부서(service_role)만 부르는 함수
-- - mart.v_desk_* 화면용
-- =====================================================================

create schema if not exists desk;
revoke all on schema desk from anon, authenticated;
grant usage on schema desk to service_role;

-- ---------------------------------------------------------------------
-- 실행과 호출 기록
-- ---------------------------------------------------------------------
create table if not exists desk.runs (
  run_id      text primary key,
  kind        text not null default 'daily',          -- daily | brief(회사 지정)
  status      text not null default 'running' check (status in ('running', 'done', 'partial', 'failed')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd    numeric,
  summary     jsonb
);
comment on table desk.runs is '딜 발굴 데스크 실행 1회 = 1행';

create table if not exists desk.calls (
  id            bigint generated always as identity primary key,
  run_id        text references desk.runs (run_id) on delete cascade,
  agent         text not null,
  dept          text,
  slot          integer not null default 1,
  model         text,
  item          text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,                           -- 비어 있으면 진행 중
  status        text,
  error         text,
  input_tokens  integer,
  output_tokens integer,
  searches      integer,
  cost_usd      numeric,
  summary       text,
  output        jsonb
);
create index if not exists calls_run_idx on desk.calls (run_id, id);
comment on table desk.calls is '에이전트 호출 1회 = 1행 (일감, 결과 요약, 토큰, 검색 수, 비용)';

-- ---------------------------------------------------------------------
-- 뉴스
-- ---------------------------------------------------------------------
create table if not exists raw.news (
  url_hash     text primary key,
  url          text not null,
  title        text not null,
  snippet      text,
  source       text,
  published_at timestamptz,
  query        text,
  grp          text,
  fetched_at   timestamptz not null default now()
);
create index if not exists news_fetched_idx on raw.news (fetched_at desc);
comment on table raw.news is '뉴스 검색 API 에서 받은 기사 제목·요약 한 줄·출처·주소 (본문 없음)';

create table if not exists ref.desk_news_queries (
  query  text primary key,
  grp    text not null,          -- 투자·증설 | 인수·매각 | 조달·차환 | 신용·유동성
  active boolean not null default true,
  note   text
);
comment on table ref.desk_news_queries is '딜 발굴 데스크의 뉴스 검색어. 현업 인터뷰 뒤 행을 고친다';

insert into ref.desk_news_queries (query, grp, note) values
  ('신규 시설투자 결정',   '투자·증설', '시니어 RM: 대규모 투자(capex) 뉴스가 뜨면 바로 약속'),
  ('공장 증설 투자',       '투자·증설', null),
  ('생산능력 확대 투자',   '투자·증설', null),
  ('인수 추진',            '인수·매각', 'M&A 는 인수 자금 수요'),
  ('지분 인수 결정',       '인수·매각', null),
  ('매각 추진',            '인수·매각', '자산·사업 매각은 유동성 확보 신호'),
  ('회사채 발행 검토',     '조달·차환', null),
  ('유상증자 검토',        '조달·차환', null),
  ('자금 조달 추진',       '조달·차환', null),
  ('차입금 상환 부담',     '신용·유동성', null),
  ('신용등급 전망 하향',   '신용·유동성', null),
  ('유동성 확보',          '신용·유동성', null)
on conflict (query) do nothing;

-- ---------------------------------------------------------------------
-- 본 것, 신호, 대상 보드
-- ---------------------------------------------------------------------
create table if not exists desk.seen (
  src_type text not null,        -- filing | news
  src_ref  text not null,        -- 접수번호 | url_hash
  run_id   text,
  seen_at  timestamptz not null default now(),
  primary key (src_type, src_ref)
);
comment on table desk.seen is '모니터링팀이 이미 읽은 공시·기사. 같은 것을 두 번 읽지 않는다';

create table if not exists desk.signals (
  id         bigint generated always as identity primary key,
  run_id     text,
  src_type   text not null,      -- filing | news | rule
  src_ref    text not null,
  src_dt     date,
  corp_code  text,
  corp_name  text not null,
  need       text,               -- 투자·증설 | 인수·지분취득 | 차환·상환 | 유동성 압박 | 재무구조 개선 | 지배구조 변화
  what       text,
  why        text,
  strength   integer,
  url        text,
  created_at timestamptz not null default now(),
  unique (src_type, src_ref, corp_name)
);
create index if not exists signals_corp_idx on desk.signals (corp_code, created_at desc);
comment on table desk.signals is '자금 수요로 이어질 수 있다고 본 신호';

create table if not exists desk.leads (
  lead_id      bigint generated always as identity primary key,
  corp_code    text not null,
  corp_name    text not null,
  status       text not null default '대기' check (status in ('대기', '게시', '보류', '기각')),
  origin       text not null default 'daily',   -- daily | request
  priority     integer,
  need         text,
  hypothesis   text,           -- 왜, 얼마쯤, 언제 돈이 필요할 것 같은가
  signals      jsonb,          -- 근거 신호
  questions    jsonb,          -- 조사팀이 확인할 것
  kill         text,           -- 이러면 대상이 아니다
  dossier      jsonb,          -- 조사에 쓴 데이터 묶음(공시 이력·만기·재무·유사 사례)
  research     jsonb,          -- 조사 결과
  brief        jsonb,          -- 1pager 원고(칸별)
  brief_md     text,           -- 1pager 본문
  verify       jsonb,          -- 검수 결과
  note         text,           -- 보류·기각 사유 한 줄
  run_id       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists leads_corp_idx on desk.leads (corp_code, created_at desc);
create index if not exists leads_status_idx on desk.leads (status, created_at desc);
comment on table desk.leads is '대상 보드. 회사 1곳 = 1행, 단계 결과를 붙여 두어 다음 실행이 끝난 단계를 건너뛴다';

grant all on all tables in schema desk to service_role;
grant all on all sequences in schema desk to service_role;
grant all on raw.news, ref.desk_news_queries to service_role;

-- ---------------------------------------------------------------------
-- 부서가 부르는 함수
-- ---------------------------------------------------------------------
create or replace function public.desk_run_start(p_run_id text, p_kind text default 'daily')
returns text language sql security definer set search_path = '' as $$
  insert into desk.runs (run_id, kind) values (p_run_id, p_kind)
  on conflict (run_id) do update set status = 'running', started_at = now()
  returning run_id
$$;

create or replace function public.desk_run_finish(p_run_id text, p_status text, p_cost numeric, p_summary jsonb default null)
returns void language sql security definer set search_path = '' as $$
  update desk.runs set finished_at = now(), status = p_status, cost_usd = p_cost, summary = p_summary where run_id = p_run_id
$$;

-- 오늘(KST) 끝났거나 도는 같은 종류의 실행이 있는가
create or replace function public.desk_ran_today(p_kind text default 'daily')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from desk.runs
    where kind = p_kind
      and (started_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
      and (status = 'done' or (status = 'running' and started_at > now() - interval '3 hours'))
  )
$$;

create or replace function public.desk_call_start(p jsonb)
returns bigint language sql security definer set search_path = '' as $$
  insert into desk.calls (run_id, agent, dept, slot, model, item)
  values (p ->> 'run_id', p ->> 'agent', p ->> 'dept', coalesce((p ->> 'slot')::int, 1), p ->> 'model', left(p ->> 'item', 300))
  returning id
$$;

create or replace function public.desk_call_finish(p_id bigint, p jsonb)
returns void language sql security definer set search_path = '' as $$
  update desk.calls set
    finished_at = now(), status = p ->> 'status', error = p ->> 'error',
    input_tokens = (p ->> 'input_tokens')::int, output_tokens = (p ->> 'output_tokens')::int,
    searches = (p ->> 'searches')::int, cost_usd = (p ->> 'cost_usd')::numeric,
    summary = left(p ->> 'summary', 300), output = p -> 'output'
  where id = p_id
$$;

create or replace function public.desk_news_queries()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('query', query, 'grp', grp) order by grp, query), '[]'::jsonb)
  from ref.desk_news_queries where active
$$;

create or replace function public.desk_news_put(p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into raw.news (url_hash, url, title, snippet, source, published_at, query, grp)
  select x ->> 'url_hash', x ->> 'url', left(x ->> 'title', 400), left(x ->> 'snippet', 400), x ->> 'source', (x ->> 'published_at')::timestamptz, x ->> 'query', x ->> 'grp'
  from jsonb_array_elements(p_items) x
  where coalesce(x ->> 'url_hash', '') <> '' and coalesce(x ->> 'title', '') <> ''
  on conflict (url_hash) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 모니터링팀·발굴팀의 입력 묶음: 아직 안 읽은 공시와 기사, 규칙이 뽑은 후보, 최근 보드
create or replace function public.desk_inputs(p_days integer default 3, p_filing_cap integer default 160, p_news_cap integer default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
  with f as (
    select k.rcept_no, k.rcept_dt, k.corp_code, k.corp_name, k.market, k.label, k.grp, k.facts, k.size_krw,
           k.latest_bond_rating, k.outstanding_bond_krw, k.dart_url, k.weight,
           e.cat as exp_cat, e.purpose as exp_purpose, e.target as exp_target, e.ratio_pct as exp_ratio_pct, e.funding_note as exp_funding_note
    from mart.v_key_filings k
    left join lateral (
      select x.cat, x.purpose, x.target, x.ratio_pct, x.funding_note
      from mart.v_expansion_events x where x.rcept_no = k.rcept_no limit 1
    ) e on true
    where k.rcept_dt >= current_date - p_days
      and not exists (select 1 from desk.seen s where s.src_type = 'filing' and s.src_ref = k.rcept_no)
    order by k.rcept_dt desc, k.weight desc nulls last
    limit p_filing_cap
  ),
  n as (
    select w.url_hash, w.title, w.snippet, w.source, w.published_at, w.grp, w.url
    from raw.news w
    where w.fetched_at >= now() - make_interval(days => p_days)
      and coalesce(w.published_at, w.fetched_at) >= now() - make_interval(days => p_days + 4)
      and not exists (select 1 from desk.seen s where s.src_type = 'news' and s.src_ref = w.url_hash)
    order by coalesce(w.published_at, w.fetched_at) desc
    limit p_news_cap
  )
  select jsonb_build_object(
    'filings', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'ref', rcept_no, 'dt', rcept_dt, 'corp_code', corp_code, 'corp_name', corp_name, 'market', market,
        'label', label, 'grp', grp, 'facts', facts, 'size_krw', size_krw, 'rating', latest_bond_rating,
        'outstanding_bond_krw', outstanding_bond_krw, 'url', dart_url,
        'expansion', case when exp_cat is null then null else jsonb_strip_nulls(jsonb_build_object(
            'cat', exp_cat, 'purpose', exp_purpose, 'target', exp_target, 'ratio_pct', exp_ratio_pct, 'funding_note', exp_funding_note)) end
      ))) from f), '[]'::jsonb),
    'news', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'ref', url_hash, 'dt', (published_at at time zone 'Asia/Seoul')::date, 'title', title, 'snippet', snippet, 'source', source, 'grp', grp, 'url', url
      ))) from n), '[]'::jsonb),
    'rules', coalesce(public.ingest_signal_candidates(current_date), '[]'::jsonb),
    'data', (select jsonb_build_object('latest_filing_dt', d.latest_filing_dt, 'last_refresh_at', d.last_refresh_at) from mart.v_data_status d limit 1),
    'board', coalesce((select jsonb_agg(jsonb_build_object(
        'lead_id', l.lead_id, 'corp_code', l.corp_code, 'corp_name', l.corp_name, 'status', l.status,
        'need', l.need, 'hypothesis', l.hypothesis, 'note', l.note, 'created', l.created_at::date) order by l.created_at desc)
      from desk.leads l where l.created_at >= now() - interval '45 days'), '[]'::jsonb)
  )
$$;

create or replace function public.desk_seen_put(p_run_id text, p_items jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into desk.seen (src_type, src_ref, run_id)
  select x ->> 'src_type', x ->> 'src_ref', p_run_id from jsonb_array_elements(p_items) x
  where coalesce(x ->> 'src_ref', '') <> ''
  on conflict do nothing
$$;

create or replace function public.desk_signals_put(p_run_id text, p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into desk.signals (run_id, src_type, src_ref, src_dt, corp_code, corp_name, need, what, why, strength, url)
  select p_run_id, x ->> 'src_type', x ->> 'src_ref', nullif(x ->> 'src_dt', '')::date, nullif(x ->> 'corp_code', ''), x ->> 'corp_name',
         x ->> 'need', x ->> 'what', x ->> 'why', nullif(x ->> 'strength', '')::int, x ->> 'url'
  from jsonb_array_elements(p_items) x
  where coalesce(x ->> 'corp_name', '') <> '' and coalesce(x ->> 'src_ref', '') <> ''
  on conflict (src_type, src_ref, corp_name) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 최근 신호 (회사별로 모아 발굴팀에 넘긴다)
create or replace function public.desk_recent_signals(p_days integer default 14)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'src_type', s.src_type, 'src_ref', s.src_ref, 'dt', s.src_dt, 'corp_code', s.corp_code, 'corp_name', s.corp_name,
      'need', s.need, 'what', s.what, 'why', s.why, 'strength', s.strength, 'url', s.url)) order by s.created_at desc), '[]'::jsonb)
  from desk.signals s where s.created_at >= now() - make_interval(days => p_days)
$$;

create or replace function public.desk_find_company(p_q text, p_limit integer default 5)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from mart.search_companies(p_q, p_limit) s
$$;

-- 회사 한 곳의 데이터 묶음: 개요, 단기 차입, 만기, 조달 이력, 주요 공시, 사업 확장, 관련 기사
create or replace function public.desk_company(p_corp_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'overview', (select to_jsonb(o) from mart.v_company_overview o where o.corp_code = p_corp_code limit 1),
    'short_debt', (select to_jsonb(d) from mart.v_company_short_debt d where d.corp_code = p_corp_code order by d.stlm_dt desc limit 1),
    'maturities', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'product', m.product_label, 'sub_type', m.sub_type, 'series', m.series, 'event', m.event_type, 'event_dt', m.event_dt,
        'days_left', m.days_left, 'amount_krw', m.amount_krw, 'rating', m.rating, 'coupon_pct', m.coupon_pct,
        'lead_managers', m.lead_managers, 'nh_lead', m.nh_lead, 'refi_signal', m.refi_signal)) order by m.event_dt)
      from (select * from mart.v_maturities x where x.corp_code = p_corp_code and x.days_left >= 0 order by x.event_dt limit 15) m), '[]'::jsonb),
    'deals', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'product', d.product_label, 'sub_type', d.sub_type, 'series', d.series, 'status', d.status, 'deal_dt', d.deal_dt,
        'amount_krw', d.amount_krw, 'rating', d.rating, 'tenor_months', d.tenor_months, 'maturity_dt', d.maturity_dt,
        'coupon_pct', d.coupon_pct, 'yield_pct', d.yield_pct, 'competition_ratio', d.competition_ratio, 'final_spread_bp', d.final_spread_bp,
        'ytm_pct', d.ytm_pct, 'conv_price', d.conv_price, 'put_start_dt', d.put_start_dt, 'dilution_pct', d.dilution_pct,
        'lead_managers', d.lead_managers, 'nh_lead', d.nh_lead, 'url', d.dart_url)) order by d.deal_dt desc)
      from (select * from mart.v_deals x where x.corp_code = p_corp_code order by x.deal_dt desc nulls last limit 12) d), '[]'::jsonb),
    'filings', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'dt', k.rcept_dt, 'label', k.label, 'grp', k.grp, 'facts', k.facts, 'size_krw', k.size_krw, 'url', k.dart_url)) order by k.rcept_dt desc)
      from (select * from mart.v_key_filings x where x.corp_code = p_corp_code and x.rcept_dt >= current_date - 365 order by x.rcept_dt desc limit 20) k), '[]'::jsonb),
    'expansions', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'decided_dt', e.decided_dt, 'src', e.src_label, 'cat', e.cat, 'amount_krw', e.amount_krw, 'ratio_pct', e.ratio_pct,
        'ratio_basis', e.ratio_basis, 'target', e.target, 'purpose', e.purpose, 'end_dt', e.end_dt, 'funding_note', e.funding_note, 'url', e.dart_url)) order by e.rcept_dt desc)
      from (select * from mart.v_expansion_events x where x.corp_code = p_corp_code order by x.rcept_dt desc limit 8) e), '[]'::jsonb),
    'news', coalesce((select jsonb_agg(jsonb_build_object(
        'dt', (w.published_at at time zone 'Asia/Seoul')::date, 'title', w.title, 'source', w.source, 'url', w.url) order by w.published_at desc nulls last)
      from (select * from raw.news x
            where length(c.corp_name) >= 2 and position(c.corp_name in x.title) > 0
            order by x.published_at desc nulls last limit 12) w), '[]'::jsonb)
  )
  from (select coalesce((select o.corp_name from mart.v_company_overview o where o.corp_code = p_corp_code limit 1), '') as corp_name) c
$$;

-- 유사 사례: 공모채 등급이 있으면 같은 등급군의 최근 6개월 공모채, 없으면 같은 시장의 최근 6개월 메자닌·유상증자
create or replace function public.desk_comps(p_corp_code text, p_months integer default 6)
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (
    select o.corp_code, o.market, o.latest_bond_rating,
           (select d.rating_group from mart.v_deals d
             where d.corp_code = o.corp_code and d.product_type = 'bond' and d.rating_group is not null
             order by d.deal_dt desc nulls last limit 1) as rating_group
    from mart.v_company_overview o where o.corp_code = p_corp_code limit 1
  ),
  b as (
    select d.* from mart.v_deals d, me
    where me.rating_group is not null and d.product_type = 'bond' and d.is_public and d.rating_group = me.rating_group
      and d.corp_code <> me.corp_code and d.status <> 'withdrawn'
      and d.deal_dt >= current_date - make_interval(months => p_months) and d.deal_dt <= current_date + 30
    order by d.deal_dt desc limit 12
  ),
  z as (
    select d.* from mart.v_deals d, me
    where me.rating_group is null and d.product_type = 'mezz' and d.market is not distinct from me.market
      and d.corp_code <> me.corp_code and d.status <> 'withdrawn'
      and d.deal_dt >= current_date - make_interval(months => p_months) and d.deal_dt <= current_date
    order by d.deal_dt desc limit 10
  ),
  q as (
    select d.* from mart.v_deals d, me
    where me.rating_group is null and d.product_type = 'equity' and d.market is not distinct from me.market
      and d.corp_code <> me.corp_code and d.status <> 'withdrawn'
      and d.deal_dt >= current_date - make_interval(months => p_months) and d.deal_dt <= current_date
    order by d.deal_dt desc limit 6
  )
  select jsonb_build_object(
    'basis', (select case when rating_group is not null then '같은 등급군(' || rating_group || ') 공모 회사채, 최근 ' || p_months || '개월'
                          else '같은 시장(' || coalesce(market, '미상') || ') 메자닌·유상증자, 최근 ' || p_months || '개월' end from me),
    'bonds', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'corp_name', corp_name, 'deal_dt', deal_dt, 'series', series, 'amount_krw', amount_krw, 'rating', rating, 'tenor_months', tenor_months,
        'yield_pct', yield_pct, 'competition_ratio', competition_ratio, 'final_spread_bp', final_spread_bp, 'is_increased', is_increased,
        'lead_managers', lead_managers, 'url', dart_url)) order by deal_dt desc) from b), '[]'::jsonb),
    'mezz', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'corp_name', corp_name, 'deal_dt', deal_dt, 'sub_type', sub_type, 'amount_krw', amount_krw, 'coupon_pct', coupon_pct, 'ytm_pct', ytm_pct,
        'refix_floor_ratio_pct', refix_floor_ratio_pct, 'put_start_dt', put_start_dt, 'dilution_pct', dilution_pct, 'url', dart_url)) order by deal_dt desc) from z), '[]'::jsonb),
    'equity', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'corp_name', corp_name, 'deal_dt', deal_dt, 'sub_type', sub_type, 'amount_krw', amount_krw, 'shares_ratio_pct', shares_ratio_pct,
        'offer_price', offer_price, 'lead_managers', lead_managers, 'url', dart_url)) order by deal_dt desc) from q), '[]'::jsonb)
  )
$$;

-- 대상 보드에 쓰기: lead_id 가 있으면 준 칸만 고치고, 없으면 새로 넣는다
create or replace function public.desk_lead_put(p jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint := nullif(p ->> 'lead_id', '')::bigint;
begin
  if v_id is null then
    insert into desk.leads (corp_code, corp_name, status, origin, priority, need, hypothesis, signals, questions, kill, run_id)
    values (p ->> 'corp_code', p ->> 'corp_name', coalesce(p ->> 'status', '대기'), coalesce(p ->> 'origin', 'daily'),
            nullif(p ->> 'priority', '')::int, p ->> 'need', p ->> 'hypothesis', p -> 'signals', p -> 'questions', p ->> 'kill', p ->> 'run_id')
    returning lead_id into v_id;
  else
    update desk.leads l set
      status       = coalesce(p ->> 'status', l.status),
      dossier      = case when p ? 'dossier' then p -> 'dossier' else l.dossier end,
      research     = case when p ? 'research' then p -> 'research' else l.research end,
      brief        = case when p ? 'brief' then p -> 'brief' else l.brief end,
      brief_md     = case when p ? 'brief_md' then p ->> 'brief_md' else l.brief_md end,
      verify       = case when p ? 'verify' then p -> 'verify' else l.verify end,
      note         = case when p ? 'note' then p ->> 'note' else l.note end,
      run_id       = coalesce(p ->> 'run_id', l.run_id),
      published_at = case when p ->> 'status' = '게시' then now() else l.published_at end,
      updated_at   = now()
    where l.lead_id = v_id;
  end if;
  return v_id;
end $$;

-- 끝나지 않은 대상(대기) — 다음 실행이 이어서 한다
create or replace function public.desk_open_leads()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(l) order by l.priority nulls last, l.created_at), '[]'::jsonb)
  from desk.leads l where l.status = '대기' and l.created_at >= now() - interval '7 days'
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'desk\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 화면용
-- ---------------------------------------------------------------------
create or replace view mart.v_desk_briefs as
select l.lead_id, l.corp_code, l.corp_name, l.need, l.hypothesis, l.priority, l.origin,
       l.brief ->> 'headline' as headline, l.brief, l.brief_md,
       l.verify ->> 'state' as verify_state, l.published_at, l.created_at
from desk.leads l
where l.status = '게시';

create or replace view mart.v_desk_board as
select l.lead_id, l.corp_code, l.corp_name, l.status, l.origin, l.priority, l.need, l.hypothesis, l.note,
       l.signals, l.created_at, l.updated_at, l.published_at
from desk.leads l;

create or replace view mart.v_desk_signals as
select s.id, s.src_type, s.src_ref, s.src_dt, s.corp_code, s.corp_name, s.need, s.what, s.why, s.strength, s.url, s.created_at
from desk.signals s;

create or replace view mart.v_desk_runs as
select r.run_id, r.kind, r.status, r.started_at, r.finished_at, r.cost_usd, r.summary
from desk.runs r;

create or replace view mart.v_desk_calls as
select c.id, c.run_id, c.agent, c.dept, c.slot, c.model, c.item, c.started_at, c.finished_at, c.status, c.error,
       c.input_tokens, c.output_tokens, c.searches, c.cost_usd, c.summary
from desk.calls c;

grant select on mart.v_desk_briefs, mart.v_desk_board, mart.v_desk_signals, mart.v_desk_runs, mart.v_desk_calls to anon, authenticated, service_role;

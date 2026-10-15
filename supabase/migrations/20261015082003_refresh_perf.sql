-- =====================================================================
-- 09. 회사 마스터 갱신 속도 개선 + 수집기 실행 시간 한도
--
-- 문제: 12만 개 회사를 매번 공시·기업개황과 조인해 갱신 → API 실행 시간 한도(8초) 초과
-- 개선: (1) 바뀐 행만 갱신 (2) 시장 구분은 공시가 있는 회사만 별도 갱신 (3) service_role 한도 상향
-- =====================================================================

create or replace function core.refresh_companies()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n_master int;
  n_extra  int;
  n_market int;
begin
  -- 1) corpCode 마스터: 새 회사·이름·종목코드 변경분만
  insert into core.companies (corp_code, corp_name, corp_name_eng, stock_code, updated_at)
  select c.corp_code, c.corp_name, c.corp_eng_name, nullif(trim(c.stock_code), ''), now()
  from raw.corp_codes c
  on conflict (corp_code) do update set
    corp_name     = excluded.corp_name,
    corp_name_eng = coalesce(excluded.corp_name_eng, core.companies.corp_name_eng),
    stock_code    = excluded.stock_code,
    updated_at    = now()
  where (core.companies.corp_name, core.companies.stock_code)
        is distinct from (excluded.corp_name, excluded.stock_code);
  get diagnostics n_master = row_count;

  -- 2) corpCode 에 아직 없는 공시 회사 보강
  insert into core.companies (corp_code, corp_name, stock_code, updated_at)
  select distinct on (f.corp_code) f.corp_code, f.corp_name, f.stock_code, now()
  from raw.filings f
  where not exists (select 1 from core.companies c where c.corp_code = f.corp_code)
  order by f.corp_code, f.rcept_dt desc
  on conflict (corp_code) do nothing;
  get diagnostics n_extra = row_count;

  -- 3) 시장 구분: 공시가 있는 회사만 (최근 공시의 법인구분)
  update core.companies c
     set market = x.market, updated_at = now()
    from (
      select distinct on (f.corp_code) f.corp_code,
        case f.corp_cls when 'Y' then '유가증권' when 'K' then '코스닥' when 'N' then '코넥스' when 'E' then '기타' end as market
      from raw.filings f
      order by f.corp_code, f.rcept_dt desc
    ) x
   where c.corp_code = x.corp_code and c.market is distinct from x.market and x.market is not null;
  get diagnostics n_market = row_count;

  -- 4) 업종 (기업개황을 받은 회사만)
  update core.companies c
     set induty_code = x.induty_code, updated_at = now()
    from (
      select distinct on (a.corp_code) a.corp_code, a.item ->> 'induty_code' as induty_code
      from raw.api_items a
      where a.endpoint = 'company'
      order by a.corp_code, a.fetched_at desc
    ) x
   where c.corp_code = x.corp_code and c.induty_code is distinct from x.induty_code;

  return n_master + n_extra + n_market;
end
$$;

create index if not exists filings_corp_only_idx on raw.filings (corp_code);

-- 수집기(service_role)의 API 실행 시간 한도: 기본 8초 → 5분
alter role service_role set statement_timeout = '300s';
notify pgrst, 'reload config';

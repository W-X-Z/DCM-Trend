-- =====================================================================
-- 11. 과거 회사채 백필 대상 (회사 단위)
--
-- 회사 미지정 공시검색은 발행공시 전체(파생결합증권 포함)를 받아야 해서 호출이 너무 많다.
-- 대신 공모채를 발행했거나 잔액이 있는 회사만 골라 회사별로 과거 발행공시를 받는다.
--   1) 수집 기간에 공모채 딜이 있는 회사
--   2) 정기보고서 '회사채 미상환 잔액'에 공모 잔액이 있는 회사
-- 받은 회사는 raw.periodic_fetches 에 endpoint = 'history_bond_list' 로 기록한다.
-- =====================================================================

create or replace function public.ingest_history_bond_corps(p_period_key text, p_limit int default 500)
returns table (corp_code text)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select d.corp_code from core.deals d where d.product_type = 'bond'
    union
    select a.corp_code
    from raw.api_items a
    where a.endpoint = 'cprndNrdmpBlce'
      and coalesce(a.item ->> 'remndr_exprtn2', '') ~ '공모'   -- remndr_exprtn1 = '미상환잔액', remndr_exprtn2 = 공모·사모·합계
      and coalesce(core.parse_numeric(a.item ->> 'sm'), 0) > 0
  )
  select c.corp_code
  from c
  where not exists (
    select 1 from raw.periodic_fetches f
    where f.endpoint = 'history_bond_list' and f.corp_code = c.corp_code and f.period_key = p_period_key
      and f.status_code in ('000', '013')
  )
  order by c.corp_code
  limit p_limit
$$;

revoke execute on function public.ingest_history_bond_corps(text, int) from public, anon, authenticated;
grant execute on function public.ingest_history_bond_corps(text, int) to service_role;

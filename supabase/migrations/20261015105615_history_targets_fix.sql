-- 정기보고서 잔액 구분 필드 수정 (remndr_exprtn2 = 공모·사모·합계). 원격 이력과 맞추기 위한 파일
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

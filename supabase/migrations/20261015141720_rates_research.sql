-- 금리: ECOS 인증키 없이도 채울 수 있게 '조사 값'을 받는다.
-- 예약 작업(Claude)이 영업일 장 마감 뒤 기사·공개 자료에서 금리를 찾아 출처와 함께 넣는다.
-- ECOS 값이 들어오면 같은 날짜의 조사 값을 덮어쓴다(ECOS 우선). 조사 값은 ECOS 값을 덮어쓰지 않는다.
-- 화면 캐시 버전에 눈여겨볼 회사·금리 갱신 시각도 넣는다.

alter table raw.rates add column if not exists source text not null default 'ecos';
alter table raw.rates add column if not exists source_url text;

create or replace function public.ingest_put_rates(p_series_key text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.rates (series_key, dt, value, source, source_url)
  select p_series_key, (x ->> 'dt')::date, (x ->> 'value')::numeric, 'ecos', null
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where x ->> 'value' ~ '^-?[0-9.]+$'
  on conflict (series_key, dt) do update set
    value = excluded.value, source = 'ecos', source_url = null, fetched_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

-- p_rows: [{"series_key":"ktb3y","dt":"2026-10-15","value":3.921,"source_url":"https://..."}]
create or replace function public.ingest_put_rates_research(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.rates (series_key, dt, value, source, source_url)
  select x ->> 'series_key', (x ->> 'dt')::date, (x ->> 'value')::numeric, 'research', nullif(x ->> 'source_url', '')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  where x ->> 'series_key' in (select s.series_key from ref.rate_series s)
    and x ->> 'value' ~ '^[0-9]+(\.[0-9]+)?$'
    and (x ->> 'value')::numeric between 0 and 30
    and (x ->> 'dt')::date <= current_date
  on conflict (series_key, dt) do update set
    value = excluded.value, source_url = excluded.source_url, fetched_at = now()
  where raw.rates.source = 'research';
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.ingest_put_rates_research(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_put_rates_research(jsonb) to service_role;

-- 최신값에 출처를 붙인다 (컬럼은 뒤에만 추가)
create or replace view mart.v_rate_latest as
select
  s.series_key, s.label_ko, s.grp, s.sort_order,
  l.dt, l.value,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 7   order by r.dt desc limit 1)) * 100, 1) as chg_1w_bp,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 30  order by r.dt desc limit 1)) * 100, 1) as chg_1m_bp,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 91  order by r.dt desc limit 1)) * 100, 1) as chg_3m_bp,
  round((l.value - (select r.value from raw.rates r where r.series_key = s.series_key and r.dt <= l.dt - 365 order by r.dt desc limit 1)) * 100, 1) as chg_1y_bp,
  l.source,
  l.source_url
from ref.rate_series s
cross join lateral (
  select r.dt, r.value, r.source, r.source_url from raw.rates r where r.series_key = s.series_key order by r.dt desc limit 1
) l
where s.is_active;

create or replace view mart.v_data_version as
select greatest(
  (select max(d.updated_at) from core.deals d),
  (select max(i.created_at) from core.insight_issue_sets i),
  (select max(r.fetched_at) from raw.rates r)) as data_version;

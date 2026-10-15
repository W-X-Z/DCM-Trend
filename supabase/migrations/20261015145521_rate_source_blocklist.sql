-- 금리 조사 값의 출처 제한: 원 출처를 확인할 수 없는 자동 생성 집계 사이트는 받지 않는다
create table if not exists ref.rate_source_blocklist (
  pattern text primary key,      -- source_url 정규식
  note    text
);

insert into ref.rate_source_blocklist (pattern, note) values
  ('xn--vj4b13a\.com|시세\.com', 'AI로 만든 것으로 보이는 집계 사이트. 원 출처 확인 불가 (2026-10-15 사용자 요청으로 제외)')
on conflict (pattern) do nothing;

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
    and nullif(x ->> 'source_url', '') is not null
    and not exists (select 1 from ref.rate_source_blocklist b where (x ->> 'source_url') ~* b.pattern)
  on conflict (series_key, dt) do update set
    value = excluded.value, source_url = excluded.source_url, fetched_at = now()
  where raw.rates.source = 'research';
  get diagnostics n = row_count;
  return n;
end
$$;

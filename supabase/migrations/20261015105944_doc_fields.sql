-- =====================================================================
-- 13. 신고서 원문 파싱 결과
--
-- 수집기가 원문을 내려받아 필요한 값만 뽑아 raw.doc_fields 에 넣는다(원문 전체는 저장하지 않음).
-- 어떤 공시의 원문을 받을지는 ref.document_fetch_rules, 뽑은 값의 반영은 core.apply_doc_fields().
-- =====================================================================

create table raw.doc_fields (
  rcept_no    text not null,
  purpose     text not null,                       -- bond / ipo / mezz
  field       text not null,
  series      text not null default '',            -- 회차(회사채), 만기 연수(가산금리), 없으면 ''
  value       text not null,
  run_id      bigint references ops.ingest_runs (run_id),
  parsed_at   timestamptz not null default now(),
  primary key (rcept_no, field, series)
);
create index doc_fields_field_idx on raw.doc_fields (purpose, field);

-- p_items: [{field, series, value}]
create or replace function public.ingest_put_doc_fields(p_run_id bigint, p_rcept_no text, p_purpose text, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into raw.doc_fields (rcept_no, purpose, field, series, value, run_id)
  select p_rcept_no, p_purpose, x ->> 'field', coalesce(x ->> 'series', ''), x ->> 'value', p_run_id
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where coalesce(x ->> 'value', '') <> ''
  on conflict (rcept_no, field, series) do update set
    value = excluded.value, run_id = excluded.run_id, parsed_at = now();
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.ingest_put_doc_fields(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_put_doc_fields(bigint, text, text, jsonb) to service_role;
grant all on raw.doc_fields to service_role;

insert into ref.document_fetch_rules (priority, report_pattern, purpose, lookback_days, is_active, note) values
  (10, '^\[발행조건확정\]증권신고서\(채무증권\)', 'bond', null, true, '금리·등급·밴드·확정 가산금리·수요예측'),
  (20, '^\[발행조건확정\]증권신고서\(지분증권\)', 'ipo', 900, true, '희망공모가 밴드·확정공모가·수요예측 경쟁률 (IPO 딜에만 반영)'),
  (30, '^주요사항보고서\((전환사채권|신주인수권부사채권|교환사채권)\s*발행\s*결정\)', 'mezz', 1100, true, '조기상환청구(풋) 일정');

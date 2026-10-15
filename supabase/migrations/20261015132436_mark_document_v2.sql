-- 파서 버전 표시는 새 수집기만 한다.
-- 이전 수집기(main 의 이전 코드)가 옛 파서로 읽고 ingest_mark_document 를 부르면 버전 1 로 남겨 새 파서가 다시 읽게 한다.
create or replace function public.ingest_mark_document_v2(
  p_run_id bigint, p_rcept_no text, p_status text, p_files int, p_bytes int)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into raw.document_fetches (rcept_no, status, files, bytes, run_id, parser_version)
  values (p_rcept_no, p_status, p_files, p_bytes, p_run_id,
          coalesce((select max(r.parser_version)
                    from raw.filings f
                    join ref.document_fetch_rules r on r.is_active and f.report_nm ~ r.report_pattern
                    where f.rcept_no = p_rcept_no), 1))
  on conflict (rcept_no) do update set
    status = excluded.status, files = excluded.files, bytes = excluded.bytes,
    run_id = excluded.run_id, parser_version = excluded.parser_version, fetched_at = now()
$$;

create or replace function public.ingest_mark_document(
  p_run_id bigint, p_rcept_no text, p_status text, p_files int, p_bytes int)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into raw.document_fetches (rcept_no, status, files, bytes, run_id, parser_version)
  values (p_rcept_no, p_status, p_files, p_bytes, p_run_id, 1)
  on conflict (rcept_no) do update set
    status = excluded.status, files = excluded.files, bytes = excluded.bytes,
    run_id = excluded.run_id, parser_version = 1, fetched_at = now()
$$;

revoke execute on function public.ingest_mark_document_v2(bigint, text, text, int, int) from public, anon, authenticated;
grant execute on function public.ingest_mark_document_v2(bigint, text, text, int, int) to service_role;

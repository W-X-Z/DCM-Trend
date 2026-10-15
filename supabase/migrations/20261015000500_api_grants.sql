-- =====================================================================
-- 05. 권한
--
-- 화면(anon·authenticated)은 mart 만 읽는다. raw·core·ref·ops 는 노출하지 않는다.
-- mart 뷰는 소유자 권한으로 core 를 읽고, mart 함수는 security definer 로 실행된다.
-- 로그인 필수로 바꾸려면 아래 anon 권한만 회수하면 된다(화면 코드 변경 없음).
--
-- Supabase 설정: API > Exposed schemas 에 'mart' 추가 필요
-- =====================================================================

revoke all on schema raw, core, ref, ops from anon, authenticated;

grant usage on schema mart to anon, authenticated;
grant select on all tables in schema mart to anon, authenticated;
grant execute on all functions in schema mart to anon, authenticated;
alter default privileges in schema mart grant select on tables to anon, authenticated;
alter default privileges in schema mart grant execute on functions to anon, authenticated;

-- 수집기(GitHub Actions)는 service_role 키로 raw·ops 에 쓰고 core 변환 함수를 실행한다.
grant usage on schema raw, core, ref, ops, mart to service_role;
grant all on all tables in schema raw, core, ref, ops to service_role;
grant all on all sequences in schema raw, core, ref, ops to service_role;
grant execute on all functions in schema core, mart to service_role;

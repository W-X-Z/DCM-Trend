-- mart.v_key_filings 를 anon 이 읽을 때 뷰 안의 함수 실행 권한은 조회하는 사람 기준으로 검사한다.
-- 공시 값 함수는 소유자 권한으로 돌게 하고(입력은 접수번호·엔드포인트뿐, raw 를 직접 열지 않음) 실행만 열어 준다.
alter function core.disc_facts(text, text) security definer;
alter function core.disc_size(text, text) security definer;
grant execute on function core.disc_facts(text, text), core.disc_size(text, text) to anon, authenticated;

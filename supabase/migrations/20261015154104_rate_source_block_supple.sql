-- 금리 조사 출처 차단 추가: 원 출처·작성자를 확인하지 못한 자동 생성형 주소의 사이트
insert into ref.rate_source_blocklist (pattern, note) values
  ('supple\.kr', '원 출처·작성자를 확인하지 못한 자동 생성형 주소의 사이트 (2026-10-16 시세.com 과 같은 기준으로 제외)')
on conflict (pattern) do nothing;

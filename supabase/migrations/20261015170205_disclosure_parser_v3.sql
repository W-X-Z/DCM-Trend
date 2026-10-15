-- 거래소 공시 파서 3차: 종류를 제목으로만 판단(본느 최대주주변경이 변경사유의 '주식양수도'로 오판되던 문제), 원리금 미지급 합계·사채 종류
update ref.document_fetch_rules set parser_version = 3 where purpose = 'disclosure' and parser_version < 3;

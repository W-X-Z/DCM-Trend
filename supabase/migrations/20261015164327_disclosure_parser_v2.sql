-- 거래소 공시 원문(HTML)의 <STYLE> 블록 때문에 종류를 못 알아본 채 '읽음'으로 표시된 공시를 다시 읽는다
update ref.document_fetch_rules set parser_version = 2 where purpose = 'disclosure' and parser_version < 2;

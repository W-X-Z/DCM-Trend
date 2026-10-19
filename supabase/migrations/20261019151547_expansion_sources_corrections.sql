-- 신규시설투자 정정공시([기재정정])도 원문을 읽는다(정정 후 금액·목적, 철회 여부 확인용)
update ref.document_fetch_rules
   set report_pattern = '^(\[[^]]*\])?신규\s*시설\s*투자',
       note = '신규시설투자(정정 포함): 사업 확장 선별용으로 1년 넘게 본다'
 where report_pattern = '^신규\s*시설\s*투자' and lookback_days = 400;

-- '취득 결정'으로 낸 공시(일부 시장)도 같은 상세 API 로 받아 본다
update ref.detail_fetch_rules set report_pattern = '타법인\s*주식\s*및\s*출자증권\s*(양수|취득)\s*결정'
 where endpoint = 'otcprStkInvscrInhDecsn';
update ref.detail_fetch_rules set report_pattern = '유형자산\s*(양수|취득)\s*결정'
 where endpoint = 'tgastInhDecsn';

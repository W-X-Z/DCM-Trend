-- 사업 확장 기업 선별용 원천 범위 넓히기
-- 1) 유형자산 양수·타법인 주식 양수·영업양수 상세(OpenDART 주요사항보고서 API)를 1년치(2025-10~)로
-- 2) 신규시설투자 원문(투자금액·자기자본 대비·목적·기간)을 400일치 읽는 규칙을 따로 둔다
--    (다른 거래소 공시는 기존 규칙대로 75일)
update ref.detail_fetch_rules
   set min_rcept_dt = '2025-10-01'
 where endpoint in ('tgastInhDecsn', 'otcprStkInvscrInhDecsn', 'bsnInhDecsn');

insert into ref.document_fetch_rules (priority, report_pattern, purpose, lookback_days, is_active, note, parser_version)
values (39, '^신규\s*시설\s*투자', 'disclosure', 400, true, '신규시설투자: 사업 확장 선별용으로 1년 넘게 본다', 3);

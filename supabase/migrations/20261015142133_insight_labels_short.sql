-- 지표 변화 타일에 맞게 이름을 짧게
update ref.insight_rules set label_ko = '최대 1건 비중' where fact_key in ('bond_top1_share', 'mezz_top1_share', 'equity_top1_share', 'ipo_top1_share');
update ref.insight_rules set label_ko = '3~6개월 뒤 만기 금액' where fact_key = 'mat_amount';
update ref.insight_rules set label_ko = '3~6개월 뒤 만기 회사' where fact_key = 'mat_companies';
update ref.insight_rules set label_ko = 'AA- 스프레드' where fact_key = 'aa_spread';
update ref.insight_rules set label_ko = 'BBB-·AA- 금리 차' where fact_key = 'bbb_spread';

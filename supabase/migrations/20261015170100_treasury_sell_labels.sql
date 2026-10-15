-- 자기주식 처분 결정(DS005 tsstkDpDecsn) 상세 값 라벨, 임직원 보상용 처분은 피드 점수를 낮춘다
insert into ref.detail_field_labels (endpoint, field, label_ko, unit, sort, is_size)
select v.endpoint, v.field, v.label_ko, v.unit, v.sort, v.is_size
from (values
  ('tsstkDpDecsn', 'dppln_prc_ostk', '처분예정금액', 'krw', 1, true),
  ('tsstkDpDecsn', 'dppln_stk_ostk', '처분 주식수', 'count', 2, false),
  ('tsstkDpDecsn', 'dp_pp', '처분목적', 'text', 3, false),
  ('tsstkDpDecsn', 'dp_m_otc', '장외처분 주식수', 'count', 4, false),
  ('tsstkDpDecsn', 'dpprpd_bgd', '처분 시작일', 'date', 5, false)
) as v (endpoint, field, label_ko, unit, sort, is_size)
where not exists (select 1 from ref.detail_field_labels l where l.endpoint = v.endpoint and l.field = v.field);

update ref.feed_rules set routine_pattern = '임직원|상여|성과보상|우리사주|주식매수선택권|스톡옵션|주식기준보상'
where rule_key = 'd_treasury_sell' and routine_pattern is null;

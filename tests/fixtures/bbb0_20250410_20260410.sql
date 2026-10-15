-- =====================================================================
-- 테스트 픽스처: 실제 공시 데이터
--
-- 출처
--   1) (주)이랜드월드 제108회 무보증사채 [정정]증권신고서 (DART 공시)
--      '최근 1년(2025.04.10~2026.04.10) 동일등급(BBB0) 회사채 발행사례' 표 14건
--      + 제108회 수요예측 결과(730억/20건, 개별민평 -17bp 확정, 300→500억 증액)
--      + 제108회 정정인수계약서(NH 300억·인수수수료 9천만원 / 교보 200억·6천만원)
--   2) 삼척블루파워: NH 제108회 대표주관 제안서 p.4 '2026년 BBB0등급 수요예측 사례' (A+, 비교 대상)
--   3) 이랜드월드 제103회: 제108회 인수제안요청서 (2024.10.23 발행, 500억, 6.567%, 1.5년)
--
-- corp_code 는 테스트용 코드(FX_)다. 운영 DB 에는 넣지 않는다.
-- =====================================================================

insert into core.companies (corp_code, corp_name, market) values
  ('FX_JOONGANG',  '중앙일보',       '기타'),
  ('FX_JTBC',      '제이티비씨',     '기타'),
  ('FX_DOOSANFC',  '두산퓨얼셀',     '유가증권'),
  ('FX_ELAND',     '이랜드월드',     '기타'),
  ('FX_ELANDRT',   '이랜드리테일',   '기타'),
  ('FX_KCARCAP',   '케이카캐피탈',   '기타'),
  ('FX_SLLJA',     '에스엘엘중앙',   '기타'),
  ('FX_SAMCHEOK',  '삼척블루파워',   '기타');

create temp table fx_bond (
  corp_code    text,
  series       text,
  rating_raw   text,
  tenor_months int,
  announce_dt  date,
  pricing_dt   date,
  payment_dt   date,
  initial_eok  numeric,
  band_raw     text,
  band_low     numeric,
  band_high    numeric,
  final_eok    numeric,
  spread_bp    numeric,
  yield_pct    numeric,
  in_band_eok  numeric,
  demand_eok   numeric,
  demand_cnt   int,
  ratio        numeric
);

insert into fx_bond values
  -- 108 증권신고서 표 (발행사, 회차, 등급, 만기, 납입일, 최초신고, 밴드, 확정금액, 확정조건, 확정금리, 밴드내, 총참여, 경쟁률)
  ('FX_JOONGANG', '46',   'BBB0',      18, null, null, '2025-07-22', 300, '고정 5.80%~6.80%',  5.80, 6.80, 340, null, 6.200, 370, 370, null, 1.23),
  ('FX_JTBC',     '41',   'BBB0(N)',   24, null, null, '2025-08-01', 500, '고정 6.80%~7.80%',  6.80, 7.80, 500, null, 7.800, 190, 190, null, 0.38),
  ('FX_DOOSANFC', '11-1', 'BBB0',      24, null, null, '2025-08-27', 150, '개별 -30bp~+30bp',  -30,  30,   200, -8,   4.266, 200, 200, null, 1.33),
  ('FX_DOOSANFC', '11-2', 'BBB0',      36, null, null, '2025-08-27', 250, '개별 -30bp~+30bp',  -30,  30,   420, -1,   5.005, 430, 430, null, 1.72),
  ('FX_ELAND',    '106-1','BBB0',      12, null, null, '2025-08-29', 150, '고정 5.60%~6.60%',  5.60, 6.60, 150, null, 6.600,  80,  80, null, 0.53),
  ('FX_ELAND',    '106-2','BBB0',      18, null, null, '2025-08-29', 150, '고정 5.80%~6.80%',  5.80, 6.80, 150, null, 6.800,  80,  80, null, 0.53),
  ('FX_KCARCAP',  '41-1', 'BBB0(P)',   18, null, null, '2025-09-15', 200, '고정 4.40%~5.00%',  4.40, 5.00, 260, null, 4.400, 290, 290, null, 1.45),
  ('FX_KCARCAP',  '41-2', 'BBB0(P)',   24, null, null, '2025-09-15', 100, '고정 4.70%~5.30%',  4.70, 5.30, 130, null, 5.200, 160, 160, null, 1.60),
  ('FX_SLLJA',    '21',   'BBB0(S/N)', 12, null, null, '2025-09-24', 300, '고정 6.60%~7.60%',  6.60, 7.60, 350, null, 7.600, 150, 150, null, 0.50),
  ('FX_JOONGANG', '47',   'BBB0',      24, null, null, '2025-11-05', 200, '고정 5.90%~6.90%',  5.90, 6.90, 350, null, 6.840, 450, 450, null, 2.25),
  ('FX_SLLJA',    '22',   'BBB0(S/N)', 18, null, '2026-01-21', '2026-01-30', 400, '고정 6.80%~7.80%', 6.80, 7.80, 410, null, 7.800, 320, 330, null, 0.80),
  ('FX_ELAND',    '107',  'BBB0',      12, null, '2026-01-29', '2026-02-06', 300, '고정 5.80%~6.80%', 5.80, 6.80, 410, null, 6.700, 430, 430, null, 1.43),
  ('FX_JTBC',     '42',   'BBB0(N)',   24, null, '2026-02-05', '2026-02-13', 500, '고정 7.10%~8.10%', 7.10, 8.10, 930, null, 8.100, 770, 770, null, 1.54),
  ('FX_JOONGANG', '51',   'BBB0',      18, null, '2026-02-12', '2026-02-26', 500, '고정 6.10%~7.10%', 6.10, 7.10, 500, null, 7.100, 240, 240, null, 0.48),
  -- 비교 대상(다른 등급)
  ('FX_SAMCHEOK', 'unknown',   'A+',        36, null, '2026-02-11', '2026-02-25', 1000, '개별 -30~+30',   -30,  30, 1500, null, 6.402, 1520, 1520, null, 1.52),
  -- 이랜드월드 108 (확정 금리는 개별민평 -17bp, 절대금리 미기재)
  ('FX_ELAND',    '108',  'BBB0',      12, '2026-04-13', '2026-04-15', '2026-04-23', 300, '개별 -35bp~+35bp', -35, 35, 500, -17, null, 730, 730, 20, 2.43),
  -- 이랜드월드 103 (등급 정보 없음)
  ('FX_ELAND',    '103',  null,        18, null, null, '2024-10-23', 500, null, null, null, 500, null, 6.567, null, null, null, null);

insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status,
                        announce_dt, pricing_dt, payment_dt, amount_krw, initial_amount_krw)
select
  'bond:' || b.corp_code || ':' || b.series,
  'bond',
  coalesce(core.map_value('bond_category_corp', c.corp_name), '일반회사채'),
  b.corp_code, b.series, true, 'completed',
  b.announce_dt, b.pricing_dt, b.payment_dt,
  b.final_eok * 1e8, b.initial_eok * 1e8
from fx_bond b
join core.companies c on c.corp_code = b.corp_code;

insert into core.bond_terms (deal_key, tenor_months, maturity_dt, coupon_pct, yield_pct, rating_raw, rating,
                             band_type, band_low, band_high, demand_krw, demand_in_band_krw, demand_count,
                             competition_ratio, final_spread_bp)
select
  'bond:' || b.corp_code || ':' || b.series,
  b.tenor_months,
  (b.payment_dt + make_interval(months => b.tenor_months))::date,
  b.yield_pct, b.yield_pct,
  b.rating_raw, core.parse_rating(b.rating_raw),
  core.map_value('band_type', b.band_raw), b.band_low, b.band_high,
  b.demand_eok * 1e8, b.in_band_eok * 1e8, b.demand_cnt,
  b.ratio, b.spread_bp
from fx_bond b;

insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw) values
  ('bond:FX_ELAND:108', '엔에이치투자증권 주식회사', core.normalize_firm('엔에이치투자증권 주식회사'),
   core.map_value('underwriter_role', '대표주관회사'), core.map_value('underwriting_method', '총액인수'), 300e8, 90000000),
  ('bond:FX_ELAND:108', '교보증권 주식회사', core.normalize_firm('교보증권 주식회사'),
   core.map_value('underwriter_role', '인수회사'), core.map_value('underwriting_method', '총액인수'), 200e8, 60000000);

drop table fx_bond;

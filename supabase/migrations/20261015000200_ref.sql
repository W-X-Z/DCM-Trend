-- =====================================================================
-- 02. ref : 현업과 합의하는 규칙·사전·파라미터
--
-- 이 스키마의 "행"을 바꾸면 화면 결과가 바뀐다. 배포 없이 수정 가능.
-- status = 'draft'  : AX추진부 초안 (현업 미검증)
-- status = 'agreed' : 현업 인터뷰에서 합의됨
-- =====================================================================

-- 상품 마스터 -----------------------------------------------------------
create table ref.products (
  product_type  text primary key,
  label_ko      text not null,
  sort_order    int not null
);

insert into ref.products values
  ('bond',   '회사채 공모', 1),
  ('mezz',   '메자닌',      2),
  ('equity', '유상증자',    3);

-- 파라미터 ------------------------------------------------------------
create table ref.params (
  key         text primary key,
  value       jsonb not null,
  status      text not null default 'draft' check (status in ('draft', 'agreed')),
  note        text,
  updated_at  timestamptz not null default now()
);

insert into ref.params (key, value, note) values
  ('comps_lookback_months', '12',   '유사 딜 검색 기간(개월). 증권신고서 관행: 최근 1년'),
  ('comps_limit',           '15',   '유사 딜 최대 건수'),
  ('undersubscribed_ratio', '1.0',  '수요예측 경쟁률이 이 값 미만이면 미달'),
  ('refix_low_ratio_pct',   '70',   '리픽싱 최저조정가액이 최초 전환가 대비 이 % 이하이면 "하한 낮음"'),
  ('large_deal_krw',        '{"bond": 100000000000, "mezz": 30000000000, "equity": 100000000000}',
                                    '주목할 딜: 대형 기준 금액(원)'),
  ('trend_default_months',  '24',   '트렌드 화면 기본 조회 기간(개월)'),
  ('bond_trend_categories', '["일반회사채"]', '회사채 트렌드 기본 포함 구분. 금융채 포함 여부는 현업 합의 대상'),
  ('first_issue_min_history_months', '12',
                                    'DB 수집 시작 후 이 기간이 지난 딜만 "첫 발행" 판정 (수집 초기 오탐 방지)');

-- 공시 분류: 보고서명 → 상품 -------------------------------------------
create table ref.filing_product_rules (
  rule_id        int generated always as identity primary key,
  priority       int not null,
  report_pattern text not null,                    -- report_nm 정규식
  product_type   text not null references ref.products (product_type),
  sub_type       text,
  is_active      boolean not null default true,
  note           text
);

insert into ref.filing_product_rules (priority, report_pattern, product_type, sub_type, note) values
  (10, '채무증권',                 'bond',   null,      '증권신고서·투자설명서(채무증권). 공모 CB는 변환 단계에서 행사대상증권 유무로 mezz 재분류'),
  (20, '전환사채권\s*발행\s*결정',   'mezz',   'CB',      '주요사항보고서'),
  (21, '신주인수권부사채권\s*발행\s*결정', 'mezz', 'BW',   '주요사항보고서'),
  (22, '교환사채권\s*발행\s*결정',   'mezz',   'EB',      '주요사항보고서'),
  (30, '유무상증자\s*결정',          'equity', null,      '유상증자 부분만 사용'),
  (31, '유상증자\s*결정',            'equity', null,      '주요사항보고서'),
  (32, '지분증권',                   'equity', null,      '증권신고서(지분증권)');

-- 공시 분류: 보고서명 → 공시 역할 ---------------------------------------
create table ref.filing_role_rules (
  rule_id        int generated always as identity primary key,
  priority       int not null,
  report_pattern text not null,
  role           text not null check (role in ('decision', 'registration', 'amendment', 'final_terms', 'result', 'other')),
  is_active      boolean not null default true,
  note           text
);

insert into ref.filing_role_rules (priority, report_pattern, role, note) values
  (10,  '^\[발행조건확정\]', 'final_terms',  '수요예측 후 확정 조건'),
  (20,  '^\[기재정정\]',     'amendment',    null),
  (21,  '^\[첨부정정\]',     'amendment',    null),
  (30,  '증권발행실적보고서', 'result',       '청약·납입 결과'),
  (40,  '^주요사항보고서',    'decision',     '이사회 결정'),
  (50,  '^증권신고서',        'registration', null),
  (51,  '^일괄신고추가서류',  'registration', '일괄신고 발행분. 구조화 API 포함 여부 확인 필요'),
  (999, '.',                  'other',        '기본값');

-- 값 표준화 사전 (도메인별) --------------------------------------------
-- 원문 값이 제각각인 항목을 표준값으로 바꾼다. 새 표기가 나오면 행만 추가.
create table ref.value_maps (
  domain     text not null,                        -- equity_method / underwriting_method / underwriter_role / band_type / bond_category
  priority   int not null,
  pattern    text not null,                        -- 원문 정규식
  std_value  text not null,
  status     text not null default 'draft' check (status in ('draft', 'agreed')),
  note       text,
  primary key (domain, priority)
);

insert into ref.value_maps (domain, priority, pattern, std_value, note) values
  -- 유상증자 방식
  ('equity_method', 10, '실권주',          '주주배정후 일반공모', null),
  ('equity_method', 20, '주주배정',        '주주배정',            null),
  ('equity_method', 30, '제3자',           '제3자배정',           null),
  ('equity_method', 40, '일반공모',        '일반공모',            null),
  -- 인수 방법
  ('underwriting_method', 10, '총액',      '총액인수', null),
  ('underwriting_method', 20, '잔액',      '잔액인수', null),
  ('underwriting_method', 30, '주선|모집', '모집주선', null),
  -- 인수인 구분
  ('underwriter_role', 10, '대표|주관',    '대표주관', '공동대표주관 포함'),
  ('underwriter_role', 20, '인수',         '인수',     null),
  ('underwriter_role', 30, '주선|모집',    '주선',     null),
  -- 공모희망금리 방식
  ('band_type', 10, '개별',                '개별민평', '신고서 표기 예: "개별 -30bp~+30bp"'),
  ('band_type', 20, '등급',                '등급민평', null),
  ('band_type', 30, '국고',                '국고채',   null),
  ('band_type', 40, '고정|\d+\.\d+\s*%',   '고정금리', '절대금리 구간'),
  -- 회사채 구분 (사채 명칭 기준)
  ('bond_category_name', 10, '신종자본|영구|조건부자본|후순위', '신종자본증권', null),
  -- 회사채 구분 (회사명 기준)
  ('bond_category_corp', 10, '캐피탈|카드|리스|저축은행|은행|증권|보험|자산운용|금융지주', '금융채',
     '이랜드 108 신고서는 케이카캐피탈을 "일반 회사채"에 포함 → 현업 합의 필요');

-- 신용등급 척도 --------------------------------------------------------
create table ref.rating_scale (
  rating         text primary key,                 -- 국내 표기: AA0, BBB0 ...
  notch          int not null unique,              -- 1 = AAA (작을수록 우량)
  grade_group    text not null,                    -- AAA / AA / A / BBB / BB이하
  is_investment  boolean not null
);

insert into ref.rating_scale values
  ('AAA',  1, 'AAA', true),
  ('AA+',  2, 'AA',  true), ('AA0',  3, 'AA',  true), ('AA-',  4, 'AA',  true),
  ('A+',   5, 'A',   true), ('A0',   6, 'A',   true), ('A-',   7, 'A',   true),
  ('BBB+', 8, 'BBB', true), ('BBB0', 9, 'BBB', true), ('BBB-', 10, 'BBB', true),
  ('BB+', 11, 'BB이하', false), ('BB0', 12, 'BB이하', false), ('BB-', 13, 'BB이하', false),
  ('B+',  14, 'BB이하', false), ('B0',  15, 'BB이하', false), ('B-',  16, 'BB이하', false),
  ('CCC', 17, 'BB이하', false), ('CC',  18, 'BB이하', false), ('C',   19, 'BB이하', false),
  ('D',   20, 'BB이하', false);

-- 증권사 표준명 --------------------------------------------------------
create table ref.firms (
  firm_std    text primary key,
  is_nh       boolean not null default false,
  sort_order  int
);

create table ref.firm_aliases (
  alias     text primary key,                      -- 정규화(주식회사·㈜·공백 제거) 후 표기
  firm_std  text not null references ref.firms (firm_std),
  note      text
);

insert into ref.firms (firm_std, is_nh, sort_order) values
  ('NH투자증권', true, 1), ('KB증권', false, 2), ('한국투자증권', false, 3), ('미래에셋증권', false, 4),
  ('삼성증권', false, 5), ('신한투자증권', false, 6), ('키움증권', false, 7), ('대신증권', false, 8),
  ('하나증권', false, 9), ('메리츠증권', false, 10), ('유진투자증권', false, 11), ('교보증권', false, 12),
  ('IBK투자증권', false, 13), ('한화투자증권', false, 14), ('현대차증권', false, 15), ('DB증권', false, 16),
  ('신영증권', false, 17), ('유안타증권', false, 18), ('iM증권', false, 19), ('LS증권', false, 20),
  ('SK증권', false, 21), ('부국증권', false, 22), ('한양증권', false, 23), ('BNK투자증권', false, 24),
  ('다올투자증권', false, 25), ('케이프투자증권', false, 26), ('상상인증권', false, 27), ('우리투자증권', false, 28);

insert into ref.firm_aliases (alias, firm_std, note) values
  ('엔에이치투자증권', 'NH투자증권', 'DART 등록 상호'), ('NH투자증권', 'NH투자증권', null),
  ('케이비증권', 'KB증권', null), ('KB증권', 'KB증권', null),
  ('한국투자증권', '한국투자증권', null), ('미래에셋증권', '미래에셋증권', null), ('삼성증권', '삼성증권', null),
  ('신한투자증권', '신한투자증권', null), ('신한금융투자', '신한투자증권', '2022년 사명 변경 전'),
  ('키움증권', '키움증권', null), ('대신증권', '대신증권', null),
  ('하나증권', '하나증권', null), ('하나금융투자', '하나증권', '2022년 사명 변경 전'),
  ('메리츠증권', '메리츠증권', null), ('유진투자증권', '유진투자증권', null), ('교보증권', '교보증권', null),
  ('아이비케이투자증권', 'IBK투자증권', null), ('IBK투자증권', 'IBK투자증권', null),
  ('한화투자증권', '한화투자증권', null), ('현대차증권', '현대차증권', null),
  ('디비금융투자', 'DB증권', '사명 변경 전(확인 필요)'), ('DB금융투자', 'DB증권', '사명 변경 전(확인 필요)'), ('DB증권', 'DB증권', null),
  ('신영증권', '신영증권', null), ('유안타증권', '유안타증권', null),
  ('아이엠증권', 'iM증권', null), ('iM증권', 'iM증권', null), ('하이투자증권', 'iM증권', '2024년 사명 변경 전'),
  ('엘에스증권', 'LS증권', null), ('LS증권', 'LS증권', null), ('이베스트투자증권', 'LS증권', '2024년 사명 변경 전'),
  ('에스케이증권', 'SK증권', null), ('SK증권', 'SK증권', null),
  ('부국증권', '부국증권', null), ('한양증권', '한양증권', null),
  ('비엔케이투자증권', 'BNK투자증권', null), ('BNK투자증권', 'BNK투자증권', null),
  ('다올투자증권', '다올투자증권', null), ('케이프투자증권', '케이프투자증권', null),
  ('상상인증권', '상상인증권', null), ('우리투자증권', '우리투자증권', null);

-- 유사 딜 규칙 ---------------------------------------------------------
-- feature 이름은 mart.v_deal_features 의 feature 와 같아야 한다.
create table ref.similarity_rules (
  product_type  text not null references ref.products (product_type),
  feature       text not null,
  match_type    text not null check (match_type in ('equal', 'abs_diff', 'pct_diff')),
  tolerance     numeric,                           -- abs_diff: 절대 차이, pct_diff: 비율(0.5 = ±50%)
  weight        numeric not null default 1,
  is_required   boolean not null default false,    -- true면 불일치 시 후보에서 제외
  is_active     boolean not null default true,
  status        text not null default 'draft' check (status in ('draft', 'agreed')),
  note          text,
  primary key (product_type, feature)
);

insert into ref.similarity_rules (product_type, feature, match_type, tolerance, weight, is_required, note) values
  ('bond',   'rating_notch',     'abs_diff', 0,   3, true,  '동일 등급 필수 (증권신고서 비교 관행)'),
  ('bond',   'tenor_months',     'abs_diff', 6,   2, false, '만기 ±6개월'),
  ('bond',   'amount_krw',       'pct_diff', 0.5, 1, false, '발행금액 ±50%'),
  ('bond',   'sub_type',         'equal',    null, 1, false, '일반회사채/금융채/신종자본'),
  ('bond',   'band_type',        'equal',    null, 1, false, '공모희망금리 방식'),
  ('mezz',   'sub_type',         'equal',    null, 3, true,  'CB/BW/EB'),
  ('mezz',   'market',           'equal',    null, 2, false, '유가/코스닥'),
  ('mezz',   'is_public',        'equal',    null, 2, false, '공모/사모'),
  ('mezz',   'zero_coupon',      'equal',    null, 1, false, '표면·만기이자율 0% 여부'),
  ('mezz',   'has_refix',        'equal',    null, 1, false, '리픽싱 조항 유무'),
  ('mezz',   'shares_ratio_pct', 'abs_diff', 3,   2, false, '발행주식총수 대비 전환주식 비율 ±3%p'),
  ('mezz',   'amount_krw',       'pct_diff', 0.5, 1, false, '발행금액 ±50%'),
  ('equity', 'sub_type',         'equal',    null, 3, true,  '증자 방식'),
  ('equity', 'market',           'equal',    null, 2, false, '유가/코스닥'),
  ('equity', 'dilution_pct',     'abs_diff', 10,  2, false, '증자 전 주식수 대비 신주 비율 ±10%p'),
  ('equity', 'amount_krw',       'pct_diff', 0.5, 1, false, '모집금액 ±50%');

-- 지표 정의 (화면 툴팁·현업 합의 기록) ---------------------------------
create table ref.metric_catalog (
  metric_key     text primary key,
  product_type   text references ref.products (product_type),
  label_ko       text not null,
  definition_ko  text not null,
  unit           text,
  source         text,                             -- 산출 뷰
  status         text not null default 'draft' check (status in ('draft', 'agreed')),
  note           text
);

insert into ref.metric_catalog (metric_key, product_type, label_ko, definition_ko, unit, source) values
  ('deal_count',          null,     '건수',            '기준일(회사채: 납입일, 메자닌·유증: 이사회 결정일)이 해당 월인 딜 수', '건', 'mart.v_*_trend_monthly'),
  ('amount_krw',          null,     '발행금액',        '확정 발행금액 합계 (확정 전이면 신고 금액)', '원', 'mart.v_*_trend_monthly'),
  ('avg_yield_pct_w',     'bond',   '평균 발행금리',   '발행금액 가중 평균 발행수익률', '%', 'mart.v_bond_trend_monthly'),
  ('avg_competition',     'bond',   '평균 경쟁률',     '수요예측 참여금액 ÷ 최초 신고금액의 단순 평균', '배', 'mart.v_bond_trend_monthly'),
  ('undersub_count',      'bond',   '미달 건수',       '경쟁률이 ref.params.undersubscribed_ratio 미만인 딜 수', '건', 'mart.v_bond_trend_monthly'),
  ('fixed_band_share',    'bond',   '고정금리 밴드 비중', '공모희망금리를 절대금리 구간으로 제시한 딜 비중', '%', 'mart.v_bond_trend_monthly'),
  ('increased_count',     'bond',   '증액 건수',       '확정 금액이 최초 신고금액보다 큰 딜 수', '건', 'mart.v_bond_trend_monthly'),
  ('zero_coupon_share',   'mezz',   '0%/0% 비중',      '표면이자율·만기이자율이 모두 0%인 딜 비중', '%', 'mart.v_mezz_trend_monthly'),
  ('refix_low_share',     'mezz',   '리픽싱 하한 낮음 비중', '최저조정가액 ÷ 최초 전환가 ≤ ref.params.refix_low_ratio_pct 인 딜 비중', '%', 'mart.v_mezz_trend_monthly'),
  ('avg_shares_ratio',    'mezz',   '평균 희석 비율',  '발행주식총수 대비 전환(행사) 주식 비율 평균', '%', 'mart.v_mezz_trend_monthly'),
  ('avg_dilution_pct',    'equity', '평균 신주 비율',  '증자 전 발행주식총수 대비 신주 수 평균', '%', 'mart.v_equity_trend_monthly'),
  ('firm_commitment_share','equity','총액인수 비중',   '인수방법이 총액인수인 딜 비중', '%', 'mart.v_equity_trend_monthly'),
  ('fee_bp',              null,     '수수료(bp)',      '인수대가 합 ÷ 인수금액 합 × 10,000 (대표주관수수료 별도 기재분 제외)', 'bp', 'mart.v_fee_stats'),
  ('lead_credit_krw',     null,     '대표주관 실적',   '딜 금액을 대표주관사 수로 균등 배분한 금액 합', '원', 'mart.v_league_table_yearly');

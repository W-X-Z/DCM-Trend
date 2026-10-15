-- =====================================================================
-- 홈 피드: 최근 2주의 이례적 발행과 주요 공시
--
-- SQL 이 후보(발행 딜·주요사항보고서)와 사실 값을 만든다. 수집기는 그중 AI 가 고른 10건 안팎을
-- 문장으로 정리해 core.feed_sets 에 넣고, 화면은 mart.v_feed 를 읽는다.
-- 가중치·공시 종류·상세 값 이름은 ref 행으로 고친다.
-- =====================================================================

-- 표시용 서식 ------------------------------------------------------------
create or replace function core.fmt_krw(v numeric)
returns text language sql immutable set search_path = '' as $$
  select case
    when v is null then null
    when abs(v) >= 1e12 then trim_scale(round(v / 1e12, 1))::text || '조원'
    when abs(v) >= 1e8 then to_char(round(v / 1e8), 'FM999,999,999,990') || '억원'
    else to_char(round(v / 1e4), 'FM999,999,999,990') || '만원'
  end
$$;

create or replace function core.to_num(t text)
returns numeric language sql immutable set search_path = '' as $$
  select case when btrim(t) ~ '^-?[0-9][0-9,]*(\.[0-9]+)?$' then replace(btrim(t), ',', '')::numeric end
$$;

create or replace function core.fmt_dart_date(t text)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~ '^\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*$'
      then to_char(to_date(regexp_replace(t, '\D+', '-', 'g'), 'YYYY-MM-DD'), 'YYYY.MM.DD')
    when t ~ '^\s*\d{4}-\d{2}-\d{2}' then replace(substr(btrim(t), 1, 10), '-', '.')
  end
$$;

create or replace function core.fmt_field(v text, unit text)
returns text language sql immutable set search_path = '' as $$
  select case
    when v is null or btrim(v) in ('', '-', '해당사항없음', '해당사항 없음') then null
    when unit = 'krw'  then core.fmt_krw(core.to_num(v))
    when unit = 'pct'  then case when core.to_num(v) is not null then trim_scale(round(core.to_num(v), 2))::text || '%' end
    when unit = 'date' then coalesce(core.fmt_dart_date(v), left(btrim(v), 20))
    when unit = 'count' then case when core.to_num(v) is not null then to_char(core.to_num(v), 'FM999,999,999,990') end
    else case
      when char_length(regexp_replace(btrim(v), '\s+', ' ', 'g')) > 70
        then left(regexp_replace(btrim(v), '\s+', ' ', 'g'), 69) || '…'
      else regexp_replace(btrim(v), '\s+', ' ', 'g')
    end
  end
$$;

-- 상세 API 필드 이름 ------------------------------------------------------
create table if not exists ref.detail_field_labels (
  endpoint  text not null,
  field     text not null,
  label_ko  text not null,
  unit      text not null default 'text' check (unit in ('krw', 'pct', 'date', 'text', 'count')),
  sort      int  not null default 100,
  is_size   boolean not null default false,      -- 규모 가중치에 쓰는 금액
  primary key (endpoint, field)
);

insert into ref.detail_field_labels (endpoint, field, label_ko, unit, sort, is_size) values
  ('cmpMgDecsn', 'mg_stn',            '합병형태',             'text', 10, false),
  ('cmpMgDecsn', 'mgptncmp_cmpnm',    '합병 상대회사',        'text', 20, false),
  ('cmpMgDecsn', 'mgptncmp_mbsn',     '상대회사 주요사업',    'text', 30, false),
  ('cmpMgDecsn', 'mgptncmp_rl_cmpn',  '상대회사와의 관계',    'text', 40, false),
  ('cmpMgDecsn', 'mg_rt',             '합병비율',             'text', 50, false),
  ('cmpMgDecsn', 'mg_pp',             '합병목적',             'text', 60, false),
  ('cmpMgDecsn', 'rbsnfdtl_tast',     '상대회사 자산총계',    'krw',  70, true),
  ('cmpMgDecsn', 'rbsnfdtl_sl',       '상대회사 매출액',      'krw',  80, false),
  ('cmpMgDecsn', 'mgsc_mgdt',         '합병기일',             'date', 90, false),
  ('cmpDvDecsn', 'dv_mth',            '분할방법',             'text', 10, false),
  ('cmpDvDecsn', 'dvfcmp_cmpnm',      '분할설립회사',         'text', 20, false),
  ('cmpDvDecsn', 'dvfcmp_mbsn',       '분할설립회사 주요사업','text', 30, false),
  ('cmpDvDecsn', 'dv_trfbsnprt_cn',   '이전 사업·재산',       'text', 40, false),
  ('cmpDvDecsn', 'dv_impef',          '분할 영향',            'text', 50, false),
  ('cmpDvDecsn', 'dvdt',              '분할기일',             'date', 60, false),
  ('stkExtrDecsn', 'extr_sen',        '구분',                 'text', 10, false),
  ('stkExtrDecsn', 'extr_stn',        '형태',                 'text', 20, false),
  ('stkExtrDecsn', 'extr_tgcmp_cmpnm','대상 회사',            'text', 30, false),
  ('stkExtrDecsn', 'extr_tgcmp_mbsn', '대상 회사 주요사업',   'text', 40, false),
  ('stkExtrDecsn', 'extr_tgcmp_rl_cmpn','대상 회사와의 관계', 'text', 50, false),
  ('stkExtrDecsn', 'extr_rt',         '교환·이전 비율',       'text', 60, false),
  ('stkExtrDecsn', 'extr_pp',         '목적',                 'text', 70, false),
  ('stkExtrDecsn', 'extrsc_extrdt',   '교환·이전일',          'date', 80, false),
  ('bsnInhDecsn', 'inh_bsn',          '양수 영업',            'text', 10, false),
  ('bsnInhDecsn', 'inh_bsn_mc',       '영업 주요내용',        'text', 20, false),
  ('bsnInhDecsn', 'inh_prc',          '양수가액',             'krw',  30, true),
  ('bsnInhDecsn', 'ast_rt',           '자산 대비',            'pct',  40, false),
  ('bsnInhDecsn', 'dlptn_cmpnm',      '거래상대방',           'text', 50, false),
  ('bsnInhDecsn', 'dlptn_rl_cmpn',    '거래상대방과의 관계',  'text', 55, false),
  ('bsnInhDecsn', 'inh_pp',           '양수목적',             'text', 60, false),
  ('bsnInhDecsn', 'inh_prd_inh_std',  '양수기준일',           'date', 70, false),
  ('bsnTrfDecsn', 'trf_bsn',          '양도 영업',            'text', 10, false),
  ('bsnTrfDecsn', 'trf_bsn_mc',       '영업 주요내용',        'text', 20, false),
  ('bsnTrfDecsn', 'trf_prc',          '양도가액',             'krw',  30, true),
  ('bsnTrfDecsn', 'ast_rt',           '자산 대비',            'pct',  40, false),
  ('bsnTrfDecsn', 'sl_rt',            '매출 대비',            'pct',  45, false),
  ('bsnTrfDecsn', 'dlptn_cmpnm',      '거래상대방',           'text', 50, false),
  ('bsnTrfDecsn', 'trf_pp',           '양도목적',             'text', 60, false),
  ('bsnTrfDecsn', 'trf_prd_trf_std',  '양도기준일',           'date', 70, false),
  ('tgastInhDecsn', 'ast_sen',        '자산구분',             'text', 10, false),
  ('tgastInhDecsn', 'ast_nm',         '자산명',               'text', 20, false),
  ('tgastInhDecsn', 'inhdtl_inhprc',  '양수금액',             'krw',  30, true),
  ('tgastInhDecsn', 'inhdtl_tast_vs', '자산총액 대비',        'pct',  40, false),
  ('tgastInhDecsn', 'dlptn_cmpnm',    '거래상대방',           'text', 50, false),
  ('tgastInhDecsn', 'inh_pp',         '양수목적',             'text', 60, false),
  ('tgastInhDecsn', 'inh_prd_inh_std','양수기준일',           'date', 70, false),
  ('tgastTrfDecsn', 'ast_sen',        '자산구분',             'text', 10, false),
  ('tgastTrfDecsn', 'ast_nm',         '자산명',               'text', 20, false),
  ('tgastTrfDecsn', 'trfdtl_trfprc',  '양도금액',             'krw',  30, true),
  ('tgastTrfDecsn', 'trfdtl_tast_vs', '자산총액 대비',        'pct',  40, false),
  ('tgastTrfDecsn', 'dlptn_cmpnm',    '거래상대방',           'text', 50, false),
  ('tgastTrfDecsn', 'trf_pp',         '양도목적',             'text', 60, false),
  ('tgastTrfDecsn', 'trf_prd_trf_std','양도기준일',           'date', 70, false),
  ('otcprStkInvscrInhDecsn', 'iscmp_cmpnm',    '대상 회사',          'text', 10, false),
  ('otcprStkInvscrInhDecsn', 'iscmp_mbsn',     '대상 회사 주요사업', 'text', 20, false),
  ('otcprStkInvscrInhDecsn', 'iscmp_rl_cmpn',  '대상 회사와의 관계', 'text', 25, false),
  ('otcprStkInvscrInhDecsn', 'inhdtl_inhprc',  '양수금액',           'krw',  30, true),
  ('otcprStkInvscrInhDecsn', 'inhdtl_ecpt_vs', '자기자본 대비',      'pct',  40, false),
  ('otcprStkInvscrInhDecsn', 'atinh_eqrt',     '양수 후 지분율',     'pct',  50, false),
  ('otcprStkInvscrInhDecsn', 'dlptn_cmpnm',    '거래상대방',         'text', 55, false),
  ('otcprStkInvscrInhDecsn', 'inh_pp',         '양수목적',           'text', 60, false),
  ('otcprStkInvscrInhDecsn', 'inh_prd',        '양수예정일',         'date', 70, false),
  ('otcprStkInvscrTrfDecsn', 'iscmp_cmpnm',    '대상 회사',          'text', 10, false),
  ('otcprStkInvscrTrfDecsn', 'iscmp_mbsn',     '대상 회사 주요사업', 'text', 20, false),
  ('otcprStkInvscrTrfDecsn', 'trfdtl_trfprc',  '양도금액',           'krw',  30, true),
  ('otcprStkInvscrTrfDecsn', 'trfdtl_ecpt_vs', '자기자본 대비',      'pct',  40, false),
  ('otcprStkInvscrTrfDecsn', 'attrf_eqrt',     '양도 후 지분율',     'pct',  50, false),
  ('otcprStkInvscrTrfDecsn', 'dlptn_cmpnm',    '거래상대방',         'text', 55, false),
  ('otcprStkInvscrTrfDecsn', 'trf_pp',         '양도목적',           'text', 60, false),
  ('otcprStkInvscrTrfDecsn', 'trf_prd',        '양도예정일',         'date', 70, false),
  ('crDecsn', 'cr_mth',      '감자방법',          'text', 10, false),
  ('crDecsn', 'cr_rt_ostk',  '감자비율',          'pct',  20, false),
  ('crDecsn', 'cr_rs',       '감자사유',          'text', 30, false),
  ('crDecsn', 'bfcr_cpt',    '감자 전 자본금',    'krw',  40, false),
  ('crDecsn', 'atcr_cpt',    '감자 후 자본금',    'krw',  50, false),
  ('crDecsn', 'cr_std',      '감자기준일',        'date', 60, false),
  ('ctrcvsBgrq', 'apcnt',    '신청인',            'text', 10, false),
  ('ctrcvsBgrq', 'cpct',     '관할법원',          'text', 20, false),
  ('ctrcvsBgrq', 'rq_rs',    '신청사유',          'text', 30, false),
  ('ctrcvsBgrq', 'rqd',      '신청일',            'date', 40, false),
  ('dsRsOcr', 'ds_rs',       '해산사유',          'text', 10, false),
  ('dsRsOcr', 'ds_rsd',      '해산사유 발생일',   'date', 20, false),
  ('bsnSp', 'bsnsp_rm',      '정지 분야',         'text', 10, false),
  ('bsnSp', 'bsnsp_amt',     '정지 영업 매출',    'krw',  20, true),
  ('bsnSp', 'sl_vs',         '매출 대비',         'pct',  30, false),
  ('bsnSp', 'bsnsp_rs',      '정지 사유',         'text', 40, false),
  ('bsnSp', 'bsnspd',        '정지일',            'date', 50, false),
  ('dfOcr', 'df_cn',         '부도내용',          'text', 10, false),
  ('dfOcr', 'df_amt',        '부도금액',          'krw',  20, true),
  ('dfOcr', 'df_bnk',        '부도 발생 은행',    'text', 30, false),
  ('dfOcr', 'dfd',           '최종 부도일',       'date', 40, false),
  ('dfOcr', 'df_rs',         '부도사유',          'text', 50, false)
on conflict (endpoint, field) do nothing;

-- 피드 규칙 ----------------------------------------------------------------
-- kind: 공시 규칙은 report_pattern 으로 공시를 찾고 endpoint 의 상세 값을 붙인다.
--       발행 규칙(flag)은 아래 함수 안의 판정 이름과 같아야 한다.
create table if not exists ref.feed_rules (
  rule_key        text primary key,
  tag             text not null check (tag in ('발행', '공시')),
  label_ko        text not null,
  report_pattern  text,
  endpoint        text,
  weight          numeric not null default 1,
  exclude_pattern text,
  is_active       boolean not null default true,
  note            text
);

insert into ref.feed_rules (rule_key, tag, label_ko, report_pattern, endpoint, weight, exclude_pattern, note) values
  -- 공시
  ('d_merger',     '공시', '합병 결정',           '회사\s*(분할\s*)?합병\s*결정',                     'cmpMgDecsn',             2.0, '스팩|기업인수목적', null),
  ('d_split',      '공시', '분할 결정',           '회사\s*분할\s*결정',                               'cmpDvDecsn',             2.0, null, null),
  ('d_exchange',   '공시', '주식교환·이전 결정',  '주식\s*교환.{0,2}이전\s*결정',                     'stkExtrDecsn',           2.0, null, null),
  ('d_biz_buy',    '공시', '영업양수 결정',       '영업\s*양수\s*결정',                               'bsnInhDecsn',            2.0, null, null),
  ('d_biz_sell',   '공시', '영업양도 결정',       '영업\s*양도\s*결정',                               'bsnTrfDecsn',            2.0, null, null),
  ('d_asset_buy',  '공시', '유형자산 양수 결정',  '유형자산\s*양수\s*결정',                           'tgastInhDecsn',          1.5, null, null),
  ('d_asset_sell', '공시', '유형자산 양도 결정',  '유형자산\s*양도\s*결정',                           'tgastTrfDecsn',          1.5, null, null),
  ('d_stake_buy',  '공시', '타법인 지분 인수',    '타법인\s*주식\s*및\s*출자증권\s*양수\s*결정',      'otcprStkInvscrInhDecsn', 1.5, null, null),
  ('d_stake_sell', '공시', '타법인 지분 매각',    '타법인\s*주식\s*및\s*출자증권\s*양도\s*결정',      'otcprStkInvscrTrfDecsn', 1.5, null, null),
  ('d_capcut',     '공시', '감자 결정',           '감자\s*결정',                                      'crDecsn',                1.5, '스팩|기업인수목적', null),
  ('d_rehab',      '공시', '회생절차 신청',       '회생\s*절차',                                      'ctrcvsBgrq',             3.0, null, null),
  ('d_dissolve',   '공시', '해산사유 발생',       '해산\s*사유',                                      'dsRsOcr',                2.5, '스팩|기업인수목적', '스팩 해산은 정례'),
  ('d_suspend',    '공시', '영업정지',            '영업\s*정지',                                      'bsnSp',                  2.5, null, null),
  ('d_default',    '공시', '부도 발생',           '부도\s*발생',                                      'dfOcr',                  3.0, null, null),
  ('d_noncurrent', '공시', '비유동자산 취득·처분','비유동자산\s*(취득|처분)\s*결정',                  null,                     1.0, null, '상세 API 없음'),
  -- 발행 (판정 이름 = rule_key)
  ('i_base',        '발행', '최근 발행',            null, null, 0.5, '스팩|기업인수목적', '모든 발행의 기본 점수'),
  ('i_undersub',    '발행', '수요예측 미달',        null, null, 3.0, null, null),
  ('i_big_increase','발행', '2배 이상 증액',        null, null, 1.5, null, '최초 모집액 대비 확정액 +100% 이상'),
  ('i_hot_demand',  '발행', '경쟁률 10배 이상',     null, null, 1.0, null, null),
  ('i_jumbo',       '발행', '대형 발행',            null, null, 1.5, null, '회사채 5천억, 메자닌·유상증자 1천억, IPO 1천억 이상'),
  ('i_long',        '발행', '10년 이상 장기물',     null, null, 2.0, null, null),
  ('i_low_grade',   '발행', 'BBB급 이하 공모채',    null, null, 2.0, null, null),
  ('i_multi',       '발행', '3개 이상 트랜치',      null, null, 0.5, null, null),
  ('i_wide_spread', '발행', '가산금리 +30bp 이상',  null, null, 1.5, null, null),
  ('i_first',       '발행', '수집 기간 중 첫 발행', null, null, 2.5, null, null),
  ('i_hybrid',      '발행', '신종자본증권',         null, null, 1.0, null, null),
  ('i_public_mezz', '발행', '공모 메자닌',          null, null, 1.5, null, null),
  ('i_zero',        '발행', '표면·만기 0% 메자닌',  null, null, 0.5, null, null),
  ('i_low_refix',   '발행', '리픽싱 하한 70% 미만', null, null, 0.5, null, null),
  ('i_dilution',    '발행', '신주 비율 30% 이상',   null, null, 1.5, null, null),
  ('i_public_eq',   '발행', '주주배정·일반공모 증자', null, null, 1.0, null, null),
  ('i_ipo',         '발행', 'IPO 공모가 확정',      null, null, 1.0, null, null),
  ('i_band_out',    '발행', '공모가 밴드 밖 확정',  null, null, 1.5, null, null)
on conflict (rule_key) do nothing;

-- 후보 ------------------------------------------------------------------------
create or replace function public.ingest_feed_candidates(p_asof date default current_date, p_days int default 14)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with fr as (select * from ref.feed_rules where is_active),
  w as (select fr.weight, fr.rule_key, fr.label_ko from fr where fr.tag = '발행'),
  -- 회사채: 발행 단위(트랜치 묶음)
  bond as (
    select
      'bond'::text as kind, i.issue_key as ref_key, i.corp_code, i.corp_name,
      coalesce(i.pricing_dt, i.deal_dt) as event_dt, i.latest_rcept_no as rcept_no,
      array_remove(array[
        case when i.is_undersubscribed then 'i_undersub' end,
        case when i.increase_pct >= 100 then 'i_big_increase' end,
        case when i.competition_ratio >= 10 then 'i_hot_demand' end,
        case when i.amount_krw >= 5e11 then 'i_jumbo' end,
        case when i.tenor_max >= 120 then 'i_long' end,
        case when i.rating_group in ('BBB', 'BB', 'B') then 'i_low_grade' end,
        case when i.tranche_count >= 3 then 'i_multi' end,
        case when i.spread_max_bp >= 30 then 'i_wide_spread' end,
        case when not exists (
          select 1 from mart.v_deals p
          where p.corp_code = i.corp_code and p.product_type = 'bond' and p.deal_dt < i.deal_dt) then 'i_first' end,
        case when i.sub_type = '신종자본증권' then 'i_hybrid' end
      ], null) as flags,
      jsonb_build_object(
        '상품', '공모 회사채', '구분', i.sub_type, '등급', i.rating,
        '확정 발행액', core.fmt_krw(i.amount_krw),
        '최초 모집액', core.fmt_krw(i.initial_amount_krw),
        '증액률', case when i.increase_pct is not null and i.increase_pct <> 0 then trim_scale(i.increase_pct)::text || '%' end,
        '전체 수요예측 경쟁률', case when i.competition_ratio is not null then trim_scale(i.competition_ratio)::text || '배' end,
        '만기 구성', i.tenor_combo,
        '트랜치', (
          select string_agg(
            concat_ws(' ', x ->> 'tenor_label', core.fmt_krw((x ->> 'amount_krw')::numeric),
              '(' || concat_ws(', ',
                case when x ? 'competition_ratio' then '경쟁률 ' || trim_scale((x ->> 'competition_ratio')::numeric)::text || '배' end,
                case when x ? 'final_spread_bp' then '가산금리 ' || case when (x ->> 'final_spread_bp')::numeric > 0 then '+' else '' end
                     || trim_scale((x ->> 'final_spread_bp')::numeric)::text || 'bp' end,
                case when x ? 'coupon_pct' then '금리 ' || trim_scale((x ->> 'coupon_pct')::numeric)::text || '%' end) || ')'),
            ' / ')
          from jsonb_array_elements(i.tranches) x),
        '대표주관', i.lead_managers,
        '수요예측일', to_char(i.pricing_dt, 'YYYY.MM.DD'),
        '납입일', to_char(i.deal_dt, 'YYYY.MM.DD')) as facts,
      i.amount_krw
    from mart.v_bond_issues i
    where coalesce(i.pricing_dt, i.deal_dt) > p_asof - p_days and coalesce(i.pricing_dt, i.deal_dt) <= p_asof
  ),
  -- 메자닌·유상증자·IPO: 딜 단위
  deal as (
    select
      v.product_type as kind, v.deal_key as ref_key, v.corp_code, v.corp_name,
      case v.product_type when 'ipo' then coalesce(v.pricing_dt, v.announce_dt, v.deal_dt) else coalesce(v.announce_dt, v.deal_dt) end as event_dt,
      v.latest_rcept_no as rcept_no,
      array_remove(array[
        case when v.product_type = 'mezz' and v.amount_krw >= 1e11 then 'i_jumbo'
             when v.product_type = 'equity' and v.amount_krw >= 1e11 then 'i_jumbo'
             when v.product_type = 'ipo' and v.amount_krw >= 1e11 then 'i_jumbo' end,
        case when v.product_type = 'mezz' and v.is_public then 'i_public_mezz' end,
        case when v.product_type = 'mezz' and v.coupon_pct = 0 and v.ytm_pct = 0 then 'i_zero' end,
        case when v.product_type = 'mezz' and v.refix_floor_ratio_pct < 70 then 'i_low_refix' end,
        case when v.product_type in ('mezz', 'equity') and not exists (
          select 1 from mart.v_deals p
          where p.corp_code = v.corp_code and p.product_type = v.product_type
            and coalesce(p.announce_dt, p.deal_dt) < coalesce(v.announce_dt, v.deal_dt)) then 'i_first' end,
        case when v.product_type = 'equity' and v.dilution_pct >= 30 then 'i_dilution' end,
        case when v.product_type = 'equity' and v.sub_type in ('주주배정', '주주배정후 일반공모', '일반공모', '주주우선공모증자') then 'i_public_eq' end,
        case when v.product_type = 'ipo' and v.pricing_dt is not null then 'i_ipo' end,
        case when v.product_type = 'ipo' and v.ipo_price_vs_band in ('상단 초과', '하단 미만') then 'i_band_out' end,
        case when v.product_type = 'ipo' and v.ipo_demand_ratio >= 1000 then 'i_hot_demand' end
      ], null) as flags,
      case v.product_type
        when 'mezz' then jsonb_build_object(
          '상품', v.product_label, '종류', v.sub_type, '발행액', core.fmt_krw(v.amount_krw),
          '공모 여부', case when v.is_public then '공모' when v.is_public is false then '사모' end,
          '표면이자율', case when v.coupon_pct is not null then trim_scale(v.coupon_pct)::text || '%' end,
          '만기이자율', case when v.ytm_pct is not null then trim_scale(v.ytm_pct)::text || '%' end,
          '전환·교환가', case when v.conv_price is not null then to_char(v.conv_price, 'FM999,999,999,990') || '원' end,
          '리픽싱 하한', case when v.refix_floor_ratio_pct is not null then trim_scale(v.refix_floor_ratio_pct)::text || '%' end,
          '조기상환청구 시작일', to_char(v.put_start_dt, 'YYYY.MM.DD'),
          '대표주관·인수인', coalesce(v.lead_managers, v.underwriters),
          '결정일', to_char(v.announce_dt, 'YYYY.MM.DD'),
          '납입일', to_char(v.payment_dt, 'YYYY.MM.DD'))
        when 'equity' then jsonb_build_object(
          '상품', '유상증자', '방식', v.sub_type, '조달액', core.fmt_krw(v.amount_krw),
          '신주 비율', case when v.dilution_pct is not null then trim_scale(round(v.dilution_pct, 1))::text || '%' end,
          '발행가', case when v.offer_price is not null then to_char(v.offer_price, 'FM999,999,999,990') || '원' end,
          '인수방식', v.underwriting_method, '대표주관', v.lead_managers,
          '결정일', to_char(v.announce_dt, 'YYYY.MM.DD'),
          '납입일', to_char(v.payment_dt, 'YYYY.MM.DD'))
        else jsonb_build_object(
          '상품', 'IPO', '구분', v.sub_type, '공모금액', core.fmt_krw(v.amount_krw),
          '확정공모가', case when v.offer_price is not null then to_char(v.offer_price, 'FM999,999,999,990') || '원' end,
          '희망밴드', case when v.ipo_band_low is not null then to_char(v.ipo_band_low, 'FM999,999,999,990') || '~' || to_char(v.ipo_band_high, 'FM999,999,999,990') || '원' end,
          '밴드 대비', v.ipo_price_vs_band,
          '수요예측 경쟁률', case when v.ipo_demand_ratio is not null then trim_scale(round(v.ipo_demand_ratio, 2))::text || '대 1' end,
          '구주매출 비중', case when v.ipo_secondary_pct is not null then trim_scale(round(v.ipo_secondary_pct, 1))::text || '%' end,
          '대표주관', v.lead_managers,
          '청약일', to_char(v.ipo_subscription_dt, 'YYYY.MM.DD'))
      end as facts,
      v.amount_krw
    from mart.v_deals v
    where v.product_type in ('mezz', 'equity', 'ipo') and v.status <> 'withdrawn'
      and coalesce(v.sub_type, '') <> '스팩'
      and case v.product_type when 'ipo' then coalesce(v.pricing_dt, v.announce_dt, v.deal_dt) else coalesce(v.announce_dt, v.deal_dt) end
          between p_asof - p_days + 1 and p_asof
  ),
  issued as (
    select * from bond union all select * from deal
  ),
  issued_scored as (
    select s.*,
      (select coalesce(sum(w.weight), 0) from w where w.rule_key = any (s.flags || array['i_base'])) as score,
      (select string_agg(w.label_ko, ', ' order by w.weight desc) from w where w.rule_key = any (s.flags)) as label
    from issued s
    where s.corp_name !~ coalesce((select exclude_pattern from fr where rule_key = 'i_base'), '$^')
  ),
  -- 주요사항보고서
  disc as (
    select distinct on (r.rule_key, f.corp_code)
      r.rule_key, r.label_ko, r.weight, r.endpoint, f.corp_code, f.corp_name, f.rcept_dt as event_dt, f.rcept_no,
      regexp_replace(f.report_nm, '^주요사항보고서\((.*)\)$', '\1') as report
    from fr r
    join raw.filings f
      on r.tag = '공시' and f.report_nm ~ r.report_pattern and f.report_nm !~ '^\['
     and f.rcept_dt > p_asof - p_days and f.rcept_dt <= p_asof
     and f.corp_name !~ coalesce(r.exclude_pattern, '$^')
    order by r.rule_key, f.corp_code, f.rcept_no desc
  ),
  disc_facts as (
    select d.*,
      jsonb_build_object('공시', d.report, '공시일', to_char(d.event_dt, 'YYYY.MM.DD'))
        || coalesce((
          select jsonb_object_agg(l.label_ko, core.fmt_field(it.item ->> l.field, l.unit))
            filter (where core.fmt_field(it.item ->> l.field, l.unit) is not null)
          from ref.detail_field_labels l
          where l.endpoint = d.endpoint), '{}'::jsonb) as facts,
      (select max(core.to_num(it.item ->> l.field)) from ref.detail_field_labels l
        where l.endpoint = d.endpoint and l.is_size) as size_krw
    from disc d
    left join lateral (
      select a.item from raw.api_items a
      where a.endpoint = d.endpoint and a.rcept_no = d.rcept_no
      order by a.item_id desc limit 1
    ) it on true
  ),
  allc as (
    select '발행'::text as tag, kind, ref_key, corp_code, corp_name, event_dt, rcept_no, flags,
      coalesce(label, '최근 발행') as label,
      score + case when amount_krw >= 1e12 then 1 when amount_krw >= 3e11 then 0.5 else 0 end as score,
      jsonb_strip_nulls(facts) as facts
    from issued_scored
    union all
    select '공시', rule_key, rcept_no, corp_code, corp_name, event_dt, rcept_no, array[rule_key], label_ko,
      weight + case when size_krw >= 1e12 then 1.5 when size_krw >= 1e11 then 1 when size_krw >= 1e10 then 0.5 else 0 end,
      jsonb_strip_nulls(facts)
    from disc_facts
  ),
  ranked as (
    select a.*,
      o.market, o.bond_deal_count, o.mezz_deal_count, o.equity_deal_count, o.latest_bond_rating,
      exists (select 1 from mart.v_deals v where v.corp_code = a.corp_code and v.nh_lead) as nh_lead_ever,
      row_number() over (partition by a.tag order by a.score desc, a.event_dt desc) as rn
    from allc a
    left join mart.v_company_overview o on o.corp_code = a.corp_code
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'tag', tag, 'kind', kind, 'ref_key', ref_key, 'corp_code', corp_code, 'corp_name', corp_name,
      'event_dt', event_dt, 'rcept_no', rcept_no, 'flags', to_jsonb(flags), 'label', label, 'score', score,
      'facts', facts,
      'context', jsonb_strip_nulls(jsonb_build_object(
        '시장', market, '공모채 발행 이력(건)', bond_deal_count, '메자닌 이력(건)', mezz_deal_count,
        '유상증자 이력(건)', equity_deal_count, '최근 회사채 등급', latest_bond_rating,
        'NH 대표주관 이력', case when nh_lead_ever then '있음' end)))
    order by score desc, event_dt desc), '[]'::jsonb)
  from ranked
  where rn <= case tag when '발행' then 30 else 25 end
$$;

-- 저장 ------------------------------------------------------------------------
create table if not exists core.feed_sets (
  asof            date primary key,
  items           jsonb not null,
  model           text,
  candidates_hash text,
  created_at      timestamptz not null default now()
);

create or replace function public.ingest_feed_hash()
returns text language sql stable security definer set search_path = '' as $$
  select candidates_hash from core.feed_sets order by asof desc limit 1
$$;

create or replace function public.ingest_put_feed_set(p_asof date, p_items jsonb, p_model text, p_hash text)
returns int language plpgsql security definer set search_path = '' as $$
begin
  insert into core.feed_sets (asof, items, model, candidates_hash)
  values (p_asof, coalesce(p_items, '[]'::jsonb), p_model, p_hash)
  on conflict (asof) do update set
    items = excluded.items, model = excluded.model, candidates_hash = excluded.candidates_hash, created_at = now();
  return jsonb_array_length(coalesce(p_items, '[]'::jsonb));
end
$$;

revoke execute on function public.ingest_feed_candidates(date, int), public.ingest_feed_hash(), public.ingest_put_feed_set(date, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_feed_candidates(date, int), public.ingest_feed_hash(), public.ingest_put_feed_set(date, jsonb, text, text)
  to service_role;
grant all on core.feed_sets to service_role;
grant select on ref.feed_rules, ref.detail_field_labels to service_role;
revoke execute on function core.fmt_krw(numeric), core.to_num(text), core.fmt_dart_date(text), core.fmt_field(text, text)
  from public, anon, authenticated;

create or replace view mart.v_feed as
with s as (select * from core.feed_sets order by asof desc limit 1)
select
  s.asof, s.model, s.created_at, (x.ord)::int as rank,
  x.it ->> 'tag'        as tag,
  x.it ->> 'kind'       as kind,
  x.it ->> 'kind_label' as kind_label,
  x.it ->> 'corp_code'  as corp_code,
  x.it ->> 'corp_name'  as corp_name,
  x.it ->> 'headline'   as headline,
  x.it ->> 'body'       as body,
  x.it ->> 'point'      as point,
  (x.it ->> 'event_dt')::date as event_dt,
  x.it ->> 'rcept_no'   as rcept_no,
  x.it ->> 'ref_key'    as ref_key,
  x.it ->> 'label'      as label,
  x.it -> 'flags'       as flags
from s cross join lateral jsonb_array_elements(s.items) with ordinality as x (it, ord);

grant select on mart.v_feed to anon, authenticated;


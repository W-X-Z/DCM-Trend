-- =====================================================================
-- 03. core : 정규화된 회사·딜
--
-- deal_key 규칙
--   bond   : bond:{corp_code}:{회차}            예) bond:00123456:108  (트랜치는 108-1, 108-2)
--   mezz   : mezz:{corp_code}:{CB|BW|EB}-{회차}  예) mezz:00123456:CB-2
--   equity : equity:{corp_code}:{최초 결정공시 접수번호}
-- 한 딜에 여러 공시(최초·정정·발행조건확정·실적보고)가 붙으므로 core.deal_filings 로 연결한다.
-- =====================================================================

-- 파싱 헬퍼 -----------------------------------------------------------

-- '30,000,000,000' / '금 삼백억원(\30,000,000,000)' / '-' → numeric
create or replace function core.parse_numeric(p text)
returns numeric
language sql immutable
set search_path = ''
as $$
  select case
    when p is null then null
    when regexp_replace(p, '[^0-9.\-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then regexp_replace(p, '[^0-9.\-]', '', 'g')::numeric
    else null
  end
$$;

-- 괄호 안 숫자 우선(원화 표기), 없으면 전체에서 숫자 추출
create or replace function core.parse_krw(p text)
returns numeric
language sql immutable
set search_path = ''
as $$
  select coalesce(
    core.parse_numeric((regexp_match(p, '\(\s*[\\￦₩]?\s*([0-9,]+)\s*\)'))[1]),
    core.parse_numeric(p)
  )
$$;

-- '2026년 04월 23일' / '2026.04.23' / '2026-04-23' / '20260423' → date
create or replace function core.parse_date_kr(p text)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  m text[];
begin
  if p is null then
    return null;
  end if;
  m := regexp_match(p, '(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})');
  if m is null then
    m := regexp_match(p, '(\d{4})(\d{2})(\d{2})');
  end if;
  if m is null then
    return null;
  end if;
  return make_date(m[1]::int, m[2]::int, m[3]::int);
exception when others then
  return null;
end
$$;

-- 'BBB0(S/N)' / 'A+ (한국기업평가), A0 (NICE)' → 가장 낮은 등급(보수적) 'A0'
create or replace function core.parse_rating(p text)
returns text
language sql stable
set search_path = ''
as $$
  select s.rating
  from regexp_matches(upper(coalesce(p, '')),
                      '(?<![A-Z])(AAA|AA|A|BBB|BB|B|CCC|CC|C|D)([+0-]?)(?![A-Z0-9+-])', 'g') as m(tok)
  join ref.rating_scale s
    on s.rating = m.tok[1] || case
                                when m.tok[2] = '' and m.tok[1] in ('AA', 'A', 'BBB', 'BB', 'B') then '0'
                                else m.tok[2]
                              end
  order by s.notch desc
  limit 1
$$;

-- 도메인별 원문 값 → 표준값 (ref.value_maps)
create or replace function core.map_value(p_domain text, p_raw text)
returns text
language sql stable
set search_path = ''
as $$
  select v.std_value
  from ref.value_maps v
  where v.domain = p_domain
    and p_raw ~ v.pattern
  order by v.priority
  limit 1
$$;

-- 증권사 표기 → 표준명. 사전에 없으면 정규화한 원문을 그대로 반환
create or replace function core.normalize_firm(p text)
returns text
language sql stable
set search_path = ''
as $$
  with n as (
    select regexp_replace(coalesce(p, ''), '주식회사|\(주\)|㈜|\s', '', 'g') as name
  )
  select coalesce(
    (select a.firm_std from ref.firm_aliases a, n where a.alias = n.name),
    nullif((select name from n), '')
  )
$$;

-- 보고서명 → (상품, 하위유형, 공시역할)
create or replace function core.classify_filing(p_report_nm text)
returns table (product_type text, sub_type text, role text)
language sql stable
set search_path = ''
as $$
  select
    (select r.product_type from ref.filing_product_rules r
      where r.is_active and p_report_nm ~ r.report_pattern order by r.priority limit 1),
    (select r.sub_type from ref.filing_product_rules r
      where r.is_active and p_report_nm ~ r.report_pattern order by r.priority limit 1),
    (select r.role from ref.filing_role_rules r
      where r.is_active and p_report_nm ~ r.report_pattern order by r.priority limit 1)
$$;

-- 회사 -----------------------------------------------------------------
create table core.companies (
  corp_code      text primary key,
  corp_name      text not null,
  corp_name_eng  text,
  stock_code     text,
  market         text check (market in ('유가증권', '코스닥', '코넥스', '기타')),
  induty_code    text,
  updated_at     timestamptz not null default now()
);
create index companies_name_trgm_idx on core.companies using gin (corp_name extensions.gin_trgm_ops);
comment on table core.companies is '회사 마스터. 비상장 공모채 발행사(법인구분 E)도 포함';

-- 딜 공통 --------------------------------------------------------------
create table core.deals (
  deal_key            text primary key,
  product_type        text not null references ref.products (product_type),
  sub_type            text,                         -- 회사채 구분 / CB·BW·EB / 증자 방식
  corp_code           text not null references core.companies (corp_code),
  series              text,                         -- 회차
  is_public           boolean,
  status              text not null default 'announced'
                      check (status in ('announced', 'priced', 'completed', 'withdrawn')),
  announce_dt         date,                         -- 최초 공시일(증권신고서 제출일 또는 이사회 결정일)
  pricing_dt          date,                         -- 수요예측일
  payment_dt          date,                         -- 납입일
  amount_krw          numeric,                      -- 확정 금액(없으면 신고 금액)
  initial_amount_krw  numeric,                      -- 최초 신고 금액
  first_rcept_no      text,
  latest_rcept_no     text,
  updated_at          timestamptz not null default now()
);
create index deals_product_dt_idx on core.deals (product_type, payment_dt desc);
create index deals_corp_idx on core.deals (corp_code);

create table core.deal_filings (
  deal_key   text not null references core.deals (deal_key) on delete cascade,
  rcept_no   text not null,
  role       text not null,
  rcept_dt   date,
  primary key (deal_key, rcept_no)
);

-- 회사채 조건 ----------------------------------------------------------
create table core.bond_terms (
  deal_key           text primary key references core.deals (deal_key) on delete cascade,
  bond_name          text,
  tenor_months       int,
  maturity_dt        date,
  coupon_pct         numeric,
  yield_pct          numeric,
  rating_raw         text,
  rating             text references ref.rating_scale (rating),
  guarantor          text,
  band_type          text check (band_type in ('고정금리', '개별민평', '등급민평', '국고채', '기타')),
  band_low           numeric,                       -- 고정금리: %, 스프레드형: bp
  band_high          numeric,
  demand_krw         numeric,                       -- 수요예측 총 참여금액
  demand_in_band_krw numeric,                       -- 밴드 상단 이내 참여금액
  demand_count       int,
  competition_ratio  numeric,                       -- 참여금액 ÷ 최초 신고금액
  final_spread_bp    numeric,                       -- 스프레드형 밴드의 확정 가산금리
  use_of_funds       jsonb
);

-- 메자닌 조건 ----------------------------------------------------------
create table core.mezz_terms (
  deal_key                text primary key references core.deals (deal_key) on delete cascade,
  coupon_pct              numeric,
  ytm_pct                 numeric,
  maturity_dt             date,
  conv_price              numeric,                  -- 전환(행사·교환)가액
  refix_floor_price       numeric,                  -- 시가하락 최저조정가액
  conv_start_dt           date,
  conv_end_dt             date,
  shares_to_issue         numeric,
  shares_ratio_pct        numeric,                  -- 발행주식총수 대비
  articles_remaining_krw  numeric,                  -- 정관상 잔여 발행한도
  lead_manager_raw        text,
  lead_manager            text,                     -- 적재 시 core.normalize_firm() 으로 표준화
  board_dt                date,
  purpose_facility_krw    numeric,
  purpose_operating_krw   numeric,
  purpose_debt_krw        numeric,
  purpose_acquisition_krw numeric,                  -- 타법인 증권 취득
  purpose_other_krw       numeric
);

-- 유상증자 조건 --------------------------------------------------------
create table core.equity_terms (
  deal_key                text primary key references core.deals (deal_key) on delete cascade,
  method_raw              text,
  new_shares              numeric,
  pre_shares              numeric,
  dilution_pct            numeric,                  -- 신주 ÷ 증자 전 주식수
  offer_price             numeric,
  underwriting_method     text check (underwriting_method in ('총액인수', '잔액인수', '모집주선')),
  board_dt                date,
  purpose_facility_krw    numeric,
  purpose_operating_krw   numeric,
  purpose_debt_krw        numeric,
  purpose_acquisition_krw numeric,
  purpose_other_krw       numeric
);

-- 인수인 ---------------------------------------------------------------
create table core.deal_underwriters (
  id          bigint generated always as identity primary key,
  deal_key    text not null references core.deals (deal_key) on delete cascade,
  firm_raw    text not null,
  firm_std    text,
  role        text check (role in ('대표주관', '인수', '주선')),
  method      text check (method in ('총액인수', '잔액인수', '모집주선')),
  amount_krw  numeric,
  fee_krw     numeric,
  unique (deal_key, firm_raw, role)
);
create index deal_underwriters_firm_idx on core.deal_underwriters (firm_std);

-- 회사별 채무증권 발행 이력 (정기보고서) -------------------------------
create table core.company_debt_issues (
  id              bigint generated always as identity primary key,
  corp_code       text not null references core.companies (corp_code),
  security_kind   text,
  issue_method    text,                             -- 공모/사모
  issue_dt        date,
  face_krw        numeric,
  rate_pct        numeric,
  rating_raw      text,
  maturity_dt     date,
  repaid_status   text,
  lead_manager    text,
  stlm_dt         date,                             -- 보고서 결산기준일
  rcept_no        text,
  unique (corp_code, security_kind, issue_dt, face_krw, maturity_dt)
);

-- 회사별 회사채 잔여만기 버킷 (정기보고서) -----------------------------
create table core.company_bond_maturity (
  corp_code    text not null references core.companies (corp_code),
  stlm_dt      date not null,
  scope        text not null default '합계',       -- 공모/사모/합계
  bucket_order int not null,
  bucket       text not null,                       -- 1년 이하 / 1~2년 / ... / 10년 초과
  amount_krw   numeric,
  rcept_no     text,
  primary key (corp_code, stlm_dt, scope, bucket_order)
);

-- 변환 함수 (raw → core) -----------------------------------------------
-- 회사 마스터: corpCode.xml + 공시검색의 법인구분 + 기업개황 업종
create or replace function core.refresh_companies()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  insert into core.companies (corp_code, corp_name, corp_name_eng, stock_code, market, induty_code, updated_at)
  select
    c.corp_code,
    c.corp_name,
    c.corp_eng_name,
    nullif(trim(c.stock_code), ''),
    case f.corp_cls when 'Y' then '유가증권' when 'K' then '코스닥' when 'N' then '코넥스'
                    when 'E' then '기타' end,
    co.item ->> 'induty_code',
    now()
  from raw.corp_codes c
  left join lateral (
    select rf.corp_cls from raw.filings rf
    where rf.corp_code = c.corp_code
    order by rf.rcept_dt desc limit 1
  ) f on true
  left join lateral (
    select a.item from raw.api_items a
    where a.endpoint = 'company' and a.corp_code = c.corp_code
    order by a.fetched_at desc limit 1
  ) co on true
  on conflict (corp_code) do update set
    corp_name     = excluded.corp_name,
    corp_name_eng = excluded.corp_name_eng,
    stock_code    = excluded.stock_code,
    market        = coalesce(excluded.market, core.companies.market),
    induty_code   = coalesce(excluded.induty_code, core.companies.induty_code),
    updated_at    = now();
  get diagnostics n = row_count;
  return n;
end
$$;

comment on function core.refresh_companies() is
  '회사 마스터 갱신. 딜 변환 함수(refresh_bond_deals 등)는 실제 API 응답 형식 확인 후 W1에 추가';

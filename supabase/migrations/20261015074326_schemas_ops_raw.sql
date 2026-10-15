-- =====================================================================
-- 01. 스키마 · 운영(ops) · 원천(raw)
--
-- 레이어 원칙
--   raw  : OpenDART 응답을 그대로 저장. 비즈니스 로직 없음. 재처리의 기준점.
--   ref  : 현업과 합의하는 규칙·사전·파라미터(행 수정만으로 로직 변경).
--   core : raw를 정규화한 딜·회사 테이블. 변환 함수로만 채움.
--   mart : 화면이 읽는 유일한 레이어(뷰·함수). 컬럼명이 화면과의 계약.
--   ops  : 수집 실행 이력, 파싱·품질 이슈.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists ops;
create schema if not exists raw;
create schema if not exists ref;
create schema if not exists core;
create schema if not exists mart;

comment on schema raw  is 'OpenDART 원천 응답 (수정 금지, 재처리 기준점)';
comment on schema ref  is '현업 합의 규칙·사전·파라미터 (행 수정으로 로직 변경)';
comment on schema core is '정규화된 회사·딜 (변환 함수로만 적재)';
comment on schema mart is '화면이 읽는 뷰·함수 (컬럼 = 화면 계약)';
comment on schema ops  is '수집 실행 이력과 품질 이슈';

-- ---------------------------------------------------------------------
-- ops
-- ---------------------------------------------------------------------
create table ops.ingest_runs (
  run_id        bigint generated always as identity primary key,
  job           text not null,                     -- list / bdRs / cvbdIsDecsn / backfill ...
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'running'
                check (status in ('running', 'success', 'partial', 'failed')),
  api_calls     integer not null default 0,
  rows_fetched  integer not null default 0,
  rows_written  integer not null default 0,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
comment on table ops.ingest_runs is '수집 실행 1회 = 1행 (GitHub Actions 실행 단위)';

create table ops.issues (
  issue_id    bigint generated always as identity primary key,
  stage       text not null check (stage in ('ingest', 'transform', 'parse', 'quality')),
  code        text not null,                       -- 예: parse_fail_demand, unknown_rating
  rcept_no    text,
  corp_code   text,
  detail      jsonb not null default '{}'::jsonb,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index issues_open_idx on ops.issues (stage, code) where not resolved;
comment on table ops.issues is '파싱 실패·데이터 이상 등 사람이 확인해야 하는 항목';

-- ---------------------------------------------------------------------
-- raw
-- ---------------------------------------------------------------------
create table raw.corp_codes (
  corp_code      text primary key,                 -- DART 고유번호 8자리
  corp_name      text not null,
  corp_eng_name  text,
  stock_code     text,
  modify_date    date,
  fetched_at     timestamptz not null default now()
);
comment on table raw.corp_codes is 'corpCode.xml 전체 회사 마스터';

create table raw.filings (
  rcept_no          text primary key,              -- 접수번호 14자리
  corp_code         text not null,
  corp_name         text,
  stock_code        text,
  corp_cls          text,                          -- Y 유가 / K 코스닥 / N 코넥스 / E 기타
  report_nm         text not null,
  flr_nm            text,
  rcept_dt          date not null,
  rm                text,
  pblntf_ty         text,
  pblntf_detail_ty  text,
  payload           jsonb not null,
  run_id            bigint references ops.ingest_runs (run_id),
  fetched_at        timestamptz not null default now()
);
create index filings_corp_dt_idx on raw.filings (corp_code, rcept_dt desc);
create index filings_dt_idx on raw.filings (rcept_dt desc);
comment on table raw.filings is '공시검색(list.json) 결과. 발행공시(C)·주요사항보고(B) 대상';

create table raw.api_items (
  item_id      bigint generated always as identity primary key,
  endpoint     text not null,                      -- bdRs / estkRs / cvbdIsDecsn / piicDecsn / detScritsIsuAcmslt ...
  corp_code    text not null,
  rcept_no     text,                               -- 공시 단위 API면 접수번호
  period_key   text,                               -- 정기보고서 API면 '2025-11011' 형식
  group_title  text,                               -- 그룹형 응답(일반사항·인수인정보 등)의 그룹명
  item         jsonb not null,                     -- list 항목 1건
  item_hash    text not null,                      -- 수집기가 md5(item) 계산
  run_id       bigint references ops.ingest_runs (run_id),
  fetched_at   timestamptz not null default now(),
  unique (endpoint, corp_code, item_hash)
);
create index api_items_ep_rcept_idx on raw.api_items (endpoint, rcept_no);
create index api_items_ep_corp_idx on raw.api_items (endpoint, corp_code);
comment on table raw.api_items is '구조화 API 응답을 list 항목 단위로 저장 (같은 항목 재수집 시 중복 없음)';

create table raw.documents (
  rcept_no    text not null,
  section     text not null,                       -- demand_forecast / band_basis ...
  content     text not null,                       -- 원문에서 잘라낸 해당 섹션
  fetched_at  timestamptz not null default now(),
  primary key (rcept_no, section)
);
comment on table raw.documents is '원문(document.xml)에서 파싱 대상 섹션만 잘라 저장';

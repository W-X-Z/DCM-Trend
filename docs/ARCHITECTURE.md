# DCM-Trend 아키텍처

## 1. 목적

커버리지 본부 RA·RM이 발행사 미팅·제안 전에 쓰는 웹 서비스.

| 기능 | 입력 | 출력 |
|---|---|---|
| ① 회사 검색 | 회사명 | 회사 개요, 조달 이력(회사채·메자닌·유증), 만기 구조, 유사 딜 |
| ② 유형별 트렌드 | 상품, 기간 | 월별 건수·금액, 조건 분포, 수수료 bp, 주관 순위, 주목할 딜 |

데이터는 OpenDART 공개 데이터만 쓴다. 수요예측 실명 데이터 등 사내 데이터는 후속 개발 요건으로 둔다.

## 2. 전체 흐름

```
OpenDART API
   │  (GitHub Actions: 매일 1회 증분 + 수동 백필)
   ▼
Supabase Postgres
   raw  ── 응답 원본 그대로
   │  core.refresh_*()  (SQL 변환 함수)
   ▼
   core ── 정규화된 회사·딜          ref ── 현업 합의 규칙·사전·파라미터
   │                                  │
   └──────────────┬───────────────────┘
                  ▼
   mart ── 화면용 뷰·함수 (anon 읽기 전용)
                  │
                  ▼
Vercel (Next.js) ── RA·RM
```

## 3. 레이어

| 스키마 | 역할 | 쓰는 주체 | 바뀌는 시점 |
|---|---|---|---|
| `raw` | OpenDART 응답 원본. 비즈니스 로직 없음 | 수집기 | 매일 |
| `ref` | 분류 규칙, 값 표준화 사전, 등급 척도, 증권사 표준명, 유사 딜 가중치, 파라미터, 지표 정의 | 사람 (현업 합의) | 인터뷰 후 |
| `core` | 정규화된 회사·딜·조건·인수인 | `core.refresh_*()` 함수 | 매일 (raw 변환) |
| `mart` | 화면이 읽는 유일한 레이어 | SQL 뷰·함수 | 로직 개선 시 |
| `ops` | 수집 실행 이력, 파싱·품질 이슈 | 수집기·변환 함수 | 매일 |

**원칙**

1. 수집기는 raw 에만 쓴다. 해석하지 않는다.
2. 해석은 전부 SQL 이다. raw → core 는 변환 함수, core → mart 는 뷰.
3. 현업과 합의할 값은 코드가 아니라 `ref` 행이다. 행을 바꾸면 결과가 바뀐다.
4. 화면은 `mart` 만 본다. 뷰 이름·컬럼은 화면과의 계약이라 지우거나 이름을 바꾸지 않는다(추가는 가능).
5. raw 를 보존하므로 규칙이 바뀌면 core 를 다시 만들 수 있다.

## 4. 데이터 소스 매핑

| OpenDART API | raw | core | 상품 |
|---|---|---|---|
| 고유번호 `corpCode.xml` | `raw.corp_codes` | `core.companies` | 공통 |
| 공시검색 `list.json` (발행공시 C, 주요사항보고 B) | `raw.filings` | `core.deal_filings` (공시 분류) | 공통 |
| 기업개황 `company.json` | `raw.api_items` | `core.companies.induty_code` | 공통 |
| 증권신고서 채무증권 `bdRs.json` | `raw.api_items` | `core.deals`, `core.bond_terms`, `core.deal_underwriters` | 회사채 |
| 원문 `document.xml` (발행조건확정 신고서, 메자닌 발행결정) | `raw.doc_fields` (뽑은 값만) | `core.apply_doc_fields()` → 등급·밴드·확정 가산금리·경쟁률, IPO 밴드·확정가, 메자닌 풋 | 회사채·IPO·메자닌 |
| 전환사채권·신주인수권부사채권·교환사채권 발행결정 | `raw.api_items` | `core.deals`, `core.mezz_terms` | 메자닌 |
| 유상증자 결정 `piicDecsn.json` | `raw.api_items` | `core.deals`, `core.equity_terms` | 유증 |
| 증권신고서 지분증권 `estkRs.json` | `raw.api_items` | 상장사: `core.equity_terms` / 비상장·코넥스: `core.ipo_terms` | 유증·IPO |
| 채무증권 발행실적 `detScritsIsuAcmslt.json` | `raw.api_items` | `core.company_debt_issues` | 회사 이력 |
| 회사채·기업어음·단기사채 미상환 잔액 (`cprndNrdmpBlce`, `entrprsBilScritsNrdmpBlce`, `srtpdPsndbtNrdmpBlce`) | `raw.api_items` | (변환 없이) `mart.v_company_short_debt` | 만기도래 |
| 한국은행 ECOS 시장금리·기준금리 | `raw.rates` | (변환 없이) `mart.v_rates_daily` 등 | 금리 |

## 5. 핵심 규칙

**deal_key** — 한 딜에 여러 공시(최초·정정·발행조건확정·실적보고)가 붙으므로 딜 키를 따로 둔다.

| 상품 | 형식 | 예 |
|---|---|---|
| 회사채 | `bond:{corp_code}:{회차}` | `bond:00123456:108`, 트랜치는 `108-1` |
| 메자닌 | `mezz:{corp_code}:{CB/BW/EB}-{회차}` | `mezz:00123456:CB-2` |
| 유증 | `equity:{corp_code}:{최초 결정공시 접수번호}` | |

**기준일(deal_dt)** — `mart.v_deals` 한 곳에서만 정의한다. 회사채는 납입일, 메자닌·유증은 이사회 결정일.

## 6. 화면 ↔ mart 계약

| 화면 | 사용하는 mart 객체 |
|---|---|
| 회사 검색창 | `search_companies(q, lim)` |
| 회사 개요 카드 | `v_company_overview` |
| 조달 이력 표 | `v_deals` (corp_code 필터), `v_company_debt_issues` |
| 만기 구조 차트 | `v_company_maturity` |
| 유사 딜 | `similar_deals(deal_key)`, `find_comps(product, features)` → `v_deals` 조인 |
| 트렌드 차트 | `v_bond_trend_monthly`, `v_mezz_trend_monthly`, `v_equity_trend_monthly` |
| 수수료 | `v_fee_stats` |
| 주관 순위 | `v_league_table_yearly`, `v_league_credits` |
| 주목할 딜 | `v_notable_deals` |
| 툴팁·기본값 | `v_metric_catalog`, `v_ui_params`, `v_products` |
| 만기도래 | `v_maturities`, `v_maturity_monthly`, `v_company_short_debt` |
| 인사이트 | `insight_facts()`, `v_insight_summaries` |
| 금리 | `v_rate_latest`, `v_rates_daily`, `v_rate_spreads_daily`, `v_policy_events` |
| 최근 공시 | OpenDART 실시간 + `v_disclosure_rules` |
| IPO 동향 | `v_ipo_trend_monthly` |
| 데이터 기준·캐시 | `v_data_status`, `v_data_version` |

## 7. 수집

| 작업 | 주기 | 호출량 (추정) |
|---|---|---|
| 공시검색 증분 | 매일 07:10 | 수십 건 |
| 신규 공시 상세 API | 매일 | 신규 딜 수만큼 |
| 원문(발행조건확정·메자닌 결정) | 매일, 실행당 1,500건까지 | 밀린 과거분은 며칠에 나눠 처리 |
| 정기보고서 잔액 | 매일, 실행당 2,000건까지 | 보고기간이 바뀌면(5·8·11월 중순, 4월) 다시 받음 |
| ECOS 금리 | 매일 | 7개 계열, 마지막 날짜부터 |
| 인사이트 요약 | 매일 변환 뒤 | 사실이 바뀐 범위만 OpenAI 호출 |
| 과거 백필 | 최초 1회 | 24개월 + 회사채 2019~(회사별) + 메자닌 2021~ |

- 공시검색은 회사 지정 없이 3개월 단위로만 조회되므로 월 단위로 나눠 수집한다.
- 일일 호출 한도(약 2만 건)를 넘지 않도록 수집기가 `ops.ingest_runs.api_calls` 를 누적 관리한다.

## 8. 보안

- 공개 데이터만 적재한다. 고객 커버리지 리스트, 사내 딜 파이프라인, 수요예측 실명 데이터는 넣지 않는다.
- OpenDART 키·Supabase service_role 키는 GitHub Actions Secrets 에만 둔다. 화면(Vercel)에는 anon 키만 둔다.
- anon 은 `mart` 만 읽을 수 있다. 로그인 필수로 바꾸려면 `20261015074609_api_grants.sql` 의 anon 권한만 회수한다.

## 9. 후속 개발 요건

| 항목 | 이유 | 전제 |
|---|---|---|
| 수요예측 실명 데이터 | 밴드 시뮬레이터 정확도 | 신디케이션부 데이터 제공, 사내망 |
| 주가·시총 연동 | 메자닌 할증률, 유증 할인율 | KRX 데이터 경로 |
| 원문 파싱 확대 | 메자닌 투자자·콜/풋 조건, 유증 실권 결과 | 파싱 실패율 측정 후 |
| 민평 연동 | 민평 대비 스프레드 | 사내 구매 데이터 |

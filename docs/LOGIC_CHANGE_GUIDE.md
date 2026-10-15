# 현업 피드백 반영 가이드

현업 인터뷰에서 나온 피드백은 대부분 **`ref` 행 수정**이나 **`mart` 뷰 SQL 수정**으로 끝난다. 화면 코드와 수집기는 건드리지 않는다.

## 1. 어디를 바꾸나

| 피드백 예 | 바꿀 곳 | 방법 |
|---|---|---|
| "유사 딜은 만기 ±3개월만" | `ref.similarity_rules` | `tolerance` 6 → 3 |
| "유사 딜에 등급 ±1노치까지 넣어줘" | `ref.similarity_rules` | `rating_notch` 의 `tolerance` 0 → 1 |
| "업종이 같으면 가산점" | `mart.v_deal_features` + `ref.similarity_rules` | 특성 한 줄 추가 + 규칙 한 행 추가 |
| "캐피탈도 일반 회사채로 봐라" | `ref.value_maps` (`bond_category_corp`) | 패턴에서 `캐피탈` 제거 후 core 재변환 |
| "미달 기준은 경쟁률 1.0 말고 0.9" | `ref.params` | `undersubscribed_ratio` = 0.9 |
| "미달을 밴드 내 수요 기준으로" | `mart.v_deals` | `is_undersubscribed` 계산식 수정 |
| "대형 딜 기준 메자닌 500억" | `ref.params` | `large_deal_krw.mezz` 수정 |
| "트렌드 기본은 금융채 포함" | `ref.params` | `bond_trend_categories` 수정 |
| "리그테이블은 인수금액 기준" | 화면에서 `uw_rank` 사용 | 뷰 수정 불필요 |
| 새 증권사 표기가 깨짐 | `ref.firm_aliases` | 행 추가 |
| 새 지표 추가 | `mart` 트렌드 뷰 컬럼 추가 + `ref.metric_catalog` 행 추가 | 컬럼은 추가만, 삭제·이름 변경 금지 |
| "인사이트에 수수료 변화는 1bp만 바뀌어도 보여줘" | `ref.insight_rules` | `bond_fee_bp` 의 `min_change` 2 → 1 |
| "인사이트에서 공모 메자닌 비중은 빼줘" | `ref.insight_rules` | `is_active = false` |
| "인사이트 비교 기준을 전년 동기 대신 직전 12개월로" | `ref.insight_rules` | `compare` 'yoy' → 'trail' |
| "만기도래 기본 구간은 2~5개월" | `ref.params` | `maturity_window_months` (화면 탭 기본값도 함께) |
| "차환 신호는 만기 전 90일 안 신고서" | `ref.params` | `refi_signal_days` = 90 |
| "IPO 대형 기준 1,000억" | `ref.params` | `large_deal_krw_ipo` 수정 |
| 공시 분류가 틀림 ("감사보고서는 리스크가 아님") | `ref.disclosure_rules` | 패턴·분류·중요도 수정 (`priority` 작은 규칙이 먼저 적용) |
| 금통위 일정 변경·내년 일정 추가 | `ref.policy_events` | 행 추가·수정 |
| 금리 계열 추가 (예: 회사채 5년 AA-) | `ref.rate_series` | ECOS 통계표 코드와 항목명 정규식 한 행 추가 |
| 원문을 더 받거나 덜 받기 | `ref.document_fetch_rules` | 보고서명 정규식·기간(`lookback_days`)·사용 여부 |
| 정기보고서 잔액 API 추가·중단 | `ref.periodic_endpoints` | 행 추가·`is_active` |

## 2. 절차

1. **기대값부터 테스트에 적는다** — `tests/run.mjs` 에 "이렇게 나와야 한다"를 추가한다.
2. **바꾼다** — 새 마이그레이션 파일(`supabase/migrations/YYYYMMDDHHMMSS_설명.sql`)로 작성한다. `ref` 행 수정도 이력을 남기기 위해 파일로 남긴다.
3. **검증한다** — `npm test` (Supabase 없이 로컬에서 실행됨).
4. **반영한다** — PR → 머지 → `supabase db push` (또는 SQL Editor 에서 실행).
5. **합의 상태를 바꾼다** — 현업과 합의된 규칙은 `status = 'agreed'` 로 바꾼다.

## 3. 합의 상태 확인

```sql
select 'similarity' as kind, product_type || '.' || feature as item, status from ref.similarity_rules
union all
select 'param', key, status from ref.params
union all
select 'metric', metric_key, status from ref.metric_catalog
order by status, kind, item;
```

`draft` 가 남아 있으면 아직 현업 검증 전이다.

## 4. 원문 파서와 AI 요약

- **원문 파서** (`ingest/lib/docparse.mjs`): 신고서 본문은 형식이 깨진 XML 이라 태그를 지운 텍스트에 정규식을 쓴다. 증권사마다 표현이 달라 놓치는 문서가 생기면 `raw.doc_fields` 에 값이 없는 공시를 찾아 원문 표현을 보고 정규식을 추가한다. 테스트(`tests/docparse.mjs`)에 그 원문 조각을 먼저 넣는다.
- **값 반영** (`core.apply_doc_fields`): 어떤 필드를 어느 조건 컬럼에 넣을지는 SQL 에 있다.
- **AI 요약** (`ingest/lib/insights.mjs`): `mart.insight_facts()` 결과만 넣고, 요약에 사실에 없는 숫자나 전망 표현이 있으면 버리고 규칙 문장을 쓴다. 문체·길이는 같은 파일의 `SYSTEM` 프롬프트에서 바꾼다.

## 5. 지키는 것

- `mart` 뷰의 컬럼을 지우거나 이름을 바꾸지 않는다. 화면이 깨진다.
- 기준일(`deal_dt`) 규칙은 `mart.v_deals` 에서만 바꾼다.
- `raw` 는 고치지 않는다. 잘못 들어온 데이터는 `core` 변환 단계에서 거르고 `ops.issues` 에 남긴다.

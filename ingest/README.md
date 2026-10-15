# ingest (W1)

OpenDART → `raw` 적재 후 `core.refresh_*()` 호출.

- `list.json` 증분 수집 → `raw.filings`
- 신규 공시 유형별 상세 API → `raw.api_items` (list 항목 단위, `item_hash` 로 중복 제거)
- 발행조건확정 정정신고서 원문의 수요예측 섹션 → `raw.documents`
- 실행 이력 `ops.ingest_runs`, 실패 `ops.issues`

딜 변환 함수(`core.refresh_bond_deals` 등)는 실제 API 응답 형식을 확인한 뒤 추가한다.

# ingest

OpenDART → Supabase `raw` 적재 후 `core` 변환. 수집기는 해석하지 않고, 무엇을 부를지는 DB 규칙(`ref.detail_fetch_rules`)이 정한다.

## 흐름

| 단계 | 명령 | 쓰는 곳 |
|---|---|---|
| 접속 확인 | `probe` | `ops.ingest_runs` |
| 회사 마스터 | `corp-codes` (corpCode.xml) | `raw.corp_codes` |
| 공시 목록 | `filings --from --to` (발행공시 C001·C002, 주요사항보고 B001, 월 단위 분할) | `raw.filings` |
| 상세 API | `details` (DB 가 정한 대기 목록을 회사·API 단위로 묶어 호출) | `raw.api_items`, `raw.detail_fetches` |
| 변환 | `refresh` | `core.*` |

`daily` = 최근 7일 증분 전체, `backfill --from --to` = 기간 지정 전체.

## 실행

- 매일 07:10(KST): `.github/workflows/ingest-daily.yml` (main 머지 후 동작)
- 백필: Actions → ingest-backfill → 기간 입력 (main 머지 후)
- 개발 브랜치: `ingest/dev.config.json` 수정 후 push → `ingest-dev`

## 안전장치

- 실행당 호출 상한 `--max-calls` (기본 15,000) — 일일 한도 2만 건 보호. 상한 도달 시 `partial` 로 끝나고 다음 실행이 이어서 처리
- 020(한도 초과)·키·IP 오류는 즉시 중단, 800(점검)은 대기 후 재시도
- 데이터 없음(013)도 호출 기록을 남겨 같은 공시를 다시 부르지 않음
- 인증키는 로그에 남기지 않음 (`npm run test:ingest` 에서 검증)

## 테스트

`npm run test:ingest` — 모의 OpenDART·모의 Supabase(PGlite)로 전체 흐름 검증

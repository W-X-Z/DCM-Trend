# 발행시장 트렌드 (DCM-Trend)

커버리지 본부 RA·RM을 위한 딜 제안 Agent의 1단계(시장 모니터링)와 제안서 초안 도구.
OpenDART·ECOS 공개 데이터로 **① 시장·공시 모니터링**, **② 대상 기업 신호**, **③ 제안서 데이터 채움·부족 데이터 안내**를 제공한다.

운영 주소: https://ib-deal-agent.vercel.app

## 구조

```
supabase/migrations/   DB 스키마와 SQL 로직 (raw → core → mart, ref 규칙)
tests/                 실제 공시 픽스처로 SQL 로직 검증 (PGlite, Supabase 불필요)
ingest/                OpenDART 수집기 (GitHub Actions, 매일 07:10 KST)
web/                   Next.js 화면 (Vercel, 서울 리전) — web/README.md
docs/                  아키텍처, 로직 변경 가이드, 결정 사항
```

## 문서

- [아키텍처](docs/ARCHITECTURE.md) — 레이어, 데이터 흐름, 화면 ↔ mart 계약
- [현업 피드백 반영 가이드](docs/LOGIC_CHANGE_GUIDE.md) — 인터뷰 후 SQL·규칙만 고치는 방법
- [결정 사항](docs/DECISIONS.md) — 결정된 것과 대기 중인 것

## 테스트

```bash
npm install
npm test                 # SQL 로직: 108 신고서 'BBB0 최근 1년 발행사례 14건' 재현 등 41개 항목
npm run test:ingest      # 수집기 종단: 모의 OpenDART → 수집 RPC → raw → 변환
npm run test:transforms  # 실제 OpenDART 응답 샘플 → 딜 변환 결과 (원문 값 반영 포함)
npm run test:insights    # AI 요약 숫자·전망 표현 검증, 규칙 문장
npm run test:docparse    # 신고서 원문 파서 (실제 신고서 조각)
```

## 키 (값은 채팅·코드에 두지 않음)

| 키 | 위치 | 없으면 |
|---|---|---|
| `OPENDART_API_KEY` | GitHub Secrets, Vercel 환경변수 | 수집 중단 / 회사 화면 최근 공시만 빔 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | GitHub Secrets | 수집 중단 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Vercel 환경변수 | 화면 데이터 없음 |
| `ECOS_API_KEY` | GitHub Secrets | 금리 화면만 빔 |
| `OPENAI_API_KEY` (선택 `OPENAI_MODEL`) | GitHub Secrets | 인사이트가 규칙 문장으로 표시 |

## DB

- Supabase 프로젝트 `dcm-trend` (서울 리전, Postgres 17).
- `20261015081900_deal_transforms`, `20261015120000_transforms_phase2` 는 함수 본문의 삭제 구문 때문에 SQL 편집기에서 직접 적용한다(원격 이력에 없음). CLI 를 쓰기 전에 `supabase migration repair --status applied 20261015081900 20261015120000` 을 한 번 실행한다.
- 로컬 `supabase/migrations` 파일명의 버전은 원격 이력과 같다. 새 마이그레이션은 이 뒤에 추가한다.

```bash
supabase link --project-ref byajhicukluhlbzafclh
supabase db push            # 새 마이그레이션 적용
```

- 대시보드 설정: API > Exposed schemas 에 `mart` 추가 (화면이 mart 를 읽기 위해 필요)

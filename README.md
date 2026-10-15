# DCM-Trend

커버리지 본부 RA·RM을 위한 발행시장 모니터링 웹 서비스.
OpenDART 공개 데이터로 **① 회사별 조달 이력·유사 딜**과 **② 회사채·메자닌·유상증자 트렌드**를 보여준다.

## 구조

```
supabase/migrations/   DB 스키마와 SQL 로직 (raw → core → mart, ref 규칙)
tests/                 실제 공시 픽스처로 SQL 로직 검증 (PGlite, Supabase 불필요)
ingest/                OpenDART 수집기 (GitHub Actions)        ← W1
web/                   Next.js 화면 (Vercel)                    ← W2
docs/                  아키텍처, 로직 변경 가이드, 결정 사항
```

## 문서

- [아키텍처](docs/ARCHITECTURE.md) — 레이어, 데이터 흐름, 화면 ↔ mart 계약
- [현업 피드백 반영 가이드](docs/LOGIC_CHANGE_GUIDE.md) — 인터뷰 후 SQL·규칙만 고치는 방법
- [결정 사항](docs/DECISIONS.md) — 결정된 것과 대기 중인 것

## 테스트

```bash
npm install
npm test
```

이랜드월드 제108회 증권신고서의 'BBB0 최근 1년 발행사례 14건' 표를 유사 딜 로직이 그대로 재현하는지 등 33개 항목을 검증한다.

## DB

- Supabase 프로젝트 `dcm-trend` (서울 리전, Postgres 17). 마이그레이션 5개 적용 완료.
- 로컬 `supabase/migrations` 파일명의 버전은 원격 이력과 같다. 새 마이그레이션은 이 뒤에 추가한다.

```bash
supabase link --project-ref byajhicukluhlbzafclh
supabase db push            # 새 마이그레이션 적용
```

- 대시보드 설정: API > Exposed schemas 에 `mart` 추가 (화면이 mart 를 읽기 위해 필요)

# web — DCM 트렌드 화면

Next.js 14 (App Router). 모든 조회는 서버 컴포넌트에서 Supabase REST 로 `mart` 스키마만 읽는다.
키는 서버 환경변수로만 쓰고 브라우저로 보내지 않는다.

## 화면

| 경로 | 내용 | 읽는 mart 객체 |
|---|---|---|
| `/` | 발행사 검색, 상품별 최근 12개월 규모, 최근 30일 눈에 띄는 딜 | `v_bond/mezz/equity_trend_monthly`, `v_notable_deals`, `v_deals`, `v_ui_params` |
| `/search?q=` | 회사 이름 검색 (이름이 정확히 같은 회사가 하나면 바로 이동) | `search_companies()` |
| `/company/[corp_code]` | 회사 개요, 상품별 최근 발행, 발행 이력, 비슷한 다른 회사 딜 | `v_company_overview`, `v_deals`, `similar_deals()` |
| `/trends/[bond\|mezz\|equity]` | 월별 추이, 구성, 대표주관 순위, 인수수수료율, 최근 딜, 지표 정의 | `v_*_trend_monthly`, `v_league_table_yearly`, `v_fee_stats`, `v_metric_catalog` |

바닥글의 데이터 기준 시각은 `v_data_status` 에서 읽는다.

## 환경변수

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | publishable 키 (`sb_publishable_...`) 또는 legacy anon 키 |

## 로컬 실행 (실제 DB 없이)

```bash
npm install                                   # 저장소 루트 (PGlite)
node tests/mock_postgrest.mjs --port 54321    # 모의 Supabase REST: 마이그레이션 + 실제 API 샘플 + 가상 딜(SYN_)
cd web && npm install
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=dev npm run dev
```

가상 딜은 화면 확인용이며 운영 DB 에 넣지 않는다.

## 배포 (Vercel)

- Root Directory: `web`, Framework: Next.js
- 함수 리전: `icn1` (서울, `vercel.json`). DB 와 같은 리전이라 조회 지연이 작다.
- 데이터는 fetch 캐시 1시간. 수집은 하루 1회라 충분하다.

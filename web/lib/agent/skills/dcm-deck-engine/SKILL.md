---
name: dcm-deck-engine
description: 공모 회사채 제안서 엔진(코드 도구). 회사 찾기·데이터 받기, 기본 조건으로 초안 만들기, 행동(트랜치·납입일·밴드·장표·문안 등) 반영과 재계산, 문안 숫자 검사, 확인할 곳 검수, PPTX·PDF 산출을 한다. 제안서를 만들거나 고치거나 파일로 낼 때 반드시 이 엔진으로 한다.
---

# 제안서 엔진 (Tool)

조건 계산·장표 생성·검수·파일 산출은 모두 이 엔진이 한다. 직접 계산하거나 PPT를 따로 만들지 않는다.
너(LLM)는 사용자 요청을 **행동 목록**으로 바꾸고, 엔진이 값을 검사해 반영한다.
(Managed Agent 패키지에서는 같은 엔진을 `dcm` 명령으로 부른다. 도구 이름과 명령이 1:1 이다.)

## 도구

| 도구 | 하는 일 | 패키지 명령 |
|---|---|---|
| `dcm_search(query)` | 회사 찾기 → corp_code 후보 | `dcm search` |
| `dcm_load(corp_code, mode)` | 공시·금리·사례·DM 판 + 암묵지를 받고 초안을 연다. `mode: "resume"` 은 이 회사의 기존 초안을 이어서, `"new"` 는 기본 조건으로 새로 | `dcm fetch` + `dcm init` |
| `dcm_state()` | 입력값·일정·장표 목록·문안·근거 요약. 의도 해석의 기준 | `dcm state` |
| `dcm_slides()` | 쪽·id·제목 | `dcm slides` |
| `dcm_apply(actions)` | 행동 반영(값 검사 → 입력 반영 → 다시 계산). 결과: 바뀐 것·알림(거절 이유)·관련 장표·Sales 문안 필요 여부 | `dcm apply` |
| `dcm_facts(sales)` | 문안 근거 사실 묶음. `sales: true` 는 Sales Writer 에게 넘길 묶음 | `dcm facts [--sales]` |
| `dcm_set_sales(lines)` | Sales 전략 문안 넣기(숫자·전망 표현 검사 통과한 줄만, 최대 5줄) | `dcm set-sales` |
| `dcm_check()` | 확인할 곳(입력 확인·판단 확인·데이터 확인·갱신 필요) | `dcm check` |
| `dcm_report()` | 장표별로 쓴 외부 데이터, 미연계 내부 데이터 | `dcm report` |
| `dcm_render()` | PPTX·PDF 를 지금 상태로 만든다(사용자 화면에서 내려받음) | `dcm render` |
| `dcm_schema()` | 행동 종류·장표 id·문안 칸·템플릿 | `dcm schema` |

## 처음 초안

1. `dcm_search` → corp_code 확인(여럿이면 사용자에게 고르게 한다)
2. `dcm_load(corp_code, "resume")` → 결과의 `이어서` 가 true 면 기존 초안을 이어서 하는지 사용자에게 알린다. 새로 원하면 `"new"`.
3. `dcm_render`
4. 첫 답: "{회사} 제{회차}회 공모사채 제안서 초안 {N}장을 만들었어요. 딜 조건이나 전략을 바꾸고 싶으시면 편하게 말씀해주세요."

## 요청 반영 (의도 해석 → 실행 계획)

1. 필요하면 `dcm_state` 로 현재 값·장표 id·수요예측 가능일을 본다.
2. 요청을 행동 목록으로 쓴다. 형식은 `references/actions.md`. 쓰지 않는 칸은 빼도 된다. 한 번에 최대 8개.
3. `dcm_apply` → 결과의 `바뀐것` 과 `알림`(거절 이유)을 사용자에게 그대로 전한다. 엔진이 거절한 값을 우회해서 넣지 않는다.
4. `Sales문안필요` 가 나오면 Sales Writer 에게 맡긴다(아래).
5. 조건이 바뀌면 `dcm_render` 로 파일을 갱신한다.

질문(예: "이 트랜치 구조를 제안한 근거는?")이면 행동 없이 `dcm_state`·`dcm_facts` 의 값으로 답한다.

## Sub-agent 와 함께 쓰기 (`call_subagent`)

- Sales 전략 문안: `dcm_facts(sales: true)` 결과 JSON 을 `call_subagent(agent: "sales_writer", message: …)` 에 그대로 넣는다 → 받은 줄 배열을 `dcm_set_sales` 로 넣는다 → 뺀 줄과 이유를 사용자에게 알린다.
- 내용 피드백·비교 사례 추천·Sales 포인트: `dcm_state`·`dcm_facts`·`dcm_check` 결과를 `call_subagent(agent: "reviewer", message: …)` 에 넣는다. Reviewer 가 제안한 행동은 사용자 확인 뒤 `dcm_apply` 로 반영한다.
- Sub-agent 가 쓴 문장도 반드시 엔진 검사(`dcm_set_sales`, `dcm_apply` 의 edit_text)를 거친다.

## 엔진이 막는 것

- 문안의 숫자가 사실 묶음·규칙 문안·지금 문안·노하우에 없으면 그 줄을 뺀다.
- 금리·수요 방향 단정·확실 표현이 있으면 그 줄을 뺀다.
- 수요예측일은 가능일 3일 중에서만, 장표 id·템플릿·이자지급은 정해진 값만 받는다.
- 트랜치 금액을 바꾸면 최대 발행금액(증액 한도)과 일정을 같은 규칙으로 다시 계산한다.

## 참고

- `references/actions.md`: 행동 형식과 예시
- `references/review-marks.md`: 확인할 곳 종류와 사용자에게 알리는 방법

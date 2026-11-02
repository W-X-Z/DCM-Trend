# 행동(action) 형식

`dcm_apply` 의 `actions` (패키지에서는 `dcm apply` 에 넘기는 JSON): `[ {행동}, ... ]`. 최대 8개. 쓰지 않는 칸은 생략.

| type | 채울 값 | 설명 |
|---|---|---|
| `tranches` | `tranches: [{tenor: "3년", eok: 1000}]` | 트랜치 구성 전체 교체. 금액은 억원, 모르면 `eok: null`. 최대 발행금액은 자동 재계산 |
| `max_amount` | `eok` | 증액 시 최대 발행금액(억원) |
| `pay_date` | `date: "YYYY-MM-DD"` | 희망 납입일. "일주일 뒤로" 같은 상대 표현은 `state` 의 지금 납입일로 계산. 휴일이면 엔진이 다음 영업일로 옮김 |
| `demand_date` | `date` | 수요예측일. `state.일정.수요예측가능일` 중 하나만 |
| `band` | `band: {type: "spread"\|"fixed"\|"later", low, high}` | 금리 밴드. spread=개별민평 bp, fixed=%, later=추후 결정 |
| `coupon` | `text` | 이자지급: 3개월 이표채, 월단위 이표채, 6개월 이표채, 만기일시 |
| `rating` | `text` | 신용등급 표기(예: "AA-") |
| `fee` | `fee_uw`, `fee_lead` | 수수료(bp). 인수·대표주관, 바꾸지 않는 값은 생략 |
| `series` | `text` | 회차(예: "52") |
| `slides` | `items: [{id: "sales", on: true}]` | 장표 켜기·끄기. id 는 `dcm_schema` 또는 암묵지 toc.md |
| `template` | `text: "basic"\|"lite"` | 목차 템플릿(기본·간략) |
| `peer_scope` | `text: "group"\|"notch"` | 수요예측 사례 범위(등급군 전체·같은 노치) |
| `sales_ai` | — | Sales 전략 문안을 새로 씀 → 결과에 `Sales문안필요`, Sales Writer 호출 |
| `edit_text` | `field`, `lines: [...]` | 장표 요약 문안 고치기. `lead` 는 한 줄. 숫자는 상태에 있는 값만 |
| `goto` | `slide` | 그 장표를 보여 달라는 요청(파일에는 영향 없음) |
| `reset` | — | 처음 초안으로 되돌림(고친 문안·Sales 문안도 지움) |

## 문안 칸(field)

| field | 장표 |
|---|---|
| lead | 주요 제안 첫 문장 (Term-sheet 맨 위) |
| structure | 제안 Term-sheet 요약 |
| sizing | 트랜치 검토 |
| schedule | 발행 일정(안) |
| sales | Sales 전략 (Sales Writer 문안이 있으면 그것을 고침) |
| pipeline | 수요예측 예정 내역 |
| peers | 같은 등급 수요예측 결과 |
| compare | 미매각 사례 분석 |
| league | League Table |
| maturity | 만기도래 및 수급 |

## 예시

"3년 단일 1,500억으로 바꾸고 밴드는 ±20bp로"
```json
[
  {"type": "tranches", "tranches": [{"tenor": "3년", "eok": 1500}]},
  {"type": "band", "band": {"type": "spread", "low": -20, "high": 20}}
]
```

"납입일을 일주일 뒤로 미뤄줘" (state 의 희망납입일이 2027-01-18 일 때)
```json
[{"type": "pay_date", "date": "2027-01-25"}]
```

"간략 버전으로, Sales 전략은 빼고"
```json
[{"type": "template", "text": "lite"}, {"type": "slides", "items": [{"id": "sales", "on": false}]}]
```

"Term-sheet 첫 문장을 2년·3년 1,500억 제안으로"
```json
[{"type": "edit_text", "field": "lead", "lines": ["현대트랜시스는 AA- 등급으로 2년·3년 1,500억 발행 제안"]}]
```

## 결과 읽기

```json
{"바뀐것": ["트랜치 2년 600억 + 3년 900억 → 3년 1,500억", "..."],
 "알림": ["수요예측일은 1/7, 1/8, 1/11 중에서 고를 수 있어요."],
 "관련장표": "4쪽 1. 발행 조건 제안_① 제안 Term-sheet", "Sales문안필요": "...", "장표수": 22, "확인할곳": 13}
```

- `알림` 은 거절·조정 이유다. 사용자에게 그대로 전하고, 다른 값을 제안할 수 있다.
- `확인할곳` 이 늘었으면 `dcm_check` 로 무엇인지 본다.

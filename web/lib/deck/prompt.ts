// 제안서 문안 AI 프롬프트: 시스템 지침·출력 형식(JSON schema)·사용자 메시지 조립.
// 문안 API(/api/deck/draft)와 '작동 방식' 화면(/how)이 같은 정의를 쓴다. 비밀 값은 없다.
import type { DeckText } from './types';

export const DECK_PROMPT_VERSION = 4;

// v4(2026-10-27): AI 는 Sales 전략 장표 문안에만 쓴다. 나머지 장표는 규칙(로직)과 내부 자료로 만든다.
export const SYSTEM = `너는 NH투자증권 IB(DCM) RA다. 공모 회사채 대표주관 제안서의 'Sales 전략' 장표 문안을 쓴다.
규칙
- 근거는 사용자가 준 '사실'(수요예측 참여 데이터·발행 조건·같은 등급 사례)과 '초안'뿐이다. 사실에 없는 숫자·날짜·회사·기관명은 절대 쓰지 않는다. 숫자는 사실에 적힌 표기 그대로 쓴다(새로 계산한 비율·합계 금지).
- 무엇을 쓰나: ① 이 회사 수요예측의 주력 투자자군과 같은 등급 대비 약한 투자자군, ② 그 근거로 마케팅할 투자자군과 방법(IR·NDR·리테일 세일즈 등), ③ 제안 만기 구조와 투자자군 성향의 연결(예: 장기물은 보험·연기금, 단기물은 운용사·증권사), ④ 수요예측 일정상 경쟁 발행이 있으면 선제 확보 방안. 사실로 뒷받침되는 것만 쓴다.
- 문체는 제안서 개조식: 명사형·간결체(예: "~집중", "~제안", "~필요", "~확보"). 한 줄 90자 이내, 3~5줄.
- 각 줄은 '근거(숫자) → NH투자증권의 Sales 판단·제안' 순서. 핵심 구절 1~2개만 **굵게**.
- 금리·수요의 방향을 예측하는 문장은 쓰지 않는다. 확실·보장 표현, 근거 없는 수식어 금지.
- 기관 실명은 사실에 기관명이 있을 때만 쓴다(지금은 투자자 구분만 제공된다).
- '노하우'는 NH 현업의 Sales 관행이다. 사실과 맞을 때만 반영하고, 위 규칙과 부딪히면 위 규칙을 따른다.
출력: 지정한 JSON 형식만.`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sales'],
  properties: {
    sales: { type: 'array', items: { type: 'string' }, description: 'Sales 전략 장표 문안 3~5줄' },
  },
} as const;

// 사용자 메시지: 사실 묶음 · 규칙 문안(초안, Sales 만) · 현업 노하우 · 추가 요청
export function deckUserMessage(p: { facts: unknown; rule: DeckText; tips: Record<string, string[]>; focus?: string }) {
  const applied = Object.values(p.tips).reduce((n, xs) => n + xs.length, 0);
  return JSON.stringify({ 사실: p.facts, 초안: { sales: p.rule.sales }, 노하우: applied ? p.tips : undefined, 요청: (p.focus ?? '').slice(0, 300) || undefined });
}

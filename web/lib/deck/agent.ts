// 제안서 Agent 채팅: LLM 은 '의도 해석'만 하고(무엇을 바꿀지 행동 목록으로 돌려줌), 실제 변경은 이 파일의 코드가 한다.
// 행동은 아래 목록만 허용하고, 값은 하나씩 검사해 통과한 것만 입력값(DeckInput)에 넣는다. 장표는 입력값에서 다시 만든다.
import { ALL_ITEMS, TEMPLATES, type ItemId } from './catalog';
import { maxPlan, scheduleOf, totalEok } from './rules';
import type { DeckData, DeckInput, DeckText } from './types';

export const ACTION_TYPES = [
  'tranches', 'max_amount', 'pay_date', 'demand_date', 'band', 'coupon', 'rating', 'fee', 'series',
  'slides', 'template', 'peer_scope', 'sales_ai', 'edit_text', 'goto', 'reset',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type AgentAction = {
  type: ActionType;
  tranches: { tenor: string; eok: number | null }[] | null;
  eok: number | null;
  date: string | null;
  band: { type: 'later' | 'fixed' | 'spread'; low: number | null; high: number | null } | null;
  text: string | null;
  fee_uw: number | null;
  fee_lead: number | null;
  items: { id: string; on: boolean }[] | null;
  field: string | null;
  lines: string[] | null;
  slide: string | null;
};

export const COUPONS = ['3개월 이표채', '월단위 이표채', '6개월 이표채', '만기일시'];

// 채팅으로 고칠 수 있는 문안 칸
export const TEXT_FIELDS: { key: keyof DeckText; label: string }[] = [
  { key: 'lead', label: '주요 제안 첫 문장' },
  { key: 'structure', label: '제안 Term-sheet 요약' },
  { key: 'sizing', label: '트랜치 검토' },
  { key: 'schedule', label: '발행 일정(안)' },
  { key: 'sales', label: 'Sales 전략' },
  { key: 'pipeline', label: '수요예측 예정 내역' },
  { key: 'peers', label: '같은 등급 수요예측 결과' },
  { key: 'compare', label: '미매각 사례 분석' },
  { key: 'league', label: 'League Table' },
  { key: 'maturity', label: '만기도래 및 수급' },
];

// LLM 응답 형식 (OpenAI structured outputs, strict)
const nul = (s: object) => ({ anyOf: [s, { type: 'null' }] });
export const AGENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions'],
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'tranches', 'eok', 'date', 'band', 'text', 'fee_uw', 'fee_lead', 'items', 'field', 'lines', 'slide'],
        properties: {
          type: { type: 'string', enum: [...ACTION_TYPES] },
          tranches: nul({
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['tenor', 'eok'], properties: { tenor: { type: 'string' }, eok: nul({ type: 'number' }) } },
          }),
          eok: nul({ type: 'number' }),
          date: nul({ type: 'string' }),
          band: nul({
            type: 'object', additionalProperties: false, required: ['type', 'low', 'high'],
            properties: { type: { type: 'string', enum: ['later', 'fixed', 'spread'] }, low: nul({ type: 'number' }), high: nul({ type: 'number' }) },
          }),
          text: nul({ type: 'string' }),
          fee_uw: nul({ type: 'number' }),
          fee_lead: nul({ type: 'number' }),
          items: nul({
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['id', 'on'], properties: { id: { type: 'string' }, on: { type: 'boolean' } } },
          }),
          field: nul({ type: 'string' }),
          lines: nul({ type: 'array', items: { type: 'string' } }),
          slide: nul({ type: 'string' }),
        },
      },
    },
  },
} as const;

export const AGENT_SYSTEM = `너는 NH투자증권 IB 커버리지 RM을 돕는 공모 회사채 제안서 Agent다. 화면에는 규칙과 공시·금리 데이터로 만든 제안서 초안이 있고, 너는 사용자 요청을 해석해 초안을 바꿀 행동(actions)과 짧은 답(reply)을 JSON으로 돌려준다.

할 수 있는 행동(type)과 채울 값:
- tranches: 트랜치 구성 전체 교체. tranches=[{tenor:'3년', eok:1000}] (금액은 억원, 모르면 null)
- max_amount: 증액 시 최대 발행금액. eok
- pay_date: 희망 납입일. date='YYYY-MM-DD' (상대 표현은 상태의 현재 납입일·기준일로 계산)
- demand_date: 수요예측일. date 는 상태의 '수요예측 가능일' 중 하나
- band: 금리 밴드. band={type:'spread'(개별민평 bp)|'fixed'(%)|'later'(추후 결정), low, high}
- coupon: 이자지급. text 는 ${COUPONS.join(', ')} 중 하나
- rating: 신용등급 표기. text 예: 'AA-'
- fee: 수수료(bp). fee_uw(인수), fee_lead(대표주관), 바꾸지 않는 값은 null
- series: 회차. text 예: '35'
- slides: 장표 켜기·끄기. items=[{id, on}] (id 는 상태의 장표 목록 id)
- template: 목차 템플릿. text='basic'(기본) 또는 'lite'(간략)
- peer_scope: 수요예측 사례 범위. text='group'(등급군 전체) 또는 'notch'(같은 등급만)
- sales_ai: Sales 전략 문안을 AI로 새로 씀 (값 없음)
- edit_text: 장표 요약 문안 고치기. field=문안 칸 key, lines=새 문장 목록(lead 는 한 줄). 숫자는 상태에 있는 값만 쓴다
- goto: 그 장표로 이동. slide=장표 id
- reset: 입력값을 처음 초안으로 되돌림

규칙:
- 바꾸라는 요청이면 행동을 만들고, reply 는 무엇을 바꿨는지 한두 문장으로. 질문이면 actions=[] 로 두고 상태의 사실로 답한다.
- 숫자·날짜·회사 실적은 상태에 있는 값만 쓴다. 없는 값은 지어내지 말고 모른다고 말한다.
- 금리·수요 등 시장 방향을 단정하거나 예측하지 않는다. 출처 있는 의견만 '~에 따르면'으로 인용한다.
- 내부 데이터(민평, NH 리서치 전망표, 기관별 수요예측 북)는 이 프로토타입에 없다. 필요하면 사내 연계가 필요하다고 답한다.
- 할 수 없는 요청은 할 수 있는 가장 가까운 행동을 제안한다.
- 행동에서 쓰지 않는 값은 모두 null. reply 는 존댓말(~요)로 짧게, 굵게·목록 표기 없이.`;

// LLM 에 넘길 상태 요약 (브라우저에서 만든다). 내부 데이터 붙여넣은 값은 넣지 않는다.
export function agentState(d: DeckData, inp: DeckInput, text: DeckText, facts: Record<string, unknown>, extra: {
  slides: { id: string; title: string }[]; cur: string | null; review: string[]; available: (id: ItemId) => boolean;
}) {
  const sch = scheduleOf(d, inp);
  const pick = (k: string) => facts[k];
  return {
    기준일: d.asof,
    회사: { 이름: d.company.corp_name, 등급: d.company.rating, 공모채발행횟수: d.company.bond_count, 직전회차: d.company.last_series },
    입력값: {
      회차: inp.series, 신용등급: inp.rating, 트랜치: inp.tranches, 합계억원: totalEok(inp), 증액최대억원: inp.maxEok,
      이자지급: inp.coupon, 금리밴드: inp.band, 희망납입일: inp.pay, 수요예측일: sch?.demand ?? inp.demand,
      인수수수료bp: inp.feeUw, 대표주관수수료bp: inp.feeLead, 사례범위: inp.peerScope,
    },
    일정: sch && { 수요예측가능일: sch.demandOptions, 증권신고서: sch.filing, 대표주관계약: sch.leadContract, 납입: sch.pay, 주의: sch.warnings },
    장표목록: ALL_ITEMS.map((i) => ({ id: i.id, 제목: i.title, 켬: !!inp.items[i.id], 자료있음: extra.available(i.id) })),
    지금보는장표: extra.cur,
    만든장표: extra.slides.map((s) => s.title),
    확인필요: extra.review.slice(0, 12),
    문안: {
      lead: text.lead, structure: text.structure, sizing: text.sizing, schedule: text.schedule, sales: text.sales,
      발행조건표비고: text.termNotes,
    },
    근거: {
      제안조건: pick('제안조건'), 회사직전회차: (pick('회사직전회차') as unknown[] | undefined)?.slice(0, 3), 만기도래합계: pick('만기도래합계'),
      같은등급만기비중: pick('같은등급만기비중'), 회사만기분포: pick('회사만기분포'), 만기구조통계: pick('만기구조통계'), 금리: pick('금리'),
    },
  };
}

export type Applied = { input: DeckInput; changes: string[]; rejected: string[]; sales: boolean; goto: string | null; reset: boolean; edits: { field: keyof DeckText; lines: string[] }[] };

const TENOR = /^\s*\d+(\.\d+)?\s*(년|개월)(\s*또는\s*\d+(\.\d+)?\s*(년|개월))?\s*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATING = /^(AAA|AA|A|BBB|BB|B|CCC)[+\-0]?$/;
const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const trText = (t: { tenor: string; eok: number | null }[]) => t.map((x) => `${x.tenor} ${x.eok != null ? `${x.eok.toLocaleString('ko-KR')}억` : '금액 미정'}`).join(' + ');
const bandText = (b: DeckInput['band']) => (b.type === 'later' ? '추후 결정' : b.type === 'fixed' ? `고정 ${b.low}~${b.high}%` : `개별민평 ${b.low}~${b.high}bp`);
const title = (id: string) => ALL_ITEMS.find((i) => i.id === id)?.title ?? id;

// 행동 목록을 차례로 입력값에 반영한다. 값이 맞지 않는 행동은 rejected 에 이유를 남기고 건너뛴다.
export function applyActions(d: DeckData, input: DeckInput, actions: AgentAction[], available: (id: ItemId) => boolean): Applied {
  let inp = { ...input };
  const changes: string[] = [];
  const rejected: string[] = [];
  const edits: Applied['edits'] = [];
  let sales = false;
  let goto: string | null = null;
  let reset = false;

  for (const a of actions.slice(0, 8)) {
    switch (a.type) {
      case 'tranches': {
        const t = (a.tranches ?? []).map((x) => ({ tenor: x.tenor.trim(), eok: x.eok != null && x.eok > 0 ? Math.round(x.eok) : null }));
        if (!t.length || t.length > 5 || t.some((x) => !TENOR.test(x.tenor))) {
          rejected.push('트랜치는 만기(예: 3년)와 금액으로 1~5개까지 바꿀 수 있어요.');
          break;
        }
        changes.push(`트랜치 ${trText(inp.tranches)} → ${trText(t)}`);
        inp = { ...inp, tranches: t };
        // 금액이 바뀌면 증액 한도도 같은 규칙(최근 4회 최대 증액 배율)으로 다시 계산. 같은 요청에서 한도를 직접 주면 그 값을 쓴다
        if (!actions.some((x) => x.type === 'max_amount')) {
          const mx = maxPlan(d, totalEok(inp))?.max ?? null;
          if (mx != null && mx !== inp.maxEok) {
            changes.push(`증액 한도 ${inp.maxEok?.toLocaleString('ko-KR') ?? '–'}억 → ${mx.toLocaleString('ko-KR')}억 (규칙 재계산)`);
            inp = { ...inp, maxEok: mx };
          }
        }
        break;
      }
      case 'max_amount':
        if (a.eok == null || a.eok <= 0) { rejected.push('증액 한도 금액을 알 수 없어요.'); break; }
        changes.push(`증액 한도 ${inp.maxEok?.toLocaleString('ko-KR') ?? '–'}억 → ${Math.round(a.eok).toLocaleString('ko-KR')}억`);
        inp = { ...inp, maxEok: Math.round(a.eok) };
        break;
      case 'pay_date':
        if (!a.date || !DATE.test(a.date) || Number.isNaN(Date.parse(a.date)) || a.date < d.asof) { rejected.push('납입일은 기준일 이후 날짜(YYYY-MM-DD)여야 해요.'); break; }
        changes.push(`납입일 ${md(inp.pay)} → ${md(a.date)}`);
        inp = { ...inp, pay: a.date, demand: null };
        break;
      case 'demand_date': {
        const opts = scheduleOf(d, inp)?.demandOptions ?? [];
        if (!a.date || !opts.includes(a.date)) { rejected.push(`수요예측일은 ${opts.map(md).join(', ') || '납입일 기준 가능일'} 중에서 고를 수 있어요.`); break; }
        changes.push(`수요예측일 → ${md(a.date)}`);
        inp = { ...inp, demand: a.date };
        break;
      }
      case 'band': {
        const b = a.band;
        if (!b || (b.type !== 'later' && (b.low == null || b.high == null || b.low > b.high))) { rejected.push('금리 밴드는 하단·상단을 함께 알려 주세요.'); break; }
        const nb = b.type === 'later' ? { type: b.type, low: null, high: null } : { type: b.type, low: b.low, high: b.high };
        changes.push(`금리 밴드 ${bandText(inp.band)} → ${bandText(nb)}`);
        inp = { ...inp, band: nb };
        break;
      }
      case 'coupon':
        if (!a.text || !COUPONS.includes(a.text)) { rejected.push(`이자지급은 ${COUPONS.join(', ')} 중 하나예요.`); break; }
        changes.push(`이자지급 ${inp.coupon} → ${a.text}`);
        inp = { ...inp, coupon: a.text };
        break;
      case 'rating':
        if (!a.text || !RATING.test(a.text.trim())) { rejected.push('신용등급 표기를 알 수 없어요(예: AA-).'); break; }
        changes.push(`신용등급 ${inp.rating || '–'} → ${a.text.trim()}`);
        inp = { ...inp, rating: a.text.trim() };
        break;
      case 'fee': {
        const ok = (v: number | null) => v == null || (v >= 0 && v <= 100);
        if ((a.fee_uw == null && a.fee_lead == null) || !ok(a.fee_uw) || !ok(a.fee_lead)) { rejected.push('수수료는 0~100bp 로 알려 주세요.'); break; }
        if (a.fee_uw != null) { changes.push(`인수수수료 ${inp.feeUw ?? '–'}bp → ${a.fee_uw}bp`); inp = { ...inp, feeUw: a.fee_uw }; }
        if (a.fee_lead != null) { changes.push(`대표주관수수료 ${inp.feeLead ?? '–'}bp → ${a.fee_lead}bp`); inp = { ...inp, feeLead: a.fee_lead }; }
        break;
      }
      case 'series':
        if (!a.text || !/^\d{1,4}(-\d{1,2})?$/.test(a.text.trim())) { rejected.push('회차는 숫자로 알려 주세요.'); break; }
        changes.push(`회차 제${inp.series}회 → 제${a.text.trim()}회`);
        inp = { ...inp, series: a.text.trim(), coverTitle: inp.coverTitle.replace(/제[\d-]+회/, `제${a.text.trim()}회`) };
        break;
      case 'slides': {
        const items = { ...inp.items };
        for (const x of a.items ?? []) {
          const it = ALL_ITEMS.find((i) => i.id === x.id);
          if (!it) { rejected.push(`'${x.id}' 장표는 목록에 없어요.`); continue; }
          if (x.on && !available(it.id)) { rejected.push(`${it.title} 장표는 자료가 없어 넣을 수 없어요.`); continue; }
          if (!!items[it.id] === x.on) continue;
          items[it.id] = x.on;
          changes.push(`${it.title} 장표 ${x.on ? '넣음' : '뺌'}`);
        }
        inp = { ...inp, items };
        break;
      }
      case 'template': {
        const t = TEMPLATES.find((x) => x.key === (a.text === 'lite' ? 'lite' : a.text === 'basic' ? 'basic' : ''));
        if (!t) { rejected.push('목차 템플릿은 기본·간략 두 가지예요.'); break; }
        changes.push(`목차를 ${t.label} 템플릿으로`);
        inp = { ...inp, items: t.items() };
        break;
      }
      case 'peer_scope':
        if (a.text !== 'group' && a.text !== 'notch') { rejected.push('사례 범위는 등급군 전체 또는 같은 등급만 고를 수 있어요.'); break; }
        if (a.text === 'notch' && !d.company.rating) { rejected.push('회사 등급을 몰라 같은 등급만 볼 수 없어요.'); break; }
        changes.push(`수요예측 사례 범위 → ${a.text === 'notch' ? `${d.company.rating}만` : `${d.company.rating_group ?? ''}등급 전체`}`);
        inp = { ...inp, peerScope: a.text };
        break;
      case 'sales_ai':
        sales = true;
        if (!inp.items.sales && available('sales')) inp = { ...inp, items: { ...inp.items, sales: true } };
        break;
      case 'edit_text': {
        const f = TEXT_FIELDS.find((x) => x.key === a.field);
        const lines = (a.lines ?? []).map((l) => l.trim()).filter(Boolean);
        if (!f || !lines.length) { rejected.push('고칠 문안 칸을 알 수 없어요.'); break; }
        edits.push({ field: f.key, lines: f.key === 'lead' ? [lines.join(' ')] : lines.slice(0, 6) });
        break;
      }
      case 'goto':
        if (a.slide && ALL_ITEMS.some((i) => i.id === a.slide)) goto = a.slide;
        break;
      case 'reset':
        reset = true;
        changes.push('입력값을 처음 초안으로 되돌림');
        break;
    }
  }
  return { input: inp, changes, rejected, sales, goto, reset, edits };
}

export const itemTitle = title;

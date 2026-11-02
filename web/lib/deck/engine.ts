// 제안서 엔진 코어: 입력 상태(state) + 데이터로 초안을 만들고, 행동 반영·문안 검사·검수·데이터 목록을 돌려준다.
// 파일·네트워크를 쓰지 않는 순수 함수라 Agent 탭(서버 API)과 Managed Agent 패키지의 CLI(agent/tools/cli.ts)가 같이 쓴다.
// LLM 은 '무엇을 바꿀지'(행동)만 정하고, 값 검사·반영·재계산·검수는 여기서 한다.
import { ACTION_TYPES, COUPONS, TEXT_FIELDS, agentState, applyActions, type AgentAction } from './agent';
import { ALL_ITEMS, TEMPLATES, planOf } from './catalog';
import { forGrade, knowledgeForPrompt, type Knowledge } from './knowledge';
import { available, buildSlides, fileBase } from './layout';
import { qaChecks } from './qa';
import { MARK_LABEL, reviewMarks } from './review';
import { defaultInput, factsFor, ruleText, salesFacts } from './rules';
import { dataReport } from './sources';
import { allowedNumbers, lineOk } from './validate';
import type { DeckData, DeckInput, DeckText } from './types';

// edits: 사람이 고친 문안 칸만(나머지는 지금 입력값으로 늘 다시 만든 규칙 문안). salesAi: Sales Writer 문안
export type EngineState = { v: 2; corp: string; input: DeckInput; edits: Partial<DeckText>; salesAi: string[] | null };

export class EngineError extends Error {}

export const freshState = (d: DeckData): EngineState => ({ v: 2, corp: d.company.corp_code, input: defaultInput(d), edits: {}, salesAi: null });

// 저장된 상태를 지금 데이터 기본값과 합친다(새로 생긴 장표·칸 대비)
export function normalizeState(d: DeckData, st: EngineState | null | undefined): EngineState {
  if (!st || st.corp !== d.company.corp_code || !st.input) return freshState(d);
  const base = defaultInput(d);
  return {
    v: 2,
    corp: st.corp,
    input: { ...base, ...st.input, items: { ...base.items, ...st.input.items }, band: { ...base.band, ...st.input.band }, internal: { ...base.internal, ...st.input.internal } },
    edits: st.edits ?? {},
    salesAi: Array.isArray(st.salesAi) && st.salesAi.length ? st.salesAi : null,
  };
}

export function shownText(d: DeckData, st: EngineState): DeckText {
  const rule = ruleText(d, st.input);
  return { ...rule, ...st.edits, ...(st.salesAi ? { sales: st.salesAi } : {}) };
}

export function ctxOf(data: DeckData, knowledge: Knowledge[], st: EngineState) {
  const tips = forGrade(knowledge, data.company.rating_group);
  const rule = ruleText(data, st.input);
  const shown: DeckText = { ...rule, ...st.edits, ...(st.salesAi ? { sales: st.salesAi } : {}) };
  const avail = available(data, st.input);
  const slides = buildSlides(data, st.input, shown);
  const facts = factsFor(data, st.input);
  return { data, knowledge, tips, st, rule, shown, avail, slides, facts };
}
export type EngineCtx = ReturnType<typeof ctxOf>;
const reload = (c: EngineCtx, st: EngineState) => ctxOf(c.data, c.knowledge, st);

export function marksOf(c: EngineCtx) {
  const plan = planOf(c.st.input.items, c.avail);
  const on = new Set(plan.sections.flatMap((s) => s.items.map((i) => i.id)));
  const qa = qaChecks(c.data, c.st.input, c.shown, { on: (id) => on.has(id), edited: Object.keys(c.st.edits).length > 0, extraAllowed: [c.tips.map((k) => k.body)] });
  return reviewMarks(c.slides, c.data, c.st.input, c.shown, qa);
}

// LLM 이 빠뜨린 값은 null 로 채운다 (applyActions 는 모든 칸을 기대함)
const KEYS = ['tranches', 'eok', 'date', 'band', 'text', 'fee_uw', 'fee_lead', 'items', 'field', 'lines', 'slide'] as const;
export function normalizeActions(raw: unknown): AgentAction[] {
  const list = Array.isArray(raw) ? raw : (raw as { actions?: unknown[] })?.actions;
  if (!Array.isArray(list)) throw new EngineError('행동 목록은 [ {type, ...}, ... ] 또는 {"actions": [...]} 형식이어야 해요.');
  return (list as Record<string, unknown>[]).map((a) => {
    if (!ACTION_TYPES.includes(a?.type as never)) throw new EngineError(`모르는 행동: ${String(a?.type)} (가능: ${ACTION_TYPES.join(', ')})`);
    const x: Record<string, unknown> = { type: a.type };
    for (const k of KEYS) x[k] = a[k] ?? null;
    return x as AgentAction;
  });
}

// 행동·문안 칸 → 관련 장표
const SLIDE_OF: Partial<Record<AgentAction['type'], string>> = {
  tranches: 'terms', max_amount: 'terms', band: 'terms', coupon: 'terms', rating: 'terms', fee: 'terms', series: 'terms',
  pay_date: 'schedule', demand_date: 'schedule', peer_scope: 'peers', sales_ai: 'sales',
};
const SLIDE_OF_TEXT: Record<string, string> = {
  lead: 'terms', structure: 'terms', sizing: 'sizing', schedule: 'schedule', sales: 'sales', pipeline: 'pipeline',
  peers: 'peers', compare: 'compare', league: 'league', maturity: 'maturity',
};
export const baseId = (id: string) => id.replace(/-\d+$/, '');

// ── 명령 ────────────────────────────────────────────────────────────

export function loadSummary(c: EngineCtx, resumed: boolean) {
  const d = c.data;
  return {
    회사: d.company.corp_name, corp_code: d.company.corp_code, 기준일: d.asof, 등급: d.company.rating, 공모채발행횟수: d.company.bond_count,
    직전회차: d.company.last_series, 같은등급사례: d.peers.length, 만기도래: d.maturities.length, 암묵지: c.knowledge.length,
    초안: fileBase(c.st.input), 이어서: resumed, 장표수: c.slides.length, 장표: c.slides.map((s, i) => `${i + 1}. ${s.title}`), 확인할곳: marksOf(c).length,
  };
}

export function stateView(c: EngineCtx) {
  const marks = marksOf(c);
  return agentState(c.data, c.st.input, c.shown, c.facts as Record<string, unknown>, {
    slides: c.slides.map((s) => ({ id: s.id, title: s.title })),
    cur: null,
    review: marks.map((m) => `${c.slides[m.slide]?.title ?? ''}: ${m.text}`),
    available: c.avail,
  });
}

export const slideList = (c: EngineCtx) => c.slides.map((s, i) => ({ 쪽: i + 1, id: s.id, 제목: s.title }));

export function applyEngine(c: EngineCtx, raw: unknown) {
  const actions = normalizeActions(raw);
  const res = applyActions(c.data, c.st.input, actions, c.avail);
  const changes = [...res.changes];
  const notes = [...res.rejected];
  let st: EngineState;
  if (res.reset) {
    st = freshState(c.data);
  } else {
    st = { ...c.st, input: res.input, edits: { ...c.st.edits } };
    // 문안 고치기: 숫자는 (바뀐 조건 기준) 사실 묶음·규칙 문안·지금 문안·노하우에 있는 값만, 전망·단정 표현 금지
    if (res.edits.length) {
      const rule = ruleText(c.data, res.input);
      const allowed = allowedNumbers(factsFor(c.data, res.input), rule, c.shown, c.tips.map((k) => k.body));
      for (const e of res.edits) {
        const label = TEXT_FIELDS.find((f) => f.key === e.field)?.label ?? e.field;
        const checked = e.lines.map((l) => ({ l, v: lineOk(l, allowed, false) }));
        const ok = checked.filter((x) => x.v.ok).map((x) => x.l);
        if (!ok.length) {
          notes.push(`${label} 문안은 데이터에 없는 숫자나 전망 표현이 있어 고치지 않았어요: ${checked.map((x) => x.v.why).filter(Boolean).join(' / ')}`);
          continue;
        }
        if (e.field === 'sales' && st.salesAi) st.salesAi = ok;
        else st.edits = { ...st.edits, [e.field]: e.field === 'lead' ? ok[0] : ok };
        const bad = checked.filter((x) => !x.v.ok);
        changes.push(`${label} 문안 고침${bad.length ? ` (${bad.length}줄 제외: ${bad.map((x) => x.v.why).join(' / ')})` : ''}`);
      }
    }
  }
  const n = reload(c, st);
  const target = res.goto ?? (res.edits[0] ? SLIDE_OF_TEXT[res.edits[0].field] : null) ?? actions.map((x) => SLIDE_OF[x.type]).find(Boolean) ?? null;
  const at = target ? n.slides.findIndex((sl) => baseId(sl.id) === target) : -1;
  return {
    state: st,
    ctx: n,
    slide: at >= 0 ? at : null,
    out: {
      바뀐것: changes, 알림: notes, 관련장표: at >= 0 ? `${at + 1}쪽 ${n.slides[at].title}` : null,
      Sales문안필요: res.sales ? 'Sales Writer 에게 맡기세요: Sales 근거 묶음을 넘기고, 받은 줄을 Sales 문안 넣기로' : undefined,
      장표수: n.slides.length, 확인할곳: marksOf(n).length,
    },
  };
}

export function factsView(c: EngineCtx, sales: boolean) {
  if (sales) return { 사실: salesFacts(c.data, c.st.input), 초안: { sales: c.rule.sales }, 노하우: knowledgeForPrompt(c.tips, c.data.company.rating_group, ['sales']), 등급: c.data.company.rating_group };
  return { 사실: c.facts, 지금문안: c.shown, 고친칸: Object.keys(c.st.edits), Sales문안: c.st.salesAi ? 'Sales Writer' : '규칙' };
}

export function setSales(c: EngineCtx, raw: unknown) {
  const lines: unknown = Array.isArray(raw) ? raw : (raw as { sales?: unknown; lines?: unknown })?.sales ?? (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l === 'string')) throw new EngineError('문안은 ["줄1", "줄2", ...] 형식이어야 해요.');
  const allowed = allowedNumbers(salesFacts(c.data, c.st.input), c.rule.sales, knowledgeForPrompt(c.tips, c.data.company.rating_group, ['sales']));
  const checked = (lines as string[]).map((l) => ({ l, v: lineOk(l, allowed, false) }));
  const ok = checked.filter((x) => x.v.ok).map((x) => x.l).slice(0, 5);
  const st: EngineState = { ...c.st, salesAi: ok.length ? ok : null };
  const n = reload(c, st);
  const at = n.slides.findIndex((sl) => baseId(sl.id) === 'sales');
  return {
    state: st,
    ctx: n,
    slide: at >= 0 ? at : null,
    out: { 넣은줄: ok, 뺀줄: checked.filter((x) => !x.v.ok).map((x) => ({ 줄: x.l, 이유: x.v.why })), 결과: ok.length ? 'Sales 전략 장표에 반영' : '통과한 줄이 없어 규칙 문안 유지' },
  };
}

export function checkView(c: EngineCtx) {
  const marks = marksOf(c);
  return { 확인할곳: marks.length, 목록: marks.map((m) => ({ 쪽: m.slide + 1, 장표: c.slides[m.slide]?.title, 종류: MARK_LABEL[m.kind], 내용: m.text })) };
}

export function reportView(c: EngineCtx) {
  const r = dataReport(c.data, c.st.input, c.avail);
  const ext = new Map<string, { 데이터: string; 출처: string; 기준일: string | null; 장표: string[] }>();
  const int = new Map<string, { 데이터: string; 출처: string; 장표: string[] }>();
  for (const it of r.items) {
    for (const s of it.srcs) {
      const k = `${s.label}|${s.source}`;
      if (s.kind === 'ext' && s.status !== 'missing') {
        const e = ext.get(k) ?? { 데이터: s.label, 출처: s.source, 기준일: s.asof ?? null, 장표: [] };
        if (!e.장표.includes(it.label)) e.장표.push(it.label);
        ext.set(k, e);
      } else if (s.kind === 'int' && !/템플릿 고정 장표/.test(s.label)) {
        const e = int.get(k) ?? { 데이터: s.label, 출처: s.source, 장표: [] };
        if (!e.장표.includes(it.label)) e.장표.push(it.label);
        int.set(k, e);
      }
    }
  }
  for (const m of r.intMissing) if (!int.has(`${m.label}|${m.source}`)) int.set(`${m.label}|${m.source}`, { 데이터: m.label, 출처: m.source, 장표: m.items });
  return { 기준일: c.data.asof, 외부: [...ext.values()], 내부_미연계: [...int.values()] };
}

export function schemaView() {
  return {
    행동: ACTION_TYPES,
    이자지급: COUPONS,
    템플릿: TEMPLATES.map((t) => ({ key: t.key, 이름: t.label, 설명: t.hint })),
    장표: ALL_ITEMS.map((i) => ({ id: i.id, 제목: i.title, 기본: i.on })),
    문안칸: TEXT_FIELDS.map((f) => ({ field: f.key, 이름: f.label })),
  };
}

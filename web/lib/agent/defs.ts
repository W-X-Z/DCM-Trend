// Agent 탭(제안서 Agent + Agent Builder)의 공용 정의: 자산(프롬프트·노하우), 역할, 작업 세션, 노하우 항목·프롬프트 부분 편집.
// 브라우저와 서버가 같이 쓴다(서버 전용 코드 없음).
import assetsJson from './assets.json';
import type { EngineState } from '../deck/engine';
import type { DeckText } from '../deck/types';

export const MODEL = process.env.AGENT_MODEL || 'claude-haiku-5-5';

// ── 자산 ────────────────────────────────────────────────────────────
export const DEFAULT_ASSETS = assetsJson as Record<string, string>;
export type AssetKind = 'prompt' | 'knowhow';
export type AssetDef = { id: string; kind: AssetKind; group: 'dcm' | 'builder'; title: string };

export type RoleKey = 'company' | 'market' | 'deal' | 'sales' | 'deck' | 'review';
export type BuilderRoleKey = 'knowhow' | 'prompt' | 'impact';

export type RoleDef = {
  key: RoleKey; name: string; order: number;
  knowhow: string[]; // 시스템 프롬프트에 붙는 노하우 자산
  decide: string[]; // decide 로 바꿀 수 있는 것
  fields: TextField[]; // write 로 쓰는 문안 칸
  memo: boolean;
  does: string;
};
export type TextField = 'lead' | 'structure' | 'sizing' | 'schedule' | 'termNotes' | 'sales' | 'peers' | 'compare' | 'pipeline' | 'maturity' | 'corp';

export const ROLES: RoleDef[] = [
  { key: 'company', name: '기업 분석', order: 1, knowhow: ['knowhow.common', 'knowhow.company'], decide: [], fields: ['corp'], memo: true, does: '발행 패턴·수요 강도·차환 수요 메모, 최근 발행금리 문안' },
  { key: 'market', name: '시장 분석', order: 1, knowhow: ['knowhow.common', 'knowhow.market'], decide: ['peer_scope', 'peer_cases', 'compare'], fields: ['peers', 'compare', 'pipeline', 'maturity'], memo: true, does: '사례 범위·비교 사례 선택, 시장 메모, 수요예측 결과·예정·만기도래 문안' },
  { key: 'deal', name: '딜 구조 설계', order: 2, knowhow: ['knowhow.common', 'knowhow.deal'], decide: ['tranches', 'max_amount', 'band', 'coupon', 'pay_date', 'demand_date', 'fee'], fields: ['lead', 'structure', 'sizing', 'schedule', 'termNotes'], memo: true, does: '발행 조건 결정, Term-sheet·트랜치 검토·일정 문안' },
  { key: 'sales', name: 'Sales 세부 전략', order: 3, knowhow: ['knowhow.common', 'knowhow.sales'], decide: [], fields: ['sales'], memo: false, does: '투자자군별 마케팅 대상·방법, Sales 전략 문안' },
  { key: 'deck', name: '장표 구성', order: 4, knowhow: ['knowhow.common', 'knowhow.deck'], decide: ['slides', 'template'], fields: [], memo: false, does: '장표 켜고 끄기, 목차 템플릿' },
  { key: 'review', name: '검토', order: 5, knowhow: ['knowhow.common', 'knowhow.review', 'knowhow.deal', 'knowhow.market', 'knowhow.sales'], decide: [], fields: [], memo: false, does: '노하우 기준 점검 의견(고치지 않음)' },
];
export const roleOf = (k: string) => ROLES.find((r) => r.key === k);
export const ROLE_NAME: Record<string, string> = { master: 'Master', user: '사용자', ...Object.fromEntries(ROLES.map((r) => [r.key, r.name])) };

export const BUILDER_ROLES: { key: BuilderRoleKey; name: string; does: string }[] = [
  { key: 'knowhow', name: '노하우 편집', does: '고칠 노하우 항목을 찾아 그 항목만 수정안' },
  { key: 'prompt', name: '프롬프트 편집', does: '고칠 역할 프롬프트 부분만 수정안' },
  { key: 'impact', name: '영향 점검', does: '중복·모순, 영향받는 역할, 다시 실행 범위' },
];
export const BUILDER_NAME: Record<string, string> = { master: 'Builder Master', ...Object.fromEntries(BUILDER_ROLES.map((r) => [r.key, r.name])) };

export const ASSETS: AssetDef[] = [
  { id: 'dcm.master', kind: 'prompt', group: 'dcm', title: 'Master' },
  ...ROLES.map((r) => ({ id: `dcm.${r.key}`, kind: 'prompt' as const, group: 'dcm' as const, title: r.name })),
  { id: 'knowhow.common', kind: 'knowhow', group: 'dcm', title: '공통' },
  ...ROLES.filter((r) => r.key !== 'review').map((r) => ({ id: `knowhow.${r.key}`, kind: 'knowhow' as const, group: 'dcm' as const, title: r.name })),
  { id: 'knowhow.review', kind: 'knowhow', group: 'dcm', title: '검토' },
  { id: 'builder.master', kind: 'prompt', group: 'builder', title: 'Builder Master' },
  ...BUILDER_ROLES.map((r) => ({ id: `builder.${r.key}`, kind: 'prompt' as const, group: 'builder' as const, title: r.name })),
];
export const assetDef = (id: string) => ASSETS.find((a) => a.id === id);
// Builder 가 고칠 수 있는 자산: 제안서 Agent 의 프롬프트·노하우
export const EDITABLE = ASSETS.filter((a) => a.group === 'dcm').map((a) => a.id);

export type AssetTexts = Record<string, string>; // 지금 쓰는 판의 글
export const textOf = (a: AssetTexts, id: string) => a[id] ?? DEFAULT_ASSETS[id] ?? '';

// ── 문안 칸 ─────────────────────────────────────────────────────────
export const FIELD_LABEL: Record<TextField, string> = {
  lead: '주요 제안 첫 문장', structure: 'Term-sheet 요약', sizing: '트랜치 검토', schedule: '발행 일정', termNotes: 'Term-sheet 비고',
  sales: 'Sales 전략', peers: '수요예측 결과', compare: '미매각 사례 분석', pipeline: '수요예측 예정 내역', maturity: '만기도래', corp: '최근 발행금리',
};
export const FIELD_SLIDE: Record<TextField, string> = {
  lead: 'terms', structure: 'terms', termNotes: 'terms', sizing: 'sizing', schedule: 'schedule', sales: 'sales',
  peers: 'peers', compare: 'compare', pipeline: 'pipeline', maturity: 'maturity', corp: 'corp',
};
export const FIELD_OWNER = Object.fromEntries(ROLES.flatMap((r) => r.fields.map((f) => [f, r.key]))) as Record<TextField, RoleKey>;
// 발행 조건이 바뀌면 다시 써야 하는 칸
export const COND_FIELDS: TextField[] = ['lead', 'structure', 'sizing', 'schedule', 'termNotes', 'sales'];
export const CASE_FIELDS: TextField[] = ['peers', 'compare'];
export const TERM_NOTE_KEYS: (keyof DeckText['termNotes'])[] = ['rating', 'tenor', 'amount', 'band', 'coupon', 'demand', 'pay', 'uw', 'fee'];

// ── 작업 세션 ────────────────────────────────────────────────────────
export type Decision = { at: string; role: RoleKey | 'user'; what: string; reason: string; rules: string[] };
export type TextMark = { role: RoleKey; at: string; stale: boolean; dropped: number };
export type Flag = { at: string; role: RoleKey; text: string };
export type Session = {
  v: 1;
  state: EngineState | null;
  log: Decision[];
  memos: Partial<Record<RoleKey, string[]>>;
  texts: Partial<Record<TextField, TextMark>>;
  flags: Flag[];
  review: string | null;
  used: Record<string, number>; // 마지막 실행에 쓴 자산 판 번호
};
export const emptySession = (): Session => ({ v: 1, state: null, log: [], memos: {}, texts: {}, flags: [], review: null, used: {} });
export const staleFields = (s: Session) => (Object.entries(s.texts) as [TextField, TextMark][]).filter(([, m]) => m?.stale).map(([f]) => f);

// ── 노하우 항목 ──────────────────────────────────────────────────────
// 형식: '### DL-02 A등급 만기' 다음 줄부터 다음 '#' 머리까지가 한 항목
export type Item = { id: string; title: string; asset: string; section: string; start: number; end: number; block: string };
const ITEM_RE = /^### ([A-Z]{1,3}-\d{2}) (.+)$/;
export function parseItems(asset: string, text: string): Item[] {
  const lines = text.split('\n');
  const out: Item[] = [];
  let section = '';
  let cur: Omit<Item, 'end' | 'block'> | null = null;
  const close = (i: number) => {
    if (!cur) return;
    let e = i;
    while (e > cur.start + 1 && !lines[e - 1].trim()) e--;
    out.push({ ...cur, end: e, block: lines.slice(cur.start, e).join('\n') });
    cur = null;
  };
  lines.forEach((l, i) => {
    if (/^#{1,3} /.test(l)) close(i);
    if (/^## /.test(l)) section = l.slice(3).trim();
    const m = ITEM_RE.exec(l);
    if (m) cur = { id: m[1], title: m[2].trim(), asset, section, start: i };
  });
  close(lines.length);
  return out;
}
export const allItems = (a: AssetTexts) => ASSETS.filter((x) => x.kind === 'knowhow').flatMap((x) => parseItems(x.id, textOf(a, x.id)));
const prefixOf = (asset: string, text: string) => parseItems(asset, text)[0]?.id.split('-')[0] ?? 'X';
export function nextItemId(asset: string, text: string) {
  const items = parseItems(asset, text);
  const p = prefixOf(asset, text);
  const n = Math.max(0, ...items.map((i) => Number(i.id.split('-')[1]) || 0)) + 1;
  return `${p}-${String(n).padStart(2, '0')}`;
}
export const itemBlock = (id: string, title: string, body: string) => `### ${id} ${title.trim()}\n${body.trim()}`;

// ── 프롬프트 부분 ────────────────────────────────────────────────────
// '## 제목' 단위. 첫 '##' 앞의 소개 문단은 heading '' 로 본다.
export type Section = { heading: string; start: number; end: number; body: string };
export function parseSections(text: string): Section[] {
  const lines = text.split('\n');
  const heads = lines.map((l, i) => (/^## /.test(l) ? i : -1)).filter((i) => i >= 0);
  const out: Section[] = [];
  const first = heads[0] ?? lines.length;
  if (lines.slice(0, first).some((l) => l.trim())) out.push({ heading: '', start: 0, end: first, body: lines.slice(0, first).join('\n').trim() });
  heads.forEach((h, k) => {
    const e = heads[k + 1] ?? lines.length;
    out.push({ heading: lines[h].slice(3).trim(), start: h, end: e, body: lines.slice(h + 1, e).join('\n').trim() });
  });
  return out;
}

// ── 수정안 ──────────────────────────────────────────────────────────
export type Edit =
  | { kind: 'knowhow'; asset: string; op: 'replace' | 'add' | 'delete'; id: string; after: string | null; block: string }
  | { kind: 'prompt'; asset: string; op: 'replace'; section: string; body: string };
export type Proposal = {
  id: string; edit: Edit; target: string; before: string; after: string; reason: string; feedback: string;
  impact: string | null; status: 'open' | 'approved' | 'dropped'; at: string;
};

// 지금 글에 수정안을 적용. 대상이 없어지면 오류
export function applyEdit(text: string, e: Edit): string {
  const lines = text.split('\n');
  if (e.kind === 'prompt') {
    const s = parseSections(text).find((x) => x.heading === e.section);
    if (!s) throw new Error(`'${e.section || '소개'}' 부분을 찾지 못했어요.`);
    const repl = e.section ? [`## ${e.section}`, '', e.body.trim(), ''] : [e.body.trim(), ''];
    return [...lines.slice(0, s.start), ...repl, ...lines.slice(s.end)].join('\n').replace(/\n{3,}/g, '\n\n');
  }
  const items = parseItems(e.asset, text);
  if (e.op === 'add') {
    if (items.some((i) => i.id === e.id)) throw new Error(`${e.id} 항목이 이미 있어요.`);
    const after = e.after ? items.find((i) => i.id === e.after) : null;
    const at = after ? after.end : lines.length;
    const ins = ['', ...e.block.trim().split('\n')];
    const out = [...lines.slice(0, at), ...ins, ...lines.slice(at)].join('\n');
    return out.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
  }
  const it = items.find((i) => i.id === e.id);
  if (!it) throw new Error(`${e.id} 항목을 찾지 못했어요.`);
  const repl = e.op === 'delete' ? [] : e.block.trim().split('\n');
  return [...lines.slice(0, it.start), ...repl, ...lines.slice(it.end)].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

// ── 개발 요청·기억 ───────────────────────────────────────────────────
export type DevRequest = { id: string; at: string; title: string; detail: string; feedback: string; status: 'open' | 'done' };

// 메시지 형식(Claude Messages API)
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Msg = { role: 'user' | 'assistant'; content: string | Block[] };

export const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// ── 도구 설명(구성 화면) ─────────────────────────────────────────────
export type ToolDoc = { owner: string; name: string; kind: '조회' | '계산' | '검수' | '기록' | '산출' | '호출'; does: string };
export const TOOL_DOC: ToolDoc[] = [
  { owner: '제안서 Master', name: 'find_company', kind: '조회', does: '회사 이름으로 corp_code 후보를 찾는다' },
  { owner: '제안서 Master', name: 'open_company', kind: '조회', does: '회사 공시·금리·사례 데이터를 받고 초안(작업 세션)을 연다' },
  { owner: '제안서 Master', name: 'call_roles', kind: '호출', does: '역할에게 일을 맡긴다. 같은 순서는 동시에, 나머지는 순서대로' },
  { owner: '제안서 Master', name: 'session', kind: '조회', does: '작업 세션 요약: 조건·최근 결정·다시 써야 할 문안·확인 필요·검토 의견' },
  { owner: '제안서 Master', name: 'render', kind: '산출', does: '지금 상태로 PPTX·PDF 를 만든다' },
  { owner: '역할', name: 'facts', kind: '조회', does: '역할별 사실 묶음: 숫자·사례·지금 조건·앞 역할 메모 (계산은 도구가)' },
  { owner: '딜 구조·시장·장표', name: 'decide', kind: '기록', does: '고른 값을 값 검사 후 반영하고 결정 기록(근거·노하우 항목)에 남긴다. 일정·증액 한도는 다시 계산' },
  { owner: '기업·시장·딜·Sales', name: 'write', kind: '검수', does: '자기 장표 문안을 넣는다. 사실 묶음 밖 숫자·전망 단정이 든 줄은 빼고, 두 번 탈락하면 확인할 곳으로' },
  { owner: '기업·시장·딜', name: 'memo', kind: '기록', does: '다음 역할이 읽을 분석 메모를 남긴다(숫자 검사)' },
  { owner: '검토', name: 'session · checks', kind: '조회', does: '조건·결정 기록·문안 전체와 도구 검수(확인할 곳)' },
  { owner: 'Builder Master', name: 'list_targets', kind: '조회', does: '고칠 수 있는 노하우 항목·프롬프트 부분 목록' },
  { owner: 'Builder Master', name: 'call_editor · call_impact', kind: '호출', does: '편집 역할(노하우·프롬프트)과 영향 점검 역할에게 맡긴다' },
  { owner: 'Builder Master', name: 'record_dev_request · record_memory', kind: '기록', does: '도구·데이터 피드백은 개발 요청으로, 개인 선호는 기억으로' },
  { owner: '노하우·프롬프트 편집', name: 'propose_knowhow · propose_prompt', kind: '기록', does: '한 항목·한 부분만 고친 수정안(형식·적용 가능 여부 검사). 저장은 사용자 승인' },
];

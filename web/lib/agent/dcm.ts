// 제안서 Agent 실행(서버): Master 가 역할(Sub-agent 6개)을 부르고, 역할은 사실 묶음을 보고 노하우대로 결정·문안을 낸다.
// - 숫자는 도구, 문장은 AI: 도구는 사실 묶음·값 검사·계산·산출, 역할은 고르기와 문장 쓰기
// - 작업 세션(초안 상태·결정 기록·메모·문안 표시)은 브라우저가 들고 있다가 매 요청에 보낸다. 서버는 저장하지 않는다.
import 'server-only';
import { getDeckData } from '../deck/data';
import { ALL_ITEMS, TEMPLATES, templateOf } from '../deck/catalog';
import { EngineError, applyEngine, checkView, ctxOf, freshState, normalizeActions, normalizeState, baseId, type EngineCtx, type EngineState } from '../deck/engine';
import { eokW, mdw, ratioX } from '../deck/fmt';
import { fileBase } from '../deck/layout';
import { comboCounts, fullUnder, marketCrowd, maxPlan, payPlan, peerPool, pipelineOf, salesFacts, scheduleOf, totalEok } from '../deck/rules';
import { allowedNumbers, lineOk } from '../deck/validate';
import type { DeckData, DeckInput, DeckText, PeerIssue } from '../deck/types';
import { searchCompanies } from '../queries';
import {
  CASE_FIELDS, COND_FIELDS, FIELD_LABEL, FIELD_OWNER, FIELD_SLIDE, MODEL, ROLES, ROLE_NAME, TERM_NOTE_KEYS, emptySession, kstToday, roleOf, staleFields, textOf,
  type AssetTexts, type Block, type Msg, type RoleDef, type RoleKey, type Session, type TextField,
} from './defs';
import { J, ToolError, claude, claudeWhy, clip, obj, runLoop, textOf as textOfBlocks, tidyHistory, usesOf, type ToolDef } from './llm';

export type DcmEvent =
  | { t: 'text'; text: string }
  | { t: 'tool'; id: string; name: string; label: string; agent: 'master' | RoleKey; call?: string }
  | { t: 'tool_done'; id: string; ok: boolean; note: string }
  | { t: 'role'; call: string; role: RoleKey; phase: 'start' | 'end'; text?: string; fail?: boolean }
  | { t: 'open'; resume: boolean }
  | { t: 'session'; session: Session; slide: number | null }
  | { t: 'render'; name: string; slides: number }
  | { t: 'done'; messages: Msg[]; cont: boolean; model: string }
  | { t: 'error'; message: string };
export type DcmInput = { messages: Msg[]; session: Session; assets: AssetTexts; memory: string | null };

// ── 데이터 캐시 (같은 서버 인스턴스 안에서 1분) ──────────────────────────
const dataCache = new Map<string, { at: number; d: DeckData }>();
async function dataOf(corp: string) {
  const hit = dataCache.get(corp);
  if (hit && Date.now() - hit.at < 60_000) return hit.d;
  const d = await getDeckData(corp);
  if (!d) throw new ToolError(`회사(${corp}) 데이터를 찾지 못했어요.`);
  dataCache.set(corp, { at: Date.now(), d });
  if (dataCache.size > 30) dataCache.delete(dataCache.keys().next().value as string);
  return d;
}

// ── 표기 ────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const trText = (t: DeckInput['tranches']) => t.filter((x) => x.tenor).map((x) => `${x.tenor} ${x.eok != null ? `${x.eok.toLocaleString('ko-KR')}억원` : '금액 미정'}`).join(' + ') || '미정';
const bandTxt = (b: DeckInput['band']) => (b.type === 'later' ? '추후 결정' : b.type === 'fixed' ? `고정금리 ${b.low}%~${b.high}%` : `개별민평 ${b.low}~${b.high}bp`);
const pd = (p: PeerIssue) => p.demand_dt ?? p.pricing_dt ?? p.deal_dt ?? '';
const addMonths = (s: string, n: number) => {
  const x = new Date(`${s}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
};
const short = (s: string | null | undefined, n = 140) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? null);

// 수요예측 결과 표 사례: 최근 months 개월, 최대 max 건(적으면 전체 풀에서)
function pickPeerKeys(d: DeckData, scope: 'group' | 'notch', months: number, max: number) {
  const pool = peerPool(d, scope);
  const from = addMonths(d.asof, -months);
  const recent = pool.filter((p) => pd(p) >= from);
  return (recent.length >= 4 ? recent : pool).slice(0, max).map((p) => p.key);
}

// ── 역할별 사실 묶음 ─────────────────────────────────────────────────
function shownOwn(c: EngineCtx, S: Session, role: RoleDef) {
  const out: Record<string, unknown> = {};
  for (const f of role.fields) if (S.texts[f]) out[FIELD_LABEL[f]] = c.shown[f as keyof DeckText];
  return Object.keys(out).length ? out : undefined;
}
const memoOf = (S: Session, ...keys: RoleKey[]) => Object.fromEntries(keys.filter((k) => S.memos[k]?.length).map((k) => [ROLE_NAME[k], S.memos[k]]));

export function roleFacts(role: RoleDef, c: EngineCtx, S: Session): Record<string, unknown> {
  const d = c.data;
  const inp = c.st.input;
  const f = c.facts;
  const pool = peerPool(d, inp.peerScope);
  const sch = f.일정;
  const base = { 회사: d.company.corp_name, 등급: d.company.rating, 등급군: d.company.rating_group, 기준일: d.asof };
  switch (role.key) {
    case 'company': {
      const soon = d.maturities.filter((m) => m.dt > d.asof && (Date.parse(m.dt) - Date.parse(d.asof)) / 86_400_000 <= 150);
      return {
        ...base,
        회사정보: { 시장: d.company.market ?? '비상장', 공모채발행횟수: d.company.bond_count, 직전회차: d.company.last_series, 공모채잔액: eokW(d.company.outstanding_bond_krw) },
        최근회차: f.회사직전회차,
        트랜치별결과: f.회사트랜치별결과,
        만기별수요_최근4회: f.만기별수요_최근4회,
        최근3회평균참여: f.최근3회평균참여,
        같은등급경쟁률중간값: salesFacts(d, inp).같은등급요약.경쟁률중간값,
        만기도래: f.만기도래.slice(0, 12),
        만기도래합계: f.만기도래합계,
        만기도래연도별: f.회사만기도래연도별,
        기준일_150일내만기: soon.map((m) => ({ 만기일: mdw(m.dt), 회차: m.series, 금액: eokW(m.amount_krw) })),
        투자자구분참여: { 회차: f.투자자구분참여.회사회차, 합계: f.투자자구분참여.회사합계, 구분: f.투자자구분참여.회사 },
        지금문안: shownOwn(c, S, role),
      };
    }
    case 'market': {
      const ownKeys = new Set(d.own.slice(0, 2).map((p) => p.key));
      const cand = [...pool.slice(0, 24), ...d.peers.filter((p) => ownKeys.has(p.key) && !pool.some((x) => x.key === p.key))];
      return {
        ...base,
        지금선택: { 사례범위: inp.peerScope === 'notch' ? `같은 노치(${d.company.rating})` : `등급군(${d.company.rating_group})`, 결과표사례수: inp.peerKeys.length, 비교사례key: inp.compareKeys },
        사례수: { 같은노치: d.company.rating ? peerPool(d, 'notch').length : 0, 등급군: peerPool(d, 'group').length },
        같은등급요약: salesFacts(d, inp).같은등급요약,
        등급별평균경쟁률: f.등급별평균경쟁률,
        수요예측결과표: f.같은등급사례,
        비교사례후보: cand.map((p) => ({
          key: p.key, 회사: p.corp_name, 등급: p.rating, 수요예측일: pd(p) ? mdw(pd(p)) : null, 만기구조: p.tenor_combo,
          경쟁률: ratioX(p.ratio), 미매각: fullUnder(p), 일부미달: !!p.under && !fullUnder(p), 증액: p.increased, 회사자신: p.corp_code === d.company.corp_code,
        })),
        지금비교사례: f.비교사례,
        금리: f.금리,
        금통위: f.금통위 && { 날짜: f.금통위.날짜, 결정: f.금통위.결정, 표결: f.금통위.표결 },
        FOMC: f.FOMC && { 날짜: f.FOMC.날짜, 결정: f.FOMC.결정, 표결: f.FOMC.표결 },
        증권사의견: f.증권사의견.slice(0, 6).map((v) => ({ ...v, 요약: short(v.요약) })),
        수요예측예정합계: f.수요예측예정합계,
        수요예측예정: f.수요예측예정.slice(0, 12),
        제안수요예측일: sch?.권장수요예측일 ?? null,
        시장만기도래: f.등급별만기도래,
        만기도래상하반기: f.만기도래상하반기,
        납입월만기집중: marketCrowd(d, inp.pay),
        지금문안: shownOwn(c, S, role),
      };
    }
    case 'deal': {
      const last = d.own[0];
      const mp = maxPlan(d, totalEok(inp));
      const pp = payPlan(d);
      const top = comboCounts(pool)[0];
      return {
        ...base,
        지금조건: {
          ...f.제안조건, 납입일: inp.pay ? mdw(inp.pay) : null, 납입일값: inp.pay, 수요예측일값: inp.demand,
          인수수수료bp: inp.feeUw, 대표주관수수료bp: inp.feeLead,
        },
        일정: sch,
        수요예측가능일값: scheduleOf(d, inp)?.demandOptions ?? [],
        납입일_규칙값: { 날짜: pp.pay, 표기: mdw(pp.pay), 이유: pp.reason || '기준일 + 25영업일(가장 이른 날)' },
        증액한도_규칙값: mp && { 최대억원: mp.max, 배율: mp.mult.toFixed(2), 기준회차수: mp.n, 근거회차: mp.from ? `제${mp.from.series ?? ''}회 ${eokW(mp.from.initial_krw)} → ${eokW(mp.from.amount_krw)}` : '이력 없음(2배)' },
        직전회차구조: last ? { 회차: `제${last.series ?? ''}회`, 트랜치: last.tranches.map((t) => ({ 만기: t.tenor, 신고억원: t.initial_krw ? Math.round(t.initial_krw / 1e8) : null })) } : null,
        같은등급최다구조: top ? { 구조: top.combo, 건수: top.issues, 비중: `${Math.round(top.share)}%` } : null,
        같은등급만기비중: f.같은등급만기비중,
        만기구조통계: f.만기구조통계.slice(0, 6),
        만기별수요_최근4회: f.만기별수요_최근4회,
        회사트랜치별결과: f.회사트랜치별결과.slice(0, 8),
        제안만기연도기존만기도래: f.제안만기연도기존만기도래,
        회사만기분포: f.회사만기분포,
        금통위전후변동성: f.금통위전후변동성,
        다가오는금통위: d.events.filter((e) => e.kind === '금통위' && e.event_dt >= d.asof).slice(0, 3).map((e) => mdw(e.event_dt)),
        같은등급예정수요예측: pipelineOf(d).filter((p) => p.rating && d.company.rating_group && p.rating.startsWith(d.company.rating_group)).map((p) => ({ 회사: p.corp_name, 수요예측일: p.demand_dt ? mdw(p.demand_dt) : null })),
        납입월만기집중: marketCrowd(d, inp.pay),
        수수료자료: { 직전회차인수bp: d.fee.last_bp, 같은등급중간값bp: d.fee.group_median_bp },
        메모: memoOf(S, 'company', 'market'),
        지금문안: shownOwn(c, S, role),
      };
    }
    case 'sales':
      return { ...salesFacts(d, inp), 메모: memoOf(S, 'company', 'market', 'deal'), 지금문안: shownOwn(c, S, role) };
    case 'deck':
      return {
        회사: d.company.corp_name, 공모채발행횟수: d.company.bond_count,
        템플릿: TEMPLATES.map((t) => ({ key: t.key, 이름: t.label, 설명: t.hint })), 지금템플릿: templateOf(inp.items) ?? '직접 고침',
        장표: ALL_ITEMS.map((i) => ({ id: i.id, 제목: i.title, 켬: !!inp.items[i.id], 자료있음: c.avail(i.id), 고정장표: i.kind === 'static' })),
        같은등급미매각: pool.filter(fullUnder).length, 같은등급일부미달: pool.filter((p) => p.under && !fullUnder(p)).length, 비교사례수: inp.compareKeys.length,
        메모: memoOf(S, 'company', 'market'),
      };
    default:
      return sessionView(c, S, true);
  }
}

// ── 작업 세션 보기 ───────────────────────────────────────────────────
export function sessionView(c: EngineCtx | null, S: Session, full: boolean) {
  const stale = staleFields(S).map((f) => ({ 문안: FIELD_LABEL[f], 역할: ROLE_NAME[FIELD_OWNER[f]] }));
  if (!c) return { 열린회사: null };
  const sch = c.facts.일정;
  const head = {
    회사: c.data.company.corp_name, 등급: c.data.company.rating, 기준일: c.data.asof,
    조건: { ...c.facts.제안조건, 납입일: sch?.납입일 ?? null, 수요예측일: sch?.권장수요예측일 ?? null, 인수수수료bp: c.st.input.feeUw },
    장표수: c.slides.length,
  };
  if (!full)
    return {
      ...head,
      최근결정: S.log.slice(-8).map((x) => `${ROLE_NAME[x.role]}: ${x.what}`),
      AI문안: (Object.keys(S.texts) as TextField[]).map((f) => FIELD_LABEL[f]),
      다시써야할문안: stale, 확인필요: S.flags.slice(-5).map((x) => `${ROLE_NAME[x.role]}: ${x.text}`), 검토의견: S.review,
    };
  const fields: TextField[] = ['lead', 'structure', 'sizing', 'schedule', 'termNotes', 'sales', 'peers', 'compare', 'pipeline', 'maturity', 'corp'];
  return {
    ...head,
    켠장표: c.slides.map((s) => s.title),
    결정기록: S.log.slice(-25).map((x) => ({ 역할: ROLE_NAME[x.role], 결정: x.what, 근거: x.reason, 항목: x.rules })),
    메모: Object.fromEntries(Object.entries(S.memos).map(([k, v]) => [ROLE_NAME[k], v])),
    문안: fields.filter((f) => c.st.input.items[FIELD_SLIDE[f] as keyof DeckInput['items']] || f === 'lead' || f === 'termNotes' || f === 'structure').map((f) => ({ 칸: FIELD_LABEL[f], 출처: S.texts[f] ? `AI(${ROLE_NAME[S.texts[f]!.role]})` : '규칙', 내용: c.shown[f as keyof DeckText] })),
    다시써야할문안: stale, 확인필요: S.flags.slice(-8).map((x) => `${ROLE_NAME[x.role]}: ${x.text}`),
  };
}

// ── 도구 정의 ───────────────────────────────────────────────────────
const CHANGE = obj({
  type: { type: 'string' },
  tranches: { type: 'array', items: obj({ tenor: { type: 'string' }, eok: { type: ['number', 'null'] } }, ['tenor']) },
  eok: { type: 'number' }, date: { type: 'string' },
  band: obj({ type: { type: 'string', enum: ['spread', 'fixed', 'later'] }, low: { type: ['number', 'null'] }, high: { type: ['number', 'null'] } }, ['type']),
  text: { type: 'string' }, fee_uw: { type: 'number' }, fee_lead: { type: 'number' },
  items: { type: 'array', items: obj({ id: { type: 'string' }, on: { type: 'boolean' } }, ['id', 'on']) },
  keys: { type: 'array', items: { type: 'string' } }, months: { type: 'number' }, max: { type: 'number' },
  reason: { type: 'string', description: '이렇게 고른 이유(사실 근거)' }, rules: { type: 'array', items: { type: 'string' }, description: '따른 노하우 항목 번호. 예: ["DL-01"]' },
}, ['type', 'reason']);

const DECIDE_HELP: Record<string, string> = {
  tranches: 'tranches=[{tenor:"3년", eok:1000}] (억원)', max_amount: 'eok=증액 시 최대 발행금액(억원)', band: 'band={type:"spread"|"fixed"|"later", low, high} (spread 는 bp)',
  coupon: 'text="3개월 이표채"|"월단위 이표채"|"6개월 이표채"|"만기일시"', pay_date: 'date="YYYY-MM-DD"', demand_date: 'date=수요예측가능일 중 하나(YYYY-MM-DD)', fee: 'fee_uw=인수수수료bp, fee_lead=대표주관수수료bp',
  peer_scope: 'text="notch"(같은 노치)|"group"(등급군)', peer_cases: 'months=3|6|12, max=4~20 (수요예측 결과 표 사례)', compare: 'keys=비교사례후보의 key 최대 3개',
  slides: 'items=[{id:"compare", on:true}]', template: 'text="basic"|"lite"',
};

function roleTools(r: RoleDef): ToolDef[] {
  const t: ToolDef[] = [{ name: 'facts', description: '이 역할이 볼 사실 묶음(숫자·사례·메모·지금 조건). 결정·문장의 근거는 여기 있는 값만.', input_schema: obj({}) }];
  if (r.decide.length)
    t.push({
      name: 'decide',
      description: `고른 것을 반영하고 결정 기록에 남긴다. 지금 값과 같아도 남긴다(유지로 기록). 바꿀 수 있는 것: ${r.decide.map((k) => `${k}: ${DECIDE_HELP[k]}`).join(' / ')}`,
      input_schema: obj({ changes: { type: 'array', items: CHANGE, maxItems: 8 } }, ['changes']),
    });
  if (r.fields.length)
    t.push({
      name: 'write',
      description: `장표 문안을 넣는다. field: ${r.fields.map((f) => `${f}(${FIELD_LABEL[f]})`).join(', ')}. lines=문장 목록(lead 는 1줄). termNotes 는 notes={${TERM_NOTE_KEYS.join(', ')}} 칸마다 짧은 구절. 사실 묶음 밖 숫자·전망 단정이 든 줄은 빠진다.`,
      input_schema: obj({ field: { type: 'string', enum: r.fields }, lines: { type: 'array', items: { type: 'string' } }, notes: { type: 'object' } }, ['field']),
    });
  if (r.memo) t.push({ name: 'memo', description: '다른 역할이 읽을 메모를 남긴다(이전 메모를 바꿈). 한 줄에 하나, 끝에 항목 번호.', input_schema: obj({ points: { type: 'array', items: { type: 'string' }, maxItems: 8 } }, ['points']) });
  if (r.key === 'review') {
    t.length = 0;
    t.push({ name: 'session', description: '지금 조건·결정 기록·메모·장표 문안 전체', input_schema: obj({}) });
    t.push({ name: 'checks', description: '도구 검수: 사람이 확인할 곳 목록', input_schema: obj({}) });
  }
  return t;
}

const MASTER_TOOLS: ToolDef[] = [
  { name: 'find_company', description: '회사 이름으로 corp_code 후보를 찾는다.', input_schema: obj({ query: { type: 'string' } }, ['query']) },
  { name: 'open_company', description: '회사 데이터를 받고 초안을 연다. mode=new 면 새 초안(작업 세션도 새로), resume 이면 지금 초안을 이어서.', input_schema: obj({ corp_code: { type: 'string' }, mode: { type: 'string', enum: ['new', 'resume'] } }, ['corp_code']) },
  {
    name: 'call_roles',
    description: `역할(Sub-agent)에게 일을 맡긴다. 순서가 같은 역할은 동시에, 나머지는 순서대로 돈다(company·market → deal → sales → deck → review). 결과: 역할별 보고, 다시 써야 할 문안, 확인 필요.`,
    input_schema: obj({ roles: { type: 'array', items: { type: 'string', enum: ROLES.map((r) => r.key) } }, task: { type: 'string', description: '사용자 요청 원문과 바꿀 조건' } }, ['roles', 'task']),
  },
  { name: 'session', description: '작업 세션 요약: 조건, 최근 결정, 다시 써야 할 문안, 확인 필요, 검토 의견', input_schema: obj({}) },
  { name: 'render', description: '지금 상태로 PPTX·PDF 를 만든다. 사용자는 화면에서 바로 내려받는다.', input_schema: obj({}) },
];

const LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  find_company: (i) => `회사 찾기 · ${i.query}`,
  open_company: (i) => `데이터 받기·초안 열기${i.mode === 'resume' ? ' (이어서)' : ''}`,
  call_roles: (i) => `역할 호출 · ${((i.roles as string[]) ?? []).map((k) => ROLE_NAME[k] ?? k).join(', ')}`,
  session: () => '작업 세션 보기',
  render: () => 'PPTX·PDF 만들기',
  facts: () => '사실 묶음 보기',
  decide: (i) => `결정 반영 · ${(((i.changes as { type: string }[]) ?? []).map((c) => c.type)).join(', ')}`,
  write: (i) => `문안 쓰기 · ${FIELD_LABEL[i.field as TextField] ?? i.field}`,
  memo: () => '메모 남기기',
  checks: () => '확인할 곳 보기',
};
export const toolLabel = (name: string, i: Record<string, unknown>) => (LABEL[name] ?? (() => name))(i ?? {});

// ── 실행 ───────────────────────────────────────────────────────────
export async function runDcm(inp: DcmInput, emit: (e: DcmEvent) => void, budgetMs = 170_000, hardMs = 285_000) {
  const t0 = Date.now();
  const left = () => t0 + hardMs - Date.now();
  const A = inp.assets;
  const S: Session = { ...emptySession(), ...inp.session, log: [...(inp.session.log ?? [])], memos: { ...(inp.session.memos ?? {}) }, texts: { ...(inp.session.texts ?? {}) }, flags: [...(inp.session.flags ?? [])] };
  let ctx: EngineCtx | null = null;
  const messages: Msg[] = tidyHistory(inp.messages);
  let model = MODEL;
  let calls = 0;

  const emitSession = (slide: number | null = null) => emit({ t: 'session', session: S, slide });
  async function ensureCtx(): Promise<EngineCtx> {
    if (ctx) return ctx;
    if (!S.state) throw new ToolError('열린 초안이 없어요. 먼저 open_company 로 회사를 여세요.');
    const d = await dataOf(S.state.corp);
    ctx = ctxOf(d, [], normalizeState(d, S.state));
    S.state = ctx.st;
    return ctx;
  }
  const slideOf = (id: string | null) => (id && ctx ? ctx.slides.findIndex((s) => baseId(s.id) === id) : -1);
  function setSt(st: EngineState, slide: string | number | null = null) {
    ctx = ctxOf(ctx!.data, [], st);
    S.state = st;
    const at = typeof slide === 'number' ? slide : slideOf(slide);
    emitSession(at >= 0 ? at : null);
  }
  const markStale = (fields: TextField[]) => {
    for (const f of fields) {
      const m = S.texts[f];
      if (m && !m.stale) S.texts[f] = { ...m, stale: true };
    }
  };
  const flag = (role: RoleKey, text: string) => S.flags.push({ at: nowIso(), role, text });

  // ── 역할 도구 ──
  async function roleTool(r: RoleDef, name: string, i: Record<string, unknown>, tries: Map<string, number>): Promise<{ content: string; note: string }> {
    const c = await ensureCtx();
    switch (name) {
      case 'facts':
        return { content: J(roleFacts(r, c, S)), note: '' };
      case 'session':
        return { content: J(sessionView(c, S, true)), note: '' };
      case 'checks': {
        const v = checkView(c);
        return { content: J(v), note: `${v.확인할곳}곳` };
      }
      case 'decide':
        return decide(r, i);
      case 'write':
        return write(r, i, tries);
      case 'memo': {
        const pts = (Array.isArray(i.points) ? i.points : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 8);
        if (!pts.length) throw new ToolError('points 에 메모를 한 줄 이상 주세요.');
        const allowed = allowedNumbers(roleFacts(r, c, S), r.knowhow.map((k) => textOf(A, k)), c.st.input);
        const chk = pts.map((l) => ({ l, v: lineOk(l, allowed, false) }));
        const ok = chk.filter((x) => x.v.ok || x.v.why === '너무 김').map((x) => x.l);
        S.memos[r.key] = ok;
        emitSession();
        return { content: J({ 저장: ok.length, 뺀줄: chk.filter((x) => !(x.v.ok || x.v.why === '너무 김')).map((x) => ({ 줄: x.l, 이유: x.v.why })) }), note: `${ok.length}줄` };
      }
      default:
        throw new ToolError(`모르는 도구: ${name}`);
    }
  }

  function decide(r: RoleDef, i: Record<string, unknown>) {
    const list = Array.isArray(i.changes) ? (i.changes as Record<string, unknown>[]) : [];
    if (!list.length) throw new ToolError('changes 에 바꿀 것을 하나 이상 주세요.');
    const done: string[] = [];
    const rejected: string[] = [];
    for (const ch of list.slice(0, 8)) {
      const type = String(ch.type ?? '');
      const reason = String(ch.reason ?? '').slice(0, 300);
      const rules = (Array.isArray(ch.rules) ? ch.rules : []).filter((x): x is string => typeof x === 'string').slice(0, 5);
      if (!r.decide.includes(type)) {
        rejected.push(`${type}: ${r.name} 역할은 바꿀 수 없어요(가능: ${r.decide.join(', ')})`);
        continue;
      }
      const c = ctx!;
      const inp = c.st.input;
      const log = (what: string) => S.log.push({ at: nowIso(), role: r.key, what, reason, rules });
      if (type === 'peer_cases') {
        const months = [3, 6, 12].includes(Number(ch.months)) ? Number(ch.months) : 6;
        const max = Math.max(4, Math.min(20, Math.round(Number(ch.max) || 16)));
        const keys = pickPeerKeys(c.data, inp.peerScope, months, max);
        const same = JSON.stringify(keys) === JSON.stringify(inp.peerKeys);
        setSt({ ...c.st, input: { ...inp, peerKeys: keys } }, 'peers');
        const what = `수요예측 결과 표 사례 ${same ? '유지' : '변경'}: 최근 ${months}개월 최대 ${max}건 → ${keys.length}건`;
        log(what);
        done.push(what);
        if (!same) markStale(CASE_FIELDS);
        continue;
      }
      if (type === 'compare') {
        const keys = (Array.isArray(ch.keys) ? ch.keys : []).filter((x): x is string => typeof x === 'string').slice(0, 3);
        const found = keys.map((k) => c.data.peers.find((p) => p.key === k)).filter(Boolean) as PeerIssue[];
        if (!found.length || found.length !== keys.length) {
          rejected.push(`compare: 비교사례후보에 없는 key 가 있어요(${keys.filter((k) => !c.data.peers.some((p) => p.key === k)).join(', ') || '없음'})`);
          continue;
        }
        const same = JSON.stringify(keys) === JSON.stringify(inp.compareKeys);
        setSt({ ...c.st, input: { ...inp, compareKeys: keys } }, 'compare');
        const what = `비교 사례 ${same ? '유지' : '변경'}: ${found.map((p) => `${p.corp_name}(${pd(p) ? mdw(pd(p)) : '–'})`).join(', ')}`;
        log(what);
        done.push(what);
        if (!same) markStale(['compare']);
        continue;
      }
      // 엔진 행동(값 검사·재계산은 엔진이)
      let action;
      try {
        action = normalizeActions([{ ...ch, type }]);
      } catch (e) {
        rejected.push(`${type}: ${(e as Error).message}`);
        continue;
      }
      const before = JSON.stringify(inp);
      const res = applyEngine(c, action);
      if (res.out.알림.length) rejected.push(...res.out.알림.map((x) => `${type}: ${x}`));
      if (!res.out.바뀐것.length && !res.out.알림.length) {
        log(`${type} 유지`);
        done.push(`${type} 유지`);
        continue;
      }
      if (!res.out.바뀐것.length) continue;
      let st = res.state;
      if (type === 'peer_scope') st = { ...st, input: { ...st.input, peerKeys: pickPeerKeys(c.data, st.input.peerScope, 6, 16) } };
      const changed = JSON.stringify(st.input) !== before;
      setSt(st, res.slide);
      const what = changed ? res.out.바뀐것.join(' / ') : `유지: ${valueText(type, st.input)}`;
      log(what);
      done.push(what);
      if (changed) markStale(type === 'peer_scope' ? CASE_FIELDS : ['slides', 'template'].includes(type) ? [] : COND_FIELDS);
    }
    return { content: J({ 반영: done, 거절: rejected, 안내: done.length ? '조건이 바뀌었으면 facts 로 다시 확인' : undefined }), note: [...done, ...rejected].join(' / ').slice(0, 160) };
  }

  function valueText(type: string, inp: DeckInput) {
    switch (type) {
      case 'tranches': return `트랜치 ${trText(inp.tranches)}`;
      case 'max_amount': return `증액 한도 ${inp.maxEok?.toLocaleString('ko-KR') ?? '–'}억원`;
      case 'band': return `금리 밴드 ${bandTxt(inp.band)}`;
      case 'coupon': return `이자지급 ${inp.coupon}`;
      case 'pay_date': return `납입일 ${inp.pay ? mdw(inp.pay) : '–'}`;
      case 'demand_date': return `수요예측일 ${inp.demand ? mdw(inp.demand) : '기본'}`;
      case 'fee': return `인수수수료 ${inp.feeUw ?? '–'}bp`;
      case 'peer_scope': return `사례 범위 ${inp.peerScope}`;
      default: return type;
    }
  }

  function write(r: RoleDef, i: Record<string, unknown>, tries: Map<string, number>) {
    const c = ctx!;
    const field = String(i.field ?? '') as TextField;
    if (!r.fields.includes(field)) throw new ToolError(`${r.name} 역할이 쓸 수 있는 칸: ${r.fields.join(', ')}`);
    const n = (tries.get(field) ?? 0) + 1;
    tries.set(field, n);
    const allowed = allowedNumbers(roleFacts(r, c, S), r.knowhow.map((k) => textOf(A, k)), c.st.input, Object.values(S.memos));
    const label = FIELD_LABEL[field];
    let st: EngineState;
    let okCount = 0;
    const bad: { 줄: string; 이유: string }[] = [];
    if (field === 'termNotes') {
      const notes = (i.notes && typeof i.notes === 'object' ? i.notes : {}) as Record<string, unknown>;
      const ok: Record<string, string> = {};
      for (const k of TERM_NOTE_KEYS) {
        const v = typeof notes[k] === 'string' ? (notes[k] as string).trim() : '';
        if (!v) continue;
        const chk = lineOk(v, allowed, false);
        if (chk.ok) ok[k] = v;
        else bad.push({ 줄: `${k}: ${v}`, 이유: chk.why });
      }
      okCount = Object.keys(ok).length;
      if (!okCount && !bad.length) throw new ToolError('notes 에 칸별 구절을 주세요. 예: {"band": "현업 관행 개별민평 ±30bp"}');
      st = { ...c.st, edits: { ...c.st.edits, termNotes: { ...c.rule.termNotes, ...(c.st.edits.termNotes ?? {}), ...ok } } };
    } else {
      const raw = (Array.isArray(i.lines) ? i.lines : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
      if (!raw.length) throw new ToolError('lines 에 문장을 한 줄 이상 주세요.');
      const lines = field === 'lead' ? [raw.join(' ')] : raw.slice(0, 6);
      const chk = lines.map((l) => ({ l, v: lineOk(l, allowed, false) }));
      const ok = chk.filter((x) => x.v.ok).map((x) => x.l);
      for (const x of chk) if (!x.v.ok) bad.push({ 줄: x.l, 이유: x.v.why });
      okCount = ok.length;
      st = { ...c.st, edits: { ...c.st.edits, [field]: field === 'lead' ? ok[0] : ok }, ...(field === 'sales' ? { salesAi: null } : {}) };
    }
    if (!okCount) {
      if (n >= 2) {
        flag(r.key, `${label} 문안이 검사를 두 번 통과하지 못해 규칙 문안 유지 (${bad.map((b) => b.이유).join(' / ')})`);
        emitSession();
        return { content: J({ 결과: '넣지 못함, 규칙 문안 유지(확인할 곳으로 표시)', 뺀줄: bad }), note: `${label} 탈락` };
      }
      return { content: J({ 결과: '넣지 못함', 뺀줄: bad, 안내: '이유를 보고 한 번만 고쳐 다시 write. 숫자는 사실 묶음 표기 그대로.' }), note: `${label} 다시` };
    }
    S.texts[field] = { role: r.key, at: nowIso(), stale: false, dropped: bad.length };
    if (bad.length && n >= 2) flag(r.key, `${label} 문안 ${bad.length}줄은 검사를 통과하지 못해 뺌`);
    setSt(st, FIELD_SLIDE[field]);
    return {
      content: J({ 넣은줄: okCount, 뺀줄: bad, 안내: bad.length && n < 2 ? '뺀 줄은 이유를 보고 한 번만 고쳐 다시 write(넣은 줄 포함 전체를 다시)' : undefined }),
      note: `${label} ${okCount}줄${bad.length ? `, ${bad.length}줄 뺌` : ''}`,
    };
  }

  // ── 역할 실행 ──
  async function runRole(r: RoleDef, task: string, call: string): Promise<{ 역할: string; 보고: string }> {
    const c = await ensureCtx();
    emit({ t: 'role', call, role: r.key, phase: 'start' });
    const system = `${textOf(A, `dcm.${r.key}`)}

# 노하우
${r.knowhow.map((k) => textOf(A, k)).join('\n\n')}

# 지금
- 회사: ${c.data.company.corp_name} (${c.data.company.rating ?? '등급 없음'})
- 데이터 기준일: ${c.data.asof}
- 오늘: ${kstToday()}`;
    const tries = new Map<string, number>();
    let k = 0;
    try {
      const out = await runLoop({
        model: MODEL, system, first: `요청: ${task}`, tools: roleTools(r), maxRounds: 10, maxTokens: 3000, left,
        onTool: async (name, input) => {
          const id = `${call}:${r.key}:${k++}`;
          emit({ t: 'tool', id, name, label: toolLabel(name, input), agent: r.key, call });
          try {
            const res = await roleTool(r, name, input, tries);
            emit({ t: 'tool_done', id, ok: true, note: res.note });
            return res;
          } catch (e) {
            const msg = e instanceof ToolError || e instanceof EngineError ? e.message : `도구 오류: ${(e as Error).message}`;
            emit({ t: 'tool_done', id, ok: false, note: msg });
            throw new ToolError(msg);
          }
        },
      });
      emit({ t: 'role', call, role: r.key, phase: 'end', text: out.text.slice(0, 2000) });
      if (r.key === 'review') S.review = out.text.slice(0, 2000);
      return { 역할: r.name, 보고: clip(out.text, 2000) };
    } catch (e) {
      const msg = `역할 실행 실패: ${claudeWhy(e)}`;
      flag(r.key, msg);
      emit({ t: 'role', call, role: r.key, phase: 'end', text: msg, fail: true });
      return { 역할: r.name, 보고: msg };
    }
  }

  // ── Master 도구 ──
  async function masterTool(name: string, i: Record<string, unknown>, id: string): Promise<{ content: string; note: string }> {
    switch (name) {
      case 'find_company': {
        const q = String(i.query ?? '').trim();
        if (!q) throw new ToolError('회사 이름을 주세요.');
        const hits = await searchCompanies(q, 10);
        return { content: J(hits.map((h) => ({ corp_code: h.corp_code, 회사: h.corp_name, 시장: h.market && h.market !== '기타' ? h.market : '비상장', 발행건수: h.deal_count, 최근발행: h.last_deal_dt }))), note: `${hits.length}곳` };
      }
      case 'open_company': {
        const corp = String(i.corp_code ?? '').trim();
        if (!/^\d{8}$/.test(corp)) throw new ToolError('corp_code(숫자 8자리)를 주세요. 모르면 find_company.');
        const d = await dataOf(corp);
        const resume = i.mode !== 'new' && S.state?.corp === corp;
        if (!resume) Object.assign(S, emptySession(), { used: S.used });
        const st = resume ? normalizeState(d, S.state) : freshState(d);
        ctx = ctxOf(d, [], st);
        S.state = st;
        emit({ t: 'open', resume });
        emitSession(0);
        return {
          content: J({ 회사: d.company.corp_name, corp_code: corp, 등급: d.company.rating, 기준일: d.asof, 공모채발행횟수: d.company.bond_count, 직전회차: d.company.last_series, 이어서: resume, 장표수: ctx.slides.length }),
          note: `${d.company.corp_name} · ${ctx.slides.length}장`,
        };
      }
      case 'call_roles': {
        await ensureCtx();
        const keys = [...new Set((Array.isArray(i.roles) ? i.roles : []).map(String))].map(roleOf).filter(Boolean) as RoleDef[];
        if (!keys.length) throw new ToolError(`roles 에 역할을 주세요: ${ROLES.map((r) => r.key).join(', ')}`);
        const task = String(i.task ?? '').slice(0, 1500) || '요청에 맞게';
        const flags0 = S.flags.length;
        const orders = [...new Set(keys.map((r) => r.order))].sort((a, b) => a - b);
        const reports: { 역할: string; 보고: string }[] = [];
        for (const o of orders) {
          if (left() < 20_000) {
            reports.push({ 역할: '-', 보고: '시간이 부족해 남은 역할은 다음 요청에서 이어서 하세요.' });
            break;
          }
          const group = keys.filter((r) => r.order === o);
          reports.push(...(await Promise.all(group.map((r) => runRole(r, task, id)))));
        }
        emitSession();
        const stale = staleFields(S).map((f) => ({ 문안: FIELD_LABEL[f], 역할: FIELD_OWNER[f] }));
        return { content: J({ 결과: reports, 다시써야할문안: stale, 확인필요: S.flags.slice(flags0).map((x) => `${ROLE_NAME[x.role]}: ${x.text}`) }), note: `${reports.length}개 역할` };
      }
      case 'session':
        return { content: J(sessionView(S.state ? await ensureCtx() : null, S, false)), note: '' };
      case 'render': {
        const c = await ensureCtx();
        const nm = fileBase(c.st.input);
        emit({ t: 'render', name: nm, slides: c.slides.length });
        return { content: J({ 파일: [`${nm}.pptx`, `${nm}.pdf`], 장표수: c.slides.length, 안내: '사용자 화면 오른쪽에서 내려받을 수 있어요.' }), note: `${c.slides.length}장` };
      }
      default:
        throw new ToolError(`모르는 도구: ${name}`);
    }
  }

  const brief = S.state ? sessionView(await ensureCtx().catch(() => null), S, false) : { 열린회사: null };
  const system = `${textOf(A, 'dcm.master')}

## 사용자 기억 (개인)
${inp.memory?.trim() || '(없음)'}

## 지금 작업 세션
${JSON.stringify(brief)}
오늘: ${kstToday()}`;

  for (let round = 0; round < 14; round++) {
    if (Date.now() - t0 > budgetMs) {
      emit({ t: 'done', messages, cont: true, model });
      return;
    }
    let res;
    try {
      res = await claude(MODEL, system, messages, MASTER_TOOLS, 2000, left());
    } catch (e) {
      // 바로 다시 보내지 않는다(한도면 또 걸린다). 이미 한 일은 작업 세션에 남아 있어 다음 요청에서 이어진다.
      emit({ t: 'error', message: claudeWhy(e) });
      emit({ t: 'done', messages, cont: false, model });
      return;
    }
    model = res.model ?? model;
    let content = res.content;
    if (res.stop_reason !== 'tool_use' && content.some((b) => b.type === 'tool_use')) {
      content = content.filter((b) => b.type !== 'tool_use');
      if (!content.length) content = [{ type: 'text', text: '(응답이 길어 잘렸어요. 요청을 나눠 주세요.)' }];
    }
    messages.push({ role: 'assistant', content });
    const said = textOfBlocks(content);
    if (said) emit({ t: 'text', text: said });
    const uses = usesOf(content);
    if (!uses.length) {
      emit({ t: 'done', messages, cont: false, model });
      return;
    }
    const results: Block[] = [];
    for (const u of uses) {
      const id = `m${calls++}:${u.id.slice(-6)}`;
      emit({ t: 'tool', id, name: u.name, label: toolLabel(u.name, u.input ?? {}), agent: 'master' });
      try {
        const r = await masterTool(u.name, u.input ?? {}, id);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content || '(빈 결과)' });
        emit({ t: 'tool_done', id, ok: true, note: r.note });
      } catch (e) {
        const msg = e instanceof ToolError || e instanceof EngineError ? e.message : `도구 오류: ${(e as Error).message}`;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: msg, is_error: true });
        emit({ t: 'tool_done', id, ok: false, note: msg });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  emit({ t: 'done', messages, cont: true, model });
}

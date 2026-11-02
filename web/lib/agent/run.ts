// Agent 탭 실행(서버): Claude Messages API 로 Master 를 돌리고, 도구 호출을 처리한다.
// - 엔진 도구(dcm_*)는 web/lib/deck/engine.ts 로 실행한다(Managed Agent 패키지의 dcm 명령과 같은 코드).
// - call_subagent 는 Sub-agent(Sales Writer·Reviewer)를 각자의 시스템 프롬프트·스킬로 돌려 결과 글을 돌려준다.
// - 스킬은 브라우저가 보낸 것(편집본 포함)을 read_skill 로 읽게 한다.
// - 제안서 상태(입력값·고친 문안·Sales 문안)는 브라우저가 들고 있다가 매 요청에 보낸다. 서버는 저장하지 않는다.
import 'server-only';
import { selectFresh } from '../db';
import { getDeckData } from '../deck/data';
import {
  EngineError, applyEngine, checkView, ctxOf, factsView, freshState, loadSummary, normalizeState, reportView, schemaView,
  setSales, slideList, stateView, type EngineCtx, type EngineState,
} from '../deck/engine';
import type { Knowledge } from '../deck/knowledge';
import { fileBase } from '../deck/layout';
import type { DeckData } from '../deck/types';
import { searchCompanies } from '../queries';
import { AGENTS, agentOf, skillMeta, type AgentKey, type SkillFiles } from './config';
import { toolLabel, toolsFor } from './tools';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
export type SkillIn = { name: string; files: SkillFiles; agents: AgentKey[] }; // agents: 이 스킬을 쓰는 Agent
export type RunInput = { messages: Msg[]; state: EngineState | null; skills: SkillIn[]; memory: string | null };
export type RunEvent =
  | { t: 'text'; text: string }
  | { t: 'tool'; id: string; name: string; label: string; agent: AgentKey }
  | { t: 'tool_done'; id: string; ok: boolean; note: string }
  | { t: 'sub'; agent: AgentKey; phase: 'start' | 'end'; text?: string }
  | { t: 'state'; state: EngineState; slide: number | null; name: string; slides: number }
  | { t: 'render'; name: string; slides: number }
  | { t: 'done'; messages: Msg[]; cont: boolean; model: string }
  | { t: 'error'; message: string };

const KEY = process.env.ANTHROPIC_API_KEY ?? '';
const BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
export const agentReady = () => !!KEY;

// ── 데이터 캐시 (같은 서버 인스턴스 안에서 1분) ──────────────────────────
const dataCache = new Map<string, { at: number; d: DeckData }>();
let knowCache: { at: number; k: Knowledge[] } | null = null;
async function dataOf(corp: string) {
  const hit = dataCache.get(corp);
  if (hit && Date.now() - hit.at < 60_000) return hit.d;
  const d = await getDeckData(corp);
  if (!d) throw new EngineError(`회사(${corp}) 데이터를 찾지 못했어요.`);
  dataCache.set(corp, { at: Date.now(), d });
  if (dataCache.size > 30) dataCache.delete(dataCache.keys().next().value as string);
  return d;
}
async function knowledgeOf() {
  if (knowCache && Date.now() - knowCache.at < 60_000) return knowCache.k;
  const k = await selectFresh<Knowledge>('v_deck_knowledge', { order: 'updated_at.desc', limit: 1000 }).catch(() => [] as Knowledge[]);
  knowCache = { at: Date.now(), k };
  return k;
}

// ── Claude 호출 ────────────────────────────────────────────────────────
type ClaudeRes = { content: Block[]; stop_reason: string; model: string };
// 마지막 메시지 끝에 캐시 지점을 둔다(한 턴 안에서 도구를 여러 번 부를 때 앞부분을 다시 읽지 않게)
function withCache(messages: Msg[]) {
  if (!messages.length) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const blocks: Block[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content.slice();
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } } as unknown as Block;
  out[out.length - 1] = { role: last.role, content: blocks };
  return out;
}

async function claude(model: string, system: string, messages: Msg[], tools: object[], maxTokens: number, timeoutMs = 120_000): Promise<ClaudeRes> {
  const r = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], tools, messages: withCache(messages) }),
    signal: AbortSignal.timeout(Math.max(5_000, Math.min(120_000, timeoutMs))),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude ${r.status}: ${String((j as { error?: { message?: string } })?.error?.message ?? '').slice(0, 300)}`);
  return j as ClaudeRes;
}

// 스킬 표: 이름·설명·파일 (progressive disclosure)
function skillTable(skills: SkillIn[]) {
  return skills
    .map((s) => {
      const m = skillMeta(s.files);
      return `- ${s.name}: ${m.description || '(설명 없음)'}\n  파일: ${Object.keys(s.files).join(', ')}`;
    })
    .join('\n');
}

const clip = (s: string, n = 24_000) => (s.length > n ? `${s.slice(0, n)}\n…(이하 ${s.length - n}자 생략)` : s);

// ── 실행 ───────────────────────────────────────────────────────────────
// 지난 턴의 도구 결과는 줄여서 보낸다(이번 턴 것만 온전히)
function trimOld(messages: Msg[]): Msg[] {
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user' && typeof m.content === 'string') lastUser = i;
  });
  return messages.map((m, i) =>
    i >= lastUser || typeof m.content === 'string'
      ? m
      : { role: m.role, content: m.content.map((b) => (b.type === 'tool_result' && b.content.length > 600 ? { ...b, content: `${b.content.slice(0, 600)}\n…(지난 결과 줄임)` } : b)) },
  );
}

// budgetMs: 이 시간이 지나면 새 라운드를 시작하지 않고 cont=true 로 끝낸다. hardMs: Claude 호출이 넘으면 안 되는 끝.
export async function runAgent(inp: RunInput, emit: (e: RunEvent) => void, budgetMs = 150_000, hardMs = 280_000) {
  const t0 = Date.now();
  const left = () => t0 + hardMs - Date.now();
  const master = agentOf('master');
  const skillsOf = (k: AgentKey) => new Map(inp.skills.filter((s) => s.agents.includes(k)).map((s) => [s.name, s]));
  const bySkill = skillsOf('master');
  const masterSkills = [...bySkill.values()];
  let state: EngineState | null = inp.state;
  let ctx: EngineCtx | null = null;
  const messages: Msg[] = trimOld(inp.messages);
  let model = master.model;

  const system = `${master.system}

# 스킬 (read_skill 로 읽는다)
${skillTable(masterSkills)}

# 사용자 기억 (개인)
${inp.memory?.trim() || '(없음)'}

# 지금 상태
${state ? `열린 초안: ${state.corp} (dcm_load 로 이어서 열 수 있다)` : '열린 초안 없음'}
오늘: ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}`;

  async function ensureCtx(): Promise<EngineCtx> {
    if (ctx) return ctx;
    if (!state) throw new EngineError('열린 초안이 없어요. 먼저 dcm_load 로 회사를 여세요.');
    const d = await dataOf(state.corp);
    ctx = ctxOf(d, await knowledgeOf(), normalizeState(d, state));
    return ctx;
  }
  const setState = (c: EngineCtx, slide: number | null) => {
    ctx = c;
    state = c.st;
    emit({ t: 'state', state: c.st, slide, name: fileBase(c.st.input), slides: c.slides.length });
  };

  function readSkill(allowed: Map<string, SkillIn>, i: Record<string, unknown>) {
    const s = allowed.get(String(i.skill ?? ''));
    if (!s) throw new EngineError(`스킬 '${i.skill}' 이 없어요. 있는 스킬: ${[...allowed.keys()].join(', ')}`);
    const path = String(i.path || 'SKILL.md');
    const f = s.files[path];
    if (f == null) throw new EngineError(`'${i.skill}' 에 ${path} 가 없어요. 파일: ${Object.keys(s.files).join(', ')}`);
    return f;
  }

  async function subagent(key: AgentKey, message: string): Promise<string> {
    const def = agentOf(key);
    const allowed = skillsOf(key);
    const sys = `${def.system}\n\n# 스킬 (read_skill 로 읽는다)\n${skillTable([...allowed.values()])}`;
    const msgs: Msg[] = [{ role: 'user', content: message }];
    for (let round = 0; round < 6; round++) {
      const res = await claude(def.model, sys, msgs, toolsFor(def.tools), 4000, left());
      msgs.push({ role: 'assistant', content: res.content });
      const uses = res.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
      if (!uses.length || res.stop_reason !== 'tool_use') return res.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim() || '(Sub-agent 가 빈 답을 돌려줬어요)';
      const results: Block[] = [];
      for (const u of uses) {
        const id = `${key}:${u.id}`;
        emit({ t: 'tool', id, name: u.name, label: toolLabel(u.name, u.input), agent: key });
        try {
          const content = readSkill(allowed, u.input);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: content || '(빈 파일)' });
          emit({ t: 'tool_done', id, ok: true, note: '' });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: (e as Error).message, is_error: true });
          emit({ t: 'tool_done', id, ok: false, note: (e as Error).message });
        }
      }
      msgs.push({ role: 'user', content: results });
    }
    return '(Sub-agent 가 제한 횟수 안에 답을 끝내지 못했어요)';
  }

  async function runTool(name: string, i: Record<string, unknown>): Promise<{ content: string; note: string }> {
    const J = (x: unknown) => clip(JSON.stringify(x, null, 1));
    switch (name) {
      case 'read_skill':
        return { content: readSkill(bySkill, i), note: '' };
      case 'dcm_search': {
        const q = String(i.query ?? '').trim();
        if (!q) throw new EngineError('회사 이름을 주세요.');
        const hits = await searchCompanies(q, 10);
        return { content: J(hits.map((h) => ({ corp_code: h.corp_code, 회사: h.corp_name, 시장: h.market && h.market !== '기타' ? h.market : '비상장', 발행건수: h.deal_count, 최근발행: h.last_deal_dt }))), note: `${hits.length}곳` };
      }
      case 'dcm_load': {
        const corp = String(i.corp_code ?? '').trim();
        if (!/^\d{8}$/.test(corp)) throw new EngineError('corp_code(숫자 8자리)를 주세요. 모르면 dcm_search.');
        const d = await dataOf(corp);
        const resume = i.mode !== 'new' && state?.corp === corp;
        const st = resume ? normalizeState(d, state) : freshState(d);
        const c = ctxOf(d, await knowledgeOf(), st);
        setState(c, 0);
        return { content: J(loadSummary(c, resume)), note: `${d.company.corp_name} · ${c.slides.length}장` };
      }
      case 'dcm_state':
        return { content: J(stateView(await ensureCtx())), note: '' };
      case 'dcm_slides':
        return { content: J(slideList(await ensureCtx())), note: '' };
      case 'dcm_apply': {
        const r = applyEngine(await ensureCtx(), { actions: i.actions });
        setState(r.ctx, r.slide);
        return { content: J(r.out), note: [...r.out.바뀐것, ...r.out.알림].join(' / ').slice(0, 160) };
      }
      case 'dcm_facts':
        return { content: J(factsView(await ensureCtx(), !!i.sales)), note: '' };
      case 'dcm_set_sales': {
        const r = setSales(await ensureCtx(), i.lines);
        setState(r.ctx, r.slide);
        return { content: J(r.out), note: `${r.out.넣은줄.length}줄 반영${r.out.뺀줄.length ? `, ${r.out.뺀줄.length}줄 제외` : ''}` };
      }
      case 'dcm_check': {
        const v = checkView(await ensureCtx());
        return { content: J(v), note: `${v.확인할곳}곳` };
      }
      case 'dcm_report':
        return { content: J(reportView(await ensureCtx())), note: '' };
      case 'dcm_render': {
        const c = await ensureCtx();
        const nm = fileBase(c.st.input);
        emit({ t: 'render', name: nm, slides: c.slides.length });
        return { content: J({ 파일: [`${nm}.pptx`, `${nm}.pdf`], 장표수: c.slides.length, 안내: '사용자 화면 오른쪽에서 내려받을 수 있어요.' }), note: `${c.slides.length}장` };
      }
      case 'dcm_schema':
        return { content: J(schemaView()), note: '' };
      case 'call_subagent': {
        const key = i.agent === 'reviewer' ? 'reviewer' : 'sales_writer';
        emit({ t: 'sub', agent: key, phase: 'start' });
        const text = await subagent(key, String(i.message ?? ''));
        emit({ t: 'sub', agent: key, phase: 'end', text: text.slice(0, 2000) });
        return { content: clip(text, 12_000), note: '' };
      }
      default:
        throw new EngineError(`모르는 도구: ${name}`);
    }
  }

  // 마지막 메시지가 도구 결과면 이어서, 사용자 글이면 새 턴
  for (let round = 0; round < 16; round++) {
    if (Date.now() - t0 > budgetMs) {
      emit({ t: 'done', messages, cont: true, model });
      return;
    }
    let res: ClaudeRes;
    try {
      res = await claude(master.model, system, messages, toolsFor(master.tools), 4000, left());
    } catch (e) {
      // 지금까지의 대화(도구 결과까지 짝이 맞는 상태)는 돌려줘서 '계속'으로 이어갈 수 있게 한다
      emit({ t: 'error', message: `Claude 응답을 받지 못했어요. (${String((e as Error).message).slice(0, 200)})` });
      emit({ t: 'done', messages, cont: messages[messages.length - 1]?.role === 'user' && typeof messages[messages.length - 1].content !== 'string', model });
      return;
    }
    model = res.model ?? model;
    // 도구 호출 중에 잘린 응답(max_tokens)은 짝 없는 tool_use 가 남지 않게 도구 부분을 뺀다
    let content = res.content;
    if (res.stop_reason !== 'tool_use' && content.some((b) => b.type === 'tool_use')) {
      content = content.filter((b) => b.type !== 'tool_use');
      if (!content.length) content = [{ type: 'text', text: '(응답이 길어 잘렸어요. 요청을 나눠 주세요.)' }];
    }
    messages.push({ role: 'assistant', content });
    for (const b of content) if (b.type === 'text' && b.text.trim()) emit({ t: 'text', text: b.text });
    const uses = content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!uses.length) {
      emit({ t: 'done', messages, cont: false, model });
      return;
    }
    const results: Block[] = [];
    for (const u of uses) {
      emit({ t: 'tool', id: u.id, name: u.name, label: toolLabel(u.name, u.input ?? {}), agent: 'master' });
      try {
        const r = await runTool(u.name, u.input ?? {});
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content || '(빈 결과)' });
        emit({ t: 'tool_done', id: u.id, ok: true, note: r.note });
      } catch (e) {
        const msg = e instanceof EngineError ? e.message : `도구 오류: ${(e as Error).message}`;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: msg, is_error: true });
        emit({ t: 'tool_done', id: u.id, ok: false, note: msg });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  emit({ t: 'done', messages, cont: true, model });
}

export const AGENT_LIST = AGENTS;

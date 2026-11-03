// Claude Messages API 호출과 도구 반복 실행(서버 전용). 제안서 Agent·Agent Builder 가 같이 쓴다.
import 'server-only';
import type { Block, Msg } from './defs';

const KEY = process.env.ANTHROPIC_API_KEY ?? '';
const BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
export const agentReady = () => !!KEY;

export type ToolDef = { name: string; description: string; input_schema: object };
export type ClaudeRes = { content: Block[]; stop_reason: string; model: string; usage?: { input_tokens: number; output_tokens: number } };

// 마지막 메시지 끝에 캐시 지점(한 턴 안에서 도구를 여러 번 부를 때 앞부분을 다시 읽지 않게)
function withCache(messages: Msg[]) {
  if (!messages.length) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const blocks: Block[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content.slice();
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } } as unknown as Block;
  out[out.length - 1] = { role: last.role, content: blocks };
  return out;
}

export class ClaudeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// 한도(429)·과부하(529)·서버 오류는 retry-after 만큼 쉬고 다시(남은 시간 안에서 최대 3번)
export async function claude(model: string, system: string, messages: Msg[], tools: ToolDef[], maxTokens: number, timeoutMs = 120_000): Promise<ClaudeRes> {
  const end = Date.now() + timeoutMs;
  let last: ClaudeError | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], tools, messages: withCache(messages) }),
      signal: AbortSignal.timeout(Math.max(5_000, Math.min(120_000, end - Date.now()))),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j as ClaudeRes;
    last = new ClaudeError(`Claude ${r.status}: ${String((j as { error?: { message?: string } })?.error?.message ?? '').slice(0, 300)}`, r.status);
    if (r.status !== 429 && r.status !== 529 && r.status < 500) break;
    const ra = Number(r.headers.get('retry-after'));
    const wait = Math.min(20_000, ra > 0 ? ra * 1000 : 2000 * 2 ** attempt);
    if (Date.now() + wait + 10_000 > end) break;
    await sleep(wait);
  }
  throw last ?? new ClaudeError('Claude 호출 실패', 0);
}

// 사용자에게 보일 이유
export function claudeWhy(e: unknown): string {
  const st = e instanceof ClaudeError ? e.status : 0;
  if (st === 429) return 'Claude 사용량 한도(분당)에 걸렸어요. 1분쯤 뒤 다시 보내 주세요.';
  if (st === 529 || st >= 500) return 'Claude 서버가 바빠요. 잠시 뒤 다시 보내 주세요.';
  return `Claude 응답을 받지 못했어요. (${String((e as Error).message).slice(0, 200)})`;
}

export const textOf = (content: Block[]) => content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
export const usesOf = (content: Block[]) => content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
// 대화 기록 정리: 지난 요청은 '사용자 말 → 마지막 답'만 남기고(바뀐 내용은 작업 세션이 들고 있다),
// 이번 요청은 도구 기록을 두되 짝이 안 맞는 호출·결과와 빈 글은 뺀다(API 가 거절하지 않게).
const isAsk = (m: Msg) => m.role === 'user' && typeof m.content === 'string' && m.content.trim() !== '';
function cleanBlock(b: Block): Block | null {
  if (b.type === 'text') return b.text?.trim() ? { type: 'text', text: b.text } : null;
  if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} };
  if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.tool_use_id, content: String(b.content ?? '') || '(빈 결과)', ...(b.is_error ? { is_error: true } : {}) };
  return null;
}
export function tidyHistory(messages: Msg[]): Msg[] {
  let cut = -1;
  messages.forEach((m, i) => {
    if (isAsk(m)) cut = i;
  });
  if (cut < 0) return [];
  const out: Msg[] = [];
  let ask: string | null = null;
  let reply = '';
  const flush = () => {
    if (ask == null) return;
    out.push({ role: 'user', content: ask }, { role: 'assistant', content: reply || '(이 요청은 끝까지 하지 못했어요)' });
    ask = null;
    reply = '';
  };
  for (const m of messages.slice(0, cut)) {
    if (isAsk(m)) {
      flush();
      ask = m.content as string;
    } else if (m.role === 'assistant') {
      const t = typeof m.content === 'string' ? m.content.trim() : textOf(m.content);
      if (t) reply = t;
    }
  }
  flush();
  const cur = messages.slice(cut);
  out.push({ role: 'user', content: cur[0].content as string });
  const ids = (m: Msg | undefined, type: 'tool_use' | 'tool_result') =>
    new Set(m && Array.isArray(m.content) ? m.content.flatMap((b) => (b.type === type ? [b.type === 'tool_use' ? b.id : (b as Extract<Block, { type: 'tool_result' }>).tool_use_id] : [])) : []);
  for (let i = 1; i < cur.length; i++) {
    const m = cur[i];
    let blocks = (typeof m.content === 'string' ? [{ type: 'text', text: m.content } as Block] : m.content).map(cleanBlock).filter((b): b is Block => !!b);
    if (m.role === 'assistant') {
      const answered = cur[i + 1]?.role === 'user' ? ids(cur[i + 1], 'tool_result') : new Set<string>();
      blocks = blocks.filter((b) => b.type !== 'tool_use' || answered.has(b.id));
    } else {
      const asked = ids(out[out.length - 1]?.role === 'assistant' ? out[out.length - 1] : undefined, 'tool_use');
      blocks = blocks.filter((b) => b.type !== 'tool_result' || asked.has(b.tool_use_id)).sort((a, b) => Number(a.type !== 'tool_result') - Number(b.type !== 'tool_result'));
    }
    if (!blocks.length) continue;
    const prev = out[out.length - 1];
    if (prev.role === m.role) out[out.length - 1] = { role: m.role, content: [...(typeof prev.content === 'string' ? [{ type: 'text', text: prev.content } as Block] : prev.content), ...blocks] };
    else out.push({ role: m.role, content: blocks });
  }
  return out;
}

export const clip = (s: string, n = 24_000) => (s.length > n ? `${s.slice(0, n)}\n…(이하 ${s.length - n}자 생략)` : s);
export const J = (x: unknown) => clip(JSON.stringify(x, null, 1));

export class ToolError extends Error {}

// 한 Agent(역할)를 도구 반복으로 끝까지 돌리고 마지막 글을 돌려준다
export async function runLoop(opts: {
  model: string; system: string; first: string; tools: ToolDef[]; maxRounds: number; maxTokens?: number;
  left: () => number;
  onTool: (name: string, input: Record<string, unknown>, id: string) => Promise<{ content: string; note?: string }>;
}): Promise<{ text: string; rounds: number }> {
  const msgs: Msg[] = [{ role: 'user', content: opts.first }];
  for (let round = 0; round < opts.maxRounds; round++) {
    if (opts.left() < 8_000) return { text: '(시간이 부족해 여기서 멈췄어요)', rounds: round };
    const res = await claude(opts.model, opts.system, msgs, opts.tools, opts.maxTokens ?? 3000, opts.left());
    let content = res.content;
    if (res.stop_reason !== 'tool_use' && content.some((b) => b.type === 'tool_use')) content = content.filter((b) => b.type !== 'tool_use');
    msgs.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(빈 응답)' }] });
    const uses = usesOf(content);
    if (!uses.length) return { text: textOf(content) || '(빈 답)', rounds: round + 1 };
    const results: Block[] = [];
    for (const u of uses) {
      try {
        const r = await opts.onTool(u.name, u.input ?? {}, u.id);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content || '(빈 결과)' });
      } catch (e) {
        const msg = e instanceof ToolError ? e.message : `도구 오류: ${(e as Error).message}`;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: msg, is_error: true });
      }
    }
    msgs.push({ role: 'user', content: results });
  }
  return { text: '(정해진 횟수 안에 끝내지 못했어요)', rounds: opts.maxRounds };
}

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

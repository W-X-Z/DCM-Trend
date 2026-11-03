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

export async function claude(model: string, system: string, messages: Msg[], tools: ToolDef[], maxTokens: number, timeoutMs = 120_000): Promise<ClaudeRes> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], tools, messages: withCache(messages) }),
      signal: AbortSignal.timeout(Math.max(5_000, Math.min(120_000, timeoutMs))),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j as ClaudeRes;
    last = new Error(`Claude ${r.status}: ${String((j as { error?: { message?: string } })?.error?.message ?? '').slice(0, 300)}`);
    // 과부하·한도는 한 번만 잠깐 쉬고 다시
    if (r.status !== 429 && r.status !== 529 && r.status < 500) break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw last ?? new Error('Claude 호출 실패');
}

export const textOf = (content: Block[]) => content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
export const usesOf = (content: Block[]) => content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
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

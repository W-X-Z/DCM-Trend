// 제안서 Agent 채팅 (OpenAI): 사용자 요청을 '행동 목록'으로 해석만 한다. 실제 변경은 브라우저 코드(lib/deck/agent.ts)가 검사 후 반영.
// 보내는 것: 사용자 문장, 최근 대화 몇 개, 초안 상태 요약(공개 데이터·입력 조건). 내부 데이터는 보내지 않는다.
// 요청 내용은 서버에 저장하거나 기록하지 않는다.
import { AGENT_SCHEMA, AGENT_SYSTEM, ACTION_TYPES, type AgentAction } from '@/lib/deck/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.OPENAI_API_KEY ?? '';
const MODEL = process.env.OPENAI_DECK_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini';
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 30) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

type Turn = { role: 'user' | 'assistant'; content: string };

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (!KEY) return Response.json({ error: 'AI 키가 등록되지 않아 채팅을 쓸 수 없어요.', code: 'no_key' }, { status: 503 });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (limited(ip)) return Response.json({ error: '요청이 많아 잠시 쉬어 갈게요. 몇 분 뒤 다시 보내 주세요.', code: 'rate' }, { status: 429 });

  let body: { message?: string; history?: Turn[]; state?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 600) : '';
  if (!message || !body.state) return Response.json({ error: 'bad request' }, { status: 400 });
  const state = JSON.stringify(body.state);
  if (state.length > 40_000) return Response.json({ error: '초안 상태가 너무 커요.' }, { status: 413 });
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-6)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 800) }));

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: AGENT_SYSTEM },
          { role: 'system', content: `현재 초안 상태(JSON):\n${state}` },
          ...history,
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'deck_agent', strict: true, schema: AGENT_SCHEMA } },
      }),
      signal: AbortSignal.timeout(55_000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(String(j?.error?.message ?? res.status).slice(0, 200));
    const out = JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as { reply?: string; actions?: AgentAction[] };
    const actions = (out.actions ?? []).filter((a) => a && (ACTION_TYPES as readonly string[]).includes(a.type)).slice(0, 8);
    return Response.json({ reply: (out.reply ?? '').slice(0, 1200), actions, model: MODEL }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: `답을 만들지 못했어요. 다시 보내 주세요. (${(e as Error).message.slice(0, 120)})` }, { status: 502 });
  }
}

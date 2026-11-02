// Agent 탭 실행 API: Claude(Master + Sub-agent)로 제안서 엔진 도구를 돌리고, 진행을 NDJSON 으로 흘려보낸다.
// 보내는 것: 대화, 초안 상태(공개 데이터·입력 조건), 브라우저에서 고친 스킬, 개인 기억. 서버는 저장하거나 기록하지 않는다.
import { agentReady, runAgent, type Msg, type RunEvent, type SkillIn } from '@/lib/agent/run';
import type { AgentKey } from '@/lib/agent/config';
import type { EngineState } from '@/lib/deck/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 40) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const isStr = (x: unknown): x is string => typeof x === 'string';

function cleanSkills(raw: unknown): SkillIn[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SkillIn[] = [];
  for (const s of raw.slice(0, 12)) {
    if (!s || !isStr(s.name) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(s.name) || typeof s.files !== 'object' || !s.files) return null;
    const files: Record<string, string> = {};
    for (const [p, v] of Object.entries(s.files as Record<string, unknown>).slice(0, 30)) {
      if (!isStr(v) || !/^[A-Za-z0-9._/-]{1,120}$/.test(p) || p.includes('..')) return null;
      files[p] = v;
    }
    if (!files['SKILL.md']) return null;
    const agents = (Array.isArray(s.agents) ? s.agents : []).filter((a: unknown): a is AgentKey => a === 'master' || a === 'sales_writer' || a === 'reviewer');
    out.push({ name: s.name, files, agents });
  }
  return out;
}

function cleanMessages(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const msgs = raw.slice(-60) as Msg[];
  for (const m of msgs) if (!m || (m.role !== 'user' && m.role !== 'assistant') || !(isStr(m.content) || Array.isArray(m.content))) return null;
  // 첫 메시지는 사용자 글이어야 한다(도구 결과로 시작하면 짝이 끊긴다)
  while (msgs.length && !(msgs[0].role === 'user' && isStr(msgs[0].content))) msgs.shift();
  return msgs.length ? msgs : null;
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (!agentReady()) return Response.json({ error: 'Claude API 키(ANTHROPIC_API_KEY)가 서버에 없어 Agent 를 돌릴 수 없어요.', code: 'no_key' }, { status: 503 });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (limited(ip)) return Response.json({ error: '요청이 많아 잠시 쉬어 갈게요. 몇 분 뒤 다시 보내 주세요.', code: 'rate' }, { status: 429 });

  const text = await req.text();
  if (text.length > 900_000) return Response.json({ error: '보낸 내용이 너무 커요. 새 대화로 시작해 주세요.', code: 'too_big' }, { status: 413 });
  let body: { messages?: unknown; state?: unknown; skills?: unknown; memory?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const messages = cleanMessages(body.messages);
  const skills = cleanSkills(body.skills);
  if (!messages || !skills) return Response.json({ error: 'bad request' }, { status: 400 });
  const state = body.state && typeof body.state === 'object' && (body.state as EngineState).v === 2 ? (body.state as EngineState) : null;
  const memory = isStr(body.memory) ? body.memory.slice(0, 8000) : null;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const emit = (e: RunEvent) => ctrl.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        await runAgent({ messages, state, skills, memory }, emit, 170_000, (maxDuration - 15) * 1000);
      } catch (e) {
        emit({ t: 'error', message: `Agent 실행이 멈췄어요. (${String((e as Error).message).slice(0, 200)})` });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

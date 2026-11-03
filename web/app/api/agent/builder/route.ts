// Agent Builder API: 피드백을 받아 제안서 Agent 의 노하우·프롬프트 수정안을 만든다(저장은 브라우저가 승인 후).
import { runBuilder, type BuilderEvent } from '@/lib/agent/builder';
import { agentReady } from '@/lib/agent/llm';
import { cleanAssets, cleanMessages, limited, ndjson, readBody, sameOrigin } from '@/lib/agent/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (!agentReady()) return Response.json({ error: 'Claude API 키(ANTHROPIC_API_KEY)가 서버에 없어 Agent Builder 를 돌릴 수 없어요.', code: 'no_key' }, { status: 503 });
  if (limited(req)) return Response.json({ error: '요청이 많아 잠시 쉬어 갈게요. 몇 분 뒤 다시 보내 주세요.', code: 'rate' }, { status: 429 });
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const messages = cleanMessages(body.messages);
  const assets = cleanAssets(body.assets);
  if (!messages || !assets) return Response.json({ error: 'bad request' }, { status: 400 });
  const memory = typeof body.memory === 'string' ? body.memory.slice(0, 8000) : null;
  const seq = Number.isFinite(Number(body.seq)) ? Math.max(0, Math.round(Number(body.seq))) : 0;
  return ndjson<BuilderEvent>((emit) => runBuilder({ messages, assets, memory, seq }, emit, 170_000, (maxDuration - 15) * 1000), (message) => ({ t: 'error', message }));
}

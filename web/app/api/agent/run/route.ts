// 제안서 Agent 실행 API: Master + 역할 6개(Claude)가 엔진 도구로 초안을 만들고 고친다. 진행을 NDJSON 으로 흘려보낸다.
// 보내는 것: 대화, 작업 세션(공개 데이터 기반 초안 상태·결정 기록), 지금 쓰는 프롬프트·노하우 판, 개인 기억. 서버는 저장하지 않는다.
import { runDcm, type DcmEvent } from '@/lib/agent/dcm';
import { agentReady } from '@/lib/agent/llm';
import { cleanAssets, cleanMessages, cleanSession, limited, ndjson, readBody, sameOrigin } from '@/lib/agent/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (!agentReady()) return Response.json({ error: 'Claude API 키(ANTHROPIC_API_KEY)가 서버에 없어 Agent 를 돌릴 수 없어요.', code: 'no_key' }, { status: 503 });
  if (limited(req)) return Response.json({ error: '요청이 많아 잠시 쉬어 갈게요. 몇 분 뒤 다시 보내 주세요.', code: 'rate' }, { status: 429 });
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const messages = cleanMessages(body.messages);
  const assets = cleanAssets(body.assets);
  if (!messages || !assets) return Response.json({ error: 'bad request' }, { status: 400 });
  const session = cleanSession(body.session);
  const memory = typeof body.memory === 'string' ? body.memory.slice(0, 8000) : null;
  return ndjson<DcmEvent>((emit) => runDcm({ messages, session, assets, memory }, emit, 170_000, (maxDuration - 15) * 1000), (message) => ({ t: 'error', message }));
}

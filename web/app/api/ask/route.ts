// AI 질문: OpenAI 함수 호출로 mart 조회 도구를 부르고 답을 쓴다.
// 응답은 줄 단위 JSON(NDJSON): {type:'step', label} … {type:'answer', text, refs} 또는 {type:'error', message}
import { TOOL_LABEL, TOOL_SCHEMAS, runTool, type Ref } from '@/lib/ai-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.OPENAI_API_KEY ?? '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const MAX_ROUNDS = 6;
const MAX_Q = 400;

// 공개 사이트라 IP 마다 10분에 8번까지 (서버 인스턴스 기준, 대략적인 보호)
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 8) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const SYSTEM = () => `너는 NH투자증권 커버리지 본부 RM·RA를 돕는 발행시장 데이터 도우미다. 오늘은 ${today()}(한국 시간)이다.
- 반드시 도구로 조회한 데이터만 근거로 답한다. 도구 결과에 없는 사실·숫자는 쓰지 않는다. 모르면 "수집한 데이터에서 찾지 못했다"고 말하고 어떤 데이터가 있으면 답할 수 있는지 한 줄로 알려 준다.
- 데이터 범위: 공모 회사채 2019년~, 메자닌(CB·BW·EB) 2021년~, 유상증자·IPO 2024년 10월~ (OpenDART 공시 기준), 정기보고서 회사채 미상환 잔액, 시장금리. 증권신고서 본문 문장(투자위험요소 등)은 없다. 은행·카드·캐피탈의 일괄신고 채권은 빠져 있다.
- 회사 이름이 나오면 먼저 search_companies 로 corp_code 를 찾는다. 날짜 표현(최근 한 달, 올해 등)은 오늘 기준으로 YYYY-MM-DD 로 바꿔 도구에 넣는다.
- 답은 한국어 평서문(~다)으로 짧게: 첫 줄에 결론 1~2문장, 이어서 근거를 "- " 목록으로 최대 7줄. 각 줄에 회사·날짜·금액(억원/조원)·조건을 넣는다. 금액은 도구가 준 억원 숫자를 쓰고 1조 이상은 조원으로 바꿔도 된다.
- 기준일이나 집계 기준(납입일/결정일)이 답에 영향을 주면 한 줄로 밝힌다.
- 금지: 예측·전망, 투자 권유, 고객 실명 수요예측 정보 추정, 표(마크다운 표) 사용.`;

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

async function chat(messages: Msg[]) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOL_SCHEMAS, tool_choice: 'auto' }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${String(body?.error?.message ?? '').slice(0, 200)}`);
  return body.choices?.[0]?.message as Msg;
}

export async function POST(req: Request) {
  const enc = new TextEncoder();
  const line = (o: unknown) => enc.encode(`${JSON.stringify(o)}\n`);

  // 다른 사이트에서 부르는 것을 막는다
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return new Response('forbidden', { status: 403 });

  if (!KEY) {
    return new Response(`${JSON.stringify({ type: 'error', code: 'no_key', message: 'AI 키가 아직 등록되지 않았습니다.' })}\n`, {
      status: 503, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    });
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (limited(ip)) {
    return new Response(`${JSON.stringify({ type: 'error', code: 'rate', message: '질문이 많아 잠시 쉬어 갑니다. 몇 분 뒤 다시 물어 보세요.' })}\n`, {
      status: 429, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    });
  }

  let payload: { q?: string; history?: { q: string; a: string }[] };
  try {
    payload = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const q = String(payload.q ?? '').trim().slice(0, MAX_Q);
  if (!q) return new Response('empty', { status: 400 });
  const history = (payload.history ?? []).slice(-3).flatMap((h): Msg[] => [
    { role: 'user', content: String(h.q).slice(0, MAX_Q) },
    { role: 'assistant', content: String(h.a).slice(0, 1500) },
  ]);

  const stream = new ReadableStream({
    async start(controller) {
      const refs = new Map<string, Ref>();
      const messages: Msg[] = [{ role: 'system', content: SYSTEM() }, ...history, { role: 'user', content: q }];
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const msg = await chat(messages);
          if (!msg) throw new Error('빈 응답');
          if (!msg.tool_calls?.length) {
            controller.enqueue(line({ type: 'answer', text: String(msg.content ?? '').trim(), refs: [...refs.values()].slice(0, 10) }));
            controller.close();
            return;
          }
          messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
          for (const call of msg.tool_calls.slice(0, 4)) {
            controller.enqueue(line({ type: 'step', label: TOOL_LABEL[call.function.name] ?? call.function.name }));
            let out: unknown;
            try {
              const args = JSON.parse(call.function.arguments || '{}');
              const r = await runTool(call.function.name, args);
              for (const ref of r.refs) refs.set(ref.href, ref);
              out = r.data;
            } catch (e) {
              out = `조회 실패: ${(e as Error).message.slice(0, 120)}`;
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 24_000) });
          }
          for (const call of msg.tool_calls.slice(4)) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: '"한 번에 4개까지만 조회합니다"' });
          }
        }
        controller.enqueue(line({ type: 'error', message: '조회가 길어져 멈췄습니다. 질문을 좁혀 다시 물어 보세요.' }));
      } catch (e) {
        controller.enqueue(line({ type: 'error', message: `답을 만들지 못했습니다. ${(e as Error).message.slice(0, 120)}` }));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}

// Agent API 공용: 요청 검사, 속도 제한, NDJSON 스트림 (서버 전용)
import 'server-only';
import { ASSETS, emptySession, type AssetTexts, type Msg, type RefPick, type Session } from './defs';
import type { EngineState } from '../deck/engine';

const hits = new Map<string, number[]>();
export function limited(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 60) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

export const sameOrigin = (req: Request) => {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  return !(origin && host && new URL(origin).host !== host);
};

const isStr = (x: unknown): x is string => typeof x === 'string';
const IDS = new Set(ASSETS.map((a) => a.id));

export function cleanAssets(raw: unknown): AssetTexts | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: AssetTexts = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!IDS.has(k)) continue;
    if (!isStr(v) || v.length > 40_000) return null;
    out[k] = v;
  }
  return out;
}

export function cleanMessages(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const msgs = raw.slice(-60) as Msg[];
  for (const m of msgs) if (!m || (m.role !== 'user' && m.role !== 'assistant') || !(isStr(m.content) || Array.isArray(m.content))) return null;
  // 첫 메시지는 사용자 글이어야 한다(도구 결과로 시작하면 짝이 끊긴다)
  while (msgs.length && !(msgs[0].role === 'user' && isStr(msgs[0].content))) msgs.shift();
  return msgs.length ? msgs : null;
}

export function cleanSession(raw: unknown): Session {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Session>;
  const st = s.state && typeof s.state === 'object' && (s.state as EngineState).v === 2 ? (s.state as EngineState) : null;
  return {
    ...emptySession(),
    state: st,
    log: Array.isArray(s.log) ? s.log.slice(-200) : [],
    memos: s.memos && typeof s.memos === 'object' ? s.memos : {},
    texts: s.texts && typeof s.texts === 'object' ? s.texts : {},
    flags: Array.isArray(s.flags) ? s.flags.slice(-50) : [],
    review: isStr(s.review) ? s.review : null,
    used: s.used && typeof s.used === 'object' ? s.used : {},
    refs: cleanRefs(s.refs),
  };
}
// 참고 자료 · 붙인 자료: 드라이브 파일 id 와 이름만
function cleanRefs(raw: unknown): RefPick[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is RefPick => !!x && Number.isInteger((x as RefPick).id) && (x as RefPick).id > 0 && isStr((x as RefPick).name))
    .slice(0, 5)
    .map((x) => ({ id: x.id, name: x.name.slice(0, 200), why: isStr(x.why) ? x.why.slice(0, 200) : '', by: x.by === 'agent' ? 'agent' : 'user' }));
}
export const cleanAttach = (raw: unknown) => cleanRefs(Array.isArray(raw) ? raw.map((x) => ({ why: '사용자가 붙임', ...(x as object), by: 'user' })) : []);

export async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  const text = await req.text();
  if (text.length > 1_200_000) return Response.json({ error: '보낸 내용이 너무 커요. 새 대화로 시작해 주세요.', code: 'too_big' }, { status: 413 });
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
}

export function ndjson<E>(run: (emit: (e: E) => void) => Promise<void>, onError: (msg: string) => E) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const emit = (e: E) => ctrl.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        await run(emit);
      } catch (e) {
        emit(onError(`실행이 멈췄어요. (${String((e as Error).message).slice(0, 200)})`));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

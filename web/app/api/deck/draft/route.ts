// 제안서 장표 문안 (OpenAI). 브라우저가 보낸 사실 묶음·규칙 문안과 현업 노하우(DB)를 근거로 쓰고, 결과를 검증해 돌려준다.
// 요청 내용(회사명·제안 조건)은 서버에 저장하거나 기록하지 않는다.
import { selectFresh } from '@/lib/db';
import { knowledgeForPrompt, type Knowledge } from '@/lib/deck/knowledge';
import { SCHEMA, SYSTEM, deckUserMessage } from '@/lib/deck/prompt';
import { allowedNumbers, mergeValidated } from '@/lib/deck/validate';
import type { DeckText } from '@/lib/deck/types';

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
  if (recent.length >= 6) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (!KEY) return Response.json({ error: 'AI 키가 등록되지 않아 규칙 문안을 그대로 씁니다.', code: 'no_key' }, { status: 503 });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (limited(ip)) return Response.json({ error: '요청이 많아 잠시 쉬어 갑니다. 몇 분 뒤 다시 시도하세요.', code: 'rate' }, { status: 429 });

  let body: { facts?: unknown; rule?: DeckText; focus?: string; grade?: string; slides?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!body.facts || !body.rule) return Response.json({ error: 'bad request' }, { status: 400 });
  // 현업 노하우: 이 회사 등급·켠 장표에 맞는 것만. 못 읽으면 노하우 없이 진행한다.
  const known = await selectFresh<Knowledge>('v_deck_knowledge', { limit: 1000 }).catch(() => [] as Knowledge[]);
  const slides = Array.isArray(body.slides) ? body.slides.filter((x) => typeof x === 'string').slice(0, 40) : null;
  const tips = knowledgeForPrompt(known, typeof body.grade === 'string' ? body.grade : null, slides);
  const applied = Object.values(tips).reduce((n, xs) => n + xs.length, 0);
  const payload = deckUserMessage({ facts: body.facts, rule: body.rule, tips, focus: body.focus });
  if (payload.length > 60_000) return Response.json({ error: '입력이 너무 깁니다. 비교 사례 수를 줄여 주세요.' }, { status: 413 });

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: payload }],
        response_format: { type: 'json_schema', json_schema: { name: 'deck_text', strict: true, schema: SCHEMA } },
      }),
      signal: AbortSignal.timeout(55_000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(String(j?.error?.message ?? res.status).slice(0, 200));
    const content = j.choices?.[0]?.message?.content ?? '{}';
    const ai = JSON.parse(content) as Partial<DeckText>;
    // 노하우에 적힌 숫자(예: 1~3월)는 현업이 정한 기준이라 문안에 써도 된다
    const allowed = allowedNumbers(body.facts, body.rule, tips);
    const { text, dropped } = mergeValidated(ai, body.rule, allowed);
    return Response.json({ text, dropped: dropped.length, droppedLines: dropped.slice(0, 20), applied, model: MODEL }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: `AI 문안을 만들지 못했습니다. 규칙 문안을 그대로 씁니다. (${(e as Error).message.slice(0, 120)})` }, { status: 502 });
  }
}

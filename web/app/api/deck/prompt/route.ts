// 제안서 Sales 문안 AI 에 보낼 메시지를 AI 를 부르지 않고 그대로 돌려준다('작동 방식' 화면의 실행 추적용).
import { selectFresh } from '@/lib/db';
import { knowledgeForPrompt, type Knowledge } from '@/lib/deck/knowledge';
import { DECK_PROMPT_VERSION, SCHEMA, SYSTEM, deckUserMessage } from '@/lib/deck/prompt';
import type { DeckText } from '@/lib/deck/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.OPENAI_DECK_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini';

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'forbidden' }, { status: 403 });
  let body: { facts?: unknown; rule?: DeckText; grade?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!body.facts || !body.rule) return Response.json({ error: 'bad request' }, { status: 400 });
  const known = await selectFresh<Knowledge>('v_deck_knowledge', { limit: 1000 }).catch(() => [] as Knowledge[]);
  const tips = knowledgeForPrompt(known, typeof body.grade === 'string' ? body.grade : null, ['sales']);
  const user = deckUserMessage({ facts: body.facts, rule: body.rule, tips });
  return Response.json({
    model: MODEL,
    version: DECK_PROMPT_VERSION,
    system: SYSTEM,
    schema: SCHEMA,
    user,
    tips,
    applied: Object.values(tips).reduce((n, xs) => n + xs.length, 0),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

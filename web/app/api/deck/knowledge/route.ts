// 제안서 노하우 읽기·쓰기. 권한 없이 누구나 쓰는 프로토타입이라 저장은 DB 함수가 이력과 함께 남긴다.
import { DbError, rpcWrite, selectFresh } from '@/lib/db';
import { GRADES, KINDS, SLIDES, type Knowledge, type KnowledgeLog } from '@/lib/deck/knowledge';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const SLIDE_KEYS = SLIDES.map(([k]) => k as string);
const KIND_KEYS = KINDS.map(([k]) => k as string);

export async function GET(req: Request) {
  const withLog = new URL(req.url).searchParams.get('log') === '1';
  try {
    const [items, log] = await Promise.all([
      selectFresh<Knowledge>('v_deck_knowledge', { order: 'updated_at.desc', limit: 1000 }),
      withLog ? selectFresh<KnowledgeLog>('v_deck_knowledge_log', { limit: 300 }) : Promise.resolve(null),
    ]);
    return Response.json({ items, log }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('knowledge', e);
    return Response.json({ error: '노하우를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  try {
    if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'forbidden' }, { status: 403 });
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const raw = await req.text();
  if (raw.length > 5_000) return Response.json({ error: '내용이 너무 깁니다.' }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const id = typeof b.id === 'number' && Number.isInteger(b.id) && b.id > 0 ? b.id : null;
  const author = str(b.author, 60) || null;
  const clientId = str(b.clientId, 40) || null;

  try {
    if (b.action === 'delete' || b.action === 'restore') {
      if (!id) return Response.json({ error: 'bad request' }, { status: 400 });
      await rpcWrite<number>(b.action === 'delete' ? 'delete_deck_knowledge' : 'restore_deck_knowledge', { p_id: id, p_author: author, p_client_id: clientId });
      return Response.json({ ok: true, id });
    }
    const slide = str(b.slide, 20);
    const kind = str(b.kind, 20);
    const grade = str(b.grade, 5);
    const body = str(b.body, 500);
    if (!SLIDE_KEYS.includes(slide) || !KIND_KEYS.includes(kind) || (grade && !(GRADES as string[]).includes(grade))) {
      return Response.json({ error: 'bad request' }, { status: 400 });
    }
    if (body.length < 5) return Response.json({ error: '내용을 5자 이상 적어 주세요.' }, { status: 400 });
    const saved = await rpcWrite<number>('save_deck_knowledge', {
      p_id: id, p_slide: slide, p_kind: kind, p_grade: grade || null, p_body: body,
      p_source: str(b.source, 200) || null, p_author: author, p_client_id: clientId,
    });
    return Response.json({ ok: true, id: saved });
  } catch (e) {
    const m = e instanceof DbError ? e.message : '';
    if (/too many/.test(m)) return Response.json({ error: '잠시 뒤 다시 시도하세요.' }, { status: 429 });
    if (/not found/.test(m)) return Response.json({ error: '다른 사람이 먼저 지웠거나 바꾼 항목입니다. 새로고침하세요.' }, { status: 404 });
    console.error('knowledge save', e);
    return Response.json({ error: '저장하지 못했습니다.' }, { status: 500 });
  }
}

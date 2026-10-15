import { NextResponse } from 'next/server';
import { DbError, rpcWrite } from '@/lib/db';

// 현업 피드백 받기. 저장은 mart.submit_feedback(ops.feedback), 화면에서는 읽지 않는다.
export const dynamic = 'force-dynamic';

const KINDS = ['good', 'improve', 'bug', 'data', 'etc'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function POST(req: Request) {
  // 다른 사이트에서 보낸 요청은 받지 않는다
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  const sameSite = (() => {
    try {
      return !origin || !host || new URL(origin).host === host;
    } catch {
      return false;
    }
  })();
  if (!sameSite) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const raw = await req.text();
  if (raw.length > 10_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // 자동 입력 방지용 빈 칸이 채워져 있으면 저장하지 않고 성공으로 답한다
  if (str(b.website, 100)) return NextResponse.json({ ok: true });

  const kind = typeof b.kind === 'string' && KINDS.includes(b.kind) ? b.kind : null;
  const body = str(b.body, 2000);
  if (!kind || body.length < 2) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    await rpcWrite<number>('submit_feedback', {
      p_kind: kind,
      p_body: body,
      p_author: str(b.author, 60) || null,
      p_page: str(b.page, 300) || null,
      p_client_id: str(b.clientId, 40) || null,
      p_viewport: str(b.viewport, 20) || null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DbError && /too many/.test(e.message)) {
      return NextResponse.json({ error: 'too_many' }, { status: 429 });
    }
    console.error('feedback', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

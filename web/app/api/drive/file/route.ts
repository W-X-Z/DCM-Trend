// 드라이브 원본 내려받기. 키(x-drive-key)가 맞아야 한다.
import { driveBody } from '@/lib/drive/store';
import { cors, dbWhy, guard, json, preflight } from '@/lib/drive/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const MIME: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf', md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json(req, { error: 'bad request' }, 400);
  try {
    const f = await driveBody(id);
    if (!f) return json(req, { error: '파일을 찾지 못했어요.' }, 404);
    return new Response(new Uint8Array(f.body), {
      headers: { ...cors(req), 'Content-Type': MIME[f.kind] ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    const w = dbWhy(e);
    return json(req, { error: w.error }, w.status);
  }
}

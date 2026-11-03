// 드라이브 API(AX 플랫폼 4안 · 제안서 Agent 탭): 목록 · 올리기 · 지우기. 키(x-drive-key)가 맞아야 한다.
//   GET  ?area=dept|mine[&folder=]  → 폴더 목록(이름마다 최신 버전)
//   POST multipart(file, area, folder, author) → 저장(같은 이름이면 새 버전) + DM 판 · 레퍼런스 카드 만들기
//   DELETE ?id=  → 그 이름의 모든 버전 지우기
import { FOLDERS, driveDelete, driveList, type Area } from '@/lib/drive/store';
import { clientOf, dbWhy, guard, json, preflight } from '@/lib/drive/http';
import { ingest, IngestError, MAX_BYTES } from '@/lib/drive/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const areaOf = (v: string | null): Area | null => (v === 'dept' || v === 'mine' ? v : null);

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  const u = new URL(req.url);
  const area = areaOf(u.searchParams.get('area'));
  if (!area) return json(req, { error: 'bad request' }, 400);
  const folder = u.searchParams.get('folder') || undefined;
  try {
    return json(req, { folders: FOLDERS[area], files: await driveList(area, folder) });
  } catch (e) {
    const w = dbWhy(e);
    return json(req, { error: w.error }, w.status);
  }
}

export async function POST(req: Request) {
  const no = guard(req);
  if (no) return no;
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES + 100_000) return json(req, { error: '파일이 너무 커요(4.4MB 까지).' }, 413);
  let f: FormData;
  try {
    f = await req.formData();
  } catch {
    return json(req, { error: 'bad request' }, 400);
  }
  const file = f.get('file');
  const area = areaOf(String(f.get('area') ?? ''));
  const folder = String(f.get('folder') ?? '').trim();
  if (!(file instanceof File) || !area || !FOLDERS[area].includes(folder)) return json(req, { error: 'bad request' }, 400);
  const name = file.name.replace(/[\\/]/g, '_').trim().slice(0, 200);
  try {
    const out = await ingest({
      area, folder, name, body: new Uint8Array(await file.arrayBuffer()),
      author: String(f.get('author') ?? '').slice(0, 60) || undefined, client: clientOf(req), left: (maxDuration - 20) * 1000,
    });
    return json(req, out);
  } catch (e) {
    if (e instanceof IngestError) return json(req, { error: e.message }, 400);
    console.error('drive upload', (e as Error).message);
    const w = dbWhy(e);
    return json(req, { error: w.error }, w.status);
  }
}

export async function DELETE(req: Request) {
  const no = guard(req);
  if (no) return no;
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json(req, { error: 'bad request' }, 400);
  try {
    await driveDelete(id, clientOf(req));
    return json(req, { ok: true });
  } catch (e) {
    const w = dbWhy(e);
    return json(req, { error: w.error }, w.status);
  }
}

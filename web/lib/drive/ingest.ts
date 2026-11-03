// 올리기 처리: 글 뽑기 → 저장(버전) → 폴더별 후처리(DM: 판 만들기, 레퍼런스: 카드 만들기).
import 'server-only';
import { kstToday } from '../filings';
import { dmFromSlides } from './dm';
import { extract, kindOf, type DriveKind, type SlideInfo } from './extract';
import { makeCard } from './ref';
import { drivePut, driveSet, type Area, type DriveMeta } from './store';

export const MAX_BYTES = 4_400_000; // Vercel 요청 본문 한도(4.5MB) 아래
export type IngestOut = { id: number; ver: number; name: string; folder: string; kind: DriveKind; status: 'ready' | 'error'; error?: string; meta: DriveMeta };

export async function ingest(a: { area: Area; folder: string; name: string; body: Uint8Array; author?: string; client?: string; left?: number }): Promise<IngestOut> {
  const kind = kindOf(a.name);
  if (!kind) throw new IngestError('PPTX · PDF · MD · CSV · TXT · XLSX · DOCX · JSON 파일만 올릴 수 있어요.');
  if (a.body.length > MAX_BYTES) throw new IngestError('파일이 너무 커요(4.4MB 까지).');
  if (a.folder === 'DM' && kind !== 'pptx') throw new IngestError('DM 폴더에는 DM PPTX 를 올려 주세요.');
  const dm = a.area === 'dept' && a.folder === 'DM';
  const ref = a.area === 'dept' && a.folder === '레퍼런스';

  let content = '';
  let slides: SlideInfo[] | null = null;
  let pages = 0;
  let readErr = '';
  try {
    const x = await extract(kind, a.body, { images: dm });
    ({ content, slides, pages } = x);
  } catch (e) {
    readErr = `글을 읽지 못했어요(${(e as Error).message.slice(0, 80)}).`;
  }
  // 슬라이드 구조는 그림 데이터를 빼고 저장(DM 그림은 판에만 둔다)
  const slim = slides?.map((s) => ({ ...s, images: s.images.map(({ data: _d, ...r }) => r) })) ?? null;
  const post = (dm || ref) && !readErr;
  const put = await drivePut({
    area: a.area, folder: a.folder, name: a.name, kind, body: a.body, content, slides: slim, meta: { pages },
    status: post ? 'processing' : readErr && (dm || ref) ? 'error' : 'ready', author: a.author, client: a.client,
  });
  const out = { id: put.id, ver: put.ver, name: a.name, folder: a.folder, kind };
  if (readErr) {
    if (dm || ref) await driveSet(put.id, {}, 'error', readErr);
    return { ...out, status: dm || ref ? 'error' : 'ready', error: readErr, meta: { pages } };
  }
  if (!post) return { ...out, status: 'ready', meta: { pages } };

  try {
    let meta: DriveMeta;
    if (dm) {
      if (!slides) throw new Error('슬라이드를 읽지 못했어요.');
      const r = await dmFromSlides(slides, { fileName: a.name, author: a.author ?? '', today: kstToday(), left: a.left });
      meta = { edition: r.edition, dm: { edition: r.edition.edition, filled: r.filled, by: r.by } };
    } else {
      const r = await makeCard(a.name, content, slides, a.left);
      meta = { card: r.card, by: r.by };
    }
    await driveSet(put.id, meta, 'ready');
    const { edition: _e, ...light } = meta;
    return { ...out, status: 'ready', meta: { pages, ...light } };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300) || '처리하지 못했어요.';
    await driveSet(put.id, {}, 'error', msg).catch(() => null);
    return { ...out, status: 'error', error: msg, meta: { pages } };
  }
}

export class IngestError extends Error {}

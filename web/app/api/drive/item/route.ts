// 드라이브 파일 하나: 뽑은 글 · 슬라이드 구조 · 카드 · DM 판 요약 + 버전 목록. 키(x-drive-key)가 맞아야 한다.
import { driveRead, driveVersions } from '@/lib/drive/store';
import { dbWhy, guard, json, preflight } from '@/lib/drive/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id < 1) return json(req, { error: 'bad request' }, 400);
  try {
    const [it, versions] = await Promise.all([driveRead(id), driveVersions(id)]);
    if (!it) return json(req, { error: '파일을 찾지 못했어요.' }, 404);
    // DM 판은 그림(data URL)이 커서 요약만
    const { edition, ...meta } = it.meta ?? {};
    const dm = edition ? { edition: edition.edition, title: edition.title, grade: edition.grade ?? null, pages: Object.keys(edition.pages ?? {}), charts: (edition.charts?.rates ?? []).map((c) => c.title), meetings: Object.entries(edition.meetings ?? {}).map(([k, m]) => ({ kind: k, meeting_dt: m!.meeting_dt, title: m!.title, points: m!.points.length, images: m!.images?.length ?? 0 })), forecastTable: !!edition.forecastTable, issuePages: edition.issuePages?.length ?? 0 } : null;
    return json(req, { ...it, meta, dm, versions });
  } catch (e) {
    const w = dbWhy(e);
    return json(req, { error: w.error }, w.status);
  }
}

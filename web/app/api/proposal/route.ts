import { buildDraft, toMarkdown, type DraftType } from '@/lib/proposal';

// 제안서 초안 내려받기 (마크다운). 화면과 같은 내용. format=json 이면 제안서 초안 화면의 '관련 데이터'용 JSON.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const corp = sp.get('corp') ?? '';
  if (!/^[0-9A-Za-z_]{1,20}$/.test(corp)) return new Response('bad request', { status: 400 });
  const type = sp.get('type') === 'mezz' ? 'mezz' : sp.get('type') === 'bond' ? 'bond' : undefined;
  try {
    const d = await buildDraft(corp, type as DraftType | undefined);
    if (!d) return new Response('not found', { status: 404 });
    if (sp.get('format') === 'json') return Response.json(d, { headers: { 'cache-control': 'private, max-age=60' } });
    const name = `proposal_${corp}_${d.type}_${d.asof}.md`;
    return new Response(`${toMarkdown(d)}\n`, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(`${d.company.corp_name} 제안서 초안 ${d.asof}.md`)}`,
        'cache-control': 'private, max-age=60',
      },
    });
  } catch {
    return new Response('조회 실패', { status: 502 });
  }
}

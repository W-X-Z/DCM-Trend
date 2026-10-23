import { getDeckData } from '@/lib/deck/data';

// 제안서 작성 화면이 읽는 공개 데이터(공시·금리·리서치 요약·일정). 제안 조건은 받지도 저장하지도 않는다.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const corp = new URL(req.url).searchParams.get('corp') ?? '';
  if (!/^[0-9A-Za-z_]{1,20}$/.test(corp)) return Response.json({ error: 'bad request' }, { status: 400 });
  try {
    const d = await getDeckData(corp);
    if (!d) return Response.json({ error: '회사를 찾지 못했습니다.' }, { status: 404 });
    return Response.json(d, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    console.error('deck data', (e as Error).message);
    return Response.json({ error: '데이터를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.' }, { status: 502 });
  }
}

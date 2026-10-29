import { NextResponse } from 'next/server';
import { searchCompanies } from '@/lib/queries';

// 머리글 검색창 자동완성: 회사 이름 일부 → 후보 8곳
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 40);
  if (!q) return NextResponse.json([]);
  try {
    // 첫 조회가 느리거나 끊기면 한 번 더 시도한다
    const hits = await searchCompanies(q, 8).catch(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return searchCompanies(q, 8);
    });
    return NextResponse.json(
      hits.map((h) => ({ corp_code: h.corp_code, corp_name: h.corp_name, market: h.market, deal_count: h.deal_count, last_deal_dt: h.last_deal_dt })),
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=600' } },
    );
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}

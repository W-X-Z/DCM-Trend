import { select } from '@/lib/db';
import { getExpansionCompanies, getExpansionEvents } from '@/lib/queries';

// 사업 확장 기업 전체(JSON): research/expansion/export.mjs 가 주간 스냅샷을 만들 때 읽는다.
// 화면과 같은 공개 공시 데이터만 담고, GitHub 쪽에 DB 키가 없어도 되게 한다.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [companies, events] = await Promise.all([getExpansionCompanies(), getExpansionEvents()]);
    const codes = [...new Set(companies.map((c) => c.corp_code))];
    const stocks: Record<string, string> = {};
    for (let i = 0; i < codes.length; i += 80) {
      const rows = await select<{ corp_code: string; stock_code: string | null }>('v_company_overview', {
        select: 'corp_code,stock_code',
        corp_code: `in.(${codes.slice(i, i + 80).join(',')})`,
      });
      for (const r of rows) stocks[r.corp_code] = r.stock_code ?? '';
    }
    const asof = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    return Response.json({ asof, companies, events, stocks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

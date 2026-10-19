import { applyExpFilter, parseExpParams } from '@/lib/expansion';
import { getExpansionCompanies, getExpansionEvents } from '@/lib/queries';

// 사업 확장 기업 CSV (화면과 같은 필터). 한 줄 = 확장 결정 공시 1건, 회사 정보는 줄마다 반복
export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const eok = (v: number | null | undefined) => (v == null ? '' : Math.round(Number(v) / 1e8));

export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseExpParams(sp);
  try {
    const [companies, events] = await Promise.all([getExpansionCompanies(), getExpansionEvents()]);
    const rows = applyExpFilter(companies, f);
    const byCorp = new Map<string, typeof events>();
    for (const e of events) byCorp.set(e.corp_code, [...(byCorp.get(e.corp_code) ?? []), e]);
    const header = [
      '회사', '시장', '최근 회사채 등급', '확장 유형', '회사 확장 금액(억원)', '결정 후 공모·메자닌 조달 없음', 'NH 대표주관 이력',
      '결정일', '정정 공시(진행 중)', '투자 종료일', '공시', '공시 확장 유형', '금액(억원)', '규모 비율(%)', '비율 기준', '목적', '대상', '자금 조달', '원문',
    ];
    const lines = [header.map(cell).join(',')];
    for (const c of rows) {
      for (const e of byCorp.get(c.corp_code) ?? []) {
        lines.push([
          c.corp_name, c.market ?? '비상장', c.latest_bond_rating ?? '', c.cats.join(' / '), eok(c.amount_krw), c.no_funding_after ? 'Y' : '',
          c.nh_lead_ever ? 'Y' : '', e.decided_dt, e.is_amendment ? e.rcept_dt : '', e.end_dt ?? '', e.src_label, e.cat, eok(e.amount_krw), e.ratio_pct ?? '', e.ratio_basis,
          e.purpose ?? '', [e.target, e.detail].filter(Boolean).join(' · '), e.funding_note ?? '', e.dart_url,
        ].map(cell).join(','));
      }
    }
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    return new Response(`\uFEFF${lines.join('\n')}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="expansion_${today}.csv"; filename*=UTF-8''${encodeURIComponent(`사업 확장 기업 ${today}.csv`)}`,
      },
    });
  } catch {
    return new Response('목록을 불러오지 못했습니다.', { status: 500 });
  }
}

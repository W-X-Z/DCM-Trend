import { select } from '@/lib/db';
import { dealTitle } from '@/lib/labels';
import { PERIODS, bucketOf, makeWindow, type Period } from '@/lib/period';
import type { BondIssue, Deal, ProductType } from '@/lib/types';

// NH투자증권 대표주관 트랙레코드 CSV (발행 동향 화면의 기간·구분과 같은 기준). 제안서 트랙레코드 표 갱신용.
export const dynamic = 'force-dynamic';

const PRODUCTS: ProductType[] = ['bond', 'mezz', 'equity', 'ipo'];
const LABEL: Record<ProductType, string> = { bond: '공모 회사채', mezz: '메자닌', equity: '유상증자', ipo: 'IPO' };
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const eok = (v: number | null | undefined) => (v == null ? '' : Math.round(Number(v) / 1e8));
const coLeads = (s: string | null) => (s ?? '').split(',').map((x) => x.trim()).filter((x) => x && !/NH투자/.test(x)).join(' / ');

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const product = (PRODUCTS as string[]).includes(sp.get('product') ?? '') ? (sp.get('product') as ProductType) : 'bond';
  const m: Period = (PERIODS as readonly string[]).includes(sp.get('m') ?? '') ? (sp.get('m') as Period) : '12';
  const cat = (sp.get('cat') ?? 'all').slice(0, 20);
  const w = makeWindow(m);
  const last = w.buckets.at(-1)!.key;
  const inW = (dt: string | null) => Boolean(dt && dt >= w.since && bucketOf(w, dt) <= last);

  let header: string[];
  let rows: unknown[][];
  try {
    if (product === 'bond') {
      const issues = (await select<BondIssue>('v_bond_issues', { nh_lead: 'is.true', deal_dt: `gte.${w.since}`, order: 'deal_dt.desc', limit: 2000 }))
        .filter((i) => inW(i.deal_dt) && (cat === 'all' || i.sub_type === cat));
      header = ['납입일', '수요예측일', '발행사', '구분', '등급', '만기 구성', '최초 모집(억원)', '확정 발행(억원)', '전체 경쟁률(배)', '공동 대표주관', '공시'];
      rows = issues.map((i) => [
        i.deal_dt, i.pricing_dt ?? '', i.corp_name, i.sub_type ?? '', i.rating ?? '', i.tenor_combo, eok(i.initial_amount_krw), eok(i.amount_krw),
        i.competition_ratio ?? '', coLeads(i.lead_managers),
        i.latest_rcept_no ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${i.latest_rcept_no}` : '',
      ]);
    } else {
      const deals = (await select<Deal>('v_deals', { product_type: `eq.${product}`, nh_lead: 'is.true', deal_dt: `gte.${w.since}`, order: 'deal_dt.desc', limit: 2000 }))
        .filter((d) => inW(d.deal_dt) && d.status !== 'withdrawn');
      header = ['기준일', '발행사', '증권', '방식', '금액(억원)', '공동 대표주관', '공시'];
      rows = deals.map((d) => [
        d.deal_dt, d.corp_name, dealTitle(d), d.product_type === 'mezz' ? (d.is_public ? '공모' : '사모') : d.sub_type ?? '', eok(d.amount_krw),
        coLeads(d.lead_managers), d.dart_url ?? '',
      ]);
    }
  } catch {
    return new Response('조회 실패', { status: 502 });
  }
  const csv = `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
  const name = `NH_track_${product}_${m}m_${w.since}.csv`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(`NH 대표주관 ${LABEL[product]} ${m}개월.csv`)}`,
      'cache-control': 'private, max-age=300',
    },
  });
}

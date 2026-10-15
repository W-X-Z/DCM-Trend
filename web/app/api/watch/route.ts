import { NextResponse } from 'next/server';
import { select, inList } from '@/lib/db';
import { daysAgo, factLine, kstToday } from '@/lib/filings';
import { dealTitle } from '@/lib/labels';
import { getKeyFilings } from '@/lib/queries';
import { won } from '@/lib/format';
import type { Deal, Maturity } from '@/lib/types';

// 관심 회사 모아보기: 브라우저에 저장한 회사 목록(최대 150곳)의 최근 30일 공시·발행과 앞으로 90일 만기·풋옵션.
// 목록은 서버에 저장하지 않는다.
export const dynamic = 'force-dynamic';

export type WatchEvent = {
  when: 'recent' | 'upcoming'; dt: string; corp_code: string; corp_name: string;
  kind: string; title: string; detail: string | null; href: string; tone: 'alert' | null;
};

const addDays = (n: number) => {
  const d = new Date(`${kstToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get('c') ?? '').split(',').map((s) => s.trim());
  const corps = [...new Set(raw.filter((c) => /^\d{8}$/.test(c)))].slice(0, 150);
  if (!corps.length) return NextResponse.json({ events: [] });
  const since = daysAgo(30);
  try {
    const [filings, deals, upcoming] = await Promise.all([
      getKeyFilings({ since, corps }),
      select<Deal>('v_deals', { corp_code: inList(corps), deal_dt: `gte.${since}`, order: 'deal_dt.desc', limit: 300 }),
      select<Maturity>('v_maturities', {
        corp_code: inList(corps), and: `(event_dt.gte.${kstToday()},event_dt.lte.${addDays(90)})`, order: 'event_dt.asc', limit: 300,
      }),
    ]);
    const events: WatchEvent[] = [
      ...filings.map((f): WatchEvent => ({
        when: 'recent', dt: f.rcept_dt, corp_code: f.corp_code, corp_name: f.corp_name, kind: '공시', title: f.label,
        detail: factLine(f, 2).map((x) => `${x.k} ${x.v}`).join(', ') || null, href: f.dart_url,
        tone: f.grp === '신용·상장 위험' ? 'alert' : null,
      })),
      ...deals.filter((d) => d.status !== 'withdrawn').map((d): WatchEvent => ({
        when: 'recent', dt: d.deal_dt!, corp_code: d.corp_code, corp_name: d.corp_name, kind: '발행', title: dealTitle(d),
        detail: [won(d.amount_krw), d.lead_managers ? `대표주관 ${d.lead_managers}` : null].filter(Boolean).join(', '),
        href: d.dart_url ?? `/company/${d.corp_code}`, tone: d.is_undersubscribed ? 'alert' : null,
      })),
      ...upcoming.map((m): WatchEvent => ({
        when: 'upcoming', dt: m.event_dt, corp_code: m.corp_code, corp_name: m.corp_name,
        kind: m.event_type === '풋옵션' ? '풋옵션' : '만기',
        title: m.product_type === 'bond' ? `제${m.series}회 회사채 만기` : `${m.sub_type ?? '메자닌'} ${m.event_type === '풋옵션' ? '조기상환청구 시작' : '만기'}`,
        detail: [won(m.amount_krw), m.lead_managers ? `당시 대표주관 ${m.lead_managers}` : null].filter(Boolean).join(', '),
        href: `/company/${m.corp_code}`, tone: null,
      })),
    ];
    events.sort((a, b) => (a.when === b.when ? (a.when === 'upcoming' ? a.dt.localeCompare(b.dt) : b.dt.localeCompare(a.dt)) : a.when === 'recent' ? -1 : 1));
    return NextResponse.json({ events }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch {
    return NextResponse.json({ events: [], error: 'load' }, { status: 502 });
  }
}

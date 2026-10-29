// 홈 '영업 추천': 공모 회사채 만기도래 일정 + 과거 주관 이력으로 RM 이 먼저 연락할 회사를 고른다.
// 기준은 이 파일 맨 위 RECO 하나에서 바꾼다 (현업 의견 → 숫자만 수정).
import type { BondIssue, Maturity } from './types';

export const RECO = {
  windowDays: 183, // 오늘부터 이 기간 안의 공모 회사채 만기 (금융채 제외)
  historyYears: 7, // 주관 이력을 보는 기간
  pitchFrom: 45, // 제안 적기: 만기 전 45~150일 (이보다 가까우면 이미 주관사가 정해졌을 가능성이 큼)
  pitchTo: 150,
  w: { timing: 35, amount: 25, freq: 20, rel: 20 }, // 점수 가중치 (합 100)
  relValue: { keep: 1, win: 0.9, co: 0.6, new: 0.4 },
};

// keep: 직전 공모채를 NH 가 대표주관(방어) / win: 예전에 NH 대표주관, 직전은 타사(탈환)
// co: NH 는 인수단만(승격) / new: NH 이력 없음(신규)
export type RecoRel = 'keep' | 'win' | 'co' | 'new';

export const REL_META: Record<RecoRel, { label: string; desc: string }> = {
  keep: { label: '방어', desc: '직전 공모채를 NH가 대표주관' },
  win: { label: '탈환', desc: '예전에 NH가 대표주관, 직전 회차는 타사' },
  co: { label: '승격', desc: 'NH는 인수단으로만 참여' },
  new: { label: '신규', desc: 'NH 주관·인수 이력 없음' },
};

export type RecoItem = {
  corp_code: string; corp_name: string; market: string | null; rating: string | null;
  first_dt: string; days_left: number; amount_krw: number; tranches: Maturity[]; refi: boolean;
  issues: number; nh_lead_n: number; nh_co_n: number;
  last_dt: string | null; last_leads: string[]; top_leads: { firm: string; n: number }[];
  rel: RecoRel; score: number;
};

export type HistoryRow = Pick<BondIssue, 'corp_code' | 'deal_dt' | 'lead_managers' | 'nh_lead' | 'nh_involved'>;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const splitFirms = (s: string | null) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function timingFit(days: number) {
  if (days < 30) return 0.3;
  if (days < RECO.pitchFrom) return 0.7;
  if (days <= RECO.pitchTo) return 1;
  return 0.8;
}

// 100억 → 0, 5,000억 → 1 (로그)
export const amountFit = (krw: number) => Math.min(1, Math.max(0, Math.log10(Math.max(krw, 1e10) / 1e10) / Math.log10(50)));

export function buildReco(maturities: Maturity[], history: HistoryRow[], today: string): RecoItem[] {
  const byCorp = new Map<string, Maturity[]>();
  for (const m of maturities) {
    if (m.product_type !== 'bond' || m.event_type !== '만기' || m.sub_type === '금융채') continue;
    const d = dayDiff(m.event_dt, today);
    if (d < 0 || d >= RECO.windowDays) continue;
    byCorp.set(m.corp_code, [...(byCorp.get(m.corp_code) ?? []), m]);
  }

  const histBy = new Map<string, HistoryRow[]>();
  for (const h of history) {
    if (!h.deal_dt || h.deal_dt > today) continue;
    histBy.set(h.corp_code, [...(histBy.get(h.corp_code) ?? []), h]);
  }

  const out: RecoItem[] = [];
  for (const [corp, rows] of byCorp) {
    rows.sort((a, b) => a.event_dt.localeCompare(b.event_dt) || Number(b.amount_krw ?? 0) - Number(a.amount_krw ?? 0));
    const first = rows[0];
    const hist = (histBy.get(corp) ?? []).sort((a, b) => (b.deal_dt ?? '').localeCompare(a.deal_dt ?? ''));
    const last = hist[0];
    const nhLead = hist.filter((h) => h.nh_lead).length;
    const nhCo = hist.filter((h) => h.nh_involved && !h.nh_lead).length;
    const rel: RecoRel = last?.nh_lead ? 'keep' : nhLead > 0 ? 'win' : nhCo > 0 ? 'co' : 'new';

    const counts = new Map<string, { n: number; last: string }>();
    for (const h of hist) {
      for (const f of splitFirms(h.lead_managers)) {
        const c = counts.get(f) ?? { n: 0, last: '' };
        c.n += 1;
        if ((h.deal_dt ?? '') > c.last) c.last = h.deal_dt ?? '';
        counts.set(f, c);
      }
    }
    const top_leads = [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))
      .slice(0, 3)
      .map(([firm, c]) => ({ firm, n: c.n }));

    const amount = rows.reduce((s, r) => s + Number(r.amount_krw ?? 0), 0);
    const days = dayDiff(first.event_dt, today);
    const score = Math.round(
      RECO.w.timing * timingFit(days) +
        RECO.w.amount * amountFit(amount) +
        (RECO.w.freq * Math.min(hist.length, 6)) / 6 +
        RECO.w.rel * RECO.relValue[rel],
    );

    out.push({
      corp_code: corp, corp_name: first.corp_name, market: first.market,
      rating: rows.find((r) => r.rating)?.rating ?? null,
      first_dt: first.event_dt, days_left: days, amount_krw: amount, tranches: rows, refi: rows.some((r) => r.refi_signal),
      issues: hist.length, nh_lead_n: nhLead, nh_co_n: nhCo,
      last_dt: last?.deal_dt ?? null, last_leads: splitFirms(last?.lead_managers ?? null), top_leads,
      rel, score,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.first_dt.localeCompare(b.first_dt));
}

export const historySince = (today: string) => `${Number(today.slice(0, 4)) - RECO.historyYears}${today.slice(4)}`;
export const windowEnd = (today: string) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + RECO.windowDays);
  return d.toISOString().slice(0, 10);
};

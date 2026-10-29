// 홈 '영업 추천': 공모 회사채 만기도래 일정 + 과거 주관 이력으로 RM 이 먼저 연락할 회사를 고른다.
// 기준은 이 파일 맨 위 RECO 하나에서 바꾼다 (현업 의견 → 숫자만 수정).
import type { BondIssue, Maturity } from './types';

export const RECO = {
  windowDays: 183, // 오늘부터 이 기간 안의 공모 회사채 만기 (금융채 제외)
  historyYears: 7, // 주관 이력을 보는 기간
  pitchFrom: 45, // 제안 적기: 만기 전 45~150일 (이보다 가까우면 이미 주관사가 정해졌을 가능성이 큼)
  pitchTo: 150,
  w: { timing: 40, amount: 35, freq: 25 }, // 점수 가중치 (합 100): 만기 시기, 만기 금액, 공모채 발행 빈도
};

// 등급 묶음: 최근 공모채 등급 기준 (없으면 만기 회차 등급)
export const GRADES = [
  { key: 'AAA', label: 'AAA' },
  { key: 'AA', label: 'AA' },
  { key: 'A', label: 'A' },
  { key: 'BBB', label: 'BBB 이하' },
] as const;
export type Grade = (typeof GRADES)[number]['key'];

export function gradeOf(rating: string | null | undefined, group?: string | null): Grade | null {
  const g = (group ?? rating ?? '').trim().toUpperCase().replace(/[+\-0]$/, '');
  if (!g) return null;
  if (g === 'AAA' || g === 'AA' || g === 'A') return g;
  if (/^(BBB|BB|B|CCC|CC|C|D)$/.test(g)) return 'BBB';
  return null;
}

export type RecoItem = {
  corp_code: string; corp_name: string; market: string | null; rating: string | null; grade: Grade | null;
  first_dt: string; days_left: number; amount_krw: number; tranches: Maturity[]; refi: boolean;
  issues: number; nh_lead_n: number; nh_co_n: number;
  last_dt: string | null; last_leads: string[]; top_leads: { firm: string; n: number }[];
  score: number;
};

export type HistoryRow = Pick<BondIssue, 'corp_code' | 'deal_dt' | 'lead_managers' | 'nh_lead' | 'nh_involved' | 'rating' | 'rating_group'>;

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

    const rated = hist.find((h) => h.rating) ?? null;
    const matRated = rows.find((r) => r.rating) ?? null;
    const rating = rated?.rating ?? matRated?.rating ?? null;
    const grade = gradeOf(rating, rated ? rated.rating_group : matRated?.rating_group);

    const amount = rows.reduce((s, r) => s + Number(r.amount_krw ?? 0), 0);
    const days = dayDiff(first.event_dt, today);
    const score = Math.round(
      RECO.w.timing * timingFit(days) + RECO.w.amount * amountFit(amount) + (RECO.w.freq * Math.min(hist.length, 6)) / 6,
    );

    out.push({
      corp_code: corp, corp_name: first.corp_name, market: first.market, rating, grade,
      first_dt: first.event_dt, days_left: days, amount_krw: amount, tranches: rows, refi: rows.some((r) => r.refi_signal),
      issues: hist.length, nh_lead_n: hist.filter((h) => h.nh_lead).length, nh_co_n: hist.filter((h) => h.nh_involved && !h.nh_lead).length,
      last_dt: last?.deal_dt ?? null, last_leads: splitFirms(last?.lead_managers ?? null), top_leads,
      score,
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

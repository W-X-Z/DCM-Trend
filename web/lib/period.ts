// 발행 동향 기간 집계: 딜 행(mart.v_deals)에서 바로 계산한다.
// 월별 트렌드 뷰와 같은 규칙: 기준일 = deal_dt(회사채·IPO 납입일, 메자닌·유상증자 결정일), IPO 는 철회 제외.
// 1·3개월은 오늘 기준 날짜 구간·주별 막대, 6개월 이상은 달 단위 구간·월별 막대.
import type { ProductType } from './types';

export const PERIODS = ['1', '3', '6', '12', '24'] as const;
export type Period = (typeof PERIODS)[number];

export type TrendDeal = {
  deal_key: string; corp_code: string; corp_name: string; product_type: ProductType; sub_type: string | null;
  market: string | null; is_public: boolean | null; status: string; deal_dt: string;
  amount_krw: number | null; initial_amount_krw: number | null; is_increased: boolean | null;
  rating_group: string | null; tenor_months: number | null; yield_pct: number | null; coupon_pct: number | null;
  ytm_pct: number | null; competition_ratio: number | null; is_undersubscribed: boolean | null;
  refix_floor_ratio_pct: number | null; dilution_pct: number | null; underwriting_method: string | null;
  ipo_secondary_pct: number | null; ipo_has_putback: boolean | null; ipo_price_vs_band: string | null;
  fee_krw: number | null; uw_amount_krw: number | null; lead_managers: string | null; nh_lead: boolean | null;
};

export const TREND_DEAL_COLS =
  'deal_key,corp_code,corp_name,product_type,sub_type,market,is_public,status,deal_dt,amount_krw,initial_amount_krw,is_increased,rating_group,tenor_months,yield_pct,coupon_pct,ytm_pct,competition_ratio,is_undersubscribed,refix_floor_ratio_pct,dilution_pct,underwriting_method,ipo_secondary_pct,ipo_has_putback,ipo_price_vs_band,fee_krw,uw_amount_krw,lead_managers,nh_lead';

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Window = {
  period: Period; months: number; since: string; label: string; weekly: boolean; buckets: { key: string; label: string; start: string }[];
};

// 월요일 시작 주
function weekStart(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return iso(x);
}

export function makeWindow(period: Period, today = kstToday()): Window {
  const months = Number(period);
  const t = new Date(`${today}T00:00:00Z`);
  if (months <= 3) {
    const s = new Date(t);
    s.setUTCMonth(s.getUTCMonth() - months);
    s.setUTCDate(s.getUTCDate() + 1);
    const since = iso(s);
    const buckets: Window['buckets'] = [];
    for (let w = new Date(`${weekStart(since)}T00:00:00Z`); iso(w) <= today; w.setUTCDate(w.getUTCDate() + 7)) {
      const k = iso(w);
      buckets.push({ key: k, label: `${k.slice(5, 7)}.${k.slice(8, 10)}`, start: k });
    }
    return { period, months, since, label: `${since.slice(2).replaceAll('-', '.')}~${today.slice(5).replaceAll('-', '.')}`, weekly: true, buckets };
  }
  const buckets: Window['buckets'] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1));
    const k = iso(d);
    buckets.push({ key: k, label: `${k.slice(2, 4)}.${k.slice(5, 7)}`, start: k });
  }
  const since = buckets[0].key;
  return {
    period, months, since, weekly: false, buckets,
    label: `${since.slice(2, 4)}.${since.slice(5, 7)}~${buckets.at(-1)!.key.slice(2, 4)}.${buckets.at(-1)!.key.slice(5, 7)}`,
  };
}

export function bucketOf(w: Window, dt: string) {
  return w.weekly ? weekStart(dt) : `${dt.slice(0, 7)}-01`;
}

export type SeriesPoint = { key: string; label: string; amount: number; count: number };

export function series(w: Window, deals: TrendDeal[]): SeriesPoint[] {
  const map = new Map(w.buckets.map((b) => [b.key, { key: b.key, label: b.label, amount: 0, count: 0 }]));
  for (const d of deals) {
    const p = map.get(bucketOf(w, d.deal_dt));
    if (!p) continue;
    p.amount += Number(d.amount_krw ?? 0);
    p.count += 1;
  }
  return [...map.values()];
}

// 날짜 구간 안의 딜 (미래 납입 예정은 마지막 구간에 포함)
export function inWindow(w: Window, deals: TrendDeal[]) {
  const lastBucket = w.buckets.at(-1)!.key;
  return deals.filter((d) => d.deal_dt >= w.since && bucketOf(w, d.deal_dt) <= lastBucket);
}

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== null && x !== undefined).map(Number);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
const sumOf = (ds: TrendDeal[], f: (d: TrendDeal) => number | null | undefined) => ds.reduce((s, d) => s + Number(f(d) ?? 0), 0);

export function stats(product: ProductType, ds: TrendDeal[]) {
  const amount = sumOf(ds, (d) => d.amount_krw);
  const feeDeals = ds.filter((d) => d.fee_krw != null && d.uw_amount_krw);
  const feeBp = feeDeals.length ? (sumOf(feeDeals, (d) => d.fee_krw) / sumOf(feeDeals, (d) => d.uw_amount_krw)) * 1e4 : null;
  const base = { amount, count: ds.length, feeBp };
  if (product === 'bond') {
    const y = ds.filter((d) => d.yield_pct != null && d.amount_krw);
    const known = ds.filter((d) => d.competition_ratio != null);
    const initKnown = ds.filter((d) => d.initial_amount_krw != null);
    return {
      ...base,
      tenorYears: avg(ds.map((d) => d.tenor_months)) != null ? avg(ds.map((d) => d.tenor_months))! / 12 : null,
      competition: avg(known.map((d) => d.competition_ratio)),
      undersubShare: share(known.filter((d) => d.is_undersubscribed).length, known.length),
      increasedShare: share(initKnown.filter((d) => d.is_increased).length, initKnown.length),
      yieldW: y.length ? sumOf(y, (d) => Number(d.yield_pct) * Number(d.amount_krw)) / sumOf(y, (d) => d.amount_krw) : null,
      demandKnown: known.length,
    };
  }
  if (product === 'mezz') {
    const refix = ds.filter((d) => d.refix_floor_ratio_pct != null);
    const pubKnown = ds.filter((d) => d.is_public != null);
    return {
      ...base,
      zeroShare: share(ds.filter((d) => d.coupon_pct === 0 && d.ytm_pct === 0).length, ds.length),
      refixLowShare: share(refix.filter((d) => Number(d.refix_floor_ratio_pct) <= 70).length, refix.length),
      ytm: avg(ds.map((d) => d.ytm_pct)),
      publicShare: share(pubKnown.filter((d) => d.is_public).length, ds.length),
    };
  }
  if (product === 'equity') {
    const known = ds.filter((d) => d.underwriting_method != null);
    return {
      ...base,
      dilution: avg(ds.map((d) => d.dilution_pct)),
      firmShare: share(known.filter((d) => d.underwriting_method === '총액인수').length, known.length),
      methodKnown: known.length,
    };
  }
  const band = ds.filter((d) => d.ipo_price_vs_band != null);
  return {
    ...base,
    secondary: avg(ds.map((d) => d.ipo_secondary_pct)),
    putbackShare: share(ds.filter((d) => d.ipo_has_putback).length, ds.length),
    aboveBandShare: band.length ? share(band.filter((d) => d.ipo_price_vs_band === '상단 초과').length, band.length) : null,
  };
}

export type Slice = { key: string; count: number; amount: number };

export function breakdown(ds: TrendDeal[], keyOf: (d: TrendDeal) => string): Slice[] {
  const map = new Map<string, Slice>();
  for (const d of ds) {
    const k = keyOf(d);
    const s = map.get(k) ?? { key: k, count: 0, amount: 0 };
    s.count += 1;
    s.amount += Number(d.amount_krw ?? 0);
    map.set(k, s);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// 기간 대표주관 순위: 딜 금액을 공동 대표주관사 수로 나눠 더한다 (연도별 순위와 같은 규칙)
export type LeadRow = { firm: string; deals: number; credit: number; isNh: boolean };

export function leagueOf(ds: TrendDeal[], top = 10): LeadRow[] {
  const map = new Map<string, LeadRow>();
  for (const d of ds) {
    const firms = (d.lead_managers ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!firms.length) continue;
    for (const f of firms) {
      const r = map.get(f) ?? { firm: f, deals: 0, credit: 0, isNh: /NH투자/.test(f) };
      r.deals += 1;
      r.credit += Number(d.amount_krw ?? 0) / firms.length;
      map.set(f, r);
    }
  }
  return [...map.values()].sort((a, b) => b.credit - a.credit).slice(0, top);
}

// 분기별 인수수수료율 (인수대가 합 ÷ 인수금액 합)
export function feeByQuarter(ds: TrendDeal[]) {
  const map = new Map<string, { q: string; n: number; uw: number; fee: number }>();
  for (const d of ds) {
    if (d.fee_krw == null || !d.uw_amount_krw) continue;
    const m = Number(d.deal_dt.slice(5, 7));
    const k = `${d.deal_dt.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    const e = map.get(k) ?? { q: k, n: 0, uw: 0, fee: 0 };
    e.n += 1;
    e.uw += Number(d.uw_amount_krw);
    e.fee += Number(d.fee_krw);
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.q.localeCompare(b.q));
}

// 제안서 데이터 조립 (서버). 공개 공시·시장 데이터만 담는다. 회사별 제안 조건(금액·일정 등)은 받지 않는다.
import 'server-only';
import { select, selectAll } from '../db';
import { kstToday } from '../filings';
import { leagueOf, TREND_DEAL_COLS, type TrendDeal } from '../period';
import { getCompany, getMaturities, getRateLatest, getRates } from '../queries';
import { comboStats, median } from '../tranche';
import type { BondIssue, BondTranche } from '../types';
import type { Holiday, MarketEvent } from './schedule';
import type { DeckData, LeagueRow, PeerIssue } from './types';

const shiftMonths = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));

export const ratingGroupOf = (r: string | null | undefined) => {
  const m = String(r ?? '').match(/^(AAA|AA|A|BBB|BB|B)/);
  return m ? m[1] : null;
};

function toPeer(i: BondIssue): PeerIssue {
  const tr = (i.tranches ?? []) as BondTranche[];
  return {
    key: i.issue_key, corp_code: i.corp_code, corp_name: i.corp_name, sub_type: i.sub_type, series: i.base_series ?? null,
    rating: i.rating, rating_group: i.rating_group,
    demand_dt: i.demand_dt ?? null, pricing_dt: i.pricing_dt, deal_dt: i.deal_dt,
    tenor_combo: i.tenor_combo, initial_krw: n(i.initial_amount_krw), amount_krw: n(i.amount_krw), demand_krw: n(i.demand_krw),
    in_band_krw: n(i.demand_in_band_krw), ratio: n(i.competition_ratio), under: i.is_undersubscribed, increased: i.is_increased,
    band_type: i.band_type ?? null, band_low: n(i.band_low), band_high: n(i.band_high), fee_bp: n(i.fee_bp),
    lead: i.lead_managers, nh_lead: !!i.nh_lead,
    tranches: tr
      .slice()
      .sort((a, b) => (a.tenor_months ?? 0) - (b.tenor_months ?? 0))
      .map((t) => ({
        tenor: t.tenor_label ?? t.tenor_bucket, months: n(t.tenor_months), initial_krw: n(t.initial_amount_krw), amount_krw: n(t.amount_krw),
        demand_krw: n(t.demand_krw), in_band_krw: n(t.demand_in_band_krw), ratio: n(t.competition_ratio), under: t.is_undersubscribed ?? null,
        yield_pct: n(t.yield_pct ?? t.coupon_pct), spread_bp: n(t.final_spread_bp), band_type: t.band_type ?? null,
        band_low: n(t.band_low), band_high: n(t.band_high), maturity_dt: t.maturity_dt ?? null,
      })),
  };
}

function league(rows: { lead_managers: string | null; amount_krw: number | null }[], scope: string, since: string) {
  const all = leagueOf(rows as unknown as TrendDeal[], 999) as LeagueRow[];
  return { scope, since, rows: all.slice(0, 12), total: all.reduce((s, r) => s + r.credit, 0), deals: rows.filter((r) => r.lead_managers).length };
}

// 월말 값으로 줄인 금리 시계열 (그 달의 마지막 관측값)
function monthly(pts: { dt: string; value: number }[]) {
  const map = new Map<string, [string, number]>();
  for (const p of [...pts].sort((a, b) => a.dt.localeCompare(b.dt))) map.set(p.dt.slice(0, 7), [p.dt, Number(p.value)]);
  return [...map.values()];
}

export async function getDeckData(corp: string): Promise<DeckData | null> {
  const c = await getCompany(corp);
  if (!c) return null;
  const today = kstToday();
  const since12 = shiftMonths(today, -12);
  const ownRows = await select<BondIssue>('v_bond_issues', { corp_code: `eq.${corp}`, order: 'deal_dt.desc', limit: 12 });
  const last = ownRows[0];
  const rating = c.latest_bond_rating ?? last?.rating ?? null;
  const group = (last?.rating_group && last.rating_group !== '등급 미확인' ? last.rating_group : null) ?? ratingGroupOf(rating);

  const [peerRows, mats, latest, rateRows, fc, vw, ev, hol, tdeals] = await Promise.all([
    group
      ? select<BondIssue>('v_bond_issues', { rating_group: `eq.${group}`, deal_dt: `gte.${since12}`, order: 'deal_dt.desc', limit: 400 })
      : Promise.resolve([] as BondIssue[]),
    getMaturities({ from: today, to: shiftMonths(today, 36), corp, product: 'bond', eventType: '만기' }).catch(() => []),
    getRateLatest().catch(() => []),
    getRates(shiftMonths(today, -12), ['ktb3y', 'ktb10y', 'corp3y_aa', 'cd91']).catch(() => []),
    select<{ house: string; published_dt: string; source_title: string; source_url: string; series_key: string; series_label: string; period: string; period_order: number; basis: string; is_actual: boolean; value_pct: number }>(
      'v_research_forecasts', { order: 'published_dt.desc,series_key.asc,period_order.asc', limit: 200 },
    ).catch(() => []),
    select<{ house: string; analysts: string | null; published_dt: string; source_kind: string; source_title: string; source_url: string; stance: string | null; next_move: string | null; terminal_rate_pct: number | null; summary: string }>(
      'v_research_views', { limit: 40 },
    ).catch(() => []),
    select<MarketEvent>('v_market_events', { event_dt: `gte.${shiftMonths(today, -2)}`, order: 'event_dt.asc', limit: 200 }).catch(() => []),
    select<Holiday>('v_kr_holidays', { order: 'dt.asc', limit: 400 }).catch(() => []),
    selectAll<TrendDeal>('v_deals', { select: TREND_DEAL_COLS, product_type: 'eq.bond', deal_dt: `gte.${since12}`, sub_type: 'eq.일반회사채', order: 'deal_dt.asc' }).catch(() => [] as TrendDeal[]),
  ]);

  const peers = peerRows.map(toPeer);
  const recent6 = peerRows.filter((p) => (p.deal_dt ?? '') >= shiftMonths(today, -6) && (p.sub_type ?? '일반회사채') === '일반회사채');

  // 전망표: 가장 최근 발표 하나
  const fcHouse = fc[0];
  const fcRows = fcHouse ? fc.filter((r) => r.house === fcHouse.house && r.published_dt === fcHouse.published_dt) : [];
  const keys = [...new Set(fcRows.map((r) => r.series_key))];
  const order = ['base_rate', 'ktb3y', 'ktb10y'];
  keys.sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);

  const label: Record<string, string> = Object.fromEntries(latest.map((r) => [r.series_key, r.label_ko]));
  const bySeries = new Map<string, { dt: string; value: number }[]>();
  for (const r of rateRows) bySeries.set(r.series_key, [...(bySeries.get(r.series_key) ?? []), r]);

  return {
    asof: today,
    company: {
      corp_code: c.corp_code, corp_name: c.corp_name, market: c.market, rating, rating_group: group,
      outstanding_bond_krw: n(c.outstanding_bond_krw), last_series: last?.base_series ?? null, bond_count: c.bond_deal_count,
    },
    own: ownRows.map(toPeer),
    peers,
    maturities: mats.map((m) => ({ dt: m.event_dt, series: m.series, amount_krw: n(m.amount_krw), coupon_pct: n(m.coupon_pct), months: n(m.tenor_months), lead: m.lead_managers })),
    league: league(peerRows.filter((p) => (p.sub_type ?? '일반회사채') === '일반회사채'), group ? `${group}급 일반 공모 회사채` : '공모 회사채', since12),
    leagueAll: league(tdeals, '일반 공모 회사채', since12),
    combos: comboStats(recent6, 5).map((r) => ({ combo: r.combo, issues: r.issues, share: r.share, medComp: r.medComp, incShare: r.incShare, avgAmount: r.avgAmount })),
    rates: latest
      .filter((r) => ['base_rate', 'cd91', 'ktb3y', 'ktb5y', 'ktb10y', 'corp3y_aa', 'corp3y_bbb'].includes(r.series_key))
      .map((r) => ({ key: r.series_key, label: r.label_ko, value: Number(r.value), dt: r.dt, chg1m: n(r.chg_1m_bp), chg3m: n(r.chg_3m_bp), chg1y: n(r.chg_1y_bp), source: r.source })),
    // 차트에는 6개월 이상 값이 있는 시계열만 쓴다
    series: ['ktb3y', 'ktb10y', 'corp3y_aa', 'cd91']
      .map((k) => ({ key: k, label: label[k] ?? k, pts: monthly(bySeries.get(k) ?? []) }))
      .filter((x) => x.pts.length >= 6),
    forecast: fcHouse
      ? {
        house: fcHouse.house, published_dt: fcHouse.published_dt, title: fcHouse.source_title, url: fcHouse.source_url,
        rows: keys.map((k) => {
          const rs = fcRows.filter((r) => r.series_key === k).sort((a, b) => a.period_order - b.period_order);
          return { key: k, label: rs[0].series_label, basis: rs[0].basis, cells: rs.map((r) => ({ period: r.period, value: Number(r.value_pct), actual: r.is_actual })) };
        }),
      }
      : null,
    views: vw.map((v) => ({
      house: v.house, analysts: v.analysts, published_dt: v.published_dt, kind: v.source_kind, title: v.source_title, url: v.source_url,
      stance: v.stance, next_move: v.next_move, terminal: n(v.terminal_rate_pct), summary: v.summary,
    })),
    events: ev,
    holidays: hol,
    fee: { last_bp: n(last?.fee_bp), group_median_bp: median(recent6.map((p) => n(p.fee_bp))) },
  };
}

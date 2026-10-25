// 제안서 데이터 조립 (서버). 공개 공시·시장 데이터만 담는다. 회사별 제안 조건(금액·일정 등)은 받지 않는다.
import 'server-only';
import { select, selectAll } from '../db';
import { kstToday } from '../filings';
import { leagueOf, TREND_DEAL_COLS, type TrendDeal } from '../period';
import { getCompany, getMaturities, getRateLatest, getRates } from '../queries';
import { comboStats, median } from '../tranche';
import type { BondIssue, BondTranche } from '../types';
import type { Holiday, MarketEvent } from './schedule';
import type { DeckData, DemandType, LeagueRow, MeetingPanel, PeerIssue } from './types';

const shiftMonths = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const n = (v: unknown) => (v == null || v === '' ? null : Number(v));

const NOTE_ORDER = ['미국 기준금리', '한국 기준금리', '국고채', '우량 회사채', '비우량 회사채'];

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
        byType: Array.isArray(t.demand_by_type) && t.demand_by_type.length
          ? t.demand_by_type.map((x) => ({ t: x.t as DemandType['t'], n: Number(x.n ?? 0), q: Number(x.q ?? 0) }))
          : null,
      })),
    amount_max_krw: n(i.amount_max_krw),
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

  const [peerRows, mats, latest, rateRows, fc, vw, ev, hol, tdeals, pipeRows, lyRows, gradeMats, pol, dailyRows, polHist, notes] = await Promise.all([
    group
      ? select<BondIssue>('v_bond_issues', { rating_group: `eq.${group}`, deal_dt: `gte.${since12}`, order: 'deal_dt.desc', limit: 400 })
      : Promise.resolve([] as BondIssue[]),
    // 5년물 제안 만기 연도까지 보려고 64개월을 받는다. 장표·문안의 '향후 3년'은 36개월로 자른다.
    getMaturities({ from: today, to: shiftMonths(today, 64), corp, product: 'bond', eventType: '만기' }).catch(() => []),
    getRateLatest().catch(() => []),
    getRates(shiftMonths(today, -12), ['ktb3y', 'ktb10y', 'corp3y_aa', 'corp3y_bbb', 'cd91']).catch(() => []),
    select<{ house: string; published_dt: string; source_title: string; source_url: string; series_key: string; series_label: string; period: string; period_order: number; basis: string; is_actual: boolean; value_pct: number }>(
      'v_research_forecasts', { order: 'published_dt.desc,series_key.asc,period_order.asc', limit: 200 },
    ).catch(() => []),
    select<{ house: string; analysts: string | null; published_dt: string; source_kind: string; source_title: string; source_url: string; stance: string | null; next_move: string | null; terminal_rate_pct: number | null; summary: string; region?: string | null; end_2026_pct?: number | null; end_2027_pct?: number | null }>(
      'v_research_views', { limit: 40 },
    ).catch(() => []),
    select<MarketEvent>('v_market_events', { event_dt: `gte.${shiftMonths(today, -12)}`, order: 'event_dt.asc', limit: 200 }).catch(() => []),
    select<Holiday>('v_kr_holidays', { order: 'dt.asc', limit: 400 }).catch(() => []),
    selectAll<TrendDeal>('v_deals', { select: TREND_DEAL_COLS, product_type: 'eq.bond', deal_dt: `gte.${since12}`, sub_type: 'eq.일반회사채', order: 'deal_dt.asc' }).catch(() => [] as TrendDeal[]),
    // 수요예측 예정·진행: 증권신고서는 냈고 납입 전인 발행
    select<BondIssue>('v_bond_issues', { deal_dt: `gte.${today}`, order: 'demand_dt.asc.nullslast,deal_dt.asc', limit: 60 }).catch(() => [] as BondIssue[]),
    select<{ year: number; firm: string; is_nh: boolean; lead_deals: number; lead_credit_krw: number | null; uw_amount_krw: number | null; lead_rank: number | null; uw_rank: number | null }>(
      'v_league_table_yearly', { product_type: 'eq.bond', year: `gte.${Number(today.slice(0, 4)) - 5}`, order: 'year.desc,lead_rank.asc', limit: 600 },
    ).catch(() => []),
    selectAll<{ event_dt: string; amount_krw: number | null; rating: string | null; rating_group: string | null; sub_type: string | null }>('v_maturities', {
      select: 'event_dt,amount_krw,rating,rating_group,sub_type', product_type: 'eq.bond', event_type: 'eq.만기',
      and: `(event_dt.gte.${today.slice(0, 7)}-01,event_dt.lt.${shiftMonths(`${today.slice(0, 7)}-01`, 12)})`,
    }).catch(() => []),
    select<{ kind: '금통위' | 'FOMC'; meeting_dt: string; title: string; decision: string; vote: string | null; points: { label: string; text: string }[]; sources: { title: string; url: string; date: string | null }[]; panels?: MeetingPanel[] | null }>(
      'v_policy_meetings', { order: 'meeting_dt.desc', limit: 10 },
    ).catch(() => []),
    // 일별 금리: 최근 3년 (차트는 2년, 국고 대비 스프레드 계산은 회사 발행일까지)
    getRates(shiftMonths(today, -36), ['ktb2y', 'ktb3y', 'ktb5y', 'corp3y_aa', 'corp3y_bbb']).catch(() => []),
    select<{ country: 'KR' | 'US'; effective_dt: string; rate_low: number; rate_high: number }>('v_policy_rate_history', { order: 'effective_dt.asc', limit: 200 }).catch(() => []),
    select<{ house: string; topic: string; text: string; published_dt: string; source_title: string; source_url: string }>('v_research_notes', { order: 'published_dt.desc', limit: 40 }).catch(() => []),
  ]);

  const peers = peerRows.map(toPeer);
  const recent6 = peerRows.filter((p) => (p.deal_dt ?? '') >= shiftMonths(today, -6) && (p.sub_type ?? '일반회사채') === '일반회사채');

  // 전망표: 가장 최근 발표 하나
  const fcHouse = fc[0];
  const fcRows = fcHouse ? fc.filter((r) => r.house === fcHouse.house && r.published_dt === fcHouse.published_dt) : [];
  const keys = [...new Set(fcRows.map((r) => r.series_key))];
  const order = ['base_rate', 'ktb3y', 'ktb10y', 'us_policy', 'ust10y'];
  keys.sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);

  // 연간 리그테이블: 상위 5 + NH
  const years = [...new Set(lyRows.map((r) => r.year))].sort((a, b) => b - a).slice(0, 6).sort((a, b) => a - b);
  const leagueYearly = years.map((y) => {
    const rs = lyRows.filter((r) => r.year === y);
    const totalLead = rs.reduce((t, r) => t + Number(r.lead_credit_krw ?? 0), 0);
    const totalUw = rs.reduce((t, r) => t + Number(r.uw_amount_krw ?? 0), 0);
    const pick = (rankKey: 'lead_rank' | 'uw_rank', amt: 'lead_credit_krw' | 'uw_amount_krw', total: number) => {
      const sorted = rs.filter((r) => r[rankKey] != null).sort((a, b) => Number(a[rankKey]) - Number(b[rankKey]));
      const top = sorted.slice(0, 5);
      const nh = sorted.find((r) => r.is_nh);
      if (nh && !top.includes(nh)) top.push(nh);
      return top.map((r) => ({ rank: Number(r[rankKey]), firm: r.firm, krw: Number(r[amt] ?? 0), share: total ? (Number(r[amt] ?? 0) / total) * 100 : 0, isNh: r.is_nh }));
    };
    return { year: y, ytd: y === Number(today.slice(0, 4)), total_lead: totalLead, total_uw: totalUw, lead: pick('lead_rank', 'lead_credit_krw', totalLead), uw: pick('uw_rank', 'uw_amount_krw', totalUw) };
  });

  // 등급별 월별 만기도래 (일반 공모 회사채, 이번 달부터 12개월)
  const m0 = `${today.slice(0, 7)}-01`;
  const mlist = Array.from({ length: 12 }, (_, i) => shiftMonths(m0, i).slice(0, 7));
  const gradeOf = (g: string | null) => (g === 'AAA' || g === 'AA' || g === 'A' ? g : g === 'BBB' || g === 'BB' || g === 'B' ? 'BBB 이하' : '등급 미확인');
  const grades = ['AAA', 'AA', 'A', 'BBB 이하', '등급 미확인'];
  const NOTCH: Record<string, string[]> = { AA: ['AA+', 'AA0', 'AA-'], A: ['A+', 'A0', 'A-'] };
  const notchOf = (r: string | null) => {
    const m = String(r ?? '').match(/^(AA|A)([+0-])?(?![A-Z])/);
    return m ? `${m[1]}${m[2] ?? '0'}` : null;
  };
  const gm = gradeMats.filter((m) => (m.sub_type ?? '일반회사채') === '일반회사채');
  const sumBy = (f: (m: (typeof gm)[number]) => boolean) => {
    const values = mlist.map((mm) => gm.filter((m) => f(m) && m.event_dt.slice(0, 7) === mm).reduce((t, m) => t + Number(m.amount_krw ?? 0), 0));
    return { values, total: values.reduce((a, b) => a + b, 0) };
  };
  const mrows: { grade: string; notch: string | null; values: number[]; total: number }[] = [];
  for (const g of grades) {
    const row = { grade: g, notch: null, ...sumBy((m) => gradeOf(m.rating_group) === g) };
    if (!row.total && g === '등급 미확인') continue;
    mrows.push(row);
    for (const nt of NOTCH[g] ?? []) mrows.push({ grade: g, notch: nt, ...sumBy((m) => gradeOf(m.rating_group) === g && notchOf(m.rating) === nt) });
  }
  const top = mrows.filter((r) => !r.notch);
  const maturityByGrade = { months: mlist, rows: mrows, total: mlist.map((_, i) => top.reduce((t, r) => t + r.values[i], 0)), asof: today };

  // 일별 금리 (최근 2년만 차트에)
  const dailyBy = new Map<string, [string, number][]>();
  for (const r of dailyRows) dailyBy.set(r.series_key, [...(dailyBy.get(r.series_key) ?? []), [r.dt, Number(r.value)]]);

  const kr = vw.filter((v) => ((v as { region?: string | null }).region ?? 'KR') !== 'US');
  const us = vw.filter((v) => (v as { region?: string | null }).region === 'US') as unknown as (typeof vw[number] & { end_2026_pct?: number | null; end_2027_pct?: number | null })[];

  const label: Record<string, string> = Object.fromEntries(latest.map((r) => [r.series_key, r.label_ko]));
  const bySeries = new Map<string, { dt: string; value: number }[]>();
  for (const r of rateRows) bySeries.set(r.series_key, [...(bySeries.get(r.series_key) ?? []), r]);

  const matRows = mats.map((m) => ({ dt: m.event_dt, series: m.series, amount_krw: n(m.amount_krw), coupon_pct: n(m.coupon_pct), months: n(m.tenor_months), lead: m.lead_managers }));
  return {
    asof: today,
    company: {
      corp_code: c.corp_code, corp_name: c.corp_name, market: c.market, rating, rating_group: group,
      outstanding_bond_krw: n(c.outstanding_bond_krw), last_series: last?.base_series ?? null, bond_count: c.bond_deal_count,
    },
    // 수요예측 결과가 없는 회차(수요예측 없이 발행한 리테일·외화 등, 원문 미수집)는 비교 근거가 없어 뺀다
    own: ownRows.map(toPeer).filter((p) => p.demand_krw != null || p.ratio != null || p.tranches.some((t) => t.demand_krw != null)),
    peers,
    maturities: matRows.filter((m) => m.dt <= shiftMonths(today, 36)),
    maturitiesLong: { to: shiftMonths(today, 64), rows: matRows },
    league: league(peerRows.filter((p) => (p.sub_type ?? '일반회사채') === '일반회사채'), group ? `${group}급 일반 공모 회사채` : '공모 회사채', since12),
    leagueAll: league(tdeals, '일반 공모 회사채', since12),
    combos: comboStats(recent6, 5).map((r) => ({ combo: r.combo, issues: r.issues, share: r.share, medComp: r.medComp, incShare: r.incShare, avgAmount: r.avgAmount })),
    rates: latest
      .filter((r) => ['base_rate', 'cd91', 'ktb2y', 'ktb3y', 'ktb5y', 'ktb10y', 'corp3y_aa', 'corp3y_bbb'].includes(r.series_key))
      .map((r) => ({ key: r.series_key, label: r.label_ko, value: Number(r.value), dt: r.dt, chg1m: n(r.chg_1m_bp), chg3m: n(r.chg_3m_bp), chg1y: n(r.chg_1y_bp), source: r.source })),
    // 차트에는 6개월 이상 값이 있는 시계열만 쓴다
    series: ['ktb3y', 'ktb10y', 'corp3y_aa', 'corp3y_bbb', 'cd91']
      .map((k) => ({ key: k, label: label[k] ?? k, pts: monthly(bySeries.get(k) ?? []) }))
      .filter((x) => x.pts.length >= 6),
    forecast: fcHouse
      ? {
        house: fcHouse.house, published_dt: fcHouse.published_dt, title: fcHouse.source_title, url: fcHouse.source_url,
        rows: keys.map((k) => {
          const rs = fcRows.filter((r) => r.series_key === k).sort((a, b) => a.period_order - b.period_order);
          return { key: k, label: rs[0].series_label, basis: rs[0].basis, cells: rs.map((r) => ({ period: r.period, value: Number(r.value_pct), actual: r.is_actual })) };
        }),
        // 주제별 가장 최근 의견 하나
        notes: [...new Map(notes.filter((x) => x.house === fcHouse.house).map((x) => [x.topic, x] as const).reverse()).values()]
          .sort((a, b) => NOTE_ORDER.indexOf(a.topic) - NOTE_ORDER.indexOf(b.topic))
          .map((x) => ({ topic: x.topic, text: x.text, date: x.published_dt, title: x.source_title, url: x.source_url })),
      }
      : null,
    views: kr.map((v) => ({
      house: v.house, analysts: v.analysts, published_dt: v.published_dt, kind: v.source_kind, title: v.source_title, url: v.source_url,
      stance: v.stance, next_move: v.next_move, terminal: n(v.terminal_rate_pct), summary: v.summary,
    })),
    events: ev,
    holidays: hol,
    fee: { last_bp: n(last?.fee_bp), group_median_bp: median(recent6.map((p) => n(p.fee_bp))) },
    pipeline: pipeRows.filter((p) => p.corp_code !== corp).map((p) => ({
      amount_max_krw: n(p.amount_max_krw),
      key: p.issue_key, corp_name: p.corp_name, sub_type: p.sub_type, rating: p.rating, demand_dt: p.demand_dt ?? null, pay_dt: p.deal_dt,
      band_type: p.band_type ?? null, band_low: n(p.band_low), band_high: n(p.band_high), lead: p.lead_managers, nh_lead: !!p.nh_lead,
      tranches: ((p.tranches ?? []) as BondTranche[]).slice().sort((a, b) => (a.tenor_months ?? 0) - (b.tenor_months ?? 0))
        .map((t) => ({
          tenor: t.tenor_label ?? t.tenor_bucket, months: n(t.tenor_months), initial_krw: n(t.initial_amount_krw ?? t.amount_krw),
          band_type: t.band_type ?? p.band_type ?? null, band_low: n(t.band_low ?? p.band_low), band_high: n(t.band_high ?? p.band_high),
        })),
    })),
    leagueYearly,
    maturityByGrade,
    policy: {
      bok: (() => { const m = pol.find((x) => x.kind === '금통위'); return m ? { ...m, panels: m.panels ?? [] } : null; })(),
      fomc: (() => { const m = pol.find((x) => x.kind === 'FOMC'); return m ? { ...m, panels: m.panels ?? [] } : null; })(),
    },
    daily: ['ktb2y', 'ktb3y', 'ktb5y', 'corp3y_aa', 'corp3y_bbb'].map((k) => ({ key: k, label: label[k] ?? k, pts: (dailyBy.get(k) ?? []).sort((a, b) => a[0].localeCompare(b[0])) })),
    policyHistory: {
      kr: polHist.filter((x) => x.country === 'KR').map((x) => ({ dt: x.effective_dt, rate: Number(x.rate_high ?? x.rate_low) })),
      us: polHist.filter((x) => x.country === 'US').map((x) => ({ dt: x.effective_dt, low: Number(x.rate_low), high: Number(x.rate_high) })),
    },
    usViews: us.map((v) => ({
      house: v.house, analysts: v.analysts, published_dt: v.published_dt, title: v.source_title, url: v.source_url,
      next_move: v.next_move, terminal: n(v.terminal_rate_pct), end2026: n(v.end_2026_pct), end2027: n(v.end_2027_pct), summary: v.summary,
    })),
  };
}

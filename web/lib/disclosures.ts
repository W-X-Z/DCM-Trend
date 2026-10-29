// 주요공시(사업 확장 포함): 공시 단위 자료를 회사 단위 목록으로 묶는다. 화면 필터·정렬도 여기서.
import { FILING_GROUPS, daysAgo, factLine, isIssuer } from './filings';
import type { ExpansionCat, ExpansionCompany, ExpansionEvent, KeyFiling } from './types';
import type { FundingDeal } from './queries';

export const DISC_TYPES = [
  { key: 'exp', label: '사업 확장', hint: '신규시설투자·유형자산·지분·영업 양수 가운데 사업 확장 결정 (임대·투자 목적, 지분 30% 미만, 계열사 정리, 금융사 제외)' },
  ...FILING_GROUPS.map((g) => ({ key: g.key, label: g.grp, hint: g.hint })),
] as const;
export type DiscType = (typeof DISC_TYPES)[number]['key'];

export const DISC_PERIODS = [
  { key: '7', label: '1주', days: 7 },
  { key: '30', label: '1개월', days: 30 },
  { key: '90', label: '3개월', days: 90 },
  { key: '365', label: '1년', days: 365, expOnly: true },
] as const;

export const DISC_MARKETS = [
  { key: 'all', label: '전체' }, { key: 'kospi', label: '유가증권' }, { key: 'kosdaq', label: '코스닥' }, { key: 'etc', label: '코넥스·비상장' },
] as const;
export const DISC_AMOUNTS = [
  { key: '0', label: '전체', v: 0 }, { key: '100', label: '100억 이상', v: 1e10 }, { key: '500', label: '500억 이상', v: 5e10 }, { key: '1000', label: '1,000억 이상', v: 1e11 },
] as const;
export const DISC_SORTS = [
  { key: 'recent', label: '최근순' }, { key: 'amount', label: '금액순' }, { key: 'ratio', label: '규모 비율순' },
] as const;

export const EXP_CAT_META: Record<ExpansionCat, { short: string; cls: string }> = {
  '생산·설비 증설': { short: '생산·설비', cls: 'xc-cap' },
  '부지·사업장 확보': { short: '부지·사업장', cls: 'xc-site' },
  '인수·신사업': { short: '인수·신사업', cls: 'xc-mna' },
  '연구·업무시설': { short: '연구·업무시설', cls: 'xc-rnd' },
};

export type DiscParams = { p?: string; t?: string; s?: string; m?: string; a?: string; gap?: string; issuer?: string; nh?: string };
export type DiscFilter = {
  period: (typeof DISC_PERIODS)[number]; type: DiscType | null; sort: string; market: string;
  amount: (typeof DISC_AMOUNTS)[number]; gap: boolean; issuer: boolean; nh: boolean;
};

export function parseDisc(sp: DiscParams): DiscFilter {
  const type = (DISC_TYPES.find((t) => t.key === sp.t)?.key ?? null) as DiscType | null;
  let period = DISC_PERIODS.find((p) => p.key === sp.p) ?? DISC_PERIODS[1];
  if ('expOnly' in period && type !== 'exp') period = DISC_PERIODS[2];
  return {
    period, type,
    sort: DISC_SORTS.find((s) => s.key === sp.s)?.key ?? 'recent',
    market: DISC_MARKETS.find((m) => m.key === sp.m)?.key ?? 'all',
    amount: DISC_AMOUNTS.find((a) => a.key === sp.a) ?? DISC_AMOUNTS[0],
    gap: sp.gap === '1', issuer: sp.issuer === '1', nh: sp.nh === '1',
  };
}

export function discHref(f: DiscFilter, patch: DiscParams = {}) {
  const m: DiscParams = {
    p: f.period.key, t: f.type ?? undefined, s: f.sort, m: f.market, a: f.amount.key,
    gap: f.gap ? '1' : undefined, issuer: f.issuer ? '1' : undefined, nh: f.nh ? '1' : undefined, ...patch,
  };
  const q = new URLSearchParams();
  if (m.p && m.p !== '30') q.set('p', m.p);
  if (m.t) q.set('t', m.t);
  if (m.s && m.s !== 'recent') q.set('s', m.s);
  if (m.m && m.m !== 'all') q.set('m', m.m);
  if (m.a && m.a !== '0') q.set('a', m.a);
  if (m.gap === '1') q.set('gap', '1');
  if (m.issuer === '1') q.set('issuer', '1');
  if (m.nh === '1') q.set('nh', '1');
  const s = q.toString();
  return `/filings${s ? `?${s}` : ''}`;
}

// 필터 아이콘 안에 넣은 조건 수 (기간·유형·정렬 제외)
export const hiddenFilterCount = (f: DiscFilter) =>
  (f.market !== 'all' ? 1 : 0) + (f.amount.v ? 1 : 0) + (f.gap ? 1 : 0) + (f.issuer ? 1 : 0) + (f.nh ? 1 : 0);

export type DiscEvent = {
  id: string; dt: string; type: DiscType; tag: string; cls: string;
  amount: number | null; ratio: number | null; ratioBasis: string | null;
  what: string; sub: string | null; url: string; amend: boolean; src: string;
};

export type DiscRow = {
  corp_code: string; corp_name: string; market: string | null; rating: string | null;
  evs: DiscEvent[]; types: DiscType[]; last_dt: string; top: DiscEvent; maxRatio: DiscEvent | null;
  funding: FundingDeal[]; noFundingAfter: boolean; nh: boolean; issuer: boolean;
};

const pctNum = (s: string | undefined) => {
  const m = s?.match(/-?[\d,]+(\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, '')) : null;
};

function fromExpansion(e: ExpansionEvent): DiscEvent {
  const meta = EXP_CAT_META[e.cat];
  return {
    id: e.rcept_no, dt: e.rcept_dt, type: 'exp', tag: meta.short, cls: meta.cls,
    amount: e.amount_krw == null ? null : Number(e.amount_krw),
    ratio: e.ratio_pct == null ? null : Number(e.ratio_pct), ratioBasis: e.ratio_basis,
    what: e.purpose ?? e.target ?? e.src_label,
    sub: [e.target && e.purpose ? e.target : null, e.detail, e.stake_after_pct != null ? `인수 후 지분 ${Number(e.stake_after_pct).toFixed(1)}%` : null, e.funding_note]
      .filter(Boolean)
      .join(' · ') || null,
    url: e.dart_url, amend: e.is_amendment, src: `${e.src_label}${e.via_sub ? '(자회사)' : ''}`,
  };
}

function fromFiling(f: KeyFiling): DiscEvent {
  const g = FILING_GROUPS.find((x) => x.grp === f.grp)?.key ?? 'asset';
  const facts = factLine(f, 3).filter((x) => x.k !== '자기자본 대비');
  return {
    id: f.rcept_no, dt: f.rcept_dt, type: g, tag: f.label, cls: `g-${g}`,
    amount: f.size_krw == null ? null : Number(f.size_krw),
    ratio: pctNum(f.facts?.['자기자본 대비']), ratioBasis: f.facts?.['자기자본 대비'] ? '자기자본' : null,
    what: facts.length ? facts.map((x) => `${x.k} ${x.v}`).join(' · ') : f.report_nm,
    sub: null, url: f.dart_url, amend: false, src: f.report_nm,
  };
}

const marketKey = (m: string | null) => (m === '유가증권' ? 'kospi' : m === '코스닥' ? 'kosdaq' : 'etc');

export function buildDisc(
  input: { filings: KeyFiling[]; expEvents: ExpansionEvent[]; expCos: ExpansionCompany[]; funding: FundingDeal[]; nhCorps: string[] },
  f: DiscFilter,
  today: string,
) {
  const since = daysAgo(f.period.days, today);
  const fundSince = daysAgo(365, today);
  const expIds = new Set(input.expEvents.map((e) => e.rcept_no));
  const expCo = new Map(input.expCos.map((c) => [c.corp_code, c]));
  const nh = new Set(input.nhCorps);
  const fundBy = new Map<string, FundingDeal[]>();
  // 같은 날 같은 종류(회사채 트랜치 등)는 한 건으로 합친다
  for (const d of input.funding) {
    if (!d.deal_dt || d.deal_dt < fundSince) continue;
    const list = fundBy.get(d.corp_code) ?? [];
    const kind = d.product_type === 'mezz' ? d.sub_type ?? d.product_label : d.product_label;
    const same = list.find((x) => x.deal_dt === d.deal_dt && (x.product_type === 'mezz' ? x.sub_type ?? x.product_label : x.product_label) === kind);
    if (same) same.amount_krw = Number(same.amount_krw ?? 0) + Number(d.amount_krw ?? 0);
    else list.push({ ...d });
    fundBy.set(d.corp_code, list);
  }

  type Acc = { corp_code: string; corp_name: string; market: string | null; rating: string | null; issuer: boolean; evs: DiscEvent[] };
  const acc = new Map<string, Acc>();
  const get = (code: string, name: string, market: string | null) => {
    const a = acc.get(code) ?? { corp_code: code, corp_name: name, market, rating: null, issuer: false, evs: [] };
    acc.set(code, a);
    return a;
  };
  for (const e of input.expEvents) {
    if (e.rcept_dt < since) continue;
    const a = get(e.corp_code, e.corp_name, e.market);
    const c = expCo.get(e.corp_code);
    a.rating ??= c?.latest_bond_rating ?? null;
    a.issuer ||= Boolean(c?.latest_bond_rating || Number(c?.outstanding_bond_krw ?? 0) > 0);
    a.evs.push(fromExpansion(e));
  }
  if (f.period.days <= 120) {
    for (const k of input.filings) {
      if (k.rcept_dt < since || expIds.has(k.rcept_no)) continue;
      const a = get(k.corp_code, k.corp_name, k.market);
      a.rating ??= k.latest_bond_rating;
      a.issuer ||= isIssuer(k);
      a.evs.push(fromFiling(k));
    }
  }

  // 유형 칩 숫자는 아이콘 안 필터까지 반영하고, 유형 선택 전 기준으로 센다
  const all: DiscRow[] = [];
  for (const a of acc.values()) {
    const evs = a.evs.sort((x, y) => y.dt.localeCompare(x.dt) || Number(y.amount ?? -1) - Number(x.amount ?? -1));
    const funding = (fundBy.get(a.corp_code) ?? []).sort((x, y) => (y.deal_dt ?? '').localeCompare(x.deal_dt ?? ''));
    const firstDt = evs[evs.length - 1].dt;
    all.push({
      corp_code: a.corp_code, corp_name: a.corp_name, market: a.market, rating: a.rating,
      evs, types: [...new Set(evs.map((e) => e.type))], last_dt: evs[0].dt,
      top: evs.reduce((m, e) => (Number(e.amount ?? -1) > Number(m.amount ?? -1) ? e : m), evs[0]),
      maxRatio: evs.reduce<DiscEvent | null>((m, e) => (e.ratio != null && (m == null || e.ratio > (m.ratio ?? -1)) ? e : m), null),
      funding, noFundingAfter: !funding.some((d) => (d.deal_dt ?? '') >= firstDt),
      nh: nh.has(a.corp_code) || Boolean(expCo.get(a.corp_code)?.nh_lead_ever), issuer: a.issuer,
    });
  }
  const panel = all
    .filter((r) => f.market === 'all' || marketKey(r.market) === f.market)
    .filter((r) => !f.gap || r.noFundingAfter)
    .filter((r) => !f.issuer || r.issuer)
    .filter((r) => !f.nh || r.nh);

  const big = (e: DiscEvent) => !f.amount.v || Number(e.amount ?? 0) >= f.amount.v;
  const counts = Object.fromEntries(
    DISC_TYPES.map((t) => [t.key, panel.filter((r) => r.evs.some((e) => e.type === t.key && big(e))).length]),
  ) as Record<DiscType, number>;

  let rows = panel;
  if (f.type) {
    rows = panel
      .filter((r) => r.types.includes(f.type!))
      .map((r) => {
        const evs = r.evs.filter((e) => e.type === f.type);
        return {
          ...r, evs, types: [f.type!], last_dt: evs[0].dt,
          top: evs.reduce((m, e) => (Number(e.amount ?? -1) > Number(m.amount ?? -1) ? e : m), evs[0]),
          maxRatio: evs.reduce<DiscEvent | null>((m, e) => (e.ratio != null && (m == null || e.ratio > (m.ratio ?? -1)) ? e : m), null),
        };
      });
  }
  rows = rows
    .filter((r) => !f.amount.v || Number(r.top.amount ?? 0) >= f.amount.v)
    .sort((x, y) =>
      f.sort === 'amount'
        ? Number(y.top.amount ?? -1) - Number(x.top.amount ?? -1)
        : f.sort === 'ratio'
          ? Number(y.maxRatio?.ratio ?? -1) - Number(x.maxRatio?.ratio ?? -1)
          : y.last_dt.localeCompare(x.last_dt) || Number(y.top.amount ?? -1) - Number(x.top.amount ?? -1));

  return { rows, counts, total: panel.filter((r) => r.evs.some(big)).length, since };
}

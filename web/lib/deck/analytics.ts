// 장표 판단 근거 계산: 규칙 문안·AI 사실 묶음·장표 표가 같은 값을 쓴다.
import type { DeckData, DemandType, PeerIssue, PeerTranche } from './types';

export const TYPE_LABEL: Record<DemandType['t'], string> = {
  fund: '운용사(집합)', broker: '증권사(투자매매중개)', inst: '연기금·은행·보험', etc: '기타', foreign_y: '외국(거래실적 유)', foreign_n: '외국(거래실적 무)',
};
export const TYPE_ORDER: DemandType['t'][] = ['fund', 'broker', 'inst', 'etc', 'foreign_y', 'foreign_n'];

// ---------------------------------------------------------------------------------------------
// 원자료 점검: 공시 원문 파싱이 틀린 건을 통계·비교에서 빼고, 검수에 사유를 남긴다.
// 공모 회사채 수요예측 경쟁률은 높아야 20~30배 안팎이다. 40배를 넘으면 참여금액 단위 오류로 본다(예: 3,000억원을 30조원으로 읽음).
export const MAX_RATIO = 40;
const krw = (v: number) => (v >= 1e12 ? `${(v / 1e12).toFixed(1)}조원` : `${Math.round(v / 1e8).toLocaleString('ko-KR')}억원`);
export function suspectOf(p: PeerIssue): string | null {
  const init = Number(p.initial_krw ?? 0);
  const dem = Number(p.demand_krw ?? 0);
  if (init > 0 && dem / init > MAX_RATIO) return `참여금액 ${krw(dem)}이 신고 ${krw(init)}의 ${Math.round(dem / init)}배`;
  if (p.ratio != null && p.ratio > MAX_RATIO) return `경쟁률 ${p.ratio.toFixed(2)}:1`;
  return null;
}

// 투자자 구분별 참여가 회차 참여금액과 맞는지(±15%). 트랜치마다 같은 표가 반복 파싱된 건(합계가 크게 다름)은 쓰지 않는다.
export function typedOk(p: PeerIssue) {
  const typed = p.tranches.filter((t) => t.byType?.length);
  if (!typed.length) return false;
  const sumType = typed.reduce((a, t) => a + (t.byType ?? []).reduce((s, x) => s + x.q, 0), 0);
  const sumDem = typed.reduce((a, t) => a + Number(t.in_band_krw ?? t.demand_krw ?? 0), 0);
  if (!sumDem) return true;
  return Math.abs(sumType - sumDem) / sumDem <= 0.15;
}

// 트랜치 경쟁률: 공시 경쟁률이 (밴드 내 또는 총)참여 ÷ 신고와 25% 넘게 다르면 계산값을 쓴다(트랜치마다 같은 값이 들어간 파싱 오류 대비)
export function trRatio(t: Pick<PeerTranche, 'ratio' | 'initial_krw' | 'demand_krw' | 'in_band_krw'>) {
  const init = Number(t.initial_krw ?? 0);
  const dems = [t.in_band_krw, t.demand_krw].filter((v): v is number => v != null && v > 0).map(Number);
  if (!init || !dems.length) return t.ratio ?? null;
  const calc = dems.map((v) => v / init);
  if (t.ratio != null && calc.some((c) => Math.abs(t.ratio! - c) / c <= 0.25)) return t.ratio;
  return Math.round(calc[0] * 100) / 100;
}

// 투자자 구분별 참여 합계·비중
export function mixOf(trs: PeerTranche[]) {
  const sums = new Map<DemandType['t'], { n: number; q: number }>();
  for (const t of trs) for (const x of t.byType ?? []) {
    const s = sums.get(x.t) ?? { n: 0, q: 0 };
    s.n += x.n;
    s.q += x.q;
    sums.set(x.t, s);
  }
  const total = [...sums.values()].reduce((a, b) => a + b.q, 0);
  return { total, rows: TYPE_ORDER.filter((k) => sums.has(k)).map((k) => ({ t: k, label: TYPE_LABEL[k], n: sums.get(k)!.n, q: sums.get(k)!.q, share: total ? (sums.get(k)!.q / total) * 100 : 0 })) };
}

// 투자자 구분 참여가 수집된 회차만 (최근 n회 안에서). 문장·표에 회차를 그대로 밝힌다.
export function typedIssues(ps: PeerIssue[], n: number) {
  const list = ps.slice(0, n).filter((p) => p.tranches.some((t) => t.byType?.length) && typedOk(p));
  return { list, label: list.length ? `제${list.map((p) => p.series ?? '?').join('·')}회` : '', trs: list.flatMap((p) => p.tranches.filter((t) => t.byType?.length)) };
}

// 같은 등급 사례의 투자자 구분별 참여(회차 합계와 맞는 건만)
export function typedTranches(ps: PeerIssue[]) {
  const ok = ps.filter(typedOk);
  return { n: ok.length, trs: ok.flatMap((p) => p.tranches.filter((t) => t.byType?.length)) };
}

// 회사 최근 n회 만기별 수요: 평균 경쟁률·참여금액 합·평균 신고금액.
// 신고금액이 작은 만기는 경쟁률이 부풀어 보이므로 판단은 참여금액과 함께 본다.
export function tenorDemand(own: PeerIssue[], n = 4) {
  const by = new Map<string, { ratios: number[]; demand: number; init: number; n: number }>();
  for (const p of own.slice(0, n)) for (const t of p.tranches) {
    const e = by.get(t.tenor) ?? { ratios: [], demand: 0, init: 0, n: 0 };
    const r = trRatio(t);
    if (r != null) e.ratios.push(r);
    e.demand += t.demand_krw ?? 0;
    e.init += t.initial_krw ?? 0;
    e.n++;
    by.set(t.tenor, e);
  }
  return [...by.entries()].filter(([, e]) => e.ratios.length).map(([k, e]) => ({
    k, avg: e.ratios.reduce((a, b) => a + b, 0) / e.ratios.length, demand: e.demand, initAvg: e.init / e.n, n: e.n,
  }));
}

// 회사 공모채 연도별 만기도래(향후 3년)
export function maturityByYear(d: DeckData, rows = d.maturities) {
  const by = new Map<string, number>();
  for (const m of rows) by.set(m.dt.slice(0, 4), (by.get(m.dt.slice(0, 4)) ?? 0) + Number(m.amount_krw ?? 0));
  return by;
}

// 해 전체가 자료 기간 안에 있는 연도의 만기도래(내년부터). 없는 해는 0.
export function fullYearLoads(d: DeckData) {
  const long = d.maturitiesLong;
  const by = maturityByYear(d, long?.rows ?? d.maturities);
  const until = long?.to ?? d.maturities.at(-1)?.dt ?? d.asof;
  const out = new Map<string, number>();
  for (let y = Number(d.asof.slice(0, 4)) + 1; `${y}-12-31` <= until; y++) out.set(String(y), by.get(String(y)) ?? 0);
  return out;
}

// 제안 트랜치가 만기되는 연도의 기존 만기도래. 그 해 전체가 만기도래 자료 기간 안에 있을 때만 센다.
export function proposedMaturityLoad(d: DeckData, tranches: { tenor: string }[], pay: string | null) {
  const long = d.maturitiesLong;
  const by = maturityByYear(d, long?.rows ?? d.maturities);
  const until = long?.to ?? (() => {
    const x = new Date(`${d.asof}T00:00:00Z`);
    x.setUTCMonth(x.getUTCMonth() + 36);
    return x.toISOString().slice(0, 10);
  })();
  const base = new Date(`${pay ?? d.asof}T00:00:00Z`);
  const out: { tenor: string; year: string; amount: number }[] = [];
  for (const t of tranches) {
    const m = t.tenor.match(/(\d+(?:\.\d+)?)\s*년/);
    if (!m) continue;
    const end = new Date(base);
    end.setUTCMonth(end.getUTCMonth() + Math.round(Number(m[1]) * 12));
    const year = String(end.getUTCFullYear());
    if (`${year}-12-31` > until) continue;
    out.push({ tenor: t.tenor, year, amount: by.get(year) ?? 0 });
  }
  return out;
}

// %p 차이 표기: -0.0 을 0.0 으로
export const pp = (v: number) => {
  const r = Math.round(v * 10) / 10 || 0;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}`;
};

// 만기 연수 버킷: 1.5년은 '1.5년', 2년 미만 개월은 그대로
export const yearsOf = (months: number | null) => (months == null ? null : Math.round((months / 12) * 10) / 10);

// 일별 금리에서 date 이전(포함) 가장 가까운 값. 7일보다 오래된 값은 쓰지 않는다.
export function valueAt(pts: [string, number][], date: string, maxGapDays = 7): number | null {
  let lo = 0;
  let hi = pts.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= date) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return null;
  const gap = (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${pts[best][0]}T00:00:00Z`).getTime()) / 86_400_000;
  return gap <= maxGapDays ? pts[best][1] : null;
}

// 트랜치 만기에 맞는 국고채 (2년 이하 → 2년, 3년, 5년 이상 → 5년)
export function ktbKeyFor(months: number | null) {
  if (months == null) return null;
  if (months <= 30) return 'ktb2y';
  if (months <= 48) return 'ktb3y';
  return 'ktb5y';
}

// 발행금리 − 같은 만기 국고채(수요예측일 기준), bp
export function spreadVsKtb(d: DeckData, issue: PeerIssue, t: PeerTranche): number | null {
  const key = ktbKeyFor(t.months);
  const dt = issue.demand_dt ?? issue.pricing_dt ?? issue.deal_dt;
  if (!key || !dt || t.yield_pct == null) return null;
  const s = d.daily.find((x) => x.key === key);
  if (!s || s.pts.length < 20) return null;
  const v = valueAt(s.pts, dt);
  return v == null ? null : Math.round((t.yield_pct - v) * 100);
}

// 금통위 전후 국고채 3년 일별 변동폭(절대값 평균, bp): D-3 … D-day
export function meetingVolatility(d: DeckData, meetings: string[]) {
  const s = d.daily.find((x) => x.key === 'ktb3y');
  if (!s || s.pts.length < 60) return null;
  const idx = new Map(s.pts.map((p, i) => [p[0], i]));
  const lags = [3, 2, 1, 0];
  const acc = lags.map(() => [] as number[]);
  let used = 0;
  for (const m of meetings) {
    const i = idx.get(m);
    if (i == null || i < 4) continue;
    used++;
    lags.forEach((lag, k) => {
      const j = i - lag;
      acc[k].push(Math.abs(s.pts[j][1] - s.pts[j - 1][1]) * 100);
    });
  }
  if (used < 3) return null;
  return { meetings: used, byLag: lags.map((lag, k) => ({ lag, bp: Math.round((acc[k].reduce((a, b) => a + b, 0) / acc[k].length) * 10) / 10 })) };
}

// 노치별 평균 경쟁률 (수요예측을 마친 같은 등급군)
export function notchStats(pool: PeerIssue[]) {
  const by = new Map<string, number[]>();
  for (const p of pool) if (p.ratio != null && p.rating) by.set(p.rating, [...(by.get(p.rating) ?? []), p.ratio]);
  return [...by.entries()]
    .map(([rating, xs]) => ({ rating, n: xs.length, avg: xs.reduce((a, b) => a + b, 0) / xs.length }))
    .sort((a, b) => b.n - a.n);
}

// 같은 등급(또는 노치) 발행의 만기별 발행금액 비중: 트렌치 검토의 '등급 관행' 근거
// 만기는 연 단위로 묶는다(18개월 → 1.5년). 발행금액이 없으면 최초 신고금액.
export function tenorMix(pool: PeerIssue[]) {
  const by = new Map<number, { amount: number; n: number }>();
  let issues = 0;
  for (const p of pool) {
    let used = false;
    for (const t of p.tranches) {
      const y = yearsOf(t.months);
      const amt = Number(t.amount_krw ?? t.initial_krw ?? 0);
      if (y == null || !amt) continue;
      const e = by.get(y) ?? { amount: 0, n: 0 };
      e.amount += amt;
      e.n++;
      by.set(y, e);
      used = true;
    }
    if (used) issues++;
  }
  const total = [...by.values()].reduce((a, b) => a + b.amount, 0);
  const rows = [...by.entries()].sort((a, b) => a[0] - b[0])
    .map(([y, e]) => ({ k: `${y}년`, years: y, amount: e.amount, n: e.n, share: total ? (e.amount / total) * 100 : 0 }));
  // 비중 상위 두 만기와 합(문안·사실 묶음이 같은 값을 쓴다)
  const top2 = [...rows].sort((a, b) => b.amount - a.amount).slice(0, 2).sort((a, b) => a.years - b.years);
  const top2Share = top2.reduce((a, b) => a + b.share, 0);
  return { total, issues, rows, top2, top2Share };
}

// 발행사 공모채 만기분포: 올해·내년은 반기, 그 뒤는 연 단위.
// 만기도래가 없는 해는 제안 만기 범위(내년 ~ 올해+horizon년, 자료 기간 안의 온전한 해)에서만 돌려준다.
export function maturityBuckets(d: DeckData, horizon = 3) {
  const rows = d.maturitiesLong?.rows ?? d.maturities;
  const until = d.maturitiesLong?.to ?? d.maturities.at(-1)?.dt ?? d.asof;
  const y0 = Number(d.asof.slice(0, 4));
  const half = (dt: string) => (Number(dt.slice(5, 7)) <= 6 ? '상' : '하');
  const keyOf = (dt: string) => {
    const y = Number(dt.slice(0, 4));
    return y <= y0 + 1 ? `'${String(y).slice(2)}${half(dt)}` : `'${String(y).slice(2)}`;
  };
  const keys: string[] = [];
  const cur = half(d.asof) === '상' ? [`'${String(y0).slice(2)}상`, `'${String(y0).slice(2)}하`] : [`'${String(y0).slice(2)}하`];
  keys.push(...cur, `'${String(y0 + 1).slice(2)}상`, `'${String(y0 + 1).slice(2)}하`);
  for (let y = y0 + 2; `${y}-12-31` <= until; y++) keys.push(`'${String(y).slice(2)}`);
  const sums = new Map(keys.map((k) => [k, 0]));
  for (const m of rows) {
    const k = keyOf(m.dt);
    if (sums.has(k)) sums.set(k, sums.get(k)! + Number(m.amount_krw ?? 0));
  }
  const buckets = keys.map((k) => ({ label: k, amount: sums.get(k)! }));
  const gaps = [...fullYearLoads(d).entries()].filter(([y, v]) => !v && Number(y) <= y0 + Math.max(1, Math.ceil(horizon))).map(([y]) => y);
  return { buckets, gaps };
}

// 분기 소계 (월 배열 12개 → 이번 분기부터)
export function quarterOf(month: string) {
  return `${month.slice(2, 4)}.${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}Q`;
}

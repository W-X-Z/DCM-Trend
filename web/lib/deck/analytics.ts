// 장표 판단 근거 계산: 규칙 문안·AI 사실 묶음·장표 표가 같은 값을 쓴다.
import type { DeckData, DemandType, PeerIssue, PeerTranche } from './types';

export const TYPE_LABEL: Record<DemandType['t'], string> = {
  fund: '운용사(집합)', broker: '증권사(투자매매중개)', inst: '연기금·은행·보험', etc: '기타', foreign_y: '외국(거래실적 유)', foreign_n: '외국(거래실적 무)',
};
export const TYPE_ORDER: DemandType['t'][] = ['fund', 'broker', 'inst', 'etc', 'foreign_y', 'foreign_n'];

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
  const list = ps.slice(0, n).filter((p) => p.tranches.some((t) => t.byType?.length));
  return { list, label: list.length ? `제${list.map((p) => p.series ?? '?').join('·')}회` : '', trs: list.flatMap((p) => p.tranches.filter((t) => t.byType?.length)) };
}

// 회사 최근 n회 만기별 수요: 평균 경쟁률·참여금액 합·평균 신고금액.
// 신고금액이 작은 만기는 경쟁률이 부풀어 보이므로 판단은 참여금액과 함께 본다.
export function tenorDemand(own: PeerIssue[], n = 4) {
  const by = new Map<string, { ratios: number[]; demand: number; init: number; n: number }>();
  for (const p of own.slice(0, n)) for (const t of p.tranches) {
    const e = by.get(t.tenor) ?? { ratios: [], demand: 0, init: 0, n: 0 };
    if (t.ratio != null) e.ratios.push(t.ratio);
    e.demand += t.demand_krw ?? 0;
    e.init += t.initial_krw ?? 0;
    e.n++;
    by.set(t.tenor, e);
  }
  return [...by.entries()].filter(([, e]) => e.ratios.length).map(([k, e]) => ({
    k, avg: e.ratios.reduce((a, b) => a + b, 0) / e.ratios.length, demand: e.demand, initAvg: e.init / e.n, n: e.n,
  }));
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

// 분기 소계 (월 배열 12개 → 이번 분기부터)
export function quarterOf(month: string) {
  return `${month.slice(2, 4)}.${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}Q`;
}

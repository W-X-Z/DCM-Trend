// 월별 트렌드 뷰(mart.v_*_trend_monthly) 행을 화면 단위로 합친다.
// 지표 정의는 SQL(뷰)에 있고, 여기서는 기간·구분별 합계만 낸다.

export type MonthPoint = { month: string; amount: number; count: number };

// 이번 달 포함 최근 n개월의 월 시작일 목록 ('YYYY-MM-01')
export function monthList(n: number, today = new Date()): string[] {
  const kst = new Date(today.getTime() + 9 * 3600_000);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

type Base = { month: string; deal_count: number; amount_krw: number | null };

export function byMonth<T extends Base>(rows: T[], months: string[]): MonthPoint[] {
  const map = new Map(months.map((m) => [m, { month: m, amount: 0, count: 0 }]));
  for (const r of rows) {
    const p = map.get(r.month.slice(0, 10));
    if (!p) continue;
    p.amount += Number(r.amount_krw ?? 0);
    p.count += Number(r.deal_count);
  }
  return [...map.values()];
}

export type Slice = { key: string; count: number; amount: number };

export function byKey<T extends Base>(rows: T[], keyOf: (r: T) => string): Slice[] {
  const map = new Map<string, Slice>();
  for (const r of rows) {
    const k = keyOf(r);
    const s = map.get(k) ?? { key: k, count: 0, amount: 0 };
    s.count += Number(r.deal_count);
    s.amount += Number(r.amount_krw ?? 0);
    map.set(k, s);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function sum<T>(rows: T[], f: (r: T) => number | null | undefined): number {
  return rows.reduce((acc, r) => acc + Number(f(r) ?? 0), 0);
}

// 건수 가중 평균 (값이 없는 행은 제외)
export function weightedAvg<T extends Base>(rows: T[], f: (r: T) => number | null): number | null {
  let w = 0;
  let s = 0;
  for (const r of rows) {
    const v = f(r);
    if (v === null || v === undefined) continue;
    s += Number(v) * Number(r.deal_count);
    w += Number(r.deal_count);
  }
  return w ? s / w : null;
}

export function share(part: number, whole: number): number | null {
  return whole ? (part / whole) * 100 : null;
}

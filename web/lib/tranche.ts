// 회사채 트랜치 구조 집계 (mart.v_bond_issues 행 → 화면 표)
import type { BondIssue } from './types';

export const TENOR_BUCKETS = ['2년 미만', '2년', '3년', '5년', '7년', '10년 이상', '만기 미상'] as const;
export const RATING_ORDER = ['AAA', 'AA', 'A', 'BBB', '등급 미확인'] as const;

export function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x !== null && x !== undefined && !Number.isNaN(Number(x))).map(Number).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);

export type TenorRow = {
  bucket: string; tranches: number; amount: number; share: number | null;
  medComp: number | null; medSpread: number | null; incShare: number | null;
};

// 만기 구간별: 트랜치 단위
export function tenorMix(issues: BondIssue[]): TenorRow[] {
  const all = issues.flatMap((i) => i.tranches ?? []);
  const total = all.reduce((s, t) => s + Number(t.amount_krw ?? 0), 0);
  return TENOR_BUCKETS.map((bucket) => {
    const ts = all.filter((t) => (t.tenor_bucket ?? '만기 미상') === bucket);
    const amount = ts.reduce((s, t) => s + Number(t.amount_krw ?? 0), 0);
    const known = ts.filter((t) => t.initial_amount_krw != null);
    return {
      bucket,
      tranches: ts.length,
      amount,
      share: share(amount, total),
      medComp: median(ts.map((t) => t.competition_ratio)),
      medSpread: median(ts.map((t) => t.final_spread_bp)),
      incShare: share(known.filter((t) => t.is_increased).length, known.length),
    };
  }).filter((r) => r.tranches > 0);
}

export type ComboRow = {
  combo: string; issues: number; share: number | null; avgAmount: number | null;
  medComp: number | null; incShare: number | null; tranches: number;
};

// 트랜치 조합별: 발행 단위
export function comboStats(issues: BondIssue[], top = 8): ComboRow[] {
  const map = new Map<string, BondIssue[]>();
  for (const i of issues) {
    const k = i.tenor_combo || '만기 미상';
    map.set(k, [...(map.get(k) ?? []), i]);
  }
  const rows = [...map.entries()].map(([combo, xs]) => ({
    combo,
    issues: xs.length,
    share: share(xs.length, issues.length),
    avgAmount: xs.length ? xs.reduce((s, x) => s + Number(x.amount_krw ?? 0), 0) / xs.length : null,
    medComp: median(xs.map((x) => x.competition_ratio)),
    incShare: share(xs.filter((x) => x.is_increased).length, xs.filter((x) => x.initial_amount_krw != null).length),
    tranches: xs[0]?.tranche_count ?? 0,
  }));
  rows.sort((a, b) => b.issues - a.issues || (b.avgAmount ?? 0) - (a.avgAmount ?? 0));
  if (rows.length <= top) return rows;
  const head = rows.slice(0, top);
  const rest = rows.slice(top);
  const restIssues = issues.filter((i) => rest.some((r) => r.combo === (i.tenor_combo || '만기 미상')));
  head.push({
    combo: `그 밖의 조합 ${rest.length}개`,
    issues: restIssues.length,
    share: share(restIssues.length, issues.length),
    avgAmount: restIssues.reduce((s, x) => s + Number(x.amount_krw ?? 0), 0) / restIssues.length,
    medComp: median(restIssues.map((x) => x.competition_ratio)),
    incShare: share(restIssues.filter((x) => x.is_increased).length, restIssues.filter((x) => x.initial_amount_krw != null).length),
    tranches: 0,
  });
  return head;
}

export type RatingRow = {
  group: string; issues: number; avgTranches: number | null; topCombo: string | null; topShare: number | null;
  medAmount: number | null; medComp: number | null; incShare: number | null;
};

// 등급별 대표 구조
export function ratingStats(issues: BondIssue[]): RatingRow[] {
  return RATING_ORDER.map((group) => {
    const xs = issues.filter((i) => (i.rating_group ?? '등급 미확인') === group);
    const combos = new Map<string, number>();
    for (const x of xs) combos.set(x.tenor_combo, (combos.get(x.tenor_combo) ?? 0) + 1);
    const top = [...combos.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      group,
      issues: xs.length,
      avgTranches: xs.length ? xs.reduce((s, x) => s + x.tranche_count, 0) / xs.length : null,
      topCombo: top?.[0] ?? null,
      topShare: top ? share(top[1], xs.length) : null,
      medAmount: median(xs.map((x) => x.amount_krw)),
      medComp: median(xs.map((x) => x.competition_ratio)),
      incShare: share(xs.filter((x) => x.is_increased).length, xs.filter((x) => x.initial_amount_krw != null).length),
    };
  }).filter((r) => r.issues > 0);
}

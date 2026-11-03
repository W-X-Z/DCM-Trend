// 줄 단위 비교(최장 공통 부분열). 수정안·판 비교 화면에서 쓴다.
export type DiffLine = { t: 'same' | 'add' | 'del'; s: string };

export function diffLines(a: string, b: string): DiffLine[] {
  const x = a ? a.split('\n') : [];
  const y = b ? b.split('\n') : [];
  const n = x.length;
  const m = y.length;
  if (n * m > 400_000) return [...x.map((s) => ({ t: 'del' as const, s })), ...y.map((s) => ({ t: 'add' as const, s }))];
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ t: 'same', s: x[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: 'del', s: x[i++] });
    else out.push({ t: 'add', s: y[j++] });
  }
  while (i < n) out.push({ t: 'del', s: x[i++] });
  while (j < m) out.push({ t: 'add', s: y[j++] });
  return out;
}

// 바뀐 줄 주변만 남긴다(앞뒤 ctx 줄)
export function hunks(d: DiffLine[], ctx = 2): (DiffLine | null)[] {
  const keep = d.map((l, i) => l.t !== 'same' || d.slice(Math.max(0, i - ctx), i + ctx + 1).some((x) => x.t !== 'same'));
  const out: (DiffLine | null)[] = [];
  d.forEach((l, i) => {
    if (keep[i]) out.push(l);
    else if (out[out.length - 1] !== null) out.push(null);
  });
  return out;
}

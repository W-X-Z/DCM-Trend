// 표시 형식: 금액은 억원 기준, 1조 이상은 조 단위

export function won(krw: number | null | undefined): string {
  if (krw === null || krw === undefined || Number.isNaN(Number(krw))) return '–';
  const eok = Number(krw) / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조`;
  if (Math.abs(eok) >= 100) return `${Math.round(eok).toLocaleString('ko-KR')}억`;
  return `${eok.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '–';
  return `${Number(v).toFixed(digits)}%`;
}

export function date(d: string | null | undefined): string {
  if (!d) return '–';
  return d.slice(0, 10).replaceAll('-', '.');
}

export function month(d: string): string {
  return `${d.slice(2, 4)}.${d.slice(5, 7)}`;
}

export function tenor(months: number | null | undefined): string {
  if (!months) return '–';
  if (months % 12 === 0) return `${months / 12}년`;
  return `${(months / 12).toFixed(1)}년`;
}

export function monthsAgo(n: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - n + 1, 1));
  return d.toISOString().slice(0, 10);
}

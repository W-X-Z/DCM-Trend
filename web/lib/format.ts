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

// 인사이트 수치 (ingest/lib/insights.mjs 와 같은 규칙)
export function factValue(unit: string, v: number | null | undefined, scope?: string): string {
  if (v === null || v === undefined) return '–';
  const n = Number(v);
  switch (unit) {
    case 'krw': {
      const eok = n / 1e8;
      return Math.abs(eok) >= 10000 ? `${(eok / 10000).toFixed(1)}조원` : `${Math.round(eok).toLocaleString('ko-KR')}억원`;
    }
    case 'count': return `${Math.round(n).toLocaleString('ko-KR')}${scope === 'maturity' ? '곳' : '건'}`;
    case 'pct': return `${n.toFixed(1)}%`;
    case 'months': return `${(n / 12).toFixed(1)}년`;
    case 'bp': return `${Math.round(n)}bp`;
    case 'rate': return `${n.toFixed(2)}%`;
    default: return String(n);
  }
}

export function factChange(unit: string, c: number | null | undefined): string {
  if (c === null || c === undefined) return '–';
  const n = Number(c);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const a = Math.abs(n);
  switch (unit) {
    case 'krw':
    case 'count': return `${sign}${a.toFixed(1)}%`;
    case 'pct': return `${sign}${a.toFixed(1)}%p`;
    case 'months': return `${sign}${a.toFixed(1)}개월`;
    default: return `${sign}${Math.round(a)}bp`;
  }
}

export function bp(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  const n = Math.round(Number(v));
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}bp`;
}

export function kstDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
  return `${d.slice(0, 10).replaceAll('-', '.')} ${d.slice(11, 16)}`;
}

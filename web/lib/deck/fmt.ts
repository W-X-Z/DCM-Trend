// 제안서 표기 (NH 서식: 억원, 금리 소수 셋째 자리, 경쟁률 x.xx:1, 날짜 m/d(요일))
import { md, mdw } from './schedule';
import type { PeerIssue, PeerTranche } from './types';

export { md, mdw };
export const eok = (krw: number | null | undefined, digits = 0) =>
  krw == null ? '–' : (Number(krw) / 1e8).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const eokW = (krw: number | null | undefined) => (krw == null ? '–' : `${eok(krw)}억원`);
export const rate3 = (v: number | null | undefined) => (v == null ? '–' : `${Number(v).toFixed(3)}%`);
export const rate2 = (v: number | null | undefined) => (v == null ? '–' : `${Number(v).toFixed(2)}%`);
export const ratioX = (v: number | null | undefined) => (v == null ? '–' : `${Number(v).toFixed(2)}:1`);
export const bpS = (v: number | null | undefined) => {
  if (v == null) return '–';
  const n = Math.round(Number(v));
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}bp`;
};
export const yy = (s: string | null | undefined) => (s ? `'${s.slice(2, 4)}.${s.slice(5, 7)}` : '–'); // '26.04
export const yymmdd = (s: string | null | undefined) => (s ? `'${s.slice(2, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}` : '–');
export const years = (months: number | null | undefined) => (months == null ? '–' : String(Math.round((months / 12) * 10) / 10));
export const tenorYears = (months: number | null | undefined) => (months == null ? '–' : `${years(months)}년`);

const num1 = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
export function bandKind(t: string | null | undefined) {
  if (!t) return '–';
  if (/고정/.test(t)) return '고정';
  if (/개별/.test(t)) return '개별';
  if (/등급/.test(t)) return '등급';
  return t.slice(0, 2);
}
export function bandRange(t: { band_type: string | null; band_low: number | null; band_high: number | null }) {
  if (t.band_low == null || t.band_high == null) return '–';
  if (/고정/.test(t.band_type ?? '')) return `${num1(t.band_low)}%~${num1(t.band_high)}%`;
  const s = (v: number) => (v > 0 ? `+${num1(v)}` : num1(v));
  return `${s(t.band_low)}~${s(t.band_high)}`;
}
export const bandText = (t: { band_type: string | null; band_low: number | null; band_high: number | null }) =>
  t.band_low == null ? '–' : `${/고정/.test(t.band_type ?? '') ? '고정금리' : '개별민평'} ${bandRange(t)}${/고정/.test(t.band_type ?? '') ? '' : 'bp'}`;

// 발행 단위 대표 값 (트랜치가 하나면 그 값)
export const firstTr = (p: PeerIssue): PeerTranche | null => p.tranches[0] ?? null;
export const yieldsOf = (p: PeerIssue) => p.tranches.map((t) => rate3(t.yield_pct)).join(' / ');
export const demandDay = (p: PeerIssue) => p.demand_dt ?? null;

// 증권사 짧은 이름 (차트 축)
export function shortFirm(f: string) {
  const s = f.replace(/\s/g, '');
  if (/^DB금융투자/.test(s)) return 'DB';
  return s.replace(/(투자)?증권$/, '').replace(/금융투자$/, '') || s;
}

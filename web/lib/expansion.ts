// 사업 확장 기업: 화면과 CSV 가 같은 필터·정렬을 쓴다
import type { ExpansionCat, ExpansionCompany } from './types';

export const EXP_CATS: { key: ExpansionCat; short: string; desc: string }[] = [
  { key: '생산·설비 증설', short: '생산·설비', desc: '공장·라인 신증설, 설비·선박 도입' },
  { key: '부지·사업장 확보', short: '부지·사업장', desc: '공장 부지, 물류센터, 사업용 토지·건물' },
  { key: '인수·신사업', short: '인수·신사업', desc: '경영권 인수(지분 30% 이상), 영업양수, 신사업 진출' },
  { key: '연구·업무시설', short: '연구·업무시설', desc: '사옥·R&D센터 매입·신축' },
];
export const EXP_MARKETS = [
  { key: 'all', label: '전체' }, { key: 'kospi', label: '유가증권' }, { key: 'kosdaq', label: '코스닥' }, { key: 'etc', label: '코넥스·비상장' },
];
export const EXP_AMOUNTS = [
  { key: '0', label: '전체', v: 0 }, { key: '100', label: '100억 이상', v: 1e10 },
  { key: '500', label: '500억 이상', v: 5e10 }, { key: '1000', label: '1,000억 이상', v: 1e11 },
];
export const EXP_DECISIONS = [
  { key: 'all', label: '전체' }, { key: 'new', label: '최근 1년 새 결정' }, { key: 'ongoing', label: '진행 중(정정 공시만)' },
];
export const EXP_SORTS = [
  { key: 'amount', label: '금액순' }, { key: 'ratio', label: '규모 비율순' }, { key: 'recent', label: '최근순' },
];

export type ExpParams = { c?: string; m?: string; a?: string; gap?: string; s?: string; d?: string };
export type ExpFilter = { cat?: ExpansionCat; market: string; amount: (typeof EXP_AMOUNTS)[number]; gap: boolean; sort: string; decision: string };

export function parseExpParams(sp: ExpParams): ExpFilter {
  return {
    cat: EXP_CATS.find((c) => c.key === sp.c)?.key,
    market: EXP_MARKETS.find((m) => m.key === sp.m)?.key ?? 'all',
    amount: EXP_AMOUNTS.find((a) => a.key === sp.a) ?? EXP_AMOUNTS[0],
    gap: sp.gap === '1',
    sort: EXP_SORTS.find((s) => s.key === sp.s)?.key ?? 'amount',
    decision: EXP_DECISIONS.find((d) => d.key === sp.d)?.key ?? 'all',
  };
}

export function expQuery(f: ExpFilter, patch: ExpParams = {}) {
  const m: ExpParams = { c: f.cat, m: f.market, a: f.amount.key, gap: f.gap ? '1' : undefined, s: f.sort, d: f.decision, ...patch };
  const q = new URLSearchParams();
  if (m.c) q.set('c', m.c);
  if (m.m && m.m !== 'all') q.set('m', m.m);
  if (m.a && m.a !== '0') q.set('a', m.a);
  if (m.gap === '1') q.set('gap', '1');
  if (m.s && m.s !== 'amount') q.set('s', m.s);
  if (m.d && m.d !== 'all') q.set('d', m.d);
  const s = q.toString();
  return s ? `?${s}` : '';
}

const marketKey = (m: string | null) => (m === '유가증권' ? 'kospi' : m === '코스닥' ? 'kosdaq' : 'etc');

export function applyExpFilter(rows: ExpansionCompany[], f: ExpFilter) {
  return rows
    .filter((c) => !f.cat || c.cats.includes(f.cat))
    .filter((c) => f.market === 'all' || marketKey(c.market) === f.market)
    .filter((c) => !f.amount.v || Number(c.amount_krw ?? 0) >= f.amount.v)
    .filter((c) => !f.gap || c.no_funding_after)
    .filter((c) => f.decision === 'all' || (f.decision === 'new' ? c.has_new_decision : !c.has_new_decision))
    .sort((x, y) =>
      f.sort === 'ratio'
        ? Number(y.max_ratio_pct ?? -1) - Number(x.max_ratio_pct ?? -1)
        : f.sort === 'recent'
          ? y.last_dt.localeCompare(x.last_dt)
          : Number(y.amount_krw ?? -1) - Number(x.amount_krw ?? -1));
}

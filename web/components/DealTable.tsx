import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Deal } from '@/lib/types';
import { date, num, pct, tenor, won } from '@/lib/format';
import { PRODUCT_LABEL, dealTerms, dealTitle } from '@/lib/labels';

type Col = { head: string; cell: (d: Deal) => ReactNode; num?: boolean; className?: string };

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// 회사채 금리: 고정금리면 확정 이자율, 민평 방식이면 확정 가산금리
function bondRate(d: Deal) {
  if (d.coupon_pct != null) return pct(d.coupon_pct, 3);
  if (d.final_spread_bp != null) {
    const base = d.band_type === '국고채' ? '국고' : '민평';
    const v = Number(d.final_spread_bp);
    return `${base} ${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}bp`;
  }
  return '–';
}

const COMMON = {
  date: { head: '기준일', cell: (d: Deal) => <span className="nowrap">{date(d.deal_dt)}{d.deal_dt && d.deal_dt > today() ? <em className="tag">예정</em> : null}</span> },
  company: { head: '발행사', cell: (d: Deal) => <Link href={`/company/${d.corp_code}`}>{d.corp_name}</Link> },
  product: { head: '상품', cell: (d: Deal) => <span className={`swatch-label p-${d.product_type}`}>{PRODUCT_LABEL[d.product_type]}</span> },
  title: { head: '증권', cell: (d: Deal) => dealTitle(d) },
  amount: { head: '금액', num: true, cell: (d: Deal) => won(d.amount_krw) },
  lead: { head: '대표주관', cell: (d: Deal) => d.lead_managers ?? <span className="muted">–</span>, className: 'col-lead' },
  dart: {
    head: '공시',
    cell: (d: Deal) => (d.dart_url ? <a href={d.dart_url} target="_blank" rel="noreferrer">DART</a> : '–'),
  },
} satisfies Record<string, Col>;

const BY_PRODUCT: Record<string, Col[]> = {
  bond: [
    COMMON.date, COMMON.company, COMMON.title, COMMON.amount,
    { head: '만기', num: true, cell: (d) => tenor(d.tenor_months) },
    { head: '등급', cell: (d) => d.rating ?? '–' },
    { head: '경쟁률', num: true, cell: (d) => (d.competition_ratio != null ? `${num(d.competition_ratio, 2)}배` : '–') },
    { head: '금리', num: true, cell: (d) => bondRate(d) },
    { head: '수수료', num: true, cell: (d) => (d.fee_bp != null ? `${num(d.fee_bp, 1)}bp` : '–') },
    COMMON.lead, COMMON.dart,
  ],
  mezz: [
    COMMON.date, COMMON.company, COMMON.title, COMMON.amount,
    { head: '방식', cell: (d) => (d.is_public === null ? '–' : d.is_public ? '공모' : '사모') },
    { head: '표면/만기', num: true, cell: (d) => (d.coupon_pct != null ? `${pct(d.coupon_pct, 1)} / ${pct(d.ytm_pct, 1)}` : '–') },
    { head: '리픽싱 하한', num: true, cell: (d) => (d.refix_floor_ratio_pct != null ? `${num(d.refix_floor_ratio_pct)}%` : '–') },
    { head: '주식 비율', num: true, cell: (d) => pct(d.shares_ratio_pct, 1) },
    COMMON.dart,
  ],
  equity: [
    COMMON.date, COMMON.company, COMMON.title, COMMON.amount,
    { head: '신주 비율', num: true, cell: (d) => pct(d.dilution_pct, 1) },
    { head: '인수방식', cell: (d) => d.underwriting_method ?? '–' },
    COMMON.lead, COMMON.dart,
  ],
  ipo: [
    COMMON.date, COMMON.company, COMMON.title, COMMON.amount,
    { head: '공모가', num: true, cell: (d) => (d.offer_price ? `${num(d.offer_price)}원` : '–') },
    { head: '밴드 대비', cell: (d) => d.ipo_price_vs_band ?? '–' },
    { head: '구주매출', num: true, cell: (d) => (d.ipo_secondary_pct ? pct(d.ipo_secondary_pct, 0) : '–') },
    { head: '수수료', num: true, cell: (d) => (d.fee_bp != null ? `${num(d.fee_bp / 100, 2)}%` : '–') },
    COMMON.lead, COMMON.dart,
  ],
  mixed: [
    COMMON.date, COMMON.product, COMMON.title, COMMON.amount,
    { head: '조건', cell: (d) => dealTerms(d).join(', ') || '–', className: 'col-terms' },
    COMMON.lead, COMMON.dart,
  ],
};

export function DealTable({
  deals,
  layout,
  extra,
  caption,
}: {
  deals: Deal[];
  layout: 'bond' | 'mezz' | 'equity' | 'ipo' | 'mixed';
  extra?: Col;
  caption?: string;
}) {
  const cols = extra ? [...BY_PRODUCT[layout].slice(0, -1), extra, BY_PRODUCT[layout].at(-1)!] : BY_PRODUCT[layout];
  return (
    <div className="table-wrap">
      <table className="data">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.head} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.deal_key} className={d.nh_lead ? 'row-nh' : undefined}>
              {cols.map((c) => (
                <td key={c.head} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>{c.cell(d)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import Link from 'next/link';
import type { Deal, NotableDeal } from '@/lib/types';
import { date, won } from '@/lib/format';
import { PRODUCT_LABEL, dealTerms, dealTitle } from '@/lib/labels';

// 딜 툼스톤: 발행사, 금액, 증권, 조건, 주관사, 기준일을 한 장에.
export function Tombstone({ deal, reasons = [], linkCompany = true }: { deal: Deal; reasons?: NotableDeal[]; linkCompany?: boolean }) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const upcoming = deal.deal_dt && deal.deal_dt > today;
  const body = (
    <>
      <span className={`ts-product p-${deal.product_type}`}>{PRODUCT_LABEL[deal.product_type]}</span>
      <span className="ts-issuer">{deal.corp_name}</span>
      <span className="ts-amount">{won(deal.amount_krw)}원</span>
      <span className="ts-title">{dealTitle(deal)}</span>
      {dealTerms(deal).length > 0 && <span className="ts-terms">{dealTerms(deal).join(', ')}</span>}
      <span className="ts-rule" aria-hidden />
      {deal.lead_managers ? (
        <span className="ts-lead">
          <span className="ts-lead-label">대표주관</span>
          {deal.lead_managers}
        </span>
      ) : (
        <span className="ts-lead ts-muted">{deal.is_public === false ? '사모' : '주관사 미기재'}</span>
      )}
      <span className="ts-date">
        {date(deal.deal_dt)}
        {upcoming ? ' 예정' : ''}
      </span>
      {reasons.length > 0 && (
        <span className="ts-reasons">
          {reasons.map((r) => (
            <span key={r.reason} className={`badge${r.reason === '미달' ? ' badge-alert' : ''}`} title={r.detail}>
              {r.reason}
            </span>
          ))}
        </span>
      )}
    </>
  );
  return linkCompany ? (
    <Link href={`/company/${deal.corp_code}`} className="tombstone">
      {body}
    </Link>
  ) : (
    <div className="tombstone">{body}</div>
  );
}

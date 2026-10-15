import Link from 'next/link';
import { bp, date, num, won } from '@/lib/format';
import { PRODUCT_LABEL } from '@/lib/labels';
import { getBondIssuesBy } from '@/lib/queries';
import { median, tenorMix } from '@/lib/tranche';
import type { BondIssue, Deal, ProductType } from '@/lib/types';
import { Info, SectionHead } from './Ui';

const monthsAgo = (n: number) => {
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};
const ratio = (v: number | null | undefined) => (v == null ? '–' : `${num(Number(v), 2)}배`);

// 주관사 이력: 이 회사 딜의 대표주관사별 건수 (공동 대표주관은 각자 1건)
function leadHistory(deals: Deal[]) {
  const map = new Map<string, { firm: string; byProduct: Partial<Record<ProductType, number>>; total: number; last: string | null; isNh: boolean }>();
  for (const d of deals) {
    const firms = (d.lead_managers ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    for (const f of firms) {
      const r = map.get(f) ?? { firm: f, byProduct: {}, total: 0, last: null, isNh: /NH투자/.test(f) };
      r.byProduct[d.product_type] = (r.byProduct[d.product_type] ?? 0) + 1;
      r.total += 1;
      const dt = d.deal_dt ?? d.announce_dt;
      if (dt && (!r.last || dt > r.last)) r.last = dt;
      map.set(f, r);
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || String(b.last).localeCompare(String(a.last)));
}

function LastIssue({ i }: { i: BondIssue }) {
  return (
    <div className="prep-last">
      <h3 className="sub-h">
        직전 공모채 <span className="muted small tnum">{date(i.pricing_dt ?? i.deal_dt)} 수요예측</span>
      </h3>
      <dl className="prep-kv">
        <div><dt>등급</dt><dd>{i.rating ?? '–'}</dd></div>
        <div>
          <dt>금액</dt>
          <dd className="tnum">
            {i.initial_amount_krw && i.initial_amount_krw !== i.amount_krw ? `${won(i.initial_amount_krw)} → ${won(i.amount_krw)}` : won(i.amount_krw)}
          </dd>
        </div>
        <div><dt>만기 구성</dt><dd>{i.tenor_combo || '–'}</dd></div>
        <div><dt>전체 경쟁률</dt><dd className="tnum">{ratio(i.competition_ratio)}</dd></div>
        <div>
          <dt>트랜치별 가산금리</dt>
          <dd className="tnum">
            {(i.tranches ?? []).filter((t) => t.final_spread_bp != null).map((t) => `${t.tenor_label ?? t.tenor_bucket} ${bp(t.final_spread_bp)}`).join(', ') || '–'}
          </dd>
        </div>
        <div><dt>대표주관</dt><dd>{i.lead_managers ?? '–'}</dd></div>
      </dl>
    </div>
  );
}

export async function ProposalPrep({ corp, deals }: { corp: string; deals: Deal[] }) {
  const leads = leadHistory(deals);
  const own = deals.some((d) => d.product_type === 'bond') ? await getBondIssuesBy({ corp, limit: 10 }).catch(() => []) : [];
  const last = own[0];
  const group = last?.rating_group ?? null;
  const peers = group && group !== '등급 미확인' ? await getBondIssuesBy({ ratingGroup: group, since: monthsAgo(12), limit: 1000 }).catch(() => []) : [];
  const recent = peers.filter((p) => (p.deal_dt ?? '') >= monthsAgo(6));
  const mix = tenorMix(recent);
  const lastByBucket = new Map((last?.tranches ?? []).map((t) => [t.tenor_bucket, t.final_spread_bp]));
  const known = recent.filter((p) => p.competition_ratio != null);
  const under = peers.filter((p) => p.is_undersubscribed && p.corp_code !== corp).slice(0, 6);

  if (!last && !leads.length) return null;

  return (
    <section className="section" aria-labelledby="prep-h">
      <SectionHead
        id="prep-h"
        title="제안 준비"
        info="직전 공모채 조건, 같은 등급군의 최근 발행 조건, 미달 사례, 이 회사의 주관사 이력을 한곳에 모았습니다. 가산금리는 개별민평 대비 확정 가산금리(트랜치 기준)."
      />
      <div className="prep-grid">
        {last && <LastIssue i={last} />}

        {recent.length > 0 && (
          <div className="prep-peers">
            <h3 className="sub-h">
              {group}급 최근 6개월
              <span className="muted small tnum"> 공모채 {recent.length}건, 미달 {known.filter((p) => p.is_undersubscribed).length}건, 경쟁률 중간값 {ratio(median(known.map((p) => p.competition_ratio)))}</span>
            </h3>
            <div className="table-wrap">
              <table className="data compact">
                <caption className="sr-only">{group}급 최근 6개월 만기별 발행 조건</caption>
                <thead>
                  <tr>
                    <th>만기</th>
                    <th className="num">트랜치</th>
                    <th className="num">경쟁률 중간값</th>
                    <th className="num">가산금리 중간값</th>
                    <th className="num">
                      이 회사 직전
                      <Info>직전 공모채의 같은 만기 트랜치 확정 가산금리</Info>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mix.map((r) => (
                    <tr key={r.bucket} className={lastByBucket.has(r.bucket) ? 'row-hl' : undefined}>
                      <td>{r.bucket}</td>
                      <td className="num">{r.tranches}</td>
                      <td className="num">{ratio(r.medComp)}</td>
                      <td className="num">{r.medSpread == null ? '–' : bp(r.medSpread)}</td>
                      <td className="num">{lastByBucket.get(r.bucket) != null ? bp(lastByBucket.get(r.bucket)!) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {under.length > 0 && (
          <div className="prep-under">
            <h3 className="sub-h">{group}급 미달 사례 <span className="muted small">최근 12개월</span></h3>
            <ul className="prep-list">
              {under.map((u) => (
                <li key={u.issue_key}>
                  <span className="tnum muted">{date(u.pricing_dt ?? u.deal_dt)}</span>
                  <Link href={`/company/${u.corp_code}`}>{u.corp_name}</Link>
                  <span className="muted">{u.rating}</span>
                  <span className="tnum">
                    {won(u.initial_amount_krw ?? u.amount_krw)} 모집,{' '}
                    {(() => {
                      const t = (u.tranches ?? []).find((x) => x.is_undersubscribed);
                      return t && u.tranche_count > 1
                        ? `${t.tenor_label ?? t.tenor_bucket} 경쟁률 ${ratio(t.competition_ratio)}`
                        : `경쟁률 ${ratio(t?.competition_ratio ?? u.competition_ratio)}`;
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {leads.length > 0 && (
          <div className="prep-leads">
            <h3 className="sub-h">
              주관사 이력
              <Info>수집 기간의 공모 회사채·메자닌·유상증자·IPO 대표주관. 공동 대표주관은 각자 1건으로 셉니다.</Info>
            </h3>
            <div className="table-wrap">
              <table className="data compact">
                <caption className="sr-only">대표주관사별 딜 수</caption>
                <thead>
                  <tr>
                    <th>대표주관사</th>
                    {(['bond', 'mezz', 'equity', 'ipo'] as ProductType[]).filter((p) => leads.some((l) => l.byProduct[p])).map((p) => (
                      <th key={p} className="num">{PRODUCT_LABEL[p]}</th>
                    ))}
                    <th className="num">최근</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 8).map((l) => (
                    <tr key={l.firm} className={l.isNh ? 'row-nh' : undefined}>
                      <td>{l.firm}</td>
                      {(['bond', 'mezz', 'equity', 'ipo'] as ProductType[]).filter((p) => leads.some((x) => x.byProduct[p])).map((p) => (
                        <td key={p} className="num">{l.byProduct[p] ?? '–'}</td>
                      ))}
                      <td className="num nowrap">{date(l.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

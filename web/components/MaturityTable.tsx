import Link from 'next/link';
import { date, pct, won } from '@/lib/format';
import type { Maturity } from '@/lib/types';

// 만기도래 회사 표 (만기도래 화면, 제안서 초안 첫 화면에서 같이 쓴다)
export type MaturityGroup = {
  corp_code: string; corp_name: string; market: string | null; first_dt: string; amount: number;
  items: Maturity[]; leads: string[]; nh_lead: boolean; nh_involved: boolean; refi: boolean; rating: string | null;
};

export function groupByCorp(rows: Maturity[]): MaturityGroup[] {
  const map = new Map<string, MaturityGroup>();
  for (const r of rows) {
    const g = map.get(r.corp_code) ?? {
      corp_code: r.corp_code, corp_name: r.corp_name, market: r.market, first_dt: r.event_dt, amount: 0,
      items: [], leads: [], nh_lead: false, nh_involved: false, refi: false, rating: r.rating,
    };
    g.items.push(r);
    g.amount += Number(r.amount_krw ?? 0);
    if (r.event_dt < g.first_dt) g.first_dt = r.event_dt;
    for (const l of (r.lead_managers ?? '').split(',').map((x) => x.trim()).filter(Boolean)) if (!g.leads.includes(l)) g.leads.push(l);
    g.nh_lead ||= r.nh_lead;
    g.nh_involved ||= r.nh_involved;
    g.refi ||= r.refi_signal;
    g.rating ??= r.rating;
    map.set(r.corp_code, g);
  }
  return [...map.values()];
}

export function MaturityTable({ groups, kind, ctaLabel = '제안서 초안' }: { groups: MaturityGroup[]; kind: 'bond' | 'mezz'; ctaLabel?: string }) {
  return (
    <div className="table-wrap">
      <table className="data mat-table">
        <caption className="sr-only">{kind === 'bond' ? '공모 회사채 만기 도래 회사' : '메자닌 만기·풋옵션 도래 회사'}</caption>
        <thead>
          <tr>
            <th>가장 빠른 날짜</th>
            <th>회사</th>
            <th className="num">금액</th>
            <th>{kind === 'bond' ? '만기 회차' : '도래 내역'}</th>
            <th>{kind === 'bond' ? '당시 대표주관' : '주선·주관'}</th>
            <th>신호</th>
            <th className="col-cta"><span className="sr-only">제안서</span></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.corp_code} className={g.nh_lead ? 'row-nh' : undefined}>
              <td className="nowrap">{date(g.first_dt)}</td>
              <td>
                <Link href={`/company/${g.corp_code}`}>{g.corp_name}</Link>
                <span className="cell-sub">{g.market && g.market !== '기타' ? g.market : '비상장'}{g.rating ? `, ${g.rating}` : ''}</span>
              </td>
              <td className="num">{won(g.amount)}</td>
              <td className="col-terms">
                {g.items.map((m) => (
                  <span key={`${m.deal_key}-${m.event_type}`} className="tranche">
                    {kind === 'bond'
                      ? `${m.series ? `제${m.series}회` : '회차 미상'} ${won(m.amount_krw)} (${date(m.event_dt).slice(2)}${m.coupon_pct != null ? `, ${pct(m.coupon_pct, 2)}` : ''}${m.tenor_months ? `, ${Math.round(m.tenor_months / 12)}년물` : ''})`
                      : `${m.sub_type ?? ''} ${m.event_type} ${date(m.event_dt).slice(2)} ${won(m.amount_krw)}${m.is_public === false ? ' 사모' : ''}`}
                  </span>
                ))}
              </td>
              <td className="col-lead">{g.leads.join(', ') || <span className="muted">–</span>}</td>
              <td>
                <span className="match">
                  {g.refi && <span className="badge hit">차환 진행</span>}
                  {g.nh_lead && <span className="badge">NH 대표주관 이력</span>}
                  {!g.nh_lead && g.nh_involved && <span className="badge">NH 인수 참여</span>}
                </span>
              </td>
              <td className="col-cta">
                <Link
                  href={`/proposal?corp=${g.corp_code}&type=${kind}`}
                  className="cta-sm"
                  aria-label={`${g.corp_name} ${ctaLabel}`}
                >
                  {ctaLabel}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

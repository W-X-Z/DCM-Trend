import Link from 'next/link';
import { FILING_GROUPS, factLine } from '@/lib/filings';
import type { KeyFiling } from '@/lib/types';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const dayLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

export function KeyFilingRow({ f, showCorp = true }: { f: KeyFiling; showCorp?: boolean }) {
  const g = FILING_GROUPS.find((x) => x.grp === f.grp)?.key ?? 'asset';
  const facts = factLine(f, 4);
  return (
    <li className={`kf g-${g}`}>
      <div className="kf-main">
        <span className="kf-kind">{f.label}</span>
        {showCorp ? (
          <>
            <Link href={`/company/${f.corp_code}`} className="kf-corp">{f.corp_name}</Link>
            {f.latest_bond_rating && <span className="kf-badge" title="최근 공모 회사채 등급">{f.latest_bond_rating}</span>}
            {f.market && f.market !== '기타' && <span className="kf-market">{f.market}</span>}
          </>
        ) : (
          <span className="kf-market tnum">{dayLabel(f.rcept_dt)}</span>
        )}
      </div>
      {facts.length > 0 ? (
        <dl className="kf-facts">
          {facts.map((x) => (
            <div key={x.k}>
              <dt>{x.k}</dt>
              <dd className={/금액|대비|지분율|증감률|잔액/.test(x.k) ? 'tnum' : undefined}>{x.v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="kf-report">{f.report_nm}</p>
      )}
      <a className="kf-src" href={f.dart_url} target="_blank" rel="noreferrer" aria-label={`${f.corp_name} ${f.report_nm} 공시 원문`}>
        원문
      </a>
    </li>
  );
}

export function KeyFilingDays({ rows }: { rows: KeyFiling[] }) {
  const days = [...new Set(rows.map((r) => r.rcept_dt))];
  return (
    <>
      {days.map((d) => (
        <section key={d} className="kf-day" aria-label={dayLabel(d)}>
          <h3 className="kf-date tnum">{dayLabel(d)}</h3>
          <ul className="kf-list">
            {rows.filter((r) => r.rcept_dt === d).map((r) => (
              <KeyFilingRow key={r.rcept_no} f={r} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

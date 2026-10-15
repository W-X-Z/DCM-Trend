import Link from 'next/link';
import type { Metadata } from 'next';
import { Info, PageHead } from '@/components/Ui';
import { KeyFilingDays, dayLabel } from '@/components/KeyFilingList';
import { FILING_GROUPS, FILING_PERIODS, daysAgo, isIssuer, kstToday, type FilingGroupKey } from '@/lib/filings';
import { getKeyFilings } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '주요 공시' };

const SHOW = 120;

type Params = { p?: string; g?: string; issuer?: string };

function href(cur: Params, next: Params) {
  const m = { ...cur, ...next };
  const qs = new URLSearchParams();
  if (m.p && m.p !== '30') qs.set('p', m.p);
  if (m.g) qs.set('g', m.g);
  if (m.issuer === '1') qs.set('issuer', '1');
  const s = qs.toString();
  return s ? `/filings?${s}` : '/filings';
}

export default async function FilingsPage({ searchParams }: { searchParams: Params }) {
  const period = FILING_PERIODS.find((p) => p.key === searchParams.p) ?? FILING_PERIODS[1];
  const group = FILING_GROUPS.find((g) => g.key === (searchParams.g as FilingGroupKey));
  const issuerOnly = searchParams.issuer === '1';
  const cur: Params = { p: period.key, g: group?.key, issuer: issuerOnly ? '1' : undefined };
  const today = kstToday();
  const since = daysAgo(period.days, today);

  const all = await getKeyFilings({ since: daysAgo(90, today) }).catch(() => null);
  if (all === null) {
    return (
      <main id="main" className="wrap">
        <PageHead title="주요 공시" />
        <p className="empty">공시를 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      </main>
    );
  }
  const inPeriod = all.filter((f) => f.rcept_dt >= since && (!issuerOnly || isIssuer(f)));
  const shown = group ? inPeriod.filter((f) => f.grp === group.grp) : inPeriod;

  // 종류별 건수 (선택한 묶음 안)
  const byKind = new Map<string, { label: string; n: number; grp: string }>();
  for (const f of shown) {
    const e = byKind.get(f.rule_key) ?? { label: f.label, n: 0, grp: f.grp };
    e.n += 1;
    byKind.set(f.rule_key, e);
  }
  const kinds = [...byKind.values()].sort((a, b) => b.n - a.n);
  const maxN = Math.max(1, ...kinds.map((k) => k.n));

  return (
    <main id="main" className="wrap filings">
      <PageHead
        title="주요 공시"
        info="OpenDART 공시 가운데 자금 수요·지배구조 변화·신용 위험으로 이어질 공시를 규칙으로 골랐습니다. 금액·상대방·자기자본 대비는 공시 원문에서 읽은 값입니다. 정정 공시는 뺐습니다."
      >
        <p className="page-sub muted small tnum">{dayLabel(since)} ~ {dayLabel(today)}</p>
      </PageHead>

      <div className="kf-controls">
        <nav className="seg" aria-label="기간">
          {FILING_PERIODS.map((p) => (
            <Link key={p.key} href={href(cur, { p: p.key })} scroll={false} aria-current={p.key === period.key ? 'true' : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
        <nav className="chips" aria-label="공시 묶음">
          <Link href={href(cur, { g: undefined })} scroll={false} aria-current={!group ? 'true' : undefined}>
            전체<span className="tnum">{inPeriod.length}</span>
          </Link>
          {FILING_GROUPS.map((g) => (
            <Link key={g.key} href={href(cur, { g: g.key })} scroll={false} aria-current={group?.key === g.key ? 'true' : undefined} title={g.hint}>
              {g.grp}<span className="tnum">{inPeriod.filter((f) => f.grp === g.grp).length}</span>
            </Link>
          ))}
        </nav>
        <Link
          className={`toggle${issuerOnly ? ' is-on' : ''}`}
          href={href(cur, { issuer: issuerOnly ? undefined : '1' })}
          scroll={false}
          aria-pressed={issuerOnly}
        >
          회사채 발행사만
          <Info>공모 회사채 발행 이력이나 신용등급, 미상환 회사채 잔액이 있는 회사</Info>
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="empty">이 조건의 공시가 없습니다. 기간을 늘리거나 묶음을 바꿔 보세요.</p>
      ) : (
        <div className="kf-layout">
          <aside className="kf-kinds" aria-labelledby="kf-kinds-h">
            <h2 id="kf-kinds-h" className="sub-h">종류별 건수</h2>
            <ul>
              {kinds.map((k) => (
                <li key={k.label} className={`g-${FILING_GROUPS.find((x) => x.grp === k.grp)?.key ?? 'asset'}`}>
                  <span className="kf-kinds-label">{k.label}</span>
                  <span className={`kf-kinds-bar g-${FILING_GROUPS.find((x) => x.grp === k.grp)?.key ?? 'asset'}`} style={{ width: `${Math.max(4, (k.n / maxN) * 100)}%` }} aria-hidden />
                  <span className="kf-kinds-n tnum">{k.n}</span>
                </li>
              ))}
            </ul>
          </aside>
          <div className="kf-feed">
            <KeyFilingDays rows={shown.slice(0, SHOW)} />
            {shown.length > SHOW && (
              <details className="disc-more">
                <summary>{shown.length - SHOW}건 더 보기</summary>
                <KeyFilingDays rows={shown.slice(SHOW)} />
              </details>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

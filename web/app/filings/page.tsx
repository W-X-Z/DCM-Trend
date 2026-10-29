import Link from 'next/link';
import type { Metadata } from 'next';
import { FabContext } from '@/components/Fab';
import { PageHead } from '@/components/Ui';
import { dayLabel } from '@/components/KeyFilingList';
import {
  DISC_AMOUNTS, DISC_MARKETS, DISC_PERIODS, DISC_SORTS, DISC_TYPES, buildDisc, discHref, hiddenFilterCount, parseDisc,
  type DiscEvent, type DiscParams, type DiscRow,
} from '@/lib/disclosures';
import { daysAgo, kstToday } from '@/lib/filings';
import { date, num, won } from '@/lib/format';
import { getExpansionCompanies, getExpansionEvents, getFundingSince, getKeyFilings, getNhLeadCorps } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '주요공시' };

const SHOW = 150;
const pct1 = (v: number | null | undefined) => (v == null ? '–' : `${num(Number(v), 1)}%`);

function Tags({ evs }: { evs: DiscEvent[] }) {
  const seen = new Map<string, DiscEvent>();
  for (const e of evs) if (!seen.has(e.tag)) seen.set(e.tag, e);
  const list = [...seen.values()];
  return (
    <span className="xp-tags">
      {list.slice(0, 3).map((e) => (
        <span key={e.tag} className={`xp-tag ${e.cls}`}>{e.tag}</span>
      ))}
      {list.length > 3 && <span className="muted small">+{list.length - 3}</span>}
    </span>
  );
}

function Funding({ r }: { r: DiscRow }) {
  return (
    <span className="xp-fund">
      {r.funding.slice(0, 2).map((d, i) => (
        <span key={i} className="xp-fund-i">
          {d.product_type === 'mezz' ? d.sub_type ?? d.product_label : d.product_label} {won(d.amount_krw)}{' '}
          <span className="muted">{date(d.deal_dt).slice(2)}</span>
        </span>
      ))}
      {r.funding.length > 2 && <span className="muted">외 {r.funding.length - 2}건</span>}
      {r.funding.length === 0 && <span className="muted">없음</span>}
      {r.noFundingAfter && r.funding.length > 0 && <span className="xp-gap">공시 후 조달 없음</span>}
    </span>
  );
}

function Events({ evs }: { evs: DiscEvent[] }) {
  return (
    <div className="table-wrap xp-evs">
      <table className="data compact">
        <caption className="sr-only">공시 내역</caption>
        <thead>
          <tr>
            <th>공시일</th>
            <th>공시</th>
            <th className="num">금액</th>
            <th className="num">규모 비율</th>
            <th>내용</th>
            <th><span className="sr-only">원문</span></th>
          </tr>
        </thead>
        <tbody>
          {evs.map((e) => (
            <tr key={e.id}>
              <td className="nowrap">
                {date(e.dt)}
                {e.amend && <span className="cell-sub">정정</span>}
              </td>
              <td>
                <span className={`xp-tag ${e.cls}`}>{e.tag}</span>
                <span className="cell-sub">{e.src}</span>
              </td>
              <td className="num">{won(e.amount)}</td>
              <td className="num">
                {pct1(e.ratio)}
                {e.ratio != null && e.ratioBasis && <span className="cell-sub">{e.ratioBasis} 대비</span>}
              </td>
              <td className="xp-what">
                {e.what}
                {e.sub && <span className="cell-sub">{e.sub}</span>}
              </td>
              <td><a href={e.url} target="_blank" rel="noreferrer">원문</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ r }: { r: DiscRow }) {
  return (
    <details className={`xp-item${r.nh ? ' is-nh' : ''}`} role="listitem">
      <summary className="xp-row">
        <span className="xp-co">
          <Link href={`/company/${r.corp_code}`} className="xp-name">{r.corp_name}</Link>
          <span className="cell-sub">
            {r.market && r.market !== '기타' ? r.market : '비상장'}
            {r.rating ? `, ${r.rating}` : ''}
          </span>
          {r.nh && <span className="xp-nh">NH 대표주관 이력</span>}
        </span>
        <Tags evs={r.evs} />
        <span className="num xp-amt" data-k="가장 큰 건">
          {won(r.top.amount)}
          <span className="cell-sub">{r.evs.length}건</span>
        </span>
        <span className="num" data-k="최대 규모 비율">
          {pct1(r.maxRatio?.ratio)}
          {r.maxRatio?.ratioBasis && <span className="cell-sub">{r.maxRatio.ratioBasis} 대비</span>}
        </span>
        <span className="num nowrap" data-k="최근 공시">{date(r.last_dt)}</span>
        <span className="xp-what">
          <span className="xp-clamp">{r.top.what}</span>
          <span className="cell-sub">{r.top.tag}</span>
        </span>
        <Funding r={r} />
        <span className="xp-cta">
          <Link href={`/proposal/deck?corp=${r.corp_code}&from=%2Ffilings`} className="cta-sm" aria-label={`${r.corp_name} 제안서 초안`}>제안서 초안</Link>
          <span className="xp-more" aria-hidden>근거 {r.evs.length}</span>
        </span>
      </summary>
      <Events evs={r.evs} />
    </details>
  );
}

export default async function FilingsPage({ searchParams }: { searchParams: DiscParams }) {
  const f = parseDisc(searchParams);
  const today = kstToday();
  const href = (patch: DiscParams) => discHref(f, patch);

  const [filings, expEvents, expCos, funding, nhCorps] = await Promise.all([
    getKeyFilings({ since: daysAgo(90, today) }).catch(() => null),
    getExpansionEvents().catch(() => null),
    getExpansionCompanies().catch(() => []),
    getFundingSince(daysAgo(365, today)).catch(() => []),
    getNhLeadCorps().catch(() => []),
  ]);

  const nHidden = hiddenFilterCount(f);
  const periods = DISC_PERIODS.filter((p) => !('expOnly' in p) || f.type === 'exp');

  const head = (
    <PageHead
      title="주요공시"
      info="자금 수요·지배구조 변화·신용 위험으로 이어질 공시와 사업 확장 결정(신규시설투자, 유형자산·지분·영업 양수 중 확장 목적)을 회사별로 묶었습니다. 금액·자기자본 대비는 공시 원문에서 읽은 값이고, 정정 공시는 최신본만 씁니다. 조달은 DART 발행 공시(공모채·메자닌·유상증자·IPO)만 보며 은행 차입은 빠져 있습니다."
    />
  );

  if (filings === null || expEvents === null) {
    return (
      <main id="main" className="wrap filings">
        {head}
        <p className="empty">공시를 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      </main>
    );
  }

  const { rows, counts, total, since } = buildDisc({ filings, expEvents, expCos, funding, nhCorps }, f, today);

  return (
    <main id="main" className="wrap filings">
      {head}
      <FabContext
        label={`주요공시 ${f.type ? DISC_TYPES.find((t) => t.key === f.type)?.label : ''}`.trim()}
        companies={rows.slice(0, 10).map((r) => ({ c: r.corp_code, n: r.corp_name, sub: `${r.top.tag} · ${date(r.last_dt)}` }))}
      />

      <div className="kf-controls">
        <nav className="seg" aria-label="기간">
          {periods.map((p) => (
            <Link key={p.key} href={href({ p: p.key })} scroll={false} aria-current={p.key === f.period.key ? 'true' : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
        <nav className="chips" aria-label="공시 유형">
          <Link href={href({ t: '' })} scroll={false} aria-current={!f.type ? 'true' : undefined}>
            전체<span className="tnum">{total}</span>
          </Link>
          {DISC_TYPES.map((t) => (
            <Link key={t.key} href={href({ t: t.key })} scroll={false} aria-current={f.type === t.key ? 'true' : undefined} title={t.hint}>
              {t.label}
              <span className="tnum">{counts[t.key]}</span>
            </Link>
          ))}
        </nav>
        <details className="fx">
          <summary className="fx-btn" aria-label={`필터 더 보기${nHidden ? `, ${nHidden}개 적용 중` : ''}`} title="필터">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
              <path d="M3 4.5h14l-5.5 6.2v4.6l-3 1.7v-6.3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            {nHidden > 0 && <span className="fx-n tnum">{nHidden}</span>}
          </summary>
          <div className="fx-panel">
            <div className="fx-row">
              <span className="fx-k">시장</span>
              <span className="seg">
                {DISC_MARKETS.map((m) => (
                  <Link key={m.key} href={href({ m: m.key })} scroll={false} aria-current={f.market === m.key ? 'true' : undefined}>{m.label}</Link>
                ))}
              </span>
            </div>
            <div className="fx-row">
              <span className="fx-k">금액</span>
              <span className="seg">
                {DISC_AMOUNTS.map((a) => (
                  <Link key={a.key} href={href({ a: a.key })} scroll={false} aria-current={f.amount.key === a.key ? 'true' : undefined}>{a.label}</Link>
                ))}
              </span>
            </div>
            <div className="fx-row">
              <span className="fx-k">조건</span>
              <span className="fx-toggles">
                <Link className={`toggle${f.gap ? ' is-on' : ''}`} href={href({ gap: f.gap ? '' : '1' })} scroll={false} aria-pressed={f.gap}>공시 후 조달 없음</Link>
                <Link className={`toggle${f.issuer ? ' is-on' : ''}`} href={href({ issuer: f.issuer ? '' : '1' })} scroll={false} aria-pressed={f.issuer}>회사채 발행사만</Link>
                <Link className={`toggle${f.nh ? ' is-on' : ''}`} href={href({ nh: f.nh ? '' : '1' })} scroll={false} aria-pressed={f.nh}>NH 대표주관 이력</Link>
              </span>
            </div>
            <div className="fx-foot">
              {nHidden > 0 && <Link href={href({ m: 'all', a: '0', gap: '', issuer: '', nh: '' })} scroll={false}>필터 지우기</Link>}
              {f.type === 'exp' && <a href="/api/expansion" download>사업 확장 CSV</a>}
            </div>
          </div>
        </details>
      </div>

      <section className="section" aria-labelledby="kf-list-h">
        <div className="section-head">
          <h2 id="kf-list-h">
            {f.type ? DISC_TYPES.find((t) => t.key === f.type)?.label : '전체 유형'}, {num(rows.length)}곳
            <span className="muted small tnum kf-range"> {f.period.days > 90 ? `${date(since)} ~ ${date(today)}` : `${dayLabel(since)} ~ ${dayLabel(today)}`}</span>
          </h2>
          <div className="section-right">
            <span className="seg" aria-label="정렬">
              {DISC_SORTS.map((s) => (
                <Link key={s.key} href={href({ s: s.key })} aria-current={f.sort === s.key ? 'true' : undefined} scroll={false}>{s.label}</Link>
              ))}
            </span>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="empty">조건에 맞는 공시가 없습니다. 기간을 늘리거나 필터를 줄여 보세요.</p>
        ) : (
          <div className="xp-list" role="list">
            <div className="xp-row xp-headrow" aria-hidden>
              <span>회사</span>
              <span>공시 유형</span>
              <span className="num">가장 큰 건</span>
              <span className="num">최대 규모 비율</span>
              <span className="num">최근 공시</span>
              <span>주요 내용</span>
              <span>최근 1년 조달</span>
              <span />
            </div>
            {rows.slice(0, SHOW).map((r) => (
              <Row key={r.corp_code} r={r} />
            ))}
            {rows.length > SHOW && (
              <details className="disc-more xp-rest">
                <summary>{rows.length - SHOW}곳 더 보기</summary>
                {rows.slice(SHOW).map((r) => (
                  <Row key={r.corp_code} r={r} />
                ))}
              </details>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

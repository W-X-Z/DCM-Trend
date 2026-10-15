import Link from 'next/link';
import type { Metadata } from 'next';
import { CompanySearch } from '@/components/CompanySearch';
import { PageHead } from '@/components/Ui';
import { DRAFT_TYPES, STATUS_LABEL, buildDraft, needsOf, type DraftType, type Section, type Status } from '@/lib/proposal';
import { getFeed, getInsightIssues } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '제안서 초안' };

const no = (i: number) => String(i + 1).padStart(2, '0');

function Slide({ s, i }: { s: Section; i: number }) {
  return (
    <article id={`s-${no(i)}`} className={`pp-slide st-${s.status}`} aria-labelledby={`s-${no(i)}-h`}>
      <header className="pp-slide-head">
        <span className="pp-no tnum" aria-hidden>{no(i)}</span>
        <h3 id={`s-${no(i)}-h`}>{s.title}</h3>
        <span className="pp-st">{STATUS_LABEL[s.status]}</span>
      </header>
      <div className="pp-lines">
        {s.lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      {s.table && (
        <div className="table-wrap">
          <table className="data compact">
            <caption className="sr-only">{s.title}</caption>
            <thead>
              <tr>
                {s.table.head.map((h, j) => (
                  <th key={h} className={s.table!.num?.includes(j) ? 'num' : undefined}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((r, k) => (
                <tr key={k} className={r.some((v) => /NH투자/.test(v)) ? 'row-nh' : undefined}>
                  {r.map((v, j) => (
                    <td key={j} className={s.table!.num?.includes(j) ? 'num' : undefined}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.needs && s.needs.length > 0 && (
        <ul className="pp-needs" aria-label="추가로 받아야 할 데이터">
          {s.needs.map((n) => (
            <li key={n.data}>
              <span className="pp-need-k">추가 필요</span>
              <span className="pp-need-d">{n.data}</span>
              <span className="pp-need-f">{n.from}</span>
            </li>
          ))}
        </ul>
      )}
      {s.basis && <p className="pp-basis">출처: {s.basis}</p>}
    </article>
  );
}

async function Start() {
  const [issues, feed] = await Promise.all([getInsightIssues().catch(() => []), getFeed().catch(() => [])]);
  const touch = issues.filter((i) => i.kind === 'touchpoint');
  const seen = new Set<string>();
  const feedCorps = feed.filter((f) => !seen.has(f.corp_code) && seen.add(f.corp_code));
  return (
    <div className="pp-start">
      <div className="pp-search">
        <CompanySearch mode="proposal" placeholder="제안할 회사 이름" />
      </div>
      {touch.length > 0 && (
        <section className="pp-picks" aria-labelledby="pk-touch">
          <h2 id="pk-touch" className="sub-h">다가오는 영업 접점에서 고르기</h2>
          <ul>
            {touch.map((t) => (
              <li key={t.corp_code}>
                <Link href={`/proposal?corp=${t.corp_code}`}>
                  <span className="pk-name">{t.corp_name}</span>
                  <span className="pk-why">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {feedCorps.length > 0 && (
        <section className="pp-picks" aria-labelledby="pk-feed">
          <h2 id="pk-feed" className="sub-h">최근 2주 피드에 나온 회사</h2>
          <ul>
            {feedCorps.map((f) => (
              <li key={f.corp_code}>
                <Link href={`/proposal?corp=${f.corp_code}`}>
                  <span className="pk-name">{f.corp_name}</span>
                  <span className="pk-why">{f.kind_label ?? f.tag}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default async function ProposalPage({ searchParams }: { searchParams: { corp?: string; type?: string } }) {
  const corp = searchParams.corp && /^[0-9A-Za-z_]{1,20}$/.test(searchParams.corp) ? searchParams.corp : null;
  const type = searchParams.type === 'bond' || searchParams.type === 'mezz' ? (searchParams.type as DraftType) : undefined;
  const head = (
    <PageHead
      title="제안서 초안"
      info="회사를 고르면 딜 유형별 제안서 구성에 맞춰 공개 데이터(DART·ECOS)로 채울 수 있는 장표를 채우고, 채울 수 없는 장표는 추가로 받아야 할 데이터와 받을 곳을 알려 줍니다. 구조·조건처럼 판단이 필요한 장표는 근거만 제공합니다."
    />
  );
  if (!corp) {
    return (
      <main id="main" className="wrap proposal">
        {head}
        <Start />
      </main>
    );
  }
  const d = await buildDraft(corp, type).catch(() => null);
  if (!d) {
    return (
      <main id="main" className="wrap proposal">
        {head}
        <p className="empty">회사를 찾지 못했거나 데이터를 불러오지 못했습니다. 다른 회사를 골라 보세요.</p>
        <Start />
      </main>
    );
  }
  const c = d.company;
  const count = (s: Status) => d.sections.filter((x) => x.status === s).length;
  const needs = needsOf(d);
  return (
    <main id="main" className="wrap proposal">
      {head}
      <div className="pp-head">
        <div className="pp-title">
          <h2>
            <Link href={`/company/${c.corp_code}`}>{c.corp_name}</Link>
          </h2>
          <span className="muted small">
            {c.market && c.market !== '기타' ? c.market : '비상장'}
            {c.latest_bond_rating ? `, 최근 회사채 등급 ${c.latest_bond_rating}` : ''}
          </span>
        </div>
        <nav className="seg" aria-label="딜 유형">
          {DRAFT_TYPES.map((t) => (
            <Link key={t.key} href={`/proposal?corp=${c.corp_code}&type=${t.key}`} aria-current={t.key === d.type ? 'true' : undefined} scroll={false}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="pp-actions">
          <a className="btn" href={`/api/proposal?corp=${c.corp_code}&type=${d.type}`} download>
            초안 내려받기 (.md)
          </a>
          <Link href="/proposal" className="small">다른 회사</Link>
        </div>
      </div>

      <section className="pp-mapwrap" aria-labelledby="pp-map-h">
        <h2 id="pp-map-h" className="sub-h">
          장표 구성
          <span className="pp-legend">
            <span className="lg st-filled">채움 {count('filled')}</span>
            <span className="lg st-partial">일부 {count('partial')}</span>
            <span className="lg st-needed">추가 필요 {count('needed')}</span>
          </span>
        </h2>
        <ol className="pp-map">
          {d.sections.map((s, i) => (
            <li key={s.key} className={`st-${s.status}`}>
              <a href={`#s-${no(i)}`}>
                <span className="tnum">{no(i)}</span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </section>

      <div className="pp-layout">
        <div className="pp-slides">
          {d.sections.map((s, i) => (
            <Slide key={s.key} s={s} i={i} />
          ))}
          <p className="pp-basis">기준일 {d.asof}. 숫자는 공시 값 그대로이며, 제안서에 옮기기 전에 공시 원문을 확인하세요.</p>
        </div>
        {needs.length > 0 && (
          <aside className="pp-aside" aria-labelledby="pp-need-h">
            <h2 id="pp-need-h" className="sub-h">추가로 받아야 할 데이터</h2>
            <ul>
              {needs.map((n) => (
                <li key={`${n.no}-${n.data}`}>
                  <a href={`#s-${no(n.no - 1)}`} className="tnum">{no(n.no - 1)}</a>
                  <div>
                    <p className="pa-d">{n.data}</p>
                    <p className="pa-f">{n.from}</p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </main>
  );
}

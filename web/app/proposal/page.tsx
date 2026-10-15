import Link from 'next/link';
import type { Metadata } from 'next';
import { CompanySearch } from '@/components/CompanySearch';
import { MaturityTable, groupByCorp } from '@/components/MaturityTable';
import { PageHead, SectionHead } from '@/components/Ui';
import { DRAFT_TYPES, STATUS_LABEL, buildDraft, needsOf, type DraftType, type Section, type Status } from '@/lib/proposal';
import { kstToday } from '@/lib/filings';
import { date, num, won } from '@/lib/format';
import { getMaturities } from '@/lib/queries';

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

// 첫 화면: 회사 검색 + 만기도래 회사 목록(오른쪽 버튼으로 바로 초안)
const WINDOWS = { '0-3': [0, 3], '3-6': [3, 6], '6-12': [6, 12] } as const;
type Win = keyof typeof WINDOWS;
const KINDS = { bond: '공모 회사채 만기', mezz: '메자닌 만기·풋옵션' } as const;
type SP = { corp?: string; type?: string; t?: string; w?: string };

function addMonths(base: string, n: number) {
  const x = new Date(`${base}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
}

function startHref(sp: SP, patch: SP) {
  const n = { ...sp, ...patch };
  const q = new URLSearchParams();
  if (n.t === 'mezz') q.set('t', 'mezz');
  if (n.w && n.w !== '3-6') q.set('w', n.w);
  const s = q.toString();
  return `/proposal${s ? `?${s}` : ''}`;
}

async function Start({ sp }: { sp: SP }) {
  const kind: DraftType = sp.t === 'mezz' ? 'mezz' : 'bond';
  const win: Win = (sp.w as Win) in WINDOWS ? (sp.w as Win) : '3-6';
  const today = kstToday();
  const from = addMonths(today, WINDOWS[win][0]);
  const to = addMonths(today, WINDOWS[win][1]);
  const rows = await getMaturities({ from, to, product: kind }).catch(() => null);
  // 금융사(은행·캐피탈·카드 등) 금융채는 뺀다. 인더스트리 커버리지 기준
  const groups = rows ? groupByCorp(rows.filter((r) => r.sub_type !== '금융채')) : [];
  groups.sort((x, y) => x.first_dt.localeCompare(y.first_dt));
  return (
    <div className="pp-start">
      <div className="pp-search">
        <CompanySearch mode="proposal" placeholder="제안할 회사 이름" />
      </div>
      <section aria-labelledby="pk-mat">
        <SectionHead
          id="pk-mat"
          title="만기도래 회사에서 고르기"
          info="공모 회사채는 트랜치별 만기일, 메자닌은 사채 만기일과 조기상환청구(풋) 시작일 기준입니다. 금융사 금융채는 뺐습니다. 오른쪽 '초안 만들기'를 누르면 해당 딜 유형의 초안이 열립니다."
          right={
            <div className="controls">
              <span className="seg" aria-label="종류">
                {(Object.keys(KINDS) as DraftType[]).map((k) => (
                  <Link key={k} href={startHref(sp, { t: k })} aria-current={kind === k} scroll={false}>{KINDS[k]}</Link>
                ))}
              </span>
              <span className="seg" aria-label="기간">
                {(Object.keys(WINDOWS) as Win[]).map((w) => (
                  <Link key={w} href={startHref(sp, { w })} aria-current={win === w} scroll={false}>{w.replace('-', '~')}개월 뒤</Link>
                ))}
              </span>
            </div>
          }
        />
        {rows === null ? (
          <p className="empty">만기 목록을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
        ) : groups.length === 0 ? (
          <p className="empty">이 기간에 도래하는 건이 없습니다.</p>
        ) : (
          <>
            <p className="pp-count">
              {date(from)} ~ {date(to)} 도래 <strong className="tnum">{num(groups.length)}곳</strong>, {won(groups.reduce((a, g) => a + g.amount, 0))}
            </p>
            <MaturityTable groups={groups} kind={kind} ctaLabel="초안 만들기" />
          </>
        )}
      </section>
    </div>
  );
}

export default async function ProposalPage({ searchParams }: { searchParams: SP }) {
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
        <Start sp={searchParams} />
      </main>
    );
  }
  const d = await buildDraft(corp, type).catch(() => null);
  if (!d) {
    return (
      <main id="main" className="wrap proposal">
        {head}
        <p className="empty">회사를 찾지 못했거나 데이터를 불러오지 못했습니다. 다른 회사를 골라 보세요.</p>
        <Start sp={{}} />
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

import Link from 'next/link';
import type { Metadata } from 'next';
import { PageHead } from '@/components/Ui';
import { date, num, won } from '@/lib/format';
import { EXP_AMOUNTS, EXP_CATS, EXP_DECISIONS, EXP_MARKETS, EXP_SORTS, applyExpFilter, expQuery, parseExpParams, type ExpParams } from '@/lib/expansion';
import { getExpansionCompanies, getExpansionEvents } from '@/lib/queries';
import type { ExpansionCat, ExpansionCompany, ExpansionEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '사업 확장 기업' };

const CATS = EXP_CATS;
const CAT_CLASS: Record<ExpansionCat, string> = {
  '생산·설비 증설': 'xc-cap', '부지·사업장 확보': 'xc-site', '인수·신사업': 'xc-mna', '연구·업무시설': 'xc-rnd',
};
const pct1 = (v: number | null | undefined) => (v == null ? '–' : `${num(Number(v), 1)}%`);

function Tags({ cats }: { cats: ExpansionCat[] }) {
  return (
    <span className="xp-tags">
      {CATS.filter((c) => cats.includes(c.key)).map((c) => (
        <span key={c.key} className={`xp-tag ${CAT_CLASS[c.key]}`}>{c.short}</span>
      ))}
    </span>
  );
}

function Funding({ c }: { c: ExpansionCompany }) {
  return (
    <span className="xp-fund">
      {c.funding.slice(0, 2).map((f, i) => (
        <span key={i} className="xp-fund-i">
          {f.type} {won(f.amount_krw)} <span className="muted">{date(f.dt).slice(2)}</span>
        </span>
      ))}
      {c.funding.length > 2 && <span className="muted">외 {c.funding.length - 2}건</span>}
      {c.funding.length === 0 && <span className="muted">없음</span>}
      {c.no_funding_after && <span className="xp-gap">결정 후 조달 없음</span>}
    </span>
  );
}

function Events({ evs }: { evs: ExpansionEvent[] }) {
  return (
    <div className="table-wrap xp-evs">
      <table className="data compact">
        <caption className="sr-only">확장 결정 공시</caption>
        <thead>
          <tr>
            <th>결정일</th>
            <th>공시</th>
            <th className="num">금액</th>
            <th className="num">규모 비율</th>
            <th>목적·대상</th>
            <th>자금 조달</th>
            <th><span className="sr-only">원문</span></th>
          </tr>
        </thead>
        <tbody>
          {evs.map((e) => (
            <tr key={e.rcept_no}>
              <td className="nowrap">
                {date(e.decided_dt)}
                {e.is_amendment && <span className="cell-sub" title="원 결정은 1년 넘게 전이고, 최근 1년에 금액·기간을 정정했습니다">정정 {date(e.rcept_dt)}</span>}
                {e.end_dt && <span className="cell-sub">투자 종료 {date(e.end_dt).slice(0, 7)}</span>}
              </td>
              <td>
                <span className={`xp-tag ${CAT_CLASS[e.cat]}`}>{CATS.find((c) => c.key === e.cat)?.short}</span>
                <span className="cell-sub">{e.src_label}{e.via_sub ? '(자회사)' : ''}</span>
              </td>
              <td className="num">{won(e.amount_krw)}</td>
              <td className="num">
                {pct1(e.ratio_pct)}
                {e.ratio_pct != null && <span className="cell-sub">{e.ratio_basis} 대비</span>}
              </td>
              <td className="xp-what">
                {e.purpose ?? '–'}
                {(e.target || e.detail) && (
                  <span className="cell-sub">
                    {[e.target, e.detail, e.stake_after_pct != null ? `인수 후 지분 ${num(Number(e.stake_after_pct), 1)}%` : null].filter(Boolean).join(' · ')}
                  </span>
                )}
              </td>
              <td className="xp-what">{e.funding_note ?? <span className="muted">–</span>}</td>
              <td><a href={e.dart_url} target="_blank" rel="noreferrer">원문</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ExpansionPage({ searchParams }: { searchParams: ExpParams }) {
  const f = parseExpParams(searchParams);
  const { cat, market, amount, gap, sort, decision } = f;
  const href = (patch: ExpParams) => `/expansion${expQuery(f, patch)}`;

  const [companies, events] = await Promise.all([
    getExpansionCompanies().catch(() => null),
    getExpansionEvents().catch(() => [] as ExpansionEvent[]),
  ]);

  const head = (
    <PageHead
      title="사업 확장 기업"
      info="최근 1년 신규시설투자, 유형자산 양수, 타법인 지분 인수, 영업양수 공시의 목적·대상 글을 읽어 사업 확장 결정만 골랐습니다. 임대·투자 목적 부동산, 지분 30% 미만 투자, 계열사 지분 정리, 금융사·리츠는 뺐습니다. 정정공시는 최신본만 쓰고, 1년 넘은 결정이라도 최근 1년에 정정했으면 '진행 중'으로 표시합니다."
    >
      <div className="controls">
        <span className="seg" aria-label="확장 유형">
          <Link href={href({ c: '' })} aria-current={!cat} scroll={false}>전체</Link>
          {CATS.map((c) => (
            <Link key={c.key} href={href({ c: c.key })} aria-current={cat === c.key} scroll={false} title={c.desc}>{c.short}</Link>
          ))}
        </span>
        <span className="seg" aria-label="시장">
          {EXP_MARKETS.map((m) => (
            <Link key={m.key} href={href({ m: m.key })} aria-current={market === m.key} scroll={false}>{m.label}</Link>
          ))}
        </span>
        <span className="seg" aria-label="확장 금액">
          {EXP_AMOUNTS.map((a) => (
            <Link key={a.key} href={href({ a: a.key })} aria-current={amount.key === a.key} scroll={false}>{a.label}</Link>
          ))}
        </span>
        <span className="seg" aria-label="조달">
          <Link href={href({ gap: '' })} aria-current={!gap} scroll={false}>조달 전체</Link>
          <Link href={href({ gap: '1' })} aria-current={gap} scroll={false}>결정 후 조달 없음</Link>
        </span>
        <span className="seg" aria-label="결정 시점">
          {EXP_DECISIONS.map((d) => (
            <Link key={d.key} href={href({ d: d.key })} aria-current={decision === d.key} scroll={false}>{d.label}</Link>
          ))}
        </span>
      </div>
    </PageHead>
  );

  if (companies === null) {
    return (
      <main id="main" className="wrap">
        {head}
        <p className="empty">목록을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      </main>
    );
  }

  const byCorp = new Map<string, ExpansionEvent[]>();
  for (const e of events) {
    const list = byCorp.get(e.corp_code) ?? [];
    list.push(e);
    byCorp.set(e.corp_code, list);
  }

  const rows = applyExpFilter(companies, f);

  const total = rows.reduce((s, c) => s + Number(c.amount_krw ?? 0), 0);
  const evCount = rows.reduce((s, c) => s + c.event_count, 0);

  return (
    <main id="main" className="wrap">
      {head}

      <dl className="stats">
        <div className="stat"><dt>기업</dt><dd>{num(rows.length)}<small>곳</small></dd></div>
        <div className="stat"><dt>확장 결정</dt><dd>{num(evCount)}<small>건</small></dd></div>
        <div className="stat"><dt>금액 합계</dt><dd>{won(total)}</dd></div>
        <div className="stat"><dt>결정 후 조달 없음</dt><dd>{num(rows.filter((c) => c.no_funding_after).length)}<small>곳</small></dd></div>
        <div className="stat"><dt>NH 대표주관 이력</dt><dd>{num(rows.filter((c) => c.nh_lead_ever).length)}<small>곳</small></dd></div>
      </dl>

      <section className="section" aria-labelledby="xp-list-h">
        <div className="section-head">
          <h2 id="xp-list-h">
            {cat ?? '전체 유형'}, {num(rows.length)}곳
          </h2>
          <div className="section-right">
            <span className="seg" aria-label="정렬">
              {EXP_SORTS.map((s) => (
                <Link key={s.key} href={href({ s: s.key })} aria-current={sort === s.key} scroll={false}>{s.label}</Link>
              ))}
            </span>
            <a className="small" href={`/api/expansion${expQuery(f)}`} download>CSV 내려받기</a>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="empty">조건에 맞는 기업이 없습니다. 유형이나 금액 조건을 넓혀 보세요.</p>
        ) : (
          <div className="xp-list" role="list">
            <div className="xp-row xp-headrow" aria-hidden>
              <span>회사</span>
              <span>확장 유형</span>
              <span className="num">확장 금액</span>
              <span className="num">최대 규모 비율</span>
              <span className="num">최근 결정</span>
              <span>가장 큰 결정</span>
              <span>최근 1년 조달</span>
              <span />
            </div>
            {rows.map((c) => {
              const evs = byCorp.get(c.corp_code) ?? [];
              return (
                <details key={c.corp_code} className={`xp-item${c.nh_lead_ever ? ' is-nh' : ''}`} role="listitem">
                  <summary className="xp-row">
                    <span className="xp-co">
                      <Link href={`/company/${c.corp_code}`} className="xp-name">{c.corp_name}</Link>
                      <span className="cell-sub">
                        {c.market && c.market !== '기타' ? c.market : '비상장'}
                        {c.latest_bond_rating ? `, ${c.latest_bond_rating}` : ''}
                      </span>
                      {c.nh_lead_ever && <span className="xp-nh">NH 대표주관 이력</span>}
                      {!c.has_new_decision && <span className="xp-ongo" title="최근 1년 공시는 이전 결정의 정정뿐입니다(투자 진행 중)">진행 중</span>}
                    </span>
                    <Tags cats={c.cats} />
                    <span className="num xp-amt" data-k="확장 금액">
                      {won(c.amount_krw)}
                      <span className="cell-sub">{c.event_count}건</span>
                    </span>
                    <span className="num" data-k="최대 규모 비율">
                      {pct1(c.max_ratio_pct)}
                      {c.max_ratio_pct != null && c.max_ratio_basis && <span className="cell-sub">{c.max_ratio_basis} 대비</span>}
                    </span>
                    <span className="num nowrap" data-k="최근 결정">{date(c.last_dt)}</span>
                    <span className="xp-what">
                      <span className="xp-clamp">{c.top_what ?? '–'}</span>
                      <span className="cell-sub">{c.top_src} {won(c.top_amount_krw)}</span>
                    </span>
                    <Funding c={c} />
                    <span className="xp-cta">
                      <Link href={`/proposal?corp=${c.corp_code}`} className="cta-sm" aria-label={`${c.corp_name} 제안서 초안`}>제안서 초안</Link>
                      <span className="xp-more" aria-hidden>근거 {evs.length}</span>
                    </span>
                  </summary>
                  <Events evs={evs} />
                </details>
              );
            })}
          </div>
        )}
        <p className="note">
          금액은 공시의 투자·양수 금액 그대로이며 여러 해에 걸쳐 나눠 집행될 수 있습니다. 규모 비율은 신규시설투자·지분 인수는 자기자본,
          유형자산·영업양수는 자산총액 대비입니다. 최근 1년 조달은 DART 발행 공시(공모 회사채, 메자닌, 유상증자, IPO)이며 은행 차입은 공시되지 않아 빠져 있습니다.
        </p>
      </section>
    </main>
  );
}

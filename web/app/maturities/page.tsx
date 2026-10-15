import Link from 'next/link';
import { Header } from '@/components/Chrome';
import { BarChart } from '@/components/BarChart';
import { InsightPanel } from '@/components/Insights';
import { date, month, num, pct, won } from '@/lib/format';
import { getMaturities, getMaturityMonthly, getShortDebt } from '@/lib/queries';
import type { Maturity, ShortDebt } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: '만기도래' };

const WINDOWS = { '0-3': [0, 3], '3-6': [3, 6], '6-12': [6, 12] } as const;
type Win = keyof typeof WINDOWS;
const TABS = { bond: '공모 회사채', mezz: '메자닌 만기·풋옵션', short: '사모채·CP·전단채 잔액' } as const;
type Tab = keyof typeof TABS;
type SP = { w?: string; t?: string; s?: string; fin?: string };

function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
}

function href(sp: SP, patch: SP) {
  const n = { ...sp, ...patch };
  const q = new URLSearchParams();
  if (n.t && n.t !== 'bond') q.set('t', n.t);
  if (n.w && n.w !== '3-6') q.set('w', n.w);
  if (n.s && n.s !== 'date') q.set('s', n.s);
  if (n.fin === '1') q.set('fin', '1');
  const s = q.toString();
  return `/maturities${s ? `?${s}` : ''}`;
}

type Group = {
  corp_code: string; corp_name: string; market: string | null; first_dt: string; amount: number;
  items: Maturity[]; leads: string[]; nh_lead: boolean; nh_involved: boolean; refi: boolean; rating: string | null;
};

function groupByCorp(rows: Maturity[]): Group[] {
  const map = new Map<string, Group>();
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

function MaturityTable({ groups, kind }: { groups: Group[]; kind: 'bond' | 'mezz' }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <caption className="sr-only">{kind === 'bond' ? '공모 회사채 만기 도래 회사' : '메자닌 만기·풋옵션 도래 회사'}</caption>
        <thead>
          <tr>
            <th>가장 빠른 날짜</th>
            <th>회사</th>
            <th className="num">금액</th>
            <th>{kind === 'bond' ? '만기 회차' : '도래 내역'}</th>
            <th>{kind === 'bond' ? '당시 대표주관' : '주선·주관'}</th>
            <th>신호</th>
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
                  {g.refi && <span className="badge hit" title="만기 전 120일 안에 새 회사채 신고서를 냈습니다">차환 진행</span>}
                  {g.nh_lead && <span className="badge">NH 대표주관 이력</span>}
                  {!g.nh_lead && g.nh_involved && <span className="badge">NH 인수 참여</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShortDebtTable({ rows }: { rows: ShortDebt[] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <caption className="sr-only">1년 안에 만기가 돌아오는 사모 포함 회사채·CP·전단채 잔액</caption>
        <thead>
          <tr>
            <th>회사</th>
            <th>보고서 기준일</th>
            <th className="num">회사채 1년 이하</th>
            <th className="num">그중 사모</th>
            <th className="num">CP 1년 이하</th>
            <th className="num">전단채</th>
            <th className="num">합계</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.corp_code}>
              <td>
                <Link href={`/company/${r.corp_code}`}>{r.corp_name}</Link>
                <span className="cell-sub">{r.market && r.market !== '기타' ? r.market : '비상장'}</span>
              </td>
              <td className="nowrap">{date(r.stlm_dt)}</td>
              <td className="num">{won(r.bond_1y_krw)}</td>
              <td className="num">{won(r.bond_private_1y_krw)}</td>
              <td className="num">{won(r.cp_1y_krw)}</td>
              <td className="num">{won(r.stb_krw)}</td>
              <td className="num"><strong>{won(r.total_1y_krw)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MaturitiesPage({ searchParams }: { searchParams: SP }) {
  const tab: Tab = (searchParams.t as Tab) in TABS ? (searchParams.t as Tab) : 'bond';
  const win: Win = (searchParams.w as Win) in WINDOWS ? (searchParams.w as Win) : '3-6';
  const sort = searchParams.s === 'amount' ? 'amount' : 'date';
  const fin = searchParams.fin === '1';
  const now = new Date(Date.now() + 9 * 3600_000);
  const [a, b] = WINDOWS[win];
  const from = addMonths(now, a);
  const to = addMonths(now, b);
  const m0 = `${now.toISOString().slice(0, 7)}-01`;

  const [rows, monthly, shortDebt] = await Promise.all([
    tab === 'short' ? Promise.resolve([] as Maturity[]) : getMaturities({ from, to, product: tab }).catch(() => null),
    getMaturityMonthly(m0, addMonths(new Date(`${m0}T00:00:00Z`), 12)).catch(() => []),
    tab === 'short' ? getShortDebt(200, undefined, fin).catch(() => null) : Promise.resolve([] as ShortDebt[]),
  ]);

  // 금융사(은행·캐피탈·카드 등)는 기본으로 뺀다. 인더스트리 커버리지 기준
  const filtered = rows ? rows.filter((r) => fin || r.sub_type !== '금융채') : null;
  const groups = filtered ? groupByCorp(filtered) : [];
  groups.sort((x, y) => (sort === 'amount' ? y.amount - x.amount : x.first_dt.localeCompare(y.first_dt)));
  const months12 = Array.from({ length: 12 }, (_, i) => addMonths(new Date(`${m0}T00:00:00Z`), i));
  const bondMonthly = months12.map((mm) => {
    const r = monthly.filter((x) => x.month.slice(0, 10) === mm && x.product_type === 'bond' && x.event_type === '만기');
    return { month: mm, amount: r.reduce((s, x) => s + Number(x.amount_krw ?? 0), 0), companies: r.reduce((s, x) => s + Number(x.company_count), 0) };
  });

  return (
    <>
      <Header active="maturities" />
      <main id="main" className="wrap">
        <div className="page-head">
          <h1 className="page-title">만기도래 발행사</h1>
          <p className="page-sub">
            만기가 다가오는 회사는 차환 발행 수요가 생깁니다. 공모 회사채는 트랜치별 만기일, 메자닌은 사채 만기일과 조기상환청구(풋) 시작일,
            사모채·CP·전단채는 정기보고서의 만기 구간별 잔액으로 봅니다.
          </p>
          <div className="controls">
            <span className="seg" aria-label="종류">
              {(Object.keys(TABS) as Tab[]).map((t) => (
                <Link key={t} href={href(searchParams, { t })} aria-current={tab === t}>{TABS[t]}</Link>
              ))}
            </span>
            {tab !== 'short' && (
              <>
                <span className="seg" aria-label="기간">
                  {(Object.keys(WINDOWS) as Win[]).map((w) => (
                    <Link key={w} href={href(searchParams, { w })} aria-current={win === w}>{w.replace('-', '~')}개월 뒤</Link>
                  ))}
                </span>
                <span className="seg" aria-label="정렬">
                  <Link href={href(searchParams, { s: 'date' })} aria-current={sort === 'date'}>날짜순</Link>
                  <Link href={href(searchParams, { s: 'amount' })} aria-current={sort === 'amount'}>금액순</Link>
                </span>
              </>
            )}
            {tab !== 'mezz' && (
              <span className="seg" aria-label="금융사">
                <Link href={href(searchParams, { fin: '0' })} aria-current={!fin}>금융사 제외</Link>
                <Link href={href(searchParams, { fin: '1' })} aria-current={fin}>금융사 포함</Link>
              </span>
            )}
          </div>
        </div>

        {tab !== 'short' && rows && (
          <dl className="stats">
            <div className="stat"><dt>회사</dt><dd>{num(groups.length)}<small>곳</small></dd></div>
            <div className="stat"><dt>{tab === 'bond' ? '트랜치' : '건'}</dt><dd>{num(filtered!.length)}<small>건</small></dd></div>
            <div className="stat"><dt>금액</dt><dd>{won(groups.reduce((s, g) => s + g.amount, 0))}</dd></div>
            <div className="stat"><dt>NH 대표주관 이력</dt><dd>{num(groups.filter((g) => g.nh_lead).length)}<small>곳</small></dd></div>
            {tab === 'bond' && <div className="stat"><dt>차환 진행</dt><dd>{num(groups.filter((g) => g.refi).length)}<small>곳</small></dd></div>}
          </dl>
        )}

        {tab === 'bond' && <InsightPanel scope="maturity" title="만기 규모 변화" maxCards={2} />}

        <section className="section" aria-labelledby="list-h">
          <div className="section-head">
            <h2 id="list-h">
              {tab === 'short' ? '1년 안에 만기가 돌아오는 잔액 상위 회사' : `${date(from)} ~ ${date(to)} 도래`}
            </h2>
            <p>
              {tab === 'bond' && '2019년 이후 증권신고서를 낸 공모 회사채 기준. 조기상환·매입소각은 반영되지 않습니다. 왼쪽 선은 NH 대표주관 이력'}
              {tab === 'mezz' && '2021년 이후 발행 결정 기준. 전환·조기상환으로 잔액이 줄었을 수 있습니다'}
              {tab === 'short' && '최근 정기보고서의 미상환 잔액. 공모·사모 회사채, 기업어음(CP), 단기사채(전단채)'}
            </p>
          </div>
          {tab === 'short' ? (
            shortDebt === null ? (
              <p className="empty">잔액을 불러오지 못했습니다.</p>
            ) : shortDebt.length === 0 ? (
              <p className="empty">정기보고서 잔액을 수집하고 있습니다. 상장사 전체를 받는 데 2~3일 걸립니다(하루 호출 한도).</p>
            ) : (
              <ShortDebtTable rows={shortDebt} />
            )
          ) : rows === null ? (
            <p className="empty">만기 목록을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
          ) : groups.length === 0 ? (
            <p className="empty">이 기간에 도래하는 건이 없습니다.</p>
          ) : (
            <MaturityTable groups={groups} kind={tab} />
          )}
        </section>

        {tab === 'bond' && (
          <section className="section" aria-labelledby="cal-h">
            <div className="section-head">
              <h2 id="cal-h">앞으로 12개월 공모 회사채 만기</h2>
              <p>월별 만기 금액</p>
            </div>
            <div className="chart-card">
              <BarChart
                title="월별 공모 회사채 만기 금액"
                color="var(--bond)"
                labelEvery={2}
                formatTick={(v) => won(v)}
                bars={bondMonthly.map((x) => ({ label: month(x.month), value: x.amount, tip: [won(x.amount), `${x.companies}곳`] }))}
              />
            </div>
          </section>
        )}
      </main>
    </>
  );
}

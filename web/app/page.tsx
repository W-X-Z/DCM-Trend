import Link from 'next/link';
import { Header, SearchForm } from '@/components/Chrome';
import { BarChart } from '@/components/BarChart';
import { Tombstone } from '@/components/Tombstone';
import { byMonth, monthList, sum } from '@/lib/agg';
import { month, won } from '@/lib/format';
import { getMaturities, getNotable, getRecentDeals, getTrend, getUiParam } from '@/lib/queries';
import { PRODUCTS, type BondTrendRow, type Deal, type Maturity, type ProductType } from '@/lib/types';
import { InsightPanel } from '@/components/Insights';
import { date } from '@/lib/format';

export const dynamic = 'force-dynamic';

async function productPanel(product: ProductType, bondCats: string[]) {
  const months = monthList(24);
  let rows = await getTrend<BondTrendRow>(product, months[0]);
  if (product === 'bond' && bondCats.length) rows = rows.filter((r) => bondCats.includes(r.category ?? ''));
  const series = byMonth(rows, months);
  const last12 = series.slice(-12);
  return { product, series, amount12: sum(last12, (p) => p.amount), count12: sum(last12, (p) => p.count) };
}

function recentIssuers(deals: Deal[]): { corp_code: string; corp_name: string }[] {
  const seen = new Map<string, string>();
  for (const d of deals) if (!seen.has(d.corp_code) && seen.size < 6) seen.set(d.corp_code, d.corp_name);
  return [...seen].map(([corp_code, corp_name]) => ({ corp_code, corp_name }));
}

function addMonths(n: number) {
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function topMaturing(rows: Maturity[]) {
  const map = new Map<string, { corp_code: string; corp_name: string; amount: number; first: string; nh: boolean; refi: boolean }>();
  for (const r of rows) {
    const g = map.get(r.corp_code) ?? { corp_code: r.corp_code, corp_name: r.corp_name, amount: 0, first: r.event_dt, nh: false, refi: false };
    g.amount += Number(r.amount_krw ?? 0);
    if (r.event_dt < g.first) g.first = r.event_dt;
    g.nh ||= r.nh_lead;
    g.refi ||= r.refi_signal;
    map.set(r.corp_code, g);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export default async function Home() {
  const bondCats = (await getUiParam<string[]>('bond_trend_categories').catch(() => null)) ?? [];
  const since30 = new Date(Date.now() + 9 * 3600_000 - 30 * 86400_000).toISOString().slice(0, 10);
  const [panels, notable, recentBonds, maturing] = await Promise.all([
    Promise.all(PRODUCTS.map((p) => productPanel(p.key, bondCats))).catch(() => null),
    getNotable(since30, 80).catch(() => null),
    getRecentDeals('bond', { subTypes: bondCats, limit: 40 }).catch(() => []),
    getMaturities({ from: addMonths(3), to: addMonths(6), product: 'bond', eventType: '만기' }).catch(() => null),
  ]);
  const examples = recentIssuers(recentBonds);
  const mat = maturing ? topMaturing(maturing.filter((m) => m.sub_type !== '금융채')) : [];

  return (
    <>
      <Header showSearch={false} />
      <main id="main">
        <section className="hero">
          <div className="wrap">
            <h1>어느 회사를 만나러 가시나요?</h1>
            <p className="lede">
              발행사 이름을 넣으면 그 회사의 공모 회사채, 메자닌, 유상증자 이력과 조건이 비슷한 다른 회사의 딜을 함께 보여줍니다.
            </p>
            <SearchForm size="large" />
            {examples.length > 0 && (
              <p className="examples">
                <span>최근 회사채 발행사</span>
                {examples.map((e) => (
                  <Link key={e.corp_code} href={`/company/${e.corp_code}`}>{e.corp_name}</Link>
                ))}
              </p>
            )}
          </div>
        </section>

        <div className="wrap">
          <InsightPanel scope="home" title="최근 3개월 눈에 띄는 변화" maxCards={6} />

          {maturing && (
            <section className="section" aria-labelledby="mat-h">
              <div className="section-head">
                <h2 id="mat-h">3~6개월 뒤 공모채 만기가 돌아오는 회사 (금융사 제외)</h2>
                <p>
                  {mat.length}곳, {won(mat.reduce((s, g) => s + g.amount, 0))}. <Link href="/maturities">전체 목록 보기</Link>
                </p>
              </div>
              {mat.length === 0 ? (
                <p className="empty">이 기간에 만기가 돌아오는 공모 회사채가 없습니다.</p>
              ) : (
                <ol className="mat-top">
                  {mat.slice(0, 8).map((g) => (
                    <li key={g.corp_code}>
                      <Link href={`/company/${g.corp_code}`}>{g.corp_name}</Link>
                      <span className="tnum">{won(g.amount)}</span>
                      <span className="muted tnum">{date(g.first)}</span>
                      {g.refi && <span className="badge hit">차환 진행</span>}
                      {g.nh && <span className="badge">NH 이력</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <section className="section" aria-labelledby="market-h">
            <div className="section-head">
              <h2 id="market-h">최근 12개월 발행시장</h2>
              <p>막대는 최근 24개월 월별 발행금액, 이번 달은 진행 중</p>
            </div>
            {panels ? (
              <div className="panels">
                {panels.map((p) => {
                  const meta = PRODUCTS.find((x) => x.key === p.product)!;
                  return (
                    <article key={p.product} className={`panel p-${p.product}`}>
                      <div className="panel-head">
                        <h3>{p.product === 'bond' && bondCats.length ? bondCats.join(', ') : meta.label}</h3>
                        <Link href={`/trends/${p.product}`}>{meta.label} 동향 보기</Link>
                      </div>
                      <div className="panel-figures">
                        <strong>{won(p.amount12)}</strong>
                        <span>{p.count12.toLocaleString('ko-KR')}건</span>
                      </div>
                      <BarChart
                        compact
                        height={64}
                        partialLast
                        color={`var(--${p.product})`}
                        title={`${meta.label} 월별 발행금액`}
                        bars={p.series.map((s) => ({
                          label: month(s.month),
                          value: s.amount,
                          tip: [`${won(s.amount)}`, `${s.count}건`],
                        }))}
                      />
                      <p className="note" style={{ marginTop: 0 }}>{meta.unitNote}</p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="empty">발행시장 집계를 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
            )}
          </section>

          <section className="section" aria-labelledby="notable-h">
            <div className="section-head">
              <h2 id="notable-h">최근 30일 눈에 띄는 딜</h2>
              <p>대형, 증액, 미달, 수집 기간 내 첫 발행</p>
            </div>
            {notable === null ? (
              <p className="empty">딜 목록을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
            ) : notable.length === 0 ? (
              <p className="empty">최근 30일 동안 기준에 해당하는 딜이 없습니다.</p>
            ) : (
              <div className="tombstones">
                {notable.slice(0, 16).map(({ deal, reasons }) => (
                  <Tombstone key={deal.deal_key} deal={deal} reasons={reasons} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

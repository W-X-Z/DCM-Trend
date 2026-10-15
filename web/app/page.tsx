import Link from 'next/link';
import { BarChart } from '@/components/BarChart';
import { FeedSection, TouchpointSection, type FeedFilter } from '@/components/Feed';
import { SectionHead } from '@/components/Ui';
import { byMonth, monthList, sum } from '@/lib/agg';
import { factChange, month, won } from '@/lib/format';
import { getInsightFacts, getTrend, getUiParam } from '@/lib/queries';
import { PRODUCTS, type BondTrendRow, type ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function productPanel(product: ProductType, bondCats: string[]) {
  const months = monthList(24);
  let rows = await getTrend<BondTrendRow>(product, months[0]);
  if (product === 'bond' && bondCats.length) rows = rows.filter((r) => bondCats.includes(r.category ?? ''));
  const series = byMonth(rows, months);
  const last12 = series.slice(-12);
  return { product, series, amount12: sum(last12, (p) => p.amount), count12: sum(last12, (p) => p.count) };
}

export default async function Home({ searchParams }: { searchParams: { feed?: string } }) {
  const filter: FeedFilter = searchParams.feed === 'issue' || searchParams.feed === 'disc' ? searchParams.feed : 'all';
  const bondCats = (await getUiParam<string[]>('bond_trend_categories').catch(() => null)) ?? [];
  const [panels, facts] = await Promise.all([
    Promise.all(PRODUCTS.map((p) => productPanel(p.key, bondCats))).catch(() => null),
    getInsightFacts().catch(() => []),
  ]);
  const amountFact = (p: ProductType) => facts.find((f) => f.fact_key === `${p}_amount`);

  return (
    <main id="main" className="wrap home">
      <h1 className="sr-only">발행시장 트렌드 홈</h1>
      <FeedSection filter={filter} />
      <TouchpointSection />

      <section className="section" aria-labelledby="market-h">
        <SectionHead
          id="market-h"
          title="최근 12개월 발행시장"
          info="숫자는 최근 12개월 합계, 막대는 24개월 월별 발행금액(이번 달은 진행 중). 아래 비율은 최근 3개월을 전년 같은 기간과 비교한 값입니다."
        />
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
                  {amountFact(p.product)?.change != null && (
                    <p className="panel-delta">
                      최근 3개월 <strong>{factChange('krw', amountFact(p.product)!.change)}</strong> 전년 대비
                    </p>
                  )}
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
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty">발행시장 집계를 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
        )}
      </section>
    </main>
  );
}

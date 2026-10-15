import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BarChart, InlineBar } from '@/components/BarChart';
import { DealTable } from '@/components/DealTable';
import { byKey, byMonth, monthList, share, sum, weightedAvg, type Slice } from '@/lib/agg';
import { month, num, pct, won } from '@/lib/format';
import { DATE_BASIS } from '@/lib/labels';
import { getBondIssues, getFees, getLeague, getMetrics, getRecentDeals, getTrend, getUiParam } from '@/lib/queries';
import { PRODUCTS, type BondTrendRow, type EquityTrendRow, type FeeRow, type IpoTrendRow, type MezzTrendRow, type ProductType } from '@/lib/types';
import { ChangeTiles } from '@/components/Insights';
import { BondIssueTable, TrancheSection } from '@/components/Tranche';
import { Info, PageHead, ProductTabs, SectionHead } from '@/components/Ui';

export const dynamic = 'force-dynamic';

const TITLES: Record<ProductType, string> = { bond: '회사채 발행 동향', mezz: '메자닌 발행 동향', equity: '유상증자 동향', ipo: 'IPO 동향' };
const SUBS: Record<ProductType, string> = {
  bond: '증권신고서(채무증권)를 낸 공모 회사채. 트랜치(회차)마다 한 건. 등급·밴드·확정 가산금리·경쟁률은 발행조건확정 신고서 본문에서 읽습니다.',
  mezz: '전환사채(CB), 신주인수권부사채(BW), 교환사채(EB) 발행 결정 공시. 공모와 사모 모두.',
  equity: '상장사 유상증자 결정 공시. 정정 공시는 처음 결정한 딜에 합칩니다.',
  ipo: '비상장사(코넥스 이전상장 포함)의 지분증권 일반공모. 스팩·리츠는 구분해서 세고, 철회한 공모는 뺍니다. 밴드·확정공모가·경쟁률은 발행조건확정 신고서 본문에서 읽습니다.',
};

export function generateMetadata({ params }: { params: { product: string } }) {
  const p = params.product as ProductType;
  return { title: TITLES[p] ?? '동향' };
}

type SP = { m?: string; cat?: string };

function href(product: string, sp: SP, patch: SP) {
  const q = new URLSearchParams();
  const next = { ...sp, ...patch };
  if (next.m && next.m !== '12') q.set('m', next.m);
  if (next.cat) q.set('cat', next.cat);
  const s = q.toString();
  return `/trends/${product}${s ? `?${s}` : ''}`;
}

function Breakdown({ title, slices, color, note }: { title: string; slices: Slice[]; color: string; note?: string }) {
  const total = sum(slices, (s) => s.amount);
  const max = Math.max(...slices.map((s) => s.amount), 0);
  return (
    <div>
      <h3 className="sub-h">
        {title}
        {note && <Info>{note}</Info>}
      </h3>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>구분</th>
              <th className="num">건수</th>
              <th className="num">금액</th>
              <th className="num">비중</th>
              <th aria-hidden style={{ width: '32%' }} />
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.key}>
                <td>{s.key}</td>
                <td className="num">{num(s.count)}</td>
                <td className="num">{won(s.amount)}</td>
                <td className="num">{pct(share(s.amount, total), 1)}</td>
                <td><InlineBar value={s.amount} max={max} color={color} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function feeByQuarter(fees: FeeRow[], subTypes: string[] | null) {
  const f = subTypes ? fees.filter((r) => subTypes.includes(r.sub_type ?? '')) : fees;
  const map = new Map<string, { q: string; n: number; uw: number; fee: number }>();
  for (const r of f) {
    const k = r.quarter.slice(0, 10);
    const e = map.get(k) ?? { q: k, n: 0, uw: 0, fee: 0 };
    e.n += Number(r.deal_count);
    e.uw += Number(r.uw_amount_krw);
    e.fee += Number(r.fee_krw);
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.q.localeCompare(b.q));
}

const quarterLabel = (d: string) => `${d.slice(2, 4)}년 ${Math.floor(Number(d.slice(5, 7)) / 3) + 1}분기`;

export default async function TrendPage({ params, searchParams }: { params: { product: string }; searchParams: SP }) {
  const product = params.product as ProductType;
  const meta = PRODUCTS.find((p) => p.key === product);
  if (!meta) notFound();

  const m = searchParams.m === '24' ? 24 : 12;
  const months = monthList(m);
  const since = months[0];
  const qStart = `${since.slice(0, 5)}${String(Math.floor((Number(since.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  const year = Number(months.at(-1)!.slice(0, 4));
  const color = `var(--${product})`;

  const bondDefault = product === 'bond' ? ((await getUiParam<string[]>('bond_trend_categories').catch(() => null)) ?? []) : [];
  const [rowsAll, fees, league, metrics] = await Promise.all([
    getTrend<BondTrendRow & MezzTrendRow & EquityTrendRow & IpoTrendRow>(product, since),
    getFees(product, qStart).catch(() => [] as FeeRow[]),
    getLeague(product, year).catch(() => []),
    getMetrics(product).catch(() => []),
  ]);

  // 회사채 구분 선택 (기본: ref.params.bond_trend_categories)
  const categories = product === 'bond' ? byKey(rowsAll, (r) => r.category ?? '기타').map((s) => s.key) : [];
  const defaultCat = bondDefault.length === 1 ? bondDefault[0] : 'all';
  const cat = product === 'bond' ? searchParams.cat ?? defaultCat : 'all';
  const subTypes = product === 'bond' && cat !== 'all' ? [cat] : null;
  const rows = subTypes ? rowsAll.filter((r) => subTypes.includes(r.category ?? '')) : rowsAll;

  const [recent, issues] = await Promise.all([
    product === 'bond' ? Promise.resolve([]) : getRecentDeals(product, { subTypes: subTypes ?? undefined, limit: 30 }).catch(() => []),
    product === 'bond' ? getBondIssues(since, subTypes).catch(() => []) : Promise.resolve([]),
  ]);
  const periodLabel = `${month(since)}~${month(months.at(-1)!)}`;

  const series = byMonth(rows, months);
  const amount = sum(rows, (r) => r.amount_krw);
  const count = sum(rows, (r) => r.deal_count);
  const feeQ = feeByQuarter(fees, subTypes);
  const feeAll = feeQ.reduce((a, r) => ({ uw: a.uw + r.uw, fee: a.fee + r.fee }), { uw: 0, fee: 0 });
  const feeBp = feeAll.uw ? (feeAll.fee / feeAll.uw) * 1e4 : null;
  const tenorAvg = weightedAvg(rows, (r) => r.avg_tenor_months);
  const yieldAvg = weightedAvg(rows, (r) => r.avg_yield_pct_w);

  return (
    <>
      <main id="main" className="wrap">
        <PageHead title="발행 동향" info={`${SUBS[product]} ${DATE_BASIS[product]}으로 월을 나눕니다.`}>
          <ProductTabs active={product} query={m === 24 ? '?m=24' : ''} />
          <div className="controls">
            <span className="seg" aria-label="기간">
              {(['12', '24'] as const).map((v) => (
                <Link key={v} href={href(product, searchParams, { m: v })} aria-current={String(m) === v}>
                  최근 {v}개월
                </Link>
              ))}
            </span>
            {product === 'bond' && (
              <span className="seg" aria-label="회사채 구분">
                {['all', ...categories].map((c) => (
                  <Link key={c} href={href(product, searchParams, { cat: c })} aria-current={cat === c}>
                    {c === 'all' ? '전체' : c}
                  </Link>
                ))}
              </span>
            )}
          </div>
        </PageHead>

        <section className="section period-head" aria-labelledby="period-h">
          <SectionHead
            id="period-h"
            title={`최근 ${m}개월`}
            right={<span className="muted small tnum">{periodLabel}</span>}
          />
        <dl className="stats">
          <Stat label="발행금액">{won(amount)}</Stat>
          <Stat label="건수">{num(count)}<small>건</small></Stat>
          {product === 'bond' && (
            <>
              <Stat label="평균 만기">{tenorAvg != null ? num(tenorAvg / 12, 1) : '–'}<small>년</small></Stat>
              <Stat label="평균 인수수수료">{feeBp != null ? num(feeBp, 1) : '–'}<small>bp</small></Stat>
              {sum(rows, (r) => r.demand_known_count) > 0 && (
                <>
                  <Stat label="평균 수요예측 경쟁률">{num(weightedAvg(rows.filter((r) => r.demand_known_count > 0).map((r) => ({ ...r, deal_count: r.demand_known_count })), (r) => r.avg_competition), 2)}<small>배</small></Stat>
                  <Stat label="미달 비중">{pct(share(sum(rows, (r) => r.undersub_count), sum(rows, (r) => r.demand_known_count)), 1)}</Stat>
                </>
              )}
              {yieldAvg != null && <Stat label="평균 발행금리">{pct(yieldAvg, 2)}</Stat>}
            </>
          )}
          {product === 'mezz' && (
            <>
              <Stat label="0%/0% 비중">{pct(share(sum(rows, (r) => r.zero_coupon_count), count), 1)}</Stat>
              <Stat label="리픽싱 하한 70% 이하">{pct(share(sum(rows, (r) => r.refix_low_count), sum(rows, (r) => r.refix_known_count)), 1)}</Stat>
              <Stat label="평균 만기이자율">{pct(weightedAvg(rows, (r) => r.avg_ytm_pct), 2)}</Stat>
              <Stat label="공모 비중">{pct(share(sum(rows.filter((r) => r.is_public), (r) => r.deal_count), count), 1)}</Stat>
            </>
          )}
          {product === 'equity' && (
            <>
              <Stat label="평균 신주 비율">{pct(weightedAvg(rows, (r) => r.avg_dilution_pct), 1)}</Stat>
              <Stat label="총액인수 비중">{pct(share(sum(rows, (r) => r.firm_commitment_count), sum(rows, (r) => r.method_known_count)), 1)}</Stat>
              <Stat label="인수방식 확인">{num(sum(rows, (r) => r.method_known_count))}<small>건</small></Stat>
            </>
          )}
          {product === 'ipo' && (
            <>
              <Stat label="평균 구주매출 비중">{pct(weightedAvg(rows, (r) => r.avg_secondary_pct), 1)}</Stat>
              <Stat label="환매청구권 부여">{pct(share(sum(rows, (r) => r.putback_count), count), 1)}</Stat>
              {sum(rows, (r) => r.band_known_count) > 0 && (
                <Stat label="밴드 상단 초과">{pct(share(sum(rows, (r) => r.above_band_count), sum(rows, (r) => r.band_known_count)), 1)}</Stat>
              )}
            </>
          )}
        </dl>
          <div className="chart-pair monthly">
            <div className="chart-card">
              <h3>발행금액</h3>
              <BarChart
                title={`${meta!.label} 월별 발행금액`}
                color={color}
                partialLast
                labelEvery={m === 12 ? 2 : 4}
                formatTick={(v) => won(v)}
                bars={series.map((s) => ({ label: month(s.month), value: s.amount, tip: [won(s.amount), `${s.count}건`] }))}
              />
            </div>
            <div className="chart-card">
              <h3>건수</h3>
              <BarChart
                title={`${meta!.label} 월별 건수`}
                color={color}
                partialLast
                labelEvery={m === 12 ? 2 : 4}
                formatTick={(v) => `${num(v)}건`}
                bars={series.map((s) => ({ label: month(s.month), value: s.count, tip: [`${s.count}건`, won(s.amount)] }))}
              />
            </div>
          </div>
        </section>

        {product === 'bond' && <TrancheSection issues={issues} period={periodLabel} />}

        <ChangeTiles
          scope={product}
          title="최근 3개월 변화"
          color={color}
          info="위 기간 선택과 별개로 늘 최근 3개월(이번 달 제외)을 전년 같은 기간 또는 직전 12개월 평균과 비교합니다. 회색 막대가 비교 기간, 색 막대가 최근 3개월입니다. 기준 이상 바뀐 지표를 먼저 보여 줍니다."
        />

        <section className="section" aria-labelledby="mix-h">
          <SectionHead id="mix-h" title={`구성 (최근 ${m}개월)`} />
          <div className="breakdowns">
            {product === 'bond' && cat === 'all' && <Breakdown title="회사채 구분" slices={byKey(rows, (r) => r.category ?? '기타')} color={color} />}
            {product === 'bond' && rows.some((r) => r.rating_group) && (
              <Breakdown title="신용등급" slices={byKey(rows, (r) => r.rating_group ?? '등급 미확인')} color={color} />
            )}
            {product === 'bond' && cat !== 'all' && !rows.some((r) => r.rating_group) && (
              <Breakdown title="회사채 구분" slices={byKey(rowsAll, (r) => r.category ?? '기타')} color={color} note="선택한 구분과 무관하게 전체 공모 회사채 기준" />
            )}
            {product === 'mezz' && (
              <>
                <Breakdown title="종류" slices={byKey(rows, (r) => r.kind ?? '기타')} color={color} />
                <Breakdown title="공모/사모" slices={byKey(rows, (r) => (r.is_public === null ? '확인 안 됨' : r.is_public ? '공모' : '사모'))} color={color} />
                <Breakdown title="시장" slices={byKey(rows, (r) => r.market ?? '확인 안 됨')} color={color} />
              </>
            )}
            {product === 'equity' && (
              <>
                <Breakdown title="증자 방식" slices={byKey(rows, (r) => r.method ?? '기타')} color={color} />
                <Breakdown title="시장" slices={byKey(rows, (r) => r.market ?? '확인 안 됨')} color={color} />
              </>
            )}
            {product === 'ipo' && (
              <>
                <Breakdown title="구분" slices={byKey(rows, (r) => r.sub_type ?? '기타')} color={color} />
                <Breakdown title="상장 시장" slices={byKey(rows, (r) => (r.market && r.market !== '기타' ? r.market : '상장 전·확인 안 됨'))} color={color} />
              </>
            )}
          </div>
        </section>

        {(league.length > 0 || feeQ.length > 0) && (
          <section className="section" aria-labelledby="ib-h">
            <SectionHead id="ib-h" title="주관사" info="인수인 정보가 공시된 딜만 집계합니다." />
            <div className="breakdowns">
              {league.length > 0 && (
                <div>
                  <h3 className="sub-h">
                    {year}년 대표주관 순위
                    <Info>대표주관 실적은 딜 금액을 공동 대표주관사 수로 나눠 더한 값입니다. 회사채는 모든 구분을 합칩니다.</Info>
                  </h3>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th className="num">순위</th>
                          <th>증권사</th>
                          <th className="num">대표주관 건수</th>
                          <th className="num">대표주관 실적</th>
                          <th className="num">인수금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {league.map((r) => (
                          <tr key={r.firm} className={r.is_nh ? 'is-nh' : undefined}>
                            <td className="num">{r.lead_rank}</td>
                            <td>{r.firm}</td>
                            <td className="num">{num(r.lead_deals)}</td>
                            <td className="num">{won(r.lead_credit_krw)}</td>
                            <td className="num">{won(r.uw_amount_krw)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {feeQ.length > 0 && (
                <div>
                  <h3 className="sub-h">
                    분기별 인수수수료율
                    <Info>인수대가 합 ÷ 인수금액 합. 신고서에 따로 적힌 대표주관 수수료는 빠집니다.</Info>
                  </h3>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>분기</th>
                          <th className="num">건수</th>
                          <th className="num">인수금액</th>
                          <th className="num">수수료율</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feeQ.map((r) => (
                          <tr key={r.q}>
                            <td>{quarterLabel(r.q)}</td>
                            <td className="num">{num(r.n)}</td>
                            <td className="num">{won(r.uw)}</td>
                            <td className="num">{r.uw ? `${num((r.fee / r.uw) * 1e4, 1)}bp` : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="recent-h">
          <SectionHead
            id="recent-h"
            title={product === 'bond' ? '최근 발행' : '최근 딜'}
            info={product === 'bond'
              ? '납입일 기준 최근 30건. 트랜치를 한 발행으로 묶었습니다. 금리는 민평 방식이면 확정 가산금리, 고정금리 방식이면 확정 금리입니다. 왼쪽 선은 NH투자증권 대표주관.'
              : `${DATE_BASIS[product]} 최근 30건. 왼쪽 선은 NH투자증권 대표주관.`}
          />
          {product === 'bond' ? (
            issues.length ? <BondIssueTable issues={issues.slice(0, 30)} caption="최근 회사채 발행" /> : <p className="empty">아직 집계된 발행이 없습니다.</p>
          ) : recent.length ? (
            <DealTable deals={recent} layout={product} caption={`최근 ${meta!.label} 딜`} />
          ) : (
            <p className="empty">아직 집계된 딜이 없습니다.</p>
          )}
        </section>

        {metrics.length > 0 && (
          <details className="metrics">
            <summary>지표 정의</summary>
            <dl>
              {metrics.map((x) => (
                <div key={x.metric_key} style={{ display: 'contents' }}>
                  <dt>{x.label_ko}</dt>
                  <dd>
                    {x.definition_ko}
                    {x.status === 'draft' && <span className="muted"> (현업 검토 전)</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </main>
    </>
  );
}

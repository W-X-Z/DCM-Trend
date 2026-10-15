import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Header } from '@/components/Chrome';
import { BarChart, InlineBar } from '@/components/BarChart';
import { DealTable } from '@/components/DealTable';
import { byKey, byMonth, monthList, share, sum, weightedAvg, type Slice } from '@/lib/agg';
import { month, num, pct, won } from '@/lib/format';
import { DATE_BASIS } from '@/lib/labels';
import { getFees, getLeague, getMetrics, getRecentDeals, getTrend, getUiParam } from '@/lib/queries';
import { PRODUCTS, type BondTrendRow, type EquityTrendRow, type FeeRow, type MezzTrendRow, type ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TITLES: Record<ProductType, string> = { bond: '회사채 발행 동향', mezz: '메자닌 발행 동향', equity: '유상증자 동향' };
const SUBS: Record<ProductType, string> = {
  bond: '증권신고서(채무증권)를 낸 공모 회사채. 트랜치(회차)마다 한 건으로 셉니다.',
  mezz: '전환사채(CB), 신주인수권부사채(BW), 교환사채(EB) 발행 결정 공시. 공모와 사모를 모두 포함합니다.',
  equity: '유상증자 결정 공시. 정정 공시는 처음 결정한 딜에 합칩니다.',
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
      <h3 className="sub-h">{title}</h3>
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
      {note && <p className="note">{note}</p>}
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
    getTrend<BondTrendRow & MezzTrendRow & EquityTrendRow>(product, since),
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

  const recent = await getRecentDeals(product, { subTypes: subTypes ?? undefined, limit: 30 }).catch(() => []);

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
      <Header active={product} />
      <main id="main" className="wrap">
        <div className="page-head">
          <h1 className="page-title">{TITLES[product]}</h1>
          <p className="page-sub">{SUBS[product]} {DATE_BASIS[product]}으로 월을 나눕니다.</p>
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
        </div>

        <dl className="stats">
          <Stat label="발행금액">{won(amount)}</Stat>
          <Stat label="건수">{num(count)}<small>건</small></Stat>
          {product === 'bond' && (
            <>
              <Stat label="평균 만기">{tenorAvg != null ? num(tenorAvg / 12, 1) : '–'}<small>년</small></Stat>
              <Stat label="평균 인수수수료">{feeBp != null ? num(feeBp, 1) : '–'}<small>bp</small></Stat>
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
        </dl>
        {product === 'bond' && (
          <p className="note">
            발행금리, 신용등급, 수요예측 경쟁률은 신고서 본문을 읽어야 해서 다음 단계에서 채웁니다. 지금은 OpenDART 주요정보 API에 있는 값만 보여 줍니다.
          </p>
        )}

        <section className="section" aria-labelledby="monthly-h">
          <div className="section-head">
            <h2 id="monthly-h">월별 추이</h2>
            <p>이번 달은 진행 중이라 옅게 표시</p>
          </div>
          <div className="chart-pair">
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

        <section className="section" aria-labelledby="mix-h">
          <div className="section-head">
            <h2 id="mix-h">구성</h2>
            <p>최근 {m}개월 합계, 금액 비중 순</p>
          </div>
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
          </div>
        </section>

        {(league.length > 0 || feeQ.length > 0) && (
          <section className="section" aria-labelledby="ib-h">
            <div className="section-head">
              <h2 id="ib-h">주관사</h2>
              <p>인수인 정보가 공시된 딜만 집계</p>
            </div>
            <div className="breakdowns">
              {league.length > 0 && (
                <div>
                  <h3 className="sub-h">{year}년 대표주관 순위</h3>
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
                  <p className="note">대표주관 실적은 딜 금액을 공동 대표주관사 수로 나눠 더한 값입니다. 회사채는 모든 구분을 합칩니다.</p>
                </div>
              )}
              {feeQ.length > 0 && (
                <div>
                  <h3 className="sub-h">분기별 인수수수료율</h3>
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
                  <p className="note">인수대가 합 ÷ 인수금액 합. 신고서에 따로 적힌 대표주관 수수료는 빠집니다.</p>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="recent-h">
          <div className="section-head">
            <h2 id="recent-h">최근 딜</h2>
            <p>{DATE_BASIS[product]} 최근 30건. 왼쪽 선은 NH투자증권 대표주관</p>
          </div>
          {recent.length ? (
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

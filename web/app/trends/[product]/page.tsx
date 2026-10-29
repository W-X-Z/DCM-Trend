import { FabContext } from '@/components/Fab';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BarChart, InlineBar } from '@/components/BarChart';
import { DealTable } from '@/components/DealTable';
import { ChangeTiles } from '@/components/Insights';
import { Seasonality } from '@/components/Seasonality';
import { BondIssueTable, TrancheSection } from '@/components/Tranche';
import { Info, PageHead, ProductTabs, SectionHead } from '@/components/Ui';
import { date, num, pct, won } from '@/lib/format';
import { DATE_BASIS } from '@/lib/labels';
import { PERIODS, breakdown, bucketOf, feeByQuarter, inWindow, leagueOf, makeWindow, series, stats, type Period, type Slice } from '@/lib/period';
import { getBondIssues, getMetrics, getRecentDeals, getTrend, getTrendDeals, getUiParam } from '@/lib/queries';
import { PRODUCTS, type BondTrendRow, type ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TITLES: Record<ProductType, string> = { bond: '회사채 발행 동향', mezz: '메자닌 발행 동향', equity: '유상증자 동향', ipo: 'IPO 동향' };
const SUBS: Record<ProductType, string> = {
  bond: '증권신고서(채무증권)를 낸 공모 회사채. 트랜치(회차)마다 한 건. 등급·밴드·확정 가산금리·경쟁률은 발행조건확정 신고서 본문에서 읽습니다.',
  mezz: '전환사채(CB), 신주인수권부사채(BW), 교환사채(EB) 발행 결정 공시. 공모와 사모 모두.',
  equity: '상장사 유상증자 결정 공시. 정정 공시는 처음 결정한 딜에 합칩니다.',
  ipo: '비상장사(코넥스 이전상장 포함)의 지분증권 일반공모. 철회한 공모는 뺍니다. 밴드·확정공모가·경쟁률은 발행조건확정 신고서 본문에서 읽습니다.',
};
const PERIOD_LABEL: Record<Period, string> = { '1': '1개월', '3': '3개월', '6': '6개월', '12': '12개월', '24': '24개월' };

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
  const total = slices.reduce((s, x) => s + x.amount, 0);
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
                <td className="num">{pct(total ? (s.amount / total) * 100 : null, 1)}</td>
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

const quarterLabel = (d: string) => `${d.slice(2, 4)}년 ${Math.floor(Number(d.slice(5, 7)) / 3) + 1}분기`;
const kstMonth = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

export default async function TrendPage({ params, searchParams }: { params: { product: string }; searchParams: SP }) {
  const product = params.product as ProductType;
  const meta = PRODUCTS.find((p) => p.key === product);
  if (!meta) notFound();

  const period: Period = (PERIODS as readonly string[]).includes(searchParams.m ?? '') ? (searchParams.m as Period) : '12';
  const w = makeWindow(period);
  const color = `var(--${product})`;

  const bondDefault = product === 'bond' ? ((await getUiParam<string[]>('bond_trend_categories').catch(() => null)) ?? []) : [];
  const seasonSince = product === 'bond' ? '2019-01-01' : product === 'mezz' ? '2021-01-01' : null;
  const [all, metrics, recent, issuesAll, seasonRows] = await Promise.all([
    getTrendDeals(product, w.since).catch(() => null),
    getMetrics(product).catch(() => []),
    product === 'bond' ? Promise.resolve([]) : getRecentDeals(product, { limit: 30 }).catch(() => []),
    product === 'bond' ? getBondIssues(w.since).catch(() => []) : Promise.resolve([]),
    seasonSince ? getTrend<BondTrendRow>(product, seasonSince).catch(() => []) : Promise.resolve([]),
  ]);
  if (all === null) {
    return (
      <main id="main" className="wrap">
        <PageHead title="발행동향"><ProductTabs active={product} /></PageHead>
        <p className="empty">발행 데이터를 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      </main>
    );
  }

  // 회사채 구분 선택 (기본: ref.params.bond_trend_categories)
  const windowAll = inWindow(w, all);
  const categories = product === 'bond' ? breakdown(windowAll, (d) => d.sub_type ?? '기타').map((s) => s.key) : [];
  const defaultCat = bondDefault.length === 1 ? bondDefault[0] : 'all';
  const cat = product === 'bond' ? searchParams.cat ?? defaultCat : 'all';
  const deals = product === 'bond' && cat !== 'all' ? windowAll.filter((d) => (d.sub_type ?? '기타') === cat) : windowAll;
  const lastBucket = w.buckets.at(-1)!.key;
  const issues = issuesAll.filter((i) => i.deal_dt && i.deal_dt >= w.since && bucketOf(w, i.deal_dt) <= lastBucket && (cat === 'all' || i.sub_type === cat));
  const recentIssues = [...issues].sort((a, b) => String(b.deal_dt).localeCompare(String(a.deal_dt))).slice(0, 30);
  const seasonFiltered = product === 'bond' && cat !== 'all' ? seasonRows.filter((r) => r.category === cat) : seasonRows;

  const s = stats(product, deals) as Record<string, number | null>;
  const pts = series(w, deals);
  const league = leagueOf(deals);
  const fees = feeByQuarter(deals);
  const labelEvery = w.weekly ? (pts.length > 8 ? 2 : 1) : w.months <= 6 ? 1 : w.months <= 12 ? 2 : 4;
  const unit = w.weekly ? '주별' : '월별';
  const q = (patch: SP) => href(product, searchParams, patch);

  return (
    <main id="main" className="wrap">
      <FabContext
        label={`최근 ${meta.label} 발행사`}
        companies={[
          ...new Map(
            (product === 'bond' ? issues.map((i) => ({ c: i.corp_code, n: i.corp_name, dt: i.deal_dt, a: i.amount_krw })) : recent.map((d) => ({ c: d.corp_code, n: d.corp_name, dt: d.deal_dt, a: d.amount_krw })))
              .sort((x, y) => (y.dt ?? '').localeCompare(x.dt ?? ''))
              .map((x) => [x.c, { c: x.c, n: x.n, sub: `${date(x.dt)} · ${won(x.a)}`, href: product === 'bond' ? undefined : `/proposal?corp=${x.c}${product === 'mezz' ? '&type=mezz' : ''}` }] as const),
          ).values(),
        ].slice(0, 10)}
      />
      <PageHead title="발행동향" info={`${SUBS[product]} ${DATE_BASIS[product]}으로 기간을 나눕니다.`}>
        <ProductTabs active={product} query={period !== '12' ? `?m=${period}` : ''} />
        <div className="controls">
          <span className="seg" aria-label="기간">
            {PERIODS.map((v) => (
              <Link key={v} href={q({ m: v })} aria-current={period === v}>
                {PERIOD_LABEL[v]}
              </Link>
            ))}
          </span>
          {product === 'bond' && (
            <span className="seg" aria-label="회사채 구분">
              {['all', ...categories].map((c) => (
                <Link key={c} href={q({ cat: c })} aria-current={cat === c}>
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
          title={`최근 ${PERIOD_LABEL[period]}`}
          info={w.weekly ? '오늘부터 거슬러 올라간 날짜 구간입니다. 막대는 월요일 시작 주별, 마지막 막대는 진행 중인 주입니다.' : '이번 달을 포함한 달 단위 구간입니다. 마지막 막대는 진행 중인 달입니다.'}
          right={<span className="muted small tnum">{w.label}</span>}
        />
        <dl className="stats">
          <Stat label="발행금액">{won(s.amount)}</Stat>
          <Stat label="건수">{num(s.count)}<small>건</small></Stat>
          {product === 'bond' && (
            <>
              <Stat label="평균 만기">{s.tenorYears != null ? num(s.tenorYears, 1) : '–'}<small>년</small></Stat>
              {s.demandKnown ? <Stat label="평균 수요예측 경쟁률">{num(s.competition, 2)}<small>배</small></Stat> : null}
              {s.increasedShare != null && <Stat label="증액 비중">{pct(s.increasedShare, 0)}</Stat>}
              {s.demandKnown ? <Stat label="미달 비중">{pct(s.undersubShare, 1)}</Stat> : null}
              {s.yieldW != null && <Stat label="평균 발행금리">{pct(s.yieldW, 2)}</Stat>}
              <Stat label="평균 인수수수료">{s.feeBp != null ? num(s.feeBp, 1) : '–'}<small>bp</small></Stat>
            </>
          )}
          {product === 'mezz' && (
            <>
              <Stat label="0%/0% 비중">{pct(s.zeroShare, 1)}</Stat>
              <Stat label="리픽싱 하한 70% 이하">{pct(s.refixLowShare, 1)}</Stat>
              <Stat label="평균 만기이자율">{pct(s.ytm, 2)}</Stat>
              <Stat label="공모 비중">{pct(s.publicShare, 1)}</Stat>
            </>
          )}
          {product === 'equity' && (
            <>
              <Stat label="평균 신주 비율">{pct(s.dilution, 1)}</Stat>
              <Stat label="총액인수 비중">{pct(s.firmShare, 1)}</Stat>
              <Stat label="인수방식 확인">{num(s.methodKnown)}<small>건</small></Stat>
            </>
          )}
          {product === 'ipo' && (
            <>
              <Stat label="평균 구주매출 비중">{pct(s.secondary, 1)}</Stat>
              <Stat label="환매청구권 부여">{pct(s.putbackShare, 1)}</Stat>
              {s.aboveBandShare != null && <Stat label="밴드 상단 초과">{pct(s.aboveBandShare, 1)}</Stat>}
            </>
          )}
        </dl>
        <div className="chart-pair monthly">
          <div className="chart-card">
            <h3>{unit} 발행금액</h3>
            <BarChart
              title={`${meta.label} ${unit} 발행금액`}
              color={color}
              partialLast
              labelEvery={labelEvery}
              formatTick={(v) => won(v)}
              bars={pts.map((p) => ({ label: p.label, value: p.amount, tip: [won(p.amount), `${p.count}건`] }))}
            />
          </div>
          <div className="chart-card">
            <h3>{unit} 건수</h3>
            <BarChart
              title={`${meta.label} ${unit} 건수`}
              color={color}
              partialLast
              labelEvery={labelEvery}
              formatTick={(v) => `${num(v)}건`}
              bars={pts.map((p) => ({ label: p.label, value: p.count, tip: [`${p.count}건`, won(p.amount)] }))}
            />
          </div>
        </div>
      </section>

      {product === 'bond' && <TrancheSection issues={issues} period={w.label} />}

      <ChangeTiles
        scope={product}
        title="최근 3개월 변화"
        color={color}
        info="위 기간 선택과 별개로 늘 최근 3개월(이번 달 제외)을 전년 같은 기간 또는 직전 12개월 평균과 비교합니다. 회색 막대가 비교 기간, 색 막대가 최근 3개월입니다."
      />

      {seasonFiltered.length > 0 && (
        <section className="section" aria-labelledby="season-h">
          <SectionHead id="season-h" title="월별 발행 패턴" right={<span className="muted small">{product === 'bond' ? '2019년~' : '2021년~'}</span>} />
          <Seasonality
            rows={seasonFiltered}
            color={color}
            title={product === 'bond' ? `${cat === 'all' ? '공모 회사채' : cat} 발행금액` : '메자닌 발행금액'}
            note="연도별 달마다 발행금액입니다. 아래 줄은 다 찬 연도에서 그 달이 1년 발행액의 몇 %였는지 평균한 값으로, 제안 시기를 잡을 때 씁니다. 회사채 과거분은 공모채 이력·잔액이 있는 회사만 수집했습니다."
            todayMonth={kstMonth()}
          />
        </section>
      )}

      <section className="section" aria-labelledby="mix-h">
        <SectionHead id="mix-h" title={`구성 (최근 ${PERIOD_LABEL[period]})`} />
        <div className="breakdowns">
          {product === 'bond' && cat === 'all' && <Breakdown title="회사채 구분" slices={breakdown(deals, (d) => d.sub_type ?? '기타')} color={color} />}
          {product === 'bond' && deals.some((d) => d.rating_group) && (
            <Breakdown title="신용등급" slices={breakdown(deals, (d) => d.rating_group ?? '등급 미확인')} color={color} />
          )}
          {product === 'mezz' && (
            <>
              <Breakdown title="종류" slices={breakdown(deals, (d) => d.sub_type ?? '기타')} color={color} />
              <Breakdown title="공모/사모" slices={breakdown(deals, (d) => (d.is_public === null ? '확인 안 됨' : d.is_public ? '공모' : '사모'))} color={color} />
              <Breakdown title="시장" slices={breakdown(deals, (d) => d.market ?? '확인 안 됨')} color={color} />
            </>
          )}
          {product === 'equity' && (
            <>
              <Breakdown title="증자 방식" slices={breakdown(deals, (d) => d.sub_type ?? '기타')} color={color} />
              <Breakdown title="시장" slices={breakdown(deals, (d) => d.market ?? '확인 안 됨')} color={color} />
            </>
          )}
          {product === 'ipo' && (
            <>
              <Breakdown title="구분" slices={breakdown(deals, (d) => d.sub_type ?? '기타')} color={color} />
              <Breakdown title="상장 시장" slices={breakdown(deals, (d) => (d.market && d.market !== '기타' ? d.market : '상장 전·확인 안 됨'))} color={color} />
            </>
          )}
        </div>
      </section>

      {(league.length > 0 || fees.length > 0) && (
        <section className="section" aria-labelledby="ib-h">
          <SectionHead
            id="ib-h"
            title={`주관사 (최근 ${PERIOD_LABEL[period]})`}
            info="인수인 정보가 공시된 딜만 집계합니다."
            right={
              <a className="small" href={`/api/track?product=${product}&m=${period}${product === 'bond' ? `&cat=${encodeURIComponent(cat)}` : ''}`} download>
                NH 대표주관 딜 목록 내려받기 (CSV)
              </a>
            }
          />
          <div className="breakdowns">
            {league.length > 0 && (
              <div>
                <h3 className="sub-h">
                  대표주관 순위
                  <Info>대표주관 실적은 딜 금액을 공동 대표주관사 수로 나눠 더한 값입니다. 선택한 기간·구분 기준입니다.</Info>
                </h3>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th className="num">순위</th>
                        <th>증권사</th>
                        <th className="num">대표주관 건수</th>
                        <th className="num">대표주관 실적</th>
                        <th className="num">점유율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {league.map((r, i) => (
                        <tr key={r.firm} className={r.isNh ? 'is-nh' : undefined}>
                          <td className="num">{i + 1}</td>
                          <td>{r.firm}</td>
                          <td className="num">{num(r.deals)}</td>
                          <td className="num">{won(r.credit)}</td>
                          <td className="num">{pct(s.amount ? (r.credit / (s.amount as number)) * 100 : null, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {fees.length > 0 && (
              <div>
                <h3 className="sub-h">
                  분기별 인수수수료율
                  <Info>인수대가 합 ÷ 인수금액 합. 신고서에 따로 적힌 대표주관 수수료는 빠집니다. 기간 첫 분기와 이번 분기는 일부만 들어갑니다.</Info>
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
                      {fees.map((r) => (
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
          recentIssues.length ? <BondIssueTable issues={recentIssues} caption="최근 회사채 발행" /> : <p className="empty">이 기간에 발행이 없습니다.</p>
        ) : recent.length ? (
          <DealTable deals={recent} layout={product} caption={`최근 ${meta.label} 딜`} />
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
  );
}

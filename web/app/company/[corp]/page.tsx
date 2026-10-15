import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Header } from '@/components/Chrome';
import { DealTable } from '@/components/DealTable';
import { Disclosures } from '@/components/Disclosures';
import { Tombstone } from '@/components/Tombstone';
import { Info, SectionHead } from '@/components/Ui';
import { date, pct, won } from '@/lib/format';
import { FEATURE_LABEL, PRODUCT_LABEL, dealTitle } from '@/lib/labels';
import { getCompany, getCompanyDeals, getMaturities, getShortDebt, getSimilar } from '@/lib/queries';
import type { Deal, Maturity, ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const valid = (corp: string) => /^[0-9A-Za-z_]{1,20}$/.test(corp);

export async function generateMetadata({ params }: { params: { corp: string } }): Promise<Metadata> {
  if (!valid(params.corp)) return { title: '회사' };
  const c = await getCompany(params.corp).catch(() => null);
  return { title: c?.corp_name ?? '회사' };
}

function addYears(n: number) {
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

function UpcomingTable({ rows }: { rows: Maturity[] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <caption className="sr-only">다가오는 만기와 풋옵션</caption>
        <thead>
          <tr>
            <th>날짜</th>
            <th className="num">남은 기간</th>
            <th>구분</th>
            <th>증권</th>
            <th className="num">금액</th>
            <th className="num">금리</th>
            <th>당시 대표주관</th>
            <th>공시</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={`${m.deal_key}-${m.event_type}`} className={m.nh_lead ? 'row-nh' : undefined}>
              <td className="nowrap">{date(m.event_dt)}</td>
              <td className="num">{m.days_left < 0 ? '지남' : m.days_left < 60 ? `${m.days_left}일` : `${Math.round(m.days_left / 30.4)}개월`}</td>
              <td>
                <span className={`swatch-label p-${m.product_type}`}>{m.event_type === '풋옵션' ? '풋옵션' : `${PRODUCT_LABEL[m.product_type]} 만기`}</span>
              </td>
              <td>{m.product_type === 'bond' ? `제${m.series}회 ${m.sub_type ?? ''}` : `${m.sub_type ?? ''}${m.series && m.series.length <= 6 ? ` 제${m.series}회` : ''}`}</td>
              <td className="num">{won(m.amount_krw)}</td>
              <td className="num">{m.coupon_pct != null ? pct(m.coupon_pct, 2) : m.ytm_pct != null ? pct(m.ytm_pct, 1) : '–'}</td>
              <td className="col-lead">{m.lead_managers ?? <span className="muted">–</span>}</td>
              <td>{m.dart_url ? <a href={m.dart_url} target="_blank" rel="noreferrer">DART</a> : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CompanyPage({ params }: { params: { corp: string } }) {
  if (!valid(params.corp)) notFound();
  const corp = params.corp;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const [company, deals, upcoming, shortDebt] = await Promise.all([
    getCompany(corp),
    getCompanyDeals(corp),
    getMaturities({ from: today, to: addYears(5), corp }).catch(() => [] as Maturity[]),
    getShortDebt(1, corp).catch(() => []),
  ]);
  if (!company) notFound();

  // 상품별 가장 최근 딜과 비슷한 딜
  const latest = (['bond', 'mezz', 'equity', 'ipo'] as ProductType[])
    .map((p) => deals.find((d) => d.product_type === p))
    .filter(Boolean) as Deal[];
  const similar = await Promise.all(
    latest.map(async (d) => ({ base: d, comps: await getSimilar(d.deal_key, 8).catch(() => null) })),
  );

  const count = (p: ProductType) => deals.filter((d) => d.product_type === p).length;
  const within1y = upcoming.filter((m) => m.days_left <= 365 && m.event_type === '만기' && m.product_type === 'bond');
  const sd = shortDebt[0];
  const listed = company.market && company.market !== '기타';

  return (
    <>
      <Header />
      <main id="main" className="wrap">
        <div className="page-head">
          <h1 className="page-title">{company.corp_name}</h1>
          <p className="company-meta">
            <span>{listed ? company.market : '비상장'}</span>
            {company.stock_code && <span className="tnum">종목코드 {company.stock_code}</span>}
            <span className="tnum">DART 고유번호 {company.corp_code}</span>
          </p>
        </div>

        <dl className="stats">
          <div className="stat"><dt>회사채</dt><dd>{count('bond')}<small>건</small></dd></div>
          <div className="stat"><dt>메자닌</dt><dd>{count('mezz')}<small>건</small></dd></div>
          <div className="stat"><dt>유상증자·IPO</dt><dd>{count('equity') + count('ipo')}<small>건</small></dd></div>
          <div className="stat"><dt>최근 발행</dt><dd>{date(deals[0]?.deal_dt ?? null)}</dd></div>
          <div className="stat">
            <dt>1년 내 공모채 만기</dt>
            <dd>{within1y.length ? won(within1y.reduce((s, m) => s + Number(m.amount_krw ?? 0), 0)) : '없음'}</dd>
          </div>
          {sd?.total_1y_krw != null && (
            <div className="stat"><dt>1년 내 만기 잔액 (사모·CP 포함)</dt><dd>{won(sd.total_1y_krw)}</dd></div>
          )}
          {company.latest_bond_rating && (
            <div className="stat"><dt>최근 회사채 등급</dt><dd>{company.latest_bond_rating}</dd></div>
          )}
          {company.articles_remaining_krw != null && (
            <div className="stat"><dt>정관상 메자닌 잔여 한도</dt><dd>{won(company.articles_remaining_krw)}</dd></div>
          )}
        </dl>

        {upcoming.length > 0 && (
          <section className="section" aria-labelledby="upcoming-h">
            <SectionHead id="upcoming-h" title="다가오는 만기·풋옵션" info="앞으로 5년. 공모 회사채 트랜치 만기, 메자닌 만기·조기상환청구 시작일." />
            <UpcomingTable rows={upcoming.slice(0, 12)} />
            {upcoming.length > 12 && (
              <details className="disc-more">
                <summary>{upcoming.length - 12}건 더 보기</summary>
                <UpcomingTable rows={upcoming.slice(12)} />
              </details>
            )}
          </section>
        )}

        {sd && (
          <section className="section" aria-labelledby="short-h">
            <SectionHead id="short-h" title="만기 구간별 차입 잔액" info="정기보고서의 미상환 잔액" right={<span className="muted small tnum">{date(sd.stlm_dt)} 기준</span>} />
            <dl className="stats">
              <div className="stat"><dt>회사채 1년 이하</dt><dd>{won(sd.bond_1y_krw)}</dd></div>
              <div className="stat"><dt>그중 사모</dt><dd>{won(sd.bond_private_1y_krw)}</dd></div>
              <div className="stat"><dt>회사채 전체</dt><dd>{won(sd.bond_total_krw)}</dd></div>
              <div className="stat"><dt>CP 3개월 이하</dt><dd>{won(sd.cp_3m_krw)}</dd></div>
              <div className="stat"><dt>CP 1년 이하</dt><dd>{won(sd.cp_1y_krw)}</dd></div>
              <div className="stat"><dt>단기사채</dt><dd>{won(sd.stb_krw)}</dd></div>
            </dl>
          </section>
        )}

        {latest.length > 0 && (
          <section className="section" aria-labelledby="latest-h">
            <SectionHead id="latest-h" title="상품별 최근 발행" />
            <div className="tombstones">
              {latest.map((d) => (
                <Tombstone key={d.deal_key} deal={d} linkCompany={false} />
              ))}
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="disc-h">
          <SectionHead id="disc-h" title="최근 공시" info="최근 6개월. 자금조달, 지배구조, 리스크, 계약·투자 공시를 먼저 보여 줍니다." />
          <Disclosures corp={corp} />
        </section>

        {deals.length === 0 ? (
          <section className="section">
            <p className="empty">수집 기간에 이 회사의 공모 회사채, 메자닌, 유상증자·IPO 공시가 없습니다.</p>
          </section>
        ) : (
          <>
            <section className="section" aria-labelledby="history-h">
              <SectionHead id="history-h" title="발행 이력" info="최근 순. 회사채·IPO 는 납입일, 메자닌과 유상증자는 이사회 결의일 기준. 왼쪽 선은 NH투자증권 대표주관." />
              <DealTable deals={deals} layout="mixed" caption={`${company.corp_name} 발행 이력`} />
            </section>

            <section className="section" aria-labelledby="comps-h">
              <SectionHead id="comps-h" title="비슷한 다른 회사 딜" info="상품별 최근 딜과 조건이 가까운 순. 최근 12개월 이내." />
              {similar.map(({ base, comps }) => {
                const criteria = comps?.[0] ? [...comps[0].comp.matched, ...comps[0].comp.unmatched] : [];
                return (
                  <div key={base.deal_key} className="comps-block">
                    <h3>
                      {dealTitle(base)}({date(base.deal_dt)})와 비슷한 {PRODUCT_LABEL[base.product_type]}
                      {criteria.length > 0 && <Info>{`비교 조건: ${criteria.map((c) => FEATURE_LABEL[c] ?? c).join(', ')}`}</Info>}
                    </h3>
                    {comps === null ? (
                      <p className="empty">비슷한 딜을 불러오지 못했습니다.</p>
                    ) : comps.length === 0 ? (
                      <p className="empty">최근 12개월 안에 조건이 비슷한 딜이 없습니다.</p>
                    ) : (
                      <DealTable
                        deals={comps.map((c) => c.deal)}
                        layout={base.product_type}
                        caption={`${dealTitle(base)}와 비슷한 딜`}
                        extra={{
                          head: '일치 조건',
                          cell: (d) => {
                            const c = comps.find((x) => x.deal.deal_key === d.deal_key)!.comp;
                            return (
                              <span className="match">
                                {c.matched.map((m) => (
                                  <span key={m} className="badge hit">{FEATURE_LABEL[m] ?? m}</span>
                                ))}
                                {c.matched.length === 0 && <span className="muted">–</span>}
                              </span>
                            );
                          },
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </section>
          </>
        )}
      </main>
    </>
  );
}

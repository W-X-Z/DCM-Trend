import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Header } from '@/components/Chrome';
import { DealTable } from '@/components/DealTable';
import { Tombstone } from '@/components/Tombstone';
import { date, won } from '@/lib/format';
import { FEATURE_LABEL, PRODUCT_LABEL, dealTitle } from '@/lib/labels';
import { getCompany, getCompanyDeals, getSimilar } from '@/lib/queries';
import type { Deal, ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const valid = (corp: string) => /^[0-9A-Za-z_]{1,20}$/.test(corp);

export async function generateMetadata({ params }: { params: { corp: string } }): Promise<Metadata> {
  if (!valid(params.corp)) return { title: '회사' };
  const c = await getCompany(params.corp).catch(() => null);
  return { title: c?.corp_name ?? '회사' };
}

export default async function CompanyPage({ params }: { params: { corp: string } }) {
  if (!valid(params.corp)) notFound();
  const [company, deals] = await Promise.all([getCompany(params.corp), getCompanyDeals(params.corp)]);
  if (!company) notFound();

  // 상품별 가장 최근 딜과 비슷한 딜
  const latest = (['bond', 'mezz', 'equity'] as ProductType[])
    .map((p) => deals.find((d) => d.product_type === p))
    .filter(Boolean) as Deal[];
  const similar = await Promise.all(
    latest.map(async (d) => ({ base: d, comps: await getSimilar(d.deal_key, 8).catch(() => null) })),
  );

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
          <div className="stat"><dt>회사채</dt><dd>{company.bond_deal_count}<small>건</small></dd></div>
          <div className="stat"><dt>메자닌</dt><dd>{company.mezz_deal_count}<small>건</small></dd></div>
          <div className="stat"><dt>유상증자</dt><dd>{company.equity_deal_count}<small>건</small></dd></div>
          <div className="stat"><dt>최근 발행</dt><dd>{date(company.last_deal_dt)}</dd></div>
          {company.latest_bond_rating && (
            <div className="stat"><dt>최근 회사채 등급</dt><dd>{company.latest_bond_rating}</dd></div>
          )}
          {company.articles_remaining_krw != null && (
            <div className="stat"><dt>정관상 메자닌 잔여 한도</dt><dd>{won(company.articles_remaining_krw)}</dd></div>
          )}
          {company.outstanding_bond_krw != null && (
            <div className="stat"><dt>회사채 미상환 잔액</dt><dd>{won(company.outstanding_bond_krw)}</dd></div>
          )}
        </dl>

        {deals.length === 0 ? (
          <section className="section">
            <p className="empty">
              수집 기간 동안 이 회사의 공모 회사채 신고서, 메자닌 발행 결정, 유상증자 결정 공시가 없습니다.
              위 메뉴에서 상품별 동향을 보면 비슷한 회사의 최근 딜을 찾을 수 있습니다.
            </p>
          </section>
        ) : (
          <>
            <section className="section" aria-labelledby="latest-h">
              <div className="section-head">
                <h2 id="latest-h">상품별 최근 발행</h2>
              </div>
              <div className="tombstones">
                {latest.map((d) => (
                  <Tombstone key={d.deal_key} deal={d} linkCompany={false} />
                ))}
              </div>
            </section>

            <section className="section" aria-labelledby="history-h">
              <div className="section-head">
                <h2 id="history-h">발행 이력</h2>
                <p>최근 순. 회사채는 납입일, 메자닌과 유상증자는 이사회 결의일 기준. 왼쪽 선은 NH투자증권 대표주관</p>
              </div>
              <DealTable deals={deals} layout="mixed" caption={`${company.corp_name} 발행 이력`} />
            </section>

            <section className="section" aria-labelledby="comps-h">
              <div className="section-head">
                <h2 id="comps-h">비슷한 다른 회사 딜</h2>
                <p>상품별 최근 딜과 조건이 가까운 순. 최근 12개월 이내</p>
              </div>
              {similar.map(({ base, comps }) => {
                const criteria = comps?.[0] ? [...comps[0].comp.matched, ...comps[0].comp.unmatched] : [];
                return (
                  <div key={base.deal_key} className="comps-block">
                    <h3>
                      {dealTitle(base)}({date(base.deal_dt)})와 비슷한 {PRODUCT_LABEL[base.product_type]}
                    </h3>
                    {criteria.length > 0 && (
                      <p>비교 조건: {criteria.map((c) => FEATURE_LABEL[c] ?? c).join(', ')}</p>
                    )}
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

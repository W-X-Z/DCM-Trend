import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header, SearchForm } from '@/components/Chrome';
import { date } from '@/lib/format';
import { searchCompanies } from '@/lib/queries';
import type { CompanyHit } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: '발행사 찾기' };

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').trim().slice(0, 60);
  let hits: CompanyHit[] | null = [];
  if (q) hits = await searchCompanies(q, 30).catch(() => null);

  // 이름이 정확히 같은 회사가 하나뿐이면 바로 회사 화면으로
  const exact = hits?.filter((h) => h.corp_name === q) ?? [];
  if (exact.length === 1 && exact[0].deal_count > 0) redirect(`/company/${exact[0].corp_code}`);

  return (
    <>
      <Header />
      <main id="main" className="wrap">
        <div className="page-head">
          <h1 className="page-title">발행사 찾기</h1>
          <div style={{ marginTop: 16 }}>
            <SearchForm size="large" defaultValue={q} />
          </div>
        </div>
        {!q ? (
          <p className="empty">회사 이름 일부만 넣어도 찾습니다.</p>
        ) : hits === null ? (
          <p className="empty">검색하지 못했습니다. 잠시 뒤 다시 찾아 보세요.</p>
        ) : hits.length === 0 ? (
          <p className="empty">‘{q}’와 비슷한 이름의 회사가 없습니다. 이름 일부만 넣어 보세요.</p>
        ) : (
          <>
            <p className="note" style={{ marginBottom: 12 }}>{hits.length}곳</p>
            <ul className="hits">
              {hits.map((h) => (
                <li key={h.corp_code}>
                  <Link href={`/company/${h.corp_code}`}>
                    <strong>{h.corp_name}</strong>
                    <span className="count">
                      {h.deal_count > 0 ? (
                        <>
                          발행 {h.deal_count}건
                          <br />
                          최근 {date(h.last_deal_dt)}
                        </>
                      ) : (
                        <span className="muted">수집 기간 발행 없음</span>
                      )}
                    </span>
                    <span className="meta">
                      {[h.market && h.market !== '기타' ? h.market : '비상장', h.stock_code].filter(Boolean).join(', ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}

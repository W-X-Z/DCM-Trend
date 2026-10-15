import Link from 'next/link';
import { PRODUCTS } from '@/lib/types';
import { getDataStatus } from '@/lib/queries';

export function SearchForm({ defaultValue = '', size = 'small' }: { defaultValue?: string; size?: 'small' | 'large' }) {
  return (
    <form action="/search" method="get" role="search" className={`search search-${size}`}>
      <label htmlFor={`q-${size}`} className="sr-only">발행사 이름</label>
      <input
        id={`q-${size}`}
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="발행사 이름 (예: 이랜드월드)"
        autoComplete="off"
        required
        minLength={1}
      />
      <button type="submit">찾기</button>
    </form>
  );
}

export function Header({ active, showSearch = true }: { active?: string; showSearch?: boolean }) {
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link href="/" className="wordmark">DCM 트렌드</Link>
        <nav aria-label="상품별 동향" className="nav">
          {PRODUCTS.map((p) => (
            <Link
              key={p.key}
              href={`/trends/${p.key}`}
              className={`nav-link p-${p.key}${active === p.key ? ' is-active' : ''}`}
              aria-current={active === p.key ? 'page' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        {showSearch && <SearchForm />}
      </div>
    </header>
  );
}

function kstDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
  return `${d.slice(0, 10).replaceAll('-', '.')} ${d.slice(11, 16)}`;
}

export async function Footer() {
  const s = await getDataStatus().catch(() => null);
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <p>
          DART 공시(OpenDART)를 자동으로 읽어 집계한 값입니다. 제안서에 옮기기 전에 공시 원문을 확인하세요.
        </p>
        {s && (
          <p className="muted">
            {s.first_deal_dt ? `${s.first_deal_dt.slice(0, 7).replace('-', '.')} 이후 ` : ''}
            회사채 {s.bond_deals.toLocaleString('ko-KR')}건, 메자닌 {s.mezz_deals.toLocaleString('ko-KR')}건, 유상증자 {s.equity_deals.toLocaleString('ko-KR')}건.
            {s.last_refresh_at ? ` 마지막 갱신 ${kstDateTime(s.last_refresh_at)} (한국시간)` : ''}
          </p>
        )}
      </div>
    </footer>
  );
}

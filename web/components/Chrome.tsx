import Link from 'next/link';
import { getDataStatus } from '@/lib/queries';
import { kstDateTime } from '@/lib/format';

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

// 머리글: 화면 이동만 둔다. 상품(회사채·메자닌·유상증자·IPO) 선택은 동향 화면 안의 탭으로.
const NAV = [
  { key: 'trends', href: '/trends/bond', label: '발행 동향' },
  { key: 'maturities', href: '/maturities', label: '만기도래' },
  { key: 'rates', href: '/rates', label: '금리' },
] as const;

export function Header({ active, showSearch = true }: { active?: string; showSearch?: boolean }) {
  const current = active && ['bond', 'mezz', 'equity', 'ipo'].includes(active) ? 'trends' : active;
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link href="/" className="wordmark">발행시장 트렌드</Link>
        <nav aria-label="주요 화면" className="nav">
          {NAV.map((x) => (
            <Link
              key={x.key}
              href={x.href}
              className={`nav-link${current === x.key ? ' is-active' : ''}`}
              aria-current={current === x.key ? 'page' : undefined}
            >
              {x.label}
            </Link>
          ))}
        </nav>
        {showSearch && <SearchForm />}
      </div>
    </header>
  );
}

export async function Footer() {
  const s = await getDataStatus().catch(() => null);
  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <p>
          출처 DART 공시(OpenDART). 제안서에 옮기기 전에 공시 원문을 확인하세요.
          {s?.last_refresh_at ? ` 마지막 갱신 ${kstDateTime(s.last_refresh_at)}` : ''}
        </p>
      </div>
    </footer>
  );
}

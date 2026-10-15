import Link from 'next/link';
import { getDataStatus } from '@/lib/queries';
import { kstDateTime } from '@/lib/format';
import { CompanySearch } from './CompanySearch';
import { NavTabs } from './NavTabs';

// 검색 화면 본문에서 쓰는 큰 검색창 (머리글 검색은 CompanySearch)
export function SearchForm({ defaultValue = '', size = 'small' }: { defaultValue?: string; size?: 'small' | 'large' }) {
  return (
    <form action="/search" method="get" role="search" className={`search search-${size}`}>
      <label htmlFor={`q-${size}`} className="sr-only">회사 이름</label>
      <input
        id={`q-${size}`}
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="회사 이름 (예: 이랜드월드)"
        autoComplete="off"
        required
        minLength={1}
      />
      <button type="submit">찾기</button>
    </form>
  );
}

// 머리글: 1줄 = 서비스 이름 + 회사 검색, 2줄 = 화면 탭
export function Header() {
  return (
    <header className="gh">
      <div className="wrap gh-top">
        <Link href="/" className="wordmark">발행시장 트렌드</Link>
        <CompanySearch />
      </div>
      <div className="wrap">
        <NavTabs />
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

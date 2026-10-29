import Link from 'next/link';
import { getDataStatus } from '@/lib/queries';
import { kstDateTime } from '@/lib/format';
import { CompanySearch } from './CompanySearch';
import { NavTabs } from './NavTabs';
import { NoticeLink } from './Notice';

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
      <p className="wrap footer-row">
        <span>출처 DART·ECOS 공개 데이터{s?.last_refresh_at ? ` · 갱신 ${kstDateTime(s.last_refresh_at)}` : ''}</span>
        <span>테스트용 프로토타입, 내부 자료 입력 금지</span>
        <NoticeLink />
        <Link href="/how">작동 방식</Link>
      </p>
    </footer>
  );
}

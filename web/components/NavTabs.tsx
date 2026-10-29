'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 1depth 탭: 모니터링 화면만 둔다. 제안서 작성·AI 질문은 화면 아래 플로팅 버튼(Fab)에서 연다.
const TABS = [
  { href: '/', label: '홈', match: (p: string) => p === '/' },
  { href: '/trends/bond', label: '발행동향', match: (p: string) => p.startsWith('/trends') },
  { href: '/filings', label: '주요공시', match: (p: string) => p.startsWith('/filings') || p.startsWith('/expansion') },
  { href: '/rates', label: '금리', match: (p: string) => p.startsWith('/rates') },
];

export function NavTabs() {
  const path = usePathname() ?? '/';
  return (
    <nav className="gh-tabs" aria-label="화면">
      {TABS.map((t) => {
        const on = t.match(path);
        return (
          <Link key={t.href} href={t.href} className="gh-tab" aria-current={on ? 'page' : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

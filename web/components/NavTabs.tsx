'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '홈', match: (p: string) => p === '/' },
  { href: '/trends/bond', label: '발행 동향', match: (p: string) => p.startsWith('/trends') },
  { href: '/filings', label: '주요 공시', match: (p: string) => p.startsWith('/filings') },
  { href: '/maturities', label: '만기도래', match: (p: string) => p.startsWith('/maturities') },
  { href: '/rates', label: '금리', match: (p: string) => p.startsWith('/rates') },
  { href: '/ai', label: 'AI 질문', match: (p: string) => p.startsWith('/ai') },
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

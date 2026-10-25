import Link from 'next/link';
import type { Metadata } from 'next';
import { CompanySearch } from '@/components/CompanySearch';
import { DeckStudio } from '@/components/deck/DeckStudio';
import { PageHead } from '@/components/Ui';

export const metadata: Metadata = { title: '제안서 만들기' };

export default function DeckPage({ searchParams }: { searchParams: { corp?: string } }) {
  const corp = searchParams.corp && /^[0-9A-Za-z_]{1,20}$/.test(searchParams.corp) ? searchParams.corp : null;
  // 회사를 고르면 머리말 없이 장표부터 보인다
  if (corp) {
    return (
      <main id="main" className="wrap proposal deck-page is-studio">
        <p className="dk-crumbs small">
          <Link href="/proposal/deck">다른 회사</Link>
          <Link href={`/proposal?corp=${corp}&type=bond`}>초안 점검 화면</Link>
          <Link href="/proposal/knowledge">노하우 관리</Link>
        </p>
        <DeckStudio corp={corp} />
      </main>
    );
  }
  return (
    <main id="main" className="wrap proposal deck-page">
      <PageHead
        title="공모 회사채 제안서 만들기"
        info="NH투자증권 대표주관 제안서 서식으로 장표를 만듭니다. 사례·일정·금리는 공시(DART)·한국은행·공개 리서치 자료에서 채우고, 판단 문장은 그 숫자로 규칙이 씁니다. 노하우 반영(AI)을 누르면 현업 노하우를 더해 고칩니다. 입력한 조건과 문안은 이 브라우저에만 저장됩니다."
      >
        <p className="small dk-links">
          <Link href="/proposal">초안 점검 화면</Link>
          <Link href="/proposal/knowledge">노하우 관리</Link>
        </p>
      </PageHead>
      <div className="pp-search">
        <CompanySearch mode="deck" placeholder="제안할 회사 이름" />
      </div>
    </main>
  );
}

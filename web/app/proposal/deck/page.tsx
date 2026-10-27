import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DeckStudio } from '@/components/deck/DeckStudio';

export const metadata: Metadata = { title: '제안서 초안' };

// 제안서 초안: 회사를 고르면 바로 장표 초안이 보이고, 목차(템플릿 칩·개별 선택)·관련 데이터·검토 표시를 같은 화면에서 다룬다.
// 회사 고르기는 /proposal(검색 + 만기도래 회사 목록)에서 한다.
export default function DeckPage({ searchParams }: { searchParams: { corp?: string } }) {
  const corp = searchParams.corp && /^[0-9A-Za-z_]{1,20}$/.test(searchParams.corp) ? searchParams.corp : null;
  if (!corp) redirect('/proposal');
  return (
    <main id="main" className="wrap proposal deck-page is-studio">
      <p className="dk-crumbs small">
        <Link href="/proposal">다른 회사</Link>
        <Link href={`/company/${corp}`}>회사 정보</Link>
        <Link href="/proposal/knowledge">노하우 관리</Link>
        <Link href={`/how?corp=${corp}#trace`}>작동 방식</Link>
      </p>
      <DeckStudio corp={corp} />
    </main>
  );
}

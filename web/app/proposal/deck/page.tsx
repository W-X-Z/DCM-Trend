import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DeckStudio } from '@/components/deck/DeckStudio';

export const metadata: Metadata = { title: '제안서 초안' };

// 제안서 초안: 미리보기 | 데이터 두 탭, 다운로드, 오른쪽 Agent 채팅. 조건·목차·문안은 채팅으로 바꾼다.
// 회사 고르기는 /proposal(검색 + 만기도래 회사 목록) 또는 화면 아래 플로팅 버튼에서 한다.
export default function DeckPage({ searchParams }: { searchParams: { corp?: string; from?: string } }) {
  const corp = searchParams.corp && /^[0-9A-Za-z_]{1,20}$/.test(searchParams.corp) ? searchParams.corp : null;
  if (!corp) redirect('/proposal');
  // 들어온 화면(탭·필터 포함)으로 돌아가기. 사이트 안 주소만 받는다
  const from = searchParams.from && /^\/(?![/\\])[^\s\\]{0,300}$/.test(searchParams.from) && !searchParams.from.startsWith('/proposal') ? searchParams.from : null;
  return (
    <main id="main" className="wrap proposal deck-page is-studio">
      <p className="dk-crumbs small">
        <Link href={from ?? '/proposal'} className="dk-back">{from ? '돌아가기' : '다른 회사'}</Link>
      </p>
      <DeckStudio corp={corp} aiEnabled={Boolean(process.env.OPENAI_API_KEY)} />
    </main>
  );
}

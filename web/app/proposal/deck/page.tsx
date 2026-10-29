import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DeckStudio } from '@/components/deck/DeckStudio';

export const metadata: Metadata = { title: '제안서 초안' };

// 제안서 초안: 새 탭으로 여는 작업 화면(사이트 머리글·바닥글 없음). 미리보기 | 데이터 | 흐름도, 다운로드, 오른쪽 Agent 채팅.
// 회사 고르기는 /proposal(검색 + 만기도래 회사 목록), 홈·주요공시·만기도래의 '제안서 초안' 버튼, 화면 아래 플로팅 버튼에서 한다.
export default function DeckPage({ searchParams }: { searchParams: { corp?: string } }) {
  const corp = searchParams.corp && /^[0-9A-Za-z_]{1,20}$/.test(searchParams.corp) ? searchParams.corp : null;
  if (!corp) redirect('/proposal');
  return (
    <main id="main" className="proposal deck-page is-standalone">
      <DeckStudio corp={corp} aiEnabled={Boolean(process.env.OPENAI_API_KEY)} />
    </main>
  );
}

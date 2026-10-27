import Link from 'next/link';
import type { Metadata } from 'next';
import { KnowledgeBoard } from '@/components/deck/KnowledgeBoard';
import { PageHead } from '@/components/Ui';

export const metadata: Metadata = { title: '제안서 노하우' };

export default function KnowledgePage({ searchParams }: { searchParams: { slide?: string } }) {
  return (
    <main id="main" className="wrap proposal kb-page">
      <PageHead
        title="제안서 노하우"
        info="현업이 쓰는 판단 기준·관행·표현입니다. 제안서 화면의 '노하우 반영(AI)'이 장표·등급에 맞는 것을 골라 문안에 반영합니다. 누구나 고칠 수 있고 모든 변경은 이력에 남습니다. 사외 프로토타입이라 고객사 비공개 정보는 적지 마세요."
      >
        <p className="small dk-links"><Link href="/proposal">제안서 초안</Link><Link href="/how">작동 방식</Link></p>
      </PageHead>
      <KnowledgeBoard initialSlide={searchParams.slide} />
    </main>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { CompanySearch } from '@/components/CompanySearch';
import { DeckStudio } from '@/components/deck/DeckStudio';
import { PageHead } from '@/components/Ui';

export const metadata: Metadata = { title: '제안서 만들기' };

export default function DeckPage({ searchParams }: { searchParams: { corp?: string } }) {
  const corp = searchParams.corp && /^[0-9A-Za-z_]{1,20}$/.test(searchParams.corp) ? searchParams.corp : null;
  return (
    <main id="main" className="wrap proposal deck-page">
      <PageHead
        title="공모 회사채 제안서 만들기"
        info="NH투자증권 대표주관 제안서 서식으로 장표를 만듭니다. 사례·일정·금리는 공시(DART)·한국은행·공개 리서치 자료에서 채우고, 문안은 AI가 그 숫자만으로 씁니다. 입력한 조건과 문안은 이 브라우저에만 저장됩니다."
      >
        <p className="small"><Link href={corp ? `/proposal?corp=${corp}&type=bond` : '/proposal'}>초안 점검 화면</Link></p>
      </PageHead>
      {corp ? (
        <DeckStudio corp={corp} />
      ) : (
        <div className="pp-search">
          <CompanySearch mode="deck" placeholder="제안할 회사 이름" />
        </div>
      )}
    </main>
  );
}

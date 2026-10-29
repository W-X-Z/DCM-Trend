import { RecoFeed } from '@/components/RecoFeed';
import { WatchPanel } from '@/components/Watch';
import { GRADES, type Grade } from '@/lib/reco';

export const dynamic = 'force-dynamic';

// 홈: RM 영업 추천 피드 (만기도래 일정 + 과거 주관 이력). 관심 회사가 있으면 아래에 소식을 모은다.
export default async function Home({ searchParams }: { searchParams: { g?: string } }) {
  const grade = (GRADES.find((g) => g.key === searchParams.g)?.key ?? null) as Grade | null;
  return (
    <main id="main" className="wrap home">
      <h1 className="sr-only">발행시장 트렌드 홈</h1>
      <RecoFeed grade={grade} />
      <WatchPanel hideEmpty />
    </main>
  );
}

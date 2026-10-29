import { RecoFeed } from '@/components/RecoFeed';
import { WatchPanel } from '@/components/Watch';
import { DEFAULT_PERIOD, GRADES, MARKETS, PERIODS, type Grade, type MarketKey, type Period } from '@/lib/reco';

export const dynamic = 'force-dynamic';

// 홈: RM 영업 추천 피드 (만기도래 일정 + 과거 주관 이력). 필터는 만기일정(?p=)·신용등급(?g=)·상장시장(?mk=)·주관여부(?nh=1).
// 관심 회사가 있으면 아래에 소식을 모은다.
export default async function Home({ searchParams }: { searchParams: { p?: string; g?: string; mk?: string; nh?: string } }) {
  const period = (PERIODS.find((p) => p.key === searchParams.p)?.key ?? DEFAULT_PERIOD) as Period;
  const grade = (GRADES.find((g) => g.key === searchParams.g)?.key ?? null) as Grade | null;
  const market = (MARKETS.find((m) => m.key === searchParams.mk)?.key ?? null) as MarketKey | null;
  const nh = searchParams.nh === '1';
  return (
    <main id="main" className="wrap home">
      <h1 className="sr-only">발행시장 트렌드 홈</h1>
      <RecoFeed period={period} grade={grade} market={market} nh={nh} />
      <WatchPanel hideEmpty />
    </main>
  );
}

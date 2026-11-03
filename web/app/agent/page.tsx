import type { Metadata } from 'next';
import { AgentConsole } from '@/components/agent/AgentConsole';
import { getCompany } from '@/lib/queries';

export const metadata: Metadata = { title: 'Agent' };
export const dynamic = 'force-dynamic';

// Agent 탭: 제안서 Agent(Master + 역할 6개)와 그 Agent 를 고치는 Agent Builder(Master + 편집 2 + 영향 점검)를 이 서버에서 Claude 로 돌린다.
// ?corp= 로 들어오면(각 화면의 '제안서 초안' 버튼) 그 회사 초안을 바로 만든다.
export default async function AgentPage({ searchParams }: { searchParams: { corp?: string } }) {
  const corp = searchParams.corp && /^\d{8}$/.test(searchParams.corp) ? searchParams.corp : null;
  const co = corp ? await getCompany(corp).catch(() => null) : null;
  return (
    <main id="main" className="wrap agent-page">
      <AgentConsole ready={Boolean(process.env.ANTHROPIC_API_KEY)} start={co ? { corp: co.corp_code, name: co.corp_name } : null} />
    </main>
  );
}

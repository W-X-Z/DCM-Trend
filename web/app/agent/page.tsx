import type { Metadata } from 'next';
import { AgentConsole } from '@/components/agent/AgentConsole';

export const metadata: Metadata = { title: 'Agent' };
export const dynamic = 'force-dynamic';

// Agent 탭: 제안서 Agent(Master + 역할 6개)와 그 Agent 를 고치는 Agent Builder(Master + 편집 2 + 영향 점검)를 이 서버에서 Claude 로 돌린다.
export default function AgentPage() {
  return (
    <main id="main" className="wrap agent-page">
      <AgentConsole ready={Boolean(process.env.ANTHROPIC_API_KEY)} />
    </main>
  );
}

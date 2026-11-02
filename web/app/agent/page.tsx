import type { Metadata } from 'next';
import { AgentConsole } from '@/components/agent/AgentConsole';
import { MASTER_MODEL, SUB_MODEL } from '@/lib/agent/config';

export const metadata: Metadata = { title: 'Agent' };
export const dynamic = 'force-dynamic';

// Agent 탭: 제안서 Agent(Master + Sub-agent 2)를 이 서버에서 Claude 로 돌린다. Managed Agent 패키지와 같은 스킬·엔진·프롬프트.
export default function AgentPage() {
  return (
    <main id="main" className="wrap agent-page">
      <AgentConsole ready={Boolean(process.env.ANTHROPIC_API_KEY)} models={{ master: MASTER_MODEL, sub: SUB_MODEL }} />
    </main>
  );
}

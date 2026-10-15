import { AskPanel } from '@/components/AskPanel';
import { PageHead } from '@/components/Ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI 질문' };

export default function AiPage() {
  return (
    <main id="main" className="wrap ai-page">
      <PageHead
        title="AI 질문"
        info="공모 회사채(2019년~), 메자닌(2021년~), 유상증자·IPO(2024년 10월~), 만기·풋 일정, 회사채 미상환 잔액, 시장금리를 조회해 답합니다. 증권신고서 본문 문장(투자위험요소 등)은 아직 검색하지 않습니다. 답의 숫자는 조회 결과 그대로이며, 전망은 하지 않습니다."
      />
      <AskPanel enabled={Boolean(process.env.OPENAI_API_KEY)} />
    </main>
  );
}

import { factChange, factValue, kstDateTime } from '@/lib/format';
import { getInsightFacts, getInsightSummaries } from '@/lib/queries';
import type { InsightFact } from '@/lib/types';

// 인사이트: 위는 요약(AI 또는 규칙 문장), 아래는 근거 수치 카드.
// 요약은 아래 카드의 숫자만 쓰도록 수집 단계에서 검증한다.

function Card({ f }: { f: InsightFact }) {
  const dir = f.change == null ? 0 : Math.sign(Number(f.change));
  return (
    <li className={`fact${f.is_notable ? ' is-notable' : ''}`}>
      <span className="fact-label">{f.label_ko}</span>
      <span className="fact-value">{factValue(f.unit, f.value_now, f.scope)}</span>
      <span className="fact-change">
        <span className={`fact-dir dir-${dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'}`} aria-hidden>{dir > 0 ? '▲' : dir < 0 ? '▼' : '–'}</span>
        {factChange(f.unit, f.change)}
        <span className="fact-base"> {f.period_base} {factValue(f.unit, f.value_base, f.scope)} 대비</span>
      </span>
      <span className="fact-period">{f.period_now}</span>
    </li>
  );
}

export async function InsightPanel({
  scope,
  title = '최근 변화',
  maxCards = 6,
}: {
  scope: string;
  title?: string;
  maxCards?: number;
}) {
  const [facts, summaries] = await Promise.all([
    getInsightFacts().catch(() => null),
    getInsightSummaries().catch(() => []),
  ]);
  const summary = summaries.find((s) => s.scope === scope);
  const pool = (facts ?? []).filter((f) => (scope === 'home' ? f.is_notable && f.scope !== 'rates' : f.scope === scope) && f.value_now != null);
  const cards = [...pool]
    .sort((a, b) => Number(b.is_notable) - Number(a.is_notable) || Number(b.score ?? 0) - Number(a.score ?? 0) || a.priority - b.priority)
    .slice(0, maxCards);
  if (!summary && !cards.length) return null;

  const lines = summary?.summary.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean) ?? [];
  const isAi = summary?.model && summary.model !== 'rule';
  return (
    <section className="section insight" aria-labelledby={`insight-${scope}`}>
      <div className="section-head">
        <h2 id={`insight-${scope}`}>{title}</h2>
        <p>
          {scope === 'rates'
            ? '최신값을 1개월 전과 비교'
            : scope === 'maturity'
              ? '3~6개월 뒤 만기를 1년 전 같은 시점과 비교'
              : '최근 3개월을 전년 같은 기간 또는 직전 12개월과 비교'}
        </p>
      </div>
      {lines.length > 0 && (
        <div className="insight-summary">
          <ul>
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p className="insight-meta">
            {isAi ? 'AI 요약' : '자동 요약'}
            {summary ? `, ${kstDateTime(summary.created_at)} 기준` : ''}
            {isAi ? '. 아래 수치만 넣어 만들었고, 수치에 없는 숫자나 전망 문장은 걸러 냅니다.' : ''}
          </p>
        </div>
      )}
      {cards.length > 0 && (
        <ul className="facts">
          {cards.map((f) => (
            <Card key={f.fact_key} f={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

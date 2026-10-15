import Link from 'next/link';
import { date, factChange, factValue } from '@/lib/format';
import { getInsightFacts, getInsightIssues } from '@/lib/queries';
import type { InsightFact, InsightIssue } from '@/lib/types';
import { SectionHead } from './Ui';

// 지표 변화: SQL(mart.insight_facts)이 계산한 값을 그대로 그린다. AI 문장은 쓰지 않는다.
const BASE_LABEL: Record<string, string> = { yoy: '전년 동기', trail: '직전 12개월', m1: '1개월 전' };
const BAR_UNITS = new Set(['krw', 'count', 'pct', 'months']);

function Tile({ f, color }: { f: InsightFact; color: string }) {
  const dir = f.change == null ? 0 : Math.sign(Number(f.change));
  const now = Number(f.value_now ?? 0);
  const base = f.value_base == null ? null : Number(f.value_base);
  const showBars = BAR_UNITS.has(f.unit) && base != null && now >= 0 && base >= 0;
  const max = Math.max(now, base ?? 0) || 1;
  const baseLabel = f.scope === 'maturity' ? '1년 전' : BASE_LABEL[f.compare] ?? f.period_base;
  return (
    <li className={`tile${f.is_notable ? ' is-notable' : ''}`}>
      <span className="tile-label">{f.label_ko}</span>
      <span className="tile-value">{factValue(f.unit, f.value_now, f.scope)}</span>
      <span className={`tile-delta dir-${dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'}`}>
        <span aria-hidden>{dir > 0 ? '▲' : dir < 0 ? '▼' : '–'}</span> {factChange(f.unit, f.change)}
        <span className="tile-base"> {baseLabel} 대비</span>
      </span>
      {showBars && (
        <span className="tile-bars" aria-hidden>
          <span className="tile-bar is-base" style={{ width: `${(base! / max) * 100}%` }} />
          <span className="tile-bar" style={{ width: `${(now / max) * 100}%`, background: color }} />
        </span>
      )}
      {showBars && (
        <span className="sr-only">
          {baseLabel} {factValue(f.unit, base, f.scope)}
        </span>
      )}
    </li>
  );
}

export async function ChangeTiles({
  scope,
  title = '최근 변화',
  color = 'var(--accent)',
  max = 6,
  info,
}: {
  scope: string;
  title?: string;
  color?: string;
  max?: number;
  info?: string;
}) {
  const facts = await getInsightFacts().catch(() => null);
  const pool = (facts ?? []).filter((f) => f.scope === scope && f.value_now != null);
  if (!pool.length) return null;
  const tiles = [...pool]
    .sort((a, b) => Number(b.is_notable) - Number(a.is_notable) || Number(b.score ?? 0) - Number(a.score ?? 0) || a.priority - b.priority)
    .slice(0, max);
  const period = pool[0].period_now;
  return (
    <section className="section" aria-labelledby={`chg-${scope}`}>
      <SectionHead
        id={`chg-${scope}`}
        title={title}
        info={info ?? `${period} 값을 비교 기간과 견줍니다. 회색 막대가 비교 기간, 색 막대가 최근입니다. 기준 이상 바뀐 지표를 먼저 보여 줍니다.`}
        right={period && period !== '최신' ? <span className="muted small tnum">{period}</span> : undefined}
      />
      <ul className="tiles">
        {tiles.map((f) => (
          <Tile key={f.fact_key} f={f} color={color} />
        ))}
      </ul>
    </section>
  );
}

// 눈여겨볼 회사: 규칙으로 뽑은 후보 중 AI 가 고른 특이 이슈·고객 접점
function IssueCard({ it }: { it: InsightIssue }) {
  return (
    <li className={`issue kind-${it.kind}`}>
      <div className="issue-top">
        <span className="issue-kind">{it.kind === 'issue' ? '이슈' : '접점'}</span>
        <Link href={`/company/${it.corp_code}`} className="issue-corp">{it.corp_name}</Link>
      </div>
      <p className="issue-title">{it.title}</p>
      <p className="issue-why">{it.why}</p>
      <p className="issue-angle">{it.angle}</p>
      <div className="issue-foot">
        <span className="tnum">{date(it.event_dt)}</span>
        {it.rcept_no && (
          <a href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${it.rcept_no}`} target="_blank" rel="noreferrer">공시</a>
        )}
      </div>
    </li>
  );
}

export async function IssueCards() {
  const items = await getInsightIssues().catch(() => null);
  if (!items?.length) return null;
  const touch = items.filter((i) => i.kind !== 'issue');
  const issues = items.filter((i) => i.kind === 'issue');
  const isAi = items[0].model && items[0].model !== 'rule';
  return (
    <section className="section" aria-labelledby="issues-h">
      <SectionHead
        id="issues-h"
        title="눈여겨볼 회사"
        info={`공시·발행·만기·차입 잔액에서 규칙으로 뽑은 후보 가운데 ${isAi ? 'AI가 고르고 문장으로 정리했습니다' : '규칙 우선순위로 골랐습니다'}. 후보 데이터에 없는 회사나 숫자는 쓰지 않습니다. 접점은 자금 조달 수요로 이어질 수 있는 사건, 이슈는 시장에서 이례적인 사건입니다.`}
        right={<span className="muted small tnum">{date(items[0].asof)}</span>}
      />
      <ul className="issues">
        {[...touch, ...issues].map((it) => (
          <IssueCard key={`${it.rank}-${it.corp_code}`} it={it} />
        ))}
      </ul>
    </section>
  );
}

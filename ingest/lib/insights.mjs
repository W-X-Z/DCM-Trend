// 인사이트 요약: DB 가 계산한 사실(mart.insight_facts)만 넣어 3~5줄 요약을 만든다.
// - 숫자는 미리 문자열로 만들어 넘기고, 요약에 없는 숫자가 나오면 버리고 규칙 문장을 쓴다.
// - 예측·권고 문장은 쓰지 않는다.
// - OPENAI_API_KEY 가 없으면 규칙 문장만 저장한다.

import { createHash } from 'node:crypto';

const SCOPES = ['bond', 'mezz', 'equity', 'ipo', 'maturity', 'rates'];
const SCOPE_LABEL = {
  home: '발행시장 전체', bond: '회사채', mezz: '메자닌', equity: '유상증자', ipo: 'IPO', maturity: '만기 도래', rates: '금리',
};

function won(v) {
  const eok = Number(v) / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조원`;
  return `${Math.round(eok).toLocaleString('ko-KR')}억원`;
}

export function formatValue(unit, v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  switch (unit) {
    case 'krw': return won(n);
    case 'count': return `${Math.round(n).toLocaleString('ko-KR')}${''}`;
    case 'pct': return `${n.toFixed(1)}%`;
    case 'months': return `${(n / 12).toFixed(1)}년`;
    case 'bp': return `${Math.round(n)}bp`;
    case 'rate': return `${n.toFixed(2)}%`;
    default: return String(n);
  }
}

export function formatChange(unit, c) {
  if (c === null || c === undefined) return null;
  const n = Number(c);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const a = Math.abs(n);
  switch (unit) {
    case 'krw':
    case 'count': return `${sign}${a.toFixed(1)}%`;
    case 'pct': return `${sign}${a.toFixed(1)}%p`;
    case 'months': return `${sign}${a.toFixed(1)}개월`;
    case 'bp':
    case 'rate': return `${sign}${Math.round(a)}bp`;
    default: return `${sign}${a}`;
  }
}

export function toReadable(f) {
  const countUnit = f.unit === 'count' ? (f.scope === 'maturity' ? '곳' : '건') : '';
  return {
    scope: f.scope,
    key: f.fact_key,
    지표: f.label_ko,
    기간: f.period_now,
    값: f.value_now == null ? null : `${formatValue(f.unit, f.value_now)}${countUnit}`,
    비교기준: f.period_base,
    비교값: f.value_base == null ? null : `${formatValue(f.unit, f.value_base)}${countUnit}`,
    변화: formatChange(f.unit, f.change),
    눈에띄는변화: f.is_notable,
    점수: Number(f.score ?? 0),
  };
}

// 규칙 문장 (AI 없이도 항상 만들 수 있는 요약)
export function ruleSummary(facts) {
  const usable = facts.filter((f) => f.값 && f.변화).sort((a, b) => b.점수 - a.점수);
  if (!usable.length) return '- 비교할 수 있는 기간의 데이터가 아직 부족하다.';
  const notable = usable.filter((f) => f.눈에띄는변화).slice(0, 4);
  const line = (f) => `- ${f.지표}: ${f.기간} ${f.값}, ${f.비교기준} ${f.비교값} 대비 ${f.변화}`;
  if (!notable.length) return ['- 기준 이상으로 바뀐 지표는 없다.', ...usable.slice(0, 2).map(line)].join('\n');
  return notable.map(line).join('\n');
}

const SYSTEM = `너는 증권사 IB 커버리지 RM에게 발행시장 동향을 정리해 주는 애널리스트다.
규칙:
- 주어진 JSON 사실만 쓴다. 숫자는 JSON의 문자열을 그대로 옮기고 새 숫자를 만들거나 계산하지 않는다.
- 예측, 전망, 권고, 추측("~할 것", "~로 보인다", "~해야")은 쓰지 않는다.
- 3~5개의 불릿("- "로 시작), 각 불릿은 한 문장. 변화가 큰 것부터.
- 각 불릿에 비교 기준(예: 전년 동기, 직전 12개월, 1개월 전)을 밝힌다.
- 눈에띄는변화가 false 인 항목은 "큰 변화 없음"으로 묶어 한 줄 이내로만 언급한다.
- 존댓말 없이 간결한 보고서 문체("~했다", "~이다")로 쓴다.`;

function numbersIn(text) {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => s.replace(/,/g, ''));
}

export function validate(summary, facts) {
  const allowed = new Set();
  for (const f of facts) {
    for (const s of [f.기간, f.값, f.비교기준, f.비교값, f.변화]) for (const n of numbersIn(String(s ?? ''))) allowed.add(n);
  }
  for (const n of ['1', '2', '3', '4', '5', '6', '12']) allowed.add(n); // "3개월", "12개월" 같은 기간 표현
  const bad = numbersIn(summary).filter((n) => !allowed.has(n));
  const banned = /(것으로\s*(보인다|예상|전망)|전망|예상된다|할\s*것이다|해야\s*한다|권고|추천)/.test(summary);
  return { ok: bad.length === 0 && !banned && /^- /m.test(summary), bad, banned };
}

async function openai({ key, model, scope, facts }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `범위: ${SCOPE_LABEL[scope]}\n사실(JSON):\n${JSON.stringify(facts, null, 1)}` },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return String(body.choices?.[0]?.message?.content ?? '').trim();
}

export async function buildSummaries({ db, key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-5-mini', log = console.log }) {
  const raw = await db.rpc('ingest_insight_facts');
  const readable = raw.map(toReadable);
  const byScope = Object.fromEntries(SCOPES.map((s) => [s, readable.filter((f) => f.scope === s)]));
  byScope.home = readable.filter((f) => f.눈에띄는변화 && f.scope !== 'rates').sort((a, b) => b.점수 - a.점수).slice(0, 8);
  const hashes = await db.rpc('ingest_summary_hashes');
  const asof = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const out = {};
  for (const [scope, facts] of Object.entries(byScope)) {
    if (!facts.length) continue;
    const hash = createHash('sha256').update(JSON.stringify({ facts, model: key ? model : 'rule' })).digest('hex');
    if (hashes[scope] === hash) {
      out[scope] = 'same';
      continue;
    }
    let summary = null;
    let used = 'rule';
    if (key) {
      try {
        const text = await openai({ key, model, scope, facts });
        const v = validate(text, facts);
        if (v.ok) {
          summary = text;
          used = model;
        } else {
          log(`insights: ${scope} AI 요약 검증 실패 (숫자 ${v.bad.join(',')}${v.banned ? ', 전망 표현' : ''}) → 규칙 문장 사용`);
        }
      } catch (e) {
        log(`insights: ${scope} AI 호출 실패 → 규칙 문장 사용: ${e.message}`);
      }
    }
    summary ??= ruleSummary(facts);
    await db.rpc('ingest_put_insight_summary', { p_scope: scope, p_asof: asof, p_facts_hash: hash, p_summary: summary, p_model: used });
    out[scope] = used;
  }
  log(`insights: ${JSON.stringify(out)}`);
  return out;
}

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

// 최근 3개월 상위 딜 → 요약 입력용 사실. 한 건이 합계의 30% 이상이면 눈에 띄는 사실로 본다.
export const TOP_DEAL_NOTABLE_PCT = 30;
export function topDealFacts(rows) {
  return rows.map((r) => ({
    scope: r.scope,
    key: `top_deal_${r.rank}`,
    지표: `${SCOPE_LABEL[r.scope] ?? r.scope} 최근 3개월 ${r.rank === 1 ? '최대' : `${r.rank}번째`} 딜`,
    기간: r.period,
    값: `${r.corp_name}${r.sub_type ? ` ${r.sub_type}` : ''} ${won(r.amount_krw)} (합계의 ${Number(r.share_pct).toFixed(1)}%)`,
    비교기준: null,
    비교값: null,
    변화: null,
    눈에띄는변화: Number(r.share_pct) >= TOP_DEAL_NOTABLE_PCT,
    점수: Number(r.share_pct) / TOP_DEAL_NOTABLE_PCT,
  }));
}

// 규칙 문장 (AI 없이도 항상 만들 수 있는 요약)
export function ruleSummary(facts) {
  const usable = facts.filter((f) => f.값 && f.변화).sort((a, b) => b.점수 - a.점수);
  const top = facts.find((f) => f.key === 'top_deal_1' && f.눈에띄는변화);
  const topLine = top ? [`- ${top.지표}: ${top.값}`] : [];
  if (!usable.length) return topLine.length ? topLine.join('\n') : '- 비교할 수 있는 기간의 데이터가 아직 부족하다.';
  const notable = usable.filter((f) => f.눈에띄는변화).slice(0, 4);
  const line = (f) => `- ${f.지표}: ${f.기간} ${f.값}, ${f.비교기준} ${f.비교값} 대비 ${f.변화}`;
  if (!notable.length) return ['- 기준 이상으로 바뀐 지표는 없다.', ...usable.slice(0, 2).map(line), ...topLine].join('\n');
  return [...notable.map(line), ...topLine].join('\n');
}

// 프롬프트를 바꾸면 올린다 → 사실이 같아도 요약을 다시 만든다
const PROMPT_VERSION = 3;

const SYSTEM = `너는 증권사 IB 커버리지 RM에게 발행시장 동향을 정리해 주는 애널리스트다.
규칙:
- 주어진 JSON 사실만 쓴다. 숫자는 JSON의 문자열을 그대로 옮기고 새 숫자를 만들거나 계산하지 않는다.
- 예측, 전망, 권고, 추측("~할 것", "~로 보인다", "~해야")은 쓰지 않는다.
- 3~5개의 불릿("- "로 시작), 각 불릿은 한 문장이고 지표는 두 개까지. 변화가 큰 것부터.
- 숫자와 이름에 따옴표를 붙이지 않는다.
- 각 불릿에 비교 기준(예: 전년 동기, 직전 12개월, 1개월 전)을 밝힌다.
- 눈에띄는변화가 false 인 항목은 숫자 없이 지표 이름만 주어진다. 마지막 불릿 하나에 "큰 변화 없음: 지표, 지표"로만 쓴다.
- key 가 top_deal 로 시작하는 항목은 최근 3개월 상위 딜이다. 금액 변화가 한두 건에 좌우됐으면 그 딜 이름과 비중을 밝힌다.
  금액이 크게 늘거나 줄었다는 문장은 '최대 1건 제외' 지표가 있으면 함께 적는다.
- 존댓말 없이 간결한 보고서 문체("~했다", "~이다")로 쓴다.`;

// 눈에 띄지 않는 지표는 이름만 넘겨 요약이 숫자 나열이 되지 않게 한다.
export function compactForModel(facts) {
  return facts
    .filter((f) => f.눈에띄는변화 || !String(f.key).startsWith('top_deal'))
    .map((f) => (f.눈에띄는변화 ? f : { scope: f.scope, key: f.key, 지표: f.지표, 눈에띄는변화: false }));
}

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
  const top = topDealFacts(await db.rpc('ingest_insight_top_deals', { p_per_scope: 2 }).catch((e) => {
    log(`insights: 상위 딜 조회 실패 → 생략: ${e.message}`);
    return [];
  }));
  const byScope = Object.fromEntries(SCOPES.map((s) => [s, [...readable, ...top].filter((f) => f.scope === s)]));
  byScope.home = [
    ...readable.filter((f) => f.눈에띄는변화 && f.scope !== 'rates').sort((a, b) => b.점수 - a.점수).slice(0, 8),
    ...top.filter((f) => f.key === 'top_deal_1' && Number(f.점수) >= 50 / TOP_DEAL_NOTABLE_PCT),
  ];
  const hashes = await db.rpc('ingest_summary_hashes');
  const asof = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const out = {};
  for (const [scope, facts] of Object.entries(byScope)) {
    if (!facts.length) continue;
    const hash = createHash('sha256').update(JSON.stringify({ facts, model: key ? model : 'rule', prompt: PROMPT_VERSION })).digest('hex');
    if (hashes[scope] === hash) {
      out[scope] = 'same';
      continue;
    }
    let summary = null;
    let used = 'rule';
    if (key) {
      try {
        const input = compactForModel(facts);
        const text = await openai({ key, model, scope, facts: input });
        const v = validate(text, input);
        if (v.ok) {
          summary = text;
          used = model;
        } else {
          log(`insights: ${scope} AI 요약 검증 실패 (숫자 ${v.bad.join(',')}${v.banned ? ', 전망 표현' : ''}) → 규칙 문장 사용`);
          await db.rpc('ingest_log_issue', {
            p_stage: 'quality', p_code: 'summary_rejected',
            p_detail: { scope, bad_numbers: v.bad, banned: v.banned, text: text.slice(0, 1500) },
          }).catch(() => {});
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

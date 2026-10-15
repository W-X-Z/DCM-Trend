// 다가오는 영업 접점: SQL 규칙이 뽑은 후보(public.ingest_signal_candidates: 만기·풋·단기 차입) 중에서
// AI 가 6곳을 고르고 한 줄 근거·대화 소재를 쓴다. 최근 공시·발행 같은 사건은 홈 피드(feed.mjs)가 맡는다.
// - AI 는 후보 목록 밖의 회사를 고를 수 없고, 그 후보의 수치에 없는 숫자를 쓰면 그 항목은 버린다.
// - 유효한 항목이 모자라면 규칙 우선순위로 채운다. OPENAI_API_KEY 가 없으면 규칙만 쓴다.

import { createHash } from 'node:crypto';

const PROMPT_VERSION = 3;
const MIN_ITEMS = 4;
const TARGET_ITEMS = 6;
const MAX_ITEMS = 9;
const PER_SIGNAL = 2;   // 같은 신호에서 최대
const MIN_ISSUES = 2;   // 후보에 이슈가 있으면 최소

const KRW_KEYS = new Set(['만기 금액', '풋 대상 금액', '금액', '1년 내 만기 차입 합계', '사모 회사채 1년 내', 'CP 1년 내', '전단채']);

function won(v) {
  const eok = Number(v) / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조원`;
  return `${Math.round(eok).toLocaleString('ko-KR')}억원`;
}

const dot = (d) => String(d).slice(0, 10).replace(/-/g, '.');

export function formatFact(key, v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  if (KRW_KEYS.has(key)) return won(v);
  if (/일$/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return dot(v);
  if (key === '신주 비율(%)') return `${Number(v).toFixed(1)}%`;
  if (key === '수요예측 경쟁률') return `${Number(v)}배`;
  if (key === '확정공모가' || key === '희망밴드 하단') return `${Number(v).toLocaleString('ko-KR')}원`;
  return String(v);
}

// 후보 → AI 에 넘길 읽기 쉬운 형태 (id 로 원래 후보를 찾는다)
export function readableCandidates(raw) {
  return raw.map((c, i) => {
    const facts = Object.fromEntries(Object.entries(c.facts ?? {}).map(([k, v]) => [k, formatFact(k, v)]).filter(([, v]) => v !== null));
    const context = Object.fromEntries(Object.entries(c.context ?? {}).map(([k, v]) => [k, formatFact(k, v)]).filter(([, v]) => v !== null));
    return {
      id: `c${i + 1}`,
      구분: c.kind === 'issue' ? '이슈' : '접점',
      신호: c.label,
      회사: c.corp_name,
      사실: facts,
      맥락: context,
      _raw: c,
    };
  });
}

const numbersIn = (text) => (String(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => s.replace(/,/g, '').replace(/\.0+$/, ''));
const BANNED = /(전망|예상된다|예상됩니다|할\s*것이다|것으로\s*(보인다|예상)|투자\s*(권유|추천)|매수|매도\s*추천|수익률\s*보장)/;

export function validateItem(item, cand) {
  if (!cand) return { ok: false, why: 'unknown id' };
  const text = [item.title, item.why, item.angle].join(' ');
  if (!item.title || !item.why || !item.angle) return { ok: false, why: 'missing field' };
  if (item.title.length > 40 || item.why.length > 160 || item.angle.length > 160) return { ok: false, why: 'too long' };
  const allowed = new Set(['1', '2', '3', '4', '5', '6', '12']);
  const src = [cand.회사, cand.신호, ...Object.values(cand.사실), ...Object.values(cand.맥락)].join(' ');
  for (const n of numbersIn(src)) allowed.add(n);
  const bad = numbersIn(text).filter((n) => !allowed.has(n));
  if (bad.length) return { ok: false, why: `numbers ${bad.join(',')}` };
  if (BANNED.test(text)) return { ok: false, why: 'banned phrase' };
  return { ok: true };
}

// 규칙 문장 (AI 없이도 만들 수 있는 항목)
const RULE_TEXT = {
  refi_due: (f) => ({ title: '공모채 만기 도래', why: `${f['가장 빠른 만기일'] ?? ''}부터 공모 회사채 ${f['만기 금액'] ?? ''} 만기가 돌아오고, 차환 신고서는 아직 없다.`, angle: '차환 시기와 조달 방식(공모·사모·CP) 확인' }),
  cp_reliant: (f) => ({ title: '공모채 이력 없이 단기 차입 의존', why: `${f['보고서 기준일'] ?? ''} 기준 1년 안에 만기가 돌아오는 차입이 ${f['1년 내 만기 차입 합계'] ?? ''}이고 공모 회사채 이력은 없다.`, angle: '첫 공모채 발행이나 만기 장기화 수요 점검' }),
  invest: (f) => ({ title: f['공시'] ?? '투자·인수 결정', why: `${f['공시일'] ?? ''} ${f['공시'] ?? ''} 공시를 냈다.`, angle: '투자·인수 재원 조달 계획 확인' }),
  put_due: (f) => ({ title: '메자닌 조기상환청구 시작', why: `${f['가장 빠른 풋 시작일'] ?? ''}부터 ${f['종류'] ?? '메자닌'} ${f['풋 대상 금액'] ?? ''}의 조기상환청구가 시작된다.`, angle: '상환 재원과 리파이낸싱 계획 확인' }),
  cb_buyback: (f) => ({ title: f['공시'] ?? '사채 만기 전 취득', why: `${f['공시일'] ?? ''} ${f['공시'] ?? ''} 공시를 냈다.`, angle: '취득 재원과 재매각 계획 확인' }),
  hybrid: (f) => ({ title: '신종자본·조건부자본증권 발행 결정', why: `${f['공시일'] ?? ''} ${f['공시'] ?? ''} 공시를 냈다.`, angle: '자본 확충 수요와 후속 조달 확인' }),
  first_issue: (f) => ({ title: `첫 ${f['상품'] ?? ''} 발행`, why: `${f['기준일'] ?? ''} ${f['상품'] ?? ''} ${f['금액'] ?? ''}을 발행했고, 수집 기간 중 첫 발행이다.`, angle: '후속 조달 계획과 주관사 구성 확인' }),
  weak_demand: (f) => (f['상품'] === 'IPO'
    ? { title: '공모가 밴드 하단 미만 확정', why: `확정공모가 ${f['확정공모가'] ?? ''}로 희망밴드 하단 ${f['희망밴드 하단'] ?? ''}보다 낮게 정해졌다.`, angle: '상장 후 수급과 후속 조달 영향 확인' }
    : { title: '회사채 수요예측 미달', why: `회사채 ${f['금액'] ?? ''} 수요예측 경쟁률이 ${f['수요예측 경쟁률'] ?? ''}였다.`, angle: '미매각 물량 처리와 다음 조달 방식 확인' }),
  restructure: (f) => ({ title: f['공시'] ?? '구조 변경 결정', why: `${f['공시일'] ?? ''} ${f['공시'] ?? ''} 공시를 냈다.`, angle: '구조 변경에 따른 자금 수요와 신용도 변화 확인' }),
  distress: (f) => ({ title: f['공시'] ?? '위기 신호 공시', why: `${f['공시일'] ?? ''} ${f['공시'] ?? ''} 공시를 냈다.`, angle: '기존 발행 채권과 거래 노출 점검' }),
  big_dilution: (f) => ({ title: '대규모 유상증자', why: `${f['결정일'] ?? ''} ${f['방식'] ?? ''} ${f['금액'] ?? ''} 유상증자를 결정했고 신주 비율은 ${f['신주 비율(%)'] ?? ''}이다.`, angle: '자금 사용처와 추가 조달 필요 여부 확인' }),
};

function toItem(cand, text) {
  const r = cand._raw;
  return {
    kind: r.kind,
    corp_code: r.corp_code,
    corp_name: r.corp_name,
    title: text.title.trim(),
    why: text.why.replace(/\s+/g, ' ').trim(),
    angle: text.angle.trim(),
    signal_key: r.signal_key,
    signal_label: r.label,
    event_dt: r.event_dt,
    rcept_no: r.rcept_no ?? null,
  };
}

// 규칙으로 고르기: 신호 우선순위대로 돌아가며 한 곳씩, 같은 회사는 한 번만
export function ruleSelect(cands, n = TARGET_ITEMS, exclude = new Set()) {
  const bySignal = new Map();
  for (const c of cands) {
    if (!bySignal.has(c._raw.signal_key)) bySignal.set(c._raw.signal_key, []);
    bySignal.get(c._raw.signal_key).push(c);
  }
  const queues = [...bySignal.values()].sort((a, b) => a[0]._raw.priority - b[0]._raw.priority);
  const out = [];
  const used = new Set(exclude);
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      while (q.length && used.has(q[0]._raw.corp_code)) q.shift();
      const c = q.shift();
      if (!c) continue;
      used.add(c._raw.corp_code);
      out.push(toItem(c, (RULE_TEXT[c._raw.signal_key] ?? RULE_TEXT.invest)(c.사실)));
      if (out.length >= n) break;
    }
  }
  return out;
}

const SYSTEM = `너는 증권사 IB 커버리지 본부의 RM(기업 영업 담당)을 돕는 리서처다.
입력은 만기·풋옵션·차입 잔액 데이터에서 규칙으로 뽑은 '다가오는 자금 조달 수요' 후보 회사 목록이다. RM이 이번 주에 먼저 연락할 회사를 ${TARGET_ITEMS}곳 골라라.
고르는 기준:
- 3~6개월 뒤 공모채 만기가 돌아오는데 차환 신고서가 없는 회사, 6개월 안에 메자닌 조기상환청구(풋)가 시작되는 회사, 공모채 없이 단기 차입이 큰 회사.
- 같은 '신호'에서는 ${PER_SIGNAL}곳까지만. 같은 회사는 한 번.
- 금액이 크고, 공모채 발행 이력이나 등급이 있고, NH 대표주관 이력이 없는 회사를 앞에 둔다(새 접점).
- 금융회사, 공기업, 스팩, 리츠는 고르지 않는다.
각 항목:
- id: 후보 id
- title: 무슨 일인지 20자 안팎 (회사명 빼고)
- why: 자연스러운 한 문장. 그 후보의 사실 2~3개만 골라 쓴다. "등급 AA0, 만기 금액 …"처럼 항목을 쉼표로 나열하지 않는다. 숫자는 주어진 문자열 그대로.
  좋은 예: "2027.02.14부터 공모채 1.3조원 만기가 돌아오는데 아직 차환 신고서를 내지 않았다."
- angle: RM이 대화에서 확인할 점이나 꺼낼 상품을 30자 안팎의 짧은 구로. 단정하지 말고 확인·점검 식으로. 좋은 예: "차환 시기와 공모·사모 선택 확인"
금지: 예측·전망 문장, 투자 권유, 후보에 없는 숫자, 존댓말.
JSON 으로만 답한다: {"items":[{"id":"c3","title":"...","why":"...","angle":"..."}]}`;

async function openai({ key, model, cands }) {
  const input = cands.map(({ _raw, ...c }) => c);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `후보(JSON):\n${JSON.stringify(input)}` },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return JSON.parse(String(body.choices?.[0]?.message?.content ?? '{}'));
}

export function pickFromModel(out, cands) {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const items = [];
  const rejected = [];
  const used = new Set();
  for (const it of Array.isArray(out?.items) ? out.items : []) {
    const cand = byId.get(it.id);
    const v = validateItem(it, cand);
    if (!v.ok) {
      rejected.push({ id: it.id, why: v.why, item: it });
      continue;
    }
    if (used.has(cand._raw.corp_code)) continue;
    used.add(cand._raw.corp_code);
    items.push(toItem(cand, it));
  }
  return { items, rejected };
}

// AI 결과를 고르게: 신호별 최대 PER_SIGNAL, 이슈 최소 MIN_ISSUES(후보가 있으면), 모자라면 규칙으로 채움
export function balance(items, cands) {
  const perSignal = new Map();
  const kept = [];
  for (const it of items) {
    const n = perSignal.get(it.signal_key) ?? 0;
    if (n >= PER_SIGNAL) continue;
    perSignal.set(it.signal_key, n + 1);
    kept.push(it);
  }
  let out = kept.slice(0, MAX_ITEMS);
  const used = () => new Set(out.map((i) => i.corp_code));
  const issueCands = cands.filter((c) => c._raw.kind === 'issue');
  const issueCount = () => out.filter((i) => i.kind === 'issue').length;
  if (issueCands.length && issueCount() < MIN_ISSUES) {
    const add = ruleSelect(issueCands, MIN_ISSUES - issueCount(), used());
    // 이슈를 넣을 자리가 없으면 맨 뒤 접점부터 뺀다
    while (out.length + add.length > MAX_ITEMS) {
      const idx = out.map((i) => i.kind).lastIndexOf('touchpoint');
      if (idx < 0) break;
      out.splice(idx, 1);
    }
    out = [...out, ...add];
  }
  if (out.length < TARGET_ITEMS) {
    const counts = new Map();
    for (const i of out) counts.set(i.signal_key, (counts.get(i.signal_key) ?? 0) + 1);
    const rest = cands.filter((c) => (counts.get(c._raw.signal_key) ?? 0) < PER_SIGNAL);
    out = [...out, ...ruleSelect(rest, TARGET_ITEMS - out.length, used())];
  }
  return out;
}

export async function buildIssues({ db, key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-5-mini', log = console.log }) {
  const raw = await db.rpc('ingest_signal_candidates', {});
  const cands = readableCandidates(raw ?? []);
  const asof = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  if (!cands.length) {
    log('issues: 후보 없음');
    return { items: 0, model: null };
  }
  const hash = createHash('sha256').update(JSON.stringify({ raw, model: key ? model : 'rule', prompt: PROMPT_VERSION })).digest('hex');
  if ((await db.rpc('ingest_issue_hash', {})) === hash) {
    log('issues: 후보가 같아 건너뜀');
    return { items: 0, model: 'same' };
  }

  let items = [];
  let used = 'rule';
  if (key) {
    try {
      const out = await openai({ key, model, cands });
      const picked = pickFromModel(out, cands);
      items = picked.items;
      if (picked.rejected.length) {
        log(`issues: AI 항목 ${picked.rejected.length}개 검증 실패`);
        await db.rpc('ingest_log_issue', {
          p_stage: 'quality', p_code: 'issue_item_rejected', p_detail: { rejected: picked.rejected.slice(0, 10) },
        }).catch(() => {});
      }
      if (items.length) used = model;
    } catch (e) {
      log(`issues: AI 호출 실패 → 규칙으로 고름: ${e.message}`);
    }
  }
  const before = items.length;
  items = balance(items, cands);
  if (used !== 'rule' && items.length > before) used = `${used}+rule`;
  if (items.length < MIN_ITEMS) log(`issues: ${items.length}곳만 고름`);
  await db.rpc('ingest_put_issue_set', { p_asof: asof, p_items: items, p_model: used, p_hash: hash });
  log(`issues: ${items.length}곳 (${used})`);
  return { items: items.length, model: used };
}

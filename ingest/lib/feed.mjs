// 홈 피드: 최근 2주의 이례적 발행과 주요 공시를 카드 10장 안팎으로 정리한다.
// - 후보와 사실 값은 SQL(public.ingest_feed_candidates)이 만든다. 숫자는 이미 '1,500억원', '13.7배' 같은 문자열이다.
// - AI 는 후보 안에서 고르고 제목·본문·RM 포인트를 쓴다. 후보 밖 회사, 후보 사실에 없는 숫자, 전망 표현은 버린다.
// - 모자라면 점수 순서로 규칙 문장을 채운다. OPENAI_API_KEY 가 없으면 규칙만 쓴다.

import { createHash } from 'node:crypto';

const PROMPT_VERSION = 3;
const TARGET = 10;
const MIN_ITEMS = 6;
const MAX_ITEMS = 12;
const PER_KIND = 3;     // 같은 종류(회사채·메자닌·합병 …) 최대
const MIN_PER_TAG = 3;  // 발행·공시 각각 최소 (후보가 있으면)

export const KIND_LABEL = {
  bond: '회사채', mezz: '메자닌', equity: '유상증자', ipo: 'IPO',
  d_merger: '합병', d_split: '분할', d_exchange: '주식교환', d_biz_buy: '영업양수', d_biz_sell: '영업양도',
  d_asset_buy: '자산 취득', d_asset_sell: '자산 매각', d_stake_buy: '지분 인수', d_stake_sell: '지분 매각',
  d_capcut: '감자', d_rehab: '회생', d_dissolve: '해산', d_suspend: '영업정지', d_default: '부도',
  d_noncurrent: '자산 취득·처분',
  d_stdebt: '단기차입', d_capex: '시설투자', d_control: '최대주주 변경', d_pledge: '주식담보',
  d_guarantee: '채무보증·담보', d_plshock: '실적 급변', d_halt: '상장 위험', d_embezzle: '횡령·배임',
  d_bankmgmt: '채권은행 관리', d_bond_default: '원리금 미지급', d_treasury_sell: '자사주 처분', d_cb_buyback: 'CB 풋 취득',
};

const DISTRESS = new Set(['d_rehab', 'd_dissolve', 'd_suspend', 'd_default', 'd_halt', 'd_embezzle', 'd_bankmgmt', 'd_bond_default']);

export function kindLabel(c) {
  if (c.kind === 'mezz') return c.facts?.['종류'] ?? '메자닌';
  if (c.kind === 'bond' && c.facts?.['구분'] && c.facts['구분'] !== '일반회사채') return c.facts['구분'];
  return KIND_LABEL[c.kind] ?? c.kind;
}

const dot = (d) => String(d ?? '').slice(0, 10).replace(/-/g, '.');

export function readableFeed(raw) {
  return raw.map((c, i) => ({
    id: `f${i + 1}`,
    구분: c.tag,
    종류: kindLabel(c),
    회사: c.corp_name,
    날짜: dot(c.event_dt),
    특징: c.label,
    사실: c.facts ?? {},
    맥락: c.context ?? {},
    _raw: c,
  }));
}

// 숫자 비교: 쉼표·앞자리 0·끝의 .0 을 지운다
const norm = (s) => s.replace(/,/g, '').replace(/^0+(?=\d)/, '').replace(/\.0+$/, '');
const numbersIn = (text) => (String(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(norm);

function allowedNumbers(cand) {
  const src = [cand.회사, cand.특징, cand.날짜, ...Object.values(cand.사실), ...Object.values(cand.맥락)].join(' ');
  const out = new Set(['1', '2', '3']);
  for (const n of numbersIn(src)) out.add(n);
  // 날짜 2026.10.15 → 2026, 10, 15 도 허용 ('10월 15일')
  for (const m of src.matchAll(/(\d{4})\.(\d{2})\.(\d{2})/g)) {
    out.add(m[1]);
    out.add(norm(m[2]));
    out.add(norm(m[3]));
  }
  return out;
}

const BANNED = /(전망|예상된다|예상됩니다|할\s*것이다|것으로\s*(보인다|예상)|투자\s*(권유|추천)|매수|매도\s*추천|수익률\s*보장|역대급|폭발|대박|확인\s*필요하다|세부\s*사항은|공시문을\s*통해)/;

export function validateCard(item, cand) {
  if (!cand) return { ok: false, why: 'unknown id' };
  if (!item.headline || !item.body || !item.point) return { ok: false, why: 'missing field' };
  if (item.headline.length > 40 || item.body.length > 190 || item.point.length > 60) return { ok: false, why: 'too long' };
  const text = [item.headline, item.body, item.point].join(' ');
  const allowed = allowedNumbers(cand);
  const bad = numbersIn(text).filter((n) => !allowed.has(n));
  if (bad.length) return { ok: false, why: `numbers ${bad.join(',')}` };
  if (BANNED.test(text)) return { ok: false, why: 'banned phrase' };
  return { ok: true };
}

// 규칙 문장 (AI 없이도 만들 수 있는 카드) --------------------------------------
// 조사 '으로/로': 마지막 글자 받침으로 고른다 (ㄹ 받침은 '로')
export function ro(word) {
  const ch = String(word ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '로';
  const jong = code % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}
// '…이다/…다': 받침이 있으면 '이다' (숫자·기호로 끝나면 '이다')
export function ida(word) {
  const ch = String(word ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '이다';
  return code % 28 === 0 ? '다' : '이다';
}
const has = (c, f) => (c._raw.flags ?? []).includes(f);
// '2026.10.13' → '10월 13일'
export const kd = (s) => {
  const m = String(s ?? '').match(/(\d{4})[.-](\d{2})[.-](\d{2})/);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : String(s ?? '');
};
const amountOf = (f) => f['양수금액'] ?? f['양도금액'] ?? f['양수가액'] ?? f['양도가액'] ?? f['차입금액'] ?? f['투자금액']
  ?? f['채무보증금액'] ?? f['담보제공금액'] ?? f['미지급 금액'] ?? f['발생 금액'] ?? f['정지 영업 매출'] ?? f['부도금액'] ?? null;
const partyOf = (f) => f['대상 회사'] ?? f['합병 상대회사'] ?? f['거래상대방'] ?? f['분할설립회사'] ?? f['양수인'] ?? f['변경 후 최대주주'] ?? f['채무자'] ?? null;

const DISC_POINT = {
  d_merger: '합병 후 재무구조와 자금 수요 확인',
  d_split: '분할 후 신설회사 조달 계획 확인',
  d_exchange: '지배구조 변화와 후속 거래 확인',
  d_biz_buy: '인수 재원과 조달 방식 확인',
  d_biz_sell: '매각 대금 사용처 확인',
  d_asset_buy: '취득 재원과 분할 지급 일정 확인',
  d_asset_sell: '매각 대금 사용처 확인',
  d_stake_buy: '인수 재원과 인수금융 수요 확인',
  d_stake_sell: '매각 대금 사용처 확인',
  d_capcut: '자본 확충 후속 조달 확인',
  d_rehab: '기존 발행 채권·거래 노출 점검',
  d_dissolve: '기존 발행 채권·거래 노출 점검',
  d_suspend: '매출 공백과 유동성 영향 점검',
  d_default: '기존 발행 채권·거래 노출 점검',
  d_noncurrent: '취득·처분 재원과 목적 확인',
  d_stdebt: '차입 만기와 회사채·CP 차환 수요 확인',
  d_capex: '투자 재원과 장기 조달 계획 확인',
  d_control: '새 최대주주의 인수 재원과 리파이낸싱 수요 확인',
  d_pledge: '주식담보 대출 조건과 반대매매 위험 점검',
  d_guarantee: '보증 대상 계열사·PF 노출 점검',
  d_plshock: '실적 변화가 등급·조달 여건에 주는 영향 확인',
  d_halt: '기존 발행 채권·메자닌 노출 점검',
  d_embezzle: '기한이익상실 조항과 기존 거래 노출 점검',
  d_bankmgmt: '기존 발행 채권·거래 노출 점검',
  d_bond_default: '기존 발행 채권·거래 노출 점검',
  d_treasury_sell: '교환사채 발행 등 후속 조달 확인',
  d_cb_buyback: '풋 상환 재원과 재발행 수요 확인',
};

export function ruleCard(c) {
  const f = c.사실;
  const k = c._raw.kind;
  if (k === 'bond') {
    const headline = has(c, 'i_undersub') ? '회사채 수요예측 미달'
      : has(c, 'i_first') ? '첫 공모 회사채 발행'
      : has(c, 'i_lost_client') ? `${f['대표주관'] ?? '타사'} 대표주관으로 회사채 발행`
      : has(c, 'i_downgrade') ? `등급 ${f['직전 회차 등급'] ?? ''}→${f['등급'] ?? ''} 하향 후 발행`
      : has(c, 'i_big_increase') ? `회사채 ${f['최초 모집액']}→${f['확정 발행액']} 증액`
      : has(c, 'i_wide_spread') ? '가산금리 높은 회사채 발행'
      : `${f['만기 구성'] ?? ''} 회사채 ${f['확정 발행액'] ?? ''}`.trim();
    const body = [
      `${kd(f['수요예측일'] ?? c.날짜)} 수요예측을 거쳐 ${f['만기 구성'] ?? ''} 구조로 ${f['확정 발행액'] ?? ''}을 확정했다.`.replace(/\s+/g, ' ').replace('만기 미상 구조로 ', ''),
      f['전체 수요예측 경쟁률'] ? `전체 경쟁률은 ${f['전체 수요예측 경쟁률']}였다.` : null,
    ].filter(Boolean).join(' ');
    const point = has(c, 'i_lost_client') ? '이번 딜 주관사 선정 배경 확인'
      : has(c, 'i_downgrade') ? '등급 하락 뒤 수요와 금리 수준 확인' : '트랜치 구성과 증액 배경 확인';
    return { headline, body, point };
  }
  if (k === 'mezz') {
    const body = [
      `${kd(f['결정일'] ?? c.날짜)} ${f['공모 여부'] ?? ''} ${f['종류'] ?? '메자닌'} ${f['발행액'] ?? ''} 발행을 결정했다.`.replace(/\s+/g, ' '),
      f['표면이자율'] && f['만기이자율'] ? `표면이자율 ${f['표면이자율']}, 만기이자율 ${f['만기이자율']}이다.` : null,
    ].filter(Boolean).join(' ');
    return { headline: `${f['종류'] ?? '메자닌'} ${f['발행액'] ?? ''} 발행 결정`.trim(), body, point: '조달 목적과 후속 자금 수요 확인' };
  }
  if (k === 'equity') {
    const body = [
      `${kd(f['결정일'] ?? c.날짜)} ${f['방식'] ?? ''} 유상증자로 ${f['조달액'] ?? ''}을 조달하기로 했다.`.replace(/\s+/g, ' '),
      f['신주 비율'] ? `신주 비율은 ${f['신주 비율']}다.` : null,
    ].filter(Boolean).join(' ');
    return { headline: `${f['방식'] ?? ''} 유상증자 ${f['조달액'] ?? ''}`.trim(), body, point: '자금 사용처와 추가 조달 필요 여부 확인' };
  }
  if (k === 'ipo') {
    const body = [
      f['희망밴드'] ? `희망밴드 ${f['희망밴드']}에서 공모가를 ${f['확정공모가'] ?? ''}${ro(f['확정공모가'])} 정했다.` : `공모가를 ${f['확정공모가'] ?? ''}${ro(f['확정공모가'])} 정했다.`,
      f['수요예측 경쟁률'] ? `수요예측 경쟁률은 ${f['수요예측 경쟁률']}이다.` : null,
    ].filter(Boolean).join(' ');
    return { headline: `IPO 공모가 ${f['확정공모가'] ?? ''} 확정`.trim(), body, point: '상장 후 추가 조달 계획 확인' };
  }
  const when = kd(f['공시일'] ?? c.날짜);
  const ratio = f['자기자본 대비'];
  const point = DISC_POINT[k] ?? '자금 수요로 이어지는지 확인';
  if (k === 'd_control' && (f['변경 후 최대주주'] || f['양수인'])) {
    const to = f['변경 후 최대주주'] ?? f['양수인'];
    const share = f['변경 후 지분율'] ?? f['예정 지분율'];
    const body = [
      `${when} 최대주주가 ${f['변경 전 최대주주'] ?? f['양도인'] ?? '기존 주주'}에서 ${to}${share ? `(지분율 ${share})` : ''}${ro(share ? ')' : to)} 바뀌는 공시를 냈다.`,
      f['양수금액'] ? `양수 금액은 ${f['양수금액']}이다.` : f['변경 사유'] ? `사유는 ${f['변경 사유']}${ida(f['변경 사유'])}.` : null,
    ].filter(Boolean).join(' ');
    return { headline: c.특징, body, point };
  }
  if (k === 'd_plshock' && (f['영업이익 증감률'] || f['매출액 증감률'])) {
    const body = [
      `${when} 매출·손익 구조 변동 공시를 냈다.`,
      [f['매출액 증감률'] ? `매출액 ${f['매출액 증감률']}` : null, f['영업이익 증감률'] ? `영업이익 ${f['영업이익 증감률']}` : null].filter(Boolean).join(', ') + ' 변동했다.',
      f['흑자·적자 전환'] ? `${f['흑자·적자 전환']}${ida(f['흑자·적자 전환'])}.` : null,
    ].filter(Boolean).join(' ');
    return { headline: c.특징, body, point };
  }
  const amt = amountOf(f);
  const party = partyOf(f);
  const purpose = f['차입 목적'] ?? f['투자 대상'] ?? f['투자 목적'] ?? null;
  const body = [
    `${when} ${f['공시'] ?? c.특징} 공시를 냈다.`,
    amt ? `금액은 ${amt}${ratio ? `${ro(amt)} 자기자본의 ${ratio}` : ''}${party ? `, 상대는 ${party}` : ''}${ida(party ?? (ratio ? '%' : amt))}.` : party ? `상대는 ${party}${ida(party)}.` : null,
    purpose ? `${f['차입 목적'] ? '목적은' : '대상은'} ${purpose}${ida(purpose)}.` : null,
  ].filter(Boolean).join(' ');
  return { headline: c.특징, body, point };
}

function toCard(cand, text, model) {
  const r = cand._raw;
  return {
    tag: r.tag,
    kind: r.kind,
    kind_label: cand.종류,
    tone: DISTRESS.has(r.kind) || (r.flags ?? []).includes('i_undersub') ? 'alert' : null,
    corp_code: r.corp_code,
    corp_name: r.corp_name,
    headline: String(text.headline).trim(),
    body: String(text.body).replace(/\s+/g, ' ').trim(),
    point: String(text.point).trim().replace(/[?？.。]+$/, ''),
    event_dt: r.event_dt,
    rcept_no: r.rcept_no ?? null,
    ref_key: r.ref_key ?? null,
    label: r.label,
    flags: r.flags ?? [],
    by: model,
  };
}

const SYSTEM = `너는 증권사 IB 커버리지 본부 RM(기업 영업 담당)을 위한 발행시장 카드뉴스 에디터다.
입력은 최근 2주의 공시·발행 데이터에서 규칙으로 뽑은 후보다(구분: 발행 또는 공시, 특징: 규칙이 붙인 이유). RM이 오늘 알아야 할 것을 ${TARGET}건 골라 카드로 써라.
고르는 기준:
- 발행: 이례적인 발행 (수요예측 미달, 큰 증액, 첫 공모채, 장기물·저등급, 높은 가산금리, 대형·공모 메자닌, 공모가 밴드 밖 확정, 대규모 희석 증자).
- 발행 중 '이전 NH 대표주관 고객의 타사 주관'(예전에 NH가 대표주관한 회사가 이번엔 다른 주관사로 발행)과 '직전 회차보다 등급 하락'은 RM이 꼭 알아야 하므로 우선한다.
- 공시: 자금 수요로 이어질 사건 (단기차입금 증가, 신규 시설투자, 최대주주 변경·경영권 양수도, 큰 자산·지분 취득, 영업양수, 합병·분할) 과 위기 신호 (사채 원리금 미지급, 채권은행 관리, 회생, 부도, 상장폐지 사유·실질심사, 횡령·배임, 영업정지, 해산).
- 발행과 공시를 각각 ${MIN_PER_TAG}건 이상 넣는다(후보가 있으면). 같은 '종류'는 ${PER_KIND}건까지. 같은 회사는 한 번.
- 자회사 소규모합병, 소액(100억원 미만) 사건, 같은 사업지·같은 거래상대방이 반복되는 공시는 다른 후보가 충분하면 하나만 고르거나 뺀다.
- 금액이 크고 RM이 먼저 연락할 이유가 분명한 것을 앞에 둔다. 배열 순서가 곧 중요도다. 금융지주·은행·증권·카드·캐피탈의 발행은 다른 후보가 충분하면 뒤에 둔다.
각 카드:
- id: 후보 id
- headline: 무슨 일인지 28자 안팎. 회사명은 빼고, 핵심 숫자 하나는 넣어도 좋다.
- body: 1~2문장, 110자 안팎. 그 후보의 '사실'에서 2~4개를 골라 자연스러운 기사 문장으로 쓴다.
  · 날짜는 '10월 6일'처럼 쓰고, '수요예측일 2026.10.06에', '공시일 …에'처럼 항목 이름을 붙이지 않는다.
  · 회사채는 만기별 트랜치 금액, 경쟁률, 가산금리(또는 금리)를 중심으로. 최초 모집액과 확정 발행액이 같으면 증액이라고 쓰지 않는다.
  · 공시는 금액, 상대방·대상, 목적, 자산·자기자본 대비 비율을 중심으로. 최대주주 변경은 변경 전·후 최대주주와 지분율을 쓴다.
  · '이전 NH 대표주관 딜(건)'이 있으면 이번 대표주관사와 함께 쓴다. 예: '이전 NH 대표주관 딜이 2건 있는 회사로, 이번엔 KB증권이 대표주관을 맡았다.'
  · 사실이 부족하면 한 문장만 쓴다. '세부사항은 공시를 확인해야 한다' 같은 빈 문장은 쓰지 않는다.
  · 숫자는 주어진 문자열 그대로 쓴다(1,500억원, 13.7배, 40.19%). 쉼표로 항목을 나열하지 않는다.
  좋은 예(회사채): "10월 15일 수요예측에서 2년물 500억원, 3년물 1,000억원에 경쟁률 13.7배가 몰려 1,000억원 모집을 1,500억원으로 늘렸다."
  좋은 예(공시): "미국·노르웨이 엔진 정비사 지분 100%를 3,315억원에 사들인다. 자기자본의 40.19% 규모다."
- point: RM이 대화에서 확인하거나 꺼낼 이야기를 30자 안팎의 명사구로. 물음표 없이 '…확인', '…점검'으로 끝낸다. 좋은 예: "인수 잔금 재원과 인수금융 수요 확인"
금지: 예측·전망 문장, 투자 권유, 후보 사실에 없는 숫자(합계·비율을 새로 계산하지 않는다), 존댓말, 과장 표현.
JSON 으로만 답한다: {"items":[{"id":"f3","headline":"...","body":"...","point":"..."}]}`;

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
    signal: AbortSignal.timeout(240_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return JSON.parse(String(body.choices?.[0]?.message?.content ?? '{}'));
}

export function pickCards(out, cands, model = 'ai') {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const items = [];
  const rejected = [];
  const used = new Set();
  for (const it of Array.isArray(out?.items) ? out.items : []) {
    const cand = byId.get(it.id);
    const v = validateCard(it, cand);
    if (!v.ok) {
      rejected.push({ id: it.id, why: v.why, item: it });
      continue;
    }
    if (used.has(cand._raw.corp_code)) continue;
    used.add(cand._raw.corp_code);
    items.push(toCard(cand, it, model));
  }
  return { items, rejected };
}

// 점수 순서로 규칙 카드 채우기 (같은 회사·종류 상한 지킴)
function fillByRule(out, cands, n, filter = () => true) {
  const usedCorp = new Set(out.map((i) => i.corp_code));
  const kindCount = new Map();
  for (const i of out) kindCount.set(i.kind, (kindCount.get(i.kind) ?? 0) + 1);
  const add = [];
  for (const c of cands) {
    if (add.length >= n) break;
    if (!filter(c) || usedCorp.has(c._raw.corp_code) || (kindCount.get(c._raw.kind) ?? 0) >= PER_KIND) continue;
    const card = toCard(c, ruleCard(c), 'rule');
    if (!validateCard(card, c).ok) continue;
    usedCorp.add(c._raw.corp_code);
    kindCount.set(c._raw.kind, (kindCount.get(c._raw.kind) ?? 0) + 1);
    add.push(card);
  }
  return add;
}

export function balanceCards(items, cands) {
  const kindCount = new Map();
  let out = [];
  for (const it of items) {
    const n = kindCount.get(it.kind) ?? 0;
    if (n >= PER_KIND) continue;
    kindCount.set(it.kind, n + 1);
    out.push(it);
  }
  out = out.slice(0, MAX_ITEMS);
  for (const tag of ['발행', '공시']) {
    const have = out.filter((i) => i.tag === tag).length;
    if (have >= MIN_PER_TAG) continue;
    const add = fillByRule(out, cands, MIN_PER_TAG - have, (c) => c._raw.tag === tag);
    while (out.length + add.length > MAX_ITEMS) {
      const other = out.map((i) => i.tag).lastIndexOf(tag === '발행' ? '공시' : '발행');
      if (other < 0) break;
      out.splice(other, 1);
    }
    out = [...out, ...add];
  }
  if (out.length < TARGET) out = [...out, ...fillByRule(out, cands, TARGET - out.length)];
  return out;
}

export async function buildFeed({ db, key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-5-mini', log = console.log, days = 14 }) {
  const raw = await db.rpc('ingest_feed_candidates', { p_days: days });
  const cands = readableFeed(raw ?? []);
  const asof = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  if (!cands.length) {
    log('feed: 후보 없음');
    return { items: 0, model: null };
  }
  const hash = createHash('sha256').update(JSON.stringify({ raw, model: key ? model : 'rule', prompt: PROMPT_VERSION })).digest('hex');
  if ((await db.rpc('ingest_feed_hash', {})) === hash) {
    log('feed: 후보가 같아 건너뜀');
    return { items: 0, model: 'same' };
  }

  let items = [];
  let used = 'rule';
  if (key) {
    try {
      const out = await openai({ key, model, cands });
      const picked = pickCards(out, cands, model);
      items = picked.items;
      if (picked.rejected.length) {
        log(`feed: AI 카드 ${picked.rejected.length}개 검증 실패`);
        await db.rpc('ingest_log_issue', {
          p_stage: 'quality', p_code: 'feed_item_rejected', p_detail: { rejected: picked.rejected.slice(0, 10) },
        }).catch(() => {});
      }
      if (items.length) used = model;
    } catch (e) {
      log(`feed: AI 호출 실패 → 규칙으로 고름: ${e.message}`);
    }
  }
  const before = items.length;
  items = balanceCards(items, cands);
  if (used !== 'rule' && items.length > before) used = `${used}+rule`;
  if (items.length < MIN_ITEMS) log(`feed: ${items.length}건만 고름`);
  await db.rpc('ingest_put_feed_set', { p_asof: asof, p_items: items, p_model: used, p_hash: hash });
  log(`feed: ${items.length}건 (${used})`);
  return { items: items.length, model: used };
}

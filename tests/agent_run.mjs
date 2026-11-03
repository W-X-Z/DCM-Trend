// Agent 탭(제안서 Agent + Agent Builder) 실행 테스트: 가짜 Claude API 로 Master·역할·도구·작업 세션·수정안이 맞게 도는지.
// DB 는 고정 데이터(이랜드월드)로 바꾼다. 실행: node tests/agent_run.mjs
import { build } from 'esbuild';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = readFileSync(join(root, 'tests/fixtures/deck_eland.json'), 'utf8');

let pass = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    process.exitCode = 1;
  } else pass += 1;
};
const truthy = (name, v) => eq(name, !!v, true);

// ── 가짜 Claude ──────────────────────────────────────────────────────
const seen = [];
let scripts = {};
let fail429 = 0;
let n = 0;
const tu = (name, input) => ({ type: 'tool_use', id: `toolu_${++n}`, name, input });
const msg = (content, stop = 'tool_use') => ({ id: `msg_${++n}`, type: 'message', role: 'assistant', model: 'mock-haiku', content, stop_reason: stop });
const say = (text) => msg([{ type: 'text', text }], 'end_turn');
function problems(body) {
  const errs = [];
  if (body.messages[0]?.role !== 'user') errs.push('first not user');
  body.messages.forEach((m, i) => {
    if (i && body.messages[i - 1].role === m.role) errs.push(`same role at ${i}`);
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
      const nx = body.messages[i + 1];
      const got = nx && Array.isArray(nx.content) ? nx.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : [];
      if (ids.length && JSON.stringify(ids) !== JSON.stringify(got)) errs.push(`ids at ${i}`);
    }
  });
  return errs;
}
const WHO = [
  ['dcm.master', /'DCM 제안서 Agent'의 Master/], ['company', /'기업 분석' 역할/], ['market', /'시장 분석' 역할/], ['deal', /'딜 구조 설계' 역할/],
  ['sales', /'Sales 세부 전략' 역할/], ['deck', /'장표 구성' 역할/], ['review', /'검토' 역할/],
  ['builder.master', /'Agent Builder'의 Master/], ['knowhow', /'노하우 편집' 역할/], ['prompt', /'프롬프트 편집' 역할/], ['impact', /'영향 점검' 역할/],
];
const step = (body) => body.messages.filter((m) => m.role === 'assistant').length;
const lastResults = (body) => {
  const c = body.messages.at(-1).content;
  return Array.isArray(c) ? c.filter((b) => b.type === 'tool_result') : [];
};
const resJson = (body, i = 0) => JSON.parse(lastResults(body)[i].content);
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b);
    const sys = body.system[0].text;
    const who = WHO.find(([, re]) => re.test(sys))?.[0] ?? '?';
    seen.push({ who, body });
    if (fail429 > 0) {
      fail429 -= 1;
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      return res.end(JSON.stringify({ error: { message: 'rate limit' } }));
    }
    const errs = problems(body);
    // 실제 모델처럼 thinking 블록을 붙인다. 서명은 대화 앞부분(system)에 묶여, 앞부분이 바뀐 채 돌려보내면 거절된다
    const sig = createHash('md5').update(sys).digest('hex');
    body.messages.forEach((mm, i) => {
      if (Array.isArray(mm.content) && mm.content.some((x) => x.type === 'thinking' && x.signature !== sig)) errs.push(`messages.${i}.content.0: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation.`);
    });
    const f = scripts[who];
    if (errs.length || !f) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: errs.join('; ') || `no script for ${who}` } }));
    }
    const out = f(body, step(body));
    out.content = [{ type: 'thinking', thinking: '생각 중', signature: sig }, ...out.content];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;

const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'stub' }));
    b.onResolve({ filter: /^\.\.\/db$/ }, () => ({ path: 'db', namespace: 'stub' }));
    b.onResolve({ filter: /^\.\.\/queries$/ }, () => ({ path: 'queries', namespace: 'stub' }));
    b.onResolve({ filter: /^\.\.\/deck\/data$/ }, () => ({ path: 'data', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
      loader: 'js',
      contents: {
        'server-only': 'export {}',
        db: 'export const selectFresh = async () => [];',
        queries: `export const searchCompanies = async (q) => q.includes('이랜드') ? [{ corp_code: '00207108', corp_name: '이랜드월드', market: '기타', deal_count: 30, last_deal_dt: '2026-09-01' }] : [];`,
        data: `const D = ${fixture}; export const getDeckData = async (c) => (c === '00207108' ? JSON.parse(JSON.stringify(D)) : null);`,
      }[a.path],
    }));
  },
};
const out = await build({
  stdin: { contents: `export * from './lib/agent/dcm'; export * from './lib/agent/builder'; export * from './lib/agent/defs';`, resolveDir: join(root, 'web'), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', plugins: [stub],
  tsconfig: join(root, 'web/tsconfig.json'),
});
const m = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const assets = { ...m.DEFAULT_ASSETS };

async function runDcm(messages, session) {
  const ev = [];
  await m.runDcm({ messages, session, assets, memory: '- 위승종' }, (e) => ev.push(e));
  const last = [...ev].reverse().find((e) => e.t === 'session');
  return { ev, done: ev.find((e) => e.t === 'done'), session: last?.session ?? session };
}

// ── 1) 새 초안: Master → 역할 6개 → 산출 ─────────────────────────────
let compareKeys = [];
scripts = {
  'dcm.master': (body, k) => {
    if (k === 0) return msg([tu('find_company', { query: '이랜드월드' })]);
    if (k === 1) return msg([tu('open_company', { corp_code: resJson(body)[0].corp_code, mode: 'new' })]);
    if (k === 2) return msg([tu('call_roles', { roles: ['company', 'market', 'deal', 'sales'], task: '새 초안: 노하우 기본값으로 판단' })]);
    if (k === 3) return msg([tu('call_roles', { roles: ['review', 'deck'], task: '새 초안' })]);
    if (k === 4) return msg([tu('render', {})]);
    return say('이랜드월드 제112회 공모사채 제안서 초안을 만들었어요.');
  },
  company: (body, k) => {
    if (k === 0) return msg([tu('facts', {})]);
    if (k === 1) {
      const f = resJson(body);
      const last = f.최근회차[0];
      return msg([tu('memo', { points: [`최근 4회 모두 1년 단일 구조 → 반복 구조 (CO-01)`, `직전 제${last ? '111' : ''}회 경쟁률 ${last?.경쟁률 ?? '–'} (CO-02)`, '참여금액 73,219억원으로 최고 (CO-02)'] })]);
    }
    if (k === 2) return msg([tu('write', { field: 'corp', lines: ['최근 회차 발행금리와 가산금리 흐름 확인 필요'] })]);
    return say('반복 구조, 수요 보통.');
  },
  market: (body, k) => {
    if (k === 0) return msg([tu('facts', {})]);
    if (k === 1) {
      const f = resJson(body);
      compareKeys = f.비교사례후보.slice(0, 2).map((x) => x.key);
      return msg([tu('decide', { changes: [
        { type: 'peer_scope', text: 'group', reason: '같은 노치 사례 10건 미만', rules: ['MK-01'] },
        { type: 'peer_cases', months: 6, max: 16, reason: '기본', rules: ['MK-03'] },
        { type: 'compare', keys: compareKeys, reason: '직전 회차와 최근 사례', rules: ['MK-04'] },
        { type: 'tranches', tranches: [{ tenor: '3년', eok: 100 }], reason: '권한 밖', rules: [] },
      ] })]);
    }
    if (k === 2) return msg([tu('write', { field: 'peers', lines: [`최근 1년 BBB등급 수요예측 사례 기준 비교 진행`, '금리는 반드시 하락할 것'] })]);
    if (k === 3) return msg([tu('memo', { points: ['같은 등급 수요 분위기 보통 (MK-10)'] })]);
    return say('사례를 골랐어요.');
  },
  deal: (body, k) => {
    if (k === 0) return msg([tu('facts', {})]);
    if (k === 1) {
      const f = resJson(body);
      truthy('딜: 메모 받음', f.메모?.['기업 분석']?.length && f.메모?.['시장 분석']?.length);
      const tr = f.직전회차구조.트랜치.map((t) => ({ tenor: t.만기, eok: t.신고억원 }));
      return msg([tu('decide', { changes: [
        { type: 'tranches', tranches: tr, reason: '직전 회차 구조', rules: ['DL-01'] },
        { type: 'band', band: { type: 'spread', low: -30, high: 30 }, reason: '현업 관행', rules: ['DL-07'] },
        { type: 'demand_date', date: f.수요예측가능일값[1], reason: '가운데 날', rules: ['DL-11'] },
      ] })]);
    }
    if (k === 2) return msg([tu('write', { field: 'lead', lines: ['NH투자증권은 반드시 흥행을 보장'] })]);
    if (k === 3) {
      const r = resJson(body);
      eq('딜: 단정 표현 첫 탈락', r.결과, '넣지 못함');
      return msg([tu('write', { field: 'lead', lines: ['NH투자증권은 **이랜드월드의 회사채 발행 및 당사 총액인수**를 제안'] })]);
    }
    if (k === 4) return msg([tu('write', { field: 'termNotes', notes: { band: '현업 관행 개별민평 ±30bp', fee: '이전 회차 준용' } }), tu('write', { field: 'sales', lines: ['권한 밖'] })]);
    if (k === 5) return msg([tu('memo', { points: ['1년 단일 구조 유지 (DL-01)'] })]);
    return say('직전 회차 구조로 정했어요.');
  },
  sales: (body, k) => {
    if (k === 0) return msg([tu('facts', {})]);
    if (k === 1) {
      const f = resJson(body);
      truthy('Sales: 딜 메모 받음', f.메모?.['딜 구조 설계']?.length);
      return msg([tu('write', { field: 'sales', lines: ['운용사 중심 수요 확인 → IR·NDR 우선 진행', '증권사 리테일 세일즈 병행 제안'] })]);
    }
    return say('Sales 문안을 넣었어요.');
  },
  deck: (body, k) => {
    if (k === 0) return msg([tu('facts', {})]);
    if (k === 1) return msg([tu('decide', { changes: [{ type: 'slides', items: [{ id: 'compare', on: true }], reason: '미매각 사례 있음', rules: ['DK-03'] }] })]);
    return say('미매각 사례 분석을 켰어요.');
  },
  review: (body, k) => {
    if (k === 0) return msg([tu('session', {}), tu('checks', {})]);
    return say('[트랜치 검토] 근거 숫자 추가 → 만기별 수요 한 줄 (RV-05)');
  },
};
let r = await runDcm([{ role: 'user', content: '이랜드월드 제안서 초안 만들어줘' }], m.emptySession());
const S1 = r.session;
eq('초안: Master 도구 순서', r.ev.filter((e) => e.t === 'tool' && e.agent === 'master').map((e) => e.name), ['find_company', 'open_company', 'call_roles', 'call_roles', 'render']);
eq('초안: 역할 시작 순서(동시 2개 → 딜 → Sales → 장표 → 검토)', r.ev.filter((e) => e.t === 'role' && e.phase === 'start').map((e) => e.role).slice(2), ['deal', 'sales', 'deck', 'review']);
eq('초안: 같은 순서 역할은 동시에', new Set(r.ev.filter((e) => e.t === 'role' && e.phase === 'start').slice(0, 2).map((e) => e.role)), new Set(['company', 'market']));
eq('초안: 회사', S1.state?.corp, '00207108');
eq('초안: 모델', seen.find((s) => s.who === 'deal').body.model, 'claude-haiku-5-5');
truthy('역할 시스템 = 역할 프롬프트 + 노하우', /DL-02 A등급 만기/.test(seen.find((s) => s.who === 'deal').body.system[0].text) && /C-01/.test(seen.find((s) => s.who === 'deal').body.system[0].text));
truthy('검토 시스템에 딜·시장·Sales 노하우', ['DL-02', 'MK-04', 'SL-05', 'RV-01'].every((x) => seen.find((s) => s.who === 'review').body.system[0].text.includes(x)));
const roleTools = (who) => seen.find((s) => s.who === who).body.tools.map((t) => t.name);
eq('역할 도구: 기업', roleTools('company'), ['facts', 'write', 'memo']);
eq('역할 도구: 장표', roleTools('deck'), ['facts', 'decide']);
eq('역할 도구: 검토', roleTools('review'), ['session', 'checks']);
eq('결정 기록: 역할', [...new Set(S1.log.map((x) => x.role))], ['market', 'deal', 'deck']);
truthy('결정 기록: 항목 번호', S1.log.find((x) => x.role === 'deal' && x.rules.includes('DL-07')));
truthy('결정 기록: 같은 값은 유지', S1.log.some((x) => /유지/.test(x.what)));
eq('비교 사례 반영', S1.state.input.compareKeys, compareKeys);
eq('장표 켬', S1.state.input.items.compare, true);
const marketDecide = r.ev.find((e) => e.t === 'tool_done' && /tranches: 시장 분석 역할은/.test(e.note));
truthy('권한 밖 결정 거절', marketDecide);
eq('문안: 단정 줄 제외', S1.state.edits.peers, ['최근 1년 BBB등급 수요예측 사례 기준 비교 진행']);
eq('문안: lead 재시도 후 통과', S1.state.edits.lead, 'NH투자증권은 **이랜드월드의 회사채 발행 및 당사 총액인수**를 제안');
eq('문안: termNotes 칸 병합', [S1.state.edits.termNotes.band, S1.state.edits.termNotes.fee, typeof S1.state.edits.termNotes.rating], ['현업 관행 개별민평 ±30bp', '이전 회차 준용', 'string']);
eq('문안: Sales', S1.state.edits.sales.length, 2);
eq('문안 표시(역할)', [S1.texts.lead.role, S1.texts.sales.role, S1.texts.peers.role, S1.texts.peers.dropped], ['deal', 'sales', 'market', 1]);
truthy('남의 칸 쓰기 거절', r.ev.find((e) => e.t === 'tool_done' && !e.ok && /딜 구조 설계 역할이 쓸 수 있는 칸/.test(e.note)));
eq('메모: 없는 숫자 줄 제외', [S1.memos.company.length, S1.memos.company.some((x) => x.includes('73,219'))], [2, false]);
truthy('검토 의견 저장', /RV-05/.test(S1.review));
truthy('산출', r.ev.some((e) => e.t === 'render' && e.slides > 10));
eq('끝', r.done.cont, false);
eq('도구 결과 짝 오류 없음', seen.every((s) => problems(s.body).length === 0), true);
const T1 = r.done.messages;

// ── 2) 조건 변경: 딜만 → Sales 문안은 다시 써야 함 ──────────────────────
seen.length = 0;
scripts['dcm.master'] = (body, k) => {
  if (k === 0) {
    truthy('Master 시스템에 세션 요약', /최근결정/.test(body.system[0].text));
    return msg([tu('call_roles', { roles: ['deal'], task: '사용자 요청: 3년 단일 1,500억으로 바꿔줘' })]);
  }
  if (k === 1) {
    const res = resJson(body);
    eq('변경: 다시 써야 할 문안 알림(딜이 안 고친 칸 + Sales)', res.다시써야할문안.map((x) => x.문안).sort(), ['Sales 전략', 'Term-sheet 비고', '주요 제안 첫 문장'].sort());
    return msg([tu('session', {})]);
  }
  return say('바꿨어요.');
};
scripts.deal = (body, k) => {
  if (k === 0) return msg([tu('decide', { changes: [{ type: 'tranches', tranches: [{ tenor: '3년', eok: 1500 }], reason: '사용자 요청', rules: [] }] })]);
  if (k === 1) return msg([tu('write', { field: 'sizing', lines: ['3년 단일 1,500억원 제안'] })]);
  return say('3년 단일로 바꿨어요.');
};
r = await runDcm([{ role: 'user', content: '3년 단일 1,500억으로 바꿔줘' }], S1);
const S2 = r.session;
eq('변경: 트랜치', S2.state.input.tranches, [{ tenor: '3년', eok: 1500 }]);
eq('변경: 증액 한도 재계산', S2.state.input.maxEok > 1500, true);
eq('변경: stale', [S2.texts.sales.stale, S2.texts.sizing.stale, S2.texts.lead.stale], [true, false, true]);
eq('변경: 결정 기록 이어짐', S2.log.length > S1.log.length, true);

// ── 3) Builder: 노하우 수정안 + 영향 점검 ─────────────────────────────
seen.length = 0;
let proposalId = null;
scripts['builder.master'] = (body, k) => {
  if (k === 0) return msg([tu('list_targets', {})]);
  if (k === 1) return msg([tu('call_editor', { kind: 'knowhow', task: '피드백: A급은 3년물 위주로. 고칠 곳 후보 DL-02' })]);
  if (k === 2) {
    const r0 = resJson(body);
    proposalId = r0.수정안[0].id;
    return msg([tu('call_impact', { proposal_id: proposalId })]);
  }
  if (k === 3) return msg([tu('record_dev_request', { title: '민평 4사 연계', detail: '밴드 근거에 민평 필요' }), tu('record_memory', { text: '[선호] 답은 3줄 이내' })]);
  return say('노하우 수정안이에요. 승인하면 바로 반영돼요.');
};
scripts.knowhow = (body, k) => {
  if (k === 0) return msg([tu('list_items', { asset: 'knowhow.deal' })]);
  if (k === 1) return msg([tu('read_item', { id: 'DL-02' })]);
  if (k === 2) return msg([tu('propose_knowhow', { op: 'replace', id: 'DL-02', title: 'A등급 만기', body: '- 조건: 회사 등급이 A등급군일 때\n- 선택: ① 3년물 단일 또는 3년물 중심 (기본) ② 5년물은 사용자가 원할 때만\n- 근거: 사용자 피드백 (2026-11-03)', reason: 'A급은 3년물 위주' })]);
  return say('DL-02 를 고쳤어요.');
};
scripts.impact = (body, k) => {
  if (k === 0) {
    const first = [body.messages[0].content].flat().map((b) => (typeof b === 'string' ? b : b.text)).join('');
    truthy('영향 점검: 전·후 받음', /DL-02/.test(first) && /3년물 단일/.test(first));
    return msg([tu('list_items', {})]);
  }
  return say('- 중복: 없음\n- 모순: RV-01\n- 영향 역할: 딜 구조 설계, 검토\n- 다시 실행: 딜 구조 설계 → 트랜치 검토');
};
const bev = [];
await m.runBuilder({ messages: [{ role: 'user', content: 'A급은 3년물 위주로 해줘. 민평도 넣어줘. 답은 짧게.' }], assets, memory: null, seq: 4 }, (e) => bev.push(e));
const prop = bev.find((e) => e.t === 'proposal')?.proposal;
eq('Builder: 도구 순서', bev.filter((e) => e.t === 'tool' && e.agent === 'master').map((e) => e.name), ['list_targets', 'call_editor', 'call_impact', 'record_dev_request', 'record_memory']);
eq('Builder: 수정안 번호(이어서)', prop?.id, 'p5');
eq('Builder: 대상', [prop.edit.kind, prop.edit.asset, prop.edit.op, prop.edit.id], ['knowhow', 'knowhow.deal', 'replace', 'DL-02']);
truthy('Builder: 전 = 지금 항목', prop.before.startsWith('### DL-02 A등급 만기') && /3년물에 중심/.test(prop.before));
truthy('Builder: 피드백 원문', /A급은 3년물/.test(prop.feedback));
const next = m.applyEdit(assets['knowhow.deal'], prop.edit);
truthy('Builder: 적용 결과', /3년물 단일 또는 3년물 중심/.test(next) && !/A급 주요 기관투자자는 5년물보다/.test(next) && /### DL-03 주력 트랜치/.test(next));
eq('Builder: 다른 항목 그대로', m.parseItems('knowhow.deal', next).length, m.parseItems('knowhow.deal', assets['knowhow.deal']).length);
truthy('Builder: 영향 점검 이벤트', bev.find((e) => e.t === 'impact' && e.id === 'p5' && /RV-01/.test(e.text)));
eq('Builder: 개발 요청·기억', [bev.find((e) => e.t === 'dev')?.item.title, bev.find((e) => e.t === 'memory')?.text], ['민평 4사 연계', '- [선호] 답은 3줄 이내']);
eq('Builder: 편집 역할 도구', seen.find((s) => s.who === 'knowhow').body.tools.map((t) => t.name), ['list_items', 'read_item', 'propose_knowhow']);

// ── 4) 수정안 편집: 추가·삭제·프롬프트 ────────────────────────────────
const t0 = assets['knowhow.deck'];
const add = { kind: 'knowhow', asset: 'knowhow.deck', op: 'add', id: m.nextItemId('knowhow.deck', t0), after: 'DK-03', block: '### DK-09 새 항목\n- 조건: 테스트\n- 선택: ① 기본 (기본)' };
eq('추가: 번호', add.id, 'DK-09');
const t1 = m.applyEdit(t0, add);
eq('추가: DK-03 뒤', m.parseItems('knowhow.deck', t1).map((i) => i.id).slice(2, 5), ['DK-03', 'DK-09', 'DK-04']);
const t2 = m.applyEdit(t1, { ...add, op: 'delete', block: '' });
eq('삭제: 원래대로', t2.trim(), t0.trim());
const p0 = assets['dcm.review'];
const p1 = m.applyEdit(p0, { kind: 'prompt', asset: 'dcm.review', op: 'replace', section: '지켜야 할 것', body: '- 의견은 3개까지.' });
eq('프롬프트: 부분만 바뀜', [m.parseSections(p1).map((s) => s.heading), m.parseSections(p1).at(-1).body], [m.parseSections(p0).map((s) => s.heading), '- 의견은 3개까지.']);

// ── 5) 열린 초안 없이 역할 호출 → 오류 결과(대화는 이어짐) ──────────────
scripts['dcm.master'] = (body, k) => (k === 0 ? msg([tu('call_roles', { roles: ['deal'], task: 'x' })]) : say('먼저 회사를 알려 주세요.'));
r = await runDcm([{ role: 'user', content: '조건 바꿔줘' }], m.emptySession());
truthy('초안 없음: 오류 결과', r.ev.find((e) => e.t === 'tool_done' && !e.ok && /열린 초안이 없어요/.test(e.note)));
eq('초안 없음: 끝', r.done.cont, false);

// ── 6) 여러 턴: 지난 턴 기록(도구 호출 포함)을 그대로 보내도 이어진다 ─────────
const sinceAsk = (body) => {
  let k = 0;
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const x = body.messages[i];
    if (x.role === 'user' && (typeof x.content === 'string' || x.content.every((b) => b.type === 'text'))) break;
    if (x.role === 'assistant') k += 1;
  }
  return k;
};
seen.length = 0;
scripts['dcm.master'] = (body) => (sinceAsk(body) === 0 ? msg([tu('call_roles', { roles: ['deal'], task: '사용자 요청: 3년 단일 1,000억으로 바꿔줘' })]) : say('바꿨어요.'));
scripts.deal = (body, k) => (k === 0 ? msg([tu('decide', { changes: [{ type: 'tranches', tranches: [{ tenor: '3년', eok: 1000 }], reason: '사용자 요청', rules: [] }] })]) : say('바꿨어요.'));
r = await runDcm([...T1, { role: 'user', content: '3년 단일 1,000억으로 바꿔줘' }], S2);
eq('여러 턴: 오류 없음', r.ev.filter((e) => e.t === 'error'), []);
eq('여러 턴: 끝', r.done.cont, false);
eq('여러 턴: 보낸 기록이 API 규칙에 맞음', seen.every((s) => problems(s.body).length === 0), true);
const mb = seen.find((s) => s.who === 'dcm.master').body.messages;
eq('여러 턴: 지난 턴은 말·답만', [mb.length, typeof mb[0].content, typeof mb[1].content], [3, 'string', 'string']);
eq('여러 턴: 바뀜', r.session.state.input.tranches, [{ tenor: '3년', eok: 1000 }]);
// 세 번째 턴: 돌려받은 기록에 다시 이어 붙여도
seen.length = 0;
r = await runDcm([...r.done.messages, { role: 'user', content: '3년 단일 1,000억으로 바꿔줘' }], r.session);
eq('세 번째 턴: 말·답 2쌍 + 새 말', seen.find((s) => s.who === 'dcm.master').body.messages.length, 5);
eq('세 번째 턴: 오류 없음', r.ev.filter((e) => e.t === 'error'), []);
// 이번 턴 기록이 끊겨 답 없는 도구 호출·짝 없는 결과·빈 글이 남아도 거절되지 않는다
seen.length = 0;
const broken = [...T1, { role: 'user', content: 'Sales 다시 써줘' }, { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 'toolu_x', name: 'render', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_y', content: 'x' }] }];
r = await runDcm(broken, S2);
eq('끊긴 기록: 오류 없음', r.ev.filter((e) => e.t === 'error'), []);
eq('끊긴 기록: 규칙에 맞음', seen.every((s) => problems(s.body).length === 0), true);

// 긴 작업이 요청 두 번에 걸쳐 이어질 때: 앞 요청의 thinking 블록(다른 system 에 묶임)이 남아 있어도
seen.length = 0;
scripts['dcm.master'] = (body) => (sinceAsk(body) <= 1 ? msg([tu('render', {})]) : say('만들었어요.'));
const hop = [{ role: 'user', content: 'PPT로 만들어줘' }, { role: 'assistant', content: [{ type: 'thinking', thinking: '...', signature: 'other-conversation' }, { type: 'tool_use', id: 'toolu_h1', name: 'session', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_h1', content: '{}' }] }];
r = await runDcm(hop, S2);
eq('이어지는 요청: 오류 없음', r.ev.filter((e) => e.t === 'error'), []);
truthy('이어지는 요청: 산출까지', r.ev.some((e) => e.t === 'render'));

// ── 7) 한도(429): retry-after 만큼 쉬고 다시, 계속이면 알기 쉬운 안내 ─────────
scripts['dcm.master'] = () => say('네.');
fail429 = 1;
r = await runDcm([{ role: 'user', content: '안녕' }], S2);
eq('429: 쉬고 다시 → 답', r.ev.filter((e) => e.t === 'text').map((e) => e.text), ['네.']);
fail429 = 99;
r = await runDcm([{ role: 'user', content: '안녕' }], S2);
truthy('429: 한도 안내', r.ev.find((e) => e.t === 'error' && /사용량 한도/.test(e.message)));
eq('429: 바로 다시 보내지 않음', r.done.cont, false);
fail429 = 0;

// ── 8) 생각만 하다 잘린 답(max_tokens)·빈 답·사용자가 준 숫자 ─────────────────
seen.length = 0;
let cutOnce = true;
let emptyOnce = true;
const nudgedIn = (body) => body.messages.some((x) => (typeof x.content === 'string' ? /답이 비었어요/.test(x.content) : x.content.some((c) => c.type === 'text' && /답이 비었어요/.test(c.text))));
scripts['dcm.master'] = (body) => (sinceAsk(body) === 0 ? msg([tu('call_roles', { roles: ['deal'], task: '사용자 요청: 둘다 장표에 반영해줘. 안 A 2년 500억+3년 800억(1,300억), 안 B 3년 1,600억' })]) : say('두 안을 트랜치 검토에 넣었어요.'));
scripts.deal = (body, k) => {
  // 첫 호출: 생각만 하다 한도에 걸림 → 한도를 올려 다시 와야 한다
  if (cutOnce && body.max_tokens < 16000) {
    cutOnce = false;
    return msg([], 'max_tokens');
  }
  if (k === 0) return msg([tu('facts', {})]);
  // facts 다음: 글도 도구도 없는 빈 답 → 한 번 재촉받아야 한다
  if (emptyOnce) {
    emptyOnce = false;
    return msg([], 'end_turn');
  }
  if (!nudgedIn(body)) return say('재촉 없음');
  if (!body.messages.at(-1).content.some?.((c) => c.type === 'tool_result' && /저장/.test(c.content ?? ''))) {
    if (!body.messages.some((x) => Array.isArray(x.content) && x.content.some((c) => c.type === 'tool_use' && c.name === 'write'))) return msg([tu('write', { field: 'sizing', lines: ['안 A: 2년 500억원 + 3년 800억원, 총 1,300억원 (현행 구조)', '안 B: 3년 단일 1,600억원 (3년 확대)'] })]);
  }
  return say('두 안을 트랜치 검토 문안에 넣었어요.');
};
r = await runDcm([{ role: 'user', content: '둘다 장표에 반영해줘' }], S2);
const dealCalls = seen.filter((x) => x.who === 'deal');
eq('잘린 답: 한도를 올려 다시', dealCalls.slice(0, 2).map((x) => x.body.max_tokens), [8000, 16000]);
truthy('빈 답: 재촉 뒤 이어감', dealCalls.some((x) => nudgedIn(x.body)));
eq('사용자가 준 숫자: 두 안 문안 반영', r.session.state.edits.sizing, ['안 A: 2년 500억원 + 3년 800억원, 총 1,300억원 (현행 구조)', '안 B: 3년 단일 1,600억원 (3년 확대)']);
eq('역할 보고가 빈 답이 아님', r.ev.filter((e) => e.t === 'role' && e.phase === 'end').map((e) => e.text), ['두 안을 트랜치 검토 문안에 넣었어요.']);

server.close();
console.log(`${pass} passed${process.exitCode ? ', some failed' : ''}`);

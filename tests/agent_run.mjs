// Agent 탭 실행 루프 테스트 (web/lib/agent/run.ts): 가짜 Claude API 로 Master·Sub-agent·엔진 도구가 맞게 도는지.
// DB 는 고정 데이터(이랜드월드)로 바꾼다. 실행: node tests/agent_run.mjs
import { build } from 'esbuild';
import http from 'node:http';
import { readFileSync } from 'node:fs';
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

// ── 가짜 Claude: 대화 형식을 검사하고, 시나리오대로 응답 ─────────────────────
const seen = [];
let script = () => null;
let n = 0;
const tu = (name, input) => ({ type: 'tool_use', id: `toolu_${++n}`, name, input });
const msg = (content, stop = 'tool_use') => ({ id: `msg_${++n}`, type: 'message', role: 'assistant', model: 'mock', content, stop_reason: stop });
function problems(body) {
  const errs = [];
  let cc = 0;
  const count = (x) => {
    if (x && typeof x === 'object') {
      if (x.cache_control) cc++;
      Object.values(x).forEach(count);
    }
  };
  count(body.system);
  count(body.messages);
  if (cc > 4) errs.push(`cache_control ${cc}`);
  if (body.messages[0]?.role !== 'user') errs.push('first not user');
  body.messages.forEach((m, i) => {
    if (i && body.messages[i - 1].role === m.role) errs.push(`same role at ${i}`);
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
      const nx = body.messages[i + 1];
      const got = nx && Array.isArray(nx.content) ? nx.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : [];
      if (ids.length && JSON.stringify(ids) !== JSON.stringify(got)) errs.push(`ids at ${i}`);
    }
    if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result' && !b.content) errs.push('empty tool_result');
  });
  return errs;
}
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b);
    const sub = body.tools.length === 1;
    seen.push({ sub, body, key: req.headers['x-api-key'] });
    const errs = problems(body);
    if (errs.length) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: errs.join('; ') } }));
    }
    const out = script(body, sub);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;

// ── run.ts 묶기: DB·서버 전용 모듈은 고정 데이터로 ────────────────────────────
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
  stdin: { contents: `export * from './lib/agent/run'; export * from './lib/agent/store'; export { DEFAULT_SKILLS, AGENTS } from './lib/agent/config';`, resolveDir: join(root, 'web'), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', plugins: [stub],
  tsconfig: join(root, 'web/tsconfig.json'),
});
const m = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const skills = m.DEFAULT_SKILLS.map((s) => ({ ...s, agents: m.AGENTS.filter((a) => a.skills.includes(s.name)).map((a) => a.key) }));
async function run(messages, state, opts = {}) {
  const ev = [];
  await m.runAgent({ messages, state, skills: opts.skills ?? skills, memory: '- 위승종' }, (e) => ev.push(e), opts.budget, opts.hard);
  return { ev, done: ev.find((e) => e.t === 'done'), state: [...ev].reverse().find((e) => e.t === 'state')?.state ?? state };
}
const lastText = (body) => {
  const ms = body.messages;
  for (let i = ms.length - 1; i >= 0; i--) {
    const c = ms[i].content;
    if (ms[i].role === 'user' && (typeof c === 'string' || c.every((b) => b.type === 'text'))) return [typeof c === 'string' ? c : c.map((b) => b.text).join(''), ms.length - 1 - i];
  }
  return ['', 0];
};
const results = (body) => body.messages.at(-1).content.filter?.((b) => b.type === 'tool_result') ?? [];

// 1) 초안: 스킬 읽기 → 회사 찾기 → 데이터 받기 → 산출
script = (body) => {
  const [, k] = lastText(body);
  const step = k / 2;
  if (step === 0) return msg([tu('read_skill', { skill: 'dcm-deck-engine' })]);
  if (step === 1) return msg([tu('dcm_search', { query: '이랜드월드' })]);
  if (step === 2) return msg([tu('dcm_load', { corp_code: JSON.parse(results(body)[0].content)[0].corp_code, mode: 'resume' })]);
  if (step === 3) return msg([tu('dcm_check', {}), tu('dcm_render', {})]);
  return msg([{ type: 'text', text: '초안을 만들었어요.' }], 'end_turn');
};
let r = await run([{ role: 'user', content: '이랜드월드 제안서 초안' }], null);
eq('초안: 도구 순서', r.ev.filter((e) => e.t === 'tool').map((e) => e.name), ['read_skill', 'dcm_search', 'dcm_load', 'dcm_check', 'dcm_render']);
eq('초안: 모두 성공', r.ev.filter((e) => e.t === 'tool_done').every((e) => e.ok), true);
eq('초안: 상태(회사)', r.state?.corp, '00207108');
eq('초안: 산출 이벤트', r.ev.some((e) => e.t === 'render' && e.slides > 10), true);
eq('초안: 끝(이어갈 것 없음)', r.done.cont, false);
eq('초안: 대화 = 사용자 1 + (assistant+결과) 4 + 마지막 답', r.done.messages.length, 10);
eq('API 키·모델', [seen[0].key, seen[0].body.model], ['test-key', 'claude-opus-5-5']);
eq('Master 시스템에 스킬 표·기억', [/dcm-deck-engine/.test(seen[0].body.system[0].text), /위승종/.test(seen[0].body.system[0].text)], [true, true]);
eq('read_skill 결과 = SKILL.md', results(seen[1].body)[0].content.startsWith('---\nname: dcm-deck-engine'), true);
let state = r.state;
let hist = r.done.messages;

// 2) Sales: Sub-agent 가 쓴 줄 중 단정 표현은 엔진이 뺀다. Sub-agent 는 자기 스킬만 읽는다.
seen.length = 0;
script = (body, sub) => {
  if (sub) {
    const k = body.messages.length;
    if (k === 1) return msg([tu('read_skill', { skill: 'dcm-deck-engine' }), tu('read_skill', { skill: 'dcm-proposal-playbook' })]);
    return msg([{ type: 'text', text: JSON.stringify(['같은 등급 사례를 근거로 밴드를 제시한다.', '금리는 반드시 하락할 것이다.']) }], 'end_turn');
  }
  const [, k] = lastText(body);
  const step = k / 2;
  if (step === 0) return msg([tu('dcm_facts', { sales: true })]);
  if (step === 1) return msg([tu('call_subagent', { agent: 'sales_writer', message: results(body)[0].content })]);
  if (step === 2) return msg([tu('dcm_set_sales', { lines: JSON.parse(results(body)[0].content) })]);
  return msg([{ type: 'text', text: '넣었어요.' }], 'end_turn');
};
r = await run([...hist, { role: 'user', content: 'Sales 전략 문안 써줘' }], state);
const subCalls = seen.filter((s) => s.sub);
eq('Sales: Sub-agent 모델·도구', [subCalls[0].body.model, subCalls[0].body.tools.map((t) => t.name)], ['claude-sonnet-5-5', ['read_skill']]);
const subRes = results(subCalls[1].body);
eq('Sales: Sub-agent 는 엔진 스킬을 못 읽음', [subRes[0].is_error, subRes[1].is_error ?? false], [true, false]);
eq('Sales: 단정 문장 제외', r.state.salesAi, ['같은 등급 사례를 근거로 밴드를 제시한다.']);
eq('Sales: sub 이벤트', r.ev.filter((e) => e.t === 'sub').map((e) => e.phase), ['start', 'end']);
eq('Sales: Sub-agent 도구 id 구분', r.ev.filter((e) => e.t === 'tool' && e.agent === 'sales_writer').every((e) => e.id.startsWith('sales_writer:')), true);
eq('Sales: 지난 턴 긴 도구 결과는 줄여 보냄', seen.filter((s) => !s.sub)[0].body.messages.slice(0, hist.length).some((x) => Array.isArray(x.content) && x.content.some((b) => b.type === 'tool_result' && b.content.includes('지난 결과 줄임'))), true);
state = r.state;
hist = r.done.messages;

// 3) 잘못된 값은 엔진이 거절, 맞는 값만 반영
script = (body) => {
  const [, k] = lastText(body);
  if (k === 0) return msg([tu('dcm_apply', { actions: [{ type: 'tranches', tranches: [{ tenor: '3년', eok: 1500 }] }, { type: 'demand_date', date: '2099-01-01' }] })]);
  return msg([{ type: 'text', text: '바꿨어요.' }], 'end_turn');
};
r = await run([...hist, { role: 'user', content: '3년 1,500억' }], state);
eq('반영: 트랜치', r.state.input.tranches, [{ tenor: '3년', eok: 1500 }]);
const applyRes = JSON.parse(results(seen.at(-1).body)[0].content);
eq('반영: 수요예측일 거절 알림', applyRes.알림.some((s) => s.includes('수요예측')), true);
eq('반영: Sales 문안 유지', r.state.salesAi?.length, 1);
state = r.state;

// 4) 시간 예산을 넘기면 cont=true 로 끊고, 다시 보내면 이어서 끝낸다
script = (body) => {
  const [, k] = lastText(body);
  if (k < 4) return msg([tu('dcm_slides', {})]);
  return msg([{ type: 'text', text: '끝' }], 'end_turn');
};
r = await run([{ role: 'user', content: '장표 목록' }], state, { budget: -1 });
eq('예산: 첫 라운드 전에 끊김', [r.done.cont, r.done.messages.length], [true, 1]);
r = await run([{ role: 'user', content: '장표 목록' }], state, { budget: 5 });
const cont1 = r.done;
r = await run(cont1.messages, state);
eq('예산: 이어서 끝냄', [cont1.cont, r.done.cont, r.done.messages.at(-1).content[0].text], [true, false, '끝']);

// 5) max_tokens 로 잘린 tool_use 는 대화에 남기지 않는다
script = () => msg([{ type: 'text', text: '쓰는 중' }, tu('dcm_apply', { actions: [] })], 'max_tokens');
r = await run([{ role: 'user', content: '길게' }], state);
eq('잘림: 도구 실행 안 함', r.ev.filter((e) => e.t === 'tool').length, 0);
eq('잘림: tool_use 제거', r.done.messages.at(-1).content.map((b) => b.type), ['text']);

// 6) 열린 초안 없이 엔진 도구 → 오류 결과(대화는 이어짐)
script = (body) => {
  const [, k] = lastText(body);
  if (k === 0) return msg([tu('dcm_state', {})]);
  return msg([{ type: 'text', text: '먼저 회사를 여세요' }], 'end_turn');
};
r = await run([{ role: 'user', content: '상태' }], null);
eq('초안 없음: 오류로 돌려줌', [r.ev.find((e) => e.t === 'tool_done').ok, r.done.cont], [false, false]);

// 7) Claude 오류: 오류 이벤트 + 짝 맞는 대화
script = () => ({ bad: true });
server.removeAllListeners('request');
server.on('request', (req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(529, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'overloaded' } }));
  });
});
r = await run([{ role: 'user', content: '안녕' }], null);
eq('API 오류: error + done', [r.ev[0].t, r.ev[0].message.includes('529'), r.done.cont, r.done.messages.length], ['error', true, false, 1]);

// 8) 스킬 저장소: 편집 이력·기본값 판별·검사
const base = m.resolveSkills(null);
eq('스킬: 기본 3개', base.map((s) => [s.name, s.edited]), [['dcm-deck-engine', false], ['dcm-proposal-playbook', false], ['dcm-data-guide', false]]);
const eng = base[0];
const edited = m.commitFiles(eng, { ...eng.files, 'SKILL.md': eng.files['SKILL.md'] + '\n- 메모' }, '저장');
eq('스킬: 고치면 이력 1·고침', [edited.history.length, edited.edited], [1, true]);
eq('스킬: 같은 내용이면 이력 안 늘어남', m.commitFiles(edited, edited.files, '저장').history.length, 1);
const back = m.commitFiles(edited, edited.history[0].files, '되돌리기');
eq('스킬: 기본 판으로 되돌리면 고침 아님', [back.history.length, back.edited], [2, false]);
const stored = m.toStored([back, edited]);
eq('스킬: 안 고친 기본 스킬은 파일 저장 안 함', [stored[0].files, stored[1].files != null], [null, true]);
eq('스킬: 새 스킬 검사 통과', m.skillProblems('my-notes', m.newSkillFiles('my-notes')), []);
eq('스킬: 이름 불일치·머리말 없음', [m.skillProblems('a-b', m.newSkillFiles('x-y')).length, m.skillProblems('a-b', { 'SKILL.md': 'hi' }).length > 0], [1, true]);
eq('스킬: 저장본에 없는 기본 스킬은 뒤에 붙음', m.resolveSkills([{ name: 'mine', origin: 'custom', enabled: true, agents: ['master'], files: { 'SKILL.md': 'x' }, history: [] }]).map((s) => s.name), ['mine', 'dcm-deck-engine', 'dcm-proposal-playbook', 'dcm-data-guide']);

server.close();
console.log(`agent_run: ${pass} passed${process.exitCode ? ', some FAILED' : ''}`);

// dcm — 공모 회사채 제안서 엔진 CLI (Claude Managed Agent 샌드박스에서 실행).
// 웹 프로토타입(ib-deal-agent)의 제안서 로직(web/lib/deck)을 그대로 묶었다. LLM 은 '무엇을 바꿀지'만 정하고,
// 값 검사·반영·장표 생성·검수·PPT/PDF 산출은 이 코드가 한다.
//
// 사용: node dcm.cjs <명령> [인자]   (자세한 설명은 SKILL.md)
//   search <회사명>            회사 찾기 → corp_code
//   fetch <corp_code>          공시·금리·사례 데이터와 암묵지(장표별 노하우) 받기 → 작업 폴더
//   init                       기본 조건으로 초안 만들기(기존 상태 덮어씀)
//   state                      Agent 용 상태 요약(JSON)
//   slides                     장표 목록
//   apply <actions.json|->     행동 목록 반영(값 검사 → 입력 반영 → 다시 계산)
//   facts [--sales]            문안 근거 사실 묶음(JSON). --sales 는 Sales 전략용
//   set-sales <lines.json|->   Sales 전략 문안 넣기(숫자·전망 표현 검사 통과한 줄만)
//   check                      검수: 확인할 곳 목록
//   report                     쓴 데이터 목록(외부·내부)
//   render [--pptx 경로] [--pdf 경로]   산출(기본: /mnt/session/outputs)
//   schema                     행동 형식·장표 id·문안 칸
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  EngineError, applyEngine, checkView, ctxOf, factsView, freshState, loadSummary, marksOf, normalizeState, reportView, schemaView,
  setSales, slideList, stateView, type EngineCtx, type EngineState,
} from '../../web/lib/deck/engine';
import type { Knowledge } from '../../web/lib/deck/knowledge';
import { fileBase, staticSubs } from '../../web/lib/deck/layout';
import { toPptx } from '../../web/lib/deck/render-pptx';
import { toPdf } from '../../web/lib/deck/render-pdf';
import type { DeckData } from '../../web/lib/deck/types';

const BASE = (process.env.DCM_API_BASE || 'https://ib-deal-agent.vercel.app').replace(/\/$/, '');
const ROOT = resolve(process.env.DCM_WORK || join(homedir(), 'dcm-work'));
const ASSETS = resolve(__dirname, '..', 'assets');
const OUT = existsSync('/mnt/session/outputs') ? '/mnt/session/outputs' : resolve('outputs');

// 렌더러는 브라우저용이라 '/deck/...' 를 fetch 로 읽는다 → 스킬 폴더의 assets 에서 읽게 바꾼다
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/deck/')) {
    const file = join(ASSETS, url.slice('/deck/'.length));
    return new Response(readFileSync(file));
  }
  return realFetch(input, init);
}) as typeof fetch;

const out = (x: unknown) => process.stdout.write(`${typeof x === 'string' ? x : JSON.stringify(x, null, 2)}\n`);
const fail = (msg: string): never => {
  process.stderr.write(`오류: ${msg}\n`);
  process.exit(1);
};
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1));
};
const readArg = (p: string | undefined): string => {
  if (!p) fail('입력 파일 경로(또는 - 로 표준입력)를 주세요.');
  return p === '-' ? readFileSync(0, 'utf8') : readFileSync(p as string, 'utf8');
};
const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function corpOf(args: string[]) {
  const c = flag(args, '--corp') ?? (existsSync(join(ROOT, 'current')) ? readFileSync(join(ROOT, 'current'), 'utf8').trim() : '');
  if (!c) fail('회사가 정해지지 않았어요. 먼저 fetch <corp_code> 를 실행하세요.');
  return c;
}
const dirOf = (corp: string) => join(ROOT, corp);

async function getJson(path: string) {
  const r = await realFetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(`${path} → ${r.status} ${(j as { error?: string }).error ?? ''}`);
  return j;
}

// 작업 맥락: 데이터 + 암묵지 + 상태 (엔진 코어 web/lib/deck/engine.ts)
function load(args: string[]) {
  const corp = corpOf(args);
  const dir = dirOf(corp);
  if (!existsSync(join(dir, 'data.json'))) fail(`${corp} 데이터가 없어요. fetch ${corp} 를 먼저 실행하세요.`);
  const data = readJson<DeckData>(join(dir, 'data.json'));
  const known = existsSync(join(dir, 'knowledge.json')) ? readJson<Knowledge[]>(join(dir, 'knowledge.json')) : [];
  const saved = existsSync(join(dir, 'state.json')) ? readJson<EngineState>(join(dir, 'state.json')) : null;
  return { dir, ctx: ctxOf(data, known, normalizeState(data, saved)) };
}
const save = (dir: string, st: EngineState) => writeJson(join(dir, 'state.json'), { ...st, updated: new Date().toISOString() });
const inputArg = (args: string[]) => JSON.parse(readArg(args.find((a) => !a.startsWith('--') && a !== flag(args, '--corp'))));

const cmds: Record<string, (args: string[]) => Promise<void> | void> = {
  async search(args) {
    const q = args.join(' ').trim();
    if (!q) fail('회사 이름을 주세요.');
    const hits = (await getJson(`/api/companies?q=${encodeURIComponent(q)}`)) as { corp_code: string; corp_name: string; market: string | null; deal_count: number; last_deal_dt: string | null }[];
    out(hits.slice(0, 10).map((h) => ({ corp_code: h.corp_code, 회사: h.corp_name, 시장: h.market && h.market !== '기타' ? h.market : '비상장', 발행건수: h.deal_count, 최근발행: h.last_deal_dt })));
  },

  async fetch(args) {
    const corp = (args[0] ?? '').trim();
    if (!/^\d{8}$/.test(corp)) fail('corp_code(숫자 8자리)를 주세요. 모르면 search <회사명>.');
    const dir = dirOf(corp);
    const data = (await getJson(`/api/deck/data?corp=${corp}`)) as DeckData;
    writeJson(join(dir, 'data.json'), data);
    const k = (await getJson('/api/deck/knowledge').catch(() => ({ items: [] }))) as { items?: Knowledge[] };
    writeJson(join(dir, 'knowledge.json'), k.items ?? []);
    mkdirSync(ROOT, { recursive: true });
    writeFileSync(join(ROOT, 'current'), corp);
    out({
      저장: dir, 기준일: data.asof, 회사: data.company.corp_name, 등급: data.company.rating, 공모채발행횟수: data.company.bond_count,
      직전회차: data.company.last_series, 같은등급사례: data.peers.length, 만기도래: data.maturities.length, 암묵지: (k.items ?? []).length,
      다음: existsSync(join(dir, 'state.json')) ? '기존 초안이 있어요. 이어서 하려면 state, 새로 만들려면 init' : 'init',
    });
  },

  init(args) {
    const { dir, ctx } = load(args);
    const st = freshState(ctx.data);
    save(dir, st);
    const n = ctxOf(ctx.data, ctx.knowledge, st);
    out({ 초안: fileBase(n.st.input), 장표수: n.slides.length, 장표: n.slides.map((s, i) => `${i + 1}. ${s.title}`), 확인할곳: marksOf(n).length });
  },

  state(args) {
    out(stateView(load(args).ctx));
  },

  slides(args) {
    out(slideList(load(args).ctx));
  },

  apply(args) {
    const { dir, ctx } = load(args);
    const r = applyEngine(ctx, inputArg(args));
    save(dir, r.state);
    out(r.out);
  },

  facts(args) {
    out(factsView(load(args).ctx, args.includes('--sales')));
  },

  'set-sales'(args) {
    const { dir, ctx } = load(args);
    const r = setSales(ctx, inputArg(args));
    save(dir, r.state);
    out(r.out);
  },

  check(args) {
    out(checkView(load(args).ctx));
  },

  report(args) {
    out(reportView(load(args).ctx));
  },

  async render(args) {
    const c: EngineCtx = load(args).ctx;
    const name = fileBase(c.st.input);
    const wantPdf = args.includes('--pdf') || !args.includes('--pptx');
    const wantPptx = args.includes('--pptx') || !args.includes('--pdf');
    const files: string[] = [];
    if (wantPptx) {
      const p = flag(args, '--pptx') && !flag(args, '--pptx')!.startsWith('--') ? flag(args, '--pptx')! : join(OUT, `${name}.pptx`);
      const blob = await toPptx(c.slides, name, staticSubs(c.data, c.st.input));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, Buffer.from(await blob.arrayBuffer()));
      files.push(p);
    }
    if (wantPdf) {
      const p = flag(args, '--pdf') && !flag(args, '--pdf')!.startsWith('--') ? flag(args, '--pdf')! : join(OUT, `${name}.pdf`);
      const blob = await toPdf(c.slides, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, Buffer.from(await blob.arrayBuffer()));
      files.push(p);
    }
    out({ 파일: files, 장표수: c.slides.length, 확인할곳: marksOf(c).length });
  },

  schema() {
    out(schemaView());
  },
};

const [cmd, ...args] = process.argv.slice(2);
const run = cmds[cmd ?? ''];
if (!run) {
  out(`사용: node dcm.cjs <${Object.keys(cmds).join('|')}> [인자]`);
  process.exit(cmd ? 1 : 0);
} else {
  Promise.resolve().then(() => run(args)).catch((e: Error) => fail(e instanceof EngineError ? e.message : (e.stack ?? e.message)));
}

// 드라이브 테스트: PPTX 글 · 차트 · 그림 뽑기, DM(PPTX) → DM 판, 판을 쓴 장표(회의 그림 · 이슈 그림), 레퍼런스 카드(모델 없을 때).
// 현업 DM 파일은 저장소에 넣지 않는다. 같은 양식의 가짜 DM 을 pptxgenjs 로 만들어 쓴다. 실행: npm run test:drive
import { build } from 'esbuild';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'web/package.json'));
const PptxGen = require('pptxgenjs');

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` → ${detail}`}`);
};

// ── 가짜 DM: 표지(날짜) · 목차 · 금리 동향(차트 2, 순서 뒤집힘, 스프레드는 % 값) · 금통위(그림 3) · FOMC · 금리 전망표 · 회사채 금리 · 주요 이슈(그림 2) ──
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAX0CzYwAAAAASUVORK5CYII=';
const months = [];
for (let y = 2023; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) if (y < 2026 || mo <= 9) months.push(`${y}-${String(mo).padStart(2, '0')}`);
const wave = (base, amp, k) => months.map((_, i) => +(base + amp * Math.sin(i / k)).toFixed(3));
async function fakeDm() {
  const p = new PptxGen();
  p.layout = 'LAYOUT_WIDE';
  let s = p.addSlide();
  s.addText('A급 회사채 시장동향', { x: 1, y: 2, w: 8, h: 1 });
  s.addText('2026. 10. 15', { x: 1, y: 3, w: 4, h: 0.5 });
  s = p.addSlide();
  s.addText('Contents', { x: 1, y: 0.5, w: 4, h: 0.5 });
  s.addText('금리 동향', { x: 1, y: 1.5, w: 4, h: 0.5 });
  s.addText('금리 전망', { x: 1, y: 2, w: 4, h: 0.5 });
  // 금리 동향: 파일 안 차트 순서가 스프레드 먼저
  s = p.addSlide();
  s.addText('1. 금리 동향_① 금리 동향', { x: 0.3, y: 0.2, w: 8, h: 0.4 });
  s.addText('[국고금리]', { x: 0.3, y: 0.8, w: 3, h: 0.3 });
  s.addText('국고채 금리는 재정 확대 우려로 상승 압력을 받는 중이며, 기준금리와의 격차가 넓어진 상태임', { x: 0.3, y: 1.1, w: 12, h: 0.3 });
  s.addText('[크레딧 스프레드]', { x: 0.3, y: 1.5, w: 3, h: 0.3 });
  s.addText('회사채 스프레드는 연초 이후 축소 흐름을 이어가며 우호적 수급 여건이 지속되는 모습', { x: 0.3, y: 1.8, w: 12, h: 0.3 });
  s.addText('국고채 대비 A+급 Credit Spread 추이', { x: 6.8, y: 2.4, w: 5, h: 0.3 });
  s.addText('국고채 및 韓/美 기준금리 추이', { x: 0.3, y: 2.4, w: 5, h: 0.3 });
  s.addText('(단위 : %)', { x: 4.5, y: 2.4, w: 1.5, h: 0.3 });
  s.addText('자료 : Bondweb(2026.10.14)', { x: 0.3, y: 7, w: 4, h: 0.3 });
  s.addChart(p.ChartType.line, [
    { name: '3Y Credit Spread(좌)', labels: months, values: wave(0.9, 0.2, 7) },
    { name: 'A+ 3Y(우)', labels: months, values: wave(3.4, 0.4, 9) },
  ], { x: 6.8, y: 2.8, w: 6, h: 4, chartColors: ['1F3864', 'FF0000'] });
  s.addChart(p.ChartType.line, [
    { name: '국고 3Y(좌)', labels: months, values: wave(3.0, 0.5, 8) },
    { name: '韓 기준금리(우)', labels: months, values: months.map((_, i) => (i < 20 ? 3.5 : 2.5)) },
  ], { x: 0.3, y: 2.8, w: 6, h: 4, chartColors: ['8EA9DB', 'FF0000'] });
  // 금통위: 제목 칸 = 결정 요약, 핵심 포인트, 그림 3
  s = p.addSlide();
  s.addText('10월 2일 금통위는 기준금리를 2.50%로 동결하며 인상 가능성을 열어 둠', { x: 0.3, y: 0.2, w: 12, h: 0.4 });
  s.addText('물가 상방 위험과 가계대출 증가세를 주시하며 추가 조정 시기를 점검하겠다고 언급', { x: 0.3, y: 0.7, w: 12, h: 0.3 });
  s.addText('10월 금통위 핵심 포인트', { x: 0.3, y: 1.2, w: 6, h: 0.3 });
  s.addText('통화정책 결정: 기준금리 동결(2.50%)', { x: 0.3, y: 1.6, w: 6, h: 0.3 });
  s.addText('만장일치 동결 결정이며 향후 인상 가능성을 시사한 위원은 2명으로 늘어났다.', { x: 0.3, y: 1.9, w: 12, h: 0.3 });
  s.addText('■ 한국은행 성장률 전망치', { x: 0.3, y: 4, w: 4, h: 0.3 });
  s.addText('■ 소비자물가 추이', { x: 4.5, y: 4, w: 4, h: 0.3 });
  s.addText('■ 가계대출 증감', { x: 8.7, y: 4, w: 4, h: 0.3 });
  s.addText('자료: 한국은행', { x: 0.3, y: 7, w: 4, h: 0.3 });
  for (const x of [0.3, 4.5, 8.7]) s.addImage({ data: `image/png;base64,${PNG}`, x, y: 4.4, w: 4, h: 2 });
  // FOMC: 표가 있는 일정표 장과 헷갈리지 않게(표 없음)
  s = p.addSlide();
  s.addText('9월 FOMC 결과, 기준금리 동결(3.75%)', { x: 0.3, y: 0.2, w: 12, h: 0.4 });
  s.addText('점도표 중간값은 연내 동결로 유지', { x: 0.3, y: 0.7, w: 12, h: 0.3 });
  s.addText('9월 FOMC 핵심 포인트', { x: 0.3, y: 1.2, w: 6, h: 0.3 });
  s.addText('물가 경로 점검이 이어지는 가운데 위원 간 이견이 커졌다.', { x: 0.3, y: 1.6, w: 12, h: 0.3 });
  // 금리 전망표
  s = p.addSlide();
  s.addText('2. 금리 전망_① 기준금리 및 국고채 금리', { x: 0.3, y: 0.2, w: 8, h: 0.4 });
  s.addText('■ 한국 및 미국 기준금리 전망', { x: 0.3, y: 0.7, w: 8, h: 0.3 });
  s.addText('[한국] 성장률 상향과 물가 압력으로 연내 한 차례 인상 가능성이 높다고 판단함.', { x: 0.3, y: 1.0, w: 12, h: 0.3 });
  s.addText('기준금리 및 한미 국고채 금리전망', { x: 0.3, y: 2.5, w: 6, h: 0.3 });
  s.addText('(단위: %)', { x: 10, y: 2.5, w: 2, h: 0.3 });
  s.addText('자료 : NH투자증권 리서치본부', { x: 0.3, y: 7, w: 4, h: 0.3 });
  const H = ['구분', '만기', '2026년', '', '', '', '2027년', '', '', '', '2028년'];
  const Q = ['', '', '1Q', '2Q', '3Q', '4Q', '1Q', '2Q', '3Q', '4Q', ''];
  s.addTable([H, Q, ['한국 기준금리', '', '2.50', '2.50', '2.75', '3.00', '3.00', '3.00', '3.00', '3.00', '3.00'], ['한국 국고채', '3년', '3.10', '3.20', '3.30', '3.40', '3.40', '3.40', '3.40', '3.40', '3.30'], ['', '10년', '3.40', '3.50', '3.60', '3.60', '3.60', '3.60', '3.60', '3.60', '3.50']].map((r) => r.map((t) => ({ text: t }))), { x: 0.3, y: 2.9, w: 12, fontSize: 8 });
  // 회사채 금리 전망
  s = p.addSlide();
  s.addText('2. 금리 전망_② 회사채 금리', { x: 0.3, y: 0.2, w: 8, h: 0.4 });
  s.addText('■ 2026년 AA등급 이상 회사채 시장 전망', { x: 0.3, y: 0.7, w: 8, h: 0.3 });
  s.addText('높은 금리 수준에 기반한 캐리 수요가 이어질 것으로 판단되며 급격한 금리 상승 가능성은 제한적임.', { x: 0.3, y: 1.0, w: 12, h: 0.3 });
  s.addText('■ 2026년 A등급 이하 회사채 시장 전망', { x: 0.3, y: 1.5, w: 8, h: 0.3 });
  s.addText('신규 투자 수요가 신용 스프레드를 지지하나 업종 간 양극화 가능성이 있어 선별적 접근이 필요함.', { x: 0.3, y: 1.8, w: 12, h: 0.3 });
  s.addText('회사채 금리 전망', { x: 0.3, y: 2.5, w: 4, h: 0.3 });
  // 주요 이슈: 장표 번호 줄 없이, 앞의 짧은 줄 둘은 그림 제목
  s = p.addSlide();
  s.addText('서울 아파트 가격 추이', { x: 0.3, y: 4, w: 6, h: 0.3 });
  s.addText('원/달러 환율 추이', { x: 6.8, y: 4, w: 6, h: 0.3 });
  s.addText('주요 이슈 현황', { x: 0.3, y: 0.2, w: 6, h: 0.3 });
  s.addText('[부동산]', { x: 0.3, y: 0.7, w: 3, h: 0.3 });
  s.addText('수도권 주택가격 상승세가 이어지며 금융안정 우려가 커지고 있음', { x: 0.3, y: 1.0, w: 12, h: 0.3 });
  s.addText('[환율]', { x: 0.3, y: 1.5, w: 3, h: 0.3 });
  s.addText('원화 약세가 이어지면 외국인 수요가 둔화될 가능성이 있음', { x: 0.3, y: 1.8, w: 12, h: 0.3 });
  for (const x of [0.3, 6.8]) s.addImage({ data: `image/png;base64,${PNG}`, x, y: 4.4, w: 6, h: 2.5 });
  return new Uint8Array(await p.write({ outputType: 'nodebuffer' }));
}

// ── 가짜 Claude(모델 경로): 줄 번호만 고르게 하고, 다른 칸 줄 · 없는 번호가 걸러지는지 ──
let modelPick = null;
const seen = [];
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b);
    seen.push(body);
    const tool = body.tools[0].name;
    const c = body.messages[0].content;
    const text = typeof c === 'string' ? c : c.map((x) => x.text ?? '').join('');
    body.ask = text;
    const input = tool === 'save' ? modelPick(text) : { corp: '가나다', industry: '식품 유통', rating: 'A+', summary: '차환 제안', slides: ['딜 개요', 'Sales 전략'], strengths: ['투자자군별 접근'], tags: ['차환'] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'mock', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: tool, input }] }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'export {}' }));
  },
};
async function load(withKey) {
  const out = await build({
    stdin: { contents: `export * from './lib/drive/extract'; export * from './lib/drive/dm'; export { makeCard } from './lib/drive/ref'; export { buildSlides } from './lib/deck/layout'; export { ruleText, defaultInput } from './lib/deck/rules';`, resolveDir: join(root, 'web'), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', external: ['unpdf'], plugins: [stub], tsconfig: join(root, 'web/tsconfig.json'),
    define: withKey ? { 'process.env.ANTHROPIC_API_KEY': '"test"', 'process.env.ANTHROPIC_BASE_URL': `"http://127.0.0.1:${server.address().port}"` } : { 'process.env.ANTHROPIC_API_KEY': '""' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

const buf = await fakeDm();
const m = await load(false);

// 1. 뽑기
const x = m.extractPptx(buf, { images: true });
check('뽑기: 슬라이드 수 · 순서', x.slides.length === 8 && /A급 회사채/.test(x.slides[0].title), x.slides.map((s) => s.title).join(' | '));
const rs = x.slides[2];
check('뽑기: 차트 2개 · 계열 이름 · 색', rs.charts.length === 2 && rs.charts[0].series[0].name === '3Y Credit Spread(좌)' && rs.charts[1].series[0].color === '8EA9DB', JSON.stringify(rs.charts.map((c) => c.series.map((s) => [s.name, s.color]))));
check('뽑기: 차트 항목 · 값(캐시)', rs.charts[1].cats.length === months.length && rs.charts[1].cats[0] === '2023-01' && rs.charts[1].series[1].values[25] === 2.5);
check('뽑기: 그림 데이터(data URL) · 크기', x.slides[3].images.length === 3 && x.slides[3].images.every((i) => i.data?.startsWith('data:image/png;base64,') && i.w > 3.9));
check('뽑기: 표', x.slides[5].tables[0]?.[1]?.[2] === '1Q' && x.slides[5].tables[0].length === 5);
check('뽑기: 글(에이전트 참고용)', /## 3\. 1\. 금리 동향_① 금리 동향/.test(x.content) && /\[차트\]/.test(x.content), x.content.slice(0, 200));

// 2. 장표 종류
const cls = m.classify(x.slides).map((c) => `${c.s.n}:${c.slot}`).join(' ');
check('종류: 금리 동향 · 금통위 · FOMC · 전망 · 회사채 · 이슈(목차는 아님)', cls === '3:rates 4:bok 5:fomc 6:forecast 7:credit_fc 8:issues', cls);

// 3. 판(규칙)
const r = await m.dmFromSlides(x.slides, { fileName: 'DM_1015.pptx', author: '김하늘', today: '2026-11-03' });
const e = r.edition;
check('판: 표지 날짜 · 제목 · 등급 · 규칙', e.edition === '2026-10-15' && e.title === 'A급 회사채 시장동향' && e.grade === 'A+' && r.by === 'rule', `${e.edition} ${e.title} ${e.grade} ${r.by}`);
check('판: 금리 동향 글상자(소제목 · 본문만)', JSON.stringify(e.pages.rates) === JSON.stringify(['[국고금리]', '국고채 금리는 재정 확대 우려로 상승 압력을 받는 중이며, 기준금리와의 격차가 넓어진 상태임', '[크레딧 스프레드]', '회사채 스프레드는 연초 이후 축소 흐름을 이어가며 우호적 수급 여건이 지속되는 모습']), JSON.stringify(e.pages.rates));
const [c0, c1] = e.charts.rates;
check('판: 차트는 내용으로 맞춤(왼쪽 금리, 오른쪽 스프레드)', c0.title === '국고채 및 韓/美 기준금리 추이' && c1.title === '국고채 대비 A+급 Credit Spread 추이', `${c0.title} / ${c1.title}`);
check('판: 스프레드 차트는 스프레드 계열만 · bp', c1.series.map((s) => s.name).join() === '3Y Credit Spread' && c1.unit === '(단위: bp)' && Math.max(...c1.series[0].values) > 50, JSON.stringify([c1.series.map((s) => s.name), c1.unit, c1.max]));
check('판: (좌)/(우) 떼고 DM 색 그대로 · 날짜 항목', c0.series.map((s) => `${s.name}:${s.color}`).join() === '국고 3Y:8EA9DB,韓 기준금리:FF0000' && c0.dates && c0.min <= 2.5 && c0.max >= 3.5, JSON.stringify([c0.series.map((s) => s.name), c0.min, c0.max, c0.step]));
const bok = e.meetings.bok;
check('판: 금통위 날짜(글의 M월 D일) · 제목 · 포인트(✓ 소제목)', bok.meeting_dt === '2026-10-02' && bok.title === '10월 금통위 핵심 포인트' && bok.points[0] === '✓ 통화정책 결정: 기준금리 동결(2.50%)', JSON.stringify([bok.meeting_dt, bok.title, bok.points]));
check('판: 금통위 그림 3개(■ 제목 · 비율)', bok.images.length === 3 && bok.images.map((i) => i.title).join() === '한국은행 성장률 전망치,소비자물가 추이,가계대출 증감' && bok.images[0].ar === 2, JSON.stringify(bok.images.map((i) => [i.title, i.ar])));
check('판: FOMC 날짜(일이 없으면 그 달 말일)', e.meetings.fomc?.meeting_dt === '2026-09-30', e.meetings.fomc?.meeting_dt);
const ft = e.forecastTable;
check('판: 전망표(분기 4개가 다 있는 해만)', ft && ft.years.join() === '2026년,2027년' && ft.periods.length === 8 && ft.rows.length === 3 && ft.rows[2].group === '한국 국고채' && ft.rows[0].tenor === null && ft.title === '기준금리 및 한미 국고채 금리전망', JSON.stringify(ft));
check('판: 회사채 금리(우량 · 비우량, 표 제목 줄 빼고)', e.pages.credit_fc?.high.lines.length === 1 && e.pages.credit_fc.low.lines.length === 1 && e.pages.credit_fc.high.title === 'AA등급 이상 회사채 시장 전망', JSON.stringify(e.pages.credit_fc));
const ip = e.issuePages?.[0];
check('판: 주요 이슈(그림 제목 줄은 빼고 그림 2개)', ip && ip.lines[0] === '[부동산]' && ip.lines.length === 4 && ip.images?.length === 2 && ip.images[0].title === '서울 아파트 가격 추이', JSON.stringify(ip && [ip.lines, ip.images?.map((i) => i.title)]));
check('판: 채운 칸', r.filled.join() === 'rates,forecast,bok,fomc,credit_fc,issues', r.filled.join());
let threw = '';
try {
  await m.dmFromSlides(x.slides.slice(0, 2), { fileName: 'x.pptx', author: '', today: '2026-11-03' });
} catch (err) {
  threw = err.message;
}
check('판: DM 장표가 없으면 알기 쉬운 오류', /DM 장표/.test(threw), threw);

// 4. 판을 쓴 장표: DM 회의가 DB 회의보다 최근이면 DM 장표(그림), 아니면 DB 회의 장표 + DB 문구
{
  const d = JSON.parse(readFileSync(join(root, 'tests/fixtures/deck_eland.json'), 'utf8'));
  const { issues: _i, market: _mk, note: _n, ...view } = e;
  const newer = { ...view, meetings: { ...view.meetings, bok: { ...view.meetings.bok, meeting_dt: '2026-12-01' } } };
  const dd = { ...d, dm: newer };
  const inp = m.defaultInput(dd);
  const slides = m.buildSlides(dd, { ...inp, items: { ...inp.items, issues: true } }, m.ruleText(dd, inp));
  const bokS = slides.find((s) => s.id === 'bok');
  const imgs = bokS.prims.filter((p) => p.k === 'img');
  check('장표: DM 회의 장표에 그림 3개(비율 유지)', imgs.length === 3 && imgs.every((p) => p.src.startsWith('data:image/png') && Math.abs(p.w / p.h - 2) < 0.01), JSON.stringify(imgs.map((p) => [p.w, p.h])));
  const iss = slides.find((s) => s.id === 'issues-0');
  check('장표: 주요 이슈 그림 2개', iss && iss.prims.filter((p) => p.k === 'img').length === 2, iss ? iss.prims.filter((p) => p.k === 'img').length : 'no issues slide');
  const older = { ...view, meetings: { ...view.meetings, bok: { ...view.meetings.bok, meeting_dt: '2020-01-01' } } };
  const do2 = { ...d, dm: older };
  const tx2 = m.ruleText(do2, m.defaultInput(do2));
  const b2 = m.buildSlides(do2, m.defaultInput(do2), tx2).find((s) => s.id === 'bok');
  check('장표: DB 회의가 더 최근이면 DB 장표 · DM 문구 안 씀', b2 && !b2.prims.some((p) => p.k === 'img') && !tx2.bok.some((l) => /10월 2일 금통위/.test(l)), JSON.stringify(tx2.bok).slice(0, 200));
  check('장표: 금리 동향은 DM 차트(값 그대로)', slides.find((s) => s.id === 'rates').prims.filter((p) => p.k === 'chart').length === 2);
}

// 5. 모델 경로: 줄 번호만 받고, 다른 칸 · 없는 번호는 버린다
{
  const mm = await load(true);
  modelPick = (ask) => {
    const n = (re) => Number(ask.match(new RegExp(`(\\d+)\\. ${re}`))[1]);
    return {
      rates: [n('\\[국고금리\\]'), n('국고채 금리는'), n('\\[부동산\\]'), 9999],
      bok: { callout: [n('10월 2일 금통위는')], title: n('10월 금통위 핵심 포인트'), meeting_dt: '2026-10-02', points: [{ n: n('통화정책 결정'), head: true }, { n: n('만장일치'), head: false }], images: [n('■ 한국은행'), n('■ 소비자물가'), n('■ 가계대출')] },
      credit_fc: { high: { title: n('■ 2026년 AA등급'), lines: [n('높은 금리')] }, low: { title: n('■ 2026년 A등급'), lines: [n('신규 투자')] } },
      grade: 'A+',
    };
  };
  const r2 = await mm.dmFromSlides(mm.extractPptx(buf, { images: true }).slides, { fileName: 'DM_1015.pptx', author: '', today: '2026-11-03' });
  check('모델: 판을 모델로 만듦', r2.by === 'model');
  check('모델: 다른 칸 줄 · 없는 번호는 빠짐', JSON.stringify(r2.edition.pages.rates) === JSON.stringify(['[국고금리]', '국고채 금리는 재정 확대 우려로 상승 압력을 받는 중이며, 기준금리와의 격차가 넓어진 상태임']), JSON.stringify(r2.edition.pages.rates));
  check('모델: 회의 · 포인트 · 그림', r2.edition.meetings.bok.points.join('|') === '✓ 통화정책 결정: 기준금리 동결(2.50%)|만장일치 동결 결정이며 향후 인상 가능성을 시사한 위원은 2명으로 늘어났다.' && r2.edition.meetings.bok.images.length === 3);
  check('모델: 차트 · 전망표는 코드로(모델 답과 무관)', r2.edition.charts.rates.length === 2 && r2.edition.forecastTable?.rows.length === 3);
  check('모델: 프롬프트에 줄 번호 · 칸 이름', /### 슬라이드 3 · 금리 동향/.test(seen[0].ask) && /\d+\. \[국고금리\]/.test(seen[0].ask));
  // 레퍼런스 카드
  const card = await mm.makeCard('가나다 제안 vF.pptx', '## 1. 딜 개요', null);
  check('카드: 모델 카드(꼬리표 · 장표 구성)', card.by === 'model' && card.card.tags.join() === '차환' && card.card.slides.length === 2);
  const rc = await m.makeCard('[NHIS] 가나다 공모사채 제안_260306(수정).pptx', '', mm.extractPptx(buf, {}).slides);
  check('카드: 모델 없으면 파일 이름 · 장표 제목', rc.by === 'rule' && /가나다 공모사채 제안/.test(rc.card.corp) && rc.card.slides.includes('1. 금리 동향_① 금리 동향'), JSON.stringify(rc.card).slice(0, 200));
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

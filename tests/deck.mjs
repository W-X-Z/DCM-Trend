// 제안서 덱 로직 테스트: 일정 역산, AI 문안 검증, 장표 레이아웃(실제 데이터 스냅샷)
// 실행: npm run test:deck  (web/lib/deck 의 TypeScript 를 esbuild 로 묶어 불러온다)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = `
export * from './web/lib/deck/schedule';
export * from './web/lib/deck/validate';
export * from './web/lib/deck/rules';
export * from './web/lib/deck/model';
export { buildSlides, fileBase } from './web/lib/deck/layout';
export { PAGE } from './web/lib/deck/theme';
`;
const out = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const m = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` → ${detail}`}`);
};

// 1. 발행 일정: 이랜드월드 108 제안서(2026-02) 일정표와 같아야 한다 (4/15 납입)
{
  const cal = new m.BizCal([{ dt: '2026-05-01', name: '근로자의 날' }]);
  const s = m.buildSchedule(cal, '2026-04-15', { band: 'later', events: [{ event_dt: '2026-04-10', end_dt: null, kind: '금통위', title: '통화정책방향 결정회의', note: null }] });
  check('일정: 대표주관계약 3/20', s.leadContract === '2026-03-20', s.leadContract);
  check('일정: 협회 신고 3/27', s.kofia === '2026-03-27', s.kofia);
  check('일정: 증권신고서 4/3', s.filing === '2026-04-03', s.filing);
  check('일정: 수요예측 가능일 4/6~4/8, 권장 4/7', s.demandOptions.join() === '2026-04-06,2026-04-07,2026-04-08' && s.demand === '2026-04-07', s.demandOptions.join());
  check('일정: 조건확정 4/9, 금리확정 4/14, 상장 4/16', s.condFix === '2026-04-09' && s.rateFix === '2026-04-14' && s.listing === '2026-04-16', `${s.condFix} ${s.rateFix} ${s.listing}`);
  check('일정: 달력 5주(3/16 주 ~ 4/13 주)', s.weeks.length === 5 && s.weeks[0][0] === '2026-03-16', `${s.weeks.length} ${s.weeks[0][0]}`);
  check('일정: 금통위 표시', s.steps.some((x) => x.dt === '2026-04-10' && x.kind === 'event'));
  const f = m.buildSchedule(cal, '2026-04-15', { band: 'fixed' });
  check('일정: 고정금리 밴드는 금리확정 정정 없음', f.rateFix === null);
}
{
  const cal = new m.BizCal([{ dt: '2026-10-05', name: '대체공휴일(개천절)' }, { dt: '2026-10-09', name: '한글날' }]);
  const s = m.buildSchedule(cal, '2026-10-09', { band: 'later' });
  check('일정: 휴일 납입일은 다음 영업일로', s.pay === '2026-10-12' && s.warnings.length === 1, `${s.pay} ${s.warnings}`);
  check('일정: 영업일 역산에 휴일 반영 (10/12 기준 8영업일 전 = 9/28)', s.filing === '2026-09-28', s.filing);
}

// 2. AI 문안 검증
{
  const facts = { 경쟁률: '1.43:1', 금액: '430억원', 일정: '4/15(수)' };
  const allowed = m.allowedNumbers(facts);
  check('검증: 사실에 있는 숫자 통과', m.lineOk('경쟁률 **1.43:1**로 430억원 수요 확보', allowed, false).ok);
  check('검증: 없는 숫자 거부', !m.lineOk('경쟁률 2.5:1 예상', allowed, false).ok);
  check('검증: 전망 표현 거부', !m.lineOk('수요가 충분할 것으로 예상됨', allowed, false).ok);
  check('검증: 하우스를 밝힌 전망은 금리 장표에서 허용', m.lineOk('NH투자증권 리서치는 기준금리 인상 지속을 전망', allowed, true).ok);
  check('검증: 하우스 없는 전망은 금리 장표에서도 거부', !m.lineOk('기준금리는 인상될 것', allowed, true).ok);
  const rule = { lead: 'r', peers: ['r1'], compare: ['r'], schedule: ['r'], structure: ['r'], structureRows: [{ label: '1년', desc: 'r' }], strengths: [{ title: 'a', text: 'b' }, { title: 'c', text: 'd' }, { title: 'e', text: 'f' }], rates: ['r'], corp: ['r'], views: ['r'] };
  const r = m.mergeValidated({ ...rule, peers: ['경쟁률 9.99:1'], lead: '430억원 제안' }, rule, allowed);
  check('검증: 실패한 필드는 규칙 문안으로', r.text.peers[0] === 'r1' && r.text.lead === '430억원 제안' && r.dropped.length === 1, JSON.stringify(r.dropped));
}

// 3. 장표: 실제 데이터 스냅샷(이랜드월드, 2026-10-23)으로 14장, 페이지 안, 숫자 출처
{
  const d = JSON.parse(readFileSync(join(root, 'tests/fixtures/deck_eland.json'), 'utf8'));
  const inp = m.defaultInput(d);
  const tx = m.ruleText(d, inp);
  const slides = m.buildSlides(d, inp, tx);
  check('장표: 기본 14장', slides.length === 14, slides.map((s) => s.id).join(','));
  check('장표: 표지 제목에 다음 회차', slides[0].prims.some((p) => p.k === 'text' && p.paras.some((x) => x.runs.some((r) => /제112회 공모회사채 대표주관 제안서/.test(r.t)))));
  let out = [];
  for (const s of slides) {
    for (const p of s.prims) {
      const box = p.k === 'line' ? { x: Math.min(p.x1, p.x2), y: Math.min(p.y1, p.y2), w: Math.abs(p.x2 - p.x1), h: Math.abs(p.y2 - p.y1) }
        : p.k === 'table' ? (() => { const c = m.cellBoxes(p); return { x: p.x, y: p.y, w: c.w, h: c.h }; })() : p;
      if (box.x < -0.5 || box.y < -0.5 || box.x + box.w > m.PAGE.w + 0.5 || box.y + box.h > m.PAGE.h + 0.5) out.push(`${s.id}:${p.k}`);
    }
  }
  check('장표: 모든 요소가 페이지 안', !out.length, out.join(' '));
  // 글상자 넘침: 요약 상자 글 높이 <= 상자 높이
  const over = [];
  for (const s of slides) for (const p of s.prims) {
    if (p.k !== 'text' || !p.paras.some((x) => x.bullet)) continue;
    const h = m.textHeight(p.paras, p.w - (p.pad ?? 4) * 2, p.size, false, p.line ?? 1.32, m.BULLET_INDENT(p.size));
    if (h > p.h - (p.pad ?? 4) * 2 + 0.5) over.push(`${s.id} ${h.toFixed(0)}>${p.h}`);
  }
  check('장표: 요약 상자 글이 넘치지 않음', !over.length, over.join(' '));
  // 같은 등급 사례 표의 금리는 데이터 값
  const peerSlide = slides.find((s) => s.id === 'peers');
  const tbl = peerSlide.prims.find((p) => p.k === 'table');
  const yields = new Set(d.peers.flatMap((p) => p.tranches.map((t) => t.yield_pct)).filter((v) => v != null).map((v) => `${Number(v).toFixed(3)}%`));
  const shown = tbl.rows.slice(2).flatMap((r) => r.filter(Boolean).map((c) => c.paras.map((x) => x.runs.map((y) => y.t).join('')).join(''))).filter((t) => /^\d+\.\d{3}%$/.test(t));
  check('장표: 사례 표 발행금리는 공시 값', shown.length > 0 && shown.every((t) => yields.has(t)), shown.join(','));
  // 일정 장표의 납입일 칸
  const sch = slides.find((s) => s.id === 'schedule');
  const cal = sch.prims.find((p) => p.k === 'table');
  check('장표: 일정표에 발행/납입 칸', cal.rows.some((r) => r.some((c) => c && c.paras.some((x) => x.runs.some((y) => y.t === '발행/납입')))));
  // 규칙 문안 숫자도 사실 묶음 안에 있다
  const facts = m.factsFor(d, inp);
  const allowed = m.allowedNumbers(facts, d);
  const lines = [tx.lead, ...tx.peers, ...tx.compare, ...tx.schedule, ...tx.structure, ...tx.rates, ...tx.corp, ...tx.views];
  const bad = lines.filter((l) => !m.lineOk(l, allowed, true).ok);
  check('문안: 규칙 문안이 자체 검증을 통과', !bad.length, bad.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

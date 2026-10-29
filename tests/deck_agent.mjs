// 제안서 Agent 행동 반영 테스트: LLM 이 준 행동 목록을 코드가 검사·반영하는지 (web/lib/deck/agent.ts)
// 실행: node tests/deck_agent.mjs
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  stdin: { contents: `export * from './lib/deck/agent'; export { defaultInput, scheduleOf } from './lib/deck/rules'; export { available } from './lib/deck/layout';`, resolveDir: join(root, 'web'), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
});
const m = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

let pass = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    process.exitCode = 1;
  } else pass += 1;
};

const d = JSON.parse(readFileSync(join(root, 'tests/fixtures/deck_eland.json'), 'utf8'));
const inp = m.defaultInput(d);
const av = m.available(d, inp);
const A = (type, v = {}) => ({ type, tranches: null, eok: null, date: null, band: null, text: null, fee_uw: null, fee_lead: null, items: null, field: null, lines: null, slide: null, ...v });

let r = m.applyActions(d, inp, [A('tranches', { tranches: [{ tenor: '3년', eok: 1500 }] })], av);
eq('트랜치 교체', r.input.tranches, [{ tenor: '3년', eok: 1500 }]);
eq('증액 한도 재계산(발행금액 이상)', r.input.maxEok >= 1500, true);
r = m.applyActions(d, inp, [A('tranches', { tranches: [{ tenor: '3년', eok: 1500 }] }), A('max_amount', { eok: 2000 })], av);
eq('한도를 직접 주면 그 값', r.input.maxEok, 2000);

r = m.applyActions(d, inp, [A('tranches', { tranches: [{ tenor: '삼년', eok: 100 }] })], av);
eq('잘못된 만기는 거절', [r.input.tranches, r.rejected.length], [inp.tranches, 1]);

r = m.applyActions(d, inp, [A('pay_date', { date: '2000-01-01' })], av);
eq('기준일 이전 납입일 거절', [r.input.pay, r.rejected.length], [inp.pay, 1]);

const later = new Date(`${inp.pay}T00:00:00Z`);
later.setUTCDate(later.getUTCDate() + 7);
const pay2 = later.toISOString().slice(0, 10);
r = m.applyActions(d, { ...inp, demand: 'x' }, [A('pay_date', { date: pay2 })], av);
eq('납입일 변경 + 수요예측일 초기화', [r.input.pay, r.input.demand], [pay2, null]);

const opts = m.scheduleOf(d, inp)?.demandOptions ?? [];
r = m.applyActions(d, inp, [A('demand_date', { date: opts[1] ?? opts[0] })], av);
eq('수요예측 가능일만', r.input.demand, opts[1] ?? opts[0]);
r = m.applyActions(d, inp, [A('demand_date', { date: '2031-01-01' })], av);
eq('가능일 밖 거절', r.rejected.length, 1);

r = m.applyActions(d, inp, [A('band', { band: { type: 'spread', low: -20, high: 20 } })], av);
eq('밴드', r.input.band, { type: 'spread', low: -20, high: 20 });
r = m.applyActions(d, inp, [A('band', { band: { type: 'spread', low: 30, high: -30 } })], av);
eq('하단 > 상단 거절', r.rejected.length, 1);

r = m.applyActions(d, inp, [A('slides', { items: [{ id: 'league', on: true }, { id: 'nope', on: true }] })], av);
eq('장표 켜기 + 없는 id 거절', [r.input.items.league, r.rejected.length], [av('league'), av('league') ? 1 : 2]);

r = m.applyActions(d, inp, [A('template', { text: 'lite' })], av);
eq('간략 템플릿', [r.input.items.terms, r.input.items.bok], [true, false]);

r = m.applyActions(d, inp, [A('fee', { fee_uw: 15, fee_lead: null })], av);
eq('수수료 하나만', [r.input.feeUw, r.input.feeLead], [15, inp.feeLead]);
r = m.applyActions(d, inp, [A('fee', { fee_uw: 500 })], av);
eq('수수료 범위 밖 거절', r.rejected.length, 1);

r = m.applyActions(d, inp, [A('coupon', { text: '6개월 이표채' })], av);
eq('이자지급', r.input.coupon, '6개월 이표채');

r = m.applyActions(d, inp, [A('series', { text: '120' })], av);
eq('회차 + 표지 제목', [r.input.series, /제120회/.test(r.input.coverTitle)], ['120', true]);

r = m.applyActions(d, inp, [A('sales_ai'), A('edit_text', { field: 'sizing', lines: ['줄1', '줄2'] }), A('edit_text', { field: 'bogus', lines: ['x'] })], av);
eq('Sales AI·문안 고치기·없는 칸 거절', [r.sales, r.edits.map((e) => e.field), r.rejected.length], [true, ['sizing'], 1]);

r = m.applyActions(d, inp, [A('goto', { slide: 'schedule' }), A('reset')], av);
eq('이동·되돌리기', [r.goto, r.reset], ['schedule', true]);

r = m.applyActions(d, inp, Array.from({ length: 12 }, () => A('coupon', { text: '만기일시' })), av);
eq('행동은 8개까지', r.changes.length, 8);

console.log(`deck_agent: ${pass} passed${process.exitCode ? ', some failed' : ''}`);

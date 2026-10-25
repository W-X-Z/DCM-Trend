// 제안서 덱 로직 테스트: 일정 역산, AI 문안 검증, 장표 레이아웃(실제 데이터 스냅샷)
// 실행: npm run test:deck  (web/lib/deck 의 TypeScript 를 esbuild 로 묶어 불러온다)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = `
export * from './lib/deck/schedule';
export * from './lib/deck/validate';
export * from './lib/deck/rules';
export * from './lib/deck/model';
export { buildSlides, fileBase, staticSubs, available, parseTsv } from './lib/deck/layout';
export { mixOf, valueAt, meetingVolatility, notchStats, typedIssues, pp, tenorDemand } from './lib/deck/analytics';
export { planOf, defaultItems } from './lib/deck/catalog';
export { knowledgeForPrompt, forGrade } from './lib/deck/knowledge';
export { assemble } from './lib/deck/assemble';
export { PAGE } from './lib/deck/theme';
export { unzipSync, strFromU8 } from 'fflate';
`;
const out = await build({ stdin: { contents: entry, resolveDir: join(root, 'web'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
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
  check('검증: NH 제안 판단은 허용', m.lineOk('장기물 중심 구성이 적합하다고 판단', allowed, false).ok);
  check('검증: 출처 없는 시장 방향 예측은 거부', !m.lineOk('국고채 금리가 하락할 것으로 예상되어 발행 여건 개선', allowed, false).ok);
  check('검증: 출처 없는 수요 예측은 거부', !m.lineOk('경쟁률 1.43:1 수준의 수요가 몰릴 것으로 예상', allowed, false).ok);
  check('검증: 하우스를 밝힌 시장 전망은 허용(금리 장표)', m.lineOk('NH투자증권 리서치는 국고채 금리 하락 가능성을 제시', allowed, true).ok);
  const rule = { lead: 'r', peers: ['r1'], compare: ['r'], schedule: ['r'], structure: ['r'], structureRows: [{ label: '1년', desc: 'r' }], strengths: [{ title: 'a', text: 'b' }, { title: 'c', text: 'd' }, { title: 'e', text: 'f' }], rates: ['r'], corp: ['r'], views: ['r'], sizing: ['r'], pipeline: ['r'], bok: ['r'], fomc: ['r'], usviews: ['r'], forecast: ['r'], league: ['r'], maturity: ['r'], sales: ['r'], termNotes: { rating: '', tenor: '', amount: '', band: '', coupon: '', demand: '', pay: '', uw: '', fee: '' } };
  const r = m.mergeValidated({ ...rule, peers: ['경쟁률 9.99:1'], lead: '430억원 제안' }, rule, allowed);
  check('검증: 실패한 필드는 규칙 문안으로', r.text.peers[0] === 'r1' && r.text.lead === '430억원 제안' && r.dropped.length === 1, JSON.stringify(r.dropped));
}

// 2-1. 판단 근거 계산
{
  const tr = (byType) => ({ tenor: '3년', months: 36, byType });
  const mx = m.mixOf([tr([{ t: 'fund', n: 2, q: 300e8 }, { t: 'broker', n: 1, q: 100e8 }]), tr([{ t: 'fund', n: 1, q: 100e8 }])]);
  check('근거: 투자자 구분별 합계·비중', mx.total === 500e8 && mx.rows[0].t === 'fund' && Math.round(mx.rows[0].share) === 80, JSON.stringify(mx));
  const pts = [['2026-10-01', 3.1], ['2026-10-02', 3.2], ['2026-10-06', 3.25]];
  check('근거: 날짜 이전 가장 가까운 값(7일 이내)', m.valueAt(pts, '2026-10-05') === 3.2 && m.valueAt(pts, '2026-09-01') === null && m.valueAt(pts, '2026-10-20') === null);
  const days = [];
  for (let i = 0; i < 120; i++) days.push([new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), 3 + (i % 2) * 0.02]);
  const vol = m.meetingVolatility({ daily: [{ key: 'ktb3y', pts: days }] }, ['2026-02-01', '2026-03-01', '2026-04-01']);
  check('근거: 금통위 전후 변동폭(일별 2bp 진동)', vol && vol.meetings === 3 && vol.byLag.every((x) => x.bp === 2), JSON.stringify(vol));
  check('근거: 탭 구분 표 붙여넣기', JSON.stringify(m.parseTsv('a\tb\n1\t2\t3\n\n')) === JSON.stringify([['a', 'b', ''], ['1', '2', '3']]));
}

// 3. 목차: 켜고 끄면 번호가 다시 매겨진다
{
  const on = m.defaultItems();
  const p = m.planOf(on);
  check('목차: 기본 구성 Ⅰ·Ⅱ·Ⅲ·Appendix', p.sections.map((x) => `${x.roman}${x.label}`).join('|') === 'Ⅰ주요 발행 조건 제안|Ⅱ주요 검토사항|ⅢNH투자증권 강점|Appendix', p.sections.map((x) => x.label).join('|'));
  const rates = p.sections[1].groups[0].items;
  check('목차: 금리 동향 및 전망 소제목 ①~⑥', rates.map((x) => x.sub).join(',') === '① 금리 동향,② 금통위,③ FOMC,④ 증권사별 국내 기준금리 전망,⑤ 증권사별 미국 기준금리 전망,⑥ 금리 전망(NH투자증권 리서치)', rates.map((x) => x.sub).join(','));
  const p2 = m.planOf({ ...on, bok: false, sales: true, pipeline: false });
  check('목차: 금통위를 끄면 FOMC 가 ②', p2.sections[1].groups[0].items[1].title === '1. 금리 동향 및 전망_② FOMC', p2.sections[1].groups[0].items[1].title);
  check('목차: Sales 전략을 켜면 4번, 예정 내역을 끄면 빠짐', p2.sections[0].groups.map((g) => `${g.no}.${g.title}`).join('|') === '1.발행조건 제안(案)|2.적정 발행규모 및 트랜치 구성 검토|3.회사채 발행 일정 검토|4.Sales 전략');
  const none = Object.fromEntries(Object.keys(on).map((k) => [k, false]));
  const p3 = m.planOf({ ...none, rates: true, events: true });
  check('목차: Ⅰ 이 비면 Ⅱ 가 Ⅰ 로', p3.sections[0].roman === 'Ⅰ' && p3.sections[0].label === '주요 검토사항' && p3.sections[1].groups[0].title === '주요 이벤트', JSON.stringify(p3.sections.map((x) => x.roman + x.label)));
  check('목차: 하나만 남은 묶음은 소제목 없음', p3.sections[0].groups[0].items[0].title === '1. 금리 동향 및 전망_① 금리 동향', p3.sections[0].groups[0].items[0].title);
  const p4 = m.planOf(on, (id) => id !== 'fomc');
  check('목차: 자료 없는 장표는 빠짐', !p4.sections[1].groups[0].items.some((x) => x.id === 'fomc'));
}

// 4. 장표: 실제 데이터 스냅샷(이랜드월드, 2026-10-23), 페이지 안, 숫자 출처
{
  const d = JSON.parse(readFileSync(join(root, 'tests/fixtures/deck_eland.json'), 'utf8'));
  const inp = m.defaultInput(d);
  const tx = m.ruleText(d, inp);
  const slides = m.buildSlides(d, inp, tx);
  const ids = slides.map((s) => s.id);
  const want = ['cover', 'contents', 'folder-I', 'terms', 'sizing', 'schedule', 'sales', 'pipeline', 'folder-II', 'rates', 'bok', 'fomc', 'views', 'usviews', 'forecast', 'peers-0', 'compare', 'corp', 'folder-III', 'nh_core-0', 'league', 'strength', 'maturity', 'events', 'back'];
  check('장표: 기본 목차 순서', want.every((w, i) => ids.indexOf(w) >= 0 && (i === 0 || ids.indexOf(w) > ids.indexOf(want[i - 1]))), ids.join(','));
  check('장표: 발행조건 비고 근거', tx.termNotes && /수요예측 가능일/.test(tx.termNotes.demand) && tx.termNotes.tenor.length > 0, JSON.stringify(tx.termNotes));
  const fx = m.buildSlides(d, { ...inp, internal: { ...inp.internal, creditFc: '구분\t2026\nAA-\t3.10', investors: '기관\t참여\nA\t100' }, items: { ...inp.items, sales: true } }, tx);
  check('장표: 내부 자료 붙여넣기 → 회사채 전망 2쪽', fx.some((s) => s.id === 'forecast-2'));
  const typed = m.typedIssues(d.own, 4);
  check('장표: 투자자 구분은 수집된 회차만 집계·회차 표기', typed.list.length >= 1 && typed.list.every((p) => p.tranches.some((t) => t.byType?.length)) && tx.sales.some((x) => x.includes(typed.label)), `${typed.label} | ${tx.sales[0]}`);
  {
    // 경쟁률은 작은 2년물이 높고 참여금액은 3년물이 많은 경우(LG헬로비전 제12~15회 형태) → 3년물 중심 판단
    const tr = (tenor, init, dem) => ({ tenor, initial_krw: init * 1e8, demand_krw: dem * 1e8, ratio: dem / init, byType: null });
    const own = [{ ...d.own[0], series: '15', tranches: [tr('2년', 300, 2200), tr('3년', 1200, 3450)] }, { ...d.own[0], series: '13', tranches: [tr('2년', 200, 2100), tr('3년', 800, 9500)] }];
    const st = m.tenorDemand(own, 4);
    const tx2 = m.ruleText({ ...d, own }, { ...inp, tranches: [{ tenor: '2년', eok: 300 }, { tenor: '3년', eok: 1200 }] });
    const line = tx2.sizing.find((x) => /평균 경쟁률/.test(x) && /트랜치|중심/.test(x)) ?? '';
    check('문안: 만기 판단은 경쟁률과 참여금액을 함께 봄', st.length === 2 && /3년물 중심/.test(line) && /2년물은 보조 트랜치/.test(line), line);
    const tx3 = m.ruleText({ ...d, own }, { ...inp, tranches: [{ tenor: '2년', eok: 300 }] });
    check('문안: 제안에 없는 만기에 수요가 가장 많으면 추가 검토', tx3.sizing.some((x) => /제안에 없는 3년물/.test(x)), tx3.sizing.join(' | '));
  }
  {
    // 노하우: 등급이 맞거나 비어 있는 것, 켠 장표와 공통만 AI 요청에 들어간다
    const K = (id, slide, kind, grade, body) => ({ id, slide, kind, grade, body, source: null, created_by: null, updated_by: null, updated_kst: '' });
    const list = [K(1, 'all', 'style', null, '개조식으로 쓴다'), K(2, 'sizing', 'judge', 'A', 'A급은 3년물 선호'), K(3, 'sizing', 'judge', 'AA', 'AA급 규칙'), K(4, 'sales', 'practice', null, '재마케팅'), K(5, 'terms', 'practice', null, '선택지로 제시')];
    const t = m.knowledgeForPrompt(list, 'A', ['sizing', 'terms']);
    check('노하우: 등급·켠 장표만 AI 요청에', JSON.stringify(t) === JSON.stringify({ 모든장표: ['[표현] 개조식으로 쓴다'], sizing: ['[판단 기준] A급은 3년물 선호'], 'lead·termNotes·structure·structureRows': ['[관행] 선택지로 제시'] }), JSON.stringify(t));
    check('노하우: 등급 거르기', m.forGrade(list, 'AA').map((k) => k.id).join(',') === '1,3,4,5');
  }
  check('장표: %p 차이 -0.0 없음', m.pp(-0.03) === '0.0' && m.pp(0.26) === '+0.3' && m.pp(-8.24) === '-8.2');
  check('장표: 레이아웃(표지·목차·간지·본문·뒷표지)', slides[0].layout === 'cover' && slides[1].layout === 'contents' && slides[2].layout === 'folder' && slides[3].layout === 'body' && slides.at(-1).layout === 'back');
  check('장표: 표지 제목에 다음 회차', slides[0].prims.some((p) => p.k === 'text' && p.paras.some((x) => x.runs.some((r) => /제112회 공모사채 발행 검토 및 제안/.test(r.t)))));
  const core = slides.find((s) => s.id === 'nh_core-0');
  check('장표: 템플릿 고정 장표는 원본 XML·번호 바꿈', core.static?.file === 'ppt/slides/slide27.xml' && core.static.renumber === '1.', JSON.stringify(core.static));
  const terms = slides.find((s) => s.id === 'terms');
  check('장표: 쪽 제목 번호', terms.prims.some((p) => p.k === 'text' && p.paras[0].runs.map((r) => r.t).join('') === '1. 발행조건 제안(案)'));
  check('장표: 쪽번호는 장표 순서', terms.chrome.some((p) => p.k === 'text' && p.paras[0].runs[0].t === String(ids.indexOf('terms') + 1)));
  let out = [];
  for (const s of slides) {
    for (const p of [...s.chrome, ...s.prims]) {
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
  const peerSlide = slides.find((s) => s.id === 'peers-0');
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
  const lines = [tx.lead, ...tx.peers, ...tx.compare, ...tx.schedule, ...tx.structure, ...tx.rates, ...tx.corp, ...tx.views,
    ...tx.sizing, ...tx.pipeline, ...tx.bok, ...tx.fomc, ...tx.usviews, ...tx.forecast, ...tx.league, ...tx.maturity, ...tx.sales];
  const bad = lines.filter((l) => !m.lineOk(l, allowed, true).ok);
  check('문안: 규칙 문안이 자체 검증을 통과', !bad.length, bad.join(' | '));
  // 모든 장표를 켜도 페이지 안
  const all = Object.fromEntries(Object.keys(inp.items).map((k) => [k, true]));
  const full = m.buildSlides(d, { ...inp, items: all, tranches: [{ tenor: '2년', eok: 500 }, { tenor: '3년', eok: 1000 }] }, tx);
  check('장표: 전체 목차 33장 내외(고정 장표 포함)', full.length >= 30 && full.filter((s) => s.static).length === 9, `${full.length} / static ${full.filter((s) => s.static).length}`);

  // 5. PPTX 조립: NH 템플릿 + 고정 장표, 번호·회사명 바꿈
  const tpl = new Uint8Array(readFileSync(join(root, 'web/public/deck/nh-template.pptx')));
  const subs = m.staticSubs(d, inp);
  const bytes = m.assemble(tpl, null, [{ kind: 'static', file: 'ppt/slides/slide31.xml', renumber: '7.' }, { kind: 'static', file: 'ppt/slides/slide21.xml', renumber: '3.' }], subs);
  const z = m.unzipSync(bytes);
  const pres = m.strFromU8(z['ppt/presentation.xml']);
  const s1 = m.strFromU8(z['ppt/slides/slide1.xml']);
  const s2 = m.strFromU8(z['ppt/slides/slide2.xml']);
  check('조립: 장표 2장, 원본 장표 정리', (pres.match(/<p:sldId /g) ?? []).length === 2 && !z['ppt/slides/slide31.xml'] && Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length === 2);
  check('조립: 제목 번호 바꿈', /<a:t>7\. ?/.test(s1) && !/<a:t>6\. /.test(s1));
  check('조립: 자리 표시를 회사·부서명으로', !/\{\{/.test(s1 + s2) && s2.includes('이랜드월드') && s1.includes('IB사업'), '');
  const tz = m.unzipSync(tpl);
  check('템플릿: 고객사 이름 없음', !Object.keys(tz).some((k) => /\.xml$/.test(k) && /대한항공/.test(m.strFromU8(tz[k]))));
  check('조립: 레이아웃·마스터 유지', /slideLayout3\.xml/.test(m.strFromU8(z['ppt/slides/_rels/slide1.xml.rels'])) && !!z['ppt/slideMasters/slideMaster1.xml']);
  const ct = m.strFromU8(z['[Content_Types].xml']);
  check('조립: 콘텐츠 형식 등록', ct.includes('/ppt/slides/slide1.xml') && ct.includes('/ppt/slides/slide2.xml') && !ct.includes('/ppt/slides/slide31.xml'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

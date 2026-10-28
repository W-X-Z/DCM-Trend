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
export { buildSlides, fileBase, staticSubs, available, parseTsv, gradeIssueTable } from './lib/deck/layout';
export { mixOf, valueAt, meetingVolatility, notchStats, typedIssues, pp, tenorDemand, tenorMix, maturityBuckets, suspectOf, trRatio, typedOk, typedTranches } from './lib/deck/analytics';
export { timingPlan, timingText, habitOf } from './lib/deck/timing';
export { SYSTEM as DECK_SYSTEM, DECK_PROMPT_VERSION } from './lib/deck/prompt';
export { dataReport } from './lib/deck/sources';
export { qaChecks, creditGridIssues } from './lib/deck/qa';
export { planOf, defaultItems, TEMPLATES, templateOf } from './lib/deck/catalog';
export { dmFor, dmView } from './lib/deck/dm';
export { lineGeom, colsGeom, dateTicks } from './lib/deck/chart';
export { reviewMarks } from './lib/deck/review';
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

// 3. 목차(기본형): Ⅰ 발행 제안(회사별 생성) / Ⅱ 회사채 시장 동향(DM 판 그대로) / Appendix. 번호는 부마다, 켜고 끄면 다시 매겨진다
{
  const on = m.defaultItems();
  const p = m.planOf(on);
  const sec = (x) => `${x.part ?? ''}${x.no ?? ''}${x.label}`;
  check('목차: Ⅰ 3장 + Ⅱ 4장(DM 순서) + Appendix', p.sections.map(sec).join('|') === 'Ⅰ1발행 조건 제안|Ⅰ2발행 일정(안)|Ⅰ3Sales 전략|Ⅱ1금리 동향|Ⅱ2금리 전망|Ⅱ3발행시장 동향|Ⅱ4회사채 수요예측 예정 내역|Appendix', p.sections.map(sec).join('|'));
  check('목차: 부 묶음 + 간지 기본 켬', p.parts.map((x) => `${x.key}.${x.label}:${x.sections.length}`).join('|') === 'Ⅰ.발행 제안:3|Ⅱ.회사채 시장 동향:4' && p.folders && !p.front.includes('folders'), JSON.stringify(p.parts.map((x) => x.key)));
  check('목차: 발행 조건 제안 ①②', p.sections[0].items.map((x) => x.title).join(',') === '1. 발행 조건 제안_① 제안 Term-sheet,1. 발행 조건 제안_② 트랜치 검토', p.sections[0].items.map((x) => x.title).join(','));
  check('목차: 상세 장표(미매각·NH 강점)는 기본 꺼짐, Sales 전략은 기본 켬', on.sales && !on.compare && !on.corp && !on.nh_core && !on.league && !on.strength && !on.datareport);
  check('목차: 장표 하나인 장은 소제목 없음', p.sections[2].items[0].title === '3. Sales 전략' && p.sections[6].items[0].title === '4. 회사채 수요예측 예정 내역', `${p.sections[2].items[0].title} / ${p.sections[6].items[0].title}`);
  check('목차: 발행 일정 = ① 발행 시기 검토 ② 세부 일정', p.sections[1].items.map((x) => x.title).join(',') === '2. 발행 일정(안)_① 발행 시기 검토,2. 발행 일정(안)_② 세부 일정', p.sections[1].items.map((x) => x.title).join(','));
  {
    const p1 = m.planOf({ ...on, timing: false });
    check('목차: 시기 검토를 끄면 발행 일정(안) 한 장', p1.sections[1].items.map((x) => x.title).join(',') === '2. 발행 일정(안)', p1.sections[1].items.map((x) => x.title).join(','));
  }
  check('목차: Ⅱ부는 1부터 다시(주요 이슈·시장 유동성은 기본 꺼짐)', p.sections[3].items.map((x) => x.title).join(',') === '1. 금리 동향_① 금리 동향,1. 금리 동향_② 금통위,1. 금리 동향_③ FOMC' && p.sections[5].items.map((x) => x.title).join(',') === '3. 발행시장 동향_① 공모사채 발행 규모,3. 발행시장 동향_② 회사채 수요예측 결과', p.sections.slice(3).map((x) => x.items.map((i) => i.title).join(',')).join(' / '));
  check('목차: 장표 이름에 부 표시', p.sections[0].items[1].label === 'Ⅰ-1-② 트랜치 검토' && p.sections[1].items[0].label === 'Ⅰ-2-① 발행 시기 검토' && p.sections[1].items[1].label === 'Ⅰ-2-② 세부 일정' && p.sections[3].items[2].label === 'Ⅱ-1-③ FOMC' && p.sections[6].items[0].label === 'Ⅱ-4. 회사채 수요예측 예정 내역', p.sections.flatMap((x) => x.items.map((i) => i.label)).join('|'));
  check('목차: Appendix 번호(만기도래 현황·주요 일정)', p.sections[7].items.map((x) => x.title).join(',') === 'Appendix 1. 공모사채 만기도래 현황,Appendix 2. 주요 일정');
  const pi = m.planOf({ ...on, issues: true, liquidity: true });
  check('목차: 주요 이슈·시장 유동성을 켜면 DM 번호(1-④, 3-②)', pi.sections[3].items[3]?.title === '1. 금리 동향_④ 주요 이슈' && pi.sections[5].items.map((x) => x.sub).join(',') === '① 공모사채 발행 규모,② 시장 유동성,③ 회사채 수요예측 결과', pi.sections[5].items.map((x) => x.sub).join(','));
  const p1 = m.planOf(on, (id) => id !== 'credit_fc');
  check('목차: 내부 데이터 없는 회사채 금리는 빠지고 번호 당김', p1.sections[4].items.map((x) => x.sub).join(',') === '① 기준금리 및 국고채 금리,② 증권사별 국내 기준금리 전망,③ 증권사별 미국 기준금리 전망', p1.sections[4].items.map((x) => x.sub).join(','));
  const p2 = m.planOf({ ...on, bok: false, pipeline: false });
  check('목차: 금통위를 끄면 FOMC 가 ②', p2.sections[3].items[1].title === '1. 금리 동향_② FOMC', p2.sections[3].items[1].title);
  check('목차: 예정 내역을 끄면 장이 빠짐', !p2.sections.some((x) => x.key === 'pipeline') && p2.sections.filter((x) => x.part === 'Ⅰ').length === 3);
  const none = Object.fromEntries(Object.keys(on).map((k) => [k, false]));
  const p3 = m.planOf({ ...none, rates: true, events: true });
  check('목차: 앞 부가 비면 Ⅱ부만, 간지 꺼짐', p3.parts.map((x) => x.key).join() === 'Ⅱ' && p3.sections[0].no === 1 && p3.sections[0].items[0].title === '1. 금리 동향' && p3.sections[1].items[0].title === 'Appendix 1. 주요 일정' && !p3.folders, JSON.stringify(p3.sections.map((x) => x.items.map((i) => i.title))));
  const p4 = m.planOf(on, (id) => id !== 'fomc');
  check('목차: 자료 없는 장표는 빠짐', p4.sections[3].key === 'rates' && !p4.sections[3].items.some((x) => x.id === 'fomc'));
  const lite = m.planOf(m.TEMPLATES.find((t) => t.key === 'lite').items());
  check('목차: 간략 템플릿은 간지 없음', !lite.folders && lite.parts.length === 2, JSON.stringify(lite.parts.map((x) => x.key)));
}

// 4. 장표: 실제 데이터 스냅샷(이랜드월드, 2026-10-23), 페이지 안, 숫자 출처
{
  const d = JSON.parse(readFileSync(join(root, 'tests/fixtures/deck_eland.json'), 'utf8'));
  const inp = m.defaultInput(d);
  const tx = m.ruleText(d, inp);
  const slides = m.buildSlides(d, inp, tx);
  const ids = slides.map((s) => s.id);
  const want = ['cover', 'contents', 'folder-Ⅰ', 'terms', 'sizing', 'timing', 'schedule', 'sales', 'folder-Ⅱ', 'rates', 'bok', 'fomc', 'forecast', 'views', 'usviews', 'peers-0', 'pipeline', 'maturity', 'events', 'back'];
  // 직전 회차를 NH 가 주관하지 않았으면 NH 강점 1장(데이터 생성)만 켜고, 템플릿 고정 장표는 끈다
  const winBack = d.own.length > 0 && !d.own[0].nh_lead;
  check('장표: 기본 목차 순서(Ⅰ부·Ⅱ부 간지)', want.every((w, i) => ids.indexOf(w) >= 0 && (i === 0 || ids.indexOf(w) > ids.indexOf(want[i - 1]))) && ids.indexOf('sales') === ids.indexOf('schedule') + 1 && ids.filter((x) => x.startsWith('folder')).length === 2 && !ids.some((x) => /^compare|^corp|^nh_|^league|^credit_fc|^datareport/.test(x)) && ids.includes('strength') === winBack, ids.join(','));
  check('장표: 발행조건 비고 근거', tx.termNotes && /수요예측 가능일/.test(tx.termNotes.demand) && tx.termNotes.tenor.length > 0, JSON.stringify(tx.termNotes));
  const fx = m.buildSlides(d, { ...inp, internal: { ...inp.internal, creditFc: '구분\t2026\nAA-\t3.10', investors: '기관\t참여\nA\t100' }, items: { ...inp.items, sales: true } }, tx);
  check('장표: 내부 데이터(등급별 전망표) 연결 → 회사채 금리 장표', fx.some((s) => s.id === 'credit_fc') && ids.indexOf('forecast') >= 0 && !ids.includes('credit_fc'));
  {
    // 회사채 금리(3-②): 현업 샘플 양식 = 우량채·비우량채 전망 단락(하우스 이름 없이) + 등급별 금리 표. 내부 전망표 없으면 실적표로 대체
    const notes = [
      { topic: '우량 회사채', house: '가증권', title: 'T1', url: 'u1', date: d.asof, text: 'AA급 수요 강함' },
      { topic: '비우량 회사채', house: '나증권', title: 'T2', url: 'u2', date: d.asof, text: 'BBB 스프레드 확대' },
    ];
    const cs = m.buildSlides({ ...d, marketNotes: notes }, { ...inp, items: { ...inp.items, credit_fc: true } }, tx).find((s) => s.id === 'credit_fc');
    const txt = (cs?.prims ?? []).flatMap((p) => (p.k === 'text' ? p.paras : p.k === 'table' ? p.rows.flat().filter(Boolean).flatMap((c) => c.paras) : [])).map((q) => q.runs.map((r) => r.t).join('')).join('\n');
    check('장표: 회사채 금리 = 우량채·비우량채 전망 단락 + 등급별 금리 표', !!cs && /AA등급 이상\(우량채\) 회사채 시장 전망/.test(txt) && /A등급 이하\(비우량채\)/.test(txt) && /등급별 회사채 금리 추이/.test(txt) && /회사채 AA-/.test(txt) && !/■[^\n]*가증권/.test(txt) && /가증권 T1/.test(txt), txt.slice(0, 400));
  }
  {
    // 시장 자료 팩(Discussion Material 데이터): 주요 이슈는 양식 고정·이슈 가변(중요도→기준일, 60일·유효기간), 이슈 둘씩 한 쪽
    const iss = (topic, as_of, priority, chart, valid_until = '2026-12-31', section = 'issue') => ({ topic, as_of, valid_until, priority, impact: '금리 상방', points: [`${topic} 내용`], chart, chart_title: `${topic} 차트`, sources: [{ title: `${topic} 출처`, url: 'u', date: as_of }], section });
    const issues = [iss('관세', d.asof, 2, null), iss('유가', d.asof, 5, 'brent'), iss('증시', d.asof, 4, 'kospi'), iss('오래된 이슈', '2020-01-01', 5, null), iss('만료', d.asof, 5, null, '2020-01-01'), iss('부동산', d.asof, 3, 'apt_seoul'), iss('수급', d.asof, 4, 'maturity', '2026-12-31', 'supply'), iss('IMA', d.asof, 2, null, '2026-12-31', 'supply')];
    const pts = (n, f) => Array.from({ length: n }, (_, i) => [new Date(Date.parse(d.asof) - (n - i) * 864e5).toISOString().slice(0, 10), f(i)]);
    const market = [
      { key: 'brent', label: '브렌트유', unit: '달러/배럴', source: 'FRED', cycle: 'D', pts: pts(300, (i) => 60 + i / 5) },
      { key: 'kospi', label: 'KOSPI', unit: 'pt', source: 'ECOS', cycle: 'D', pts: pts(300, (i) => 5000 + i) },
      { key: 'apt_seoul', label: 'KB 서울', unit: '지수', source: 'ECOS', cycle: 'M', pts: Array.from({ length: 20 }, (_, i) => [`2025-${String((i % 12) + 1).padStart(2, '0')}-01`, 100 + i]) },
    ];
    const dd = { ...d, issues, market };
    const picked = m.pickIssues(dd).map((x) => x.topic);
    check('주요 이슈: 중요도·최신 순 상위 4개, 오래되거나 만료된 이슈·수급 이슈 제외', JSON.stringify(picked) === JSON.stringify(['유가', '증시', '부동산', '관세']), picked.join(','));
    check('주요 이슈: 수급 이슈는 따로(만기도래 및 수급 장표)', m.supplyIssues(dd).map((x) => x.topic).join() === '수급,IMA');
    const all = m.buildSlides(dd, { ...inp, items: { ...inp.items, issues: true } }, m.ruleText(dd, inp));
    const sl = all.filter((x) => x.id.startsWith('issues'));
    const charts = sl.flatMap((x) => x.prims.filter((p) => p.k === 'chart'));
    check('주요 이슈: 두 쪽, 이슈별 차트(유가·KOSPI 선, 아파트값 전월비, 관세는 차트 없음)', sl.length === 2 && charts.length === 3 && charts.every((c) => c.chart.kind === 'line'), `${sl.length} ${charts.map((c) => c.chart.kind).join(',')}`);
    const mat = all.find((x) => x.id === 'maturity');
    const mt = mat.prims.filter((p) => p.k === 'text').flatMap((p) => p.paras.map((q) => q.runs.map((r) => r.t).join(''))).join('\n');
    const mc = mat.prims.find((p) => p.k === 'chart');
    const mtb = mat.prims.find((p) => p.k === 'table');
    check('만기도래 현황: DM 양식 = 등급별 쌓은 막대 + 등급×월 표(수급 문구는 시장 유동성 장표로)', mc?.chart.kind === 'cols' && mc.chart.stacked && mc.chart.series.length >= 3 && mtb && mtb.rows.length >= 5 && !/\[수급\]/.test(mt), `${mc?.chart.kind} ${mc?.chart.series.length} ${mtb?.rows.length}`);
    const mtt = mtb.rows.flat().filter(Boolean).map((c) => c.paras.map((x) => x.runs.map((r) => r.t).join('')).join(''));
    const lastRow = mtb.rows.at(-1).filter(Boolean).map((c) => c.paras.map((x) => x.runs.map((r) => r.t).join('')).join(''));
    check('만기도래 현황: 총계 줄 = 월별 합계', lastRow[0] === '총계' && lastRow.length === 2 + d.maturityByGrade.months.length && mtt.includes('공모회사채'), lastRow.slice(0, 4).join(','));
    check('만기도래 현황: 숫자 요약 글상자(규칙 문안)', tx.maturity.some((x) => /앞 6개월/.test(x)));
    check('주요 이슈: 데이터 없으면 장표 생략', !m.buildSlides(d, inp, tx).some((x) => x.id.startsWith('issues')));
    // 등급별 발행 결과표: 최근 두 달 시장 전체 수요예측을 등급×만기로
    const tr = (tenor, y, s, c) => ({ tenor, months: null, initial_krw: 1e11, amount_krw: 1e11, demand_krw: 5e11, in_band_krw: 5e11, ratio: c, under: false, yield_pct: y, spread_bp: s, band_type: '개별민평', band_low: -30, band_high: 30, maturity_dt: null, byType: null });
    const pi = (name, rating, dt, trs) => ({ key: name + dt, corp_code: name, corp_name: name, sub_type: '일반회사채', series: '1', rating, rating_group: rating.replace(/[+\-0]$/, ''), demand_dt: dt, pricing_dt: dt, deal_dt: dt, tenor_combo: '', initial_krw: 1e11, amount_krw: 1e11, demand_krw: 5e11, in_band_krw: 5e11, ratio: 5, under: false, increased: false, band_type: '개별민평', band_low: -30, band_high: 30, fee_bp: 20, lead: null, nh_lead: false, tranches: trs, amount_max_krw: null });
    const recent = [
      pi('가', 'AA-', '2026-09-03', [tr('2년', 4.5, -5, 6), tr('3년', 4.6, 40, 4)]), pi('나', 'AA-', '2026-10-03', [tr('3년', 4.4, -10, 8)]),
      pi('다', 'A+', '2026-09-10', [tr('2년', 4.9, 0, 3)]), pi('라', 'A+', '2026-10-11', [tr('2년', 4.8, 5, 4), tr('1.5년', 4.7, null, 2)]),
    ];
    const gtab = m.gradeIssueTable({ ...d, recentIssues: recent });
    const aa3 = gtab?.rows.find((r) => r.grade === 'AA-' && r.tenor === '3년');
    check('회사채: 등급별 발행 결과표(두 달·밴드 밖 가산금리 제외)', !!gtab && gtab.months.join() === '2026-09,2026-10' && aa3 && aa3.cells[1] === '–' && aa3.cells[5] === '-10' && gtab.rows[0].grade === 'AA-', JSON.stringify(gtab));
    // 금리 전망: 분기 경로 요약
    check('금리 전망: 경로 요약(같은 값은 이후로 묶음)', m.pathText({ cells: [{ period: '3Q26', value: 3, actual: true }, { period: '4Q26', value: 3.25, actual: false }, { period: '1Q27', value: 3.5, actual: false }, { period: '2Q27', value: 3.5, actual: false }] }) === '4Q26 3.25% → 1Q27 이후 3.50%');
    // 일정: 납입월 시장 만기 집중
    const mg = { months: ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'], rows: [], total: [1e12, 0.4e12, 9.9e12, 10.7e12, 2.7e12, 6.8e12], asof: d.asof };
    const crowd = m.marketCrowd({ ...d, maturityByGrade: mg }, '2027-02-10');
    check('일정: 납입월 시장 만기 집중이면 분산 검토 문구', !!crowd && /최대/.test(crowd) && /연초/.test(crowd) && !m.marketCrowd({ ...d, maturityByGrade: mg }, '2027-03-10'), crowd);
  }
  {
    // 현업 방식: 시장 장표는 DM 판 문구를 그대로, 고객 등급 쪽만 맞춤
    const dm = { edition: d.asof, title: '회사채 Discussion Material', by: 'IB Agent', pages: {
      rates: ['DM 국고채 문단', 'DM 회사채 문단', 'DM 스프레드 문단'], bok: ['DM 금통위 요약'], views: ['DM 증권사 요약'],
      forecast: ['■ 한국 기준금리 전망', 'DM 기준금리 문단'],
      credit_fc: { high: { title: 'AA등급 이상(우량채) 회사채 시장 전망', lines: ['우량 문단'] }, low: { title: 'A등급 이하(비우량채) 회사채 시장 전망', lines: ['비우량 문단'] } },
    } };
    const dd = { ...d, dm };
    const t2 = m.ruleText(dd, inp);
    check('DM: 시장 장표 문구는 판 그대로(금리 동향·금통위·증권사 전망·금리 전망)', t2.rates.join() === dm.pages.rates.join() && t2.bok[0] === 'DM 금통위 요약' && t2.views[0] === 'DM 증권사 요약' && t2.forecast[0].startsWith('■') && t2.sizing.join() === tx.sizing.join());
    const rs = m.buildSlides(dd, { ...inp, items: { ...inp.items, credit_fc: true } }, t2);
    const rate = rs.find((x) => x.id === 'rates');
    check('DM: 금리 동향은 문구 + 차트 두 개(금리 표 없음), 각주에 판 표기', !rate.prims.some((p) => p.k === 'table') && rate.prims.filter((p) => p.k === 'chart').length === 2 && JSON.stringify(rate.prims).includes('판, IB Agent'));
    const txtOf = (sl) => sl.prims.filter((p) => p.k === 'text').flatMap((p) => p.paras.map((q) => q.runs.map((r) => r.t).join('')));
    const fcs = rs.find((x) => x.id === 'forecast');
    const head = fcs.prims.filter((p) => p.k === 'text').flatMap((p) => p.paras).find((q) => q.runs.map((r) => r.t).join('').startsWith('■'));
    check('DM: 금리 전망 상자 ■ 소제목은 글머리 없이', !!head && !head.bullet);
    const lowCo = { ...dd, company: { ...dd.company, rating: 'A+', rating_group: 'A' }, recentIssues: [
      { key: 'x1', corp_code: 'x', corp_name: 'x', sub_type: '일반회사채', series: '1', rating: 'A+', rating_group: 'A', demand_dt: '2026-09-02', pricing_dt: null, deal_dt: null, tenor_combo: '', initial_krw: 1, amount_krw: 1, demand_krw: 1, in_band_krw: 1, ratio: 3, under: false, increased: false, band_type: '개별민평', band_low: -30, band_high: 30, fee_bp: 1, lead: null, nh_lead: false, amount_max_krw: null, tranches: [{ tenor: '2년', months: 24, initial_krw: 1, amount_krw: 1, demand_krw: 1, in_band_krw: 1, ratio: 3, under: false, yield_pct: 4.8, spread_bp: 1, band_type: '개별민평', band_low: -30, band_high: 30, maturity_dt: null, byType: null }, { tenor: '3년', months: 36, initial_krw: 1, amount_krw: 1, demand_krw: 1, in_band_krw: 1, ratio: 3, under: false, yield_pct: 4.9, spread_bp: 1, band_type: '개별민평', band_low: -30, band_high: 30, maturity_dt: null, byType: null }] },
      { key: 'x2', corp_code: 'y', corp_name: 'y', sub_type: '일반회사채', series: '1', rating: 'AA-', rating_group: 'AA', demand_dt: '2026-10-02', pricing_dt: null, deal_dt: null, tenor_combo: '', initial_krw: 1, amount_krw: 1, demand_krw: 1, in_band_krw: 1, ratio: 3, under: false, increased: false, band_type: '개별민평', band_low: -30, band_high: 30, fee_bp: 1, lead: null, nh_lead: false, amount_max_krw: null, tranches: [{ tenor: '2년', months: 24, initial_krw: 1, amount_krw: 1, demand_krw: 1, in_band_krw: 1, ratio: 3, under: false, yield_pct: 4.5, spread_bp: 1, band_type: '개별민평', band_low: -30, band_high: 30, maturity_dt: null, byType: null }, { tenor: '3년', months: 36, initial_krw: 1, amount_krw: 1, demand_krw: 1, in_band_krw: 1, ratio: 3, under: false, yield_pct: 4.6, spread_bp: 1, band_type: '개별민평', band_low: -30, band_high: 30, maturity_dt: null, byType: null }] },
    ] };
    const cs = m.buildSlides(lowCo, { ...inp, items: { ...inp.items, credit_fc: true } }, m.ruleText(lowCo, inp)).find((x) => x.id === 'credit_fc');
    const ct = txtOf(cs);
    const tbl = cs.prims.find((p) => p.k === 'table');
    const hiRows = tbl.rows.filter((r) => r.some((c) => c && c.fill === 'FFF2CC'));
    check('DM: A등급 고객은 비우량채 전망이 위, 표에서 고객 등급(A+) 행 강조', ct.findIndex((x) => /A등급 이하/.test(x)) < ct.findIndex((x) => /AA등급 이상/.test(x)) && hiRows.length === 2, `${ct.join(' | ')} / ${hiRows.length}`);
  }
  {
    // 중복 정리: 같은 내용은 한 장표에서만
    const textOf = (sl) => sl.prims.filter((p) => p.k === 'text').flatMap((p) => p.paras.map((q) => q.runs.map((r) => r.t).join(''))).join('\n');
    const plain = (x) => x.replace(/\*\*|\^\^|!!/g, '');
    const tOn = textOf(slides.find((x) => x.id === 'terms'));
    const tOff = textOf(m.buildSlides(d, { ...inp, items: { ...inp.items, sizing: false } }, tx).find((x) => x.id === 'terms'));
    check('중복: Term-sheet 상단은 제안 문장 + 밴드(직전 회차 근거는 트랜치 검토에)', tOn.includes(plain(tx.structure[0])) && (!tx.structure[1] || (!tOn.includes(plain(tx.structure[1])) && tOff.includes(plain(tx.structure[1])))), tOn.slice(0, 200));
    const pt = textOf(slides.find((x) => x.id === 'peers-0'));
    check('중복: 같은 등급 수요예측 결과(Ⅱ부)에는 회사 직전 회차·발행 일정 헤드라인 없음', !/직전 회차/.test(pt) && !/흥행을 위해/.test(pt) && !tx.peers.some((x) => /직전 회차/.test(x)), pt.slice(0, 200));
    const fomc = d.policy.fomc;
    const usv = d.usViews.length ? d.usViews : [{ house: 'NH투자증권', analysts: null, published_dt: d.asof, title: 't', url: 'u', next_move: '12월 인상', terminal: 4.25, end2026: 4.25, end2027: null, summary: 's' }];
    const df = { ...d, usViews: usv, policy: { ...d.policy, fomc: { ...fomc, points: [...fomc.points, { label: '10월 회의 전망', text: '동결 후 12월 인상 시사 전망' }] } } };
    const fOn = textOf(m.buildSlides(df, inp, m.ruleText(df, inp)).find((x) => x.id === 'fomc'));
    const fOff = textOf(m.buildSlides(df, { ...inp, items: { ...inp.items, usviews: false } }, m.ruleText(df, inp)).find((x) => x.id === 'fomc'));
    check('중복: FOMC 의 다음 회의 전망은 증권사별 미국 전망이 켜져 있으면 빠짐', !/10월 회의 전망/.test(fOn) && /10월 회의 전망/.test(fOff) && /결정/.test(fOn));
    check('중복: 증권사별 미국 전망 요약에 NH 줄 없음(표 첫 줄·금리 전망에 있음)', !m.ruleText(df, inp).usviews.some((x) => x.startsWith('NH투자증권(')));
  }
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
  const toc = slides[1].prims.slice(1).map((x) => x.paras[0].runs.map((r) => r.t).join(''));
  check('장표: 목차는 부 + 장 번호 + Appendix 장표', toc.join('|') === `Ⅰ. 발행 제안|1. 발행 조건 제안|2. 발행 일정(안)|3. Sales 전략${d.own.length && !d.own[0].nh_lead ? '|4. NH투자증권 강점' : ''}|Ⅱ. 회사채 시장 동향|1. 금리 동향|2. 금리 전망|3. 발행시장 동향|4. 회사채 수요예측 예정 내역|Appendix 1. 공모사채 만기도래 현황|Appendix 2. 주요 일정`, toc.join('|'));
  const fII = slides.find((x) => x.id === 'folder-Ⅱ');
  const fTxt = fII.prims.map((x) => x.paras.map((q) => q.runs.map((r) => r.t).join('')).join('/')).join(' | ');
  check('장표: Ⅱ부 간지 = 부 이름 + 장 목록', fTxt === 'Ⅱ. 회사채 시장 동향 | 1.  금리 동향/2.  금리 전망/3.  발행시장 동향/4.  회사채 수요예측 예정 내역', fTxt);
  check('장표: 표지 제목에 다음 회차', slides[0].prims.some((p) => p.k === 'text' && p.paras.some((x) => x.runs.some((r) => /제112회 공모사채 발행 검토 및 제안/.test(r.t)))));
  const core = m.buildSlides(d, { ...inp, items: { ...inp.items, nh_core: true } }, tx).find((s) => s.id === 'nh_core-0');
  check('장표: 템플릿 고정 장표는 원본 XML·번호 바꿈', core.static?.file === 'ppt/slides/slide27.xml' && core.static.renumber === '4.', JSON.stringify(core.static));
  const terms = slides.find((s) => s.id === 'terms');
  check('장표: 쪽 제목 번호', terms.prims.some((p) => p.k === 'text' && p.paras[0].runs.map((r) => r.t).join('') === '1. 발행 조건 제안_① 제안 Term-sheet'));
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

  // 4-1. 트랜치 검토 근거: 같은 등급 만기별 발행 비중, 회사 만기분포(제안 만기 범위의 공백)
  {
    const T = (months, amt) => ({ tenor: `${months / 12}년`, months, amount_krw: amt * 1e8, initial_krw: amt * 1e8 });
    const pool = [{ tranches: [T(24, 300), T(36, 300)] }, { tranches: [T(36, 700)] }, { tranches: [T(18, 100), T(24, 100)] }];
    const tm = m.tenorMix(pool);
    check('근거: 만기별 발행 비중(상위 2만기 합)', tm.total === 1500e8 && tm.issues === 3 && tm.rows.map((r) => r.k).join() === '1.5년,2년,3년' && tm.top2.map((r) => r.k).join() === '2년,3년' && Math.round(tm.top2Share * 10) === 933, JSON.stringify(tm.top2));
    const md = { asof: '2026-03-04', maturities: [], maturitiesLong: { to: '2031-07-01', rows: [{ dt: '2026-04-08', amount_krw: 250e8 }, { dt: '2026-10-01', amount_krw: 680e8 }, { dt: '2027-03-01', amount_krw: 400e8 }, { dt: '2030-05-01', amount_krw: 500e8 }] } };
    const mb = m.maturityBuckets(md, 3);
    check('근거: 만기분포(올해·내년 반기, 이후 연)', mb.buckets.map((b) => b.label).join() === "'26상,'26하,'27상,'27하,'28,'29,'30" && mb.buckets[0].amount === 250e8 && mb.buckets[2].amount === 400e8, mb.buckets.map((b) => b.label).join());
    check('근거: 만기 공백은 제안 만기 범위 안에서만', mb.gaps.join() === '2028,2029' && m.maturityBuckets(md, 2).gaps.join() === '2028', `${mb.gaps} / ${m.maturityBuckets(md, 2).gaps}`);
    const sz = slides.find((s) => s.id === 'sizing');
    const sizingTexts = sz.prims.filter((p) => p.k === 'text').flatMap((p) => p.paras.map((x) => x.runs.map((r) => r.t).join('')));
    check('장표: 트랜치 검토에 등급 만기 비중·회사 만기분포', sizingTexts.some((t) => /만기별 발행 비중/.test(t)) && sizingTexts.some((t) => /공모사채 만기분포/.test(t)) && sz.prims.some((p) => p.k === 'chart'), sizingTexts.slice(0, 6).join(' | '));
    check('문안: 트랜치 검토에 등급 관행(주력 만기 비중)', tx.sizing.some((l) => /주력 만기/.test(l) && /%/.test(l)), tx.sizing.join(' | '));
  }

  // 4-2. 데이터 사용 현황: 외부/내부, 내부 미연결 → 대체·생략
  {
    const rep = m.dataReport(d, inp, m.available(d, inp));
    const miss = rep.intMissing.map((x) => x.label);
    check('데이터: 외부 출처는 기관 단위로 셈', rep.extSources.includes('DART') && rep.extSources.includes('한국은행 ECOS') && rep.extSources.length <= 10, rep.extSources.join(','));
    check('데이터: 민평·NH 전망표·FnGuide 는 내부 미연결로 남음', ['트랜치별 개별·등급민평, 국고 대비 spread', 'NH 등급별 회사채 금리 전망표', '증권사 리포트 취합(하우스·애널리스트 일괄)'].every((x) => miss.includes(x)), miss.join(' | '));
    check('데이터: 내부 데이터 없는 회사채 금리는 생략으로 기록', rep.omitted.some((o) => o.id === 'credit_fc' && o.kind === 'int'), JSON.stringify(rep.omitted));
    const inp2 = { ...inp, internal: { ...inp.internal, minpyeong: '만기\t개별민평\n2년\t3.898', creditFc: '구분\t1Q\nAA-\t3.1' } };
    const rep2 = m.dataReport(d, inp2, m.available(d, inp2));
    check('데이터: 내부 데이터를 붙이면 연결로 바뀜', !rep2.intMissing.some((x) => /개별·등급민평|등급별 회사채/.test(x.label)) && !rep2.omitted.filter((o) => o.id !== 'issues' && o.id !== 'issuance').length && rep2.intUsed.length >= 2, JSON.stringify(rep2.intUsed));
    const withRep = m.buildSlides(d, { ...inp, items: { ...inp.items, datareport: true } }, tx);
    const dr = withRep.filter((s) => s.id.startsWith('datareport'));
    check('장표: Appendix 데이터 사용 현황(켰을 때만)', dr.length >= 1 && !ids.some((x) => x.startsWith('datareport')) && dr[0].title === 'Appendix 3. 데이터 사용 현황', `${dr.length} ${dr[0]?.title}`);
  }

  // 4-3. 검수: 샘플 덱에서 난 오류 유형
  {
    const dup = m.creditGridIssues(m.parseTsv('구분\t만기\t1Q\t2Q\t3Q\nAA+\t3\t3.70\t3.58\t3.44\nAA0\t3\t3.70\t3.58\t3.44\nA+\t3\t3.54\t3.50\t3.32'));
    check('검수: 등급별 전망표 행 복사(AA+=AA0)', dup.some((x) => /AA\+ 3년와 AA0 3년의 값이 모두 같습니다/.test(x)), dup.join(' | '));
    check('검수: 등급 라벨과 금리 순서 반대(A+ < AA+)', dup.some((x) => /AA\+ 3년 금리가 A\+ 3년보다 높은 칸/.test(x)), dup.join(' | '));
    const ok = m.creditGridIssues(m.parseTsv('구분\t만기\t1Q\t2Q\nAA-\t3\t3.10\t3.05\nA+\t3\t3.54\t3.50\nA0\t3\t3.58\t3.54'));
    check('검수: 정상 전망표는 경고 없음', !ok.length, ok.join(' | '));
    const on = () => true;
    const same = d.peers.slice(0, 3).map((p) => ({ ...p, demand_dt: p.demand_dt, tranches: p.tranches.slice(0, 1).map((t) => ({ ...t, yield_pct: 3.913 })) }));
    const dq = { ...d, peers: [...same, ...d.peers.slice(3)] };
    const q1 = m.qaChecks(dq, { ...inp, peerKeys: same.map((p) => p.key) }, tx, { on, edited: false });
    check('검수: 같은 발행금리가 서로 다른 발행사에서 반복', q1.some((x) => x.item === 'peers' && /3\.913%/.test(x.text)), JSON.stringify(q1));
    const q2 = m.qaChecks({ ...d, policy: { ...d.policy, bok: { ...d.policy.bok, meeting_dt: '2026-08-28' } } }, inp, tx, { on, edited: false });
    check('검수: 금통위 요약이 최근 회의보다 오래됨', q2.some((x) => x.item === 'bok' && /갱신이 필요/.test(x.text)), JSON.stringify(q2.map((x) => x.text)));
    const q3 = m.qaChecks(d, inp, { ...tx, sizing: ['최근 4회 평균 경쟁률 9.87:1'] }, { on, edited: true });
    check('검수: 직접 고친 문안의 데이터에 없는 숫자', q3.some((x) => x.item === 'sizing' && /9\.87/.test(x.text)), JSON.stringify(q3.map((x) => x.text)));
  }

  // 4-4. 피드백 반영: 사례·예정 내역 범위, 오래된 전망표, 문안 숫자, 발행조건 기본값
  {
    const base = d.peers.find((p) => p.ratio != null && p.tranches.length);
    const mk = (key, patch) => ({ ...base, key, ...patch });
    const yesterday = new Date(new Date(`${d.asof}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const extra = [
      mk('reit', { corp_name: '테스트리츠', demand_dt: yesterday }),
      mk('noresult', { corp_name: '결과없음', demand_dt: yesterday, ratio: null, demand_krw: null, tranches: base.tranches.map((t) => ({ ...t, ratio: null, demand_krw: null })) }),
      mk('today', { corp_name: '오늘예측', demand_dt: d.asof }),
    ];
    const d2 = { ...d, peers: [...d.peers, ...extra], pipeline: [...d.pipeline, { ...(d.pipeline[0] ?? { key: 'p', rating: 'AA', demand_dt: d.asof, pay_dt: d.asof, band_type: null, band_low: null, band_high: null, lead: null, nh_lead: false, tranches: [], amount_max_krw: null }), key: 'fin', corp_name: '테스트캐피탈', sub_type: '금융채' }] };
    const keys = m.peerPool(d2, 'group').map((p) => p.key);
    check('사례: 리츠·결과 미공시·오늘 수요예측 제외', !keys.includes('reit') && !keys.includes('noresult') && !keys.includes('today'));
    check('예정 내역: 금융채 제외', !m.pipelineOf(d2).some((p) => p.key === 'fin') && d2.pipeline.some((p) => p.key === 'fin'));
    const def = m.defaultInput(d);
    check('발행조건 기본값: 밴드 개별민평 ±30bp, 등급 비고 확인 필요', def.band.type === 'spread' && def.band.low === -30 && def.band.high === 30 && /확인 필요/.test(def.ratingNote), JSON.stringify(def.band) + def.ratingNote);
    // 공개 전망표 발표 뒤 금통위가 있었으면 표·전망 문장을 뺀다
    const pub = d.forecast?.published_dt ?? '2026-01-01';
    const after = new Date(new Date(`${pub}T00:00:00Z`).getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
    const d3 = { ...d, forecast: d.forecast ?? null, events: [...d.events, { event_dt: after < d.asof ? after : pub, end_dt: null, kind: '금통위', title: '통화정책방향 결정회의', note: null }] };
    if (d.forecast && after < d.asof) {
      check('전망: 오래된 공개 전망표 판정', m.forecastStale(d3));
      const t3 = m.ruleText(d3, inp);
      check('전망: 오래된 전망표 숫자는 문안에서 뺌', !t3.forecast.some((x) => /전망표/.test(x)) && !t3.rates.some((x) => /전망표/.test(x)), [...t3.forecast, ...t3.rates].join(' | '));
      const fs = m.buildSlides(d3, inp, t3).find((x) => x.id === 'forecast');
      check('전망: 오래된 전망표는 표 생략', fs && !fs.prims.some((p) => p.k === 'table'));
      const q4 = m.qaChecks(d3, inp, t3, { on: () => true, edited: false });
      check('전망: 오래된 전망표 검수 경고', q4.some((x) => x.item === 'forecast' && x.level === 'warn'));
    } else check('전망: 오래된 공개 전망표 판정(전망표 없음)', true);
    // '최근 4회' 는 실제 회차 수로
    const t5 = m.ruleText({ ...d, own: d.own.slice(0, 2).map((p) => ({ ...p, increased: true })) }, inp);
    check('문안: 최근 n회는 실제 회차 수', !t5.sizing.some((x) => /최근 4회/.test(x)) && t5.sizing.some((x) => /최근 2회 모두 증액/.test(x)), t5.sizing.join(' | '));
    check('문안: 내부용 안내 문장 없음', ![...tx.pipeline, ...tx.sales].some((x) => /내부 자료로 보완|다시 확인 필요/.test(x)));
    const terms = m.buildSlides(d, inp, tx).find((x) => x.id === 'terms');
    const ttext = JSON.stringify(terms.prims);
    check('발행조건: 대표주관수수료 협의·합계', /대표주관수수료 협의/.test(ttext) && (inp.tranches.length < 2 || /합계/.test(ttext)));
  }

  // 4-5. 목차 템플릿 칩
  {
    check('템플릿: 기본 목차 = 기본', m.templateOf(m.defaultItems()) === 'basic');
    const lite = m.TEMPLATES.find((t) => t.key === 'lite').items();
    check('템플릿: 핵심 요약', m.templateOf(lite) === 'lite' && !lite.bok && lite.terms);
    check('템플릿: 기본·간략 두 가지만', m.TEMPLATES.map((t) => t.key).join() === 'basic,lite');
    check('템플릿: 기본에 Sales 전략, 간략에는 없음', m.defaultItems().sales && !lite.sales);
    check('템플릿: 하나 바꾸면 직접 선택', m.templateOf({ ...m.defaultItems(), events: false }) === null);
  }

  // 4-6. 검토 표시: 기본값 그대로인 조건·판단 문장·대체 데이터, 바꾸면 사라짐
  {
    const sl = m.buildSlides(d, inp, tx);
    const q = m.qaChecks(d, inp, tx, { on: () => true, edited: false });
    const mk = m.reviewMarks(sl, d, inp, tx, q);
    const ti = sl.findIndex((x) => x.id === 'terms');
    const at = (what) => mk.find((x) => x.slide === ti && x.key.startsWith(`terms:${what}:`));
    check('검토: 발행조건 기본값(밴드·납입일·금액)·판단 문장 표시', at('band') && at('pay') && at('amount') && at('lead') && at('rating'), mk.filter((x) => x.slide === ti).map((x) => x.key).join(','));
    check('검토: 표시는 장표 안', mk.every((x) => x.x >= 0 && x.y >= 0 && x.x + x.w <= m.PAGE.w + 4 && x.y + x.h <= m.PAGE.h + 4));
    const b = at('band');
    check('검토: 밴드 표시는 금리 밴드 행 위치', b && b.y > 150 && b.h < 80, JSON.stringify(b));
    check('검토: 민평 미연결 → 트랜치 검토 데이터 표시', mk.some((x) => x.item === 'sizing' && x.kind === 'data'));
    check('검토: 연락처 없음 → 뒷표지 표시', mk.some((x) => x.item === 'back'));
    const inp2 = { ...inp, band: { type: 'spread', low: -20, high: 20 }, pay: '2026-12-15', contacts: '홍길동 02-000-0000' };
    const tx2 = m.ruleText(d, inp2);
    const sl2 = m.buildSlides(d, inp2, tx2);
    const mk2 = m.reviewMarks(sl2, d, inp2, tx2, m.qaChecks(d, inp2, tx2, { on: () => true, edited: false }));
    check('검토: 값을 정하면 표시 사라짐', !mk2.some((x) => /^terms:(band|pay):/.test(x.key)) && !mk2.some((x) => x.item === 'back'));
    check('검토: 내보내기 장표에는 표시 없음', !sl.some((x) => x.prims.some((p) => p.k === 'mark')));
  }

  // 4-7. 로직 정리(2026-10-27 생성본 점검): 조사, 판단 문장 정합, 발행 시기 규칙, 증액 한도, 비교군, Sales 사실 묶음
  {
    check('규칙: 인상 시점 파싱', JSON.stringify(m.hikeMonths('10월 동결·12월 인상')) === '[12]' && JSON.stringify(m.hikeMonths('11월·내년 2월 인상')) === '[11,2]' && !m.hikeMonths('연내 동결').length);
    check('문안: 발행 시기 조사(초를)', !/초을|중순를|말를/.test(tx.lead.replace(/\*/g, '')) && /(초를|중순을|말을)/.test(tx.lead.replace(/\*/g, '')), tx.lead);
    check('문안: 판단 문장이 제안과 모순되지 않음', !tx.sizing.some((x) => /차환 부담이 가장 적다고 판단/.test(x)));
    const plan = m.payPlan(d);
    check('일정: 기본 납입일은 연말(12/15~12/31)을 피함', plan.pay.slice(5) < '12-15' || plan.pay.slice(5, 7) !== '12', plan.pay);
    const T = (tenor, init, amt) => ({ tenor, months: 36, initial_krw: init * 1e8, amount_krw: amt * 1e8 });
    const own = [{ ...d.own[0], initial_krw: 1500e8, amount_krw: 2200e8, series: '26' }, { ...d.own[0], initial_krw: 2000e8, amount_krw: 2450e8, series: '29' }];
    const mp = m.maxPlan({ ...d, own }, 2000);
    check('증액 한도: 최근 최대 증액 배율 × 신고금액(100억 올림)', mp.max === 3000 && mp.from.series === '26', JSON.stringify(mp));
    const flagged = { ...d.peers[0], key: 'flag-x', corp_code: 'X1', corp_name: '보증회사', flag: '보증·담보부 추정' };
    const d4 = { ...d, peers: [...d.peers, flagged] };
    check('비교군: 보증·담보부 추정·공기업 제외', !m.peerPool(d4, 'group').some((p) => p.key === 'flag-x') && m.excludedPeers(d4).some((p) => p.key === 'flag-x'));
    const sf = m.salesFacts(d, inp);
    check('Sales AI: 공개 수요예측 사실만(리그테이블·내부 데이터 없음)', sf.투자자구분참여 && !('리그테이블' in sf) && !JSON.stringify(sf).includes('internal'), Object.keys(sf).join(','));
    const cc = m.comboCounts(m.peerPool(d, inp.peerScope));
    check('구조 통계는 같은 범위(사례 풀)에서', cc.reduce((a, b) => a + b.issues, 0) === m.peerPool(d, inp.peerScope).length);
  }

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

// 6. Ⅱ부 = DM(A급 회사채 시장동향) 판 그대로: 문구·차트·표를 판에서, 고객 등급 쪽만 맞춤
{
  const d0 = JSON.parse(readFileSync(join(root, 'tests/fixtures/deck_eland.json'), 'utf8'));
  const ed = m.dmFor('2026-10-27');
  check('DM 판: 기준일 이전 가장 최근 판', ed?.edition === '2026-10-27' && m.dmFor('2026-10-26') === null && ed.title === 'A급 회사채 시장동향');
  const aplus = { ...d0, asof: '2026-10-27', company: { ...d0.company, rating: 'A+', rating_group: 'A' }, dm: m.dmView(ed), policy: { bok: null, fomc: null } };
  const inp = m.defaultInput(aplus);
  const tx = m.ruleText(aplus, inp);
  const txt = (p) => (p.paras ?? []).map((x) => x.runs.map((r) => r.t).join('')).join('\n');
  const slidesOf = (dd, items = {}) => m.buildSlides(dd, { ...inp, items: { ...inp.items, ...items } }, m.ruleText(dd, inp));
  const sl = slidesOf(aplus);
  const ids = sl.map((s) => s.id);
  check('DM 판: 기본 Ⅱ부 = 금리 동향·금통위·FOMC·전망 4장·발행 규모·수요예측 결과·예정 내역 + Appendix', ['rates', 'bok', 'fomc', 'forecast', 'views', 'usviews', 'issuance', 'peers-0', 'pipeline', 'maturity', 'events'].every((x, i, a) => ids.indexOf(x) >= 0 && (!i || ids.indexOf(x) > ids.indexOf(a[i - 1]))) && !ids.some((x) => /^issues|^liquidity/.test(x)), ids.join(','));
  check('DM 문구: 금리 동향·금통위·FOMC·증권사 전망 문구는 판 그대로', tx.rates.join() === ed.pages.rates.join() && tx.fomc.join() === ed.pages.fomc.join() && tx.usviews.join() === ed.pages.usviews.join() && tx.bok.join() === ed.pages.bok.join());
  const rates = sl.find((s) => s.id === 'rates');
  const rc = rates.prims.filter((p) => p.k === 'chart');
  const heads = rates.prims.filter((p) => p.k === 'text' && p.paras.some((x) => x.bullet)).flatMap((p) => p.paras.filter((x) => !x.bullet).map((x) => x.runs.map((r) => r.t).join('')));
  check('DM 금리 동향: [국고금리]·[크레딧 스프레드] 소제목 + 차트 2개(날짜 축)', heads.join() === '[국고금리],[크레딧 스프레드]' && rc.length === 2 && rc.every((c) => c.chart.kind === 'line' && c.chart.ticks?.length >= 4) && rc[1].chart.series[0].name.includes('AA-'), `${heads.join()} ${rc.length}`);
  const bok = sl.find((s) => s.id === 'bok');
  const bc = bok.prims.filter((p) => p.k === 'chart').map((p) => p.chart.kind);
  check('DM 금통위: 쪽 제목 연·월 + 핵심 포인트 ✓ 3개 + 차트 3개(막대 2·선 1)', bok.title.endsWith('② 2026년 10월 금통위') && bc.join() === 'cols,cols,line' && bok.prims.some((p) => p.k === 'text' && p.paras.filter((x) => x.runs[0]?.t === '✓ ').length === 3), `${bok.title} ${bc.join()}`);
  const fomc = sl.find((s) => s.id === 'fomc');
  check('DM FOMC: 2026년 9월 FOMC, SEP·점도표·국채 2년', fomc.title.endsWith('③ 2026년 9월 FOMC') && fomc.prims.filter((p) => p.k === 'chart').length === 3, fomc.title);
  const newer = { ...aplus, policy: { bok: { kind: '금통위', meeting_dt: '2026-11-26', title: '11월', decision: '인상', vote: null, points: [{ label: '결정', text: '인상' }], sources: [], panels: [] }, fomc: null } };
  check('DM 금통위: DB 에 판보다 새 회의가 있으면 DB 장표', !slidesOf(newer).find((s) => s.id === 'bok').title.includes('10월 금통위'));
  const fc = sl.find((s) => s.id === 'forecast');
  const ft = fc.prims.find((p) => p.k === 'table');
  check('DM 금리 전망: 기준금리 경로·한미 국고채 표(구분·만기·8분기)', ft && ft.colW.length === 10 && ft.rows.length === 2 + ed.forecastTable.rows.length && txt(ft.rows[2][0]) === '한국 기준금리', `${ft?.colW.length} ${ft?.rows.length}`);
  const is = sl.find((s) => s.id === 'issuance');
  const it = is.prims.find((p) => p.k === 'table');
  const hi = it.rows.slice(2).filter((r) => r.some((c) => c?.fill === 'FFF2CC')).map((r) => txt(r[0]));
  check('DM 발행 규모: 등급 8줄 × 월 + 누적, 고객 등급(A+) 줄 강조', it.rows.length === 10 && hi.join() === 'A+ 등급' && it.colW.length === 1 + ed.issuance.months.length + 3, hi.join());
  const bbb = { ...aplus, company: { ...aplus.company, rating: 'BBB0', rating_group: 'BBB' } };
  const ib = slidesOf(bbb).find((s) => s.id === 'issuance').prims.find((p) => p.k === 'table');
  check('DM 발행 규모: BBB 고객은 BBB 등급 계 줄 강조', ib.rows.slice(2).filter((r) => r.some((c) => c?.fill === 'FFF2CC')).map((r) => txt(r[0])).join() === 'BBB 등급 계');
  const on = slidesOf(aplus, { issues: true, liquidity: true });
  const iss = on.filter((s) => s.id.startsWith('issues'));
  const lq = on.find((s) => s.id === 'liquidity');
  check('DM 주요 이슈: 켜면 2쪽, 차트 4개(유가·아파트값·KOSPI·환율)', iss.length === 2 && iss.flatMap((s) => s.prims.filter((p) => p.k === 'chart')).length === 4 && iss[1].title.endsWith('(계속)'), `${iss.length}`);
  check('DM 시장 유동성: 켜면 글상자 + 표 2개', lq && lq.prims.filter((p) => p.k === 'table').length === 2 && lq.title.includes('3. 발행시장 동향_② 시장 유동성'), lq?.title);
  // 모든 DM 장표가 페이지 안, 글상자 넘침 없음
  const out = [];
  const over = [];
  for (const s of on) {
    for (const p of [...s.chrome, ...s.prims]) {
      const box = p.k === 'line' ? { x: Math.min(p.x1, p.x2), y: Math.min(p.y1, p.y2), w: Math.abs(p.x2 - p.x1), h: Math.abs(p.y2 - p.y1) }
        : p.k === 'table' ? (() => { const c = m.cellBoxes(p); return { x: p.x, y: p.y, w: c.w, h: c.h }; })() : p;
      if (box.x < -0.5 || box.y < -0.5 || box.x + box.w > m.PAGE.w + 0.5 || box.y + box.h > m.PAGE.h + 0.5) out.push(`${s.id}:${p.k}`);
      if (p.k === 'text' && p.paras.some((x) => x.bullet)) {
        const h = m.textHeight(p.paras, p.w - (p.pad ?? 4) * 2, p.size, false, p.line ?? 1.32, m.BULLET_INDENT(p.size));
        if (h > p.h - (p.pad ?? 4) * 2 + 0.5) over.push(`${s.id} ${h.toFixed(0)}>${p.h}`);
      }
      // 표 칸 글이 칸을 넘지 않음(한 줄 높이 기준)
    }
  }
  check('DM 장표: 모든 요소가 페이지 안', !out.length, out.join(' '));
  check('DM 장표: 글상자 넘침 없음', !over.length, over.join(' '));
  // 차트 도형: 선은 축 안, 막대 합계 숫자
  const g = m.lineGeom(rc[0].chart, rc[0].w, rc[0].h);
  check('차트: 선 도형이 차트 상자 안', g.paths.every((p) => p.pts.every(([x, y]) => x >= 0 && x <= rc[0].w + 0.5 && y >= 0 && y <= rc[0].h)), '');
  const mc = sl.find((s) => s.id === 'maturity').prims.find((p) => p.k === 'chart');
  const cg = m.colsGeom(mc.chart, mc.w, mc.h);
  check('차트: 쌓은 막대 위 합계 숫자', cg.texts.some((t) => /^\d{1,3}(,\d{3})+$/.test(t.t)) && cg.rects.length > 10, `${cg.rects.length}`);
  const dtk = m.dateTicks(['2025-12-30', '2025-12-31', '2026-01-02', '2026-02-02', '2026-03-03', '2026-04-01']);
  check('차트: 날짜 축 이름(달 바뀌는 칸, yy/mm)', dtk.ticks.includes(2) && dtk.cats[2] === '26/01', JSON.stringify(dtk.ticks));
  const rep = m.dataReport(aplus, inp, m.available(aplus, inp));
  check('데이터: DM 판 장표는 판 이름·기준일로 기록', rep.items.find((x) => x.id === 'issuance')?.srcs.some((x) => x.asof === '2026-10-27' && /A급 회사채 시장동향/.test(x.label)), JSON.stringify(rep.items.find((x) => x.id === 'issuance')));
}

// 7. LS전선 제34회 생성본 검토(2026-10-28): 원자료 점검, 사업회사 비교군, 예정 내역 등급군, 발행 시기 1안/2안, 차환 수요, Sales 근거, NH 주관 이력
{
  const d0 = JSON.parse(readFileSync(join(root, 'tests/fixtures/deck_ls.json'), 'utf8'));
  const d = { ...d0, dm: m.dmView(m.dmFor('2026-10-27')) };
  const inp = m.defaultInput(d);
  const tx = m.ruleText(d, inp);
  const lotte = d.peers.find((p) => p.corp_name === '롯데물산');
  check('원자료: 참여금액 단위 오류(210배) 의심', /210배/.test(m.suspectOf(lotte) ?? ''), m.suspectOf(lotte));
  const pool = m.peerPool(d, inp.peerScope);
  check('원자료: 의심 건은 같은 등급 통계에서 제외', !pool.some((p) => p.corp_name === '롯데물산'));
  check('비교군: 사업회사는 금융회사 제외', !pool.some((p) => m.isFinancial(p.corp_name)) && m.isFinancial('하나에프앤아이') && m.isFinancial('JB금융지주') && m.isFinancial('롯데오토리스') && !m.isFinancial('LS전선') && !m.isFinancial('롯데렌탈'));
  const hana = d.peers.find((p) => p.key === '00170442:192:2026-08-04');
  check('원자료: 트랜치마다 같은 경쟁률이면 참여÷신고로 계산', m.trRatio(hana.tranches[1]) === 1.31 && m.trRatio(hana.tranches[2]) === 10.1, `${m.trRatio(hana.tranches[1])}/${m.trRatio(hana.tranches[2])}`);
  check('원자료: 회차 합계와 안 맞는 투자자 구분은 제외', !m.typedOk(hana) && m.typedOk(d.own[0]));
  check('검수: 의심 건 사유 표시', m.qaChecks(d, inp, tx, { on: () => true, edited: false }).some((q) => /롯데물산.*210배.*뺐습니다/.test(q.text)));
  check('예정 내역: AA- 는 A 등급군이 아님', !tx.pipeline.some((x) => /같은 등급군\(A\).*(삼양홀딩스|케이씨씨)/.test(x)) && tx.pipeline.some((x) => /롯데렌탈\(A\+\)/.test(x)), tx.pipeline.join(' / '));
  check('예정 내역: 제안일 전후 예정이 없으면 그렇게 적음', tx.pipeline.some((x) => /전후 3주 안에 잡힌 예정 건은 아직 없음/.test(x)));
  const sf = m.salesFacts(d, inp);
  check('Sales 사실: 경쟁 발행은 제안일 전후 3주만', sf.제안일전후3주_수요예측예정 === '없음' && !('수요예측예정' in sf), JSON.stringify(sf.제안일전후3주_수요예측예정));
  check('Sales 사실: 같은 등급 대비 비중 차이·만기별 구성', Array.isArray(sf.같은등급대비_비중차이) && sf.회사_만기별투자자구성.length === 2);
  // 사업회사·점검 통과 건 기준: LS전선은 운용사·연기금 비중이 같은 등급보다 높다(롯데물산 오류가 섞이면 반대로 보임)
  check('Sales: 강점(기관 수요) 먼저, 약한 군은 확대', tx.sales.some((x) => /운용사\(집합\) \+\d+%p.*기관 수요 기반/.test(x)) && tx.sales.some((x) => /증권사\(투자매매중개\) 참여 비중은 같은 등급보다 \d+%p 낮음/.test(x)), tx.sales.join(' / '));
  check('Sales: 만기·투자자 통념 연결 없음', !tx.sales.some((x) => /3년.*연기금·은행·보험 대상|장기물은 보험/.test(x)));
  check('프롬프트 v5: 통념·먼 예정 건 금지', m.DECK_PROMPT_VERSION === 5 && /통념 금지/.test(m.DECK_SYSTEM) && /제안일전후3주_수요예측예정/.test(m.DECK_SYSTEM));
  // 발행 시기: 1안(규칙: 1/28 만기 2주 전) vs 2안(최근 3회 중 2회 2월 납입)
  const t = m.timingPlan(d, { peerScope: inp.peerScope, band: 'spread', pay: null });
  check('시기: 1안/2안', t.opts.length === 2 && t.opts[0].sch.pay === '2027-01-14' && t.opts[1].kind === 'habit' && t.opts[1].sch.pay.startsWith('2027-02'), t.opts.map((o) => `${o.key}:${o.kind}:${o.sch.pay}`).join(','));
  check('시기: 1안은 1~2월 만기 1,200억원 전액 선조달, 2안은 900억원 먼저 상환', t.opts[0].covered.length === 3 && !t.opts[0].before.length && t.opts[1].before.reduce((a, x) => a + x.amount, 0) === 9e10);
  check('시기: 권고안이 기본 납입일', t.rec === 0 && inp.pay === t.opts[t.rec].sch.pay);
  {
    const t2 = m.timingPlan(d, { peerScope: inp.peerScope, band: 'spread', pay: t.opts[1].sch.pay });
    const t3 = m.timingPlan(d, { peerScope: inp.peerScope, band: 'spread', pay: '2027-01-21' });
    check('시기: 담당자가 고른 납입일이 권고(Term-sheet 와 일치)', t2.opts.length === 2 && t2.rec === 1 && t3.opts[0].kind === 'input' && t3.rec === 0 && t3.opts[0].sch.pay === '2027-01-21', `${t2.rec}/${t3.opts.map((o) => o.kind).join(',')}/${t3.rec}`);
  }
  check('시기: 리서치 기준금리 경로 반영', /3\.50%/.test(t.path ?? ''), t.path);
  check('시기: 문안에 권고·대안 장단점', /1안.*권고/.test(tx.timing[0]) && tx.timing.some((x) => /^2안.*2월 정례 발행.*먼저 상환/.test(x)), tx.timing.join(' / '));
  const sl = m.buildSlides(d, inp, tx);
  const ts = sl.find((x) => x.id === 'timing');
  check('시기 장표: 타임라인·비교표', ts && ts.prims.filter((p) => p.k === 'table').length === 2);
  // 차환 수요·가산금리 목표
  check('트랜치: 차환 수요와 증액', tx.sizing.some((x) => /1,200억원.*증액 시 차환 재원 전액 확보/.test(x)), tx.sizing.join(' / '));
  check('트랜치: 확정 가산금리 비교(회사 vs 같은 등급)', tx.sizing.some((x) => /최근 4회 평균 -\d+bp.*vs 최근 3개월 A\+등급 2년/.test(x)));
  const sz = sl.find((x) => x.id === 'sizing');
  check('트랜치 장표: AA- 금리 대신 확정 가산금리 비교표', JSON.stringify(sz.prims).includes('확정 가산금리 비교') && !JSON.stringify(sz.prims).includes('회사채 3년 AA-'));
  check('트랜치 장표: NH 주관 회차 표시', JSON.stringify(sz.prims).includes('NH 주관'));
  // NH 주관 이력(재선임 제안)
  check('NH: 제31·30회 주관 이력과 재참여', /제31·30회 대표주관사.*10\.13:1·15\.77:1.*대표주관 재참여/.test(tx.nhTrack ?? ''), tx.nhTrack);
  check('NH: 직전 회차 비주관이면 NH 강점 1장', inp.items.strength && !inp.items.nh_company && sl.some((x) => x.id === 'strength'));
  check('NH: 템플릿 고정 장표 켜면 오래된 수치 경고', m.qaChecks(d, { ...inp, items: { ...inp.items, nh_company: true } }, tx, { on: (id) => id === 'nh_company', edited: false }).some((q) => /FY2024/.test(q.text)));
  // 규칙 문안 숫자는 사실 묶음 안
  const allowed = m.allowedNumbers(m.factsFor(d, inp), d);
  const bad = [...tx.sizing, ...tx.timing, ...tx.sales, ...tx.pipeline, tx.nhTrack ?? ''].filter((l) => !m.lineOk(l, allowed, true).ok);
  check('LS 문안: 자체 검증 통과', !bad.length, bad.join(' / '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

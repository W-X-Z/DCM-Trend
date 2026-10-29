// 홈 영업 추천 규칙 테스트 (web/lib/reco.ts 를 esbuild 로 묶어 불러온다)
// 실행: node tests/reco.mjs
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  stdin: { contents: `export * from './lib/reco';`, resolveDir: join(root, 'web'), loader: 'ts' },
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

const today = '2026-10-29';
const mat = (corp, dt, amt, extra = {}) => ({
  deal_key: `${corp}-${dt}`, product_type: 'bond', product_label: '회사채', sub_type: '일반회사채', corp_code: corp, corp_name: corp,
  market: '유가증권', series: '1', is_public: true, event_type: '만기', event_dt: dt, days_left: 0, issue_dt: null, maturity_dt: dt,
  amount_krw: amt, tenor_months: 36, coupon_pct: null, yield_pct: null, ytm_pct: null, rating: 'AA-', rating_group: 'AA',
  lead_managers: null, nh_involved: false, nh_lead: false, dart_url: null, refi_signal: false, ...extra,
});
const iss = (corp, dt, leads, nh_lead, nh_involved = nh_lead, rating = null, rating_group = null) => ({ corp_code: corp, deal_dt: dt, lead_managers: leads, nh_lead, nh_involved, rating, rating_group });

const mats = [
  mat('BIG', '2027-01-20', 5e11, { nh_lead: true, nh_involved: true }),
  mat('SMALL', '2027-01-20', 3e10),
  mat('SOON', '2026-11-10', 5e11),
  mat('FIN', '2027-01-20', 3e11, { sub_type: '금융채' }),
  mat('PAST', '2026-10-01', 3e11),
  mat('FAR', '2027-06-30', 3e11),
  mat('REFI', '2027-01-05', 1e11, { refi_signal: true }),
  mat('NORATE', '2027-01-20', 3e11, { rating: null, rating_group: null }),
  mat('OLDRATE', '2027-01-20', 3e11, { rating: 'A+', rating_group: 'A' }),
];
const hist = [
  iss('BIG', '2025-01-10', 'KB증권, NH투자증권', true, true, 'AA-', 'AA'), iss('BIG', '2024-01-10', 'KB증권', false),
  iss('SMALL', '2025-01-10', 'KB증권, 한국투자증권', false),
  iss('BIG', '2027-01-01', 'NH투자증권', true), // 오늘 뒤 날짜는 무시
  iss('OLDRATE', '2025-06-10', '삼성증권', false, false, 'BBB+', 'BBB'), iss('OLDRATE', '2022-06-10', '삼성증권', false, false, 'A0', 'A'),
];
// 홈에서는 만기일정 구간(오늘 ~ 12개월)으로 먼저 거른 만기를 넘긴다
const [a6, b6] = m.periodRange(today, '6m');
const end = m.windowEnd(today);
const r = m.buildReco(mats.filter((x) => x.event_dt < end), hist, today);
const by = Object.fromEntries(r.map((x) => [x.corp_code, x]));

eq('금융채·지난 만기 제외', ['FIN', 'PAST'].map((c) => c in by), [false, false]);
eq('만기일정 구간: 3~6개월 = 오늘+3개월 ~ 오늘+6개월', [a6, b6, end], ['2027-01-29', '2027-04-29', '2027-10-29']);
eq('월말 보정', [m.addMonths('2026-08-31', 6), m.addMonths('2026-10-31', 4)], ['2027-02-28', '2027-02-28']);
eq('1~3개월 구간에 든 회사', m.buildReco(mats.filter((x) => x.event_dt >= m.periodRange(today, '3m')[0] && x.event_dt < m.periodRange(today, '3m')[1]), hist, today).map((x) => x.corp_code), ['REFI', 'BIG', 'OLDRATE', 'NORATE', 'SMALL']);
eq('6~12개월 구간', m.buildReco(mats.filter((x) => x.event_dt >= m.periodRange(today, '12m')[0] && x.event_dt < end), hist, today).map((x) => x.corp_code), ['FAR']);
eq('NH주관: 만기 회차 기준', [by.BIG.nh_mat, by.SOON.nh_mat], [true, false]);
eq('상장시장 묶음', ['유가증권', '코스닥', '코넥스', '기타', null].map((x) => m.marketOf(x)), ['kospi', 'kosdaq', 'konex', 'private', 'private']);
eq('직전 회차 주관사', by.SMALL.last_leads, ['KB증권', '한국투자증권']);
eq('이력 건수(오늘 뒤 제외)', by.BIG.issues, 2);
eq('NH 대표 횟수', [by.BIG.nh_lead_n, by.SMALL.nh_lead_n], [1, 0]);
eq('주관 빈도 상위', by.BIG.top_leads.map((x) => x.firm), ['KB증권', 'NH투자증권']);
eq('금액이 크면 점수 높음', by.BIG.score > by.SMALL.score, true);
eq('D-12 는 제안 적기보다 낮음', by.SOON.score < by.BIG.score, true);
eq('남은 일수', by.SOON.days_left, 12);
eq('만기 가까운 순, 같은 날은 금액 큰 순, 그다음 점수', r.map((x) => x.corp_code), ['SOON', 'REFI', 'BIG', 'OLDRATE', 'NORATE', 'SMALL', 'FAR']);
eq('차환 신호', by.REFI.refi, true);
eq('등급: 최근 공모채 우선', [by.BIG.grade, by.OLDRATE.grade, by.OLDRATE.rating], ['AA', 'BBB', 'BBB+']);
eq('등급: 이력 없으면 만기 회차, 둘 다 없으면 없음', [by.SMALL.grade, by.NORATE.grade], ['AA', null]);
eq('등급 묶음', ['AAA', 'AA0', 'A-', 'BBB+', 'BB', '', null].map((x) => m.gradeOf(x)), ['AAA', 'AA', 'A', 'BBB', 'BBB', null, null]);
eq('금액 점수 범위', [m.amountFit(1e10), m.amountFit(5e11), m.amountFit(1e13)], [0, 1, 1]);

console.log(`reco: ${pass} passed${process.exitCode ? ', some failed' : ''}`);

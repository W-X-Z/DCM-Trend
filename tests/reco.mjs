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
const iss = (corp, dt, leads, nh_lead, nh_involved = nh_lead) => ({ corp_code: corp, deal_dt: dt, lead_managers: leads, nh_lead, nh_involved });

const mats = [
  mat('KEEP', '2027-01-20', 3e11),
  mat('WIN', '2027-01-20', 3e11),
  mat('CO', '2027-01-20', 3e11),
  mat('NEW', '2027-01-20', 3e11),
  mat('SOON', '2026-11-10', 3e11),
  mat('FIN', '2027-01-20', 3e11, { sub_type: '금융채' }),
  mat('PAST', '2026-10-01', 3e11),
  mat('FAR', '2027-06-30', 3e11),
  mat('REFI', '2027-01-05', 1e11, { refi_signal: true }),
];
const hist = [
  iss('KEEP', '2025-01-10', 'KB증권, NH투자증권', true), iss('KEEP', '2024-01-10', 'KB증권', false),
  iss('WIN', '2025-01-10', 'KB증권, 한국투자증권', false), iss('WIN', '2023-01-10', 'NH투자증권', true),
  iss('CO', '2025-01-10', 'KB증권', false, true),
  iss('NEW', '2025-01-10', 'KB증권', false),
  iss('KEEP', '2027-01-01', 'NH투자증권', true), // 오늘 뒤 날짜는 무시
];
const r = m.buildReco(mats, hist, today);
const by = Object.fromEntries(r.map((x) => [x.corp_code, x]));

eq('금융채·지난 만기·구간 밖 제외', ['FIN', 'PAST', 'FAR'].map((c) => c in by), [false, false, false]);
eq('관계 구분', ['KEEP', 'WIN', 'CO', 'NEW'].map((c) => by[c].rel), ['keep', 'win', 'co', 'new']);
eq('직전 회차 주관사', by.WIN.last_leads, ['KB증권', '한국투자증권']);
eq('이력 건수(오늘 뒤 제외)', by.KEEP.issues, 2);
eq('주관 빈도 상위', by.KEEP.top_leads.map((x) => x.firm), ['KB증권', 'NH투자증권']);
eq('관계 점수 순서', by.KEEP.score > by.WIN.score && by.WIN.score > by.CO.score && by.CO.score > by.NEW.score, true);
eq('D-12 는 제안 적기보다 낮음', by.SOON.score < by.KEEP.score, true);
eq('남은 일수', by.SOON.days_left, 12);
eq('차환 신호', by.REFI.refi, true);
eq('금액 점수 범위', [m.amountFit(1e10), m.amountFit(5e11), m.amountFit(1e13)], [0, 1, 1]);

console.log(`reco: ${pass} passed${process.exitCode ? ', some failed' : ''}`);

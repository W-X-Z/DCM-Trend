// 눈여겨볼 회사: 후보 형식, AI 항목 검증(후보 밖 회사·숫자 차단), 규칙 선택
// 후보는 2026-10-15 실데이터(public.ingest_signal_candidates) 일부
// 실행: npm run test:issues
import { readableCandidates, validateItem, pickFromModel, ruleSelect, formatFact, balance } from '../ingest/lib/issues.mjs';

const raw = [
  { kind: 'touchpoint', facts: { 등급: 'AA0', '만기 금액': 1300000000000, '만기 회차 수': 2, 'NH 대표주관 이력': true, '가장 빠른 만기일': '2027-02-14' }, label: '3~6개월 뒤 공모채 만기, 차환 신고서 아직 없음', context: { 시장: '유가증권', '공모채 발행 이력(건)': 15, '최근 회사채 등급': 'AA0', 'NH 대표주관 이력': true }, event_dt: '2027-02-14', priority: 10, rcept_no: null, corp_code: '01515323', corp_name: 'LG에너지솔루션', signal_key: 'refi_due' },
  { kind: 'touchpoint', facts: { 등급: 'AA0', '만기 금액': 690000000000, '만기 회차 수': 3, 'NH 대표주관 이력': true, '가장 빠른 만기일': '2027-01-22' }, label: '3~6개월 뒤 공모채 만기, 차환 신고서 아직 없음', context: { 시장: '유가증권', '공모채 발행 이력(건)': 40 }, event_dt: '2027-01-22', priority: 10, rcept_no: null, corp_code: '00145880', corp_name: '현대제철', signal_key: 'refi_due' },
  { kind: 'touchpoint', facts: { '보고서 기준일': '2026-06-30', '사모 회사채 1년 내': 169000000000, '1년 내 만기 차입 합계': 169000000000 }, label: '공모채 이력 없이 1년 내 단기 차입이 큰 회사', context: { 시장: '유가증권', '공모채 발행 이력(건)': 0 }, event_dt: '2026-06-30', priority: 20, rcept_no: null, corp_code: '00508344', corp_name: 'SK디앤디', signal_key: 'cp_reliant' },
  { kind: 'touchpoint', facts: { 공시: '유형자산양수결정', 공시일: '2026-10-15', '같은 종류 공시 수': 1 }, label: '투자·인수 결정 공시', context: { 시장: '코스닥', '공모채 발행 이력(건)': 0 }, event_dt: '2026-10-15', priority: 30, rcept_no: '20261015000403', corp_code: '00611736', corp_name: '엑시콘', signal_key: 'invest' },
  { kind: 'touchpoint', facts: { 건수: 1, 종류: 'EB', '풋 대상 금액': 265000000000, '가장 빠른 풋 시작일': '2026-11-11' }, label: '6개월 안에 메자닌 조기상환청구(풋) 시작', context: { 시장: '유가증권', '최근 회사채 등급': 'AA-' }, event_dt: '2026-11-11', priority: 40, rcept_no: null, corp_code: '01205709', corp_name: 'HD현대', signal_key: 'put_due' },
  { kind: 'issue', facts: { 방식: '제3자배정', 금액: 405000000000, '신주 비율(%)': 42.21, 결정일: '2026-09-30' }, label: '신주 비율 30% 이상 유상증자', context: { 시장: '코스닥' }, event_dt: '2026-09-30', priority: 55, rcept_no: '20260930000569', corp_code: '00106119', corp_name: '금양', signal_key: 'big_dilution' },
];
const cands = readableCandidates(raw);

const model = {
  items: [
    { id: 'c1', title: '1.3조원 공모채 만기 도래', why: '2027.02.14부터 공모 회사채 1.3조원 만기가 돌아오고 차환 신고서는 아직 없다.', angle: '차환 시기와 규모 확인' },
    { id: 'c3', title: '공모채 없이 사모채 의존', why: '1년 안에 만기가 돌아오는 사모 회사채가 1,690억원이다.', angle: '첫 공모채 발행 가능성 점검' },
    { id: 'c4', title: '유형자산 양수', why: '2026.10.15 유형자산 양수 결정 공시를 냈고 금액은 500억원이다.', angle: '재원 조달 계획 확인' },   // 500억원은 후보에 없음 → 버림
    { id: 'c9', title: '없는 후보', why: '...', angle: '...' },                                                                   // 후보 밖 → 버림
    { id: 'c2', title: '공모채 만기 도래', why: '2027.01.22부터 6,900억원 만기가 돌아온다.', angle: '차환 수요가 늘어날 것으로 보인다.' }, // 전망 표현 → 버림
    { id: 'c1', title: '중복', why: '공모 회사채 1.3조원 만기.', angle: '확인' },                                                    // 같은 회사 두 번 → 한 번만
  ],
};
const picked = pickFromModel(model, cands);
// AI 가 같은 신호(만기)만 셋 고른 경우 → 신호별 2곳까지, 이슈 후보(금양)는 최소 1곳 들어가고 6곳까지 규칙으로 채움
const sameSignal = pickFromModel({ items: [
  { id: 'c1', title: '공모채 만기 도래', why: '2027.02.14부터 공모채 1.3조원 만기가 돌아온다.', angle: '차환 시기 확인' },
  { id: 'c2', title: '공모채 만기 도래', why: '2027.01.22부터 공모채 6,900억원 만기가 돌아온다.', angle: '차환 시기 확인' },
  { id: 'c3', title: '단기 차입 의존', why: '1년 내 만기 차입이 1,690억원이다.', angle: '첫 공모채 점검' },
] }, cands).items;
const balanced = balance(sameSignal, cands);
const rule = ruleSelect(cands, 4);

const checks = [
  ['금액 형식', formatFact('만기 금액', 1300000000000), '1.3조원'],
  ['날짜 형식', formatFact('가장 빠른 만기일', '2027-02-14'), '2027.02.14'],
  ['불리언 형식', formatFact('NH 대표주관 이력', true), '예'],
  ['후보 id·구분', [cands[0].id, cands[0].구분, cands[5].구분], ['c1', '접점', '이슈']],
  ['정상 항목 통과', validateItem(model.items[0], cands[0]).ok, true],
  ['후보에 없는 숫자 차단', validateItem(model.items[2], cands[3]).ok, false],
  ['AI 선택: 유효 2곳만 (숫자·후보 밖·전망·중복 제거)', picked.items.map((i) => i.corp_name), ['LG에너지솔루션', 'SK디앤디']],
  ['AI 선택: 버린 이유 기록', picked.rejected.map((r) => r.why.split(' ')[0]), ['numbers', 'unknown', 'banned']],
  ['AI 항목에 원래 신호·공시 연결', [picked.items[0].signal_key, picked.items[0].event_dt], ['refi_due', '2027-02-14']],
  ['규칙 선택: 신호를 돌아가며, 같은 회사 한 번', rule.map((i) => i.signal_key), ['refi_due', 'cp_reliant', 'invest', 'put_due']],
  ['규칙 문장', rule[0].why, '2027.02.14부터 공모 회사채 1.3조원 만기가 돌아오고, 차환 신고서는 아직 없다.'],
  ['균형: 신호별 2곳까지·이슈 포함·6곳', [balanced.length, balanced.filter((i) => i.signal_key === 'refi_due').length, balanced.some((i) => i.kind === 'issue')], [6, 2, true]],
  ['균형: AI 가 고른 순서 유지', balanced.slice(0, 3).map((i) => i.corp_name), ['LG에너지솔루션', '현대제철', 'SK디앤디']],
  ['규칙 문장도 검증 통과', rule.every((it, i) => validateItem(it, cands.find((c) => c._raw.corp_code === it.corp_code)).ok), true],
];

let failed = 0;
for (const [name, actual, expected] of checks) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);

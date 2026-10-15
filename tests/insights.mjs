// 인사이트 요약: 숫자 형식, 검증(새 숫자·전망 표현 차단), 규칙 문장
// 실행: npm run test:insights
import { toReadable, validate, ruleSummary, formatChange, topDealFacts } from '../ingest/lib/insights.mjs';

const facts = [
  { scope: 'bond', fact_key: 'bond_amount', label_ko: '회사채 발행금액', unit: 'krw', value_now: 12345000000000, value_base: 10450000000000,
    change: 18.13, period_now: '26.07~26.09', period_base: '25.07~25.09', score: 1.81, is_notable: true },
  { scope: 'bond', fact_key: 'bond_long_share', label_ko: '5년 이상 장기물 비중', unit: 'pct', value_now: 21.4, value_base: 14.2,
    change: 7.2, period_now: '26.07~26.09', period_base: '직전 12개월', score: 1.44, is_notable: true },
  { scope: 'bond', fact_key: 'bond_fee_bp', label_ko: '회사채 인수수수료율', unit: 'bp', value_now: 18.4, value_base: 19.1,
    change: -0.7, period_now: '26.07~26.09', period_base: '직전 12개월', score: 0.35, is_notable: false },
].map(toReadable);

// 유상증자 26.07~26.09: SK하이닉스 제3자배정 40조원이 합계 48.8조원의 82% (실데이터)
const top = topDealFacts([
  { scope: 'equity', corp_name: 'SK하이닉스', sub_type: '제3자배정', amount_krw: 40023100000000, share_pct: 82.0, rank: 1, period: '26.07~26.09' },
  { scope: 'equity', corp_name: 'NAVER', sub_type: '제3자배정', amount_krw: 1480900000000, share_pct: 3.0, rank: 2, period: '26.07~26.09' },
]);
const eq = [
  toReadable({ scope: 'equity', fact_key: 'equity_amount', label_ko: '유상증자 금액', unit: 'krw', value_now: 48800000000000, value_base: 13100000000000,
    change: 272.9, period_now: '26.07~26.09', period_base: '25.07~25.09', score: 18.2, is_notable: true }),
  ...top,
];

const checks = [
  ['금액 형식', facts[0].값, '12.3조원'],
  ['변화율 형식', facts[0].변화, '+18.1%'],
  ['%p 형식', facts[1].변화, '+7.2%p'],
  ['bp 음수 형식', formatChange('bp', -0.7), '−1bp'],
  ['정상 요약 통과', validate('- 회사채 발행금액은 26.07~26.09 12.3조원으로 25.07~25.09 대비 +18.1% 늘었다.', facts).ok, true],
  ['없는 숫자 차단', validate('- 회사채 발행금액은 13.5조원으로 늘었다.', facts).ok, false],
  ['전망 표현 차단', validate('- 장기물 비중은 21.4%로 늘었고 당분간 이어질 것으로 보인다.', facts).ok, false],
  ['불릿 아니면 차단', validate('회사채 발행금액은 12.3조원이다.', facts).ok, false],
  ['상위 딜 사실 문장', top[0].값, 'SK하이닉스 제3자배정 40.0조원 (합계의 82.0%)'],
  ['상위 딜: 30% 이상만 눈에 띔', top.map((f) => f.눈에띄는변화), [true, false]],
  ['상위 딜 이름·비중을 쓴 요약 통과', validate('- 유상증자 금액은 26.07~26.09 48.8조원으로 25.07~25.09 대비 +272.9%였고, SK하이닉스 제3자배정 40.0조원이 합계의 82.0%였다.', eq).ok, true],
  ['규칙 문장에 최대 딜 줄 추가', ruleSummary(eq).split('\n').pop(), '- 유상증자 최근 3개월 최대 딜: SK하이닉스 제3자배정 40.0조원 (합계의 82.0%)'],
  ['규칙 문장: 점수 순', ruleSummary(facts).split('\n')[0], '- 회사채 발행금액: 26.07~26.09 12.3조원, 25.07~25.09 10.4조원 대비 +18.1%'],
];

let failed = 0;
for (const [name, actual, expected] of checks) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);

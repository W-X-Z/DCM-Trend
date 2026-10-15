// 인사이트 요약: 숫자 형식, 검증(새 숫자·전망 표현 차단), 규칙 문장
// 실행: npm run test:insights
import { toReadable, validate, ruleSummary, formatChange } from '../ingest/lib/insights.mjs';

const facts = [
  { scope: 'bond', fact_key: 'bond_amount', label_ko: '회사채 발행금액', unit: 'krw', value_now: 12345000000000, value_base: 10450000000000,
    change: 18.13, period_now: '26.07~26.09', period_base: '25.07~25.09', score: 1.81, is_notable: true },
  { scope: 'bond', fact_key: 'bond_long_share', label_ko: '5년 이상 장기물 비중', unit: 'pct', value_now: 21.4, value_base: 14.2,
    change: 7.2, period_now: '26.07~26.09', period_base: '직전 12개월', score: 1.44, is_notable: true },
  { scope: 'bond', fact_key: 'bond_fee_bp', label_ko: '회사채 인수수수료율', unit: 'bp', value_now: 18.4, value_base: 19.1,
    change: -0.7, period_now: '26.07~26.09', period_base: '직전 12개월', score: 0.35, is_notable: false },
].map(toReadable);

const checks = [
  ['금액 형식', facts[0].값, '12.3조원'],
  ['변화율 형식', facts[0].변화, '+18.1%'],
  ['%p 형식', facts[1].변화, '+7.2%p'],
  ['bp 음수 형식', formatChange('bp', -0.7), '−1bp'],
  ['정상 요약 통과', validate('- 회사채 발행금액은 26.07~26.09 12.3조원으로 25.07~25.09 대비 +18.1% 늘었다.', facts).ok, true],
  ['없는 숫자 차단', validate('- 회사채 발행금액은 13.5조원으로 늘었다.', facts).ok, false],
  ['전망 표현 차단', validate('- 장기물 비중은 21.4%로 늘었고 당분간 이어질 것으로 보인다.', facts).ok, false],
  ['불릿 아니면 차단', validate('회사채 발행금액은 12.3조원이다.', facts).ok, false],
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

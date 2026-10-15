// 홈 피드: 후보 형식, AI 카드 검증(후보 밖 회사·숫자 차단), 규칙 카드, 균형
// 후보는 2026-10-15 실데이터(public.ingest_feed_candidates) 일부
// 실행: npm run test:feed
import { readableFeed, validateCard, pickCards, ruleCard, balanceCards, kindLabel } from '../ingest/lib/feed.mjs';

const raw = [
  { tag: '발행', kind: 'bond', ref_key: '00500254:22:2026-10-21', corp_code: '00500254', corp_name: 'GS', event_dt: '2026-10-15', rcept_no: '20261015000311', flags: ['i_hot_demand'], label: '경쟁률 10배 이상', score: 1.5,
    facts: { 구분: '일반회사채', 등급: 'AA0', 상품: '공모 회사채', 납입일: '2026.10.21', 증액률: '50%', 트랜치: '2년 500억원 (경쟁률 13배, 가산금리 -11bp) / 3년 1,000억원 (경쟁률 14.4배, 가산금리 -10bp)', 대표주관: 'KB증권, NH투자증권, 대신증권, 신한투자증권', '만기 구성': '2년+3년', 수요예측일: '2026.10.15', '최초 모집액': '1,000억원', '확정 발행액': '1,500억원', '전체 수요예측 경쟁률': '13.7배' },
    context: { 시장: '유가증권', '공모채 발행 이력(건)': 30 } },
  { tag: '발행', kind: 'mezz', ref_key: 'mezz:x', corp_code: '01111111', corp_name: '씨어스', event_dt: '2026-10-13', rcept_no: '20261013000001', flags: ['i_jumbo', 'i_zero'], label: '대형 발행, 표면·만기 0% 메자닌', score: 3,
    facts: { 상품: '메자닌', 종류: 'CB', 결정일: '2026.10.13', 납입일: '2026.10.21', 발행액: '1,100억원', '공모 여부': '사모', 만기이자율: '0%', 표면이자율: '0%', '전환·교환가': '30,586원' }, context: { 시장: '코스닥' } },
  { tag: '공시', kind: 'd_asset_buy', ref_key: '20261015000500', corp_code: '00222222', corp_name: '대양제지공업', event_dt: '2026-10-15', rcept_no: '20261015000500', flags: ['d_asset_buy'], label: '유형자산 양수 결정', score: 2.5,
    facts: { 공시: '유형자산양수결정', 공시일: '2026.10.15', 자산명: 'PM-9 신규설비 등', 양수금액: '1,904억원', 양수목적: '공장 재가동을 위한 설비 투자', 자산구분: '기계장치', 거래상대방: 'Valmet 등', '자산총액 대비': '97.45%' }, context: { 시장: '코스닥' } },
  { tag: '공시', kind: 'd_dissolve', ref_key: '20261015000600', corp_code: '00333333', corp_name: '내일을사는사람들', event_dt: '2026-10-15', rcept_no: '20261015000600', flags: ['d_dissolve'], label: '해산사유 발생', score: 2.5,
    facts: { 공시: '해산사유발생', 공시일: '2026.10.15' }, context: {} },
];
// 균형 확인용: 회사채 후보를 여러 개 더 만든다 (회사만 다름)
const extraBonds = Array.from({ length: 6 }, (_, i) => ({ ...raw[0], corp_code: `B${i}`, corp_name: `회사채${i}`, score: 1 - i * 0.1 }));
const extraDisc = Array.from({ length: 4 }, (_, i) => ({ ...raw[2], corp_code: `D${i}`, corp_name: `공시${i}`, score: 2 - i * 0.1 }));
const cands = readableFeed([...raw, ...extraBonds, ...extraDisc]);

const good = { id: 'f1', headline: '2·3년물 1,500억원, 경쟁률 13.7배', body: '10월 15일 수요예측에서 1,000억원 모집에 경쟁률 13.7배가 몰려 1,500억원으로 늘렸다.', point: '증액 배경과 다음 조달 시기 확인' };
const model = {
  items: [
    good,
    { id: 'f3', headline: '설비 1,904억원 취득', body: '자산총액의 97.45%인 1,904억원을 설비에 쓴다. 차입 2,000억원을 쓴다.', point: '재원 확인' },      // 2,000억 없음 → 버림
    { id: 'f99', headline: '없는 후보', body: '...', point: '...' },                                                                  // 후보 밖 → 버림
    { id: 'f2', headline: 'CB 1,100억원', body: '표면·만기 0% CB 1,100억원을 결정했다.', point: '주가가 오를 것으로 보인다' },       // 전망 → 버림
    { id: 'f1', headline: '중복', body: '경쟁률 13.7배.', point: '확인' },                                                          // 같은 회사 → 한 번만
  ],
};
const picked = pickCards(model, cands, 'test-model');
const sameKind = pickCards({ items: cands.filter((c) => c._raw.kind === 'bond').map((c) => ({ id: c.id, headline: '회사채 1,500억원', body: '경쟁률 13.7배로 1,500억원을 확정했다.', point: '증액 배경 확인' })) }, cands).items;
const balanced = balanceCards(sameKind, cands);

const checks = [
  ['후보 id·구분·종류', [cands[0].id, cands[0].구분, cands[1].종류, cands[2].종류], ['f1', '발행', 'CB', '자산 취득']],
  ['종류 이름: 일반회사채 외 구분은 그대로', kindLabel({ kind: 'bond', facts: { 구분: '신종자본증권' } }), '신종자본증권'],
  ['정상 카드 통과 (날짜 10월 15일 허용)', validateCard(good, cands[0]).ok, true],
  ['후보에 없는 숫자 차단', validateCard(model.items[1], cands[2]).ok, false],
  ['AI 선택: 유효 1건만 (숫자·후보 밖·전망·중복 제거)', picked.items.map((i) => i.corp_name), ['GS']],
  ['AI 선택: 버린 이유', picked.rejected.map((r) => r.why.split(' ')[0]), ['numbers', 'unknown', 'banned']],
  ['AI 카드에 원래 공시·종류 연결', [picked.items[0].rcept_no, picked.items[0].kind_label, picked.items[0].by], ['20261015000311', '회사채', 'test-model']],
  ['규칙 카드: 4종 모두 검증 통과', cands.slice(0, 4).every((c) => validateCard(ruleCard(c), c).ok), true],
  ['규칙 카드: 공시 본문', ruleCard(cands[2]).body, '2026.10.15 유형자산양수결정 공시를 냈다. 금액은 1,904억원, 상대는 Valmet 등이다.'],
  ['위기 공시는 경고색', balanceCards([], cands).find((i) => i.kind === 'd_dissolve')?.tone, 'alert'],
  ['균형: 같은 종류 3건까지·공시 3건 이상 (후보 한도 8건)', [balanced.filter((i) => i.kind === 'bond').length, balanced.filter((i) => i.tag === '공시').length >= 3, balanced.length], [3, true, 8]],
  ['균형: AI 가 고른 순서 유지', balanced.slice(0, 3).map((i) => i.corp_name), ['GS', '회사채0', '회사채1']],
];

let failed = 0;
for (const [name, actual, expected] of checks) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);

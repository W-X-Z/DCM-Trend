import Link from 'next/link';
import type { Metadata } from 'next';
import { Chain, Legend, type Node } from '@/components/how/Chain';
import { DeckTrace } from '@/components/how/DeckTrace';
import { HowFeatures, type Feature } from '@/components/how/HowFeatures';
import { PageHead } from '@/components/Ui';
import { ASK_MAX_ROUNDS, askSystem } from '@/lib/ai-prompt';
import { TOOL_LABEL, TOOL_SCHEMAS } from '@/lib/ai-tools';
import { DECK_PROMPT_VERSION, SCHEMA, SYSTEM as DECK_SYSTEM } from '@/lib/deck/prompt';
import { BATCH_PROMPTS } from '@/lib/llm/prompts.generated';

export const metadata: Metadata = { title: '작동 방식' };
export const dynamic = 'force-dynamic';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const DECK_MODEL = process.env.OPENAI_DECK_MODEL || MODEL;
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// 전체 흐름: 매일 수집 → 매일 AI 정리 / 화면에서 요청할 때
const LANES: { title: string; when: string; nodes: Node[] }[] = [
  {
    title: '매일 수집', when: '07:10 · GitHub Actions',
    nodes: [
      { kind: 'data', title: 'OpenDART', sub: '공시 목록·상세·신고서 원문' },
      { kind: 'data', title: '한국은행 ECOS', sub: '시장금리' },
      { kind: 'human', title: '사람 입력', sub: '리서치·금통위·일정 (출처 URL)' },
      { kind: 'rule', title: 'raw → core 변환', sub: 'SQL: 공시 분류, 원문 파싱, 딜 묶기' },
      { kind: 'out', title: 'mart 뷰', sub: '화면이 읽는 유일한 층' },
    ],
  },
  {
    title: '매일 AI 정리', when: '수집 직후 · 배치',
    nodes: [
      { kind: 'rule', title: 'SQL 후보·사실', sub: '규칙이 고른 후보와 문자열로 만든 숫자' },
      { kind: 'ai', title: MODEL, sub: '후보 안에서 고르고 쓰기 (JSON)' },
      { kind: 'check', title: '항목 검증', sub: '후보 id · 숫자 · 금지어 · 길이' },
      { kind: 'rule', title: '규칙 문장으로 채움', sub: '버린 만큼 점수 순서대로' },
      { kind: 'out', title: '홈 피드 · 영업 접점 · 동향 요약' },
    ],
  },
  {
    title: '제안서 만들기', when: '화면에서 · 회사 선택 시',
    nodes: [
      { kind: 'data', title: '회사 데이터', sub: '/api/deck/data' },
      { kind: 'rule', title: '사실 묶음 · 규칙 문안', sub: '여기까지로 장표가 완성된다' },
      { kind: 'human', title: '노하우 DB', sub: '등급·켠 장표에 맞는 것만' },
      { kind: 'ai', title: '노하우 반영(AI)', sub: '버튼을 눌렀을 때만' },
      { kind: 'check', title: '줄 검증 · 병합', sub: '통과한 줄만 바꾼다' },
      { kind: 'out', title: '미리보기 · PPTX · PDF', sub: '브라우저에서 만든다' },
    ],
  },
  {
    title: 'AI 질문', when: '화면에서 · 질문할 때',
    nodes: [
      { kind: 'human', title: '질문', sub: '최근 대화 3개 포함' },
      { kind: 'ai', title: '도구 고르기', sub: `최대 ${ASK_MAX_ROUNDS}회`, loop: true },
      { kind: 'rule', title: `조회 도구 ${TOOL_SCHEMAS.length}개`, sub: 'mart 읽기 전용, 행 수 제한', loop: true },
      { kind: 'ai', title: '답 쓰기', sub: '도구 결과만 근거' },
      { kind: 'out', title: '답 + 출처 링크' },
    ],
  },
];

function features(): Feature[] {
  const deckFields = Object.entries(SCHEMA.properties).map(([k, v]) => [k, String((v as { description?: string }).description ?? '')] as [string, string]);
  return [
    {
      key: 'deck', name: '제안서 문안', when: "제안서 화면 '노하우 반영(AI)' 버튼", model: DECK_MODEL,
      files: ['web/lib/deck/prompt.ts', 'web/app/api/deck/draft/route.ts', 'web/lib/deck/validate.ts'],
      chain: [
        { kind: 'rule', title: '사실 묶음', sub: '장표별 숫자 (rules.ts factsFor)' },
        { kind: 'rule', title: '초안', sub: '규칙 문안 전체' },
        { kind: 'human', title: '노하우', sub: '장표 필드별 [유형] 내용' },
        { kind: 'ai', title: DECK_MODEL, sub: 'JSON schema strict' },
        { kind: 'check', title: '줄 검증', sub: '필드마다, 줄마다' },
        { kind: 'out', title: '병합', sub: '남은 줄이 없으면 규칙 문안' },
      ],
      system: { text: DECK_SYSTEM, version: String(DECK_PROMPT_VERSION) },
      user: [
        { label: '사실', desc: '회사·사례·금리·일정·만기도래·투자자 구분 등 장표에 쓰는 숫자를 문자열로 정리한 묶음. 문안 숫자 검증의 허용 목록이기도 하다.' },
        { label: '초안', desc: '규칙이 쓴 문안 전체(같은 JSON 구조). AI는 이것을 다듬는다.' },
        { label: '노하우', desc: '이 회사 등급과 켠 장표에 맞는 현업 노하우. "[판단 기준] …" 형태로 필드별로 묶는다. 없으면 빠진다.' },
        { label: '요청', desc: '추가 요청(선택, 300자).' },
      ],
      output: { title: `출력 형식: JSON schema 필드 ${deckFields.length}개`, rows: deckFields },
      checks: [
        '숫자는 사실·초안·노하우에 있는 것만 (날짜 조각 포함)',
        '금리·스프레드·수요의 방향 예측은 하우스·한국은행·연준 등 출처를 주어로 쓸 때만, 그것도 금리·전망 장표에서만',
        '확실·보장·반드시 성공 같은 단정 표현 금지',
        '한 줄 180자 이내, 발행조건 비고는 90자 이내',
      ],
      fallback: '버린 줄만 빠지고, 남은 줄이 없는 필드는 규칙 문안을 그대로 쓴다. 키가 없거나 호출이 실패하면 규칙 문안 전체를 쓴다.',
      limits: ['IP당 10분 6회', '55초 제한', '결과는 브라우저에만 저장'],
    },
    {
      key: 'ask', name: 'AI 질문', when: 'AI 질문 화면', model: MODEL,
      files: ['web/lib/ai-prompt.ts', 'web/lib/ai-tools.ts', 'web/app/api/ask/route.ts'],
      chain: [
        { kind: 'human', title: '질문', sub: '400자, 최근 대화 3개' },
        { kind: 'ai', title: '도구 고르기', sub: 'tool_choice: auto', loop: true },
        { kind: 'rule', title: '조회 도구 실행', sub: '한 번에 4개, 결과 24,000자까지', loop: true },
        { kind: 'ai', title: '답 쓰기', sub: `도구 호출이 없으면 끝 (최대 ${ASK_MAX_ROUNDS}회)` },
        { kind: 'out', title: '답 + 출처 링크', sub: '단계는 실시간 표시' },
      ],
      system: { text: askSystem(todayKst()), version: '–' },
      user: [
        { label: '질문', desc: '사용자가 쓴 질문(400자까지).' },
        { label: '이전 대화', desc: '최근 3개의 질문·답(답은 1,500자까지).' },
        { label: '도구 결과', desc: '모델이 부른 조회 함수의 결과를 tool 메시지로 다시 넣는다. SQL은 모델이 쓰지 않고 정해진 필터만 받는다.' },
      ],
      output: {
        title: `조회 도구 ${TOOL_SCHEMAS.length}개`,
        rows: TOOL_SCHEMAS.map((t) => [`${TOOL_LABEL[t.function.name] ?? t.function.name} (${t.function.name})`, String(t.function.description ?? '')] as [string, string]),
      },
      checks: [
        '응답 뒤 숫자 검증은 없다. 근거 제한은 시스템 지침과 도구(읽기 전용·행 수 제한)에 맡긴다',
        '도구 호출은 한 번에 4개, 전체 6회까지',
      ],
      fallback: '6회 안에 답이 안 나오면 질문을 좁혀 달라고 안내한다. 도구 오류는 "조회 실패"로 모델에 돌려준다.',
      limits: ['IP당 10분 8회', '호출당 45초'],
    },
    {
      key: 'feed', name: '홈 피드', when: '매일 수집 직후 (배치)', model: MODEL,
      files: ['ingest/lib/feed.mjs', 'SQL: ingest_feed_candidates'],
      chain: [
        { kind: 'data', title: '최근 2주 발행·공시' },
        { kind: 'rule', title: 'SQL 후보', sub: '특징 태그·점수, 숫자는 문자열' },
        { kind: 'ai', title: MODEL, sub: '10건 고르고 제목·본문·RM 포인트' },
        { kind: 'check', title: '카드 검증', sub: 'id·길이·숫자·금지어' },
        { kind: 'rule', title: '균형·채우기', sub: '발행·공시 각 3건 이상, 모자라면 규칙 카드' },
        { kind: 'out', title: '홈 피드' },
      ],
      system: { text: BATCH_PROMPTS.feed.system, version: String(BATCH_PROMPTS.feed.version) },
      user: [{ label: '후보(JSON)', desc: '후보 id, 구분(발행/공시), 종류, 회사, 특징(규칙이 붙인 이유), 사실(문자열 숫자).' }],
      output: { title: '출력 형식: JSON 객체', rows: [['items[]', 'id, headline(28자 안팎), body(110자 안팎), point(30자 안팎)']] },
      checks: ['후보 목록에 있는 id만', '제목 40자·본문 190자·포인트 60자 이내', '그 후보 사실에 없는 숫자 금지', '전망·투자 권유·과장 표현 금지'],
      fallback: '버린 카드만큼 점수 순서로 규칙 카드를 채운다. 키가 없으면 규칙 카드만 쓴다. 입력이 같으면 다시 부르지 않는다(해시).',
      limits: ['240초 제한'],
    },
    {
      key: 'insights', name: '동향 요약', when: '매일 수집 직후 (배치)', model: MODEL,
      files: ['ingest/lib/insights.mjs', 'SQL: ingest_insight_facts'],
      chain: [
        { kind: 'data', title: '상품별 지표', sub: '회사채·메자닌·증자·IPO·만기·금리' },
        { kind: 'rule', title: '사실 정리', sub: '비교 기준·눈에 띄는 변화·상위 딜' },
        { kind: 'ai', title: MODEL, sub: '불릿 3~5줄' },
        { kind: 'check', title: '요약 검증', sub: '숫자·예측 표현·불릿 형식' },
        { kind: 'out', title: '발행 동향 요약', sub: '실패하면 규칙 문장' },
      ],
      system: { text: BATCH_PROMPTS.insights.system, version: String(BATCH_PROMPTS.insights.version) },
      user: [{ label: '범위 + 사실(JSON)', desc: '상품 범위 이름과 지표·기간·값·비교기준·변화. 변화가 작은 지표는 이름만 준다.' }],
      output: { title: '출력 형식: 글', rows: [['요약', '"- "로 시작하는 불릿 5개 이하, 불릿마다 비교 기준 명시']] },
      checks: ['사실에 없는 숫자 금지(1~6·12 같은 기간 숫자만 허용)', '예측·전망·권고 표현 금지', '불릿 형식이 아니면 버림'],
      fallback: '규칙 문장 요약을 저장한다. 사실이 바뀌지 않으면 다시 부르지 않는다(해시).',
      limits: ['120초 제한'],
    },
    {
      key: 'issues', name: '영업 접점', when: '매일 수집 직후 (배치)', model: MODEL,
      files: ['ingest/lib/issues.mjs', 'SQL: ingest_signal_candidates'],
      chain: [
        { kind: 'data', title: '만기·풋·차입 잔액' },
        { kind: 'rule', title: 'SQL 후보', sub: '신호: 만기 도래, 풋, 단기 차입 의존' },
        { kind: 'ai', title: MODEL, sub: '6곳 고르고 근거·대화 소재' },
        { kind: 'check', title: '항목 검증', sub: 'id·길이·숫자·금지어' },
        { kind: 'rule', title: '채우기', sub: '모자라면 규칙 우선순위' },
        { kind: 'out', title: '다가오는 영업 접점' },
      ],
      system: { text: BATCH_PROMPTS.issues.system, version: String(BATCH_PROMPTS.issues.version) },
      user: [{ label: '후보(JSON)', desc: '후보 id, 회사, 신호, 사실(만기 금액·날짜 등 문자열), 맥락(등급·주관 이력).' }],
      output: { title: '출력 형식: JSON 객체', rows: [['items[]', 'id, title(20자 안팎), why(한 문장), angle(30자 안팎)']] },
      checks: ['후보 목록에 있는 id만', '제목 40자·근거 160자 이내', '그 후보 사실에 없는 숫자 금지', '전망·투자 권유 표현 금지'],
      fallback: '버린 만큼 규칙 우선순위로 채운다. 키가 없으면 규칙만 쓴다.',
      limits: ['180초 제한'],
    },
  ];
}

export default function HowPage({ searchParams }: { searchParams: { corp?: string } }) {
  return (
    <main id="main" className="wrap how-page">
      <PageHead
        title="작동 방식"
        info="수집한 데이터가 규칙과 AI를 거쳐 화면에 나오기까지의 흐름입니다. 프롬프트는 실제 코드에 있는 글을 그대로 보여 줍니다. 외부 추적 도구(Langfuse 등)는 붙이지 않았고, 실행 추적은 이 브라우저에서 직접 잰 값입니다."
      >
        <p className="small dk-links">
          <Link href="/proposal/deck">제안서 만들기</Link>
          <Link href="/proposal/knowledge">노하우 관리</Link>
          <Link href="/ai">AI 질문</Link>
        </p>
      </PageHead>

      <section className="hw-sec" aria-labelledby="hw-flow">
        <div className="hw-sec-h">
          <h2 id="hw-flow">전체 흐름</h2>
          <Legend />
        </div>
        <div className="hw-lanes">
          {LANES.map((l) => (
            <div key={l.title} className="hw-lane">
              <div className="hw-lane-h">
                <strong>{l.title}</strong>
                <span className="small muted">{l.when}</span>
              </div>
              <Chain nodes={l.nodes} label={l.title} />
            </div>
          ))}
        </div>
      </section>

      <section className="hw-sec" aria-labelledby="hw-prompts">
        <div className="hw-sec-h"><h2 id="hw-prompts">AI 기능별 프롬프트</h2></div>
        <HowFeatures features={features()} />
      </section>

      <section className="hw-sec" id="trace" aria-labelledby="hw-trace">
        <div className="hw-sec-h"><h2 id="hw-trace">제안서 실행 추적</h2></div>
        <DeckTrace initialCorp={searchParams.corp} />
      </section>
    </main>
  );
}

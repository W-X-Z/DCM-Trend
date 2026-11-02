// Agent 탭이 Claude 에 주는 도구 정의(이름·설명·입력 형식). 서버 실행(run.ts)과 구성 화면이 같이 쓴다.
// 엔진 도구(dcm_*)는 Managed Agent 패키지의 dcm 명령과 1:1 이다.
import { ACTION_TYPES } from '../deck/agent';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const NUL = (t: string | object) => (typeof t === 'string' ? { type: [t, 'null'] } : { anyOf: [t, { type: 'null' }] });
const ACTION = obj(
  {
    type: { type: 'string', enum: [...ACTION_TYPES] },
    tranches: NUL({ type: 'array', items: obj({ tenor: { type: 'string' }, eok: { type: ['number', 'null'] } }, ['tenor']) }),
    eok: NUL('number'), date: NUL('string'),
    band: NUL(obj({ type: { type: 'string', enum: ['later', 'fixed', 'spread'] }, low: { type: ['number', 'null'] }, high: { type: ['number', 'null'] } }, ['type'])),
    text: NUL('string'), fee_uw: NUL('number'), fee_lead: NUL('number'),
    items: NUL({ type: 'array', items: obj({ id: { type: 'string' }, on: { type: 'boolean' } }, ['id', 'on']) }),
    field: NUL('string'), lines: NUL({ type: 'array', items: { type: 'string' } }), slide: NUL('string'),
  },
  ['type'],
);
export const TOOL_DEFS: Record<string, { description: string; input_schema: object }> = {
  read_skill: { description: '스킬 파일을 읽는다. path 를 비우면 SKILL.md. 스킬 목록과 파일은 시스템 프롬프트의 스킬 표에 있다.', input_schema: obj({ skill: { type: 'string' }, path: { type: 'string' } }, ['skill']) },
  dcm_search: { description: '회사 이름으로 corp_code 후보를 찾는다.', input_schema: obj({ query: { type: 'string' } }, ['query']) },
  dcm_load: {
    description: '회사 데이터(공시·금리·사례·DM 판)와 암묵지를 받고 초안을 연다. mode=resume 이면 이 회사의 기존 초안을 이어서, new 면 기본 조건으로 새로. 결과: 회사 요약·장표 목록·확인할 곳 수.',
    input_schema: obj({ corp_code: { type: 'string' }, mode: { type: 'string', enum: ['resume', 'new'] } }, ['corp_code']),
  },
  dcm_state: { description: '지금 초안의 입력값·일정(수요예측 가능일 등)·장표 목록(id·켬·자료있음)·문안·근거 요약.', input_schema: obj({}) },
  dcm_slides: { description: '지금 장표 목록(쪽·id·제목).', input_schema: obj({}) },
  dcm_apply: {
    description: '행동 목록을 반영한다(값 검사 → 입력 반영 → 일정·증액 한도 재계산). 형식은 dcm-deck-engine 의 references/actions.md. 결과: 바뀐것·알림(거절 이유)·관련장표·Sales문안필요·확인할곳.',
    input_schema: obj({ actions: { type: 'array', items: ACTION, maxItems: 8 } }, ['actions']),
  },
  dcm_facts: { description: '문안 근거 사실 묶음. sales=true 면 Sales Writer 에게 넘길 묶음(사실·초안·노하우).', input_schema: obj({ sales: { type: 'boolean' } }) },
  dcm_set_sales: { description: 'Sales 전략 문안을 넣는다. 숫자·전망 표현 검사를 통과한 줄만(최대 5줄). 결과: 넣은줄·뺀줄(이유).', input_schema: obj({ lines: { type: 'array', items: { type: 'string' } } }, ['lines']) },
  dcm_check: { description: '검수: 사람이 확인할 곳 목록(입력 확인·판단 확인·데이터 확인·갱신 필요).', input_schema: obj({}) },
  dcm_report: { description: '장표별로 쓴 외부 데이터(출처·기준일)와 미연계 내부 데이터 목록.', input_schema: obj({}) },
  dcm_render: { description: '지금 상태로 PPTX·PDF 를 만든다. 사용자는 화면에서 바로 내려받는다.', input_schema: obj({}) },
  dcm_schema: { description: '행동 종류·장표 id·문안 칸·템플릿·이자지급 값.', input_schema: obj({}) },
  call_subagent: {
    description: 'Sub-agent 에게 일을 맡기고 결과 글을 받는다. sales_writer: Sales 전략 문안(JSON 배열로 돌려줌). reviewer: 내용 피드백·비교 사례·Sales 포인트. message 에 필요한 엔진 결과 JSON 을 그대로 넣는다.',
    input_schema: obj({ agent: { type: 'string', enum: ['sales_writer', 'reviewer'] }, message: { type: 'string' } }, ['agent', 'message']),
  },
};
export const toolsFor = (names: string[]) => names.map((n) => ({ name: n, ...TOOL_DEFS[n] }));

const LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  read_skill: (i) => `스킬 읽기 · ${i.skill}${i.path && i.path !== 'SKILL.md' ? `/${i.path}` : ''}`,
  dcm_search: (i) => `회사 찾기 · ${i.query}`,
  dcm_load: (i) => `데이터 받기·초안 열기 · ${i.corp_code}`,
  dcm_state: () => '상태 보기',
  dcm_slides: () => '장표 목록',
  dcm_apply: (i) => `행동 반영 · ${((i.actions as { type: string }[]) ?? []).map((a) => a.type).join(', ')}`,
  dcm_facts: (i) => (i.sales ? '근거 묶음 · Sales' : '근거 묶음'),
  dcm_set_sales: () => 'Sales 문안 넣기',
  dcm_check: () => '검수',
  dcm_report: () => '데이터 목록',
  dcm_render: () => 'PPTX·PDF 만들기',
  dcm_schema: () => '행동 형식',
  call_subagent: (i) => `Sub-agent · ${i.agent === 'sales_writer' ? 'Sales Writer' : 'Reviewer'}`,
};

export const toolLabel = (name: string, input: Record<string, unknown>) => (LABEL[name] ?? (() => name))(input ?? {});

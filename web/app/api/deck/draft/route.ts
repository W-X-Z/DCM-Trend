// 제안서 장표 문안 (OpenAI). 브라우저가 보낸 사실 묶음·규칙 문안만 근거로 쓰고, 결과를 검증해 돌려준다.
// 요청 내용(회사명·제안 조건)은 서버에 저장하거나 기록하지 않는다.
import { allowedNumbers, mergeValidated } from '@/lib/deck/validate';
import type { DeckText } from '@/lib/deck/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEY = process.env.OPENAI_API_KEY ?? '';
const MODEL = process.env.OPENAI_DECK_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini';
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 6) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const SYSTEM = `너는 NH투자증권 IB(DCM) RA다. 공모 회사채 대표주관 제안서의 장표 문안을 쓴다.
규칙
- 근거는 사용자가 준 '사실'과 '초안'뿐이다. 사실에 없는 숫자·날짜·회사·기관명은 절대 쓰지 않는다. 숫자는 사실에 적힌 표기 그대로 쓴다(새로 계산한 비율·합계 금지).
- 문체는 제안서 개조식: 명사형·간결체로 끝낸다(예: "~진행", "~제안", "~수준", "~확보"). 한 줄 90자 이내.
- 각 장표에서 핵심 구절 1~2개만 **굵게** 표시한다. 미달·미매각 같은 경고 숫자는 !!...!!로 표시할 수 있다.
- 각 줄은 '근거(사실 묶음의 숫자) → NH투자증권의 판단·제안' 순서로 쓴다. 판단은 "~이 적합하다고 판단", "~제안", "~필요", "~유리"처럼 발행 구조·일정·금리 밴드·마케팅에 대한 NH의 판단으로 쓴다(제안서 원본 문체).
- 금리·스프레드·수요의 방향을 예측하는 문장(예: "금리가 하락할 것으로 예상")은 리서치 하우스·한국은행·연준 등 출처를 주어로 인용할 때만 쓴다(예: "NH투자증권 리서치는 …를 제시"). 확실·보장 표현 금지.
- 투자자 실명, 내부 정보, 근거 없는 수식어("압도적", "최고의")를 쓰지 않는다.
- 초안의 사실 범위를 벗어나지 않되 설득력 있게 다듬고, 장표 간 내용이 겹치지 않게 한다.
- 문체 예시(숫자·회사는 자리표시): "최근 1년 BBB등급 공모 회사채 수요예측 N건 진행", "OO는 경쟁률 x.xx:1에 그쳐 **대규모 미매각 발생**", "정기보고서 제출 이후 타 발행사 수요예측 전 **최대한 신속히 발행하는 일정** 제안", "증권신고서 제출 및 추가청약 가능성을 고려해 수요예측 전후 하루 여유 확보".
출력: 지정한 JSON 형식만.`;

const arr = (min: number, max: number) => ({ type: 'array', items: { type: 'string' }, description: `${min}~${max}줄` });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lead', 'peers', 'compare', 'schedule', 'structure', 'structureRows', 'strengths', 'rates', 'corp', 'views', 'sizing', 'pipeline', 'bok', 'fomc', 'usviews', 'forecast', 'league', 'maturity', 'sales', 'termNotes'],
  properties: {
    lead: { type: 'string', description: '주요 제안 장표 상단 한 문장(합니다체 허용)' },
    peers: { ...arr(2, 5), description: '같은 등급 수요예측 사례 장표 요약, 2~5줄' },
    compare: { ...arr(2, 4), description: '사례 비교 장표 요약(미달 원인은 사실로 확인되는 차이만), 2~4줄' },
    schedule: { ...arr(3, 5), description: '발행 일정(안) 장표. 첫 줄은 발행 일정 案, 이어서 금통위·정기보고서·만기도래·금리 변동성 근거로 일정 선택 이유, 3~5줄' },
    structure: { ...arr(2, 4), description: '트랜치·만기 구조 장표 요약, 2~4줄' },
    structureRows: {
      type: 'array', description: '초안의 structureRows 와 같은 개수·같은 label 순서',
      items: { type: 'object', additionalProperties: false, required: ['label', 'desc'], properties: { label: { type: 'string' }, desc: { type: 'string', description: '줄바꿈(\\n)으로 2줄 이내' } } },
    },
    strengths: {
      type: 'array', description: '정확히 3개, 초안 순서대로',
      items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: { type: 'string', description: '12자 이내' }, text: { type: 'string' } } },
    },
    rates: { ...arr(2, 4), description: '기준금리·국고채 장표 요약, 2~4줄' },
    corp: { ...arr(2, 4), description: '회사채 금리 장표 요약, 2~4줄' },
    views: { ...arr(1, 3), description: '증권사별 국내 기준금리 전망 장표 요약, 1~3줄' },
    sizing: { ...arr(3, 5), description: '적정 발행규모·트랜치 구성 장표: 만기별 경쟁률·참여 기관·확정 가산금리·만기도래 근거로 트랜치·금액·증액 한도 판단, 3~5줄(제안 금액·만기는 초안 그대로)' },
    pipeline: { ...arr(1, 3), description: '회사채 수요예측 예정 내역 장표 요약, 1~3줄' },
    bok: { ...arr(1, 2), description: '금통위 장표 상단 요약(결정·표결은 사실 그대로), 1~2줄' },
    fomc: { ...arr(1, 2), description: 'FOMC 장표 상단 요약(결정·표결은 사실 그대로), 1~2줄' },
    usviews: { ...arr(1, 3), description: '증권사별 미국 기준금리 전망 장표 요약, 1~3줄' },
    forecast: { ...arr(2, 4), description: 'NH투자증권 리서치 금리 전망 장표 요약, 2~4줄' },
    league: { ...arr(1, 3), description: '연간 대표주관·인수 League Table 장표 요약, 1~3줄' },
    maturity: { ...arr(2, 4), description: '등급별 회사채 만기도래 장표 요약(상·하반기 집중도와 차환 수요 판단), 2~4줄' },
    sales: { ...arr(2, 4), description: 'Sales 전략 장표: 투자자 구분별 참여 비중(회사 vs 같은 등급) 근거로 마케팅 대상·방법 제안, 2~4줄' },
    termNotes: {
      type: 'object', additionalProperties: false, description: '발행조건 표 비고 칸. 항목마다 근거 한 줄(45자 이내), 초안 값을 다듬는다',
      required: ['rating', 'tenor', 'amount', 'band', 'coupon', 'demand', 'pay', 'uw', 'fee'],
      properties: Object.fromEntries(['rating', 'tenor', 'amount', 'band', 'coupon', 'demand', 'pay', 'uw', 'fee'].map((k) => [k, { type: 'string' }])),
    },
  },
} as const;

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (!KEY) return Response.json({ error: 'AI 키가 등록되지 않아 규칙 문안을 그대로 씁니다.', code: 'no_key' }, { status: 503 });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (limited(ip)) return Response.json({ error: '요청이 많아 잠시 쉬어 갑니다. 몇 분 뒤 다시 시도하세요.', code: 'rate' }, { status: 429 });

  let body: { facts?: unknown; rule?: DeckText; focus?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!body.facts || !body.rule) return Response.json({ error: 'bad request' }, { status: 400 });
  const payload = JSON.stringify({ 사실: body.facts, 초안: body.rule, 요청: (body.focus ?? '').slice(0, 300) || undefined });
  if (payload.length > 60_000) return Response.json({ error: '입력이 너무 깁니다. 비교 사례 수를 줄여 주세요.' }, { status: 413 });

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: payload }],
        response_format: { type: 'json_schema', json_schema: { name: 'deck_text', strict: true, schema: SCHEMA } },
      }),
      signal: AbortSignal.timeout(55_000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(String(j?.error?.message ?? res.status).slice(0, 200));
    const content = j.choices?.[0]?.message?.content ?? '{}';
    const ai = JSON.parse(content) as Partial<DeckText>;
    const allowed = allowedNumbers(body.facts, body.rule);
    const { text, dropped } = mergeValidated(ai, body.rule, allowed);
    return Response.json({ text, dropped: dropped.length, droppedLines: dropped.slice(0, 20), model: MODEL }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: `AI 문안을 만들지 못했습니다. 규칙 문안을 그대로 씁니다. (${(e as Error).message.slice(0, 120)})` }, { status: 502 });
  }
}

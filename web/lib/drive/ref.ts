// 레퍼런스 카드: 올린 제안서(PPTX · PDF)를 Agent 가 한 번 읽고 남기는 요약. Master 가 '비슷한 레퍼런스'를 고를 때 카드만 본다.
// 숫자(금액 · 금리)는 카드에 옮기지 않는다 — 레퍼런스는 구성 · 말투를 참고하는 용도.
import 'server-only';
import { MODEL } from '../agent/defs';
import { agentReady, claude, obj, usesOf, type ToolDef } from '../agent/llm';
import type { RefCard } from './store';
import type { SlideInfo } from './extract';

const strs = { type: 'array', items: { type: 'string' } };
const CARD_TOOL: ToolDef = {
  name: 'save_card',
  description: '레퍼런스 제안서 카드를 저장한다.',
  input_schema: obj({
    corp: { type: 'string', description: '제안 대상 회사 이름(모르면 빈 값)' },
    industry: { type: 'string', description: '업종 한 단어~짧은 구(예: 식품 유통, 방산, 승강기)' },
    rating: { type: 'string', description: '회사채 신용등급(예: A+, AA-). 모르면 빈 값' },
    deal: { type: 'string', description: '딜 종류(예: 공모 회사채, 사모사채, CB). 모르면 빈 값' },
    date: { type: 'string', description: '자료 날짜 YYYY-MM 또는 YYYY-MM-DD(모르면 빈 값)' },
    summary: { type: 'string', description: '이 제안서의 성격 · 핵심 메시지 2문장 이내' },
    slides: { ...strs, description: '장표 구성(순서대로, 장표 이름만, 최대 20개)' },
    strengths: { ...strs, description: '다른 제안서에 참고할 만한 점(구성 · 표현 · 논리), 최대 4개' },
    tags: { ...strs, description: '고를 때 쓸 꼬리표(업종 · 등급 · 상황, 예: 차환, 첫 공모, 등급 상향), 최대 6개' },
  }, ['summary', 'slides', 'tags']),
};
const SYSTEM = `너는 IB DCM 부서의 레퍼런스 제안서를 정리하는 역할이다. 올린 제안서 글을 읽고 save_card 를 한 번 부른다.
금액 · 금리 · 수요예측 숫자는 카드에 쓰지 않는다(다른 회사 제안서를 쓸 때 구성 · 표현만 참고하기 때문). 자료에 없는 내용을 지어내지 않는다.`;

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
const list = (v: unknown, n: number, len = 80) => (Array.isArray(v) ? v.map((x) => clip(x, len)).filter(Boolean).slice(0, n) : []);

// 모델이 없을 때: 파일 이름과 장표 제목으로
function cardByRule(name: string, content: string, slides: SlideInfo[] | null): RefCard {
  const corp = name.replace(/\.[^.]+$/, '').replace(/\s*(v\s*F|V\d+(\.\d+)*|\(수정\)|최종|vF)\s*/gi, ' ').replace(/[_-]+/g, ' ').trim();
  const titles = (slides ?? []).map((s) => s.title).filter((t) => t && t.length < 50 && !/^c$/.test(t));
  const pdfHeads = slides ? [] : content.split('\n').filter((l) => l.length > 3 && l.length < 40).slice(0, 20);
  return { corp, summary: `${corp} 제안서`, slides: [...new Set(titles.length ? titles : pdfHeads)].slice(0, 20), strengths: [], tags: [] };
}

export async function makeCard(name: string, content: string, slides: SlideInfo[] | null, left = 60_000): Promise<{ card: RefCard; by: 'model' | 'rule' }> {
  if (!agentReady() || !content.trim()) return { card: cardByRule(name, content, slides), by: 'rule' };
  const ask = `파일: ${name}\n\n${content.slice(0, 24_000)}`;
  try {
    const res = await claude(MODEL, SYSTEM, [{ role: 'user', content: ask }], [CARD_TOOL], 6000, left);
    const u = usesOf(res.content).find((x) => x.name === 'save_card');
    if (!u) throw new Error('no card');
    const c = u.input as Record<string, unknown>;
    const card: RefCard = {
      corp: clip(c.corp, 40) || undefined, industry: clip(c.industry, 40) || undefined, rating: clip(c.rating, 10) || undefined,
      deal: clip(c.deal, 30) || undefined, date: clip(c.date, 10) || undefined,
      summary: clip(c.summary, 300), slides: list(c.slides, 20, 60), strengths: list(c.strengths, 4, 160), tags: list(c.tags, 6, 30),
    };
    return { card, by: 'model' };
  } catch {
    return { card: cardByRule(name, content, slides), by: 'rule' };
  }
}

// 제안서 노하우(현업 암묵지): 장표별 판단 기준·관행·표현. 저장은 ops.deck_knowledge, 화면·AI 문안이 같이 쓴다.
import type { DeckText } from './types';

export type KnowledgeSlide =
  | 'all' | 'terms' | 'sizing' | 'schedule' | 'sales' | 'pipeline' | 'rates' | 'bok' | 'fomc'
  | 'views' | 'usviews' | 'forecast' | 'peers' | 'compare' | 'corp' | 'league' | 'strength' | 'maturity';
export type KnowledgeKind = 'judge' | 'practice' | 'style' | 'caution';
export type Grade = 'AAA' | 'AA' | 'A' | 'BBB';

export type Knowledge = {
  id: number;
  slide: KnowledgeSlide;
  kind: KnowledgeKind;
  grade: Grade | null;
  body: string;
  source: string | null;
  created_by: string | null;
  updated_by: string | null;
  updated_kst: string;
};

export type KnowledgeLog = {
  id: number;
  knowledge_id: number;
  action: 'create' | 'update' | 'delete' | 'restore';
  before: Pick<Knowledge, 'slide' | 'kind' | 'grade' | 'body' | 'source'> | null;
  after: Pick<Knowledge, 'slide' | 'kind' | 'grade' | 'body' | 'source'> | null;
  author: string | null;
  at_kst: string;
  is_deleted: boolean;
};

// 장표 순서 = 제안서 목차 순서(이름은 기본형 목차 표기)
export const SLIDES: [KnowledgeSlide, string][] = [
  ['all', '모든 장표'],
  ['terms', '제안 Term-sheet'],
  ['sizing', '트랜치 검토'],
  ['schedule', '발행일정(안)'],
  ['sales', 'Sales 전략'],
  ['pipeline', '수요예측 예정 내역'],
  ['rates', '금리 동향'],
  ['bok', '금통위'],
  ['fomc', 'FOMC'],
  ['views', '국내 기준금리 전망'],
  ['usviews', '미국 기준금리 전망'],
  ['forecast', '기준금리·국고채 전망(NH 리서치)'],
  ['peers', '같은 등급 수요예측 결과'],
  ['compare', '미매각 사례 분석'],
  ['corp', '최근 발행금리'],
  ['league', 'League Table'],
  ['strength', '같은 등급 대표주관 실적'],
  ['maturity', '공모사채 만기도래'],
];
export const SLIDE_LABEL = Object.fromEntries(SLIDES) as Record<KnowledgeSlide, string>;

export const KINDS: [KnowledgeKind, string][] = [
  ['judge', '판단 기준'],
  ['practice', '관행'],
  ['style', '표현'],
  ['caution', '주의'],
];
export const KIND_LABEL = Object.fromEntries(KINDS) as Record<KnowledgeKind, string>;
export const GRADES: Grade[] = ['AAA', 'AA', 'A', 'BBB'];

// 노하우 장표 → AI 문안 필드
export const SLIDE_TEXT: Record<Exclude<KnowledgeSlide, 'all'>, (keyof DeckText)[]> = {
  terms: ['lead', 'termNotes', 'structure', 'structureRows'],
  sizing: ['sizing'],
  schedule: ['schedule'],
  sales: ['sales'],
  pipeline: ['pipeline'],
  rates: ['rates'],
  bok: ['bok'],
  fomc: ['fomc'],
  views: ['views'],
  usviews: ['usviews'],
  forecast: ['forecast'],
  peers: ['peers'],
  compare: ['compare'],
  corp: ['corp'],
  league: ['league'],
  strength: ['strengths'],
  maturity: ['maturity'],
};

// 이 회사 등급에 맞는 노하우 (등급을 비워 둔 것은 모든 등급)
export const forGrade = (list: Knowledge[], grade: string | null | undefined) =>
  list.filter((k) => !k.grade || k.grade === grade);

// AI 요청에 넣을 묶음: { 모든장표: [...], sizing: [...], ... } (켠 장표만)
export function knowledgeForPrompt(list: Knowledge[], grade: string | null | undefined, slides: string[] | null) {
  const on = slides ? new Set(slides) : null;
  const out: Record<string, string[]> = {};
  for (const k of forGrade(list, grade)) {
    if (k.slide !== 'all' && on && !on.has(k.slide)) continue;
    const key = k.slide === 'all' ? '모든장표' : (SLIDE_TEXT[k.slide] ?? [k.slide]).join('·');
    (out[key] ??= []).push(`[${KIND_LABEL[k.kind]}] ${k.body}`);
  }
  return out;
}

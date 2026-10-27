// 제안서 목차: 공모 회사채 기본형. Ⅰ부 = 회사별로 만드는 발행 제안, Ⅱ부 = 이번 달 Discussion Material(DM) 판을 그대로 붙이는 시장 동향.
// 현업 덱 구성(한화에어로스페이스 2025-08, 현대엘리베이터 2026-02, HD건설기계 2026: Ⅰ 발행 조건 제안 / Ⅱ 시장 동향)과
// CJ프레시웨이 2026-03(1 발행 제안 / 2~4 금리 동향·전망·수요예측 = DM / 5 예정 내역)을 합쳐, DM 이 들어가는 자리를 한 덩어리로 모았다.
// 번호는 부마다 1부터, 한 장에 장표가 둘 이상이면 ①②… 소제목(예: '1. 발행 조건 제안_② 트랜치 검토'). 간지는 부마다 한 장(선택).
// 장표를 켜고 끄면 목차·쪽 제목 번호가 다시 매겨진다. 대한항공형 상세 장표(IR·미매각 사례·NH 강점 등)는 남겨 두되 기본으로 끈다.
// kind: gen = 데이터로 만드는 장표, static = NH 템플릿 고정 장표(문구 그대로, 회사명만 바꿈)

export type ItemId =
  | 'cover' | 'ceo' | 'contents' | 'folders'
  | 'terms' | 'sizing' | 'schedule' | 'sales' | 'ir'
  | 'rates' | 'bok' | 'fomc' | 'issues'
  | 'forecast' | 'credit_fc' | 'views' | 'usviews'
  | 'peers' | 'compare' | 'corp'
  | 'pipeline'
  | 'nh_company' | 'nh_core' | 'nh_scope' | 'league' | 'strength' | 'nh_org'
  | 'maturity' | 'events' | 'datareport'
  | 'back';

export type Item = { id: ItemId; title: string; kind: 'gen' | 'static'; on: boolean; note?: string };
export type PartKey = 'Ⅰ' | 'Ⅱ';
export type Section = { key: string; label: string; part?: PartKey; appendix?: boolean; items: Item[] };
// 부: Ⅰ 은 회사·조건 입력으로 장표마다 만들고, Ⅱ 는 DM 판 문구·자료를 그대로 쓴다(고객 등급 쪽만 맞춤)
export const PARTS: { key: PartKey; label: string; how: string }[] = [
  { key: 'Ⅰ', label: '발행 제안', how: '회사·발행 조건으로 장표마다 생성' },
  { key: 'Ⅱ', label: '회사채 시장 동향', how: 'Discussion Material 판 그대로(고객 등급 쪽만 맞춤)' },
];

export const FRONT: Item[] = [
  { id: 'cover', title: '표지', kind: 'gen', on: true },
  { id: 'ceo', title: 'CEO MESSAGE', kind: 'static', on: false, note: '템플릿 문구·사진 그대로(대표이사 이름 확인 필요)' },
  { id: 'contents', title: 'Contents', kind: 'gen', on: true },
  { id: 'folders', title: '간지(부 표지)', kind: 'gen', on: true, note: 'Ⅰ·Ⅱ부 앞에 한 장씩, 부에 담긴 장 목록' },
];
export const BACK: Item = { id: 'back', title: '뒷표지', kind: 'gen', on: true };

export const SECTIONS: Section[] = [
  // Ⅰ. 발행 제안: 회사별로 생성
  {
    key: 'offer', label: '발행 조건 제안', part: 'Ⅰ',
    items: [
      { id: 'terms', title: '제안 Term-sheet', kind: 'gen', on: true },
      { id: 'sizing', title: '트랜치 검토', kind: 'gen', on: true },
      { id: 'ir', title: 'IR 및 수요예측 전략', kind: 'static', on: false, note: '템플릿 도식 3장' },
    ],
  },
  { key: 'schedule', label: '발행 일정(안)', part: 'Ⅰ', items: [{ id: 'schedule', title: '발행 일정(안)', kind: 'gen', on: true }] },
  {
    key: 'sales', label: 'Sales 전략', part: 'Ⅰ',
    items: [{ id: 'sales', title: 'Sales 전략', kind: 'gen', on: true, note: '수요예측 참여 데이터 기반, 문안은 AI(기관별 내역은 내부 데이터)' }],
  },
  { key: 'pipeline', label: '회사채 수요예측 예정 내역', part: 'Ⅰ', items: [{ id: 'pipeline', title: '회사채 수요예측 예정 내역', kind: 'gen', on: true }] },
  {
    key: 'nh', label: 'NH투자증권 강점', part: 'Ⅰ',
    items: [
      { id: 'nh_company', title: '회사 현황', kind: 'static', on: false, note: '템플릿 2장(FY2024 기준 수치)' },
      { id: 'nh_core', title: '핵심 경쟁력', kind: 'static', on: false },
      { id: 'nh_scope', title: 'IB 업무 범위', kind: 'static', on: false },
      { id: 'league', title: '연간 League Table', kind: 'gen', on: false },
      { id: 'strength', title: '같은 등급 대표주관 실적', kind: 'gen', on: false },
      { id: 'nh_org', title: '조직단위별 업무 분장', kind: 'static', on: false },
    ],
  },
  // Ⅱ. 회사채 시장 동향: DM 판 그대로(DM Ⅰ 시장 동향·Ⅱ 금리 및 시장 전망을 제안서 순서로)
  {
    key: 'rates', label: '금리 동향', part: 'Ⅱ',
    items: [
      { id: 'rates', title: '금리 동향', kind: 'gen', on: true, note: 'DM 금리 동향 문구 그대로, 차트는 고객 등급 신용스프레드' },
      { id: 'bok', title: '금통위', kind: 'gen', on: true, note: 'DM Appendix 금통위 개요' },
      { id: 'fomc', title: 'FOMC', kind: 'gen', on: true, note: '회의 결과만(다음 회의 전망은 증권사별 미국 전망 장표에)' },
      { id: 'issues', title: '주요 이슈', kind: 'gen', on: true, note: 'DM 주요 이슈: 중요도·기준일로 상위 4개, 2장(수급 이슈는 만기도래 및 수급 장표로)' },
    ],
  },
  {
    key: 'outlook', label: '금리 전망', part: 'Ⅱ',
    items: [
      { id: 'forecast', title: '기준금리 및 국고채 금리', kind: 'gen', on: true, note: 'DM 금리 전망① 문구 + NH 리서치 경로(내부 전망표 있으면 표)' },
      { id: 'credit_fc', title: '회사채 금리', kind: 'gen', on: true, note: 'DM 금리 전망② 우량·비우량 단락(고객 등급 쪽 먼저) + 등급별 발행 결과' },
      { id: 'views', title: '증권사별 국내 기준금리 전망', kind: 'gen', on: true },
      { id: 'usviews', title: '증권사별 미국 기준금리 전망', kind: 'gen', on: true },
    ],
  },
  {
    key: 'market', label: '발행시장 동향', part: 'Ⅱ',
    items: [
      { id: 'peers', title: '같은 등급 수요예측 결과', kind: 'gen', on: true, note: 'DM 수요예측 결과를 고객 등급으로 거른 표' },
      { id: 'compare', title: '미매각 사례 분석', kind: 'gen', on: false },
      { id: 'corp', title: '최근 발행금리', kind: 'gen', on: false },
      { id: 'maturity', title: '공모사채 만기도래 및 수급', kind: 'gen', on: true, note: 'DM 시장 수급 문구 + 등급별 만기도래 표' },
    ],
  },
  {
    key: 'A', label: 'Appendix', appendix: true,
    items: [
      { id: 'events', title: '주요 이벤트', kind: 'gen', on: true },
      { id: 'datareport', title: '데이터 사용 현황', kind: 'gen', on: false, note: '장표별로 쓴 외부 데이터와 부족한 내부 데이터' },
    ],
  },
];

export const ALL_ITEMS: Item[] = [...FRONT, ...SECTIONS.flatMap((s) => s.items), BACK];
export const defaultItems = () => Object.fromEntries(ALL_ITEMS.map((i) => [i.id, i.on])) as Record<ItemId, boolean>;

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

// 켜진 장표 기준 번호 매기기
export type Numbered = {
  id: ItemId; section: string; title: string; // 쪽 제목 (예: '1. 발행 조건 제안_② 트랜치 검토')
  head: string; sub: string | null; // 제목 앞부분(번호+장), 뒷부분(_소제목)
  label: string; // 장표 이름(목차·데이터 현황 표기용, 예: 'Ⅰ-1-② 트랜치 검토')
};
export type PlanSection = { key: string; no: number | null; label: string; appendix: boolean; part: PartKey | null; items: Numbered[] };
export type PlanPart = { key: PartKey; label: string; how: string; sections: PlanSection[] };
export type Plan = { front: ItemId[]; sections: PlanSection[]; parts: PlanPart[]; folders: boolean; back: boolean };

export function planOf(on: Record<ItemId, boolean>, available: (id: ItemId) => boolean = () => true): Plan {
  const isOn = (id: ItemId) => on[id] !== false && available(id);
  const sections: Plan['sections'] = [];
  const no: Partial<Record<PartKey, number>> = {}; // 번호는 부마다 1부터
  for (const s of SECTIONS) {
    const items = s.items.filter((i) => isOn(i.id));
    if (!items.length) continue;
    if (s.appendix) {
      sections.push({
        key: s.key, no: null, label: s.label, appendix: true, part: null,
        items: items.map((i, k) => ({ id: i.id, section: s.key, head: `Appendix ${k + 1}. ${i.title}`, sub: null, title: `Appendix ${k + 1}. ${i.title}`, label: `App${k + 1}. ${i.title}` })),
      });
      continue;
    }
    const part = s.part ?? 'Ⅰ';
    const k0 = (no[part] = (no[part] ?? 0) + 1);
    const multi = items.length > 1;
    sections.push({
      key: s.key, no: k0, label: s.label, appendix: false, part,
      items: items.map((i, k) => {
        const sub = multi ? `${CIRCLED[k]} ${i.title}` : i.title !== s.label ? i.title : null;
        const head = `${k0}. ${s.label}`;
        return { id: i.id, section: s.key, head, sub, title: `${head}${sub ? `_${sub}` : ''}`, label: `${part}-${k0}${multi ? `-${CIRCLED[k]}` : '.'} ${i.title}` };
      }),
    });
  }
  const parts = PARTS.map((p) => ({ ...p, sections: sections.filter((s) => s.part === p.key) })).filter((p) => p.sections.length);
  return {
    front: FRONT.filter((i) => i.id !== 'folders' && isOn(i.id)).map((i) => i.id),
    sections, parts, folders: isOn('folders') && parts.length > 0, back: isOn('back'),
  };
}

export const itemOf = (id: ItemId) => ALL_ITEMS.find((i) => i.id === id);

// 목차 템플릿(칩): 기본·간략 두 가지만(신규 발행처럼 예외가 많은 경우는 개별 선택으로). 칩을 고른 뒤 장표를 켜고 끌 수 있다.
// 구성은 노션 '제안서 목차 항목' DB의 템플릿 칼럼과 같다.
export type Template = { key: string; label: string; hint: string; items: () => Record<ItemId, boolean> };
const only = (ids: ItemId[]) => Object.fromEntries(ALL_ITEMS.map((i) => [i.id, ids.includes(i.id)])) as Record<ItemId, boolean>;
export const TEMPLATES: Template[] = [
  { key: 'basic', label: '기본', hint: 'Ⅰ 발행 제안(회사별 생성) + Ⅱ 회사채 시장 동향(Discussion Material 판 그대로)', items: defaultItems },
  {
    key: 'lite', label: '간략', hint: '발행 조건·일정과 시장 핵심만(10장 안팎, 간지 없음)',
    items: () => only(['cover', 'contents', 'terms', 'sizing', 'schedule', 'pipeline', 'rates', 'forecast', 'peers', 'back']),
  },
];
// 지금 목차가 어느 템플릿과 같은지(없으면 null = 직접 선택)
export function templateOf(on: Record<ItemId, boolean>): string | null {
  for (const t of TEMPLATES) {
    const x = t.items();
    if (ALL_ITEMS.every((i) => !!on[i.id] === !!x[i.id])) return t.key;
  }
  return null;
}

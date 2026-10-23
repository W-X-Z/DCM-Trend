// 제안서 목차(대한항공 공모사채 제안서 2025-04 구성 기준). 장표를 켜고 끄면 목차·간지·쪽 제목 번호가 다시 매겨진다.
// kind: gen = 데이터로 만드는 장표, static = NH 템플릿 고정 장표(문구 그대로, 회사명만 바꿈), shell = 내부 자료를 채울 빈 틀

export type ItemId =
  | 'cover' | 'ceo' | 'contents'
  | 'terms' | 'sizing' | 'schedule' | 'sales' | 'pipeline'
  | 'rates' | 'bok' | 'fomc' | 'views' | 'usviews' | 'forecast'
  | 'peers' | 'compare' | 'corp'
  | 'ir'
  | 'nh_company' | 'nh_core' | 'nh_scope' | 'league' | 'strength' | 'nh_org'
  | 'maturity' | 'events'
  | 'back';

export type Item = { id: ItemId; title: string; kind: 'gen' | 'static' | 'shell'; on: boolean; note?: string };
export type Group = { title: string; circled?: boolean; items: Item[] };
export type Section = { key: 'I' | 'II' | 'III' | 'A'; label: string; folder: boolean; groups: Group[] };

export const FRONT: Item[] = [
  { id: 'cover', title: '표지', kind: 'gen', on: true },
  { id: 'ceo', title: 'CEO MESSAGE', kind: 'static', on: false, note: '템플릿 문구·사진 그대로(대표이사 이름 확인 필요)' },
  { id: 'contents', title: 'Contents', kind: 'gen', on: true },
];
export const BACK: Item = { id: 'back', title: '뒷표지', kind: 'gen', on: true };

export const SECTIONS: Section[] = [
  {
    key: 'I', label: '주요 발행 조건 제안', folder: true,
    groups: [
      { title: '발행조건 제안(案)', items: [{ id: 'terms', title: '발행조건 제안(案)', kind: 'gen', on: true }] },
      { title: '적정 발행규모 및 트랜치 구성 검토', items: [{ id: 'sizing', title: '적정 발행규모 및 트랜치 구성 검토', kind: 'gen', on: true }] },
      { title: '회사채 발행 일정 검토', items: [{ id: 'schedule', title: '회사채 발행 일정 검토', kind: 'gen', on: true }] },
      { title: 'Sales 전략', items: [{ id: 'sales', title: 'Sales 전략', kind: 'shell', on: false, note: '기관별 수요예측 참여·배정은 내부 자료(빈 표)' }] },
      { title: '회사채 수요예측 예정 내역', items: [{ id: 'pipeline', title: '회사채 수요예측 예정 내역', kind: 'gen', on: true }] },
    ],
  },
  {
    key: 'II', label: '주요 검토사항', folder: true,
    groups: [
      {
        title: '금리 동향 및 전망', circled: true,
        items: [
          { id: 'rates', title: '금리 동향', kind: 'gen', on: true },
          { id: 'bok', title: '금통위', kind: 'gen', on: true },
          { id: 'fomc', title: 'FOMC', kind: 'gen', on: true },
          { id: 'views', title: '증권사별 국내 기준금리 전망', kind: 'gen', on: true },
          { id: 'usviews', title: '증권사별 미국 기준금리 전망', kind: 'gen', on: true },
          { id: 'forecast', title: '금리 전망(NH투자증권 리서치)', kind: 'gen', on: true },
        ],
      },
      {
        title: '회사채 시장 현황',
        items: [
          { id: 'peers', title: '수요예측 결과', kind: 'gen', on: true },
          { id: 'compare', title: '미매각 사례 분석', kind: 'gen', on: true },
          { id: 'corp', title: '회사채 금리', kind: 'gen', on: true },
        ],
      },
      { title: 'IR 및 흥행 전망', items: [{ id: 'ir', title: 'IR 및 수요예측 전략', kind: 'static', on: false, note: '템플릿 도식 3장' }] },
    ],
  },
  {
    key: 'III', label: 'NH투자증권 강점', folder: true,
    groups: [
      { title: '회사 현황', items: [{ id: 'nh_company', title: '회사 현황', kind: 'static', on: false, note: '템플릿 2장(FY2024 기준 수치)' }] },
      { title: '핵심 경쟁력', items: [{ id: 'nh_core', title: '핵심 경쟁력', kind: 'static', on: true }] },
      { title: 'IB 업무 범위', items: [{ id: 'nh_scope', title: 'IB 업무 범위', kind: 'static', on: false }] },
      {
        title: '회사채 대표주관 및 인수 실적',
        items: [
          { id: 'league', title: '연간 League Table', kind: 'gen', on: true },
          { id: 'strength', title: '같은 등급 대표주관 실적', kind: 'gen', on: true },
        ],
      },
      { title: '조직단위별 업무 분장', items: [{ id: 'nh_org', title: '조직단위별 업무 분장', kind: 'static', on: false }] },
    ],
  },
  {
    key: 'A', label: 'Appendix', folder: false,
    groups: [
      { title: '등급별 회사채 만기도래 현황', items: [{ id: 'maturity', title: '등급별 회사채 만기도래 현황', kind: 'gen', on: true }] },
      { title: '주요 이벤트', items: [{ id: 'events', title: '주요 이벤트', kind: 'gen', on: true }] },
    ],
  },
];

export const ALL_ITEMS: Item[] = [...FRONT, ...SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items)), BACK];
export const defaultItems = () => Object.fromEntries(ALL_ITEMS.map((i) => [i.id, i.on])) as Record<ItemId, boolean>;

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

// 켜진 장표 기준 번호 매기기
export type Numbered = {
  id: ItemId; section: Section['key'] | 'front' | 'back'; title: string; // 쪽 제목 (예: '1. 금리 동향 및 전망_① 금리 동향')
  head: string; sub: string | null; // 제목 앞부분(번호+그룹), 뒷부분(_소제목)
};
export type Plan = {
  front: ItemId[];
  sections: { key: Section['key']; roman: string; label: string; folder: boolean; groups: { no: number; title: string; items: Numbered[] }[] }[];
  back: boolean;
};

export function planOf(on: Record<ItemId, boolean>, available: (id: ItemId) => boolean = () => true): Plan {
  const isOn = (id: ItemId) => on[id] !== false && available(id);
  const sections: Plan['sections'] = [];
  let r = 0;
  for (const s of SECTIONS) {
    const groups: Plan['sections'][number]['groups'] = [];
    for (const g of s.groups) {
      const items = g.items.filter((i) => isOn(i.id));
      if (!items.length) continue;
      const no = groups.length + 1;
      const multi = items.length > 1 || g.items.length > 1;
      const prefix = s.key === 'A' ? `Appendix${no}. ` : `${no}. `;
      groups.push({
        no, title: g.title,
        items: items.map((i, k) => {
          const subLabel = multi && i.title !== g.title ? (g.circled ? `${CIRCLED[k]} ${i.title}` : i.title) : null;
          return { id: i.id, section: s.key, head: `${prefix}${g.title}`, sub: subLabel, title: `${prefix}${g.title}${subLabel ? `_${subLabel}` : ''}` };
        }),
      });
    }
    if (!groups.length) continue;
    sections.push({ key: s.key, roman: s.key === 'A' ? '' : ROMAN[r++], label: s.label, folder: s.folder, groups });
  }
  return { front: FRONT.filter((i) => isOn(i.id)).map((i) => i.id), sections, back: isOn('back') };
}

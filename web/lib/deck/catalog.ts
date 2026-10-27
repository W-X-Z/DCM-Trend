// 제안서 목차: 공모 회사채 기본형(CJ프레시웨이 공모사채 제안 2026-03 구성). 장표를 켜고 끄면 목차·쪽 제목 번호가 다시 매겨진다.
// 번호는 장(1. 발행 제안)마다 매기고, 한 장에 장표가 둘 이상 켜져 있으면 ①②… 소제목을 붙인다(예: '1. 발행 제안_② 트랜치 검토').
// 대한항공형 상세 장표(Sales 전략·미매각 사례·NH 강점 등)는 남겨 두되 기본으로 끈다.
// kind: gen = 데이터로 만드는 장표, static = NH 템플릿 고정 장표(문구 그대로, 회사명만 바꿈)

export type ItemId =
  | 'cover' | 'ceo' | 'contents'
  | 'terms' | 'sizing' | 'schedule' | 'sales' | 'ir'
  | 'rates' | 'bok' | 'fomc'
  | 'forecast' | 'credit_fc' | 'views' | 'usviews'
  | 'peers' | 'compare' | 'corp'
  | 'pipeline'
  | 'nh_company' | 'nh_core' | 'nh_scope' | 'league' | 'strength' | 'nh_org'
  | 'maturity' | 'events' | 'datareport'
  | 'back';

export type Item = { id: ItemId; title: string; kind: 'gen' | 'static'; on: boolean; note?: string };
export type Section = { key: string; label: string; appendix?: boolean; items: Item[] };

export const FRONT: Item[] = [
  { id: 'cover', title: '표지', kind: 'gen', on: true },
  { id: 'ceo', title: 'CEO MESSAGE', kind: 'static', on: false, note: '템플릿 문구·사진 그대로(대표이사 이름 확인 필요)' },
  { id: 'contents', title: 'Contents', kind: 'gen', on: true },
];
export const BACK: Item = { id: 'back', title: '뒷표지', kind: 'gen', on: true };

export const SECTIONS: Section[] = [
  {
    key: 'offer', label: '발행 제안',
    items: [
      { id: 'terms', title: '제안 Term-sheet', kind: 'gen', on: true },
      { id: 'sizing', title: '트랜치 검토', kind: 'gen', on: true },
      { id: 'schedule', title: '발행일정(안)', kind: 'gen', on: true },
      { id: 'sales', title: 'Sales 전략', kind: 'gen', on: false, note: '투자자 구분별 참여는 공시, 기관별 내역은 내부 데이터' },
      { id: 'ir', title: 'IR 및 수요예측 전략', kind: 'static', on: false, note: '템플릿 도식 3장' },
    ],
  },
  {
    key: 'rates', label: '금리 동향',
    items: [
      { id: 'rates', title: '금리 동향', kind: 'gen', on: true },
      { id: 'bok', title: '금통위', kind: 'gen', on: true },
      { id: 'fomc', title: 'FOMC', kind: 'gen', on: true },
    ],
  },
  {
    key: 'outlook', label: '금리 전망',
    items: [
      { id: 'forecast', title: '기준금리 및 국고채 금리', kind: 'gen', on: true, note: 'NH 리서치 전망표(내부), 없으면 공개 전망표' },
      { id: 'credit_fc', title: '회사채 금리', kind: 'gen', on: true, note: 'NH 등급별 회사채 전망표(내부 데이터)가 있을 때만' },
      { id: 'views', title: '증권사별 국내 기준금리 전망', kind: 'gen', on: true },
      { id: 'usviews', title: '증권사별 미국 기준금리 전망', kind: 'gen', on: true },
    ],
  },
  {
    key: 'demand', label: '회사채 수요예측 결과',
    items: [
      { id: 'peers', title: '같은 등급 수요예측 결과', kind: 'gen', on: true },
      { id: 'compare', title: '미매각 사례 분석', kind: 'gen', on: false },
      { id: 'corp', title: '최근 발행금리', kind: 'gen', on: false },
    ],
  },
  {
    key: 'pipeline', label: '회사채 수요예측 예정 내역',
    items: [{ id: 'pipeline', title: '회사채 수요예측 예정 내역', kind: 'gen', on: true }],
  },
  {
    key: 'nh', label: 'NH투자증권 강점',
    items: [
      { id: 'nh_company', title: '회사 현황', kind: 'static', on: false, note: '템플릿 2장(FY2024 기준 수치)' },
      { id: 'nh_core', title: '핵심 경쟁력', kind: 'static', on: false },
      { id: 'nh_scope', title: 'IB 업무 범위', kind: 'static', on: false },
      { id: 'league', title: '연간 League Table', kind: 'gen', on: false },
      { id: 'strength', title: '같은 등급 대표주관 실적', kind: 'gen', on: false },
      { id: 'nh_org', title: '조직단위별 업무 분장', kind: 'static', on: false },
    ],
  },
  {
    key: 'A', label: 'Appendix', appendix: true,
    items: [
      { id: 'maturity', title: '공모사채 만기도래 현황', kind: 'gen', on: true },
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
  id: ItemId; section: string; title: string; // 쪽 제목 (예: '1. 발행 제안_② 트랜치 검토')
  head: string; sub: string | null; // 제목 앞부분(번호+장), 뒷부분(_소제목)
  label: string; // 장표 이름(목차·데이터 현황 표기용, 예: '1-② 트랜치 검토')
};
export type PlanSection = { key: string; no: number | null; label: string; appendix: boolean; items: Numbered[] };
export type Plan = { front: ItemId[]; sections: PlanSection[]; back: boolean };

export function planOf(on: Record<ItemId, boolean>, available: (id: ItemId) => boolean = () => true): Plan {
  const isOn = (id: ItemId) => on[id] !== false && available(id);
  const sections: Plan['sections'] = [];
  let no = 0;
  for (const s of SECTIONS) {
    const items = s.items.filter((i) => isOn(i.id));
    if (!items.length) continue;
    if (s.appendix) {
      sections.push({
        key: s.key, no: null, label: s.label, appendix: true,
        items: items.map((i, k) => ({ id: i.id, section: s.key, head: `Appendix ${k + 1}. ${i.title}`, sub: null, title: `Appendix ${k + 1}. ${i.title}`, label: `App${k + 1}. ${i.title}` })),
      });
      continue;
    }
    no++;
    const multi = items.length > 1;
    sections.push({
      key: s.key, no, label: s.label, appendix: false,
      items: items.map((i, k) => {
        const sub = multi ? `${CIRCLED[k]} ${i.title}` : i.title !== s.label ? i.title : null;
        const head = `${no}. ${s.label}`;
        return { id: i.id, section: s.key, head, sub, title: `${head}${sub ? `_${sub}` : ''}`, label: multi ? `${no}-${CIRCLED[k]} ${i.title}` : `${no}. ${i.title}` };
      }),
    });
  }
  return { front: FRONT.filter((i) => isOn(i.id)).map((i) => i.id), sections, back: isOn('back') };
}

export const itemOf = (id: ItemId) => ALL_ITEMS.find((i) => i.id === id);

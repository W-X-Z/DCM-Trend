// 제안서 데이터(서버 → 브라우저)와 입력값(브라우저에만 저장) 형식
import type { ItemId } from './catalog';
import type { Holiday, MarketEvent } from './schedule';

export type PeerTranche = {
  tenor: string; months: number | null; initial_krw: number | null; amount_krw: number | null;
  demand_krw: number | null; in_band_krw: number | null; ratio: number | null; under: boolean | null;
  yield_pct: number | null; spread_bp: number | null; band_type: string | null; band_low: number | null; band_high: number | null;
  maturity_dt: string | null;
  byType: DemandType[] | null; // 수요예측 참여 내역 투자자 구분별 (정정신고서)
};
// 투자자 구분: 운용사(집합)·투자매매중개업자·연기금/운용사(고유)/은행/보험·기타·외국(거래실적 유/무)
export type DemandType = { t: 'fund' | 'broker' | 'inst' | 'etc' | 'foreign_y' | 'foreign_n'; n: number; q: number };

export type PeerIssue = {
  key: string; corp_code: string; corp_name: string; sub_type: string | null; series: string | null;
  rating: string | null; rating_group: string | null;
  demand_dt: string | null; pricing_dt: string | null; deal_dt: string | null;
  tenor_combo: string; initial_krw: number | null; amount_krw: number | null; demand_krw: number | null; in_band_krw: number | null;
  ratio: number | null; under: boolean | null; increased: boolean | null;
  band_type: string | null; band_low: number | null; band_high: number | null; fee_bp: number | null;
  lead: string | null; nh_lead: boolean; tranches: PeerTranche[];
  amount_max_krw: number | null; // 증액 한도(증권신고서)
};

export type LeagueRow = { firm: string; deals: number; credit: number; isNh: boolean };

export type DeckData = {
  asof: string;
  company: {
    corp_code: string; corp_name: string; market: string | null; rating: string | null; rating_group: string | null;
    outstanding_bond_krw: number | null; last_series: string | null; bond_count: number;
  };
  own: PeerIssue[];
  peers: PeerIssue[]; // 같은 등급군, 최근 12개월 (회사 자신 포함)
  maturities: { dt: string; series: string | null; amount_krw: number | null; coupon_pct: number | null; months: number | null; lead: string | null }[];
  league: { scope: string; since: string; rows: LeagueRow[]; total: number; deals: number };
  leagueAll: { scope: string; since: string; rows: LeagueRow[]; total: number; deals: number };
  combos: { combo: string; issues: number; share: number | null; medComp: number | null; incShare: number | null; avgAmount: number | null }[];
  rates: { key: string; label: string; value: number; dt: string; chg1m: number | null; chg3m: number | null; chg1y: number | null; source: string }[];
  series: { key: string; label: string; pts: [string, number][] }[];
  // 일별 금리(최근 2년, ECOS). 국고 2·3·5년, 회사채 AA-·BBB- 3년. ECOS 키가 없으면 조사 값만 있어 듬성하다.
  daily: { key: string; label: string; pts: [string, number][] }[];
  policyHistory: { kr: { dt: string; rate: number }[]; us: { dt: string; low: number; high: number }[] };
  forecast: {
    house: string; published_dt: string; title: string; url: string;
    rows: { key: string; label: string; basis: string; cells: { period: string; value: number; actual: boolean }[] }[];
    // 하우스 최근 의견(출처별 요약)
    notes: { topic: string; text: string; date: string; title: string; url: string }[];
  } | null;
  views: {
    house: string; analysts: string | null; published_dt: string; kind: string; title: string; url: string;
    stance: string | null; next_move: string | null; terminal: number | null; summary: string;
  }[];
  events: MarketEvent[];
  holidays: Holiday[];
  fee: { last_bp: number | null; group_median_bp: number | null };
  // 상세형 장표용
  pipeline: PipelineIssue[]; // 증권신고서 제출 후 발행 전(수요예측 예정·진행)
  leagueYearly: { year: number; ytd: boolean; total_lead: number; total_uw: number; lead: YearRow[]; uw: YearRow[] }[];
  maturityByGrade: { months: string[]; rows: { grade: string; notch: string | null; values: number[]; total: number }[]; total: number[]; asof: string };
  policy: { bok: Meeting | null; fomc: Meeting | null };
  usViews: UsView[];
};

export type YearRow = { rank: number; firm: string; krw: number; share: number; isNh: boolean };
export type PipelineIssue = {
  amount_max_krw: number | null;
  key: string; corp_name: string; sub_type: string | null; rating: string | null; demand_dt: string | null; pay_dt: string | null;
  band_type: string | null; band_low: number | null; band_high: number | null; lead: string | null; nh_lead: boolean;
  tranches: { tenor: string; months: number | null; initial_krw: number | null; band_type: string | null; band_low: number | null; band_high: number | null }[];
};
export type Meeting = {
  kind: '금통위' | 'FOMC'; meeting_dt: string; title: string; decision: string; vote: string | null;
  points: { label: string; text: string }[]; sources: { title: string; url: string; date: string | null }[];
  // 장표 아래 패널: 전망 표(예: SEP·한은 경제전망), 분포 막대(점도표)
  panels: MeetingPanel[];
};
export type MeetingPanel =
  | { kind: 'table'; title: string; columns: string[]; rows: { label: string; cells: string[] }[]; note?: string }
  | { kind: 'dots'; title: string; groups: string[]; levels: { rate: string; counts: number[] }[]; note?: string };
export type UsView = {
  house: string; analysts: string | null; published_dt: string; title: string; url: string;
  next_move: string | null; terminal: number | null; end2026: number | null; end2027: number | null; summary: string;
};

export type BandInput = { type: 'later' | 'fixed' | 'spread'; low: number | null; high: number | null };

export type DeckInput = {
  corp_code: string;
  issuer: string; // 표지 표기 (예: ㈜이랜드월드)
  series: string; // 회차 숫자
  month: string; // 'YYYY. MM'
  security: string;
  rating: string;
  ratingNote: string;
  coverTitle: string; // 표지 제목
  tranches: { tenor: string; eok: number | null }[]; // '1년 또는 1.5년' 처럼 쓰면 대안 만기
  maxEok: number | null;
  coupon: string;
  band: BandInput;
  bandNote: string;
  pay: string; // 희망 납입일
  demand: string | null; // 고른 수요예측일
  uw: string;
  feeUw: number | null;
  feeLead: number | null;
  feeNote: string;
  peerScope: 'group' | 'notch';
  peerKeys: string[]; // 수요예측 사례 표
  compareKeys: string[]; // 비교 장표 (최대 3)
  items: Record<ItemId, boolean>;
  dept: string; // 뒷표지 부서명
  coverDept: string; // 고정 장표의 담당(커버리지) 부서명
  contacts: string; // 뒷표지 연락처(직접 입력, 브라우저에만 저장)
  // 내부 자료 붙여넣기(엑셀에서 복사한 표, 탭 구분). 공시로 구할 수 없는 표를 장표에 그대로 넣는다. 브라우저에만 저장.
  internal: { rateFc: string; creditFc: string; minpyeong: string; investors: string };
};

// 장표 문안 (AI 또는 규칙). 줄마다 하나의 글머리. **강조**, !!빨강!!
export type DeckText = {
  lead: string; // 주요 제안 상단 한 줄
  peers: string[];
  compare: string[];
  schedule: string[];
  structure: string[];
  structureRows: { label: string; desc: string }[];
  strengths: { title: string; text: string }[];
  rates: string[];
  corp: string[];
  views: string[];
  sizing: string[];
  pipeline: string[];
  bok: string[];
  fomc: string[];
  usviews: string[];
  forecast: string[];
  league: string[];
  maturity: string[];
  sales: string[];
  termNotes: TermNotes; // 발행조건 표 비고(근거)
};
export type TermNotes = { rating: string; tenor: string; amount: string; band: string; coupon: string; demand: string; pay: string; uw: string; fee: string };
export type TextKey = keyof DeckText;

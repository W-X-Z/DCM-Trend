// 제안서 데이터(서버 → 브라우저)와 입력값(브라우저에만 저장) 형식
import type { Holiday, MarketEvent } from './schedule';

export type PeerTranche = {
  tenor: string; months: number | null; initial_krw: number | null; amount_krw: number | null;
  demand_krw: number | null; in_band_krw: number | null; ratio: number | null; under: boolean | null;
  yield_pct: number | null; spread_bp: number | null; band_type: string | null; band_low: number | null; band_high: number | null;
  maturity_dt: string | null;
};

export type PeerIssue = {
  key: string; corp_code: string; corp_name: string; sub_type: string | null; series: string | null;
  rating: string | null; rating_group: string | null;
  demand_dt: string | null; pricing_dt: string | null; deal_dt: string | null;
  tenor_combo: string; initial_krw: number | null; amount_krw: number | null; demand_krw: number | null; in_band_krw: number | null;
  ratio: number | null; under: boolean | null; increased: boolean | null;
  band_type: string | null; band_low: number | null; band_high: number | null; fee_bp: number | null;
  lead: string | null; nh_lead: boolean; tranches: PeerTranche[];
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
  forecast: {
    house: string; published_dt: string; title: string; url: string;
    rows: { key: string; label: string; basis: string; cells: { period: string; value: number; actual: boolean }[] }[];
  } | null;
  views: {
    house: string; analysts: string | null; published_dt: string; kind: string; title: string; url: string;
    stance: string | null; next_move: string | null; terminal: number | null; summary: string;
  }[];
  events: MarketEvent[];
  holidays: Holiday[];
  fee: { last_bp: number | null; group_median_bp: number | null };
};

export type SlideId =
  | 'cover' | 'sec1' | 'terms' | 'peers' | 'compare' | 'schedule' | 'structure' | 'strength'
  | 'sec2' | 'rates' | 'corp' | 'views' | 'events' | 'back';

export const SLIDES: { id: SlideId; label: string; group: 1 | 2 | 0 }[] = [
  { id: 'cover', label: '표지', group: 0 },
  { id: 'sec1', label: '간지: 발행 전략 검토 및 제안', group: 1 },
  { id: 'terms', label: '주요 제안', group: 1 },
  { id: 'peers', label: '발행시기 제안: 같은 등급 수요예측 사례', group: 1 },
  { id: 'compare', label: '발행시기 제안: 사례 비교', group: 1 },
  { id: 'schedule', label: '발행시기 제안: 발행 일정(안)', group: 1 },
  { id: 'structure', label: '발행전략 제안: 트랜치·만기 구조', group: 1 },
  { id: 'strength', label: 'NH투자증권의 강점', group: 1 },
  { id: 'sec2', label: '간지: 회사채 시장 동향', group: 2 },
  { id: 'rates', label: '금리 동향과 전망: 기준금리·국고채', group: 2 },
  { id: 'corp', label: '금리 동향: 회사채', group: 2 },
  { id: 'views', label: '시장 동향: 증권사별 기준금리 전망', group: 2 },
  { id: 'events', label: 'Appendix: 주요 이벤트', group: 2 },
  { id: 'back', label: '뒷표지', group: 0 },
];

export type BandInput = { type: 'later' | 'fixed' | 'spread'; low: number | null; high: number | null };

export type DeckInput = {
  corp_code: string;
  issuer: string; // 표지 표기 (예: ㈜이랜드월드)
  series: string; // 회차 숫자
  month: string; // 'YYYY. MM'
  security: string;
  rating: string;
  ratingNote: string;
  tenors: string; // '1년 또는 1.5년'
  amountEok: number | null;
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
  slides: Record<SlideId, boolean>;
  dept: string;
  contacts: string; // 뒷표지 연락처(직접 입력, 브라우저에만 저장)
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
};
export type TextKey = keyof DeckText;

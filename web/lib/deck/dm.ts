// Discussion Material(시장 자료) 판: 현업은 같은 시기 제안서의 시장 장표에 DM 문구·표·차트를 그대로 쓰고 고객 등급 쪽만 맞춘다.
// 프로토타입은 공개 자료로 만든 DM 판(A급 회사채 시장동향 등)을 파일로 두고, 기준일 이전 가장 최근 판을 제안서 Ⅱ부에 그대로 넣는다.
// 판 파일은 완성된 DM(PPTX)의 글상자 문구와, DM 을 만든 같은 자료의 차트·표 값을 옮긴 것이다(새 판 = 파일 하나 추가).
import e20261027 from './dm/2026-10-27.json';
import type { MarketIssue, MarketSeries } from './types';

// DM 차트: line 은 cats 가 날짜(YYYY-MM-DD), cols 는 항목 이름. 축 범위·간격은 DM 과 같게 판에 적는다.
export type DmChart = {
  kind: 'line' | 'cols'; title: string; unit?: string; src?: string;
  cats: string[]; dates?: boolean;
  series: { name: string; color: string; values: (number | null)[] }[];
  min: number; max: number; step: number; digits?: number; labels?: boolean; legend?: boolean; stacked?: boolean;
};
// 회의 장표: 핵심 포인트(✓ 소제목 + 글머리) + 아래 차트 3개
export type DmMeeting = { meeting_dt: string; title: string; points: string[]; charts: DmChart[] };
export type DmTable = { title: string; head: string[]; rows: string[][]; src?: string };

export type DmEdition = {
  edition: string; title: string; by: string; note: string;
  grade?: string; // DM 이 다루는 등급(예: A+). 고객 등급과 같으면 표 강조가 DM 과 같아진다
  // 장표 위 글상자 문구. '■ 제목'·'[주제]'·'[주제]  영향' 줄은 소제목, 나머지는 글머리
  pages: {
    rates?: string[]; bok?: string[]; fomc?: string[]; views?: string[]; usviews?: string[]; forecast?: string[];
    credit_fc?: { high: { title: string; lines: string[] }; low: { title: string; lines: string[] } };
  };
  charts?: { rates?: DmChart[] };
  meetings?: { bok?: DmMeeting; fomc?: DmMeeting };
  issuePages?: { lines: string[]; charts: DmChart[] }[];
  forecastTable?: {
    title: string; unit: string; years: string[]; periods: string[];
    rows: { group: string; tenor: string | null; cells: string[] }[]; notes: string[];
  };
  issuance?: {
    lines: string[]; title: string; unit: string; year: string; ytdLabel: string; months: string[]; ytdHead: string[];
    rows: { key: string; label: string; cells: number[]; ytd26: number; ytd25: number; chg: number | null }[]; notes: string[];
  };
  liquidity?: { lines: string[]; tables: DmTable[] };
  issues: MarketIssue[];
  market: MarketSeries[];
};
// 제안서 데이터로 넘기는 부분(이슈·시장 지표는 DeckData.issues·market 으로 따로)
export type DmView = Omit<DmEdition, 'issues' | 'market' | 'note'>;

const EDITIONS = [e20261027 as unknown as DmEdition];

// 기준일 이전 판 중 가장 최근 것 (없으면 null)
export function dmFor(asof: string): DmEdition | null {
  return EDITIONS.filter((x) => x.edition <= asof).sort((a, b) => b.edition.localeCompare(a.edition))[0] ?? null;
}
export function dmView(e: DmEdition): DmView {
  const { issues: _i, market: _m, note: _n, ...rest } = e;
  return rest;
}

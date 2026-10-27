// Discussion Material(시장 자료) 판: 현업은 같은 시기 제안서의 시장 장표에 DM 문구·표를 그대로 쓰고 고객 등급 쪽만 맞춘다.
// 프로토타입은 공개 자료로 만든 DM 판을 파일로 두고, 기준일 이전 가장 최근 판을 제안서 시장 장표에 그대로 넣는다.
import e20261027 from './dm/2026-10-27.json';
import type { MarketIssue, MarketSeries } from './types';

export type DmEdition = {
  edition: string; title: string; by: string; note: string;
  pages: {
    rates?: string[]; bok?: string[]; views?: string[]; forecast?: string[];
    credit_fc?: { high: { title: string; lines: string[] }; low: { title: string; lines: string[] } };
  };
  issues: MarketIssue[];
  market: MarketSeries[];
};

const EDITIONS = [e20261027 as unknown as DmEdition];

// 기준일 이전 판 중 가장 최근 것 (없으면 null)
export function dmFor(asof: string): DmEdition | null {
  return EDITIONS.filter((x) => x.edition <= asof).sort((a, b) => b.edition.localeCompare(a.edition))[0] ?? null;
}

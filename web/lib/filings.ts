// 주요 공시: 묶음·기간·한 줄 요약 (화면과 AI 도구가 같이 쓴다)
import type { KeyFiling } from './types';

export const FILING_GROUPS = [
  { key: 'fund', grp: '자금 수요', hint: '단기차입금 증가, 신규 시설투자, CB 풋 취득, 자사주 처분, 채무보증·담보' },
  { key: 'gov', grp: '지배구조·M&A', hint: '최대주주 변경, 경영권 양수도, 지분·영업 양수도, 합병·분할' },
  { key: 'risk', grp: '신용·상장 위험', hint: '사채 원리금 미지급, 채권은행 관리, 회생, 부도, 상장폐지 사유·실질심사, 횡령·배임' },
  { key: 'asset', grp: '자산·실적', hint: '유형자산 취득·처분, 감자, 매출·손익 30% 이상 변동' },
] as const;

export type FilingGroupKey = (typeof FILING_GROUPS)[number]['key'];

export const FILING_PERIODS = [
  { key: '7', label: '1주', days: 7 },
  { key: '30', label: '1개월', days: 30 },
  { key: '90', label: '3개월', days: 90 },
] as const;

export const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export const daysAgo = (n: number, from = kstToday()) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n + 1);
  return d.toISOString().slice(0, 10);
};

// 공시 종류별로 먼저 보여 줄 값 (없으면 다음 값)
const PREFERRED: Record<string, string[]> = {
  d_stdebt: ['차입금액', '자기자본 대비', '차입 목적', '차입 형태'],
  d_capex: ['투자금액', '자기자본 대비', '투자 대상', '투자 목적'],
  d_control: ['변경 전 최대주주', '변경 후 최대주주', '변경 후 지분율', '양도인', '양수인', '양수금액', '예정 지분율', '계약 목적물', '변경 사유'],
  d_pledge: [],
  d_guarantee: ['채무보증금액', '담보제공금액', '채무자', '채무자와의 관계', '자기자본 대비'],
  d_plshock: ['흑자·적자 전환', '매출액 증감률', '영업이익 증감률', '당기순이익 증감률', '변동 주요원인'],
  d_treasury_sell: ['처분예정금액', '처분목적', '장외처분 주식수'],
  d_bond_default: ['미지급 금액', '사채 종류', '자기자본 대비', '미지급 사유'],
  d_capcut: ['감자비율', '감자사유', '감자기준일'],
  d_merger: ['합병 상대회사', '합병형태', '합병목적', '합병기일'],
  d_embezzle: ['발생 금액', '자기자본 대비'],
};
const SKIP = new Set(['공시', '공시일']);

export function factLine(f: KeyFiling, max = 3): { k: string; v: string }[] {
  const facts = f.facts ?? {};
  const keys = [...(PREFERRED[f.rule_key] ?? []), ...Object.keys(facts)];
  const out: { k: string; v: string }[] = [];
  for (const k of keys) {
    if (out.length >= max) break;
    if (SKIP.has(k) || !facts[k] || out.some((x) => x.k === k)) continue;
    out.push({ k, v: facts[k] });
  }
  return out;
}

export const isIssuer = (f: KeyFiling) => Boolean((f.bond_deal_count ?? 0) > 0 || f.latest_bond_rating || (f.outstanding_bond_krw ?? 0) > 0);

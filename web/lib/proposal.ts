// 제안서 초안: 딜 유형별 제안서 구성(장표)에 맞춰 공개 데이터로 채울 수 있는 부분을 채우고,
// 채울 수 없는 부분은 '추가로 받아야 할 데이터'와 받을 곳을 적는다.
// 장표 구성 근거: 이랜드월드 108 대표주관 제안서(14쪽), 레이크머티리얼즈 2CB 제안서 v1.0·vf, GI·SME 인터뷰.
// 문장은 규칙으로 만든다(숫자는 조회 값 그대로). 제안서에 옮겨 쓸 수 있게 '합니다'체로 쓰고, 전망·권유 문장은 쓰지 않는다.
import 'server-only';
import { bp, date, num, won } from './format';
import { daysAgo, factLine, kstToday } from './filings';
import { eul, eun, ro } from './josa';
import { feeByQuarter, leagueOf, type TrendDeal } from './period';
import {
  getBondIssuesBy, getCompany, getCompanyDeals, getKeyFilings, getMaturities, getRateLatest, getShortDebt, getTrend, getTrendDeals,
} from './queries';
import { comboStats, median } from './tranche';
import type { BondIssue, BondTrendRow, CompanyOverview, Deal, KeyFiling, Maturity, MezzTrendRow, RateLatest } from './types';

export type DraftType = 'bond' | 'mezz';
export const DRAFT_TYPES: { key: DraftType; label: string }[] = [
  { key: 'bond', label: '공모 회사채' },
  { key: 'mezz', label: '메자닌(CB·BW·EB)' },
];

export type Status = 'filled' | 'partial' | 'needed';
export const STATUS_LABEL: Record<Status, string> = { filled: '채움', partial: '일부', needed: '추가 필요' };

export type Need = { data: string; from: string };
export type Table = { head: string[]; rows: string[][]; num?: number[] };
export type Section = {
  key: string; title: string; status: Status;
  lines: string[]; table?: Table; needs?: Need[]; basis?: string;
};
export type Draft = { type: DraftType; company: CompanyOverview; asof: string; sections: Section[] };

// 날짜 도우미 ------------------------------------------------------------------
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftMonths = (n: number) => {
  const d = new Date(`${kstToday()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
};
const monthStart = (n: number) => {
  const t = new Date(`${kstToday()}T00:00:00Z`);
  return iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + n, 1)));
};
const rceptDate = (r: string | null | undefined) => (r && /^\d{8}/.test(r) ? `${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6, 8)}` : null);

// 평일 수 (공휴일 미반영)
export function weekdaysBetween(a: string, b: string) {
  const d = new Date(`${a}T00:00:00Z`);
  const e = new Date(`${b}T00:00:00Z`);
  let n = 0;
  while (d < e) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

const ratingGroupOf = (r: string | null | undefined) => {
  const m = String(r ?? '').match(/^(AAA|AA|A|BBB|BB|B)/);
  return m ? m[1] : null;
};
const pct0 = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v)}%`);
const ratio = (v: number | null | undefined) => (v == null ? '–' : `${num(Number(v), 2)}배`);
const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
const spreadRange = (i: BondIssue) =>
  i.spread_min_bp == null ? '–' : i.spread_min_bp === i.spread_max_bp ? bp(i.spread_min_bp) : `${bp(i.spread_min_bp)}~${bp(i.spread_max_bp)}`;
const amountPair = (i: { initial_amount_krw: number | null; amount_krw: number | null }) =>
  i.initial_amount_krw && i.amount_krw && i.initial_amount_krw !== i.amount_krw ? `${won(i.initial_amount_krw)} → ${won(i.amount_krw)}` : won(i.amount_krw);
// 직전 회차 문장: 증액·감액이면 최초 신고 금액을 함께 쓴다
// '1년' → '1년 단일 만기', '1년+2년' → '1년+2년 구조'
const structOf = (combo: string | null | undefined) => (!combo ? '' : combo.includes('+') ? `${combo} 구조` : `${combo} 단일 만기`);
const lastIssueLine = (i: BondIssue) => {
  const head = `직전 회차는 ${date(i.pricing_dt ?? i.deal_dt)} 수요예측을 거쳐 ${i.tenor_combo ? `${structOf(i.tenor_combo)}로 ` : ''}`;
  const a = won(i.amount_krw);
  const init = i.initial_amount_krw ? Number(i.initial_amount_krw) : null;
  const fin = i.amount_krw ? Number(i.amount_krw) : null;
  const body = init && fin && fin > init
    ? `발행했으며, 최초 신고 금액 ${won(init)}에서 ${a}${ro(a)} 증액했습니다.`
    : init && fin && fin < init
      ? `${a}${eul(a)} 발행했습니다(최초 신고 금액 ${won(init)}).`
      : `${a}${eul(a)} 발행했습니다.`;
  return `${head}${body}${i.competition_ratio != null ? ` 수요예측 경쟁률은 ${ratio(i.competition_ratio)}였습니다.` : ''}`;
};
const mkt = (m: string | null | undefined) => (m === '유가증권' ? '유가증권시장' : m ?? '');
const sum = <T,>(xs: T[], f: (x: T) => number | null | undefined) => xs.reduce((s, x) => s + Number(f(x) ?? 0), 0);

// 공통 장표 ----------------------------------------------------------------------
function filingsSection(filings: KeyFiling[]): Section {
  if (!filings.length) {
    return {
      key: 'filings', title: '최근 주요 공시', status: 'filled',
      lines: ['최근 120일간 자금 수요, 지배구조, 신용 위험과 관련한 주요 공시는 없습니다.'], basis: 'DART 주요사항보고서·거래소 공시',
    };
  }
  const kinds = [...new Set(filings.map((f) => f.label))];
  return {
    key: 'filings', title: '최근 주요 공시', status: 'filled',
    lines: [`최근 120일간 주요 공시는 ${filings.length}건(${kinds.slice(0, 4).join(', ')}${kinds.length > 4 ? ' 등' : ''})입니다. 제안 전에 자금 수요와 리스크 요인을 확인하시기 바랍니다.`],
    table: {
      head: ['공시일', '종류', '내용'],
      rows: filings.slice(0, 8).map((f) => [date(f.rcept_dt), f.label, factLine(f, 3).map((x) => `${x.k} ${x.v}`).join(', ') || f.report_nm]),
    },
    basis: 'DART 주요사항보고서·거래소 공시(원문에서 읽은 값)',
  };
}

// 공모 회사채 ----------------------------------------------------------------------
async function bondSections(c: CompanyOverview): Promise<Section[]> {
  const today = kstToday();
  const [deals, own, sdRows, upcoming, filings, rates, trend, tdeals] = await Promise.all([
    getCompanyDeals(c.corp_code).catch(() => [] as Deal[]),
    getBondIssuesBy({ corp: c.corp_code, limit: 30 }).catch(() => [] as BondIssue[]),
    getShortDebt(1, c.corp_code).catch(() => []),
    getMaturities({ from: today, to: shiftMonths(24), corp: c.corp_code }).catch(() => [] as Maturity[]),
    getKeyFilings({ since: daysAgo(120), corps: [c.corp_code] }).catch(() => [] as KeyFiling[]),
    getRateLatest().catch(() => [] as RateLatest[]),
    getTrend<BondTrendRow>('bond', monthStart(-15)).catch(() => [] as BondTrendRow[]),
    getTrendDeals('bond', shiftMonths(-12)).catch(() => [] as TrendDeal[]),
  ]);
  const last = own[0];
  const group = (last?.rating_group && last.rating_group !== '등급 미확인' ? last.rating_group : null) ?? ratingGroupOf(c.latest_bond_rating);
  const peers = group ? await getBondIssuesBy({ ratingGroup: group, since: shiftMonths(-12), limit: 1000 }).catch(() => [] as BondIssue[]) : [];
  const recent = peers.filter((p) => (p.pricing_dt ?? p.deal_dt ?? '') >= shiftMonths(-6));
  const name = c.corp_name;
  const out: Section[] = [];

  // 1. 발행사 현황
  if (last) {
    const rating = c.latest_bond_rating ?? last.rating ?? '등급 미확인';
    out.push({
      key: 'issuer', title: '발행사 현황', status: 'filled',
      lines: [
        `${name}${eun(name)} 2019년 이후 공모 회사채를 ${own.length}회 발행했으며, 최근 신용등급은 ${rating}입니다.`,
        lastIssueLine(last),
        ...(c.outstanding_bond_krw ? [`정기보고서 기준 회사채 미상환 잔액은 ${won(c.outstanding_bond_krw)}입니다.`] : []),
      ],
      table: {
        head: ['수요예측일', '등급', '구조', '최초 → 확정', '경쟁률', '가산금리', '대표주관'],
        rows: own.slice(0, 5).map((i) => [date(i.pricing_dt ?? i.deal_dt), i.rating ?? '–', i.tenor_combo || '–', amountPair(i), ratio(i.competition_ratio), spreadRange(i), i.lead_managers ?? '–']),
        num: [3, 4, 5],
      },
      basis: 'DART 증권신고서·발행조건확정 공시, 정기보고서',
    });
  } else {
    out.push({
      key: 'issuer', title: '발행사 현황', status: 'partial',
      lines: [`${name}${eun(name)} 2019년 이후 공모 회사채 발행 이력이 없습니다. 첫 공모채 발행이라면 신용등급 본평가 절차가 먼저 필요합니다.`],
      needs: [{ data: '신용등급(예비 평가)', from: '신용평가사' }, { data: '재무 현황·자금 사용 계획', from: '발행사' }],
    });
  }

  // 2. 차환 수요
  const mats = upcoming.filter((m) => m.product_type === 'bond' && m.event_type === '만기');
  const in1y = mats.filter((m) => m.days_left <= 365);
  const sd = sdRows[0];
  out.push({
    key: 'refi', title: '만기 구조와 차환 수요', status: 'filled',
    lines: [
      mats.length
        ? in1y.length === mats.length
          ? `향후 1년 내 공모 회사채 ${mats.length}건, ${won(sum(mats, (m) => m.amount_krw))}의 만기가 도래합니다.`
          : `향후 2년 내 공모 회사채 ${mats.length}건, ${won(sum(mats, (m) => m.amount_krw))}의 만기가 도래하며, ${in1y.length ? `이 중 1년 내 도래분은 ${won(sum(in1y, (m) => m.amount_krw))}입니다` : '1년 내 도래분은 없습니다'}.`
        : '향후 2년 내 만기가 도래하는 공모 회사채는 없습니다.',
      ...(sd?.total_1y_krw != null
        ? [(() => {
          const parts = [['회사채', sd.bond_1y_krw], ['CP', sd.cp_1y_krw], ['단기사채', sd.stb_krw]]
            .filter(([, v]) => v != null && Number(v) > 0).map(([k, v]) => `${k} ${won(Number(v))}`);
          return `${date(sd.stlm_dt)} 정기보고서 기준 1년 내 만기가 도래하는 차입금은 ${parts.length === 1 ? parts[0] : `${won(sd.total_1y_krw)}${parts.length ? `(${parts.join(', ')})` : ''}`}입니다.`;
        })()]
        : []),
    ],
    table: mats.length
      ? {
        head: ['만기일', '증권', '금액', '금리', '당시 대표주관'],
        rows: mats.slice(0, 8).map((m) => [date(m.event_dt), `제${m.series}회 ${m.sub_type ?? ''}`.trim(), won(m.amount_krw), m.coupon_pct != null ? `${num(Number(m.coupon_pct), 2)}%` : '–', m.lead_managers ?? '–']),
        num: [2, 3],
      }
      : undefined,
    basis: 'DART 발행 공시, 정기보고서 미상환 잔액',
  });

  // 3. 최근 주요 공시
  out.push(filingsSection(filings));

  // 4. 시장 동향
  const general = trend.filter((r) => (r.category ?? '') === '일반회사채');
  const ym = (n: number) => monthStart(n).slice(0, 7);
  const curMonths = [ym(-3), ym(-2), ym(-1)];
  const prevMonths = [ym(-15), ym(-14), ym(-13)];
  const amt = (ms: string[]) => sum(general.filter((r) => ms.includes(r.month.slice(0, 7))), (r) => r.amount_krw);
  const cnt = (ms: string[]) => sum(general.filter((r) => ms.includes(r.month.slice(0, 7))), (r) => r.deal_count);
  const a1 = amt(curMonths);
  const a0 = amt(prevMonths);
  const chg = a0 ? ((a1 - a0) / a0) * 100 : null;
  const rate = (k: string) => rates.find((r) => r.series_key === k);
  const aa = rate('corp3y_aa');
  const ktb = rate('ktb3y');
  out.push({
    key: 'market', title: '시장 동향', status: 'filled',
    lines: [
      `최근 3개월(${curMonths[0].replace('-', '.')}~${curMonths[2].replace('-', '.')}) 일반 공모 회사채 발행 규모는 ${won(a1)}(${cnt(curMonths)}건)${chg == null ? '입니다' : `${ro(won(a1))}, 전년 동기 대비 ${Math.abs(Math.round(chg))}% ${chg >= 0 ? '증가했습니다' : '감소했습니다'}`}.`,
      ...(aa && ktb ? [(() => {
        const gap = Math.round((Number(aa.value) - Number(ktb.value)) * 100);
        return `${date(aa.dt)} 기준 ${aa.label_ko} 금리는 ${num(Number(aa.value), 3)}%로, ${ktb.label_ko} 대비 ${Math.abs(gap)}bp ${gap >= 0 ? '높은' : '낮은'} 수준입니다.`;
      })()] : []),
    ],
    table: rates.length
      ? {
        head: ['지표', '금리', '1개월 변화', '기준일'],
        rows: rates.filter((r) => ['base_rate', 'ktb3y', 'ktb5y', 'corp3y_aa', 'corp3y_bbb', 'cd91'].includes(r.series_key))
          .map((r) => [r.label_ko, `${num(Number(r.value), 3)}%`, r.chg_1m_bp == null ? '–' : bp(Number(r.chg_1m_bp)), date(r.dt)]),
        num: [1, 2],
      }
      : undefined,
    basis: 'DART 발행 공시 집계(일반회사채), 한국은행 ECOS',
  });

  // 5. 금리 전망
  out.push({
    key: 'outlook', title: '금리 전망', status: 'needed',
    lines: ['금리 전망은 공개 데이터로 작성하지 않으며, 리서치센터의 전망 자료를 받아 반영합니다.'],
    needs: [{ data: '기준금리·국고채 금리 전망', from: '리서치센터' }],
  });

  // 6. 같은 등급 수요예측 사례
  if (!group) {
    out.push({
      key: 'peers', title: '같은 등급 수요예측 사례', status: 'needed',
      lines: ['신용등급을 확인할 수 없어 비교 대상 등급군을 정하지 못했습니다.'],
      needs: [{ data: '예상 신용등급', from: '신용평가사·발행사' }],
    });
  } else {
    const known = recent.filter((p) => p.competition_ratio != null);
    const initKnown = recent.filter((p) => p.initial_amount_krw != null);
    out.push({
      key: 'peers', title: `같은 등급(${group}급) 수요예측 사례`, status: recent.length ? 'filled' : 'partial',
      lines: recent.length
        ? [
          known.length
            ? `최근 6개월간 ${group}급 공모 회사채는 ${recent.length}건 발행되었으며, ${known.length === recent.length ? '' : `경쟁률이 공시된 ${known.length}건 기준 `}수요예측 경쟁률 중간값은 ${ratio(median(known.map((p) => p.competition_ratio)))}입니다.`
            : `최근 6개월간 ${group}급 공모 회사채는 ${recent.length}건 발행되었으나, 경쟁률이 공시된 건은 없습니다.`,
          ...(initKnown.length ? [`최초 신고 금액이 확인되는 ${initKnown.length}건 중 증액 발행 비율은 ${pct0(share(initKnown.filter((p) => p.is_increased).length, initKnown.length))}입니다.`] : []),
        ]
        : [`최근 6개월간 ${group}급 공모 회사채 발행은 없습니다.`],
      table: recent.length
        ? {
          head: ['수요예측일', '발행사', '등급', '구조', '최초 → 확정', '경쟁률', '가산금리'],
          rows: recent.slice(0, 8).map((p) => [date(p.pricing_dt ?? p.deal_dt), p.corp_name, p.rating ?? '–', p.tenor_combo || '–', amountPair(p), ratio(p.competition_ratio), spreadRange(p)]),
          num: [4, 5, 6],
        }
        : undefined,
      basis: 'DART 발행조건확정 공시(수요예측 결과·확정 가산금리)',
    });
  }

  // 7. 미달 사례
  if (group) {
    const under = peers.filter((p) => p.is_undersubscribed);
    const known12 = peers.filter((p) => p.competition_ratio != null);
    out.push({
      key: 'under', title: '미달·미매각 사례', status: 'filled',
      lines: [under.length
        ? known12.length === peers.length
          ? `최근 12개월간 ${group}급 공모 회사채 ${peers.length}건 중 미달은 ${under.length}건(${pct0(share(under.length, known12.length))})입니다.`
          : `최근 12개월간 ${group}급 공모 회사채 ${peers.length}건 중 경쟁률이 공시된 ${known12.length}건을 기준으로 보면, 미달은 ${under.length}건(${pct0(share(under.length, known12.length))})입니다.`
        : known12.length === peers.length
          ? `최근 12개월간 ${group}급 공모 회사채 ${peers.length}건 중 미달 사례는 없습니다.`
          : `최근 12개월간 ${group}급 공모 회사채 ${peers.length}건 중 경쟁률이 공시된 ${known12.length}건에서는 미달 사례가 없습니다.`],
      table: under.length
        ? {
          head: ['수요예측일', '발행사', '등급', '모집액', '미달 트랜치', '대표주관'],
          rows: under.slice(0, 6).map((u) => {
            const t = (u.tranches ?? []).find((x) => x.is_undersubscribed);
            return [date(u.pricing_dt ?? u.deal_dt), u.corp_name, u.rating ?? '–', won(u.initial_amount_krw ?? u.amount_krw),
              t ? `${t.tenor_label ?? t.tenor_bucket} ${ratio(t.competition_ratio)}` : ratio(u.competition_ratio), u.lead_managers ?? '–'];
          }),
          num: [3],
        }
        : undefined,
      basis: 'DART 발행조건확정 공시',
    });
  }

  // 8. 수요예측 참여기관
  out.push({
    key: 'investors', title: '수요예측 참여기관 분석', status: 'needed',
    lines: ['수요예측 결과 공시에는 기관 유형별 합계만 있고 기관명은 공개되지 않아, 기관별 분석에는 내부 자료가 필요합니다.'],
    needs: [{ data: '기관별 수요예측 참여 이력(실명)', from: '신디케이션본부' }],
  });

  // 9. 발행 구조안
  const combos = comboStats(recent, 5);
  out.push({
    key: 'structure', title: '발행 구조안', status: 'partial',
    lines: [
      ...(combos[0] ? [`최근 6개월간 ${group}급에서 가장 많이 쓰인 만기 구조는 ${combos[0].combo}(${pct0(combos[0].share)})입니다.`] : []),
      ...(last?.tenor_combo ? [`직전 회차는 ${structOf(last.tenor_combo)}로 발행했습니다.`] : []),
      '발행 금액, 만기 구성, 금리밴드는 발행사의 자금 계획을 반영해 결정합니다. 아래 표를 판단 근거로 활용하시기 바랍니다.',
    ],
    table: combos.length
      ? {
        head: ['구조', '발행', '비중', '평균 발행액', '경쟁률 중간값', '증액 비율'],
        rows: combos.map((r) => [r.combo, `${r.issues}건`, pct0(r.share), won(r.avgAmount), ratio(r.medComp), pct0(r.incShare)]),
        num: [1, 2, 3, 4, 5],
      }
      : undefined,
    needs: [{ data: '발행 금액·만기 구성·금리밴드', from: 'RM 판단(발행사 자금 계획 반영)' }],
    basis: 'DART 발행조건확정 공시(트랜치 묶음)',
  });

  // 10. 발행 일정안
  const lastDeals = last ? deals.filter((d) => (last.tranches ?? []).some((t) => t.deal_key === d.deal_key)) : [];
  const filed = lastDeals.map((d) => rceptDate((d as Deal & { first_rcept_no?: string | null }).first_rcept_no)).filter(Boolean).sort()[0] ?? null;
  const priced = last?.pricing_dt ?? null;
  const paid = last?.deal_dt ?? null;
  out.push({
    key: 'schedule', title: '발행 일정안', status: 'partial',
    lines: filed && priced && paid
      ? [`직전 회차는 증권신고서 제출(${date(filed)}) 후 ${weekdaysBetween(filed, priced)}영업일째에 수요예측을, ${weekdaysBetween(filed, paid)}영업일째에 납입을 진행했습니다(공휴일 미반영).`]
      : ['직전 회차 일정 정보가 없어, 일정표 규칙에 따라 별도로 산정해야 합니다.'],
    needs: [{ data: '공휴일을 반영한 발행 일정표(이사회·신고서·수요예측·납입)', from: 'RA 일정표 규칙(I-21)' }],
    basis: 'DART 공시 접수일·수요예측일·납입일',
  });

  // 11. 인수 조건·수수료
  const feeOf = (d: TrendDeal) => (d.fee_krw != null && d.uw_amount_krw ? (Number(d.fee_krw) / Number(d.uw_amount_krw)) * 1e4 : null);
  const feeAll = median(tdeals.map(feeOf));
  const feeGrp = group ? median(tdeals.filter((d) => d.rating_group === group).map(feeOf)) : null;
  const quarters = feeByQuarter(tdeals).slice(-4);
  const lowGrade = group === 'BBB' || group === 'BB' || group === 'B';
  out.push({
    key: 'terms', title: '인수 조건·수수료', status: 'partial',
    lines: [
      ...(feeAll != null ? [`최근 12개월 공모 회사채 인수수수료율 중간값은 전체 ${num(feeAll, 1)}bp${feeGrp != null ? `, ${group}급 ${num(feeGrp, 1)}bp` : ''}입니다.`] : []),
      ...(lowGrade ? [`${group}급 딜은 인수 심사(투자실무협의회·리스크관리협의회) 대상이므로, 심사 일정을 함께 계획해야 합니다.`] : []),
    ],
    table: quarters.length
      ? {
        head: ['분기', '건수', '인수금액', '수수료율'],
        rows: quarters.map((q) => [`${q.q.slice(2, 4)}년 ${Math.floor(Number(q.q.slice(5, 7)) / 3) + 1}분기`, `${q.n}건`, won(q.uw), `${num((q.fee / q.uw) * 1e4, 1)}bp`]),
        num: [1, 2, 3],
      }
      : undefined,
    needs: [{ data: '총액인수 가능액(Book·RWA 잔여 한도)', from: '리스크관리부' }, { data: 'NH 제안 수수료', from: '부서 기준' }],
    basis: 'DART 증권신고서(인수인·인수대가)',
  });

  // 12. 대표주관 실적·트랙레코드
  const gen = tdeals.filter((d) => (d.sub_type ?? '일반회사채') === '일반회사채');
  const league = leagueOf(gen, 999);
  const total = sum(league, (r) => r.credit);
  const nhIdx = league.findIndex((r) => r.isNh);
  const nhGroup = group ? peers.filter((p) => p.nh_lead).length : 0;
  const nhOwn = own.filter((i) => i.nh_lead).length;
  out.push({
    key: 'track', title: '대표주관 실적·트랙레코드', status: 'filled',
    lines: [
      ...(nhIdx >= 0 ? [`최근 12개월 일반 공모 회사채 대표주관 실적에서 NH투자증권은 ${nhIdx + 1}위(점유율 ${num(share(league[nhIdx].credit, total), 1)}%)입니다.`] : []),
      ...(group ? [`같은 기간 ${group}급 공모 회사채 중 NH투자증권이 대표주관을 맡은 딜은 ${nhGroup}건입니다.`] : []),
      ...(own.length ? [`${name}의 공모 회사채 ${own.length}회 중 NH투자증권이 대표주관을 맡은 회차는 ${nhOwn}회입니다.`] : []),
      'NH투자증권 대표주관 딜 목록은 발행 동향 화면에서 CSV로 내려받을 수 있습니다.',
    ],
    table: league.length
      ? {
        head: ['순위', '증권사', '대표주관 건수', '실적', '점유율'],
        rows: [...league.slice(0, 5), ...(nhIdx >= 5 ? [league[nhIdx]] : [])].map((r) => [String(league.indexOf(r) + 1), r.firm, `${r.deals}건`, won(r.credit), `${num(share(r.credit, total), 1)}%`]),
        num: [0, 2, 3, 4],
      }
      : undefined,
    basis: 'DART 증권신고서(대표주관회사), 공동 대표주관은 금액을 나눠 집계',
  });

  return out;
}

// 메자닌 --------------------------------------------------------------------------
async function mezzSections(c: CompanyOverview): Promise<Section[]> {
  const today = kstToday();
  const [deals, upcoming, filings, tdeals, trend] = await Promise.all([
    getCompanyDeals(c.corp_code).catch(() => [] as Deal[]),
    getMaturities({ from: today, to: shiftMonths(24), corp: c.corp_code }).catch(() => [] as Maturity[]),
    getKeyFilings({ since: daysAgo(120), corps: [c.corp_code] }).catch(() => [] as KeyFiling[]),
    getTrendDeals('mezz', shiftMonths(-6)).catch(() => [] as TrendDeal[]),
    getTrend<MezzTrendRow>('mezz', monthStart(-6)).catch(() => [] as MezzTrendRow[]),
  ]);
  const name = c.corp_name;
  const listed = c.market && c.market !== '기타';
  const sameMarket = listed ? tdeals.filter((d) => d.market === c.market) : tdeals;
  const mz = deals.filter((d) => d.product_type === 'mezz');
  const lastMz = mz[0];
  const out: Section[] = [];

  // 1. 회사 현황
  out.push({
    key: 'company', title: '회사 현황', status: 'partial',
    lines: [`${name}${eun(name)} ${listed ? `${mkt(c.market)} 상장사` : '비상장사'}입니다. 수집 기간 중 발행 이력은 공모 회사채 ${c.bond_deal_count}건, 메자닌 ${c.mezz_deal_count}건, 유상증자 ${c.equity_deal_count}건입니다.`],
    needs: [{ data: '시가총액·주가·발행주식수', from: 'KRX 시세(연동 예정)' }],
  });

  // 2. 기존 메자닌 발행 이력
  out.push(mz.length
    ? {
      key: 'history', title: '기존 메자닌 발행 이력', status: 'filled',
      lines: [`2020년 이후 메자닌을 ${mz.length}회 발행했으며, 직전 발행은 ${date(lastMz.announce_dt ?? lastMz.deal_dt)} ${lastMz.sub_type ?? '메자닌'} ${won(lastMz.amount_krw)}입니다.`],
      table: {
        head: ['결정일', '종류', '금액', '표면/만기', '전환가', '리픽싱 하한', '풋 시작'],
        rows: mz.slice(0, 6).map((d) => [
          date(d.announce_dt ?? d.deal_dt), `${d.sub_type ?? ''}${d.series ? ` 제${d.series}회` : ''}`.trim() || '–', won(d.amount_krw),
          d.coupon_pct != null || d.ytm_pct != null ? `${num(Number(d.coupon_pct ?? 0), 1)}% / ${num(Number(d.ytm_pct ?? 0), 1)}%` : '–',
          d.conv_price != null ? `${num(Number(d.conv_price))}원` : '–', d.refix_floor_ratio_pct != null ? `${num(Number(d.refix_floor_ratio_pct))}%` : '–', date(d.put_start_dt),
        ]),
        num: [2, 4, 5],
      },
      basis: 'DART 주요사항보고서(전환사채·신주인수권부사채·교환사채 발행결정)',
    }
    : {
      key: 'history', title: '기존 메자닌 발행 이력', status: 'filled',
      lines: ['2020년 이후 메자닌 발행 이력은 없습니다.'],
    });

  // 3. 풋옵션·만기 일정
  const ev = upcoming.filter((m) => m.product_type === 'mezz');
  out.push({
    key: 'puts', title: '풋옵션·만기 일정', status: 'filled',
    lines: [ev.length
      ? `향후 2년 내 메자닌 풋옵션·만기 일정이 ${ev.length}건 있으며, 가장 빠른 일정은 ${date(ev[0].event_dt)} ${ev[0].event_type}입니다. 상환 재원과 재발행 수요를 함께 검토하시기 바랍니다.`
      : '향후 2년 내 도래하는 메자닌 풋옵션·만기 일정은 없습니다.'],
    table: ev.length
      ? { head: ['날짜', '구분', '증권', '금액'], rows: ev.slice(0, 6).map((m) => [date(m.event_dt), m.event_type, `${m.sub_type ?? ''}${m.series && m.series.length <= 6 ? ` 제${m.series}회` : ''}`.trim(), won(m.amount_krw)]), num: [3] }
      : undefined,
    basis: 'DART 발행결정 공시의 조기상환청구권 조항',
  });

  // 4. 정관상 발행 한도
  out.push(c.articles_remaining_krw != null
    ? {
      key: 'articles', title: '정관상 발행 한도', status: 'filled',
      lines: [`직전 발행 공시 기준 정관상 메자닌 잔여 발행 한도는 ${won(c.articles_remaining_krw)}입니다.`], basis: 'DART 발행결정 공시(정관상 발행 한도·기발행액)',
    }
    : {
      key: 'articles', title: '정관상 발행 한도', status: 'needed',
      lines: ['발행 공시가 없어 정관상 잔여 발행 한도를 확인할 수 없습니다.'], needs: [{ data: '정관상 CB·BW 발행 한도', from: '정관(사업보고서 첨부)·발행사' }],
    });

  // 5. 최근 주요 공시
  out.push(filingsSection(filings));

  // 6. 메자닌 시장 동향
  const zero = sameMarket.filter((d) => d.coupon_pct === 0 && d.ytm_pct === 0).length;
  const refixKnown = sameMarket.filter((d) => d.refix_floor_ratio_pct != null);
  const refixLow = refixKnown.filter((d) => Number(d.refix_floor_ratio_pct) <= 70).length;
  const pub = sameMarket.filter((d) => d.is_public).length;
  const byKind = ['CB', 'BW', 'EB'].map((k) => {
    const ds = sameMarket.filter((d) => (d.sub_type ?? '').includes(k));
    return { k, n: ds.length, amt: sum(ds, (d) => d.amount_krw), zero: ds.filter((d) => d.coupon_pct === 0 && d.ytm_pct === 0).length };
  }).filter((r) => r.n);
  out.push({
    key: 'market', title: `메자닌 시장 동향${listed ? `(${c.market})` : ''}`, status: 'filled',
    lines: [
      `최근 6개월간 ${listed ? `${mkt(c.market)} ` : ''}메자닌 발행은 ${sameMarket.length}건, ${won(sum(sameMarket, (d) => d.amount_krw))} 규모입니다.`,
      `표면·만기 이자율이 모두 0%인 비중은 ${pct0(share(zero, sameMarket.length))}, 만기 이자율 중간값은 ${num(median(sameMarket.map((d) => d.ytm_pct)), 1)}%, 리픽싱 하한 70% 이하 비중은 ${pct0(share(refixLow, refixKnown.length))}, 공모 비중은 ${pct0(share(pub, sameMarket.length))}입니다.`,
    ],
    table: byKind.length
      ? { head: ['종류', '건수', '금액', '0%/0% 비중'], rows: byKind.map((r) => [r.k, `${r.n}건`, won(r.amt), pct0(share(r.zero, r.n))]), num: [1, 2, 3] }
      : undefined,
    basis: 'DART 발행결정 공시 집계(결정일 기준)',
  });

  // 7. 비슷한 조건 사례
  const refAmt = Number(lastMz?.amount_krw ?? median(sameMarket.map((d) => d.amount_krw)) ?? 0);
  const comps = sameMarket
    .filter((d) => d.corp_code !== c.corp_code && d.amount_krw && (!refAmt || (Number(d.amount_krw) >= refAmt * 0.5 && Number(d.amount_krw) <= refAmt * 2)))
    .sort((a, b) => b.deal_dt.localeCompare(a.deal_dt))
    .slice(0, 8);
  out.push({
    key: 'comps', title: '비슷한 규모의 최근 발행', status: comps.length ? 'filled' : 'partial',
    lines: [comps.length
      ? `같은 시장의 최근 6개월 발행 중 규모가 ${won(refAmt)}의 0.5~2배인 사례는 ${comps.length}건입니다.`
      : '같은 시장에서 비슷한 규모의 최근 발행 사례를 찾지 못했습니다.'],
    table: comps.length
      ? {
        head: ['결정일', '발행사', '종류', '금액', '표면/만기', '리픽싱 하한', '방식'],
        rows: comps.map((d) => [date(d.deal_dt), d.corp_name, d.sub_type ?? '–', won(d.amount_krw),
          d.coupon_pct != null || d.ytm_pct != null ? `${num(Number(d.coupon_pct ?? 0), 1)}% / ${num(Number(d.ytm_pct ?? 0), 1)}%` : '–',
          d.refix_floor_ratio_pct != null ? `${num(Number(d.refix_floor_ratio_pct))}%` : '–', d.is_public ? '공모' : d.is_public === false ? '사모' : '–']),
        num: [3, 5],
      }
      : undefined,
    basis: 'DART 발행결정 공시',
  });

  // 8. 제안 조건안
  out.push({
    key: 'terms', title: '제안 조건안', status: 'partial',
    lines: ['발행 규모, 만기, 할증률, 콜·풋 조건은 발행사의 자금 계획을 반영해 결정합니다. 앞의 시장 동향과 비슷한 규모의 발행 사례를 근거로 활용하시기 바랍니다.'],
    needs: [{ data: '발행 규모·만기·할증률·콜/풋 조건', from: 'RM 판단(발행사 자금 계획 반영)' }],
  });

  // 9. 예상 전환가·지분 희석
  const sr = trend.filter((r) => (!listed || r.market === c.market) && r.avg_shares_ratio_pct != null);
  const srW = sum(sr, (r) => r.deal_count) ? sum(sr, (r) => Number(r.avg_shares_ratio_pct) * r.deal_count) / sum(sr, (r) => r.deal_count) : null;
  out.push({
    key: 'dilution', title: '예상 전환가·지분 희석', status: srW != null ? 'partial' : 'needed',
    lines: [
      ...(srW != null ? [`최근 6개월간 같은 시장 메자닌의 발행주식 대비 전환주식 비율은 평균 ${num(srW, 1)}%입니다.`] : []),
      '이 회사의 예상 전환가와 지분 희석률은 기준주가와 발행주식수를 확보한 뒤 산정할 수 있습니다.',
    ],
    needs: [{ data: '기준주가·발행주식수', from: 'KRX 시세(연동 예정)' }],
  });

  // 10. 최대주주 지분율
  const ctrl = filings.find((f) => f.rule_key === 'd_control' && (f.facts?.['변경 후 최대주주'] || f.facts?.['양수인']));
  out.push(ctrl
    ? {
      key: 'owner', title: '최대주주 지분율', status: 'partial',
      lines: [`${date(ctrl.rcept_dt)} 최대주주 변경 공시 기준 최대주주는 ${ctrl.facts['변경 후 최대주주'] ?? ctrl.facts['양수인']}${ctrl.facts['변경 후 지분율'] ?? ctrl.facts['예정 지분율'] ? `(지분율 ${ctrl.facts['변경 후 지분율'] ?? ctrl.facts['예정 지분율']})` : ''}입니다.`],
      needs: [{ data: '최신 최대주주·특수관계인 지분율', from: 'OpenDART 정기보고서 최대주주 현황(수집 예정)' }],
    }
    : {
      key: 'owner', title: '최대주주 지분율', status: 'needed',
      lines: ['최대주주 지분율 데이터는 아직 수집하지 않고 있습니다.'],
      needs: [{ data: '최대주주·특수관계인 지분율', from: 'OpenDART 정기보고서 최대주주 현황(수집 예정)' }],
    });

  // 11~13. 내부·비공개 자료
  out.push({
    key: 'demand', title: '투자자 수요', status: 'needed',
    lines: ['투자 의향(LOC)은 공시 대상이 아니어서, 투자자 접촉을 통해 확인해야 합니다.'], needs: [{ data: 'LOC·투자 의향', from: 'RM·투자자 접촉(비공개)' }],
  });
  out.push({
    key: 'track', title: '트랙레코드', status: 'needed',
    lines: ['사모 메자닌은 공시에 주선사가 거의 기재되지 않아(최근 1년 635건 중 11건), 공개 데이터로는 실적을 산출할 수 없습니다.'],
    needs: [{ data: 'NH 메자닌 주선 실적', from: 'SME부 내부 실적' }],
  });
  out.push({
    key: 'legal', title: '규제·회계 검토', status: 'needed',
    lines: ['콜옵션·리픽싱 관련 감독 기준과 회계 처리는 과거 제안서와 법무 검토 자료로 보완합니다.'],
    needs: [{ data: '콜옵션 감독지침·회계처리·관련 사례', from: '법무·과거 제안서' }],
  });

  return out;
}

export function defaultType(c: CompanyOverview): DraftType {
  return c.bond_deal_count > 0 || c.latest_bond_rating ? 'bond' : 'mezz';
}

export async function buildDraft(corp: string, type?: DraftType): Promise<Draft | null> {
  const company = await getCompany(corp);
  if (!company) return null;
  const t = type ?? defaultType(company);
  const sections = t === 'bond' ? await bondSections(company) : await mezzSections(company);
  return { type: t, company, asof: kstToday(), sections };
}

export function needsOf(d: Draft) {
  return d.sections.flatMap((s, i) => (s.needs ?? []).map((n) => ({ ...n, section: s.title, no: i + 1 })));
}

// 내려받기용 마크다운
export function toMarkdown(d: Draft) {
  const label = DRAFT_TYPES.find((x) => x.key === d.type)!.label;
  const cnt = (s: Status) => d.sections.filter((x) => x.status === s).length;
  const esc = (v: string) => v.replace(/\|/g, '\\|');
  const out: string[] = [
    `# ${d.company.corp_name} ${label} 제안서 초안`,
    '',
    `- 기준일 ${d.asof} · 출처: DART(OpenDART), 한국은행 ECOS · 장표 ${d.sections.length}개 중 채움 ${cnt('filled')}, 일부 ${cnt('partial')}, 추가 필요 ${cnt('needed')}`,
    '- 숫자는 공시 값 그대로입니다. 제안서에 옮기기 전에 공시 원문을 확인하시기 바랍니다.',
    '',
  ];
  d.sections.forEach((s, i) => {
    out.push(`## ${String(i + 1).padStart(2, '0')}. ${s.title} — ${STATUS_LABEL[s.status]}`, '');
    for (const l of s.lines) out.push(l, '');
    if (s.table) {
      out.push(`| ${s.table.head.map(esc).join(' | ')} |`, `| ${s.table.head.map(() => '---').join(' | ')} |`);
      for (const r of s.table.rows) out.push(`| ${r.map(esc).join(' | ')} |`);
      out.push('');
    }
    if (s.needs?.length) {
      out.push('추가로 받아야 할 데이터:');
      for (const n of s.needs) out.push(`- ${n.data} — ${n.from}`);
      out.push('');
    }
    if (s.basis) out.push(`*출처: ${s.basis}*`, '');
  });
  const needs = needsOf(d);
  if (needs.length) {
    out.push('## 추가로 받아야 할 데이터 (요청 목록)', '');
    for (const n of needs) out.push(`- [ ] ${n.data} — ${n.from} (${String(n.no).padStart(2, '0')}. ${n.section})`);
    out.push('');
  }
  return out.join('\n');
}

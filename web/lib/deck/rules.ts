// 기본 입력값과 규칙 문안. AI 문안이 없거나 검증에 실패하면 이 문안을 쓴다.
// 문체: 제안서 개조식(~진행, ~제안, ~수준). 숫자는 데이터 값 그대로, 계산값은 차이·비율만.
import { bandText, bpS, eok, eokW, mdw, ratioX, rate2, rate3, shortFirm, tenorYears, yy, yymmdd } from './fmt';
import { BizCal, buildSchedule, korDate, type Schedule } from './schedule';
import { defaultItems } from './catalog';
import { timingOf, timingPlan, timingText } from './timing';
import { fullYearLoads, maturityBuckets, meetingVolatility, mixOf, notchStats, pp, proposedMaturityLoad, spreadVsKtb, suspectOf, tenorDemand, tenorMix, trRatio, typedIssues, typedTranches, yearsOf } from './analytics';
import type { DeckData, DeckInput, DeckText, PeerIssue, TermNotes } from './types';
import { eul, eun, ro } from '../josa';

const median = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && !Number.isNaN(Number(x))).map(Number).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const nextSeries = (s: string | null) => {
  const m = String(s ?? '').match(/^(\d+)/);
  return m ? String(Number(m[1]) + 1) : '';
};
const pd = (p: PeerIssue) => p.demand_dt ?? p.pricing_dt ?? p.deal_dt ?? '';
// 전체 경쟁률이 1배 미만이면 미매각, 일부 트랜치만 미달이면 '일부 트랜치 미달'
export const fullUnder = (p: PeerIssue) => p.ratio != null ? p.ratio < 1 : !!p.under;
export function verdictOf(p: PeerIssue, cell: boolean) {
  if (fullUnder(p)) return '!!수요예측 미달!!';
  if (p.under) return '!!일부 트랜치 미달!!';
  if (p.ratio == null) return cell ? '결과 미확인' : '수요예측 결과 미확인';
  if (p.increased) return cell ? '^^증액 발행^^' : '모집액 이상 수요로 **증액 발행**';
  return cell ? '^^모집액 이상 수요 확보^^' : '모집액 이상 수요 확보';
}

export function calOf(d: DeckData) {
  return new BizCal(d.holidays);
}

export function scheduleOf(d: DeckData, inp: DeckInput): Schedule | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.pay)) return null;
  return buildSchedule(calOf(d), inp.pay, { band: inp.band.type, demand: inp.demand, events: d.events });
}

// 수요예측 결과가 있는 건(경쟁률·참여금액 중 하나라도)
export const hasResult = (p: PeerIssue) => p.ratio != null || p.demand_krw != null || p.tranches.some((t) => t.ratio != null || t.demand_krw != null);
// 리츠는 일반 회사채 사례에서 뺀다(현업 덱 관행: 신종·후순위·리츠 제외)
export const isReit = (name: string) => /리츠|REIT/i.test(name);
// 공기업·공공기관: 정부 지원 기대가 등급에 반영돼 일반 기업과 비교하지 않는다(같은 공기업끼리는 비교)
export const isPublicCorp = (name: string) => /(공사|공단|발전|한국전력|한국수자원|한국가스공사|한국지역난방)$|^한국.*(공사|공단)$/.test(name.replace(/\s|\(주\)|㈜/g, ''));
// 금융회사(은행·금융지주·증권·카드·캐피탈·리스·보험·F&I 등): 사업회사는 사업회사끼리 비교한다(투자자 구성·만기 관행이 다름)
export const isFinancial = (name: string) =>
  /(은행|금융|금융지주|금융그룹|증권|투자증권|캐피탈|카드|리스|오토리스|생명|화재|손해보험|보험|자산운용|자산관리|에프앤아이|F&I|파이낸스|파이낸셜|종합금융|투자금융|신탁)$|^(KB|신한|하나|우리|NH|농협|BNK|DGB|JB|iM)(금융)?지주$/i
    .test(name.replace(/\s|\(주\)|㈜/g, ''));
// 신용등급 → 등급군(AA- → AA, A+ → A, BBB0 → BBB)
export const gradeGroup = (r: string | null | undefined) => (r ? r.replace(/\(.*\)/g, '').trim().replace(/[+\-0]$/, '') : null);
// 원자료가 상식 밖이라 통계·비교에서 뺀 사례(사유와 함께): 검수에 보인다
export function suspectPeers(d: DeckData) {
  return d.peers.filter((p) => p.corp_code !== d.company.corp_code).map((p) => ({ p, why: suspectOf(p) })).filter((x): x is { p: PeerIssue; why: string } => !!x.why);
}
// 비교군에서 뺀 사례(사유와 함께): 검수·데이터 화면에 보인다
export function excludedPeers(d: DeckData) {
  return d.peers.filter((p) => p.flag && p.corp_code !== d.company.corp_code && !(p.flag === '공기업' && isPublicCorp(d.company.corp_name)));
}

export function peerPool(d: DeckData, scope: 'group' | 'notch') {
  const r = d.company.rating;
  // 수요예측을 마치고 결과가 공시된 건만. 오늘 수요예측·결과 미공시 건은 '수요예측 예정 내역'에서 다룬다.
  return d.peers
    .filter((p) => (p.sub_type ?? '일반회사채') === '일반회사채')
    .filter((p) => !isReit(p.corp_name))
    .filter((p) => !p.flag || p.corp_code === d.company.corp_code || (p.flag === '공기업' && isPublicCorp(d.company.corp_name)))
    .filter((p) => p.corp_code === d.company.corp_code || isFinancial(d.company.corp_name) || !isFinancial(p.corp_name))
    .filter((p) => p.corp_code === d.company.corp_code || !suspectOf(p))
    .filter(hasResult)
    .filter((p) => (p.demand_dt ?? p.deal_dt ?? '') < d.asof)
    .filter((p) => scope === 'group' || !r || p.rating === r)
    .sort((a, b) => pd(b).localeCompare(pd(a)));
}

// 최근 발행금리 표: 3개월, 4건 미만이면 6개월 (납입일 기준)
export function recentWindow(d: DeckData, inp: DeckInput) {
  const pool = peerPool(d, inp.peerScope).sort((a, b) => (b.deal_dt ?? '').localeCompare(a.deal_dt ?? ''));
  for (const months of [3, 6]) {
    const list = pool.filter((p) => (p.deal_dt ?? '') >= addMonths(d.asof, -months) && p.tranches.some((t) => t.yield_pct != null));
    if (list.length >= 4 || months === 6) return { months, list };
  }
  return { months: 6, list: [] as PeerIssue[] };
}

export function defaultInput(d: DeckData): DeckInput {
  const last = d.own[0];
  const cal = calOf(d);
  const plan = payPlan(d);
  // 같은 노치 사례가 10건 이상이면 노치(예: AA-)를 기본 범위로
  const peerScope: 'group' | 'notch' = d.company.rating && peerPool(d, 'notch').length >= 10 ? 'notch' : 'group';
  // 납입일: 발행 시기 검토(1안/2안)의 권고안. 대안이 없으면 규칙 납입일
  const tm = timingPlan(d, { peerScope, band: 'spread', pay: null });
  const pay = tm.opts.length ? tm.opts[tm.rec].sch.pay : plan.pay;
  const pool = peerPool(d, peerScope);
  // 기본형: 최근 6개월 수요예측을 최근 것부터 16건까지 (표는 시간순으로 그린다)
  const from6 = addMonths(d.asof, -6);
  const recent = pool.filter((p) => pd(p) >= from6);
  // 최근 6개월이 8건 미만이면 최근 1년에서 고른다(현업 덱은 당해 연도 사례를 길게 나열)
  const peerKeys = (recent.length >= 8 ? recent : pool).slice(0, 16).map((p) => p.key);
  // 비교 장표 기본: 회사 직전 회차 + 최근 미매각 사례 + 같은 노치(없으면 같은 등급군)의 경쟁률 최고 사례
  const ownRecent = pool.find((p) => p.corp_code === d.company.corp_code);
  const taken = new Set([ownRecent?.key]);
  const under = pool.find((p) => fullUnder(p) && !taken.has(p.key)) ?? pool.find((p) => !!p.under && !taken.has(p.key));
  taken.add(under?.key);
  const byRatio = (xs: PeerIssue[]) => xs.filter((p) => p.ratio != null && !taken.has(p.key)).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
  const best = byRatio(pool.filter((p) => p.rating === d.company.rating)) ?? byRatio(pool);
  const compareKeys = [ownRecent?.key, under?.key, best?.key].filter(Boolean) as string[];
  const m = d.asof;
  const items = defaultItems();
  // 직전 회차를 NH 가 주관하지 않았으면(신규·재선임 제안) NH 강점 1장(같은 등급 대표주관 실적, 데이터로 생성)을 켠다.
  // 템플릿 고정 장표(회사 현황 등)는 수치가 오래돼 기본으로 켜지 않는다.
  if (d.own.length && !d.own[0].nh_lead && d.league.rows.some((r) => r.isNh)) items.strength = true;
  const series = nextSeries(d.company.last_series);
  const issuer = `㈜${d.company.corp_name}`;
  // 직전 회차 트랜치 구성을 기본값으로 (최초 신고 금액)
  const tranches = last?.tranches.length
    ? last.tranches.map((t) => ({ tenor: t.tenor, eok: t.initial_krw ? Math.round(t.initial_krw / 1e8) : null }))
    : [{ tenor: '', eok: null }];
  return {
    corp_code: d.company.corp_code,
    issuer,
    series,
    month: `${m.slice(0, 4)}. ${m.slice(5, 7)}`,
    security: '무기명식 무보증 공모 회사채',
    rating: d.company.rating ?? '',
    ratingNote: d.company.rating ? `현재 신용등급 준용${last?.deal_dt ? `(직전 공모채 ${yy(last.deal_dt)} 발행 기준, 확인 필요)` : '(확인 필요)'}` : '',
    coverTitle: `${issuer}${series ? ` 제${series}회` : ''} 공모사채 발행 검토 및 제안`,
    tranches,
    maxEok: maxPlan(d, tranches.reduce((a, t) => a + (t.eok ?? 0), 0))?.max ?? null,
    coupon: '3개월 이표채',
    // 현업 샘플 덱 6건 모두 개별민평 ±30bp
    band: { type: 'spread', low: -30, high: 30 },
    bandNote: '개별민평 기준, 시장 상황에 따라 조정 가능',
    pay,
    demand: null,
    uw: '발행금액 전액',
    feeUw: d.fee.last_bp ?? d.fee.group_median_bp ?? null,
    feeLead: null,
    feeNote: d.fee.last_bp != null ? '이전 발행 회차 인수수수료 준용' : '',
    peerScope,
    peerKeys,
    compareKeys,
    items,
    dept: 'IB사업부',
    coverDept: 'IB사업부',
    contacts: '',
    internal: { rateFc: '', creditFc: '', minpyeong: '', investors: '' },
  };
}

// ---------------------------------------------------------------------------------------------
// 규칙 문안
export function ruleText(d: DeckData, inp: DeckInput): DeckText {
  const name = d.company.corp_name;
  const grp = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const sch = scheduleOf(d, inp);
  const pool = peerPool(d, inp.peerScope);
  const sel = pool.filter((p) => inp.peerKeys.includes(p.key));
  const withRatio = pool.filter((p) => p.ratio != null);
  const under = pool.filter(fullUnder);
  const part = pool.filter((p) => p.under && !fullUnder(p));
  const inc = pool.filter((p) => p.initial_krw != null);
  const tmix = tenorMix(pool);
  const nOwn = Math.min(4, d.own.length); // 문장의 '최근 n회'는 실제 회차 수
  // 제안 구조(예: 3년+5년)의 최근 6개월 통계, 없으면 최근 1년 만기별 비중
  const normT = (x: string) => x.replace(/\s/g, '');
  const propCombo = inp.tranches.map((t) => t.tenor.trim()).filter(Boolean).join('+');
  // 같은 범위(등급·노치) 최근 1년 기준 조합 통계: 장표마다 범위가 달라지지 않게 사례 풀에서 직접 센다
  const combosLocal = comboCounts(pool);
  const pc = propCombo ? combosLocal.find((c) => normT(c.combo) === normT(propCombo)) : undefined;
  // 근거 우선순위 ①: 회사 최근 회차 중 같은 구조
  const ownSame = propCombo ? d.own.slice(0, 4).find((p) => normT(comboOf(p)) === normT(propCombo)) : undefined;
  const propMix = tmix.rows.filter((x) => inp.tranches.some((t) => normT(t.tenor) === x.k));
  const comboTop = combosLocal[0];
  const pcTop = !!(pc && comboTop && normT(comboTop.combo) === normT(pc.combo));

  const lead = sch
    ? (() => {
      const part = Number(sch.pay.slice(8, 10)) <= 10 ? '초' : Number(sch.pay.slice(8, 10)) <= 20 ? '중순' : '말';
      return `NH투자증권은 **${sch.pay.slice(0, 4)}년 ${Number(sch.pay.slice(5, 7))}월 ${part}**${eul(part)} 회사채 적정 발행 시기로 판단하며, **${name}의 회사채 발행 및 당사 총액인수**를 하기와 같이 제안 드립니다.`;
    })()
    : `NH투자증권은 **${name}의 회사채 발행 및 당사 총액인수**를 하기와 같이 제안 드립니다.`;

  const peers: string[] = [];
  if (pool.length) {
    peers.push(`최근 1년 ${grp}등급 일반 공모 회사채 수요예측 ${pool.length}건 진행${sel.length ? `(아래 표는 최근 ${sel.length}건)` : ''}`);
    if (withRatio.length) peers.push(`경쟁률 확인 ${withRatio.length}건 기준 중간값 **${ratioX(median(withRatio.map((p) => p.ratio)))}**, 최고 ${ratioX(Math.max(...withRatio.map((p) => p.ratio ?? 0)))}`);
    if (under.length) {
      const u = under[0];
      peers.push(`${under.length}건은 모집액에 못 미치는 수요로 **미매각 발생**(최근: ${u.corp_name} ${mdw(pd(u))}, 경쟁률 !!${ratioX(u.ratio)}!!)`);
    }
    if (part.length) {
      const u = part[0];
      const t = u.tranches.find((x) => x.under);
      peers.push(`${part.length}건은 전체 경쟁률은 1배 이상이나 일부 트랜치 미달(최근: ${u.corp_name} ${mdw(pd(u))}${t ? ` ${t.tenor} !!${ratioX(t.ratio)}!!` : ''})`);
    }
    if (!under.length && !part.length && withRatio.length) peers.push('경쟁률이 확인된 수요예측은 모두 모집액 이상 수요 확보');
    if (inc.length) peers.push(`최초 신고 금액 대비 증액 발행 ${inc.filter((p) => p.increased).length}건(${inc.length}건 중)`);
    const ns = notchStats(pool).filter((x) => x.n >= 2).slice(0, 3);
    if (ns.length >= 2) peers.push(`등급별 평균 경쟁률 ${ns.map((x) => `${x.rating} ${ratioX(x.avg)}(${x.n}건)`).join(', ')}`);
  } else {
    peers.push(`최근 1년 ${grp}등급 일반 공모 회사채 수요예측 사례 없음`);
  }
  // 회사 직전 회차는 Ⅰ부(Term-sheet·트랜치 검토)에 있어 여기(Ⅱ부 시장)에는 쓰지 않는다

  const cmp = inp.compareKeys.map((k) => d.peers.find((p) => p.key === k)).filter(Boolean) as PeerIssue[];
  const compare = cmp.map((p) => {
    const verdict = verdictOf(p, false);
    const y = p.tranches.map((t) => rate3(t.yield_pct)).join('/');
    return `${p.corp_name}: ${p.demand_dt ? `${mdw(p.demand_dt)} ` : ''}${p.tenor_combo}, 발행금리 ${y}, 경쟁률 ${ratioX(p.ratio)} → ${verdict}`;
  });
  if (cmp.length >= 2) {
    const rs = cmp.filter((p) => p.ratio != null);
    if (rs.length >= 2) {
      const hi = rs.reduce((a, b) => ((a.ratio ?? 0) >= (b.ratio ?? 0) ? a : b));
      const lo = rs.reduce((a, b) => ((a.ratio ?? 0) <= (b.ratio ?? 0) ? a : b));
      if (hi.key !== lo.key) compare.push(`같은 등급에서도 수요예측 시점·금리 수준에 따라 경쟁률 차이(${ratioX(lo.ratio)} ~ ${ratioX(hi.ratio)}) 발생 → **경쟁 발행이 적은 시점 선점 필요**`);
    }
  }

  const timing = timingText(timingOf(d, inp));
  const schedule: string[] = [];
  if (sch) {
    schedule.push(`발행 일정 案: **${yy(sch.pay).slice(0, 3)}년 ${korDate(sch.pay)} 발행, ${korDate(sch.demandOptions[0])} ~ ${Number(sch.demandOptions[2].slice(8, 10))}일 中 택1 수요예측 진행**`);
    schedule.push(`수요예측 가능일은 ${mdw(sch.demandOptions[0])} ~ ${mdw(sch.demandOptions[2])}이며, 가장 무난한 일정은 ${korDate(sch.demandOptions[1])}(증권신고서 제출 및 추가청약 가능성을 고려해 전후 하루 여유 확보)`);
    schedule.push(inp.band.type === 'fixed'
      ? '고정금리 밴드로 발행할 경우, 금리가 수요예측일에 확정되어 증권신고서 정정은 1회만 진행'
      : '개별민평 밴드로 발행할 경우, 수요예측 결과(조건확정)와 발행 전일 금리확정 두 차례 증권신고서 정정 진행');
    for (const w of sch.warnings) schedule.push(w);
    const why = payPlan(d);
    if (why.reason && why.pay === sch.pay) schedule.push(why.reason);
    // 금통위 전후 금리 변동성(일별 국고채 3년)
    const pastMeet = d.events.filter((e) => e.kind === '금통위' && e.event_dt < d.asof).map((e) => e.event_dt);
    const vol = meetingVolatility(d, pastMeet);
    if (vol) schedule.push(`최근 금통위 ${vol.meetings}회 전후 국고채 3년 하루 변동폭 평균: ${vol.byLag.map((x) => `${x.lag ? `D-${x.lag}` : '당일'} ${x.bp}bp`).join(', ')}`);
    const nextMeet = d.events.find((e) => e.kind === '금통위' && e.event_dt >= sch.filing && e.event_dt <= sch.listing);
    if (nextMeet) schedule.push(`발행 기간 중 금통위(${mdw(nextMeet.event_dt)})가 있어 ${nextMeet.event_dt > sch.demand ? '수요예측을 금통위 전에 마쳐 금리 변동성 영향을 줄이는 일정' : '금통위 결과를 확인한 뒤 수요예측을 진행하는 일정'}으로 구성`);
    const nextMat = d.maturities.find((m) => m.dt >= sch.pay);
    if (nextMat && daysBetween(sch.pay, nextMat.dt) <= 120 && !(why.reason && why.pay === sch.pay)) schedule.push(`발행 후 ${mdw(nextMat.dt)} 회사채 만기도래 ${eokW(nextMat.amount_krw)}(제${nextMat.series ?? ''}회) 상환 재원 마련에 대응 가능한 일정`);
    const crowd = marketCrowd(d, sch.pay);
    if (crowd) schedule.push(crowd);
    schedule.push('시장 및 회사 상황에 따라 발행일은 유동적으로 조정 가능');
  }

  // 만기 구조: 트랜치 만기(‘또는’은 대안), 트랜치가 둘 이상이면 조합도 한 줄
  const tenors = tenorOptions(inp);
  const structureRows = tenors.map((t) => {
    const c = d.combos.find((x) => x.combo.replace(/\s/g, '') === t.replace(/\s/g, ''));
    const parts: string[] = [];
    if (c) parts.push(`최근 6개월 ${d.company.rating_group ?? ''}등급 ${c.issues}건 발행(비중 ${Math.round(c.share ?? 0)}%)${c.medComp != null ? `, 경쟁률 중간값 ${ratioX(c.medComp)}` : ''}`);
    else parts.push(`최근 6개월 ${d.company.rating_group ?? ''}등급 발행 사례 없음`);
    const m = t.match(/^(\d+(?:\.\d+)?)년$/);
    if (!c && /\+/.test(t)) parts.pop();
    if (!c && /\+/.test(t)) parts.push(`최근 6개월 ${d.company.rating_group ?? ''}등급 같은 조합 발행 없음`);
    if (m && sch) {
      const due = new Date(`${sch.pay}T00:00:00Z`);
      due.setUTCMonth(due.getUTCMonth() + Math.round(Number(m[1]) * 12));
      const dueS = due.toISOString().slice(0, 10);
      const near = d.maturities.filter((x) => Math.abs(new Date(x.dt).getTime() - due.getTime()) <= 45 * 86_400_000);
      parts.push(near.length
        ? `${yy(dueS)} 만기 도래 → 기존 회사채 ${near.map((x) => `${yy(x.dt)} ${eokW(x.amount_krw)}`).join(', ')}와 만기 집중`
        : `${yy(dueS)} 만기 도래 → 기존 회사채 만기와 겹치지 않음`);
    }
    return { label: t, desc: parts.join('\n') };
  });
  const structure: string[] = [];
  const bandDesc = inp.band.type === 'later' ? '추후 결정(발행 시점 시장 상황 반영)' : inp.band.type === 'fixed' ? `고정금리 ${inp.band.low ?? '–'}%~${inp.band.high ?? '–'}%` : `개별민평 ${inp.band.low ?? '–'}~+${inp.band.high ?? '–'}bp`;
  structure.push(`금리 밴드 ${bandDesc}, 이자지급 ${inp.coupon}`);
  if (ownSame) structure.push(`직전 같은 구조(**${comboOf(ownSame)}**) 발행인 제${ownSame.series ?? ''}회(${yy(ownSame.demand_dt ?? ownSame.deal_dt)}) 경쟁률 ${ratioX(ownSame.ratio)}${ownSame.increased ? `, ${eokW(ownSame.initial_krw)} → ${eokW(ownSame.amount_krw)} 증액 발행` : ''}`);
  else if (pc && pcTop) structure.push(`최근 1년 ${grp}등급 공모 회사채는 제안 구조인 **${pc.combo}** 구조가 가장 많음(${pc.issues}건, 비중 ${Math.round(pc.share)}%)`);
  else if (propMix.length) structure.push(`최근 1년 ${grp}등급 공모 회사채 발행금액 중 ${propMix.map((x) => `${x.k}물 ${x.share.toFixed(1)}%`).join(', ')}`);
  if (d.maturities.length) {
    const in1y = d.maturities.filter((m) => m.dt <= addYears(d.asof, 1));
    structure.push(`${name} 공모 회사채 만기 도래: 향후 3년 ${d.maturities.length}건 ${eokW(d.maturities.reduce((s, m) => s + (m.amount_krw ?? 0), 0))}${in1y.length ? `(1년 내 ${eokW(in1y.reduce((s, m) => s + (m.amount_krw ?? 0), 0))})` : ''}`);
  }
  structure.push('만기 집중을 피하고 투자자 선호 만기를 반영해 트랜치 구성, 수요예측 결과에 따라 트랜치별 금액 조정');

  // 강점
  const lg = d.league;
  const nhG = lg.rows.findIndex((r) => r.isNh);
  const nhA = d.leagueAll.rows.findIndex((r) => r.isNh);
  const nhOwn = d.own.filter((p) => p.nh_lead);
  const nhRecent = d.own.slice(0, 4).filter((p) => p.nh_lead);
  const nhTrack = nhRecent.length ? (() => {
    // 가산금리: 공시된 회차만. 일부 회차만 있으면 그 회차를 밝힌다
    const spIss = nhRecent.filter((p) => p.tranches.some((t) => t.spread_bp != null));
    const sp = spIss.flatMap((p) => p.tranches.map((t) => t.spread_bp)).filter((v): v is number => v != null);
    const avg = sp.length ? Math.round(sp.reduce((a, b) => a + b, 0) / sp.length) : null;
    const spLabel = spIss.length === nhRecent.length ? '평균 ' : `${spIss.length === 1 ? '' : '평균 '}`;
    const spWhich = spIss.length === nhRecent.length ? '' : `제${spIss.map((p) => p.series ?? '').join('·')}회, `;
    // 원자료가 상식 밖인 회차(파싱 오류 의심)는 경쟁률 표기에서 뺀다
    const rs = nhRecent.filter((p) => p.ratio != null && !suspectOf(p));
    const again = d.own[0] && !d.own[0].nh_lead;
    // 결과 표기: 모든 회차가 모집액 이상이면 경쟁률, 아니면 모집액 이상 횟수. 가산금리는 민평 이하일 때만
    const ratioTxt = !rs.length ? '발행 지원' : rs.every((p) => Number(p.ratio) >= 1) ? `수요예측 경쟁률 ${rs.map((p) => ratioX(p.ratio)).join('·')}` : `수요예측 ${rs.length}회 중 ${rs.filter((p) => Number(p.ratio) >= 1).length}회 모집액 이상`;
    const inc = nhRecent.filter((p) => p.increased).length;
    const next = inp.series ? `제${inp.series}회` : '이번 회차';
    return `NH투자증권은 ${name} 제${nhRecent.map((p) => p.series ?? '').join('·')}회 대표주관사로 ${ratioTxt}${avg != null && avg <= 0 ? `, 확정 가산금리 ${spLabel}${bpSigned(avg)}(${spWhich}민평 대비)` : ''}${inc ? `, 증액 발행 ${inc}회` : ''}${again ? ` → ${next} **대표주관 재참여** 제안` : ''}`;
  })() : undefined;
  const strengths: DeckText['strengths'] = [];
  if (nhG >= 0) strengths.push({ title: `${d.company.rating_group ?? ''}등급 발행 실적`, text: `최근 1년 ${lg.scope} 대표주관 실적 **${nhG + 1}위**(${eokW(lg.rows[nhG].credit)}, ${lg.rows[nhG].deals}건)` });
  if (nhA >= 0) strengths.push({ title: '공모 회사채 대표주관', text: `최근 1년 ${d.leagueAll.scope} 대표주관 실적 ${nhA + 1}위, 점유율 ${((d.leagueAll.rows[nhA].credit / (d.leagueAll.total || 1)) * 100).toFixed(1)}%` });
  strengths.push(nhOwn.length
    ? { title: `${name}에 대한 이해`, text: `${name} 공모 회사채 ${d.own.length}회 중 **${nhOwn.length}회 대표주관**(최근 제${nhOwn[0].series ?? ''}회, ${yy(nhOwn[0].deal_dt)})${nhTrack && nhRecent.length ? `: ${nhTrack.replace(/^NH투자증권은 .*?대표주관사로 /, '').replace(/ → .*$/, '')}` : ''}` }
    : { title: '최적 컨설팅 역량', text: `${d.company.rating_group ?? ''}등급 발행사의 수요예측 사례를 바탕으로 발행 시기·구조·금리 밴드 제안` });

  // 금리
  const r = (k: string) => d.rates.find((x) => x.key === k);
  const rates: string[] = [];
  const base = r('base_rate');
  const k3 = r('ktb3y');
  const k10 = r('ktb10y');
  if (base) rates.push(`한국은행 기준금리 **${rate2(base.value)}**(${yymmdd(base.dt)} 기준)`);
  if (k3) rates.push(`국고채 3년 ${rate3(k3.value)}, 1개월 전 대비 ${bpS(k3.chg1m)}${k10 ? ` / 국고채 10년 ${rate3(k10.value)}, ${bpS(k10.chg1m)}` : ''}`);
  const nhView = d.views.find((v) => /NH/.test(v.house));
  if (nhView) rates.push(`NH투자증권 리서치(${yymmdd(nhView.published_dt)}): ${nhView.summary}`);
  const fcStale = forecastStale(d);
  if (d.forecast && !fcStale) {
    const b = d.forecast.rows.find((x) => x.key === 'base_rate');
    const fy = b?.cells.find((c) => /^\d{4}$/.test(c.period) && !c.actual);
    if (b && fy) rates.push(`${d.forecast.house} 리서치 전망표(${yymmdd(d.forecast.published_dt)} 발표): 기준금리 ${fy.period}년 말 ${rate2(fy.value)}`);
    else if (b && pathText(b)) rates.push(`${d.forecast.house} 리서치 기준금리 경로(${yymmdd(d.forecast.published_dt)}): ${pathText(b)}`);
  }

  const corp: string[] = [];
  const aa = r('corp3y_aa');
  const bbb = r('corp3y_bbb');
  if (aa && k3) corp.push(`회사채 3년 AA- ${rate3(aa.value)}, 국고채 3년 대비 스프레드 **${Math.round((aa.value - k3.value) * 100)}bp**(${yymmdd(aa.dt)})`);
  if (aa && k3 && aa.chg1m != null && k3.chg1m != null) corp.push(`1개월 변화: 회사채 AA- ${bpS(aa.chg1m)}, 국고채 3년 ${bpS(k3.chg1m)}`);
  if (bbb && daysBetween(bbb.dt, d.asof) <= 40) corp.push(`회사채 3년 BBB- ${rate3(bbb.value)}(${yymmdd(bbb.dt)})`);
  const win = recentWindow(d, inp);
  const ys = win.list.flatMap((p) => p.tranches.map((t) => t.yield_pct)).filter((v): v is number => v != null);
  if (ys.length) {
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    corp.push(`최근 ${win.months}개월 ${grp}등급 공모 회사채 발행금리 ${lo === hi ? rate3(lo) : `${rate3(lo)} ~ ${rate3(hi)}`}(${win.list.length}건)`);
  }

  const views: string[] = [];
  if (d.views.length) {
    const latest = d.views[0].published_dt;
    const terms = d.views.filter((v) => v.terminal != null);
    const modeT = modeOf(terms.map((v) => Number(v.terminal)));
    views.push(modeT
      ? `${yymmdd(latest)} 전후 증권사 ${d.views.length}곳 의견 정리${d.views.length > 10 ? '(아래 표는 10곳)' : ''}, 최종 기준금리를 제시한 ${terms.length}곳 중 ${modeT.n}곳이 **${rate2(modeT.v)}** 제시`
      : `${yymmdd(latest)} 전후 증권사 ${d.views.length}곳 의견 정리`);
    const firstHike = d.views.map((v) => hikeMonths(v.next_move)[0]).filter((x): x is number => x != null);
    const modeM = modeOf(firstHike);
    if (modeM && modeM.n >= 2) views.push(`다음 인상 시점으로 ${modeM.v}월을 꼽은 곳 ${modeM.n}곳`);
    // 최빈값과 다른 최종금리를 낸 곳만 따로 적는다(최종금리를 밝히지 않은 곳은 표로만)
    const other = modeT ? terms.filter((v) => Number(v.terminal) !== modeT.v) : [];
    if (other.length) views.push(`${other.map((v) => `${v.house}(${rate2(Number(v.terminal))})`).join(', ')}${eun(other[other.length - 1].house)} 다른 최종금리 제시`);
  }

  // 적정 발행규모·트랜치
  const sizing: string[] = [];
  const tr = inp.tranches.filter((t) => t.tenor);
  const total = tr.reduce((a, t) => a + (t.eok ?? 0), 0);
  if (tr.length) sizing.push(`최초 신고 금액 ${total ? `**${total.toLocaleString('ko-KR')}억원**` : '미정'}${inp.maxEok ? `(Max ${inp.maxEok.toLocaleString('ko-KR')}억원)` : ''} 가운데 ${tr.map((t) => `${t.tenor}${t.eok ? ` ${t.eok.toLocaleString('ko-KR')}억원` : ''}`).join(', ')} 구성 제안`);
  // 차환 수요: 납입일 뒤 75일 안(또는 그 전 기준일 이후) 기존 회사채 만기 → 최초·증액 금액과 비교
  const refi = refiNeed(d, inp.pay);
  if (refi.list.length && total) {
    const amt = refi.list.reduce((a, m) => a + Number(m.amount_krw ?? 0), 0) / 1e8;
    const what = `${refi.label} 만기 ${eokW(amt * 1e8)}(${refi.list.map((m) => `${mdw(m.dt)} ${eokW(m.amount_krw)}`).join(', ')})`;
    sizing.push(total >= amt
      ? `${what} 차환 재원을 최초 신고 금액으로 확보하고, 증액분은 운영·투자 자금 등 추가 조달 여력`
      : inp.maxEok && inp.maxEok >= amt
        ? `${what} 차환: 최초 신고 금액으로 ${Math.round((total / amt) * 100)}%, **증액 시 차환 재원 전액 확보**`
        : `${what} 대비 증액 한도까지 발행해도 부족해 차입·CP 등 병행 검토 필요`);
  }
  const ownRat = d.own.filter((p) => p.ratio != null).slice(0, 4);
  if (ownRat.length) sizing.push(`${name} 최근 ${ownRat.length}회 수요예측 경쟁률 ${ownRat.map((p) => `${yy(p.demand_dt ?? p.deal_dt)} ${ratioX(p.ratio)}`).join(', ')}`);
  const ownInc = d.own.slice(0, 4).filter((p) => p.increased);
  if (ownInc.length) sizing.push(`최근 ${nOwn}회 ${ownInc.length === nOwn ? '모두' : `중 ${ownInc.length}회`} 증액 발행(${ownInc.map((p) => `제${p.series ?? ''}회 ${eokW(p.initial_krw)} → ${eokW(p.amount_krw)}`).join(', ')})`);
  // 등급 관행: 최근 1년 같은 등급 만기별 발행 비중
  if (tmix.total && tmix.top2.length >= 2) {
    sizing.push(`최근 1년 ${grp}등급 공모 회사채 ${tmix.issues}건 발행 ${eokW(tmix.total)} 중 ${tmix.top2.map((x) => `${x.k}물 ${x.share.toFixed(1)}%`).join(', ')}로 두 만기가 **${tmix.top2Share.toFixed(1)}%**를 차지하는 ${grp}등급 주력 만기`);
  } else if (d.combos[0]) sizing.push(`최근 6개월 ${d.company.rating_group ?? ''}등급은 ${d.combos[0].combo} 구조가 가장 많음(${d.combos[0].issues}건)`);
  // 만기별 수요: 경쟁률이 높아도 신고금액이 작으면 수요 규모는 작다 → 참여금액과 함께 판단
  // 판단은 제안한 만기끼리 비교하고, 제안에 없는 만기가 수요가 가장 많으면 추가 검토를 따로 적는다
  const allTenor = tenorDemand(d.own, 4);
  const norm = (s: string) => s.replace(/\s/g, '');
  const proposed = new Set(tr.map((t) => norm(t.tenor)));
  const tenorStats = proposed.size ? allTenor.filter((x) => proposed.has(norm(x.k))) : allTenor;
  const overall = allTenor.length ? allTenor.reduce((a, b) => (a.demand >= b.demand ? a : b)) : null;
  const missing = overall && proposed.size && !proposed.has(norm(overall.k)) && overall.demand > 0
    ? `제안에 없는 ${overall.k}물이 최근 ${nOwn}회 참여금액 ${eokW(overall.demand)}으로 가장 많아 **${overall.k}물 트랜치 추가** 검토 필요`
    : null;
  // 제안의 주력 트랜치(금액 최대). 데이터 신호가 이와 다르면 판단 대신 '검토 가능'으로만 적는다(제안과 모순되는 판단 금지)
  const mainT = tr.length ? tr.reduce((a, b) => ((b.eok ?? 0) > (a.eok ?? 0) ? b : a)) : null;
  if (tenorStats.length >= 2) {
    const byRatio = tenorStats.reduce((a, b) => (a.avg >= b.avg ? a : b));
    const byDemand = tenorStats.reduce((a, b) => (a.demand >= b.demand ? a : b));
    // 문장 길이: 참여금액 상위 3개 만기만 적는다
    const top = [...tenorStats].sort((a, b) => b.demand - a.demand).slice(0, 3);
    if (mainT && norm(mainT.tenor) !== norm(byDemand.k)) {
      sizing.push(`최근 ${nOwn}회 만기별 참여금액 ${top.map((x) => `${x.k} ${eokW(x.demand)}`).join(', ')}으로 ${byDemand.k}물 수요도 견조해 ${byDemand.k}물 비중 확대 검토 가능`);
    } else if (byRatio.k === byDemand.k) {
      sizing.push(`최근 ${nOwn}회 만기별 평균 경쟁률 ${top.map((x) => `${x.k} ${ratioX(x.avg)}`).join(', ')}, 참여금액 ${top.map((x) => `${x.k} ${eokW(x.demand)}`).join(', ')}으로 **${byDemand.k}물 수요가 가장 견조**하여 ${byDemand.k}물 중심 구성이 적합하다고 판단`);
    } else {
      sizing.push(`최근 ${nOwn}회 ${byRatio.k}물 평균 경쟁률이 ${ratioX(byRatio.avg)}로 가장 높으나(평균 신고 ${eokW(byRatio.initAvg)}) 참여금액은 ${byDemand.k}물 ${eokW(byDemand.demand)}, ${byRatio.k}물 ${eokW(byRatio.demand)}으로 **${byDemand.k}물 중심**에 ${byRatio.k}물은 보조 트랜치로 두는 구성이 적합하다고 판단`);
    }
  }
  if (missing) sizing.push(missing);
  const spreads = d.own.slice(0, 4).flatMap((p) => p.tranches.map((t) => ({ p, t, s: t.spread_bp })).filter((x) => x.s != null));
  if (spreads.length >= 2) {
    // 회사 확정 가산금리(최근 4회 평균·범위)를 같은 등급 최근 3개월 확정 가산금리와 나란히: 밴드 안에서 민평 이하 확정을 목표로 한다
    const avgOwn = Math.round(spreads.reduce((a, x) => a + Number(x.s), 0) / spreads.length);
    const lo = Math.min(...spreads.map((x) => Number(x.s)));
    const hi = Math.max(...spreads.map((x) => Number(x.s)));
    const mkt = gradeSpreads(pool.filter((p) => p.corp_code !== d.company.corp_code), d.asof, 3, tr.map((t) => t.tenor));
    const mktTxt = mkt.length ? ` vs 최근 3개월 ${grp}등급 ${mkt.map((x) => `${x.k} ${bpSigned(x.avg)}`).join(', ')}(평균)` : '';
    const spIss = [...new Set(spreads.map((x) => x.p))];
    const spLbl = spIss.length === nOwn ? `최근 ${nOwn}회 평균` : `최근 ${nOwn}회 중 제${spIss.map((p) => p.series ?? '').join('·')}회 평균`;
    sizing.push(`확정 가산금리(개별민평 대비) ${name} ${spLbl} ${bpSigned(avgOwn)}(${bpSigned(lo)} ~ ${bpSigned(hi)})${mktTxt}${avgOwn < 0 ? ` → 민평 이하 발행 이력을 근거로 밴드 ${bandDescShort(inp)} 안에서 **민평 이하 확정 목표**` : ` → 밴드 ${bandDescShort(inp)} 유지, 수요예측 결과에 따라 확정`}`);
  }
  if (d.maturities.length) {
    // 제안 트랜치가 만기되는 연도의 기존 만기도래를 비교한다(만기도래 자료 3년 안의 만기만)
    const total = eokW(d.maturities.reduce((t, m) => t + (m.amount_krw ?? 0), 0));
    const load = proposedMaturityLoad(d, tr, inp.pay);
    const amt = (v: number) => (v ? eokW(v) : '없음');
    if (load.length >= 2) {
      const best = load.reduce((a, b) => (a.amount <= b.amount ? a : b));
      const fits = mainT && norm(mainT.tenor) === norm(best.tenor);
      const loadTxt = load.map((x) => `'${x.year.slice(2)}년 ${x.tenor}물 ${amt(x.amount)}`).join(', ');
      sizing.push(`${name} 공모 회사채 만기 도래는 향후 3년 ${total}. 제안 만기 연도의 기존 만기도래는 ${loadTxt}${fits ? `${ro(loadTxt)} 주력인 **${best.tenor}물**이 만기 분산에도 유리` : ''}`);
    } else if (load.length === 1) {
      const x = load[0];
      const byYear = [...fullYearLoads(d).values()];
      const avg = byYear.reduce((a, b) => a + b, 0) / Math.max(byYear.length, 1);
      sizing.push(`${name} 공모 회사채 만기 도래는 향후 3년 ${total}. ${x.tenor}물이 만기되는 '${x.year.slice(2)}년의 기존 만기도래는 ${amt(x.amount)}${x.amount <= avg ? '(연평균 이하)로 만기 분산 측면에서 무리가 없다고 판단' : '(연평균 초과)로 만기 분산을 위해 다른 만기 병행 검토 필요'}`);
    } else {
      sizing.push(`${name} 공모 회사채 만기 도래는 향후 3년 ${total}`);
    }
  }
  if (inp.maxEok) {
    const mp = maxPlan(d, total);
    sizing.push(mp && mp.max === inp.maxEok && mp.from
      ? `최근 ${mp.n}회 최대 증액 배율 ${mp.mult.toFixed(2)}배(제${mp.from.series ?? ''}회 ${eokW(mp.from.initial_krw)} → ${eokW(mp.from.amount_krw)}) 기준 증액 한도 **Max ${inp.maxEok.toLocaleString('ko-KR')}억원** 설정 제안`
      : `증액 한도 **Max ${inp.maxEok.toLocaleString('ko-KR')}억원** 설정 제안`);
  }

  // 수요예측 예정 내역
  const pipeline: string[] = [];
  const pipe = pipelineOf(d);
  if (pipe.length) {
    const done = pipe.filter((p) => p.demand_dt && p.demand_dt < d.asof).length;
    pipeline.push(`${yymmdd(d.asof)} 현재 증권신고서를 제출하고 발행 전인 일반 공모 회사채 ${pipe.length}건(${eokW(pipe.reduce((t, p) => t + p.tranches.reduce((a, x) => a + (x.initial_krw ?? 0), 0), 0))})${done ? `, 이 중 ${done}건은 수요예측을 마치고 납입 전` : ''}`);
    // 등급군은 등급에서 부호를 떼어 비교한다(AA- 는 AA 등급군, A 등급군이 아님)
    const same = pipe.filter((p) => d.company.rating_group && gradeGroup(p.rating) === d.company.rating_group);
    pipeline.push(same.length ? `같은 등급군(${d.company.rating_group}) 예정 발행 ${same.length}건: ${same.map((p) => `${p.corp_name}(${p.rating})`).join(', ')}` : `같은 등급군(${d.company.rating_group ?? ''}) 예정 발행은 없음`);
    if (sch) {
      const clash = pipe.filter((p) => p.demand_dt && Math.abs(new Date(p.demand_dt).getTime() - new Date(sch.demand).getTime()) <= 3 * 86_400_000);
      const near = nearPipeline(d, sch.demand);
      if (clash.length) pipeline.push(`제안 수요예측일(${mdw(sch.demand)}) 전후 3일 안에 ${clash.map((p) => p.corp_name).join(', ')} 수요예측 예정`);
      else if (!near.length) {
        const lastPay = pipe.map((p) => p.pay_dt ?? p.demand_dt ?? '').filter(Boolean).sort().at(-1);
        pipeline.push(`제안 수요예측일(${mdw(sch.demand)}) 전후 3주 안에 잡힌 예정 건은 아직 없음${lastPay ? `(현재 예정 건은 ${mdw(lastPay)}까지 납입)` : ''}`);
      }
    }
  } else {
    pipeline.push(`${yymmdd(d.asof)} 현재 증권신고서를 제출하고 발행 전인 일반 공모 회사채 없음`);
  }

  // 금통위·FOMC: 수집한 회의 요약을 그대로 (문장은 사람이 출처에서 정리한 것)
  const meet = (m: DeckData['policy']['bok']) => (m ? [`${yymmdd(m.meeting_dt)} ${m.title}: **${m.decision}**${m.vote ? `(${m.vote})` : ''}`] : []);
  const bok = meet(d.policy.bok);
  const fomc = meet(d.policy.fomc);

  const usviews: string[] = [];
  if (d.usViews.length) {
    // 경로 분류: 인상이 들어 있으면 추가 인상, 인상 없이 동결만이면 동결 유지, 인하가 있으면 인하
    const hikes = d.usViews.filter((v) => /인상/.test(v.next_move ?? '')).length;
    const holds = d.usViews.filter((v) => /동결/.test(v.next_move ?? '') && !/인상|인하/.test(v.next_move ?? '')).length;
    const cuts = d.usViews.filter((v) => /인하/.test(v.next_move ?? '')).length;
    const parts = [[hikes, '추가 인상'], [holds, '동결 유지'], [cuts, '인하']].filter(([n]) => Number(n) > 0).map(([n, k]) => `${n}곳 ${k}`);
    usviews.push(`${d.usViews.length}개 하우스 중 ${parts.join(', ')} 전망${d.usViews.length > 10 ? '(아래 표는 10곳)' : ''}`);
    const firstUs = d.usViews.map((v) => hikeMonths(v.next_move)[0]).filter((x): x is number => x != null);
    const modeUs = modeOf(firstUs);
    if (modeUs && modeUs.n >= 2) usviews.push(`다음 인상 시점으로 ${modeUs.v}월을 꼽은 곳 ${modeUs.n}곳`);
    const e26 = modeOf(d.usViews.filter((v) => v.end2026 != null).map((v) => Number(v.end2026)));
    if (e26) usviews.push(`2026년 말 정책금리(상단)를 제시한 ${d.usViews.filter((v) => v.end2026 != null).length}곳 중 ${e26.n}곳이 **${rate2(e26.v)}** 제시`);
    const tm = d.usViews.filter((v) => v.terminal != null).map((v) => v.terminal!);
    if (tm.length >= 2) usviews.push(`최종금리(상단)를 제시한 ${tm.length}곳 기준 ${rate2(Math.min(...tm))} ~ ${rate2(Math.max(...tm))}`);
    // NH 의견은 표 첫 줄(강조)과 금리 전망 장표에 있어 요약에는 다시 쓰지 않는다
  }

  const forecast: string[] = [];
  if (d.forecast && !fcStale) {
    forecast.push(d.forecast.rows.some((r) => r.cells.some((c) => /^\d{4}$/.test(c.period))) ? `${d.forecast.house} 리서치 금리 전망표(${yymmdd(d.forecast.published_dt)} 발표) 기준` : `${d.forecast.house} 리서치 공개 코멘트(${yymmdd(d.forecast.published_dt)}) 기준 기준금리 경로`);
    for (const row of d.forecast.rows) {
      const fy = row.cells.filter((c) => /^\d{4}$/.test(c.period));
      if (fy.length) forecast.push(`${row.label}(${row.basis}): ${fy.map((c) => `${c.period}년 ${rate2(c.value)}`).join(', ')}`);
      else if (pathText(row)) forecast.push(`${row.label}(${row.basis}) 경로: ${pathText(row)}`);
    }
    if (nhView) forecast.push(`최근 의견(${yymmdd(nhView.published_dt)}): ${nhView.summary}`);
  } else if (nhView) forecast.push(`NH투자증권 리서치 최근 의견(${yymmdd(nhView.published_dt)}): ${nhView.summary}`);

  const league: string[] = [];
  const ly = d.leagueYearly;
  if (ly.length) {
    const nhRanks = ly.map((y) => ({ y, r: y.lead.find((x) => x.isNh) }));
    league.push(`${ly[0].year}년 이후 공모 회사채 대표주관 실적 순위: ${nhRanks.map(({ y, r }) => `${y.ytd ? `${y.year}년(누적)` : `${y.year}년`} ${r ? `${r.rank}위` : '–'}`).join(', ')}`);
    const cur = ly[ly.length - 1];
    const nhc = cur.lead.find((x) => x.isNh);
    if (nhc) league.push(`${cur.year}년${cur.ytd ? ' 누적' : ''} 대표주관 ${eokW(nhc.krw)}, 점유율 **${nhc.share.toFixed(1)}%**`);
  }

  // 만기도래: DM 시장 수급 문구(supplyIssues)가 있으면 그 문구가 시장 전체 흐름을 말하므로 숫자 두 줄(합계·고객 등급)만
  const maturity: string[] = [];
  const mg = d.maturityByGrade;
  const sup = supplyIssues(d).length > 0;
  if (mg.months.length) {
    const tot = mg.total.reduce((a, b) => a + b, 0);
    maturity.push(`${mg.months[0].replace('-', '.')} ~ ${mg.months[mg.months.length - 1].replace('-', '.')} 일반 공모 회사채 만기도래 ${eokW(tot)}`);
    const peak = mg.total.indexOf(Math.max(...mg.total));
    if (!sup) maturity.push(`만기도래가 가장 많은 달은 ${Number(mg.months[peak].slice(5, 7))}월(${eokW(mg.total[peak])}), 차환 발행 수요가 몰리는 시기`);
    const g = d.company.rating_group;
    const gr = mg.rows.find((x) => (g === 'BBB' || g === 'BB' || g === 'B' ? x.grade === 'BBB 이하' : x.grade === g));
    if (gr) {
      const gp = gr.values.indexOf(Math.max(...gr.values));
      maturity.push(`**${gr.grade}등급** 만기도래 ${eokW(gr.total)}${sup && gr.values[gp] ? `, 가장 많은 달은 ${Number(mg.months[gp].slice(5, 7))}월(${eokW(gr.values[gp])})` : ''}`);
    }
    const h1 = mg.total.slice(0, 6).reduce((a, b) => a + b, 0);
    const h2 = mg.total.slice(6).reduce((a, b) => a + b, 0);
    if (!sup) maturity.push(`앞 6개월 ${eokW(h1)}, 뒤 6개월 ${eokW(h2)}으로 ${h1 >= h2 ? '앞쪽' : '뒤쪽'}에 만기가 몰려 있어 ${h1 >= h2 ? '단기적으로 차환 발행이 집중될 것으로 판단' : '해당 기간 차환 발행 증가에 대비한 일정 선점 필요'}`);
  }

  // Sales 전략: 투자자 구분별 참여(회사·같은 등급). 같은 등급보다 높은 투자자군은 강점(유지·재마케팅), 낮은 투자자군은 확대 대상.
  // 만기와 투자자군 연결은 회사 만기별 구성에 실제 차이(5%p 이상)가 있을 때만 쓴다(통념으로 잇지 않음).
  const sales: string[] = [];
  const ownTyped = typedIssues(d.own, 4);
  const ownMix = mixOf(ownTyped.trs);
  const peerTyped = typedTranches(peerPool(d, inp.peerScope).filter((p) => p.corp_code !== d.company.corp_code));
  const peerMix = mixOf(peerTyped.trs);
  const how: Record<string, string> = {
    fund: '운용사 대상 IR·NDR',
    broker: '증권사(리테일·인수단) 세일즈',
    inst: '연기금·은행·보험 대상 NDR',
    etc: '기타 기관 수요 파악',
    foreign_y: '외국 기관 수요 파악',
    foreign_n: '외국 기관 수요 파악',
  };
  if (ownMix.total) {
    const rows = [...ownMix.rows].sort((a, b) => b.q - a.q).filter((x) => x.share >= 1);
    sales.push(`${name} ${ownTyped.label} 수요예측 참여 ${eokW(ownMix.total)}: ${rows.map((x, k) => (k ? `${x.label} ${x.share.toFixed(0)}%` : `**${x.label} ${x.share.toFixed(0)}%**`)).join(', ')}`);
  }
  if (peerMix.total && !ownMix.total) {
    const rows = [...peerMix.rows].sort((a, b) => b.q - a.q).filter((x) => x.share >= 1);
    sales.push(`최근 1년 ${grp}등급(${peerTyped.n}건) 수요예측 참여: ${rows.map((x, k) => (k ? `${x.label} ${x.share.toFixed(0)}%` : `**${x.label} ${x.share.toFixed(0)}%**`)).join(', ')}`);
    sales.push(`같은 등급 주력 투자자군(${rows[0].label}) 대상 ${how[rows[0].t] ?? 'IR·NDR'}와 직전 참여 기관 재마케팅 병행 제안`);
  }
  if (peerMix.total && ownMix.total) {
    const gaps = peerMix.rows.map((x) => ({ x, own: ownMix.rows.find((o) => o.t === x.t)?.share ?? 0 })).map((g) => ({ ...g, diff: g.own - g.x.share }));
    const strong = gaps.filter((g) => g.diff >= 5).sort((a, b) => b.diff - a.diff);
    const weak = gaps.filter((g) => g.diff <= -5).sort((a, b) => a.diff - b.diff);
    const peerTxt = `최근 1년 ${grp}등급(${peerTyped.n}건)`;
    if (strong.length) {
      const inst = strong.filter((g) => g.x.t === 'fund' || g.x.t === 'inst');
      sales.push(`${peerTxt} 대비 ${strong.map((g) => `${g.x.label} +${Math.round(g.diff)}%p`).join(', ')}${inst.length ? ' 높아 **기관 수요 기반이 두터움**' : ' 높음'} → 직전 참여 기관 재마케팅으로 수요 유지`);
    }
    if (weak.length) {
      const g = weak[0];
      sales.push(`${g.x.label} 참여 비중은 같은 등급보다 ${Math.abs(Math.round(g.diff))}%p 낮음 → ${how[g.x.t] ?? 'IR·NDR'}로 수요 확대 여지${g.x.t === 'broker' ? '(NH투자증권 리테일·인수단 네트워크 활용)' : ''}`);
    }
    if (!strong.length && !weak.length) sales.push(`${peerTxt}과 투자자 구성이 비슷해(차이 5%p 미만) 직전 참여 기관 중심 재마케팅 제안`);
  }
  // 만기별 투자자 구성 차이: 제안 만기끼리, 같은 투자자군의 비중 차이가 가장 큰 것
  {
    const tenors = inp.tranches.map((t) => t.tenor.trim()).filter(Boolean);
    const per = tenors.map((k) => ({ k, m: mixOf(ownTyped.trs.filter((t) => t.tenor === k)) })).filter((x) => x.m.total);
    if (per.length >= 2) {
      let best: { t: string; label: string; hi: string; lo: string; diff: number } | null = null;
      for (const r of ownMix.rows) {
        const sh = per.map((x) => ({ k: x.k, v: x.m.rows.find((y) => y.t === r.t)?.share ?? 0 }));
        const hi = sh.reduce((a, b) => (a.v >= b.v ? a : b));
        const lo = sh.reduce((a, b) => (a.v <= b.v ? a : b));
        if (!best || hi.v - lo.v > best.diff) best = { t: r.t, label: r.label, hi: hi.k, lo: lo.k, diff: hi.v - lo.v };
      }
      if (best && best.diff >= 5) sales.push(`${best.hi}물은 ${best.lo}물보다 ${best.label} 비중이 ${Math.round(best.diff)}%p 높아 ${best.hi}물은 ${how[best.t] ?? 'IR·NDR'} 중심으로 배분`);
      else if (best) {
        const tops = per.map((x) => [...x.m.rows].sort((a, b) => b.q - a.q)[0]?.label);
        const same = tops.every((l) => l && l === tops[0]);
        sales.push(`만기별 투자자 구성 차이가 작아(${same ? `${per.map((x) => x.k).join('·')} 모두 ${tops[0]} 최대` : `같은 투자자군 비중 차이 최대 ${Math.round(best.diff)}%p`}) 만기 구분 없이 같은 세일즈 진행`);
      }
    }
  }

  // 발행조건 표 비고
  const termNotes: TermNotes = {
    rating: inp.ratingNote,
    tenor: ownSame ? `직전 같은 구조(제${ownSame.series ?? ''}회) 경쟁률 ${ratioX(ownSame.ratio)}`
      : pc && pcTop ? `최근 1년 ${grp}등급 최다 구조(${pc.issues}건, 비중 ${Math.round(pc.share)}%)`
        : propMix.length ? `최근 1년 ${grp}등급 발행 중 ${propMix.map((x) => `${x.k}물 ${x.share.toFixed(1)}%`).join('·')}` : '',
    amount: `시장 상황에 따라 트랜치별 금액 조정 가능\n수요예측 결과에 따라 증액 여부 협의${inp.maxEok ? `(최대 ${inp.maxEok.toLocaleString('ko-KR')}억원)` : ''}`,
    band: inp.bandNote,
    coupon: /월단위|매월/.test(inp.coupon) ? '리테일 투자자 선호 반영' : '시장 관행(3개월 이표) 적용',
    demand: sch ? `증권신고서 제출(${mdw(sch.filing)}) 후 수요예측 가능일 ${mdw(sch.demandOptions[0])} ~ ${mdw(sch.demandOptions[2])} 중 택1` : '',
    pay: sch ? (() => {
      const m = d.events.find((e) => e.kind === '금통위' && e.event_dt >= sch.demand && e.event_dt <= addMonths(sch.pay, 0));
      return m ? `금통위(${mdw(m.event_dt)}) 전후 금리 변동성 고려` : '시장 상황 고려 변경 가능';
    })() : '시장 상황 고려 변경 가능',
    uw: '협의 가능',
    fee: inp.feeNote,
  };

  // 시장 장표는 Discussion Material 판 문구를 그대로 쓴다(현업 방식). 판이 없으면 위의 규칙 문구
  const dmp = d.dm?.pages;
  const use = (x: string[] | undefined, fb: string[]) => (x?.length ? [...x] : fb);
  return {
    lead, nhTrack, peers, compare, schedule, timing, structure, structureRows, strengths,
    rates: use(dmp?.rates, rates), corp, views: use(dmp?.views, views), sizing, pipeline, bok: use(dmp?.bok, bok), fomc: use(dmp?.fomc, fomc), usviews: use(dmp?.usviews, usviews),
    forecast: use(dmp?.forecast, forecast), league, maturity, sales, termNotes,
  };
}

// 다음 조정 경로 문구에서 '인상' 시점(월) 목록: '10월 동결·12월 인상' → [12], '11월·내년 2월 인상' → [11, 2]
// '·'로 나눈 조각에 동사가 없으면 뒤 조각의 동사를 따른다
export function hikeMonths(s: string | null) {
  const segs = String(s ?? '').split(/[·,]/).map((x) => x.trim()).filter(Boolean);
  const out: number[] = [];
  let verb = '';
  for (let i = segs.length - 1; i >= 0; i--) {
    const v = segs[i].match(/인상|동결|인하/)?.[0];
    if (v) verb = v;
    const m = segs[i].match(/(\d{1,2})월/);
    if (m && verb === '인상') out.unshift(Number(m[1]));
  }
  return out;
}

// 최빈값(동률이면 큰 값)
function modeOf(xs: number[]) {
  if (!xs.length) return null;
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  const [v, n] = [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return { v, n };
}

// 발행 구조 키(예: 2년+3년+5년): 트랜치 만기를 짧은 순으로
export const comboOf = (p: PeerIssue) => p.tranches.slice().sort((a, b) => (a.months ?? 0) - (b.months ?? 0)).map((t) => t.tenor).join('+') || p.tenor_combo;
export function comboCounts(pool: PeerIssue[]) {
  const m = new Map<string, number>();
  for (const p of pool) m.set(comboOf(p), (m.get(comboOf(p)) ?? 0) + 1);
  return [...m.entries()].map(([combo, issues]) => ({ combo, issues, share: pool.length ? (issues / pool.length) * 100 : 0 })).sort((a, b) => b.issues - a.issues);
}

// 차환 수요: 납입일 뒤 75일 안의 기존 공모 회사채 만기(납입일이 없으면 기준일 뒤 150일)
export function refiNeed(d: DeckData, pay: string | null | undefined) {
  const ok = !!pay && /^\d{4}-\d{2}-\d{2}$/.test(pay);
  const from = ok ? addDays(pay!, -1) : d.asof;
  const to = ok ? addDays(pay!, 75) : addDays(d.asof, 150);
  const list = (d.maturitiesLong?.rows ?? d.maturities).filter((m) => m.amount_krw && m.dt > from && m.dt <= to).sort((x, y) => x.dt.localeCompare(y.dt));
  const ym = (s: string) => ({ y: s.slice(2, 4), m: Number(s.slice(5, 7)) });
  const [a, b] = list.length ? [ym(list[0].dt), ym(list[list.length - 1].dt)] : [null, null];
  const label = !a || !b ? '' : a.y !== b.y ? `'${a.y}.${a.m}~'${b.y}.${b.m}월` : `'${a.y}.${a.m === b.m ? a.m : `${a.m}~${b.m}`}월`;
  return { list, label };
}
// 같은 등급 최근 n개월 만기별 확정 가산금리 평균(제안 만기만)
export function gradeSpreads(pool: PeerIssue[], asof: string, months: number, tenors: string[]) {
  const from = addMonths(asof, -months);
  const want = new Set(tenors.map((t) => t.replace(/\s/g, '')));
  const by = new Map<string, number[]>();
  for (const p of pool) {
    if ((p.demand_dt ?? p.deal_dt ?? '') < from) continue;
    for (const t of p.tranches) if (t.spread_bp != null && want.has(t.tenor.replace(/\s/g, ''))) by.set(t.tenor, [...(by.get(t.tenor) ?? []), Number(t.spread_bp)]);
  }
  return [...by.entries()].map(([k, xs]) => ({ k, n: xs.length, avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) })).sort((a, b) => (parseFloat(a.k) || 0) - (parseFloat(b.k) || 0));
}
const bandDescShort = (inp: DeckInput) => (inp.band.type === 'later' ? '(추후 결정)' : inp.band.type === 'fixed' ? `${inp.band.low ?? '–'}~${inp.band.high ?? '–'}%` : `${inp.band.low ?? '–'}~+${inp.band.high ?? '–'}bp`);

// 증액 한도: 회사 최근 4회 중 최대 증액 배율(발행/최초 신고)을 신고 금액에 곱하고 100억 단위로 올림. 배율은 1~2배로 자른다.
export function maxPlan(d: DeckData, totalEok: number) {
  if (!totalEok) return null;
  const xs = d.own.slice(0, 4).filter((p) => p.initial_krw && p.amount_krw).map((p) => ({ p, r: Number(p.amount_krw) / Number(p.initial_krw) }));
  if (!xs.length) return { max: totalEok * 2, mult: 2, n: 0, from: null as PeerIssue | null };
  const top = xs.reduce((a, b) => (b.r > a.r ? b : a));
  const mult = Math.min(2, Math.max(1, top.r));
  return { max: Math.ceil((totalEok * mult) / 100) * 100, mult, n: xs.length, from: top.p };
}

// 발행 시기 규칙(현업 관행, 노하우 DB로 옮길 후보):
// ① 가장 이른 가능일 = 기준일 + 25영업일 ② 그 뒤 150일 안에 기존 회사채 만기가 있으면 만기 2주 전 납입
// ③ 12/15~12/31(연말 북클로징)은 피함: 1월 중순 이후 만기면 1월 2주차, 아니면 12월 14일 이전 ④ 만기가 없어도 연말이면 1월로
// 연말 북클로징(12/15~12/31): 납입일뿐 아니라 수요예측 가능일(납입 7영업일 전)이 걸려도 피한다
export const yearEndOf = (cal: BizCal, s: string) => s.slice(5) >= '12-15' || cal.add(s, -7).slice(5) >= '12-15';
// 연초 첫 납입 가능일: 1월 2주차(1/7 + 3영업일)부터, 수요예측 가능일이 12월에 걸리지 않을 때까지 미룬다
export function janPayOf(cal: BizCal, s: string) {
  const y = Number(s.slice(0, 4)) + (s.slice(5, 7) === '12' ? 1 : 0);
  let x = cal.add(`${y}-01-07`, 3);
  while (yearEndOf(cal, x)) x = cal.add(x, 1);
  return x;
}

export function payPlan(d: DeckData) {
  const cal = calOf(d);
  const earliest = cal.add(d.asof, 25);
  const snap = (s: string) => cal.next(s);
  const yearEnd = (s: string) => yearEndOf(cal, s);
  const decOf = (s: string) => `${Number(s.slice(0, 4)) - (s.slice(5, 7) === '12' ? 0 : 1)}-12-10`;
  const janStart = (s: string) => janPayOf(cal, s);
  const next = d.maturities.find((m) => m.dt > earliest && daysBetween(earliest, m.dt) <= 150);
  let pay = earliest;
  let reason = '';
  if (next) {
    const target = snap(addDays(next.dt, -14));
    pay = target > earliest ? target : earliest;
    reason = `기존 회사채 만기(${mdw(next.dt)}, ${eokW(next.amount_krw)}) 2주 전 납입으로 차환 재원 확보`;
    if (yearEnd(pay)) {
      if (next.dt.slice(5, 7) === '01' && Number(next.dt.slice(8, 10)) >= 20) {
        pay = janStart(pay);
        reason = `기존 회사채 만기(${mdw(next.dt)}, ${eokW(next.amount_krw)})를 앞두고 연말을 피해 연초 기관 자금 집행 시기에 발행`;
      } else {
        const dec = snap(decOf(pay));
        pay = dec >= earliest ? dec : janStart(pay);
        reason = `기존 회사채 만기(${mdw(next.dt)}, ${eokW(next.amount_krw)}) 전 납입, 연말 북클로징 전 발행`;
      }
    }
  } else if (yearEnd(earliest)) {
    pay = janStart(earliest);
    reason = '연말 북클로징 기간을 피해 연초 기관 자금 집행 시기에 발행';
  }
  return { pay, reason };
}
function addDays(s: string, n: number) {
  const x = new Date(`${s}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// 수요예측 예정 내역: 일반 회사채만(금융채·신종자본증권·후순위 제외), 리츠 제외
export const pipelineOf = (d: DeckData) => d.pipeline.filter((p) => (p.sub_type ?? '일반회사채') === '일반회사채' && !isReit(p.corp_name));
// 제안 수요예측일 전후 3주 안의 예정 건(경쟁 발행). 일정·Sales 판단에는 이 건들만 쓴다(먼 날짜의 예정 건은 경쟁이 아니다)
export function nearPipeline(d: DeckData, demand: string, days = 21) {
  return pipelineOf(d).filter((p) => p.demand_dt && daysBetween(p.demand_dt, demand) <= days);
}

// 공개 전망표 발표 뒤에 금통위·FOMC 결과가 나왔으면 오래된 표로 본다(표 대신 최근 의견만 쓴다)
export function forecastStale(d: DeckData) {
  const fc = d.forecast;
  if (!fc) return false;
  return d.events.some((e) => (e.kind === '금통위' || e.kind === 'FOMC') && (e.end_dt ?? e.event_dt) > fc.published_dt && (e.end_dt ?? e.event_dt) < d.asof);
}

// 제안 트랜치가 만기되는 해(납입일 + 만기). 회사 만기분포에서 '만기도래 없음'은 이 해들만 본다.
export function proposedYears(inp: DeckInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.pay ?? '')) return [] as string[];
  const out = new Set<string>();
  for (const t of inp.tranches) for (const m of t.tenor.matchAll(/(\d+(?:\.\d+)?)\s*년/g)) out.add(addMonths(inp.pay, Math.round(Number(m[1]) * 12)).slice(0, 4));
  return [...out].sort();
}

// 제안 만기 안: 트랜치 만기('또는'으로 대안), 트랜치가 둘 이상이면 조합
export function tenorOptions(inp: DeckInput) {
  const tr = inp.tranches.map((t) => t.tenor.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of tr) for (const x of t.split(/\s*(?:또는|,|\/)\s*/)) if (x && !out.includes(x)) out.push(x);
  if (tr.length > 1 && tr.every((t) => !/또는/.test(t))) out.push(tr.join('+'));
  return out;
}
// 제안 트랜치 중 가장 긴 만기(년). 만기 공백을 볼 범위로 쓴다(없으면 3년).
export const horizonOf = (inp: DeckInput) => Math.max(0, ...inp.tranches.map((t) => Math.max(0, ...[...t.tenor.matchAll(/(\d+(?:\.\d+)?)\s*년/g)].map((m) => Number(m[1]))))) || 3;
export const tenorText = (inp: DeckInput) => inp.tranches.map((t) => t.tenor.trim()).filter(Boolean).join(' / ');
export const totalEok = (inp: DeckInput) => inp.tranches.reduce((a, t) => a + (t.eok ?? 0), 0);

function addMonths(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addYears(s: string, n: number) {
  return addMonths(s, n * 12);
}
const bpSigned = (v: number | null) => (v == null ? '–' : v === 0 ? 'Par' : `${v > 0 ? '+' : ''}${v}bp`);
function daysBetween(a: string, b: string) {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

// ---------------------------------------------------------------------------------------------
// AI 에게 주는 사실 묶음 (장표별). 숫자는 화면 표기 그대로 문자열로 넣어 검증과 맞춘다.
export function factsFor(d: DeckData, inp: DeckInput) {
  const sch = scheduleOf(d, inp);
  const pool = peerPool(d, inp.peerScope);
  const sel = pool.filter((p) => inp.peerKeys.includes(p.key));
  const cmp = inp.compareKeys.map((k) => d.peers.find((p) => p.key === k)).filter(Boolean) as PeerIssue[];
  const peerFact = (p: PeerIssue) => ({
    회사: p.corp_name, 등급: p.rating, 수요예측일: p.demand_dt ? mdw(p.demand_dt) : null, 납입일: p.deal_dt ? mdw(p.deal_dt) : null,
    만기구조: p.tenor_combo, 예측금액: eokW(p.initial_krw), 발행금액: eokW(p.amount_krw), 총참여: eokW(p.demand_krw), 밴드내참여: eokW(p.in_band_krw),
    경쟁률: ratioX(p.ratio), 미달: p.under, 증액: p.increased, 금리밴드: bandText(p),
    발행금리: p.tranches.map((t) => `${t.tenor} ${rate3(t.yield_pct)}`).join(', '), 대표주관: p.lead,
  });
  return {
    회사: d.company.corp_name, 등급: d.company.rating, 등급군: d.company.rating_group, 기준일: d.asof,
    제안조건: {
      회차: inp.series, 트랜치: inp.tranches.filter((t) => t.tenor).map((t) => `${t.tenor} ${t.eok != null ? `${t.eok.toLocaleString('ko-KR')}억원` : '금액 미정'}`),
      합계: `${totalEok(inp).toLocaleString('ko-KR')}억원`, 최대: inp.maxEok != null ? `${inp.maxEok.toLocaleString('ko-KR')}억원` : null,
      이자지급: inp.coupon, 금리밴드: inp.band.type === 'later' ? '추후 결정' : inp.band.type === 'fixed' ? `고정금리 ${inp.band.low}%~${inp.band.high}%` : `개별민평 ${inp.band.low}~${inp.band.high}bp`,
    },
    일정: sch && {
      납입일: `${mdw(sch.pay)}, ${korDate(sch.pay)}`, 수요예측가능일: sch.demandOptions.map((x) => `${mdw(x)} ${korDate(x)}`), 권장수요예측일: korDate(sch.demand),
      증권신고서제출: mdw(sch.filing), 대표주관계약: mdw(sch.leadContract), 협회신고: mdw(sch.kofia), 조건확정정정: mdw(sch.condFix),
      금리확정정정: sch.rateFix ? mdw(sch.rateFix) : null, 상장: mdw(sch.listing), 주의: sch.warnings,
    },
    같은등급사례: { 범위: inp.peerScope === 'notch' ? d.company.rating : `${d.company.rating_group}등급`, 전체건수: pool.length, 표: sel.map(peerFact) },
    비교사례: cmp.map(peerFact),
    회사직전회차: d.own.slice(0, 4).map(peerFact),
    만기도래: d.maturities.map((m) => ({ 만기일: yymmdd(m.dt), 회차: m.series, 금액: eokW(m.amount_krw), 금리: rate3(m.coupon_pct) })),
    만기도래합계: { 향후3년: eokW(d.maturities.reduce((s, m) => s + (m.amount_krw ?? 0), 0)), 건수: d.maturities.length, '1년내': eokW(d.maturities.filter((m) => m.dt <= addYears(d.asof, 1)).reduce((s, m) => s + (m.amount_krw ?? 0), 0)) },
    같은등급만기비중: (() => {
      const t = tenorMix(pool);
      return t.total ? { 범위: inp.peerScope === 'notch' ? d.company.rating : `${d.company.rating_group}등급`, 기간: '최근 1년', 건수: t.issues, 합계: eokW(t.total), 만기: t.rows.map((x) => ({ 만기: x.k, 발행금액: eokW(x.amount), 비중: `${x.share.toFixed(1)}%` })), 상위2만기: t.top2.map((x) => `${x.k}물 ${x.share.toFixed(1)}%`), 상위2합계: `${t.top2Share.toFixed(1)}%` } : null;
    })(),
    회사만기분포: (() => {
      const b = maturityBuckets(d, horizonOf(inp));
      const py = proposedYears(inp);
      return { 구간: b.buckets.map((x) => `${x.label} ${x.amount ? eokW(x.amount) : '없음'}`), 제안만기해: py.map((y) => `'${y.slice(2)}년`), 제안만기해중_만기도래없음: b.gaps.filter((y) => py.includes(y)).map((y) => `'${y.slice(2)}년`) };
    })(),
    차환수요: (() => {
      const r = refiNeed(d, inp.pay);
      if (!r.list.length) return null;
      const amt = r.list.reduce((a, m) => a + Number(m.amount_krw ?? 0), 0);
      const tot = totalEok(inp) * 1e8;
      return { 구간: r.label, 합계: eokW(amt), 만기: r.list.map((m) => `${mdw(m.dt)} ${eokW(m.amount_krw)}`), 최초신고대비: tot ? `${Math.round((tot / amt) * 100)}%` : null };
    })(),
    확정가산금리비교: (() => {
      const iss = d.own.slice(0, 4).filter((p) => p.tranches.some((t) => t.spread_bp != null));
      const sp = iss.flatMap((p) => p.tranches.map((t) => t.spread_bp)).filter((v): v is number => v != null);
      const mkt = gradeSpreads(pool.filter((p) => p.corp_code !== d.company.corp_code), d.asof, 3, inp.tranches.map((t) => t.tenor));
      return sp.length ? { 회사평균: bpSigned(Math.round(sp.reduce((a, b) => a + b, 0) / sp.length)), 회사평균_기준: `제${iss.map((p) => p.series ?? '').join('·')}회 ${sp.length}개 트랜치`, 최저: bpSigned(Math.min(...sp)), 최고: bpSigned(Math.max(...sp)), 같은등급최근3개월: mkt.map((x) => `${x.k} ${bpSigned(x.avg)}(${x.n}건)`) } : null;
    })(),
    발행시기후보: (() => {
      const t = timingOf(d, inp);
      return t.opts.map((o, i) => ({
        안: o.key, 권고: i === t.rec, 성격: o.title, 수요예측: mdw(o.sch.demand), 납입: mdw(o.sch.pay),
        만기대응: o.before.length ? `납입 전 만기 ${eokW(o.before.reduce((a, m) => a + m.amount, 0))}` : o.covered.map((m) => `${mdw(m.dt)} ${eokW(m.amount)} 선조달 ${m.idle}일`),
        시장만기도래: o.market && `${o.market.month}월 ${(o.market.amount / 1e12).toFixed(1)}조원(${o.market.rank}위)`,
        전년같은달: o.lastYear && `${o.lastYear.label} ${o.lastYear.n}건 평균 ${ratioX(o.lastYear.avg)}`,
        장점: o.pros, 단점: o.cons, 참고: o.notes,
      }));
    })(),
    NH주관이력: d.own.slice(0, 4).filter((p) => p.nh_lead).map((p) => ({ 회차: `제${p.series ?? ''}회`, 경쟁률: ratioX(p.ratio), 확정가산금리: p.tranches.map((t) => `${t.tenor} ${bpSigned(t.spread_bp)}`) })),
    만기구조통계: d.combos.map((c) => ({ 구조: c.combo, 건수: c.issues, 비중: `${Math.round(c.share ?? 0)}%`, 경쟁률중간값: ratioX(c.medComp) })),
    리그테이블: {
      등급군: d.league.rows.slice(0, 6).map((r, i) => ({ 순위: i + 1, 증권사: r.firm, 실적: eokW(r.credit), 건수: r.deals })),
      전체: d.leagueAll.rows.slice(0, 6).map((r, i) => ({ 순위: i + 1, 증권사: r.firm, 실적: eokW(r.credit), 점유율: `${((r.credit / (d.leagueAll.total || 1)) * 100).toFixed(1)}%` })),
      NH회사대표주관: `${d.own.filter((p) => p.nh_lead).length}회/${d.own.length}회`,
    },
    금리: d.rates.map((r) => ({ 지표: r.label, 값: r.key === 'base_rate' ? rate2(r.value) : rate3(r.value), 기준일: yymmdd(r.dt), 변화1개월: bpS(r.chg1m), 변화1년: bpS(r.chg1y) })),
    리서치전망표: d.forecast && {
      하우스: d.forecast.house, 발표일: yymmdd(d.forecast.published_dt),
      값: d.forecast.rows.map((r) => ({ 지표: r.label, 기준: r.basis, 값: r.cells.map((c) => `${c.period}${c.actual ? '(실적)' : ''} ${rate2(c.value)}`) })),
    },
    증권사의견: d.views.map((v) => ({ 하우스: v.house, 날짜: yymmdd(v.published_dt), 방향: v.stance, 다음조정: v.next_move, 최종금리: v.terminal != null ? rate2(v.terminal) : null, 요약: v.summary })),
    미국금리의견: d.usViews.map((v) => ({ 하우스: v.house, 날짜: yymmdd(v.published_dt), 다음조정: v.next_move, 최종금리: v.terminal != null ? rate2(v.terminal) : null, '2026년말': v.end2026 != null ? rate2(v.end2026) : null, '2027년말': v.end2027 != null ? rate2(v.end2027) : null, 요약: v.summary })),
    금통위: d.policy.bok && { 날짜: yymmdd(d.policy.bok.meeting_dt), 결정: d.policy.bok.decision, 표결: d.policy.bok.vote, 포인트: d.policy.bok.points },
    FOMC: d.policy.fomc && { 날짜: yymmdd(d.policy.fomc.meeting_dt), 결정: d.policy.fomc.decision, 표결: d.policy.fomc.vote, 포인트: d.policy.fomc.points },
    수요예측예정합계: { 건수: pipelineOf(d).length, 금액: eokW(pipelineOf(d).reduce((t, p) => t + p.tranches.reduce((a, x) => a + (x.initial_krw ?? 0), 0), 0)) },
    수요예측예정: pipelineOf(d).map((p) => ({ 회사: p.corp_name, 등급: p.rating, 수요예측일: p.demand_dt ? mdw(p.demand_dt) : null, 납입일: p.pay_dt ? mdw(p.pay_dt) : null, 트랜치: p.tranches.map((t) => `${t.tenor} ${eokW(t.initial_krw)}`) })),
    연간리그테이블: d.leagueYearly.map((y) => ({ 연도: y.ytd ? `${y.year}(누적)` : y.year, NH: y.lead.find((x) => x.isNh) && { 순위: y.lead.find((x) => x.isNh)!.rank, 금액: eokW(y.lead.find((x) => x.isNh)!.krw), 점유율: `${y.lead.find((x) => x.isNh)!.share.toFixed(1)}%` } })),
    만기별수요_최근4회: tenorDemand(d.own, 4).map((x) => ({ 만기: x.k, 평균경쟁률: ratioX(x.avg), 참여금액합: eokW(x.demand), 평균신고: eokW(x.initAvg), 트랜치수: x.n })),
    최근3회평균참여: (() => {
      const xs = d.own.slice(0, 3).filter((p) => p.demand_krw != null);
      return xs.length ? eokW(xs.reduce((t, p) => t + Number(p.demand_krw), 0) / xs.length) : null;
    })(),
    회사만기도래연도별: Object.fromEntries([...fullYearLoads(d).entries()].map(([y, v]) => [y, eokW(v)])),
    제안만기연도기존만기도래: proposedMaturityLoad(d, inp.tranches.filter((t) => t.tenor), inp.pay).map((x) => ({ 만기: x.tenor, 연도: x.year, 기존만기도래: x.amount ? eokW(x.amount) : '없음' })),
    만기도래상하반기: { 앞6개월: eokW(d.maturityByGrade.total.slice(0, 6).reduce((a, b) => a + b, 0)), 뒤6개월: eokW(d.maturityByGrade.total.slice(6).reduce((a, b) => a + b, 0)) },
    투자자구분참여: {
      회사회차: typedIssues(d.own, 4).label || null,
      회사합계: eokW(mixOf(typedIssues(d.own, 4).trs).total),
      회사: mixOf(typedIssues(d.own, 4).trs).rows.map((x) => ({ 구분: x.label, 금액: eokW(x.q), 비중: `${x.share.toFixed(0)}%` })),
      같은등급합계: eokW(mixOf(typedTranches(pool.filter((p) => p.corp_code !== d.company.corp_code)).trs).total),
      같은등급최근1년: mixOf(typedTranches(pool.filter((p) => p.corp_code !== d.company.corp_code)).trs).rows.map((x) => ({ 구분: x.label, 금액: eokW(x.q), 비중: `${x.share.toFixed(0)}%` })),
    },
    회사트랜치별결과: d.own.slice(0, 4).flatMap((p) => p.tranches.map((t) => ({
      회차: `제${p.series ?? ''}회`, 만기: t.tenor, 수요예측일: p.demand_dt ? mdw(p.demand_dt) : null, 신고: eokW(t.initial_krw), 참여: eokW(t.demand_krw),
      경쟁률: ratioX(trRatio(t)), 발행: eokW(t.amount_krw), 발행금리: rate3(t.yield_pct), 확정가산금리: bpSigned(t.spread_bp),
      국고대비: (() => { const v = spreadVsKtb(d, p, t); return v == null ? null : `${v}bp`; })(),
    }))),
    등급별평균경쟁률: notchStats(pool).map((x) => ({ 등급: x.rating, 건수: x.n, 평균: ratioX(x.avg) })),
    금통위전후변동성: (() => {
      const v = meetingVolatility(d, d.events.filter((e) => e.kind === '금통위' && e.event_dt < d.asof).map((e) => e.event_dt));
      return v && { 회의수: v.meetings, 평균: v.byLag.map((x) => `${x.lag ? `D-${x.lag}` : '당일'} ${x.bp}bp`) };
    })(),
    리서치최근의견: d.forecast?.notes.map((x) => ({ 주제: x.topic, 날짜: yymmdd(x.date), 요약: x.text })) ?? [],
    회의패널: [d.policy.bok, d.policy.fomc].filter(Boolean).map((m) => ({ 회의: m!.title, 표: m!.panels.filter((x) => x.kind === 'table').map((x) => x.kind === 'table' ? { 제목: x.title, 열: x.columns, 행: x.rows } : null) })),
    등급별만기도래: {
      기간: d.maturityByGrade.months.length ? `${d.maturityByGrade.months[0].replace('-', '.')} ~ ${d.maturityByGrade.months[d.maturityByGrade.months.length - 1].replace('-', '.')}` : null,
      합계: eokW(d.maturityByGrade.total.reduce((a, b) => a + b, 0)),
      월별합계: d.maturityByGrade.months.map((mm, i) => `${Number(mm.slice(5, 7))}월 ${eokW(d.maturityByGrade.total[i])}`),
      등급별: d.maturityByGrade.rows.map((r) => ({ 등급: r.grade, 합계: eokW(r.total) })),
    },
  };
}

// Sales 전략 AI 에 보내는 사실 묶음(공개 데이터만). 내부 데이터(기관별 참여·배정)는 사외 AI 로 보내지 않는다.
export function salesFacts(d: DeckData, inp: DeckInput) {
  const f = factsFor(d, inp);
  const pool = peerPool(d, inp.peerScope);
  const withRatio = pool.filter((p) => p.ratio != null);
  return {
    회사: f.회사, 등급: f.등급, 기준일: f.기준일, 제안조건: f.제안조건,
    일정: f.일정 && { 납입일: f.일정.납입일, 권장수요예측일: f.일정.권장수요예측일 },
    투자자구분참여: f.투자자구분참여,
    // 같은 등급(사업회사, 원자료 점검 통과 건) 대비 비중 차이: +면 회사가 더 높음(강점), -면 낮음(확대 대상)
    같은등급대비_비중차이: (() => {
      const own = mixOf(typedIssues(d.own, 4).trs);
      const peer = mixOf(typedTranches(pool.filter((p) => p.corp_code !== d.company.corp_code)).trs);
      if (!own.total || !peer.total) return null;
      return peer.rows.map((x) => {
        const o = own.rows.find((y) => y.t === x.t)?.share ?? 0;
        return { 구분: x.label, 회사: `${o.toFixed(0)}%`, 같은등급: `${x.share.toFixed(0)}%`, 차이: `${pp(o - x.share)}%p` };
      });
    })(),
    // 회사 만기별 투자자 구성(제안 만기만). 만기와 투자자군을 잇는 근거는 이 수치뿐이다
    회사_만기별투자자구성: inp.tranches.map((t) => t.tenor.trim()).filter(Boolean).map((k) => {
      const m = mixOf(typedIssues(d.own, 4).trs.filter((t) => t.tenor === k));
      return m.total ? { 만기: k, 구성: m.rows.map((x) => `${x.label} ${x.share.toFixed(0)}%`) } : null;
    }).filter(Boolean),
    회사직전회차: f.회사직전회차,
    회사트랜치별결과: f.회사트랜치별결과.map(({ 국고대비: _x, ...r }) => r),
    만기별수요_최근4회: f.만기별수요_최근4회,
    같은등급요약: {
      범위: f.같은등급사례.범위, 건수: pool.length,
      경쟁률중간값: ratioX(median(withRatio.map((p) => p.ratio))),
      증액발행: `${pool.filter((p) => p.increased).length}건`, 미매각: `${pool.filter(fullUnder).length}건`,
    },
    같은등급만기비중: f.같은등급만기비중,
    // 경쟁 발행은 제안 수요예측일 전후 3주 안의 예정 건만(없으면 없다고 적는다)
    제안일전후3주_수요예측예정: (() => {
      const sch = scheduleOf(d, inp);
      if (!sch) return null;
      const near = nearPipeline(d, sch.demand);
      return near.length ? near.map((p) => ({ 회사: p.corp_name, 등급: p.rating, 수요예측일: p.demand_dt ? mdw(p.demand_dt) : null })) : '없음';
    })(),
  };
}

export { eok, shortFirm, tenorYears };

// 분기 경로 요약: 전망 칸만, 같은 값이 이어지면 '이후' 로 묶는다 (예: 4Q26 3.25% → 1Q27 이후 3.50%)
export function pathText(row: { cells: { period: string; value: number | null; actual: boolean }[] }) {
  const xs = row.cells.filter((c) => !c.actual && c.value != null);
  if (!xs.length) return '';
  const runs: { period: string; value: number; n: number }[] = [];
  for (const c of xs) {
    const last = runs[runs.length - 1];
    if (last && last.value === c.value) last.n++;
    else runs.push({ period: c.period, value: c.value as number, n: 1 });
  }
  return runs.map((r, i) => `${r.period}${i === runs.length - 1 && r.n > 1 ? ' 이후' : ''} ${rate2(r.value)}`).join(' → ');
}

// 주요 이슈 고르기: 양식은 고정, 내용은 시점별로 바뀐다. 기준일 60일 이내·유효기간 안에서 중요도 → 최신 순으로 상위 k개
// 시장 수급(만기 집중·정책 자금) 이슈는 DM 처럼 주요 이슈가 아니라 '만기도래 및 수급' 장표에 쓴다(supplyIssues)
const liveIssues = (d: DeckData) => {
  const from = addDays(d.asof, -60);
  return (d.issues ?? [])
    .filter((x) => x.as_of >= from && x.as_of <= d.asof && x.valid_until >= d.asof)
    .sort((a, b) => b.priority - a.priority || b.as_of.localeCompare(a.as_of));
};
export function pickIssues(d: DeckData, k = 4) {
  return liveIssues(d).filter((x) => x.section !== 'supply').slice(0, k);
}
export function supplyIssues(d: DeckData, k = 2) {
  return liveIssues(d).filter((x) => x.section === 'supply').slice(0, k);
}

// 납입월 시장 만기 집중: 향후 12개월 공모 회사채 만기 중 납입월이 상위 2개 달이고 월평균의 1.5배 이상이면 일정 문구로 알린다
export function marketCrowd(d: DeckData, pay: string) {
  const mg = d.maturityByGrade;
  const i = mg.months.indexOf(pay.slice(0, 7));
  if (i < 0 || mg.total.length < 6) return null;
  const avg = mg.total.reduce((a, b) => a + b, 0) / mg.total.length;
  const rank = [...mg.total].sort((a, b) => b - a).indexOf(mg.total[i]);
  if (rank > 1 || mg.total[i] < avg * 1.5) return null;
  const m = Number(pay.slice(5, 7));
  return `납입월(${m}월) 시장 공모 회사채 만기도래 ${(mg.total[i] / 1e12).toFixed(1)}조원으로 향후 12개월 중 ${rank === 0 ? '최대' : '두 번째'}(월평균 ${(avg / 1e12).toFixed(1)}조원): ${m <= 2 ? '연초 기관 자금 집행과 겹쳐 수요는 우호적이나 ' : ''}차환 발행이 몰리는 시기로, 수요예측일을 예정 내역과 겹치지 않게 분산 검토`;
}

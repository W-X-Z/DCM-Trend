// 기본 입력값과 규칙 문안. AI 문안이 없거나 검증에 실패하면 이 문안을 쓴다.
// 문체: 제안서 개조식(~진행, ~제안, ~수준). 숫자는 데이터 값 그대로, 계산값은 차이·비율만.
import { bandText, bpS, eok, eokW, mdw, ratioX, rate2, rate3, shortFirm, tenorYears, yy, yymmdd } from './fmt';
import { BizCal, buildSchedule, korDate, type Schedule } from './schedule';
import { defaultItems } from './catalog';
import { meetingVolatility, mixOf, notchStats, spreadVsKtb, yearsOf } from './analytics';
import type { DeckData, DeckInput, DeckText, PeerIssue, TermNotes } from './types';

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

export function peerPool(d: DeckData, scope: 'group' | 'notch') {
  const r = d.company.rating;
  // 수요예측을 마친 건만 (증권신고서만 낸 예정 건은 '수요예측 예정 내역' 장표에서 다룬다)
  return d.peers
    .filter((p) => (p.sub_type ?? '일반회사채') === '일반회사채')
    .filter((p) => (p.demand_dt ?? p.deal_dt ?? '') <= d.asof)
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
  const pay = cal.add(d.asof, 25);
  const pool = peerPool(d, 'group');
  const peerKeys = pool.slice(0, 6).map((p) => p.key);
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
    ratingNote: last?.deal_dt && d.company.rating ? `${yy(last.deal_dt)} 발행 회차 기준 ${d.company.rating}` : '',
    coverTitle: `${issuer}${series ? ` 제${series}회` : ''} 공모사채 발행 검토 및 제안`,
    tranches,
    maxEok: last?.initial_krw ? Math.round((last.initial_krw / 1e8) * 2) : null,
    coupon: '3개월 이표채',
    band: { type: 'later', low: null, high: null },
    bandNote: '발행 시점 시장 상황에 따라 유연하게 결정',
    pay,
    demand: null,
    uw: '발행금액 전액',
    feeUw: d.fee.last_bp ?? d.fee.group_median_bp ?? null,
    feeLead: null,
    feeNote: d.fee.last_bp != null ? '이전 발행 회차 인수수수료 준용' : '',
    peerScope: 'group',
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
  const own = d.own[0];

  const lead = sch
    ? `NH투자증권은 **${sch.pay.slice(0, 4)}년 ${Number(sch.pay.slice(5, 7))}월 ${Number(sch.pay.slice(8, 10)) <= 10 ? '초' : Number(sch.pay.slice(8, 10)) <= 20 ? '중순' : '말'}**을 회사채 적정 발행 시기로 판단하며, **${name}의 회사채 발행 및 당사 총액인수**를 하기와 같이 제안 드립니다.`
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
  if (own) peers.push(`${name} 직전 회차(제${own.series ?? ''}회)는 ${own.demand_dt ? `${mdw(own.demand_dt)} 수요예측, ` : ''}${own.tenor_combo} ${eokW(own.amount_krw)} 발행${own.ratio != null ? `(경쟁률 ${ratioX(own.ratio)})` : ''}`);

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

  const schedule: string[] = [];
  if (sch) {
    schedule.push(`발행 일정 案: **${yy(sch.pay).slice(0, 3)}년 ${korDate(sch.pay)} 발행, ${korDate(sch.demandOptions[0])} ~ ${Number(sch.demandOptions[2].slice(8, 10))}일 中 택1 수요예측 진행**`);
    schedule.push(`수요예측 가능일은 ${mdw(sch.demandOptions[0])} ~ ${mdw(sch.demandOptions[2])}이며, 가장 무난한 일정은 ${korDate(sch.demandOptions[1])}(증권신고서 제출 및 추가청약 가능성을 고려해 전후 하루 여유 확보)`);
    schedule.push(inp.band.type === 'fixed'
      ? '고정금리 밴드로 발행할 경우, 금리가 수요예측일에 확정되어 증권신고서 정정은 1회만 진행'
      : '개별민평 밴드로 발행할 경우, 수요예측 결과(조건확정)와 발행 전일 금리확정 두 차례 증권신고서 정정 진행');
    for (const w of sch.warnings) schedule.push(w);
    // 금통위 전후 금리 변동성(일별 국고채 3년)
    const pastMeet = d.events.filter((e) => e.kind === '금통위' && e.event_dt < d.asof).map((e) => e.event_dt);
    const vol = meetingVolatility(d, pastMeet);
    if (vol) schedule.push(`최근 금통위 ${vol.meetings}회 전후 국고채 3년 하루 변동폭 평균: ${vol.byLag.map((x) => `${x.lag ? `D-${x.lag}` : '당일'} ${x.bp}bp`).join(', ')}`);
    const nextMeet = d.events.find((e) => e.kind === '금통위' && e.event_dt >= sch.filing && e.event_dt <= sch.listing);
    if (nextMeet) schedule.push(`발행 기간 중 금통위(${mdw(nextMeet.event_dt)})가 있어 ${nextMeet.event_dt > sch.demand ? '수요예측을 금통위 전에 마쳐 금리 변동성 영향을 줄이는 일정' : '금통위 결과를 확인한 뒤 수요예측을 진행하는 일정'}으로 구성`);
    const nextMat = d.maturities.find((m) => m.dt >= sch.pay);
    if (nextMat && daysBetween(sch.pay, nextMat.dt) <= 120) schedule.push(`발행 후 ${mdw(nextMat.dt)} 회사채 만기도래 ${eokW(nextMat.amount_krw)}(제${nextMat.series ?? ''}회) 상환 재원 마련에 대응 가능한 일정`);
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
  if (d.combos[0]) structure.push(`최근 6개월 ${d.company.rating_group ?? ''}등급 공모 회사채는 **${d.combos[0].combo}** 구조가 가장 많음(${d.combos[0].issues}건, 비중 ${Math.round(d.combos[0].share ?? 0)}%)`);
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
  const strengths: DeckText['strengths'] = [];
  if (nhG >= 0) strengths.push({ title: `${d.company.rating_group ?? ''}등급 발행 실적`, text: `최근 1년 ${lg.scope} 대표주관 실적 **${nhG + 1}위**(${eokW(lg.rows[nhG].credit)}, ${lg.rows[nhG].deals}건)` });
  if (nhA >= 0) strengths.push({ title: '공모 회사채 대표주관', text: `최근 1년 ${d.leagueAll.scope} 대표주관 실적 ${nhA + 1}위, 점유율 ${((d.leagueAll.rows[nhA].credit / (d.leagueAll.total || 1)) * 100).toFixed(1)}%` });
  strengths.push(nhOwn.length
    ? { title: `${name}에 대한 이해`, text: `${name} 공모 회사채 ${d.own.length}회 중 **${nhOwn.length}회 대표주관**(최근 제${nhOwn[0].series ?? ''}회, ${yy(nhOwn[0].deal_dt)})` }
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
  if (d.forecast) {
    const b = d.forecast.rows.find((x) => x.key === 'base_rate');
    const fy = b?.cells.find((c) => /^\d{4}$/.test(c.period) && !c.actual);
    if (b && fy) rates.push(`${d.forecast.house} 리서치 전망표(${yymmdd(d.forecast.published_dt)} 발표): 기준금리 ${fy.period}년 말 ${rate2(fy.value)}`);
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
    const t350 = terms.filter((v) => Number(v.terminal) === 3.5).length;
    views.push(`${yymmdd(latest)} 전후 증권사 ${d.views.length}곳 의견 정리, 최종 기준금리를 제시한 ${terms.length}곳 중 ${t350}곳이 **3.50%** 제시`);
    const nov = d.views.filter((v) => /11월/.test(v.next_move ?? '')).length;
    if (nov) views.push(`다음 인상 시점으로 11월을 꼽은 곳 ${nov}곳`);
    const other = d.views.filter((v) => v.terminal == null || Number(v.terminal) !== 3.5);
    if (other.length) views.push(`${other.map((v) => v.house).join(', ')}는 다른 경로 제시(아래 표)`);
  }

  // 적정 발행규모·트랜치
  const sizing: string[] = [];
  const tr = inp.tranches.filter((t) => t.tenor);
  const total = tr.reduce((a, t) => a + (t.eok ?? 0), 0);
  if (tr.length) sizing.push(`최초 신고 금액 ${total ? `**${total.toLocaleString('ko-KR')}억원**` : '미정'}${inp.maxEok ? `(Max ${inp.maxEok.toLocaleString('ko-KR')}억원)` : ''} 가운데 ${tr.map((t) => `${t.tenor}${t.eok ? ` ${t.eok.toLocaleString('ko-KR')}억원` : ''}`).join(', ')} 구성 제안`);
  const ownRat = d.own.filter((p) => p.ratio != null).slice(0, 4);
  if (ownRat.length) sizing.push(`${name} 최근 ${ownRat.length}회 수요예측 경쟁률 ${ownRat.map((p) => `${yy(p.demand_dt ?? p.deal_dt)} ${ratioX(p.ratio)}`).join(', ')}`);
  const ownInc = d.own.slice(0, 4).filter((p) => p.increased);
  if (ownInc.length) sizing.push(`최근 4회 중 ${ownInc.length}회 증액 발행(${ownInc.map((p) => `제${p.series ?? ''}회 ${eokW(p.initial_krw)} → ${eokW(p.amount_krw)}`).join(', ')})`);
  if (d.combos[0]) sizing.push(`최근 6개월 ${d.company.rating_group ?? ''}등급은 ${d.combos[0].combo} 구조가 가장 많음(${d.combos[0].issues}건)`);
  // 만기별 수요: 회사 최근 발행의 트랜치별 경쟁률·참여금액
  const ownTr = d.own.slice(0, 4).flatMap((p) => p.tranches.map((t) => ({ p, t })));
  const byTenor = new Map<string, { ratios: number[]; demand: number; n: number }>();
  for (const { t } of ownTr) {
    const k = t.tenor;
    const e = byTenor.get(k) ?? { ratios: [], demand: 0, n: 0 };
    if (t.ratio != null) e.ratios.push(t.ratio);
    e.demand += t.demand_krw ?? 0;
    e.n++;
    byTenor.set(k, e);
  }
  const tenorStats = [...byTenor.entries()].filter(([, e]) => e.ratios.length).map(([k, e]) => ({ k, avg: e.ratios.reduce((a, b) => a + b, 0) / e.ratios.length, n: e.n }));
  if (tenorStats.length >= 2) {
    const best = tenorStats.reduce((a, b) => (a.avg >= b.avg ? a : b));
    sizing.push(`최근 4회 만기별 평균 경쟁률 ${tenorStats.map((x) => `${x.k} ${ratioX(x.avg)}`).join(', ')}로 **${best.k}물 수요가 가장 견조**하여 ${best.k}물 중심 구성이 적합하다고 판단`);
  }
  const mix = mixOf(d.own.slice(0, 3).flatMap((p) => p.tranches));
  if (mix.total) {
    const top2 = [...mix.rows].sort((a, b) => b.q - a.q).slice(0, 2);
    sizing.push(`최근 3회 수요예측 참여 ${eokW(mix.total)} 중 ${top2.map((x) => `${x.label} ${x.share.toFixed(0)}%`).join(', ')}로 참여 기관 구성 확인`);
  }
  const spreads = d.own.slice(0, 4).flatMap((p) => p.tranches.map((t) => ({ p, t, s: t.spread_bp })).filter((x) => x.s != null));
  if (spreads.length >= 2) {
    const last = spreads[0];
    sizing.push(`최근 발행 확정 가산금리(개별민평 대비) ${spreads.slice(0, 4).map((x) => `제${x.p.series ?? ''}회 ${x.t.tenor} ${bpSigned(x.s)}`).join(', ')}, 직전 회차 ${bpSigned(last.s)} 수준에서 금리 밴드 설정 제안`);
  }
  if (d.maturities.length) {
    const byYear = new Map<string, number>();
    for (const m of d.maturities) byYear.set(m.dt.slice(0, 4), (byYear.get(m.dt.slice(0, 4)) ?? 0) + Number(m.amount_krw ?? 0));
    const ysorted = [...byYear.entries()].sort((a, b) => a[1] - b[1]);
    const light = ysorted[0];
    sizing.push(`${name} 공모 회사채 만기 도래는 향후 3년 ${eokW(d.maturities.reduce((t, m) => t + (m.amount_krw ?? 0), 0))}, 연도별로는 '${light[0].slice(2)}년이 ${eokW(light[1])}로 가장 적어 해당 연도 만기 트랜치는 차환 부담이 적다고 판단`);
  }
  const ownAvgDemand = d.own.slice(0, 3).filter((p) => p.demand_krw != null);
  if (ownAvgDemand.length && inp.maxEok) {
    const avg = ownAvgDemand.reduce((t, p) => t + Number(p.demand_krw), 0) / ownAvgDemand.length;
    sizing.push(`최근 ${ownAvgDemand.length}회 평균 수요예측 참여 ${eokW(avg)} 감안해 증액 한도 **Max ${inp.maxEok.toLocaleString('ko-KR')}억원** 설정 제안`);
  }

  // 수요예측 예정 내역
  const pipeline: string[] = [];
  const pipe = d.pipeline;
  if (pipe.length) {
    pipeline.push(`${yymmdd(d.asof)} 현재 증권신고서를 제출하고 발행 전인 공모채 ${pipe.length}건(${eokW(pipe.reduce((t, p) => t + p.tranches.reduce((a, x) => a + (x.initial_krw ?? 0), 0), 0))})`);
    const same = pipe.filter((p) => p.rating && d.company.rating_group && p.rating.startsWith(d.company.rating_group));
    pipeline.push(same.length ? `같은 등급군(${d.company.rating_group}) 예정 발행 ${same.length}건: ${same.map((p) => p.corp_name).join(', ')}` : `같은 등급군(${d.company.rating_group ?? ''}) 예정 발행은 없음`);
    if (sch) {
      const clash = pipe.filter((p) => p.demand_dt && Math.abs(new Date(p.demand_dt).getTime() - new Date(sch.demand).getTime()) <= 3 * 86_400_000);
      if (clash.length) pipeline.push(`제안 수요예측일(${mdw(sch.demand)}) 전후 3일 안에 ${clash.map((p) => p.corp_name).join(', ')} 수요예측 예정`);
    }
  } else {
    pipeline.push(`${yymmdd(d.asof)} 현재 증권신고서를 제출하고 발행 전인 공모채 없음`);
  }
  pipeline.push('증권신고서는 보통 수요예측 1~2주 전에 제출되므로, 발행 2~3주 전에 다시 확인 필요');

  // 금통위·FOMC: 수집한 회의 요약을 그대로 (문장은 사람이 출처에서 정리한 것)
  const meet = (m: DeckData['policy']['bok']) => (m ? [`${yymmdd(m.meeting_dt)} ${m.title}: **${m.decision}**${m.vote ? `(${m.vote})` : ''}`] : []);
  const bok = meet(d.policy.bok);
  const fomc = meet(d.policy.fomc);

  const usviews: string[] = [];
  if (d.usViews.length) {
    const hold = d.usViews.filter((v) => /동결/.test(v.next_move ?? ''));
    usviews.push(`${d.usViews.length}개 하우스 중 ${d.usViews.length - hold.length}곳이 추가 인상, ${hold.length}곳이 연내 동결 전망`);
    const tm = d.usViews.filter((v) => v.terminal != null).map((v) => v.terminal!);
    if (tm.length) usviews.push(`최종금리(상단)를 제시한 ${tm.length}곳 기준 ${rate2(Math.min(...tm))} ~ ${rate2(Math.max(...tm))}`);
    const nhUs = d.usViews.find((v) => /NH/.test(v.house));
    if (nhUs) usviews.push(`NH투자증권(${yymmdd(nhUs.published_dt)}): ${nhUs.summary}`);
  }

  const forecast: string[] = [];
  if (d.forecast) {
    forecast.push(`${d.forecast.house} 리서치 금리 전망표(${yymmdd(d.forecast.published_dt)} 발표) 기준`);
    for (const row of d.forecast.rows) {
      const fy = row.cells.filter((c) => /^\d{4}$/.test(c.period));
      if (fy.length) forecast.push(`${row.label}(${row.basis}): ${fy.map((c) => `${c.period}년 ${rate2(c.value)}`).join(', ')}`);
    }
    if (nhView) forecast.push(`최근 의견(${yymmdd(nhView.published_dt)}): ${nhView.summary}`);
    if (d.asof > addMonths(d.forecast.published_dt, 3)) forecast.push(`전망표는 ${yymmdd(d.forecast.published_dt)} 발표분으로, 이후 금통위·FOMC 결과는 반영되지 않음`);
  }

  const league: string[] = [];
  const ly = d.leagueYearly;
  if (ly.length) {
    const nhRanks = ly.map((y) => ({ y, r: y.lead.find((x) => x.isNh) }));
    league.push(`${ly[0].year}년 이후 공모 회사채 대표주관 실적 순위: ${nhRanks.map(({ y, r }) => `${y.ytd ? `${y.year}년(누적)` : `${y.year}년`} ${r ? `${r.rank}위` : '–'}`).join(', ')}`);
    const cur = ly[ly.length - 1];
    const nhc = cur.lead.find((x) => x.isNh);
    if (nhc) league.push(`${cur.year}년${cur.ytd ? ' 누적' : ''} 대표주관 ${eokW(nhc.krw)}, 점유율 **${nhc.share.toFixed(1)}%**`);
  }

  const maturity: string[] = [];
  const mg = d.maturityByGrade;
  if (mg.months.length) {
    const tot = mg.total.reduce((a, b) => a + b, 0);
    maturity.push(`${mg.months[0].replace('-', '.')} ~ ${mg.months[mg.months.length - 1].replace('-', '.')} 일반 공모 회사채 만기도래 ${eokW(tot)}`);
    const peak = mg.total.indexOf(Math.max(...mg.total));
    maturity.push(`만기도래가 가장 많은 달은 ${Number(mg.months[peak].slice(5, 7))}월(${eokW(mg.total[peak])}), 차환 발행 수요가 몰리는 시기`);
    const g = d.company.rating_group;
    const gr = mg.rows.find((x) => (g === 'BBB' || g === 'BB' || g === 'B' ? x.grade === 'BBB 이하' : x.grade === g));
    if (gr) maturity.push(`${gr.grade}등급 만기도래 ${eokW(gr.total)}`);
    const h1 = mg.total.slice(0, 6).reduce((a, b) => a + b, 0);
    const h2 = mg.total.slice(6).reduce((a, b) => a + b, 0);
    maturity.push(`앞 6개월 ${eokW(h1)}, 뒤 6개월 ${eokW(h2)}로 ${h1 >= h2 ? '앞쪽' : '뒤쪽'}에 만기가 몰려 있어 ${h1 >= h2 ? '단기적으로 차환 발행이 집중될 것으로 판단' : '해당 기간 차환 발행 증가에 대비한 일정 선점 필요'}`);
  }

  // Sales 전략: 투자자 구분별 참여(회사·같은 등급)
  const sales: string[] = [];
  const ownMix = mixOf(d.own.slice(0, 4).flatMap((p) => p.tranches));
  const peerMix = mixOf(peerPool(d, inp.peerScope).flatMap((p) => p.tranches));
  if (ownMix.total) {
    const top = [...ownMix.rows].sort((a, b) => b.q - a.q)[0];
    sales.push(`${name} 최근 4회 수요예측 참여 ${eokW(ownMix.total)} 중 **${top.label} ${top.share.toFixed(0)}%**로 주력 수요층 확인`);
  }
  if (peerMix.total) {
    sales.push(`최근 1년 ${grp}등급 수요예측 참여 구성: ${peerMix.rows.slice(0, 4).map((x) => `${x.label} ${x.share.toFixed(0)}%`).join(', ')}`);
    if (ownMix.total) {
      const gap = peerMix.rows.map((x) => ({ x, own: ownMix.rows.find((o) => o.t === x.t)?.share ?? 0 })).sort((a, b) => (b.x.share - b.own) - (a.x.share - a.own))[0];
      if (gap && gap.x.share - gap.own >= 5) sales.push(`같은 등급 대비 ${gap.x.label} 참여 비중이 ${(gap.x.share - gap.own).toFixed(0)}%p 낮아 해당 투자자군 대상 IR·NDR 집중 필요`);
    }
  }
  sales.push('기관별 참여·배정 내역은 공시에 없는 내부 자료로 보완(내부 자료 붙여넣기)');

  // 발행조건 표 비고
  const comboTop = d.combos[0];
  const termNotes: TermNotes = {
    rating: inp.ratingNote,
    tenor: comboTop ? `최근 6개월 ${d.company.rating_group ?? ''}등급 ${comboTop.combo} 구조 최다(${comboTop.issues}건)` : '',
    amount: '시장 상황에 따라 트랜치별 금액 조정 가능\n수요예측 결과에 따라 증액 여부 협의',
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

  return { lead, peers, compare, schedule, structure, structureRows, strengths, rates, corp, views, sizing, pipeline, bok, fomc, usviews, forecast, league, maturity, sales, termNotes };
}

// 제안 만기 안: 트랜치 만기('또는'으로 대안), 트랜치가 둘 이상이면 조합
export function tenorOptions(inp: DeckInput) {
  const tr = inp.tranches.map((t) => t.tenor.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of tr) for (const x of t.split(/\s*(?:또는|,|\/)\s*/)) if (x && !out.includes(x)) out.push(x);
  if (tr.length > 1 && tr.every((t) => !/또는/.test(t))) out.push(tr.join('+'));
  return out;
}
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
    회사직전회차: d.own.slice(0, 3).map(peerFact),
    만기도래: d.maturities.map((m) => ({ 만기일: yymmdd(m.dt), 회차: m.series, 금액: eokW(m.amount_krw), 금리: rate3(m.coupon_pct) })),
    만기도래합계: { 향후3년: eokW(d.maturities.reduce((s, m) => s + (m.amount_krw ?? 0), 0)), 건수: d.maturities.length, '1년내': eokW(d.maturities.filter((m) => m.dt <= addYears(d.asof, 1)).reduce((s, m) => s + (m.amount_krw ?? 0), 0)) },
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
    수요예측예정합계: { 건수: d.pipeline.length, 금액: eokW(d.pipeline.reduce((t, p) => t + p.tranches.reduce((a, x) => a + (x.initial_krw ?? 0), 0), 0)) },
    수요예측예정: d.pipeline.map((p) => ({ 회사: p.corp_name, 등급: p.rating, 수요예측일: p.demand_dt ? mdw(p.demand_dt) : null, 납입일: p.pay_dt ? mdw(p.pay_dt) : null, 트랜치: p.tranches.map((t) => `${t.tenor} ${eokW(t.initial_krw)}`) })),
    연간리그테이블: d.leagueYearly.map((y) => ({ 연도: y.ytd ? `${y.year}(누적)` : y.year, NH: y.lead.find((x) => x.isNh) && { 순위: y.lead.find((x) => x.isNh)!.rank, 금액: eokW(y.lead.find((x) => x.isNh)!.krw), 점유율: `${y.lead.find((x) => x.isNh)!.share.toFixed(1)}%` } })),
    만기별평균경쟁률: (() => {
      const by = new Map<string, number[]>();
      for (const p of d.own.slice(0, 4)) for (const t of p.tranches) if (t.ratio != null) by.set(t.tenor, [...(by.get(t.tenor) ?? []), t.ratio]);
      return [...by.entries()].map(([k, xs]) => `${k} ${ratioX(xs.reduce((a, b) => a + b, 0) / xs.length)}`);
    })(),
    최근3회평균참여: (() => {
      const xs = d.own.slice(0, 3).filter((p) => p.demand_krw != null);
      return xs.length ? eokW(xs.reduce((t, p) => t + Number(p.demand_krw), 0) / xs.length) : null;
    })(),
    만기도래상하반기: { 앞6개월: eokW(d.maturityByGrade.total.slice(0, 6).reduce((a, b) => a + b, 0)), 뒤6개월: eokW(d.maturityByGrade.total.slice(6).reduce((a, b) => a + b, 0)) },
    투자자구분참여: {
      회사최근4회: mixOf(d.own.slice(0, 4).flatMap((p) => p.tranches)).rows.map((x) => ({ 구분: x.label, 금액: eokW(x.q), 비중: `${x.share.toFixed(0)}%` })),
      같은등급최근1년: mixOf(pool.flatMap((p) => p.tranches)).rows.map((x) => ({ 구분: x.label, 금액: eokW(x.q), 비중: `${x.share.toFixed(0)}%` })),
    },
    회사트랜치별결과: d.own.slice(0, 4).flatMap((p) => p.tranches.map((t) => ({
      회차: `제${p.series ?? ''}회`, 만기: t.tenor, 수요예측일: p.demand_dt ? mdw(p.demand_dt) : null, 신고: eokW(t.initial_krw), 참여: eokW(t.demand_krw),
      경쟁률: ratioX(t.ratio), 발행: eokW(t.amount_krw), 발행금리: rate3(t.yield_pct), 확정가산금리: bpSigned(t.spread_bp),
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

export { eok, shortFirm, tenorYears };

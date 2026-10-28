// 발행 시기 검토(1안/2안): 현업 '적정 발행시기 검토' 장표(현대엘리베이터 2026-02, HD건설기계 2026-04의 1안/2안 장단점)를 규칙으로 만든다.
// 후보 ① 규칙 납입일(기존 만기 2주 전, 연말 북클로징 회피 = payPlan)
//      ② 발행사 정례 발행월(최근 3회 중 2회 이상 같은 달 납입)이 ①과 다르면 그 달, 아니면 첫 만기 직전 납입
// 장단점은 데이터로만 정한다: 기존 만기 대응·선조달 기간·시장 만기도래·전년 같은 달 수요예측·발행 관행·금리 경로(리서치)·이벤트/연휴.
// 점수가 같으면 ①(현업 기본 규칙)을 권고한다. 권고안이 기본 납입일이 된다.
import { buildSchedule, type Schedule } from './schedule';
import { calOf, forecastStale, janPayOf, payPlan, peerPool, totalEok, yearEndOf } from './rules';
import { eokW, mdw, rate2, ratioX } from './fmt';
import type { DeckData, DeckInput } from './types';

export type TimingKind = 'input' | 'rule' | 'habit' | 'jit';
export type TimingOpt = {
  key: string; // '1안' | '2안' | '3안'
  kind: TimingKind;
  title: string; // 예: '1월 중순 선조달'
  sch: Schedule;
  covered: { dt: string; amount: number; idle: number }[]; // 납입 뒤 75일 안 기존 만기(선조달 일수)
  before: { dt: string; amount: number }[]; // 이 안의 납입 전에 오는 만기(다른 안은 차환): 보유 현금 등으로 상환
  market: { month: number; amount: number; rank: number } | null; // 납입월 시장 공모 회사채 만기도래
  lastYear: { label: string; n: number; avg: number | null } | null; // 전년 같은 달 같은 등급 수요예측
  habit: boolean;
  notes: string[]; // 이벤트·연휴·금리 경로(사실)
  pros: string[];
  cons: string[];
  score: number;
};
export type Timing = { opts: TimingOpt[]; rec: number; habit: { month: number; deals: string[] } | null; path: string | null };

const addDays = (s: string, n: number) => {
  const x = new Date(`${s}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const mon = (s: string) => Number(s.slice(5, 7));
const part = (s: string) => (Number(s.slice(8, 10)) <= 10 ? '초' : Number(s.slice(8, 10)) <= 20 ? '중순' : '말');
const jo = (krw: number) => `${(krw / 1e12).toFixed(1)}조원`;

// 정례 발행월: 최근 3회 납입월 중 2회 이상 같은 달
export function habitOf(d: DeckData) {
  const xs = d.own.slice(0, 3).map((p) => p.deal_dt).filter((x): x is string => !!x);
  if (xs.length < 2) return null;
  const cnt = new Map<number, string[]>();
  for (const x of xs) cnt.set(mon(x), [...(cnt.get(mon(x)) ?? []), x]);
  const [m, list] = [...cnt.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  return list.length >= 2 ? { month: m, deals: xs, days: list.map((x) => Number(x.slice(8, 10))) } : null;
}

// 기준금리 경로(리서치): DM 판 표 → DB 전망표 순. 분기 라벨과 값
function ratePath(d: DeckData) {
  const ft = d.dm?.forecastTable;
  const row = ft?.rows.find((r) => /한국\s*기준금리/.test(r.group));
  if (ft && row) {
    const out: { y: number; q: number; v: number }[] = [];
    let yi = 0;
    ft.periods.forEach((p, i) => {
      if (i && /^1Q/.test(p)) yi++;
      const y = Number((ft.years[yi] ?? '').replace(/\D/g, ''));
      const v = Number(row.cells[i]);
      if (y && Number.isFinite(v)) out.push({ y, q: Number(p[0]), v });
    });
    return { src: 'NH 리서치', pts: out };
  }
  // 공개 전망표는 발표 뒤 금통위·FOMC 결과가 나왔으면 쓰지 않는다(본문 전망 장표와 같은 기준)
  const b = d.forecast?.rows.find((r) => r.key === 'base_rate');
  if (!b || !d.forecast || forecastStale(d)) return null;
  const pts = b.cells.map((c) => ({ m: c.period.match(/^(\d)Q(\d{2})$/), v: c.value })).filter((x) => x.m && x.v != null)
    .map((x) => ({ y: 2000 + Number(x.m![2]), q: Number(x.m![1]), v: Number(x.v) }));
  return pts.length ? { src: `${d.forecast.house} 리서치`, pts } : null;
}

type PlanOpts = {
  peerScope: DeckInput['peerScope'];
  band: DeckInput['band']['type'];
  pay?: string | null;
  demand?: string | null; // 담당자가 고른 수요예측일(그 납입일 안에만 적용)
  totalEok?: number; // 최초 신고 금액(억원): 만기 대응 문안을 금액과 맞춘다
  maxEok?: number | null;
};
// 입력값 그대로 쓰는 호출(장표·문안·AI 근거가 같은 결과를 보게)
export const timingOf = (d: DeckData, inp: DeckInput) =>
  timingPlan(d, { peerScope: inp.peerScope, band: inp.band.type, pay: inp.pay, demand: inp.demand, totalEok: totalEok(inp), maxEok: inp.maxEok });

export function timingPlan(d: DeckData, o: PlanOpts): Timing {
  const cal = calOf(d);
  const A = payPlan(d).pay;
  const habit = habitOf(d);
  const raw: { kind: TimingKind; pay: string }[] = [{ kind: 'rule', pay: A }];
  // 2안: 정례 발행월(①과 다른 달, 기준일 200일 안) → 첫 만기 직전 납입(①보다 5영업일 이상 늦을 때)
  const mats = (d.maturitiesLong?.rows ?? d.maturities).filter((m) => m.amount_krw);
  // 정례 발행월은 ①에서 90일 안일 때만 후보(만기가 없을 때 관행 하나로 납입이 멀리 밀리지 않게)
  if (habit && habit.month !== mon(A)) {
    const day = String(Math.min(25, Math.max(5, Math.round(habit.days.reduce((a, b) => a + b, 0) / habit.days.length)))).padStart(2, '0');
    let y = Number(A.slice(0, 4));
    let c = `${y}-${String(habit.month).padStart(2, '0')}-${day}`;
    if (c <= A) c = `${++y}-${String(habit.month).padStart(2, '0')}-${day}`;
    const hp = cal.next(c);
    if (days(A, hp) <= 90 && !yearEndOf(cal, hp) && !raw.some((x) => x.pay === hp)) raw.push({ kind: 'habit', pay: hp });
  }
  if (raw.length < 2) {
    // 첫 만기 1주 전 납입(선조달 최소화). 수요예측이 연말 북클로징(12/15~)에 걸리면 1월 첫 영업일 뒤로 미루고, 그래도 만기 전이어야 한다
    const m1 = mats.find((m) => m.dt > A && days(A, m.dt) <= 60);
    if (m1) {
      let jit = cal.add(m1.dt, -5);
      if (yearEndOf(cal, jit)) jit = janPayOf(cal, jit);
      if (jit < m1.dt && cal.diff(A, jit) >= 5 && !raw.some((x) => x.pay === jit)) raw.push({ kind: 'jit', pay: jit });
    }
  }
  // 담당자가 정한 납입일: 후보 중 하나면 그 안을 권고로, 아니면 '입력안'을 1안으로 넣고 권고로 둔다(Term-sheet 와 어긋나지 않게)
  const want = o.pay && /^\d{4}-\d{2}-\d{2}$/.test(o.pay) ? cal.next(o.pay) : null;
  let forced: number | null = null;
  if (want) {
    const k = raw.findIndex((x) => x.pay === want);
    if (k >= 0) forced = k;
    else if (raw.length >= 1) {
      raw.unshift({ kind: 'input', pay: want });
      forced = 0;
    }
  }
  if (raw.length < 2) return { opts: [], rec: 0, habit: habit && { month: habit.month, deals: habit.deals }, path: null };
  // 담당자가 고른 수요예측일은 그 납입일 안에만(다른 안은 기본 수요예측일)
  const sch = (pay: string) => buildSchedule(cal, pay, { band: o.band, demand: want && pay === want ? o.demand ?? null : null, events: d.events });

  const minPay = raw.map((x) => x.pay).sort()[0];
  const maxPay = raw.map((x) => x.pay).sort().at(-1)!;
  const R = mats.filter((m) => m.dt > minPay && m.dt <= addDays(maxPay, 75));
  const mg = d.maturityByGrade;
  const ranked = [...mg.total].sort((a, b) => b - a);
  const pool = peerPool(d, o.peerScope);
  const grp = o.peerScope === 'notch' && d.company.rating ? d.company.rating : d.company.rating_group ?? '';
  const path = ratePath(d);
  const base = d.rates.find((r) => r.key === 'base_rate')?.value ?? null;
  const qOf = (s: string) => ({ y: Number(s.slice(0, 4)), q: Math.floor((mon(s) - 1) / 3) + 1 });
  const pathAt = (s: string) => {
    const { y, q } = qOf(s);
    return path?.pts.find((p) => p.y === y && p.q === q)?.v ?? null;
  };

  const opts: TimingOpt[] = raw.map((r, i) => {
    const s = sch(r.pay);
    const covered = R.filter((m) => m.dt >= s.pay && days(s.pay, m.dt) <= 75).map((m) => ({ dt: m.dt, amount: Number(m.amount_krw), idle: days(s.pay, m.dt) }));
    const before = R.filter((m) => m.dt < s.pay).map((m) => ({ dt: m.dt, amount: Number(m.amount_krw) }));
    const mi = mg.months.indexOf(s.pay.slice(0, 7));
    const market = mi >= 0 ? { month: mon(s.pay), amount: mg.total[mi], rank: ranked.indexOf(mg.total[mi]) + 1 } : null;
    const ly = `${Number(s.demand.slice(0, 4)) - 1}-${s.demand.slice(5, 7)}`;
    const covers = pool.some((p) => (p.demand_dt ?? p.deal_dt ?? '') < `${ly}-01`);
    // 회사 자신의 회차는 '발행 관행'에서 따로 보므로 뺀다
    const lyList = pool.filter((p) => p.corp_code !== d.company.corp_code && (p.demand_dt ?? '').startsWith(ly));
    const lyR = lyList.filter((p) => p.ratio != null);
    const lastYear = covers || lyList.length ? { label: `'${ly.slice(2, 4)}.${Number(ly.slice(5, 7))}월`, n: lyList.length, avg: lyR.length ? lyR.reduce((a, p) => a + Number(p.ratio), 0) / lyR.length : null } : null;
    const notes: string[] = [];
    const win = [cal.add(s.demand, -2), cal.add(s.demand, 1)];
    for (const e of d.events) {
      if (e.kind === 'FOMC') {
        const res = addDays(e.end_dt ?? e.event_dt, 1); // 한국 시간 결과 발표일
        if (res >= win[0] && res <= win[1]) notes.push(`수요예측일이 FOMC 결과 발표(${mdw(res)}, 한국 시간) ${res <= s.demand ? '직후' : '직전'}`);
      }
      if (e.kind === '금통위' && e.event_dt >= win[0] && e.event_dt <= win[1]) notes.push(`수요예측일이 금통위(${mdw(e.event_dt)}) ${e.event_dt <= s.demand ? '직후' : '직전'}`);
    }
    const hol = d.holidays.filter((h) => h.dt > s.demand && h.dt < s.pay);
    if (hol.length) notes.push(`수요예측~납입 사이 ${[...new Set(hol.map((h) => h.name.replace(/\s*연휴$/, '')))].join('·')} 휴일(${hol.map((h) => mdw(h.dt)).join('·')})`);
    const kind = r.kind;
    const title = kind === 'habit' ? `${mon(s.pay)}월 정례 발행` : kind === 'jit' ? `${mon(s.pay)}월 ${part(s.pay)} 만기 직전 납입` : kind === 'input' ? `${mon(s.pay)}월 ${part(s.pay)} 납입` : `${mon(s.pay)}월 ${part(s.pay)} 선조달`;
    return { key: `${i + 1}안`, kind, title, sch: s, covered, before, market, lastYear, habit: !!habit && habit.month === mon(s.pay), notes, pros: [], cons: [], score: 0 };
  });

  // 장단점·점수
  const idleSum = (x: TimingOpt) => x.covered.reduce((a, m) => a + m.amount * m.idle, 0);
  const minIdle = Math.min(...opts.filter((x) => !x.before.length && x.covered.length).map(idleSum));
  const initK = (o.totalEok ?? 0) * 1e8;
  const maxK = (o.maxEok ?? 0) * 1e8;
  for (const x of opts) {
    const list = (ms: { dt: string; amount: number }[]) => ms.map((m) => `${mdw(m.dt)} ${eokW(m.amount)}`).join('·');
    const sumK = (ms: { amount: number }[]) => ms.reduce((a, m) => a + m.amount, 0);
    const sum = (ms: { amount: number }[]) => eokW(sumK(ms));
    if (x.before.length) {
      x.cons.push(`납입 전에 만기 ${sum(x.before)}(${list(x.before)}) 도래 → 보유 현금 등으로 먼저 상환 필요`);
      x.score -= 1;
    } else if (x.covered.length) {
      // 만기 대응 문안은 발행 금액과 맞춘다(트랜치 검토의 차환 수요 문안과 같은 기준)
      const need = sumK(x.covered);
      const what = `만기 ${sum(x.covered)}(${x.covered.length}건)`;
      x.pros.push(!initK
        ? `${what} 전에 납입해 차환 재원을 만기 전에 확보`
        : initK >= need
          ? `${what} 전액 차환 재원을 만기 전에 확보`
          : maxK >= need
            ? `${what} 전에 납입(최초 신고 금액으로 ${Math.round((initK / need) * 100)}%, 증액 시 전액 차환)`
            : `${what} 전에 납입해 ${maxK ? `증액 한도 ${eokW(maxK)}` : `신고 금액 ${eokW(initK)}`}만큼 차환(부족분은 별도 재원)`);
      x.score += 1;
      const first = x.covered[0].idle;
      if (first >= 10 && first <= 30) {
        x.pros.push(`첫 만기 ${first}일 전 납입으로 일정 지연·시장 변동 시 대응 여유`);
        x.score += 0.5;
      } else if (first < 5) {
        x.cons.push(`첫 만기 ${first}일 전 납입으로 일정이 밀리면 상환 재원 공백 위험`);
        x.score -= 0.5;
      }
      const maxIdle = Math.max(...x.covered.map((m) => m.idle));
      if (idleSum(x) === minIdle && opts.filter((y) => !y.before.length && y.covered.length).length > 1) {
        x.pros.push(`선조달 기간이 가장 짧음(최장 ${maxIdle}일)`);
        x.score += 0.5;
      } else if (maxIdle > 30) {
        const m = x.covered.find((c) => c.idle === maxIdle)!;
        x.cons.push(`선조달 기간 최장 ${maxIdle}일(${mdw(m.dt)} 만기분 ${eokW(m.amount)})`);
        x.score -= 0.5;
      }
    }
    if (x.habit && habit) {
      x.pros.push(`최근 ${habit.deals.length}회 중 ${habit.days.length}회와 같은 ${habit.month}월 발행(투자자에게 익숙한 시기)`);
      x.score += 0.5;
    }
    // 담당자가 고른 날짜가 연말 북클로징에 걸리면 알린다(규칙 후보는 이미 피함)
    if (x.kind === 'input' && yearEndOf(cal, x.sch.pay)) {
      x.cons.push('수요예측·납입이 연말 북클로징(12/15~) 기간에 걸려 기관 참여 위축 가능');
      x.score -= 0.5;
    }
    if (x.notes.length) x.score -= 0.25 * x.notes.length;
  }
  // 상대 비교: 납입월 시장 만기도래(12개월 중 3위 안 = 차환 발행이 몰리는 달, 7위 밖 = 적은 달). 같은 달인 안은 같이 본다
  const mk = opts.filter((x) => x.market);
  if (mk.length > 1 && new Set(mk.map((x) => x.market!.month)).size > 1) {
    const loAmt = Math.min(...mk.map((x) => x.market!.amount));
    const hiAmt = Math.max(...mk.map((x) => x.market!.amount));
    const lo = mk.filter((x) => x.market!.amount === loAmt);
    const hi = mk.filter((x) => x.market!.amount === hiAmt);
    const loRank = lo[0].market!.rank;
    const hiRank = hi[0].market!.rank;
    if (loRank > 6 || (loRank > 3 && hiRank <= 3)) for (const x of lo) {
      x.pros.push(`납입월 시장 만기도래 ${jo(loAmt)}(12개월 중 ${loRank}위)으로 차환 발행이 덜 몰리는 달`);
      x.score += 0.5;
    }
    if (hiRank <= 3 && loRank > 3) for (const x of hi) {
      x.cons.push(`납입월 시장 만기도래 ${jo(hiAmt)}(12개월 중 ${hiRank}위)으로 차환 발행이 몰리는 달`);
      x.score -= 0.5;
    }
  }
  const lyOk = opts.filter((x) => x.lastYear && x.lastYear.n >= 2 && x.lastYear.avg != null);
  if (lyOk.length > 1 && new Set(lyOk.map((x) => x.lastYear!.label)).size > 1) {
    const bestAvg = Math.max(...lyOk.map((x) => x.lastYear!.avg!));
    const worstAvg = Math.min(...lyOk.map((x) => x.lastYear!.avg!));
    if (bestAvg - worstAvg >= 0.5) for (const best of lyOk.filter((x) => x.lastYear!.avg === bestAvg)) {
      best.pros.push(`전년 같은 달(${best.lastYear!.label}) ${grp}등급 수요예측 ${best.lastYear!.n}건, 평균 경쟁률 ${ratioX(best.lastYear!.avg)}로 수요 견조`);
      best.score += 0.5;
    }
  }
  // 금리 경로(리서치): 이른 안과 늦은 안의 분기 경로값이 다르고(늦은 쪽이 더 높음) 현재보다 높을 때만 이른 발행의 장점으로 쓴다
  let pathText: string | null = null;
  if (path && base != null) {
    const early = opts.reduce((a, b) => (a.sch.pay <= b.sch.pay ? a : b));
    const late = opts.reduce((a, b) => (a.sch.pay >= b.sch.pay ? a : b));
    const v = pathAt(early.sch.pay);
    const vl = pathAt(late.sch.pay);
    if (v != null && vl != null && vl > v && vl > base && early !== late) {
      const q = qOf(early.sch.pay);
      const ql = qOf(late.sch.pay);
      pathText = `${path.src} 기준금리 경로 ${q.q}Q${String(q.y).slice(2)} ${rate2(v)} → ${ql.q}Q${String(ql.y).slice(2)} ${rate2(vl)}(현재 ${rate2(base)})`;
      early.pros.push(`${pathText}: 경로상 인상 전 분기에 발행`);
      early.score += 0.5;
    }
  }
  const rec = forced ?? opts.reduce((bi, x, i) => (x.score > opts[bi].score + 1e-9 ? i : bi), Math.max(0, opts.findIndex((x) => x.kind === 'rule')));
  return { opts, rec, habit: habit && { month: habit.month, deals: habit.deals }, path: pathText };
}

// 발행 시기 검토 요약 상자 문안
export function timingText(t: Timing): string[] {
  if (t.opts.length < 2) return [];
  const r = t.opts[t.rec];
  const out = [`NH투자증권은 **${r.key}(${mdw(r.sch.demand)} 수요예측, ${mdw(r.sch.pay)} 납입)**을 권고: ${r.pros.slice(0, 2).join(', ') || r.title}`];
  const bare = (v: string) => v.replace(/[\d,.]+/g, '#');
  const recPros = new Set(r.pros.map(bare));
  for (const x of t.opts) {
    if (x === r) continue;
    // 권고안과 겹치지 않는 장점(그 안만의 이유)을 먼저
    const pro = x.pros.find((p) => !recPros.has(bare(p))) ?? x.pros[0];
    const con = x.cons[0] ?? x.notes[0];
    // 대안의 단점이 없으면 권고안만의 장점으로 비교한다
    const xPros = new Set(x.pros.map(bare));
    const recEdge = r.pros.find((p) => !xPros.has(bare(p)));
    const why = con ?? (recEdge ? `${r.key}은 ${recEdge}` : '종합 비교에서 권고안이 앞섬');
    out.push(`${x.key}(${mdw(x.sch.pay)} 납입, ${x.title})은 ${pro ? `${pro} 장점이 있으나 ` : ''}${why}`);
  }
  if (r.cons.length) out.push(`권고안 유의점: ${r.cons[0]}`);
  return out;
}

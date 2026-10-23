// 공모 회사채 발행 일정(안): 영업일(주말·공휴일·채권시장 휴장일 제외) 기준 역산.
// 규칙 근거: 증권인수업무규정(대표주관계약 신고서 제출 10영업일 전 체결, 체결 후 5영업일 안에 금융투자협회 통보),
// 자본시장법(증권신고서 효력발생: 발행일 8영업일 전 제출), 정정신고서(수요예측 결과 반영) 발행일 4영업일 전.
// 이 파일은 경로 별칭 없이 써서 node 테스트에서 바로 불러온다.

export type Holiday = { dt: string; name: string };
export type MarketEvent = { event_dt: string; end_dt: string | null; kind: string; title: string; note: string | null };

const DAY = 86_400_000;
const toD = (s: string) => new Date(`${s}T00:00:00Z`);
const toS = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => toS(new Date(toD(s).getTime() + n * DAY));
export const weekday = (s: string) => toD(s).getUTCDay(); // 0 일 ~ 6 토
export const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
export const mdw = (s: string) => `${md(s)}(${WD[weekday(s)]})`;
export const korDate = (s: string) => `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일`;

export class BizCal {
  private h: Map<string, string>;
  constructor(holidays: Holiday[]) {
    this.h = new Map(holidays.map((x) => [x.dt, x.name]));
  }
  holiday(s: string) {
    return this.h.get(s) ?? null;
  }
  isBiz(s: string) {
    const w = weekday(s);
    return w !== 0 && w !== 6 && !this.h.has(s);
  }
  // n 영업일 뒤(음수면 앞). 기준일은 세지 않는다.
  add(s: string, n: number) {
    let d = s;
    let left = Math.abs(n);
    const step = n >= 0 ? 1 : -1;
    while (left > 0) {
      d = addDays(d, step);
      if (this.isBiz(d)) left--;
    }
    return d;
  }
  next(s: string) {
    let d = s;
    while (!this.isBiz(d)) d = addDays(d, 1);
    return d;
  }
  // a 다음날부터 b 까지의 영업일 수 (b 가 앞이면 음수)
  diff(a: string, b: string) {
    if (a === b) return 0;
    const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
    let n = 0;
    for (let d = addDays(lo, 1); d <= hi; d = addDays(d, 1)) if (this.isBiz(d)) n++;
    return n * sign;
  }
}

export type StepKind = 'key' | 'demand' | 'pay' | 'plain' | 'event' | 'holiday';
export type Step = { dt: string; label: string; kind: StepKind; rule?: string };

export type BandType = 'fixed' | 'spread' | 'later';

export type Schedule = {
  pay: string; demand: string; demandOptions: string[]; filing: string; leadContract: string; kofia: string;
  condFix: string; rateFix: string | null; listing: string;
  steps: Step[]; weeks: string[][]; // 주(월~금) 날짜 목록
  warnings: string[];
};

export function buildSchedule(
  cal: BizCal,
  payWanted: string,
  opts: { band: BandType; demand?: string | null; events?: MarketEvent[] },
): Schedule {
  const warnings: string[] = [];
  const pay = cal.next(payWanted);
  if (pay !== payWanted) {
    const why = cal.holiday(payWanted) ?? (weekday(payWanted) === 0 || weekday(payWanted) === 6 ? '주말' : '휴일');
    warnings.push(`${mdw(payWanted)}은 ${why}이라 납입일을 다음 영업일 ${mdw(pay)}로 옮겼습니다.`);
  }
  const listing = cal.add(pay, 1);
  const rateFix = opts.band === 'fixed' ? null : cal.add(pay, -1);
  const condFix = cal.add(pay, -4);
  const demandOptions = [cal.add(pay, -7), cal.add(pay, -6), cal.add(pay, -5)];
  const demand = opts.demand && demandOptions.includes(opts.demand) ? opts.demand : demandOptions[1];
  const filing = cal.add(pay, -8);
  const leadContract = cal.add(filing, -10);
  const kofia = cal.add(leadContract, 5);

  const steps: Step[] = [
    { dt: leadContract, label: '대표주관계약 체결', kind: 'key', rule: '증권신고서 제출 10영업일 전' },
    { dt: kofia, label: '대표주관 협회 신고', kind: 'key', rule: '계약 체결 후 5영업일 안' },
    { dt: filing, label: '증권신고서 제출\n인수계약서 체결', kind: 'key', rule: '발행일 8영업일 전' },
    ...demandOptions.map((d) => ({ dt: d, label: d === demand ? '수요예측' : '수요예측 가능일', kind: 'demand' as const, rule: '발행일 5~7영업일 전' })),
    { dt: condFix, label: '[조건확정]\n증권신고서 제출', kind: 'key', rule: '발행일 4영업일 전' },
    ...(rateFix ? [{ dt: rateFix, label: '[금리확정]\n증권신고서 제출', kind: 'key' as const, rule: '발행일 1영업일 전' }] : []),
    { dt: pay, label: '발행/납입', kind: 'pay' },
    { dt: listing, label: '채권 상장', kind: 'plain' },
  ];

  // 달력 범위: 대표주관계약 체결 주 월요일 ~ 상장 주 금요일
  const mon = (s: string) => addDays(s, -((weekday(s) + 6) % 7));
  const start = mon(leadContract);
  const end = addDays(mon(listing), 4);
  const weeks: string[][] = [];
  for (let w = start; w <= end; w = addDays(w, 7)) weeks.push([0, 1, 2, 3, 4].map((i) => addDays(w, i)));

  const inRange = (d: string) => d >= start && d <= end;
  for (const w of weeks) for (const d of w) {
    const h = cal.holiday(d);
    if (h) steps.push({ dt: d, label: h, kind: 'holiday' });
  }
  for (const e of opts.events ?? []) {
    const d = e.kind === 'FOMC' ? (e.end_dt ?? e.event_dt) : e.event_dt;
    if (!inRange(d)) continue;
    const label = e.kind === '금통위' ? '금융통화위원회' : e.kind === 'FOMC' ? 'FOMC(미국 시간)' : e.title;
    steps.push({ dt: d, label, kind: 'event' });
    if (e.kind === '금통위' && d === demand) warnings.push(`수요예측일(${mdw(demand)})이 금통위 당일입니다. 금리 변동성을 고려해 전후 영업일을 검토하세요.`);
    if (e.kind === '정기보고서' && d > filing && d <= pay) {
      warnings.push(`증권신고서 제출 후 ${e.title}(${mdw(d)})이 있습니다. 신고서 재무정보 기준일과 정정 필요 여부를 확인하세요.`);
    }
  }
  return { pay, demand, demandOptions, filing, leadContract, kofia, condFix, rateFix, listing, steps, weeks, warnings };
}

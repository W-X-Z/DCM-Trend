// 검수: 내려받기 전에 확인할 것. 현업 샘플 덱에서 실제로 난 오류(회의 요약이 최신 회의보다 오래됨, 같은 발행금리 반복,
// 등급별 전망표 행 중복·등급 순서와 금리 순서 불일치, 고친 문안의 숫자)를 데이터로 잡는다. 막지 않고 경고만 한다.
import { type ItemId } from './catalog';
import { mdw, rate3, yymmdd } from './fmt';
import { allowedNumbers } from './validate';
import { parseTsv } from './tsv';
import { excludedPeers, factsFor, forecastStale, pickIssues, ruleText, scheduleOf, supplyIssues } from './rules';
import type { DeckData, DeckInput, DeckText, PeerIssue } from './types';

export type Qa = { level: 'warn' | 'info'; item: ItemId | null; text: string };

// 회의가 끝난(결과가 나온) 가장 최근 일정. FOMC 는 이틀째(end_dt)가 결과일.
function lastMeeting(d: DeckData, kind: '금통위' | 'FOMC') {
  const ds = d.events.filter((e) => e.kind === kind).map((e) => (kind === 'FOMC' ? e.end_dt ?? e.event_dt : e.event_dt)).filter((x) => x < d.asof);
  return ds.sort().at(-1) ?? null;
}

const days = (a: string, b: string) => (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;

// 등급 순서: 높은 등급일수록 금리가 낮아야 한다
const GRADES = ['AAA', 'AA+', 'AA0', 'AA', 'AA-', 'A+', 'A0', 'A', 'A-', 'BBB+', 'BBB0', 'BBB', 'BBB-'];
const gradeOf = (s: string) => {
  const m = s.replace(/\s/g, '').match(/^(AAA|AA[+0-]?|A[+0-]?|BBB[+0-]?)/);
  return m ? m[1] : null;
};
const num = (s: string) => {
  const v = Number(String(s).replace(/[,%\s]/g, ''));
  return String(s).trim() !== '' && Number.isFinite(v) ? v : null;
};

// 붙여넣은 등급별 회사채 전망표 점검: (등급, 만기) 행이 겹치거나, 다른 등급인데 값이 모두 같거나, 같은 만기에서 등급 순서와 금리 순서가 반대
export function creditGridIssues(grid: string[][]): string[] {
  if (grid.length < 3) return [];
  const out: string[] = [];
  const body = grid.slice(1);
  // 둘째 열이 만기(2년, 3, 5Y …)면 (등급, 만기) 단위로 본다. 등급 칸이 비면 위 등급을 이어 쓴다.
  const tenorCol = body.filter((r) => /^\d+(\.\d+)?\s*(년|Y|y)?$/.test(r[1] ?? '')).length >= body.length / 2;
  let g: string | null = null;
  const rows: { grade: string; tenor: string; vals: (number | null)[] }[] = [];
  for (const r of body) {
    g = gradeOf(r[0]) ?? (r[0] ? null : g);
    if (!g) continue;
    const tenor = tenorCol ? (r[1] ?? '').replace(/\s/g, '').replace(/[Yy년]$/, '') : '';
    rows.push({ grade: g, tenor, vals: r.slice(tenorCol ? 2 : 1).map(num) });
  }
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(`${r.grade}|${r.tenor}`, (seen.get(`${r.grade}|${r.tenor}`) ?? 0) + 1);
  for (const [k, c] of seen) if (c > 1) out.push(`${k.replace('|', ' ')}${k.endsWith('|') ? '' : '년'} 행이 ${c}번 있습니다.`);
  const byTenor = new Map<string, typeof rows>();
  for (const r of rows) byTenor.set(r.tenor, [...(byTenor.get(r.tenor) ?? []), r]);
  for (const [tenor, rs] of byTenor) {
    const t = tenor ? ` ${tenor}년` : '';
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      if (a.grade === b.grade) continue;
      const pairs = a.vals.map((v, k) => [v, b.vals[k]] as const).filter(([x, y]) => x != null && y != null);
      if (pairs.length >= 3 && pairs.every(([x, y]) => x === y)) out.push(`${a.grade}${t}와 ${b.grade}${t}의 값이 모두 같습니다(행 복사 확인).`);
      const [hi, lo] = GRADES.indexOf(a.grade) < GRADES.indexOf(b.grade) ? [a, b] : [b, a];
      const inv = hi.vals.map((v, k) => [v, lo.vals[k]] as const).filter(([x, y]) => x != null && y != null && x > y + 0.0001).length;
      if (inv && GRADES.indexOf(hi.grade) >= 0 && GRADES.indexOf(lo.grade) >= 0 && inv >= Math.max(1, pairs.length / 2)) {
        out.push(`${hi.grade}${t} 금리가 ${lo.grade}${t}보다 높은 칸이 ${inv}개입니다(등급 라벨 확인).`);
      }
    }
  }
  return [...new Set(out)].slice(0, 6);
}

// 같은 발행금리가 서로 다른 발행사에서 3번 이상 이어지면 표 오류 의심
function repeatedYields(list: PeerIssue[]) {
  const seq = list
    .slice()
    .sort((a, b) => (a.demand_dt ?? a.deal_dt ?? '').localeCompare(b.demand_dt ?? b.deal_dt ?? ''))
    .flatMap((p) => p.tranches.map((t) => ({ who: p.corp_name, y: t.yield_pct })));
  const out: string[] = [];
  let run: typeof seq = [];
  const flush = () => {
    const who = [...new Set(run.map((x) => x.who))];
    if (who.length >= 3) out.push(`${rate3(run[0].y)}가 ${who.join('·')}에서 이어짐`);
  };
  for (const x of seq) {
    if (x.y != null && run.length && run[0].y === x.y) run.push(x);
    else {
      flush();
      run = x.y != null ? [x] : [];
    }
  }
  flush();
  return out;
}

const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (x: string) => {
  const v = Number(x.replace(/,/g, ''));
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : x;
};

export function qaChecks(d: DeckData, inp: DeckInput, tx: DeckText, opts: { on: (id: ItemId) => boolean; edited: boolean; extraAllowed?: unknown[] }): Qa[] {
  const out: Qa[] = [];
  const { on } = opts;
  // 1. 회의 요약·증권사 전망이 최근 회의보다 오래됨
  for (const [id, kind, m] of [['bok', '금통위', d.policy.bok], ['fomc', 'FOMC', d.policy.fomc]] as const) {
    const last = lastMeeting(d, kind);
    // FOMC 는 회의 첫날·결과일 표기가 섞여 있어 이틀 여유를 둔다
    if (on(id) && m && last && days(m.meeting_dt, last) > 2) {
      out.push({ level: 'warn', item: id, text: `${kind} 요약이 ${yymmdd(m.meeting_dt)} 회의 기준입니다. 이후 ${yymmdd(last)} ${kind} 결과로 갱신이 필요합니다.` });
    }
  }
  for (const [id, kind, vs] of [['views', '금통위', d.views], ['usviews', 'FOMC', d.usViews]] as const) {
    const last = lastMeeting(d, kind);
    const newest = vs.map((v) => v.published_dt).sort().at(-1);
    if (on(id) && newest && last && newest < last) out.push({ level: 'warn', item: id, text: `증권사별 ${id === 'views' ? '국내' : '미국'} 전망이 최근 ${kind}(${yymmdd(last)}) 이전 자료입니다(최신 ${yymmdd(newest)}).` });
  }
  // 2. 공개 전망표가 오래됨(내부 전망표가 없을 때)
  if (on('forecast') && d.forecast && parseTsv(inp.internal?.rateFc ?? '').length < 2) {
    const ago = days(d.forecast.published_dt, d.asof);
    if (forecastStale(d)) out.push({ level: 'warn', item: 'forecast', text: `공개 금리 전망표(${yymmdd(d.forecast.published_dt)} 발표)가 이후 금통위·FOMC 결과를 반영하지 않아 표를 뺐습니다. 최신 전망표(내부 데이터)를 붙여 넣으면 표가 들어갑니다.` });
    else if (ago > 90) out.push({ level: 'info', item: 'forecast', text: `금리 전망표는 ${yymmdd(d.forecast.published_dt)} 발표 공개본입니다(${Math.round(ago)}일 전). NH 분기별 전망표(내부 데이터)를 연결하면 최신으로 바뀝니다.` });
  }
  // 3. 등급별 회사채 전망표(내부 데이터) 점검
  if (on('credit_fc')) for (const s of creditGridIssues(parseTsv(inp.internal?.creditFc ?? ''))) out.push({ level: 'warn', item: 'credit_fc', text: `회사채 전망표: ${s}` });
  // 3-0. 시장 자료(DM) 판 이후 금통위·FOMC 가 있었으면 시장 장표 문구가 이전 시점 기준임을 알린다
  if (d.dm && (on('rates') || on('forecast') || on('credit_fc'))) {
    const after = d.events.filter((e) => (e.kind === '금통위' || e.kind === 'FOMC') && (e.end_dt ?? e.event_dt) > d.dm!.edition && (e.end_dt ?? e.event_dt) < d.asof).map((e) => `${e.kind}(${yymmdd(e.end_dt ?? e.event_dt)})`);
    if (after.length) out.push({ level: 'warn', item: 'rates', text: `시장 장표 문구는 ${d.dm.title} ${yymmdd(d.dm.edition)} 판입니다. 이후 ${after.join('·')}가 있어 판 갱신이 필요합니다.` });
  }
  // 3-1. 주요 이슈는 시점에 따라 중요도가 바뀐다: 이슈 기준일 뒤에 금통위·FOMC 가 있었거나 30일이 지났으면 갱신 확인
  //      시장 수급 이슈(만기 집중·정책 자금, 만기도래 및 수급 장표)는 회의 결과로 바뀌는 내용이 아니라 30일 기준만
  {
    const meets = d.events.filter((e) => (e.kind === '금통위' || e.kind === 'FOMC') && (e.end_dt ?? e.event_dt) < d.asof).map((e) => e.end_dt ?? e.event_dt);
    const list = [
      ...(on('issues') ? pickIssues(d).map((x) => ({ x, item: 'issues' as const, what: '주요 이슈' })) : []),
      ...(on('maturity') ? supplyIssues(d).map((x) => ({ x, item: 'maturity' as const, what: '시장 수급' })) : []),
    ];
    for (const { x, item, what } of list) {
      const after = item === 'issues' ? meets.filter((m) => m > x.as_of).sort().pop() : undefined;
      const days = (Date.parse(d.asof) - Date.parse(x.as_of)) / 864e5;
      if (after) out.push({ level: 'warn', item, text: `${what} '${x.topic}'(${yymmdd(x.as_of)} 기준) 이후 ${yymmdd(after)} 금통위·FOMC가 있었습니다. 시장 자료 팩 갱신이 필요합니다.` });
      else if (days > 30) out.push({ level: 'info', item, text: `${what} '${x.topic}'은 ${yymmdd(x.as_of)} 기준(${Math.round(days)}일 전)입니다. 지금도 중요한 이슈인지 확인하세요.` });
    }
  }
  // 4. 사례 표: 비었거나 같은 발행금리 반복
  if (on('peers')) {
    const sel = inp.peerKeys.map((k) => d.peers.find((p) => p.key === k)).filter(Boolean) as PeerIssue[];
    if (!sel.length) out.push({ level: 'warn', item: 'peers', text: '수요예측 결과 표에 넣은 사례가 없습니다.' });
    const ex = excludedPeers(d);
    if (ex.length) out.push({ level: 'info', item: 'peers', text: `비교군에서 뺀 사례 ${[...new Set(ex.map((p) => `${p.corp_name}(${p.flag})`))].join(', ')}. 같은 등급이라도 회사 신용과 다르게 매겨진 등급이라 제외했습니다. 필요하면 사례 탭에서 확인하세요.` });
    const odd = sel.filter((p) => p.tranches.some((t) => t.in_band_krw != null && t.demand_krw != null && t.in_band_krw > t.demand_krw));
    if (odd.length) out.push({ level: 'warn', item: 'peers', text: `수요예측 결과 표: ${odd.map((p) => p.corp_name).join('·')}의 밴드 내 금액이 총참여보다 커서 총참여만 표시했습니다(원자료 확인).` });
    for (const s of repeatedYields(sel)) out.push({ level: 'warn', item: 'peers', text: `수요예측 결과 표: 같은 발행금리 ${s}(원자료 확인).` });
  }
  // 5. 일정·표지
  const sch = scheduleOf(d, inp);
  if (!sch) out.push({ level: 'warn', item: 'schedule', text: '희망 납입일이 없어 일정을 만들지 못했습니다.' });
  else if (sch.filing < d.asof) out.push({ level: 'warn', item: 'schedule', text: `증권신고서 제출일(${mdw(sch.filing)})이 이미 지났습니다. 납입일을 늦추세요.` });
  const ym = d.asof.slice(0, 7).replace('-', '. ');
  if (inp.month && inp.month.replace(/\s/g, '') !== ym.replace(/\s/g, '')) out.push({ level: 'info', item: 'cover', text: `표지 제안 월(${inp.month})이 데이터 기준월(${ym})과 다릅니다.` });
  // 6. 직접 고친 문안: 사실 묶음·규칙 문안에 없는 숫자(숫자 전체가 일치해야 함)
  if (opts.edited) {
    const allowed = allowedNumbers(factsFor(d, inp), ruleText(d, inp), ...(opts.extraAllowed ?? []));
    const fields: [keyof DeckText, ItemId][] = [['sizing', 'sizing'], ['schedule', 'schedule'], ['structure', 'terms'], ['peers', 'peers'], ['rates', 'rates'], ['views', 'views'], ['usviews', 'usviews'], ['forecast', 'forecast'], ['pipeline', 'pipeline'], ['maturity', 'maturity']];
    for (const [k, id] of fields) {
      if (!on(id)) continue;
      for (const l of tx[k] as string[]) {
        const bad = (l.match(NUM) ?? []).filter((x) => !allowed.has(norm(x)));
        if (bad.length) out.push({ level: 'warn', item: id, text: `고친 문안의 숫자 ${bad.join(', ')}가 데이터에 없습니다: "${l.slice(0, 40)}${l.length > 40 ? '…' : ''}"` });
      }
    }
  }
  return out;
}

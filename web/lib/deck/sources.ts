// 데이터 사용 현황: 장표마다 어떤 데이터를 썼고(외부·내부), 어떤 내부 데이터가 아직 연결되지 않았는지.
// 외부 데이터 = 사외에서 누구나 접근 가능한 공개 자료(DART·ECOS·한국은행·미 연준·증권사 공개 리포트 등).
// 내부 데이터 = 사내에서만 접근 가능한 자료(NH 자체 자료 + 민평 4사·FnGuide 같은 구독 데이터). 사내 시스템에서 연계하면 채워진다.
// 화면의 '데이터' 탭과 Appendix '데이터 사용 현황' 장표가 같은 결과를 쓴다.
import { itemOf, planOf, type ItemId, type Plan } from './catalog';
import { maturityBuckets, tenorMix } from './analytics';
import { forecastStale, horizonOf, peerPool, pickIssues, pipelineOf, scheduleOf, supplyIssues } from './rules';
import { hasTable } from './tsv';
import type { DeckData, DeckInput } from './types';

export type SrcKind = 'ext' | 'int';
// used: 썼음 / missing: 없음(내부는 미연결) / alt: 대신 쓴 자료
export type SrcStatus = 'used' | 'missing' | 'alt';
export type Src = { kind: SrcKind; label: string; source: string; status: SrcStatus; asof?: string | null; note?: string };
export type ItemReport = { id: ItemId; label: string; srcs: Src[] };
export type Omitted = { id: ItemId; label: string; reason: string; kind: SrcKind };
export type DataReport = {
  items: ItemReport[];
  omitted: Omitted[];
  extSources: string[]; // 쓴 외부 출처(중복 제거)
  intUsed: string[];
  intMissing: { label: string; source: string; items: string[]; note: string }[]; // 연결하면 채워질 내부 데이터
};

const latest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;

// 출처 문자열 → 제공 기관(요약 개수용)
export function providersOf(source: string): string[] {
  const out = new Set<string>();
  for (const part of source.split(/[·;]/)) {
    const x = part.trim();
    if (/DART|금융감독원 전자공시/.test(x)) out.add('DART');
    else if (/ECOS/.test(x)) out.add('한국은행 ECOS');
    else if (/한국은행|통화정책방향|한은/.test(x)) out.add('한국은행');
    else if (/연준|Federal|FOMC/.test(x)) out.add('미 연준');
    else if (/금융감독원/.test(x)) out.add('금융감독원');
    else if (/공휴일/.test(x)) out.add('관공서 공휴일');
    else if (/증권사|언론/.test(x)) out.add('증권사 공개 리포트·언론');
    else if (/NH/.test(x)) out.add('NH 리서치 공개 자료');
    else if (x) out.add(x);
  }
  return [...out];
}

function srcsOf(id: ItemId, d: DeckData, inp: DeckInput): Src[] {
  const mp = hasTable(inp.internal?.minpyeong);
  const ext = (label: string, source: string, ok: boolean, asof?: string | null, note?: string): Src => ({ kind: 'ext', label, source, status: ok ? 'used' : 'missing', asof: ok ? asof ?? null : null, note: ok ? note : note ?? '공개 데이터 없음' });
  const int = (label: string, source: string, ok: boolean, note: string): Src => ({ kind: 'int', label, source, status: ok ? 'used' : 'missing', note: ok ? undefined : note });
  const daily = d.daily.some((s) => s.key === 'ktb3y' && s.pts.length >= 120);
  const rateDt = latest(d.rates.map((r) => r.dt));
  switch (id) {
    case 'terms':
      return [
        ext('신용등급·직전 회차 조건', 'DART 증권신고서', !!(d.own.length || d.company.rating), d.own[0]?.deal_dt),
        ...(d.fee.last_bp != null ? [ext('직전 회차 인수수수료', 'DART 증권신고서', true, d.own[0]?.deal_dt)]
          : d.fee.group_median_bp != null ? [{ kind: 'ext', label: '같은 등급 인수수수료 중간값', source: 'DART 증권신고서', status: 'alt', note: '직전 회차 수수료 없음' } as Src] : []),
        ext('일정 역산(공휴일·금통위·FOMC)', '관공서 공휴일·한국은행·미 연준', !!scheduleOf(d, inp)),
        int('트랜치별 개별·등급민평, 국고 대비 spread', '민평 4사', mp, '밴드 비고에 민평 수치를 넣지 않음'),
      ];
    case 'sizing': {
      const t = tenorMix(peerPool(d, inp.peerScope));
      return [
        ext('같은 등급 만기별 발행 비중', 'DART 증권신고서·정정신고서', t.total > 0, latest(peerPool(d, inp.peerScope).map((p) => p.deal_dt)), t.total ? `최근 1년 ${t.issues}건` : '최근 1년 사례 없음'),
        ext('회사 최근 발행 결과(만기별 경쟁률·확정 가산금리)', 'DART 정정신고서', d.own.length > 0, d.own[0]?.deal_dt, d.own.length ? undefined : '공모 회사채 발행 이력 없음'),
        ext('회사 공모채 만기분포', 'DART', true, d.asof, maturityBuckets(d, horizonOf(inp)).gaps.length ? `만기도래 없는 해 ${maturityBuckets(d, horizonOf(inp)).gaps.join('·')}` : undefined),
        ext('국고채·회사채 금리', '한국은행 ECOS', d.rates.length > 0, rateDt),
        int('민평 커브(2/3/5년 개별 vs 등급)', '민평 4사', mp, '근거에서 민평 커브를 빼고, 금리 표는 ECOS 값으로'),
      ];
    }
    case 'schedule':
      return [
        ext('공휴일·금통위·FOMC·정기보고서 기한', '관공서 공휴일·한국은행·미 연준·금융감독원', d.events.length > 0 || d.holidays.length > 0),
        ext('기존 공모채 만기일', 'DART', true, d.asof, d.maturities.length ? undefined : '향후 3년 만기도래 없음'),
      ];
    case 'sales':
      return [
        ext('투자자 구분별 수요예측 참여', 'DART 정정신고서', d.own.some((p) => p.tranches.some((t) => t.byType?.length))),
        int('기관별 참여·배정 내역', 'NH 수요예측 북', hasTable(inp.internal?.investors), '기관별 표 없이 투자자 구분별로만'),
      ];
    case 'rates':
      return [
        { kind: 'ext', label: '기준금리·국고채·회사채 AA-/BBB- 금리', source: '한국은행 ECOS', status: daily ? 'used' : d.rates.length ? 'alt' : 'missing', asof: rateDt, note: daily ? undefined : d.rates.length ? '일별 값이 부족해 월말 값으로 그림' : '금리 데이터 없음' },
        ext('韓·美 정책금리 변경 이력', '한국은행·미 연준', d.policyHistory.kr.length > 0 || d.policyHistory.us.length > 0),
        int('발행사 등급 민평·신용스프레드 시계열', '민평 4사·본드웹', false, '스프레드 차트는 AA-·BBB- 3년으로 대체'),
      ];
    case 'bok':
    case 'fomc': {
      const m = id === 'bok' ? d.policy.bok : d.policy.fomc;
      const who = id === 'bok' ? '한국은행' : '미 연준';
      return [
        ext(`${id === 'bok' ? '금통위' : 'FOMC'} 결정·표결·핵심 포인트`, m?.sources.length ? m.sources.map((s) => s.title).slice(0, 2).join('; ') : who, !!m, m?.meeting_dt),
        int('NH 리서치 회의 리뷰(Discussion Material)', 'NH 리서치', false, '한국은행·미 연준 발표 기준으로만 요약'),
      ];
    }
    case 'forecast': {
      const fc = d.forecast;
      const pasted = hasTable(inp.internal?.rateFc);
      return [
        ...(pasted ? [] : [{ kind: 'ext', label: '리서치 공개 금리 전망표', source: fc ? `${fc.house} ${fc.title}` : 'NH 리서치 공개 자료', status: fc && !forecastStale(d) ? 'alt' : 'missing', asof: fc?.published_dt ?? null, note: !fc ? '공개 전망표 없음' : forecastStale(d) ? '발표 이후 금통위·FOMC가 있어 표 생략(의견만 사용)' : '분기 전망표 대신 공개 요약표' } as Src]),
        ext('리서치 주제별 의견', fc ? fc.house : 'NH 리서치', !!fc?.notes.length, latest(fc?.notes.map((x) => x.date) ?? [])),
        int('NH 분기별 금리 전망표(기준금리·국고·미국채)', 'NH 리서치', pasted, '공개 전망표로 대체'),
      ];
    }
    case 'credit_fc':
      return [
        ext('크레딧 시장 의견(시장 자료 팩)', [...new Set((d.marketNotes ?? []).map((x) => x.house))].join('·') || '증권사·언론', (d.marketNotes ?? []).length > 0, latest((d.marketNotes ?? []).map((x) => x.date))),
        ext('등급별 공모 회사채 발행 결과(최근 2개월)', 'DART 수요예측 결과', (d.recentIssues ?? []).length > 0, latest((d.recentIssues ?? []).map((x) => x.demand_dt ?? ''))),
        int('NH 등급별 회사채 금리 전망표', 'NH 리서치', hasTable(inp.internal?.creditFc), '시장 의견과 등급별 발행 결과로 대체'),
      ];
    case 'issues': {
      const xs = pickIssues(d);
      return [
        ext('주요 이슈(시장 자료 팩)', xs.map((x) => x.topic).join('·') || '시장 자료 팩', xs.length > 0, latest(xs.map((x) => x.as_of)), '중요도·기준일로 선택(수급 이슈는 만기도래 및 수급 장표)'),
        ext('시장 지표(환율·KOSPI·유가·아파트값)', '한국은행 ECOS·FRED', (d.market ?? []).length > 0, latest((d.market ?? []).map((m) => m.pts[m.pts.length - 1]?.[0] ?? ''))),
        int('NH Discussion Material 주요 이슈', 'IB·리서치', false, '공개 자료로 만든 시장 자료 팩으로 대체'),
      ];
    }
    case 'views':
    case 'usviews': {
      const vs = id === 'views' ? d.views : d.usViews;
      return [
        ext('증권사 리포트·기사 요약', '증권사 공개 리포트·언론', vs.length > 0, latest(vs.map((v) => v.published_dt)), vs.length ? `${new Set(vs.map((v) => v.house)).size}곳` : undefined),
        int('증권사 리포트 취합(하우스·애널리스트 일괄)', 'FnGuide', false, '공개 리포트·기사 기준이라 하우스 수가 적을 수 있음'),
      ];
    }
    case 'peers': {
      const sel = inp.peerKeys.map((k) => d.peers.find((p) => p.key === k)).filter(Boolean);
      return [
        ext('같은 등급 수요예측 결과', 'DART 정정신고서·증권발행실적보고서', sel.length > 0, latest(sel.map((p) => p!.demand_dt ?? p!.deal_dt)), `${sel.length}건`),
        int('수요예측 전일 개별/등급 spread', '민평 4사', false, '표에 전일 spread 열 없음'),
      ];
    }
    case 'compare':
      return [ext('비교 사례 수요예측 결과', 'DART 정정신고서', inp.compareKeys.length > 0)];
    case 'corp':
      return [ext('국고·회사채 3년 금리', '한국은행 ECOS', d.rates.length > 0, rateDt), ext('같은 등급 최근 발행금리', 'DART 발행조건확정 공시', d.peers.length > 0)];
    case 'pipeline':
      return [ext('발행 예정 일반 공모 회사채(신고서 제출~납입 전)', 'DART 증권신고서', true, d.asof, `${pipelineOf(d).length}건`)];
    case 'league':
    case 'strength':
      return [ext('대표주관·인수 실적', 'DART 증권신고서', d.leagueYearly.length > 0 || d.league.rows.length > 0)];
    case 'maturity': {
      const xs = supplyIssues(d);
      return [
        ext('등급별 월별 만기도래', 'DART 발행 내역', true, d.maturityByGrade.asof),
        ...(xs.length ? [ext('시장 수급(만기 집중·정책 자금)', xs.map((x) => x.topic).join('·'), true, latest(xs.map((x) => x.as_of)), 'Discussion Material 시장 수급 문구')] : []),
      ];
    }
    case 'events':
      return [ext('금통위·FOMC·정기보고서 일정', '한국은행·미 연준·금융감독원', d.events.length > 0)];
    case 'ir': case 'nh_company': case 'nh_core': case 'nh_scope': case 'nh_org': case 'ceo':
      return [int('NH 제안서 템플릿 고정 장표', 'NH투자증권', true, '')];
    default:
      return [];
  }
}

const OMIT: Partial<Record<ItemId, [string, SrcKind]>> = {
  credit_fc: ['내부 데이터(NH 등급별 회사채 전망표) 미연결', 'int'],
  views: ['수집된 증권사 전망 자료 없음', 'ext'],
  usviews: ['수집된 증권사 전망 자료 없음', 'ext'],
  bok: ['금통위 요약 자료 없음', 'ext'],
  fomc: ['FOMC 요약 자료 없음', 'ext'],
  forecast: ['금리 전망표 없음', 'ext'],
  sales: ['투자자 구분별 참여 자료 없음', 'ext'],
  compare: ['비교 사례를 고르지 않음', 'ext'],
  league: ['리그테이블 자료 없음', 'ext'],
};

export function dataReport(d: DeckData, inp: DeckInput, available: (id: ItemId) => boolean, plan?: Plan): DataReport {
  const p = plan ?? planOf(inp.items, available);
  const shown = p.sections.flatMap((s) => s.items);
  const items: ItemReport[] = shown.map((n) => ({ id: n.id, label: n.label, srcs: srcsOf(n.id, d, inp) })).filter((x) => x.srcs.length);
  // 켰지만 자료가 없어 빠진 장표: 번호 없이 이름만
  const all = planOf(inp.items, () => true).sections.flatMap((s) => s.items);
  const omitted: Omitted[] = all.filter((n) => !available(n.id)).map((n) => {
    const [reason, kind] = OMIT[n.id] ?? ['자료 없음', 'ext'];
    return { id: n.id, label: itemOf(n.id)?.title ?? n.id, reason, kind };
  });
  const extSources = [...new Set(items.flatMap((x) => x.srcs.filter((s) => s.kind === 'ext' && s.status !== 'missing').flatMap((s) => providersOf(s.source))))];
  const intUsed = [...new Set(items.flatMap((x) => x.srcs.filter((s) => s.kind === 'int' && s.status === 'used').map((s) => `${s.label} (${s.source})`)))];
  const miss = new Map<string, { label: string; source: string; items: string[]; note: string }>();
  for (const x of items) for (const s of x.srcs) {
    if (s.kind !== 'int' || s.status !== 'missing') continue;
    const k = `${s.label}|${s.source}`;
    const e = miss.get(k) ?? { label: s.label, source: s.source, items: [], note: s.note ?? '' };
    e.items.push(x.label);
    miss.set(k, e);
  }
  for (const o of omitted) if (o.kind === 'int') {
    const s = srcsOf(o.id, d, inp).find((x) => x.kind === 'int');
    if (s) miss.set(`${s.label}|${s.source}`, { label: s.label, source: s.source, items: [o.label], note: '장표 생략' });
  }
  return { items, omitted, extSources, intUsed, intMissing: [...miss.values()] };
}

export const STATUS_LABEL: Record<SrcKind, Record<SrcStatus, string>> = {
  ext: { used: '외부 사용', missing: '외부 없음', alt: '외부 대체' },
  int: { used: '내부 연결', missing: '내부 미연결', alt: '내부 대체' },
};

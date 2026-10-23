// 장표 레이아웃: 데이터·입력·문안 → 슬라이드 표시 목록 (NH 서식)
import {
  bandKind, bandRange, eok, eokW, mdw, rate2, rate3, ratioX, shortFirm, years, yy, yymmdd,
} from './fmt';
import {
  BULLET_INDENT, P, cellBoxes, rich, textHeight, type Cell, type Para, type Prim, type Slide, type Table,
} from './model';
import { fullUnder, peerPool, recentWindow, scheduleOf, verdictOf } from './rules';
import { WD, korDate, md, weekday } from './schedule';
import { C, PAGE, textW } from './theme';
import type { DeckData, DeckInput, DeckText, PeerIssue, SlideId } from './types';

const X0 = 47;
const X1 = 736;
const CW = X1 - X0;

// ---------------------------------------------------------------------------------------------
// 공통 요소
const paras = (s: string, o: Omit<Para, 'runs'> = {}) => s.split('\n').map((l) => P(l, o));
const cell = (s: string, o: Partial<Cell> = {}): Cell => ({ paras: paras(s), ...o });
const bullets = (xs: string[], gap = 4): Para[] => xs.map((x, i) => P(x, { bullet: true, gap: i ? gap : 0 }));

function header(title: string, sub: string | null, page: number): Prim[] {
  const runs = [{ t: title, size: 20 }, ...(sub ? [{ t: `_${sub}`, size: 15 }] : [])];
  return [
    { k: 'rect', x: 0, y: 0, w: PAGE.w, h: 68, fill: C.band },
    { k: 'line', x1: 65, y1: 68, x2: 742, y2: 68, color: C.blue, w: 0.75 },
    { k: 'rect', x: 742, y: 28, w: 38, h: 40, fill: C.blue },
    { k: 'text', x: 57, y: 26, w: 560, h: 36, paras: [{ runs }], size: 20, color: C.ink, xb: true, valign: 'b', pad: 0 },
    { k: 'img', x: 619, y: 42, w: 98, h: 15.4, src: 'logo-color' },
    { k: 'text', x: 700, y: 512, w: 60, h: 14, paras: [P(String(page))], size: 9, color: C.ink, bold: true, align: 'r', pad: 0 },
  ];
}

// 요약 상자: 첫 줄 headline(굵게, 글머리 없음) + 글머리 목록. 높이는 글 양에 맞춘다.
function callout(y: number, lines: string[], headline?: string, maxH = 150): { prims: Prim[]; bottom: number } {
  if (!lines.length && !headline) return { prims: [], bottom: y };
  let size = 10;
  const pad = 10;
  const build = (sz: number) => [
    ...(headline ? [P(headline, {}, { b: true })] : []),
    ...lines.map((l, i) => P(l, { bullet: true, gap: headline || i ? Math.round(sz * 0.55) : 0 })),
  ];
  let ps = build(size);
  let h = textHeight(ps, CW - pad * 2, size, false, 1.32, BULLET_INDENT(size)) + pad * 2;
  while (h > maxH && size > 8) {
    size -= 0.5;
    ps = build(size);
    h = textHeight(ps, CW - pad * 2, size, false, 1.32, BULLET_INDENT(size)) + pad * 2;
  }
  return {
    prims: [
      { k: 'rect', x: X0, y, w: CW, h, fill: C.label },
      { k: 'text', x: X0, y, w: CW, h, paras: ps, size, color: C.ink, valign: 'm', pad, line: 1.32 },
    ],
    bottom: y + h,
  };
}

function goldTitle(y: number, text: string, x0 = X0, x1 = X1, note?: string): Prim[] {
  const tw = textW(text, 11, true) * 1.08 + 8;
  const cx = (x0 + x1) / 2;
  const out: Prim[] = [
    { k: 'line', x1: x0, y1: y + 7, x2: cx - tw / 2 - 10, y2: y + 7, color: C.gold, w: 2.2 },
    { k: 'line', x1: cx + tw / 2 + 10, y1: y + 7, x2: x1, y2: y + 7, color: C.gold, w: 2.2 },
    { k: 'text', x: cx - tw / 2 - 6, y: y - 1, w: tw + 12, h: 16, paras: [P(text)], size: 11, color: C.ink, bold: true, align: 'c', valign: 'm', pad: 0 },
  ];
  if (note) out.push({ k: 'text', x: x1 - 160, y: y + 12, w: 160, h: 10, paras: [P(note)], size: 6.5, color: C.muted, align: 'r', pad: 0 });
  return out;
}

function footnote(lines: string[], y = 506): Prim[] {
  if (!lines.length) return [];
  return [{ k: 'text', x: X0, y, w: 640, h: 26, paras: lines.map((l) => P(l)), size: 6.5, color: C.muted, valign: 't', pad: 0, line: 1.25 }];
}

const TH = (s: string, o: Partial<Cell> = {}): Cell => cell(s, { fill: C.th, color: C.white, bold: true, align: 'c', ...o });
const LB = (s: string, o: Partial<Cell> = {}): Cell => cell(s, { fill: C.label, bold: true, align: 'c', ...o });
const TD = (s: string, o: Partial<Cell> = {}): Cell => cell(s, { align: 'c', ...o });

function table(x: number, y: number, colW: number[], rowH: number[], rows: (Cell | null)[][], size = 9, gridV = true): Table {
  return { k: 'table', x, y, colW, rowH, rows, size, color: C.ink, grid: C.grid, gridV };
}

// 행 높이를 남은 공간에 맞춘다 (최소~최대)
function fitRows(n: number, top: number, bottom: number, min: number, max: number) {
  if (!n) return 0;
  return Math.max(min, Math.min(max, (bottom - top) / n));
}

// ---------------------------------------------------------------------------------------------
// 표지·간지·뒷표지
function cover(inp: DeckInput): Slide {
  return {
    id: 'cover', title: '표지', bg: C.blue,
    prims: [
      { k: 'text', x: 74, y: 56, w: 300, h: 24, paras: [P('Beyond the First')], size: 14, color: C.white, bold: true, pad: 0, valign: 'm' },
      { k: 'text', x: 63, y: 140, w: 660, h: 34, paras: [P(`${inp.issuer} 제${inp.series}회 공모회사채 대표주관 제안서`)], size: 22, color: C.white, xb: true, valign: 'b', pad: 0 },
      { k: 'line', x1: 63, y1: 177, x2: 712, y2: 177, color: C.white, w: 0.75 },
      { k: 'text', x: 74, y: 186, w: 240, h: 24, paras: [P(inp.month)], size: 16, color: C.white, bold: true, pad: 0, valign: 'm' },
      { k: 'rect', x: 514, y: 310, w: 41, h: 16, fill: C.yellow },
      { k: 'rect', x: 0, y: 352, w: 173, h: 37, fill: C.yellow },
      { k: 'rect', x: 729, y: 367, w: 51, h: 22, fill: C.white },
      { k: 'rect', x: 280, y: 439, w: 92, h: 21, fill: C.sky },
      { k: 'img', x: 63, y: 489, w: 120, h: 18.3, src: 'logo-white' },
      {
        k: 'text', x: 196, y: 489, w: 470, h: 20, size: 5.5, color: '9FC4E6', pad: 0, line: 1.3,
        paras: [P('본 자료는 NH투자증권이 제작한 것이며, 투자권유를 위한 광고물로 활용될 수 없고, 투자자에게 배포될 수 없습니다. 본 자료에 수록된 내용은 신뢰할만한 자료 및 정보로부터 얻어진 것이나 당사는 그 정확성이나 안정성을 보장할 수 없습니다. 따라서 어떠한 경우에도 본 자료는 고객의 투자 결과에 대한 법적 책임소재에 대한 증빙자료로 사용될 수 없습니다.')],
      },
    ],
  };
}

function divider(id: SlideId, title: string, items: string[]): Slide {
  return {
    id, title, bg: C.navy,
    prims: [
      { k: 'img', x: 80, y: 122, w: 148, h: 22.5, src: 'logo-white' },
      { k: 'rect', x: 705, y: 133, w: 75, h: 50, fill: C.navyDeep },
      { k: 'rect', x: 0, y: 212, w: 390, h: 51, fill: C.secBar },
      { k: 'text', x: 26, y: 212, w: 360, h: 51, paras: [P(title)], size: 17, color: C.white, bold: true, valign: 'm', pad: 0 },
      { k: 'rect', x: 81, y: 295, w: 699, h: 204, fill: C.blue },
      ...items.map((t, i): Prim => ({
        k: 'text', x: 95, y: 309 + i * 29.5, w: 600, h: 22, size: 13, color: C.white, valign: 'm', pad: 0,
        paras: [{ runs: [{ t: /^Appendix/.test(t) ? '' : `${i + 1}.`, size: 13 }, { t: /^Appendix/.test(t) ? t : `   ${t}` }] }],
      })),
    ],
  };
}

function back(inp: DeckInput): Slide {
  const contacts = inp.contacts.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5);
  return {
    id: 'back', title: '뒷표지', bg: C.blue,
    prims: [
      { k: 'rect', x: 514, y: 205, w: 41, h: 16, fill: C.yellow },
      { k: 'rect', x: 0, y: 247, w: 173, h: 37, fill: C.yellow },
      { k: 'rect', x: 729, y: 262, w: 51, h: 22, fill: C.white },
      { k: 'rect', x: 280, y: 334, w: 92, h: 21, fill: C.sky },
      { k: 'img', x: 310, y: 258, w: 160, h: 24.4, src: 'logo-white' },
      ...(inp.dept ? [{ k: 'text', x: 50, y: 420, w: 500, h: 24, paras: [P(inp.dept)], size: 15, color: C.white, xb: true, pad: 0, valign: 'm' } as Prim] : []),
      ...(contacts.length ? [{ k: 'text', x: 50, y: 452, w: 500, h: 70, paras: contacts.map((c) => P(c)), size: 8.5, color: C.white, pad: 0, line: 1.6 } as Prim] : []),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// 1. 주요 제안
function terms(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const sch = scheduleOf(d, inp);
  const c = callout(78, [tx.lead]);
  const top = c.bottom + 10;
  const prims: Prim[] = [...header(`${no}. 주요 제안`, null, page), ...c.prims, ...goldTitle(top, '주요 제안(案)')];
  const band = inp.band.type === 'later'
    ? '^^추후 결정^^'
    : inp.band.type === 'fixed'
      ? `고정금리 ${inp.band.low ?? '–'}%~${inp.band.high ?? '–'}%`
      : `개별민평 ${inp.band.low ?? '–'}bp~+${inp.band.high ?? '–'}bp`;
  const note = (s: string) => (s ? cell(s.split('\n').map((x) => x).join('\n'), { align: 'l', paras: s.split('\n').filter(Boolean).map((x) => P(x, { bullet: true })) }) : TD(''));
  const fee = [
    inp.feeUw != null ? `인수수수료 : 발행금액의 ${inp.feeUw}bp` : '인수수수료 : 협의',
    ...(inp.feeLead != null ? [`대표주관수수료 : 발행금액의 ${inp.feeLead}bp`] : []),
  ].join('\n');
  const rows: (Cell | null)[][] = [
    [TH('구분'), TH('주요 내용', { colspan: 2 }), null, TH('비고')],
    [LB('증권 유형'), TD(inp.security, { colspan: 2 }), null, note('')],
    [LB('신용등급'), TD(inp.rating || '–', { colspan: 2 }), null, note(inp.ratingNote)],
    [LB('만기 및 발행금액(예정)'), TD(`^^${inp.tenors || '–'}^^`), TD(`^^${inp.amountEok != null ? `${inp.amountEok.toLocaleString('ko-KR')}억원` : '–'}^^${inp.maxEok ? `\n증액시 Max ${inp.maxEok.toLocaleString('ko-KR')}억원` : ''}`), note('시장 상황에 따라 트랜치 및 금액 조정 가능\n수요예측 결과에 따라 증액 여부 협의 예정')],
    [LB('이자지급'), TD(inp.coupon, { colspan: 2 }), null, note(/월단위|매월/.test(inp.coupon) ? '리테일 투자자 선호 반영' : '')],
    [LB('금리 밴드(예정)'), TD(band, { colspan: 2 }), null, note(inp.bandNote)],
    [LB('수요예측일(예정)'), TD(sch ? `${mdw(sch.demandOptions[0])} ~ ${mdw(sch.demandOptions[2])}` : '–', { colspan: 2 }), null, { ...note('시장 상황 고려 변경 가능'), rowspan: 3, valign: 'm' }],
    [LB('발행일(예정)'), TD(sch ? `^^${mdw(sch.pay)}^^` : '–', { colspan: 2 }), null, null],
    [LB('인수희망금액'), TD(inp.uw, { colspan: 2 }), null, null],
    [LB('수수료'), TD(fee, { colspan: 2 }), null, note(inp.feeNote)],
  ];
  const tTop = top + 16;
  const rh = fitRows(rows.length, tTop, 500, 24, 36);
  prims.push(table(X0, tTop, [229, 107, 108, 245], rows.map((_, i) => (i === 0 ? Math.min(rh, 30) : rh)), rows, 9.5));
  return { id: 'terms', title: '주요 제안', prims };
}

// 2. 같은 등급 수요예측 사례
function peerRows(list: PeerIssue[], self: string): { rows: (Cell | null)[][]; n: number } {
  const rows: (Cell | null)[][] = [];
  for (const p of list) {
    const tr = p.tranches.length ? p.tranches : [null];
    tr.forEach((t, i) => {
      const first = i === 0;
      const span = tr.length;
      const isSelf = p.corp_code === self;
      const nm = cell(isSelf ? `^^${p.corp_name}^^` : p.corp_name, { bold: true, align: 'c', rowspan: span, valign: 'm', color: isSelf ? C.blue : undefined });
      const ratio = t?.ratio ?? (span === 1 ? p.ratio : null);
      const under = t?.under ?? (span === 1 ? p.under : null);
      const dem = t ? (t.in_band_krw != null || t.demand_krw != null ? `${eok(t.in_band_krw ?? t.demand_krw)}/${eok(t.demand_krw)}` : '–') : '–';
      rows.push([
        first ? nm : null,
        first ? TD(p.rating ?? '–', { rowspan: span, valign: 'm' }) : null,
        TD(t ? years(t.months) : '–'),
        TD(eok(t?.initial_krw ?? p.initial_krw)),
        TD(eok(t?.amount_krw ?? p.amount_krw)),
        TD(rate3(t?.yield_pct)),
        TD(bandKind(t?.band_type ?? p.band_type), { bold: true }),
        TD(bandRange(t ?? p)),
        first ? TD(p.demand_dt ? mdw(p.demand_dt) : '–', { rowspan: span, valign: 'm' }) : null,
        first ? TD(p.deal_dt ? mdw(p.deal_dt) : '–', { rowspan: span, valign: 'm' }) : null,
        TD(dem),
        TD(under ? `!!${ratioX(ratio)}!!` : ratioX(ratio)),
      ]);
    });
  }
  return { rows, n: rows.length };
}

function peers(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const scope = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const pool = peerPool(d, inp.peerScope);
  const sel = inp.peerKeys.map((k) => pool.find((p) => p.key === k) ?? d.peers.find((p) => p.key === k)).filter(Boolean) as PeerIssue[];
  sel.sort((a, b) => (a.demand_dt ?? a.pricing_dt ?? a.deal_dt ?? '').localeCompare(b.demand_dt ?? b.pricing_dt ?? b.deal_dt ?? ''));
  const head = scheduleHead(d, inp);
  const c = callout(78, tx.peers, head, 140);
  const top = c.bottom + 10;
  const prims: Prim[] = [...header(`${no}. 발행시기 제안`, `${scope}등급 수요예측 사례`, page), ...c.prims, ...goldTitle(top, `최근 1년 ${scope}등급 수요예측 사례`)];
  const { rows: body } = peerRows(sel, d.company.corp_code);
  const hd: (Cell | null)[][] = [
    [TH('발행회사', { rowspan: 2 }), TH('신용\n등급', { rowspan: 2 }), TH('만기\n(Y)', { rowspan: 2 }), TH('예측금액\n(억)', { rowspan: 2 }), TH('발행금액\n(억)', { rowspan: 2 }), TH('발행금리', { rowspan: 2 }),
      TH('금리밴드', { colspan: 2 }), null, TH('수요예측', { rowspan: 2 }), TH('납입\n기일', { rowspan: 2 }), TH('예측결과(밴드내/총참여)', { colspan: 2 }), null],
    [null, null, null, null, null, null, TH('구분'), TH('bp / %'), null, null, TH('금액(억)'), TH('경쟁률')],
  ];
  const tTop = top + 18;
  const rh = fitRows(body.length, tTop + 36, 500, 18, 34);
  const rows = [...hd, ...(body.length ? body : [[TD('선택한 사례가 없습니다', { colspan: 12 }), null, null, null, null, null, null, null, null, null, null, null]])];
  prims.push(table(X0, tTop, [95, 50, 34, 54, 54, 56, 36, 70, 52, 52, 76, 60], [18, 18, ...rows.slice(2).map(() => rh)], rows, body.length > 8 ? 8 : 8.5));
  prims.push(...footnote(['주) 수요예측 결과는 발행조건확정 증권신고서(정정) 기준. 경쟁률 = 총 참여금액 ÷ 수요예측 모집금액, 빨간색은 미달.', '자료: 금융감독원 DART']));
  return { id: 'peers', title: '같은 등급 수요예측 사례', prims };
}

function scheduleHead(d: DeckData, inp: DeckInput) {
  const sch = scheduleOf(d, inp);
  return sch ? `${d.company.corp_name}의 수요예측 흥행을 위해 ${korDate(sch.pay)} 발행 일정을 제안` : undefined;
}

// 2. 사례 비교
function compare(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const cmp = inp.compareKeys.map((k) => d.peers.find((p) => p.key === k)).filter(Boolean).slice(0, 3) as PeerIssue[];
  const under = cmp.find(fullUnder);
  const sub = under ? `${under.corp_name} 수요예측 미매각 사례 분석` : '수요예측 사례 비교';
  const c = callout(78, tx.compare, undefined, 150);
  const top = c.bottom + 10;
  const scope = `${d.company.rating_group ?? ''}`;
  const prims: Prim[] = [...header(`${no}. 발행시기 제안`, sub, page), ...c.prims, ...goldTitle(top, `주요 ${scope}등급 수요예측 사례 비교분석`)];
  const n = Math.max(cmp.length, 1);
  const w0 = 130;
  const wn = (CW - w0) / n;
  const verdict = (p: PeerIssue) => verdictOf(p, true);
  const R = (label: string, f: (p: PeerIssue) => string, o: Partial<Cell> = {}) => [LB(label), ...cmp.map((p) => TD(f(p), o))];
  const rows: (Cell | null)[][] = [
    [TH('평가항목'), ...cmp.map((p) => TH(cmp.filter((q) => q.corp_name === p.corp_name).length > 1 ? `${p.corp_name} (${yy(p.deal_dt)})` : p.corp_name))],
    R('수요예측일', (p) => (p.demand_dt ? mdw(p.demand_dt) : '–')),
    R('신용등급', (p) => p.rating ?? '–'),
    R('만기 구조', (p) => p.tenor_combo || '–'),
    R('금리 밴드', (p) => (p.band_low == null ? '–' : `${bandKind(p.band_type)} ${bandRange(p)}`)),
    R('발행금리', (p) => p.tranches.map((t) => rate3(t.yield_pct)).join(' / ')),
    R('예측 → 발행금액', (p) => `${eokW(p.initial_krw)} → ${eokW(p.amount_krw)}`),
    R('경쟁률', (p) => (fullUnder(p) ? `!!${ratioX(p.ratio)}!!` : p.under ? `${ratioX(p.ratio)}\n(${p.tranches.filter((t) => t.under).map((t) => `${t.tenor} !!${ratioX(t.ratio)}!!`).join(', ')})` : ratioX(p.ratio))),
    R('대표주관', (p) => (p.lead ?? '–').split(',').map((s) => shortFirm(s.trim())).join(', ')),
    R('결과', verdict),
  ];
  const tTop = top + 18;
  const rh = fitRows(rows.length - 1, tTop + 24, 500, 20, 30);
  prims.push(table(X0, tTop, [w0, ...cmp.map(() => wn)], [24, ...rows.slice(1).map(() => rh)], cmp.length ? rows : [[TH('평가항목')]], 9));
  prims.push(...footnote(['자료: 금융감독원 DART(증권신고서, 발행조건확정 정정신고서)']));
  return { id: 'compare', title: sub, prims };
}

// 2. 발행 일정(안)
function schedule(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const sch = scheduleOf(d, inp);
  const c = callout(78, tx.schedule, undefined, 120);
  const top = c.bottom + 10;
  const prims: Prim[] = [...header(`${no}. 발행시기 제안`, '회사채 발행 일정(안)', page), ...c.prims, ...goldTitle(top, '발행 일정(안)')];
  if (!sch) return { id: 'schedule', title: '발행 일정(안)', prims };
  const tTop = top + 18;
  const calW = 549;
  const colW = Array(5).fill(calW / 5);
  const rows: (Cell | null)[][] = [WD.slice(1, 6).map((w) => cell(w, { fill: C.band, bold: true, align: 'c' }))];
  const rowH = [16];
  const weeks = sch.weeks;
  const contentH = Math.max(22, Math.min(46, (500 - tTop - 16) / weeks.length - 16));
  for (const w of weeks) {
    rows.push(w.map((dt) => cell(`${md(dt)}(${WD[weekday(dt)]})`, { fill: C.th, color: C.white, bold: true, align: 'c', size: 8.5 })));
    rowH.push(16);
    rows.push(w.map((dt) => {
      const st = sch.steps.filter((s) => s.dt === dt);
      if (!st.length) return TD('');
      const ps: Para[] = [];
      let fill: string | undefined;
      for (const s of st) {
        const color = s.kind === 'key' ? C.orange : s.kind === 'demand' ? C.teal : s.kind === 'pay' ? '4F7A28' : s.kind === 'holiday' ? C.red : s.kind === 'event' ? C.muted : C.ink;
        const b = s.kind !== 'event';
        for (const l of s.label.split('\n')) ps.push({ runs: [{ t: l, b, color }] });
        if (s.kind === 'pay') fill = C.green;
        if (s.kind === 'demand' && s.label === '수요예측') fill = 'E3F1FA';
        if (s.kind === 'holiday') fill = 'FBE9E7';
      }
      return { paras: ps, align: 'c', valign: 'm', fill, size: 8 };
    }));
    rowH.push(contentH);
  }
  prims.push(table(X0, tTop, colW, rowH, rows, 8));
  // 오른쪽 규칙 설명
  const nx = X0 + calW + 11;
  const nw = X1 - nx;
  const notes = [
    ['대표주관계약 체결', '「증권인수업무규정」에 따라 증권신고서 제출 10영업일 前 계약 체결 필요'],
    ['대표주관계약 체결 통보', '「증권인수업무규정」에 따라 계약 체결 5영업일 內 금융투자협회에 통보 필요(발행정보가 시장에 Open)'],
    ['증권신고서 제출', '「자본시장법」에 따라 발행일 8영업일 前 제출'],
    ['수요예측', '수요예측 결과 반영 정정증권신고서는 발행일 4영업일 前 제출 필요. 이를 감안해 발행일 5~6영업일 前 실시가 일반적'],
    ['정정증권신고서 제출', '수요예측 결과 반영 및 최종 발행금리 확정 공시'],
  ];
  const nps: Para[] = notes.flatMap(([t, s], i) => [
    { runs: [{ t: `• ${t}` }], gap: i ? 7 : 0 },
    { runs: [{ t: `- ${s}`, color: C.sub }] },
  ]);
  const nh = Math.min(500 - tTop, Math.max(rowH.reduce((a, b) => a + b, 0), 240));
  prims.push({ k: 'rect', x: nx, y: tTop, w: nw, h: nh, fill: 'FAFAFA', stroke: '9E9E9E', sw: 0.5, dash: true });
  prims.push({ k: 'text', x: nx, y: tTop, w: nw, h: nh, paras: nps, size: 7.5, color: C.ink, valign: 'm', pad: 7, line: 1.3 });
  prims.push(...footnote(['주) 영업일은 주말·관공서 공휴일·채권시장 휴장일(12/31) 제외. 금통위·FOMC 일정은 한국은행·미 연준 발표 기준.']));
  return { id: 'schedule', title: '발행 일정(안)', prims };
}

// 3. 트랜치·만기 구조
function structure(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const c = callout(78, tx.structure, '[밴드 및 이자지급 방식, 만기 구조]', 130);
  const top = c.bottom + 12;
  const prims: Prim[] = [...header(`${no}. 발행전략 제안`, '트랜치 및 최적 만기구조', page), ...c.prims];
  const lw = 320;
  prims.push(...goldTitle(top, '만기구조 비교', X0, X0 + lw));
  const sr = tx.structureRows.length ? tx.structureRows : [{ label: inp.tenors || '–', desc: '' }];
  const lrows: (Cell | null)[][] = [
    [TH('만기 구조'), TH('설명')],
    ...sr.map((r) => [LB(r.label), { paras: r.desc.split('\n').filter(Boolean).map((x) => P(x, { bullet: true })), align: 'l', valign: 'm' } as Cell]),
  ];
  const tTop = top + 18;
  const lrh = fitRows(sr.length, tTop + 22, 500, 34, 90);
  prims.push(table(X0, tTop, [72, lw - 72], [22, ...sr.map(() => lrh)], lrows, 8.5));

  const rx = X0 + lw + 14;
  const rw = X1 - rx;
  prims.push(...goldTitle(top, `${d.company.corp_name} 공모 회사채 만기도래 현황`, rx, X1, '(단위: 억원, %)'));
  const mats = d.maturities.slice(0, 9);
  const rrows: (Cell | null)[][] = [
    [TH('증권'), TH('만기일'), TH('금액'), TH('이자율'), TH('당시 대표주관')],
    ...(mats.length
      ? mats.map((m) => [TD(`제${m.series ?? ''}회`), TD(yymmdd(m.dt)), TD(eok(m.amount_krw)), TD(m.coupon_pct != null ? Number(m.coupon_pct).toFixed(3) : '–'), TD((m.lead ?? '–').split(',').map((s) => shortFirm(s.trim())).join(', '))])
      : [[TD('향후 3년 내 만기가 도래하는 공모 회사채 없음', { colspan: 5 }), null, null, null, null]]),
  ];
  const rrh = fitRows(rrows.length - 1, tTop + 22, 500, 18, 30);
  prims.push(table(rx, tTop, [62, 76, 60, 56, rw - 254], [22, ...rrows.slice(1).map(() => rrh)], rrows, 8.5));
  prims.push(...footnote(['주) 만기구조 통계는 최근 6개월 같은 등급군 일반 공모 회사채 기준. 만기도래는 공모 회사채만 포함(사모·CP·차입금 제외).', '자료: 금융감독원 DART']));
  return { id: 'structure', title: '트랜치·만기 구조', prims };
}

// 4. NH투자증권의 강점
function strength(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const g = d.company.rating_group ?? '';
  const prims: Prim[] = [...header(`${no}. NH투자증권의 강점`, null, page), ...goldTitle(80, `NH투자증권의 ${g}등급 공모 회사채 발행 경쟁력`)];
  tx.strengths.slice(0, 3).forEach((s, i) => {
    const y = 100 + i * 42;
    prims.push({ k: 'rect', x: X0, y, w: 122, h: 34, fill: C.th });
    prims.push({ k: 'text', x: X0, y, w: 122, h: 34, paras: [P(s.title)], size: 10, color: C.white, bold: true, align: 'c', valign: 'm', pad: 4 });
    prims.push({ k: 'rect', x: X0 + 128, y, w: CW - 128, h: 34, fill: C.label });
    prims.push({ k: 'text', x: X0 + 128, y, w: CW - 128, h: 34, paras: [P(s.text, { bullet: true })], size: 9.5, color: C.ink, valign: 'm', pad: 10 });
  });
  const lg = d.league;
  const top = 236;
  prims.push(...goldTitle(top, `증권사별 ${g}등급 공모 회사채 대표주관 실적`, X0, X1, '(단위: 억원)'));
  const rows = lg.rows.slice(0, 10);
  if (rows.length) {
    prims.push({
      k: 'chart', x: X0 + 10, y: top + 24, w: CW - 20, h: 230,
      chart: {
        kind: 'bar', cats: rows.map((r) => shortFirm(r.firm)), values: rows.map((r) => Math.round(r.credit / 1e8)),
        labels: rows.map((r) => Math.round(r.credit / 1e8).toLocaleString('ko-KR')), highlight: rows.map((r, i) => (r.isNh ? i : -1)).filter((i) => i >= 0),
        color: C.bar, hiColor: C.yellow,
      },
    });
  }
  prims.push(...footnote([`주) ${yymmdd(lg.since)} 이후 납입, ${lg.scope} ${lg.deals}건 기준. 공동 대표주관은 금액을 균등 배분.`, '자료: 금융감독원 DART(증권신고서 대표주관회사)']));
  return { id: 'strength', title: 'NH투자증권의 강점', prims };
}

// Section 2 ----------------------------------------------------------------------------------
function rates(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const c = callout(78, tx.rates, '기준금리 및 국고채 금리', 150);
  const top = c.bottom + 12;
  const prims: Prim[] = [...header(`${no}. 금리동향 및 전망`, '기준금리 및 국고채 금리', page), ...c.prims];
  const lw = 288;
  prims.push(...goldTitle(top, '주요 금리 현황', X0, X0 + lw, '(단위: %, bp)'));
  const keys = ['base_rate', 'cd91', 'ktb3y', 'ktb5y', 'ktb10y', 'corp3y_aa'];
  const rs = keys.map((k) => d.rates.find((r) => r.key === k)).filter(Boolean) as DeckData['rates'];
  const lrows: (Cell | null)[][] = [
    [TH('구분'), TH('금리'), TH('1개월'), TH('3개월')],
    ...rs.map((r) => [LB(r.label.replace('한국은행 ', '')), TD(r.key === 'base_rate' ? rate2(r.value) : rate3(r.value)), TD(bpS0(r.chg1m)), TD(bpS0(r.chg3m))]),
  ];
  const tTop = top + 20;
  const rh = fitRows(rs.length, tTop + 22, 470, 18, 30);
  prims.push(table(X0, tTop, [96, 64, 64, 64], [22, ...rs.map(() => rh)], lrows, 8.5));

  const rx = X0 + lw + 14;
  const fc = d.forecast;
  if (fc) {
    prims.push(...goldTitle(top, `${fc.house} 리서치 금리 전망 (${yymmdd(fc.published_dt)} 발표)`, rx, X1, '(단위: %)'));
    const periods = fc.rows[0]?.cells.map((x) => x) ?? [];
    const rw = X1 - rx;
    const pw = (rw - 82 - 34) / Math.max(periods.length, 1);
    const frows: (Cell | null)[][] = [
      [TH('구분'), TH('기준'), ...periods.map((p) => TH(p.actual ? `${p.period}\n(실적)` : p.period))],
      ...fc.rows.map((r) => [LB(r.label), TD(r.basis), ...r.cells.map((x) => TD(rate2(x.value).replace('%', ''), { color: x.actual ? C.muted : undefined }))]),
    ];
    const frh = 26;
    prims.push(table(rx, tTop, [82, 34, ...periods.map(() => pw)], [28, ...fc.rows.map(() => frh)], frows, 8.5));
  }
  // 향후 통화정책 일정
  const upcoming = d.events.filter((e) => (e.kind === '금통위' || e.kind === 'FOMC') && (e.end_dt ?? e.event_dt) > d.asof).slice(0, 6);
  if (upcoming.length) {
    const y2 = tTop + (fc ? 28 + fc.rows.length * 26 + 18 : 0);
    prims.push(...goldTitle(y2, '향후 통화정책 일정', rx, X1));
    const urows: (Cell | null)[][] = [
      [TH('구분'), TH('일정'), TH('비고')],
      ...upcoming.map((e) => [LB(e.kind === '금통위' ? '한국 금통위' : '미국 FOMC'), TD(e.kind === 'FOMC' && e.end_dt ? `${mdwY(e.event_dt)}~${md(e.end_dt)}` : mdwY(e.event_dt)), TD(e.note ?? (e.kind === '금통위' ? '통화정책방향 결정' : ''))]),
    ];
    const uh = fitRows(upcoming.length, y2 + 18 + 20, 478, 15, 22);
    prims.push(table(rx, y2 + 18, [100, 130, X1 - rx - 230], [20, ...upcoming.map(() => uh)], urows, 8));
  }
  const base = d.rates.find((r) => r.key === 'base_rate');
  prims.push(...footnote([
    `주1) 금리 현황: ${rateSource(d)}${base ? `, ${yymmdd(base.dt)} 기준` : ''}. 1개월·3개월은 변화폭(bp)`,
    ...(fc ? [`주2) 전망: ${fc.title}. 기준금리는 기말, 국고채는 기간 평균. 발표 이후 금통위 결과는 반영되지 않음`] : []),
  ], 490));
  return { id: 'rates', title: '기준금리·국고채', prims };
}
const rateSource = (d: DeckData) => (d.rates.some((r) => r.source === 'research') ? '한국은행 발표·금융 언론 보도 집계' : '한국은행 ECOS');
const bpS0 = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`);

function corp(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const c = callout(78, tx.corp, '회사채 금리 동향', 130);
  const top = c.bottom + 12;
  const prims: Prim[] = [...header(`${no}. 금리동향 및 전망`, '회사채 금리', page), ...c.prims];
  const lw = 410;
  prims.push(...goldTitle(top, '국고채·회사채 금리 추이 (최근 1년, 월말)', X0, X0 + lw, '(단위: %)'));
  const ss = ['ktb3y', 'ktb10y', 'corp3y_aa'].map((k) => d.series.find((s) => s.key === k)).filter(Boolean) as DeckData['series'];
  if (ss.length) {
    const months = [...new Set(ss.flatMap((s) => s.pts.map((p) => p[0].slice(0, 7))))].sort();
    const colors = [C.th, C.bar, C.yellow];
    const series = ss.map((s, i) => {
      const m = new Map(s.pts.map((p) => [p[0].slice(0, 7), p[1]]));
      return { name: s.label.replace('한국은행 ', ''), color: colors[i] ?? C.blue, values: months.map((x) => m.get(x) ?? null) };
    });
    const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
    const lo = Math.floor(Math.min(...all) * 4) / 4 - 0.25;
    const hi = Math.ceil(Math.max(...all) * 4) / 4;
    prims.push({
      k: 'chart', x: X0, y: top + 22, w: lw, h: 500 - top - 30,
      chart: { kind: 'line', cats: months.map((x) => `${x.slice(2, 4)}.${x.slice(5, 7)}`), series, min: lo, max: hi, step: 0.25, unit: '%', labelEvery: months.length > 8 ? 2 : 1 },
    });
  } else {
    prims.push({ k: 'text', x: X0, y: top + 40, w: lw, h: 40, paras: [P('금리 시계열이 6개월 미만이라 차트를 그리지 않았습니다.')], size: 9, color: C.muted, align: 'c', valign: 'm' });
  }
  const rx = X0 + lw + 14;
  const rw = X1 - rx;
  const g = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const win = recentWindow(d, inp);
  prims.push(...goldTitle(top, `최근 ${win.months}개월 ${g}등급 발행금리`, rx, X1));
  const pool = win.list;
  const rows: (Cell | null)[][] = [[TH('납입일'), TH('발행회사'), TH('등급'), TH('만기'), TH('발행금리')]];
  for (const p of pool.slice(0, 7)) {
    p.tranches.forEach((t, i) => rows.push([
      i ? null : TD(p.deal_dt ? md(p.deal_dt) : '–', { rowspan: p.tranches.length, valign: 'm' }),
      i ? null : TD(p.corp_name, { rowspan: p.tranches.length, valign: 'm', bold: true }),
      i ? null : TD(p.rating ?? '–', { rowspan: p.tranches.length, valign: 'm' }),
      TD(t.tenor), TD(rate3(t.yield_pct)),
    ]));
  }
  if (rows.length === 1) rows.push([TD(`최근 ${win.months}개월 발행 없음`, { colspan: 5 }), null, null, null, null]);
  const body = rows.length - 1;
  const tTop = top + 22;
  const rh = fitRows(body, tTop + 22, 500, 16, 28);
  prims.push(table(rx, tTop, [42, rw - 42 - 44 - 40 - 58, 44, 40, 58], [22, ...rows.slice(1).map(() => rh)], rows, 8));
  prims.push(...footnote([`자료: ${rateSource(d)}(시장금리, 월말 값), 금융감독원 DART(발행조건확정 공시)`]));
  return { id: 'corp', title: '회사채 금리', prims };
}
function addMonths(s: string, n: number) {
  const x = new Date(`${s}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
}

function views(d: DeckData, inp: DeckInput, tx: DeckText, page: number, no: number): Slide {
  const c = callout(78, tx.views, undefined, 100);
  const top = c.bottom + 12;
  const prims: Prim[] = [...header(`${no}. 시장동향`, '금통위 전후 증권사별 기준금리 전망', page), ...c.prims, ...goldTitle(top, '증권사별 국내 기준금리 전망')];
  const vs = [...d.views].sort((a, b) => Number(/NH/.test(b.house)) - Number(/NH/.test(a.house))).slice(0, 9);
  const rows: (Cell | null)[][] = [
    [TH('구분'), TH('Comment'), TH('Analyst'), TH('최종 기준금리'), TH('다음 조정')],
    ...vs.map((v) => {
      const nh = /NH/.test(v.house);
      const f = nh ? 'FFF4D6' : undefined;
      return [LB(v.house, { fill: nh ? 'FCE4A8' : C.label }), cell(`${v.summary} (${yymmdd(v.published_dt)})`, { align: 'l', fill: f, size: 8 }), TD(v.analysts ?? '–', { fill: f, size: 8 }), TD(v.terminal != null ? rate2(v.terminal) : '–', { fill: f, bold: nh }), TD(v.next_move ?? '–', { fill: f, size: 8 })];
    }),
  ];
  const tTop = top + 18;
  const rh = fitRows(vs.length, tTop + 22, 492, 22, 40);
  prims.push(table(X0, tTop, [86, 389, 80, 62, 72], [22, ...vs.map(() => rh)], rows, 8.5));
  const srcs = [...new Map(d.views.map((v) => [v.url, `${v.title} ${yymmdd(v.published_dt)}`])).values()];
  prims.push(...footnote([`주) 기사·세미나 내용을 요약(원문 인용 아님). 자료: ${srcs.join('; ')}`], 496));
  return { id: 'views', title: '증권사별 기준금리 전망', prims };
}

// Appendix: 12개월 달력
function events(d: DeckData, inp: DeckInput, page: number): Slide {
  const start = `${d.asof.slice(0, 7)}-01`;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
  const endM = months[11];
  const title = `Appendix. 주요 이벤트 (${yy(months[0])}~${yy(endM)})`;
  const prims: Prim[] = [...header(title, null, page)];
  const evs = d.events;
  const hol = new Map(d.holidays.map((h) => [h.dt, h.name]));
  const mark = (dt: string) => {
    const e = evs.filter((x) => x.event_dt === dt || (x.kind === 'FOMC' && x.end_dt === dt));
    if (e.some((x) => x.kind === '금통위')) return { fill: C.blue, color: C.white };
    if (e.some((x) => x.kind === 'FOMC' && x.end_dt === dt)) return { fill: C.yellow, color: C.ink };
    if (e.some((x) => x.kind === '정기보고서')) return { fill: C.red, color: C.white };
    return null;
  };
  const gx = X0;
  const gw = 468;
  const mw = (gw - 2 * 10) / 3;
  const mh = (500 - 80 - 3 * 8) / 4;
  months.forEach((m, i) => {
    const x = gx + (i % 3) * (mw + 10);
    const y = 80 + Math.floor(i / 3) * (mh + 8);
    prims.push({ k: 'rect', x, y, w: 30, h: 12, fill: C.th });
    prims.push({ k: 'text', x, y, w: 30, h: 12, paras: [P(`${Number(m.slice(5, 7))}월`)], size: 7, color: C.white, bold: true, align: 'c', valign: 'm', pad: 0 });
    if (m.slice(5, 7) === '01' || i === 0) prims.push({ k: 'text', x: x + 32, y, w: 40, h: 12, paras: [P(m.slice(0, 4))], size: 6.5, color: C.muted, valign: 'm', pad: 0 });
    const first = weekday(m);
    const days = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    const nW = Math.ceil((first + days) / 7);
    const rows: (Cell | null)[][] = [WD.map((w, j) => cell(w, { align: 'c', size: 6, bold: true, color: j === 0 ? C.red : C.sub }))];
    for (let r = 0; r < nW; r++) {
      rows.push(Array.from({ length: 7 }, (_, j) => {
        const n = r * 7 + j - first + 1;
        if (n < 1 || n > days) return TD('', { size: 6 });
        const dt = `${m.slice(0, 8)}${String(n).padStart(2, '0')}`;
        const mk = mark(dt);
        const red = j === 0 || hol.has(dt);
        return TD(String(n), { size: 6, fill: mk?.fill, color: mk?.color ?? (red ? C.red : j === 6 ? C.blue : C.ink), bold: !!mk });
      }));
    }
    const rh = (mh - 14 - 10) / 6;
    const t = table(x, y + 14, Array(7).fill(mw / 7), [10, ...Array(nW).fill(rh)], rows, 6, false);
    t.grid = 'FFFFFF';
    prims.push(t);
  });
  // 범례·목록
  const rx = gx + gw + 14;
  const rw = X1 - rx;
  const legend: [string, string][] = [[C.blue, '금통위(통화정책방향 결정)'], [C.yellow, 'FOMC(미국 시간, 결과 발표일)'], [C.red, '정기보고서 제출기한']];
  legend.forEach(([col, t], i) => {
    prims.push({ k: 'rect', x: rx, y: 82 + i * 13, w: 9, h: 8, fill: col });
    prims.push({ k: 'text', x: rx + 13, y: 80 + i * 13, w: rw - 13, h: 12, paras: [P(t)], size: 7, color: C.ink, valign: 'm', pad: 0 });
  });
  const inWin = (dt: string) => dt >= start && dt < addMonths(start, 12);
  const kr = evs.filter((e) => e.kind === '금통위' && inWin(e.event_dt));
  const us = evs.filter((e) => e.kind === 'FOMC' && inWin(e.event_dt));
  const rp = evs.filter((e) => e.kind === '정기보고서' && inWin(e.event_dt));
  let y = 128;
  const listTable = (title: string, items: [string, string][]) => {
    if (!items.length) return;
    const rows: (Cell | null)[][] = [[TH(title, { colspan: 2, size: 7.5 }), null], ...items.map(([a, b]) => [TD(a, { size: 7 }), TD(b, { size: 7 })])];
    const rh = 12.5;
    prims.push(table(rx, y, [rw * 0.45, rw * 0.55], [14, ...items.map(() => rh)], rows, 7));
    y += 14 + items.length * rh + 10;
  };
  listTable('금통위', kr.map((e) => [mdwY(e.event_dt), e.note ?? '통화정책방향']));
  listTable('FOMC', us.map((e) => [`${md(e.event_dt)}~${md(e.end_dt ?? e.event_dt)}`, e.note ?? '']));
  listTable('정기보고서 제출기한', rp.map((e) => [mdwY(e.event_dt), e.title.replace(' 제출기한', '')]));
  prims.push(...footnote(['자료: 한국은행, 미 연방준비제도(2027년 FOMC는 잠정), 금융감독원(12월 결산법인 기준)']));
  return { id: 'events', title: 'Appendix', prims };
}
const mdwY = (s: string) => `${s.slice(2, 4)}.${md(s)}(${WD[weekday(s)]})`;

// ---------------------------------------------------------------------------------------------
export function buildSlides(d: DeckData, inp: DeckInput, tx: DeckText): Slide[] {
  const on = (id: SlideId) => inp.slides[id] !== false;
  const out: Slide[] = [];
  const page = () => out.length + 1;
  if (on('cover')) out.push(cover(inp));
  // Section 1 번호: 주요 제안 / 발행시기 / 발행전략 / 강점
  const s1Groups: { key: string; label: string; ids: SlideId[] }[] = [
    { key: 'terms', label: '주요 제안', ids: ['terms'] },
    { key: 'timing', label: '발행시기 제안(안)', ids: ['peers', 'compare', 'schedule'] },
    { key: 'struct', label: '발행전략 제안(안)', ids: ['structure'] },
    { key: 'nh', label: 'NH투자증권의 강점', ids: ['strength'] },
  ];
  const s1 = s1Groups.filter((g) => g.ids.some(on));
  const no1 = (id: SlideId) => s1.findIndex((g) => g.ids.includes(id)) + 1;
  if (on('sec1') && s1.length) out.push(divider('sec1', 'Section 1. 공모사채 발행 전략 검토 및 제안', s1.map((g) => g.label)));
  if (on('terms')) out.push(terms(d, inp, tx, page(), no1('terms')));
  if (on('peers')) out.push(peers(d, inp, tx, page(), no1('peers')));
  if (on('compare') && inp.compareKeys.length) out.push(compare(d, inp, tx, page(), no1('compare')));
  if (on('schedule')) out.push(schedule(d, inp, tx, page(), no1('schedule')));
  if (on('structure')) out.push(structure(d, inp, tx, page(), no1('structure')));
  if (on('strength')) out.push(strength(d, inp, tx, page(), no1('strength')));
  const s2Groups: { label: string; ids: SlideId[] }[] = [
    { label: '금리동향 및 전망', ids: ['rates', 'corp'] },
    { label: '시장동향', ids: ['views'] },
    { label: 'Appendix.', ids: ['events'] },
  ];
  const s2 = s2Groups.filter((g) => g.ids.some(on));
  const no2 = (id: SlideId) => s2.filter((g) => !/^Appendix/.test(g.label)).findIndex((g) => g.ids.includes(id)) + 1;
  if (on('sec2') && s2.length) out.push(divider('sec2', 'Section 2. 회사채 시장 동향', s2.map((g) => g.label)));
  if (on('rates')) out.push(rates(d, inp, tx, page(), no2('rates')));
  if (on('corp')) out.push(corp(d, inp, tx, page(), no2('corp')));
  if (on('views') && d.views.length) out.push(views(d, inp, tx, page(), no2('views')));
  if (on('events')) out.push(events(d, inp, page()));
  if (on('back')) out.push(back(inp));
  return out;
}

export { cellBoxes, rich };
export const pageOf = PAGE;
// 내보낼 파일 이름
export const fileBase = (inp: DeckInput) => `NH ${inp.issuer.replace(/[㈜()]/g, '').replace(/^주식회사\s*/, '')} 제${inp.series}회 공모사채 제안서`;
export { korDate, eokW };

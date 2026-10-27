// 장표 레이아웃: 데이터·입력·문안 → 슬라이드 표시 목록 (NH 서식, 공모 회사채 기본형 = CJ프레시웨이 공모사채 제안 2026-03 구성)
// 목차(catalog.ts)에서 켜진 항목만 순서대로 만든다. chrome 은 NH 레이아웃이 그리는 부분(PPTX 에서는 템플릿이 그림).
import type { Subs } from './assemble';
import { ALL_ITEMS, planOf, type ItemId, type Numbered, type Plan } from './catalog';
import {
  bandKind, bandRange, eok, eokW, mdw, rate2, rate3, ratioX, shortFirm, years, yy, yymmdd,
} from './fmt';
import {
  BULLET_INDENT, P, cellBoxes, rich, textHeight, type Cell, type Para, type Prim, type Slide, type SlideLayout, type Table,
} from './model';
import { forecastStale, fullUnder, horizonOf, peerPool, pipelineOf, proposedYears, recentWindow, scheduleOf, tenorText, totalEok, verdictOf } from './rules';
import { TYPE_LABEL, TYPE_ORDER, maturityBuckets, mixOf, pp, quarterOf, spreadVsKtb, tenorMix, typedIssues } from './analytics';
import { dataReport, STATUS_LABEL } from './sources';
import { parseTsv } from './tsv';
import { WD, korDate, md, weekday } from './schedule';
import { C, PAGE, textW } from './theme';
import type { DeckData, DeckInput, DeckText, MeetingPanel, PeerIssue } from './types';

const X0 = 47;
const X1 = 736;
const CW = X1 - X0;
const BOTTOM = 500;

// ---------------------------------------------------------------------------------------------
// 공통 요소
const paras = (s: string, o: Omit<Para, 'runs'> = {}) => s.split('\n').map((l) => P(l, o));
const cell = (s: string, o: Partial<Cell> = {}): Cell => ({ paras: paras(s), ...o });

// 레이아웃이 그리는 부분(미리보기·PDF 용). 그림은 NH 템플릿 레이아웃을 그대로 렌더링한 것(public/deck/layout).
const layoutBg = (name: SlideLayout): Prim => ({ k: 'img', x: 0, y: 0, w: PAGE.w, h: PAGE.h, src: `/deck/layout/${name}.jpg` });
const pageNo = (page: number): Prim => ({ k: 'text', x: 690.5, y: 508.9, w: 60, h: 17.5, paras: [P(String(page))], size: 9, color: C.ink, bold: true, align: 'r', valign: 'm', pad: 0 });
function bodyChrome(page: number): Prim[] {
  return [layoutBg('body'), pageNo(page)];
}

// 쪽 제목 (템플릿 위치: 58.4, 28.4)
function titleBox(head: string, sub: string | null, cont = false): Prim {
  const runs = [{ t: head, size: 20 }, ...(sub ? [{ t: `_${sub}`, size: 15 }] : []), ...(cont ? [{ t: '(계속)', size: 15 }] : [])];
  return { k: 'text', x: 58.4, y: 28.4, w: 600, h: 39.7, paras: [{ runs }], size: 20, color: C.ink, xb: true, valign: 'm', pad: 0 };
}

// 요약 상자: 첫 줄 headline(굵게, 글머리 없음) + 글머리 목록. 높이는 글 양에 맞춘다.
function callout(y: number, lines: string[], headline?: string, maxH = 150, x0 = X0, x1 = X1): { prims: Prim[]; bottom: number } {
  if (!lines.length && !headline) return { prims: [], bottom: y };
  const w = x1 - x0;
  let size = 9.5;
  const pad = 9;
  const build = (sz: number) => [
    ...(headline ? [P(headline, {}, { b: true })] : []),
    ...lines.map((l, i) => P(l, { bullet: true, gap: headline || i ? Math.round(sz * 0.5) : 0 })),
  ];
  let ps = build(size);
  let h = textHeight(ps, w - pad * 2, size, false, 1.32, BULLET_INDENT(size)) + pad * 2;
  while (h > maxH && size > 7.5) {
    size -= 0.5;
    ps = build(size);
    h = textHeight(ps, w - pad * 2, size, false, 1.32, BULLET_INDENT(size)) + pad * 2;
  }
  return {
    prims: [
      { k: 'rect', x: x0, y, w, h, fill: C.label },
      { k: 'text', x: x0, y, w, h, paras: ps, size, color: C.ink, valign: 'm', pad, line: 1.32 },
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

function footnote(lines: string[], y = 504): Prim[] {
  if (!lines.length) return [];
  return [{ k: 'text', x: X0, y, w: 630, h: 28, paras: lines.map((l) => P(l)), size: 6.5, color: C.muted, valign: 't', pad: 0, line: 1.25 }];
}

const TH = (s: string, o: Partial<Cell> = {}): Cell => cell(s, { fill: C.th, color: C.white, bold: true, align: 'c', ...o });
const LB = (s: string, o: Partial<Cell> = {}): Cell => cell(s, { fill: C.label, bold: true, align: 'c', ...o });
const TD = (s: string, o: Partial<Cell> = {}): Cell => cell(s, { align: 'c', ...o });

function table(x: number, y: number, colW: number[], rowH: number[], rows: (Cell | null)[][], size = 9, gridV = true): Table {
  return { k: 'table', x, y, colW, rowH, rows, size, color: C.ink, grid: C.grid, gridV };
}
const fitRows = (n: number, top: number, bottom: number, min: number, max: number) => (n ? Math.max(min, Math.min(max, (bottom - top) / n)) : 0);
const note = (s: string): Cell => (s ? { paras: s.split('\n').filter(Boolean).map((x) => P(x, { bullet: true })), align: 'l', valign: 'm' } : TD(''));

type Ctx = { d: DeckData; inp: DeckInput; tx: DeckText; plan: Plan };
type Body = { id: string; title: string; prims: Prim[] };
const body = (b: Body, page: number): Slide => ({ id: b.id, title: b.title, layout: 'body', chrome: bodyChrome(page), prims: b.prims });

// ---------------------------------------------------------------------------------------------
// 표지·목차·간지·뒷표지 (레이아웃 장식은 chrome)
function cover(inp: DeckInput): Slide {
  const title = inp.coverTitle || `${inp.issuer} 공모사채 발행 검토 및 제안`;
  let size = 28;
  while (size > 18 && textW(title, size, true) > 690) size -= 1;
  return {
    id: 'cover', title: '표지', layout: 'cover', bg: C.blue,
    chrome: [layoutBg('cover')],
    prims: [
      { k: 'text', x: 72.9, y: 55, w: 220, h: 21.8, paras: [P('Beyond the First')], size: 18, color: C.white, xb: true, pad: 0, valign: 'm' },
      { k: 'text', x: 61.4, y: 116.9, w: 697, h: 45.5, paras: [P(title)], size, color: C.white, bold: true, valign: 'b', pad: 0 },
      { k: 'text', x: 61.1, y: 190.6, w: 200, h: 21.8, paras: [P(inp.month)], size: 18, color: C.white, xb: true, pad: 0, valign: 'm' },
    ],
  };
}

// 목차: 장(1. 발행 제안 …)과 Appendix 장표를 한 줄씩. 줄이 많으면 글자를 줄인다.
function contents(plan: Plan): Slide {
  const items = [
    ...plan.sections.filter((s) => !s.appendix).map((s) => `${s.no}. ${s.label}`),
    ...plan.sections.filter((s) => s.appendix).flatMap((s) => s.items.map((i) => i.head)),
  ];
  const size = items.length > 9 ? 13 : items.length > 7 ? 15 : items.length > 5 ? 17 : 20;
  return {
    id: 'contents', title: 'Contents', layout: 'contents',
    chrome: [layoutBg('contents')],
    prims: [
      { k: 'text', x: 54.2, y: 120.3, w: 200, h: 38.8, paras: [P('Contents')], size: 32, color: '333333', bold: true, pad: 0, valign: 'm' },
      { k: 'text', x: 89.5, y: 173.6, w: 600, h: 340, paras: items.map((t, i) => ({ runs: [{ t }], gap: i ? Math.round(size * 0.3) : 0 })), size, color: '333333', bold: true, pad: 0, line: 1.9 },
    ],
  };
}

function back(inp: DeckInput): Slide {
  const contacts = inp.contacts.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5);
  return {
    id: 'back', title: '뒷표지', layout: 'back', bg: C.blue,
    chrome: [layoutBg('back')],
    prims: [
      ...(inp.dept ? [{ k: 'text', x: 50, y: 420, w: 500, h: 24, paras: [P(inp.dept)], size: 15, color: C.white, xb: true, pad: 0, valign: 'm' } as Prim] : []),
      ...(contacts.length ? [{ k: 'text', x: 50, y: 452, w: 500, h: 70, paras: contacts.map((c) => P(c)), size: 8.5, color: C.white, pad: 0, line: 1.6 } as Prim] : []),
    ],
  };
}

// 템플릿 고정 장표: 미리보기·PDF 는 그림 + 쪽 제목·쪽번호를 다시 그린다
const STATIC: Record<string, { files: string[]; images: string[]; layout: SlideLayout }> = {
  ceo: { files: ['ppt/slides/slide2.xml'], images: ['ceo'], layout: 'ceo' },
  ir: { files: ['ppt/slides/slide21.xml', 'ppt/slides/slide22.xml', 'ppt/slides/slide23.xml'], images: ['ir1', 'ir2', 'ir3'], layout: 'body' },
  nh_company: { files: ['ppt/slides/slide25.xml', 'ppt/slides/slide26.xml'], images: ['nh1', 'nh2'], layout: 'body' },
  nh_core: { files: ['ppt/slides/slide27.xml'], images: ['core'], layout: 'body' },
  nh_scope: { files: ['ppt/slides/slide28.xml'], images: ['scope'], layout: 'body' },
  nh_org: { files: ['ppt/slides/slide31.xml'], images: ['org'], layout: 'body' },
};
function staticSlides(id: ItemId, n: Numbered | null, nextPage: () => number): Slide[] {
  const st = STATIC[id];
  return st.files.map((file, i) => {
    const page = nextPage();
    const img: Prim = { k: 'img', x: 0, y: 0, w: PAGE.w, h: PAGE.h, src: `/deck/static/${st.images[i]}.jpg` };
    if (st.layout !== 'body' || !n) {
      return { id: `${id}-${i}`, title: n?.title ?? 'CEO MESSAGE', layout: st.layout, chrome: [img], prims: [], static: { file } };
    }
    // 그림 속 원래 쪽 제목·쪽번호를 덮고 다시 쓴다(로고·머리띠는 그대로)
    const cover: Prim[] = [{ k: 'rect', x: 40, y: 22, w: 575, h: 45.5, fill: C.band }, { k: 'rect', x: 680, y: 505, w: 75, h: 22, fill: C.white }];
    const no = n.head.match(/^(\d+)\./)?.[1] ?? null;
    return {
      id: `${id}-${i}`, title: n.title, layout: 'body', static: { file, renumber: no ? `${no}.` : null },
      chrome: [img, ...cover, pageNo(page)],
      prims: [titleBox(n.head, n.sub ?? (id === 'ir' ? '① IR 및 수요예측 전략' : null), i > 0)],
    };
  });
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// 내부 데이터 표(사내 연계, 프로토타입은 붙여넣기)를 그대로 그린다
export { parseTsv };
function pastedTable(x: number, y: number, w: number, maxH: number, grid: string[][], size = 7.5): Prim[] {
  if (!grid.length) return [];
  const n = grid[0].length;
  const first = Math.min(110, w * 0.24);
  const colW = [first, ...Array(n - 1).fill((w - first) / Math.max(1, n - 1))];
  const rh = Math.max(11, Math.min(20, (maxH - 18) / Math.max(1, grid.length - 1)));
  const rows: (Cell | null)[][] = grid.map((r, i) => r.map((c, j) => (i === 0 ? TH(c, { size }) : j === 0 ? LB(c, { size }) : TD(c, { size }))));
  return [table(x, y, colW, [18, ...grid.slice(1).map(() => rh)], rows, size)];
}

// I-1. 발행조건 제안(案)
function terms({ d, inp, tx }: Ctx, n: Numbered): Body {
  const sch = scheduleOf(d, inp);
  const c = callout(78, [tx.lead, ...tx.structure.slice(0, 2)], undefined, 80);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, '주요 발행 조건 제안(案)')];
  const tr = inp.tranches.filter((t) => t.tenor);
  const nt = tx.termNotes;
  const bandOne = inp.band.type === 'later'
    ? '^^추후 결정^^'
    : inp.band.type === 'fixed' ? `고정금리 ${inp.band.low ?? '–'}% ~ ${inp.band.high ?? '–'}%` : `개별민평 ${inp.band.low ?? '–'}bp ~ +${inp.band.high ?? '–'}bp`;
  const fee = [
    ...(inp.feeLead != null ? [`대표주관수수료 ${inp.feeLead}bp`] : []),
    inp.feeUw != null ? `인수수수료 ${inp.feeUw}bp` : '인수수수료 협의',
    ...(inp.feeLead == null ? ['대표주관수수료 협의'] : []),
  ].join(' / ');
  const multi = tr.length > 1;
  const rows: (Cell | null)[][] = [[TH('구분', { colspan: 2 }), null, TH('주요 내용'), TH('비고')]];
  rows.push([LB('발행회사', { colspan: 2 }), null, TD(inp.issuer || d.company.corp_name), TD('')]);
  rows.push([LB('신용등급', { colspan: 2 }), null, TD(inp.rating || '–'), note(nt.rating)]);
  rows.push([LB('만기', { colspan: 2 }), null, TD(`^^${tenorText(inp) || '–'}^^`), note(nt.tenor)]);
  if (multi) {
    const span = tr.length + 1 + (inp.maxEok ? 1 : 0);
    tr.forEach((t, i) => rows.push([
      i ? null : LB('발행금액', { rowspan: span, valign: 'm' }), LB(t.tenor), TD(`^^${t.eok != null ? `${t.eok.toLocaleString('ko-KR')}억원` : '–'}^^`),
      i ? null : { ...note(nt.amount), rowspan: span },
    ]));
    rows.push([null, LB('합계'), TD(`^^${totalEok(inp) ? `${totalEok(inp).toLocaleString('ko-KR')}억원` : '–'}^^`, { bold: true }), null]);
    if (inp.maxEok) rows.push([null, LB('증액옵션'), TD(`^^Max ${inp.maxEok.toLocaleString('ko-KR')}억원^^`), null]);
  } else {
    rows.push([LB('발행금액', { colspan: 2 }), null, TD(`^^${totalEok(inp) ? `${totalEok(inp).toLocaleString('ko-KR')}억원` : '–'}^^${inp.maxEok ? `\n(증액 시 Max ${inp.maxEok.toLocaleString('ko-KR')}억원)` : ''}`), note(nt.amount)]);
  }
  if (multi && inp.band.type !== 'later') {
    tr.forEach((t, i) => rows.push([
      i ? null : LB('금리 밴드', { rowspan: tr.length, valign: 'm' }), LB(t.tenor), TD(bandOne),
      i ? null : { ...note(nt.band), rowspan: tr.length },
    ]));
  } else rows.push([LB('금리 밴드', { colspan: 2 }), null, TD(bandOne), note(nt.band)]);
  rows.push([LB('이자지급', { colspan: 2 }), null, TD(inp.coupon), note(nt.coupon)]);
  rows.push([LB('수요예측일', { colspan: 2 }), null, TD(sch ? `^^${mdw(sch.demand)}^^` : '–'), note(nt.demand)]);
  rows.push([LB('발행일', { colspan: 2 }), null, TD(sch ? `^^${mdw(sch.pay)}^^` : '–'), note(nt.pay)]);
  rows.push([LB('인수희망금액', { colspan: 2 }), null, TD(inp.uw), note(nt.uw)]);
  rows.push([LB('수수료', { colspan: 2 }), null, TD(fee), note(nt.fee)]);
  const tTop = top + 16;
  const rh = fitRows(rows.length - 1, tTop + 22, BOTTOM, 17, 30);
  prims.push(table(X0, tTop, [107.7, 107.7, 215.3, 258.3], [22, ...rows.slice(1).map(() => rh)], rows, rows.length > 13 ? 8.5 : 9));
  return { id: 'terms', title: n.title, prims };
}

// 수요예측 결과 금액: 밴드 내 / 총참여. 밴드 내 금액이 총참여보다 크면(공시 파싱 오류) 총참여만
const demOf = (t: { in_band_krw?: number | null; demand_krw?: number | null } | null | undefined) => {
  if (!t || (t.in_band_krw == null && t.demand_krw == null)) return '–';
  // 밴드 내 금액이 총참여와 같으면(대부분) 총참여만, 다를 때만 '밴드내/총'. 밴드 내가 더 크면(공시 파싱 오류) 총참여만
  if (t.in_band_krw == null || t.demand_krw == null || t.in_band_krw >= t.demand_krw) return eok(t.demand_krw ?? t.in_band_krw);
  return `${eok(t.in_band_krw)}/${eok(t.demand_krw)}`;
};
const bpSign = (v: number | null | undefined) => (v == null ? '–' : v === 0 ? 'Par' : `${v > 0 ? '+' : ''}${v}`);

// 1-② 트랜치 검토: 왼쪽 = 같은 등급 만기별 발행 비중(등급 관행) + 회사 최근 발행 결과, 오른쪽 = 금리(민평) + 회사 만기분포
function sizing({ d, inp, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.sizing, undefined, 112);
  const top = c.bottom + 8;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const name = d.company.corp_name;
  const scope = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const lw = 452;

  // 왼쪽 위: 같은 등급 만기별 발행 비중 (가로 표: 만기가 열)
  const tm = tenorMix(peerPool(d, inp.peerScope));
  prims.push(...goldTitle(top, `최근 1년 ${scope}등급 공모 회사채 만기별 발행 비중`, X0, X0 + lw, '(단위: 억원, %)'));
  let y1 = top + 18;
  if (tm.total) {
    const cols = tm.rows.length > 7 ? [...tm.rows].sort((a, b) => b.amount - a.amount).slice(0, 7).sort((a, b) => a.years - b.years) : tm.rows;
    const hot = new Set(tm.top2.map((x) => x.k));
    const wl = 58;
    const wc = (lw - wl) / (cols.length + 1);
    const hl = (k: string) => (hot.has(k) ? { fill: 'FFF4D6', bold: true } : {});
    const rows: (Cell | null)[][] = [
      [TH('만기', { size: 7.5 }), ...cols.map((x) => TH(x.k, { size: 7.5 })), TH('합계', { size: 7.5 })],
      [LB('발행금액', { size: 7.5 }), ...cols.map((x) => TD(eok(x.amount), { size: 7.5, ...hl(x.k) })), TD(eok(tm.total), { size: 7.5, bold: true })],
      [LB('비중', { size: 7.5 }), ...cols.map((x) => TD(`${x.share.toFixed(1)}%`, { size: 7.5, ...hl(x.k) })), TD('100%', { size: 7.5 })],
    ];
    prims.push(table(X0, y1, [wl, ...cols.map(() => wc), wc], [16, 15, 15], rows, 7.5));
    y1 += 46 + 4;
    prims.push({ k: 'text', x: X0, y: y1, w: lw, h: 10, paras: [P(`최근 1년 수요예측을 마친 ${tm.issues}건 기준(발행금액). 강조는 비중 상위 두 만기(합계 ${tm.top2Share.toFixed(1)}%)`)], size: 6.5, color: C.muted, pad: 0 });
    y1 += 16;
  } else {
    prims.push({ k: 'text', x: X0, y: y1, w: lw, h: 24, paras: [P(`최근 1년 ${scope}등급 수요예측 사례가 없습니다.`)], size: 8.5, color: C.muted, align: 'c', valign: 'm' });
    y1 += 30;
  }

  // 왼쪽 아래: 회사 최근 발행 결과 (트랜치별)
  prims.push(...goldTitle(y1, `${name} 최근 공모사채 발행 결과`, X0, X0 + lw, '(단위: 억원, %, bp)'));
  const tTop = y1 + 18;
  const minRh = 12.5;
  const capRows = Math.max(1, Math.floor((BOTTOM - tTop - 24) / minRh));
  const own: PeerIssue[] = [];
  let trCount = 0;
  for (const p of d.own) {
    if (own.length >= 4 || trCount + Math.max(1, p.tranches.length) > Math.min(9, capRows)) break;
    own.push(p);
    trCount += Math.max(1, p.tranches.length);
  }
  const rows: (Cell | null)[][] = [[TH('회차'), TH('수요예측'), TH('만기'), TH('신고'), TH('참여\n(밴드내/총)'), TH('경쟁률'), TH('결정\n조건'), TH('국고\n대비'), TH('발행'), TH('발행금리')]];
  for (const p of own) {
    const trs = p.tranches.length ? p.tranches : [null];
    trs.forEach((t, i) => {
      const sp = t ? spreadVsKtb(d, p, t) : null;
      rows.push([
        i ? null : TD(`제${p.series ?? ''}회`, { rowspan: trs.length, valign: 'm', bold: true }),
        i ? null : TD(p.demand_dt ? yymmdd(p.demand_dt) : yy(p.deal_dt), { rowspan: trs.length, valign: 'm' }),
        TD(t?.tenor ?? '–'), TD(eok(t?.initial_krw)),
        TD(demOf(t)),
        TD((t?.under || (t?.ratio != null && t.ratio < 1)) ? `!!${ratioX(t?.ratio)}!!` : ratioX(t?.ratio)),
        TD(bpSign(t?.spread_bp)), TD(sp == null ? '–' : String(sp)),
        TD(eok(t?.amount_krw)), TD(rate3(t?.yield_pct)),
      ]);
    });
  }
  if (rows.length === 1) rows.push([TD('공모 회사채 발행 이력 없음', { colspan: 10 }), null, null, null, null, null, null, null, null, null]);
  // 국고 대비(일별 국고채 금리 필요)가 모두 비면 열을 뺀다
  const hasKtb = own.some((p) => p.tranches.some((t) => spreadVsKtb(d, p, t) != null));
  const rowsOwn = hasKtb ? rows : rows.map((r) => r.filter((_, k) => k !== 7));
  const rh1 = Math.min(16, Math.max(minRh, (BOTTOM - tTop - 24) / Math.max(1, rows.length - 1)));
  const colW1 = hasKtb ? [38, 44, 32, 38, 62, 46, 36, 36, 38, 0] : [40, 46, 34, 40, 66, 48, 40, 42, 0];
  colW1[colW1.length - 1] = lw - colW1.reduce((a, b) => a + b, 0);
  prims.push(table(X0, tTop, colW1, [24, ...rowsOwn.slice(1).map(() => rh1)], rowsOwn, 7));

  // 오른쪽 위: 개별민평(내부 데이터) 또는 국고채·회사채 금리 현황(ECOS)
  const rx = X0 + lw + 14;
  const rw = X1 - rx;
  const mp = parseTsv(inp.internal?.minpyeong ?? '');
  let ry = top;
  if (mp.length >= 2) {
    prims.push(...goldTitle(ry, '개별민평 Spread 현황', rx, X1, '(내부 데이터)'));
    prims.push(...pastedTable(rx, ry + 18, rw, 110, mp, 7));
    ry += 18 + 18 + (mp.length - 1) * Math.max(11, Math.min(20, (110 - 18) / Math.max(1, mp.length - 1))) + 10;
  } else {
    prims.push(...goldTitle(ry, '국고채·회사채 금리 현황', rx, X1, '(단위: %, bp)'));
    // BBB- 행은 BBB 이하 발행사만
    const lowGrade = /^BBB|^BB|^B/.test(d.company.rating_group ?? '');
    const keys: [string, string][] = [['ktb2y', '국고채 2년'], ['ktb3y', '국고채 3년'], ['ktb5y', '국고채 5년'], ['corp3y_aa', '회사채 3년 AA-'], ...(lowGrade ? [['corp3y_bbb', '회사채 3년 BBB-'] as [string, string]] : [])];
    const rs = keys.map(([k, l]) => ({ l, r: d.rates.find((x) => x.key === k) })).filter((x) => x.r);
    const k3 = d.rates.find((x) => x.key === 'ktb3y');
    const rrows: (Cell | null)[][] = [
      [TH('구분'), TH('금리'), TH('1개월'), TH('국고 3년\n대비')],
      ...rs.map(({ l, r }) => [LB(l, { size: 7 }), TD(rate3(r!.value), { size: 7 }), TD(bpS0(r!.chg1m), { size: 7 }), TD(/회사채/.test(l) && k3 ? String(Math.round((r!.value - k3.value) * 100)) : '–', { size: 7 })]),
    ];
    prims.push(table(rx, ry + 18, [rw * 0.38, rw * 0.22, rw * 0.18, rw * 0.22], [22, ...rs.map(() => 14)], rrows, 7));
    const base = rs[0]?.r;
    if (base) prims.push({ k: 'text', x: rx, y: ry + 18 + 22 + rs.length * 14 + 1, w: rw, h: 10, paras: [P(`${yymmdd(base.dt)} 기준. 자료: 한국은행 ECOS`)], size: 6, color: C.muted, align: 'r', pad: 0 });
    ry += 18 + 22 + rs.length * 14 + 16;
  }
  // 오른쪽 아래: 회사 공모채 만기분포(올해·내년 반기, 이후 연) + 만기도래 없는 해
  prims.push(...goldTitle(ry, `${name} 공모사채 만기분포`, rx, X1, '(단위: 억원)'));
  const mb = maturityBuckets(d, horizonOf(inp));
  if (mb.buckets.some((b) => b.amount)) {
    // 제안 트랜치가 만기되는 해에 기존 만기도래가 없을 때만 적는다
    const py = proposedYears(inp);
    const gaps = mb.gaps.filter((y) => py.includes(y));
    const gapNote = gaps.length ? `제안 만기 ${gaps.map((y) => `'${y.slice(2)}년`).join('·')} 만기도래 없음` : '';
    if (gapNote) prims.push({ k: 'text', x: rx, y: ry + 16, w: rw, h: 11, paras: [P(`!!${gapNote}!!`)], size: 7.5, color: C.ink, align: 'r', pad: 0 });
    prims.push({
      k: 'chart', x: rx + 2, y: ry + 28, w: rw - 4, h: Math.max(80, BOTTOM - ry - 30),
      chart: {
        kind: 'bar', cats: mb.buckets.map((b) => b.label), values: mb.buckets.map((b) => Math.round(b.amount / 1e8)),
        labels: mb.buckets.map((b) => (b.amount ? Math.round(b.amount / 1e8).toLocaleString('ko-KR') : '')),
        highlight: [], color: C.th, hiColor: C.yellow,
      },
    });
  } else {
    prims.push({ k: 'text', x: rx, y: ry + 40, w: rw, h: 30, paras: [P('향후 5년 내 만기 도래 공모사채 없음')], size: 9, color: C.muted, align: 'c', valign: 'm' });
  }
  prims.push(...footnote(['주) 만기별 비중은 같은 등급(노치 선택 시 노치) 일반 공모 회사채 발행금액 기준. 결정조건은 확정 가산금리(민평 대비, bp), 국고 대비는 발행금리 − 수요예측일 같은 만기 국고채(bp).', '자료: 금융감독원 DART, 한국은행 ECOS']));
  return { id: 'sizing', title: n.title, prims };
}

// I-3. 회사채 발행 일정 검토
function schedule({ d, inp, tx }: Ctx, n: Numbered): Body {
  const sch = scheduleOf(d, inp);
  const c = callout(78, tx.schedule, undefined, 110);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, '발행 일정(안)')];
  if (!sch) return { id: 'schedule', title: n.title, prims };
  const tTop = top + 18;
  const calW = 549;
  const colW = Array(5).fill(calW / 5);
  const rows: (Cell | null)[][] = [WD.slice(1, 6).map((w) => cell(w, { fill: C.band, bold: true, align: 'c' }))];
  const rowH = [16];
  const weeks = sch.weeks;
  const contentH = Math.max(22, Math.min(46, (BOTTOM - tTop - 16) / weeks.length - 16));
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
        for (const l of s.label.split('\n')) ps.push({ runs: [{ t: l, b: s.kind !== 'event', color }] });
        if (s.kind === 'pay') fill = C.green;
        if (s.kind === 'demand' && s.label === '수요예측') fill = 'E3F1FA';
        if (s.kind === 'holiday') fill = 'FBE9E7';
      }
      return { paras: ps, align: 'c', valign: 'm', fill, size: 8 };
    }));
    rowH.push(contentH);
  }
  prims.push(table(X0, tTop, colW, rowH, rows, 8));
  const nx = X0 + calW + 11;
  const nw = X1 - nx;
  const notes = [
    ['대표주관계약 체결', '「증권인수업무규정」에 따라 증권신고서 제출 10영업일 前 계약 체결 필요'],
    ['대표주관계약 체결 통보', '「증권인수업무규정」에 따라 계약 체결 5영업일 內 금융투자협회에 통보 필요(발행정보가 시장에 Open)'],
    ['증권신고서 제출', '「자본시장법」에 따라 발행일 8영업일 前 제출'],
    ['수요예측', '수요예측 결과 반영 정정증권신고서는 발행일 4영업일 前 제출 필요. 이를 감안해 발행일 5~6영업일 前 실시가 일반적'],
    ['정정증권신고서 제출', '수요예측 결과 반영 및 최종 발행금리 확정 공시'],
  ];
  const nps: Para[] = notes.flatMap(([t, s], i) => [{ runs: [{ t: `• ${t}` }], gap: i ? 7 : 0 }, { runs: [{ t: `- ${s}`, color: C.sub }] }]);
  const nh = Math.min(BOTTOM - tTop, Math.max(rowH.reduce((a, b) => a + b, 0), 240));
  prims.push({ k: 'rect', x: nx, y: tTop, w: nw, h: nh, fill: 'FAFAFA', stroke: '9E9E9E', sw: 0.5, dash: true });
  prims.push({ k: 'text', x: nx, y: tTop, w: nw, h: nh, paras: nps, size: 7.5, color: C.ink, valign: 'm', pad: 7, line: 1.3 });
  prims.push(...footnote(['주) 영업일은 주말·관공서 공휴일·채권시장 휴장일(12/31) 제외. 금통위·FOMC 일정은 한국은행·미 연준 발표 기준.']));
  return { id: 'schedule', title: n.title, prims };
}

// I-4. Sales 전략: 투자자 구분별 참여(공시) + 기관별 내역(내부 자료 붙여넣기)
function sales({ d, inp, tx }: Ctx, n: Numbered): Body {
  const name = d.company.corp_name;
  const grp = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const c = callout(78, tx.sales, undefined, 100);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const inv = parseTsv(inp.internal?.investors ?? '');
  const bottomH = inv.length >= 2 ? Math.min(150, 34 + (inv.length - 1) * 13) : 0;
  const tableBottom = BOTTOM - (bottomH ? bottomH + 8 : 0);

  // 왼쪽: 회사 최근 4회 (만기별)
  const lw = 400;
  prims.push(...goldTitle(top, `${name} 최근 수요예측 투자자 구분별 참여`, X0, X0 + lw, '(단위: 억원, %)'));
  const typed = typedIssues(d.own, 4);
  const trs = typed.trs;
  // 만기가 4개 이상이면 참여금액 상위 3개 만기만 열로 두고 나머지는 '그 외'로 묶는다(합계가 맞게)
  const yrs = (k: string) => Number(k.match(/[\d.]+/)?.[0] ?? 99);
  const qOf = (k: string) => mixOf(trs.filter((t) => t.tenor === k)).total;
  const allTenors = [...new Set(trs.map((t) => t.tenor))];
  const shownTenors = (allTenors.length > 3 ? [...allTenors].sort((a, b) => qOf(b) - qOf(a)).slice(0, 3) : allTenors).sort((a, b) => yrs(a) - yrs(b));
  const restTrs = trs.filter((t) => !shownTenors.includes(t.tenor));
  const all = mixOf(trs);
  const per = [
    ...shownTenors.map((k) => ({ k, m: mixOf(trs.filter((t) => t.tenor === k)) })),
    ...(restTrs.length ? [{ k: '그 외', m: mixOf(restTrs) }] : []),
  ];
  if (all.total) {
    // 만기가 하나면 '전체' 열은 같은 값이라 뺀다
    const groups = [...per.map((x) => ({ label: x.k, m: x.m })), ...(per.length > 1 ? [{ label: '전체', m: all }] : [])];
    const rows: (Cell | null)[][] = [
      [TH('구분', { rowspan: 2 }), ...groups.flatMap((g) => [TH(g.label, { colspan: 2 }), null])],
      [null, ...groups.flatMap(() => [TH('금액', { size: 7 }), TH('비중', { size: 7 })])],
      ...all.rows.map((r) => [LB(r.label, { size: 7 }), ...groups.flatMap((g) => {
        const x = g.m.rows.find((y) => y.t === r.t);
        return [TD(eok(x?.q ?? 0), { size: 7 }), TD(x ? `${x.share.toFixed(1)}%` : '–', { size: 7 })];
      })]),
      [LB('합계', { size: 7, fill: 'E7EEF6' }), ...groups.flatMap((g) => [TD(eok(g.m.total), { size: 7, bold: true, fill: 'E7EEF6' }), TD('100%', { size: 7, fill: 'E7EEF6' })])],
    ];
    const wl = 92;
    const wc = (lw - wl) / (groups.length * 2);
    const rh = fitRows(rows.length - 2, top + 18 + 32, tableBottom, 14, 22);
    prims.push(table(X0, top + 18, [wl, ...groups.flatMap(() => [wc, wc])], [16, 16, ...rows.slice(2).map(() => rh)], rows, 7));
  } else {
    prims.push({ k: 'text', x: X0, y: top + 40, w: lw, h: 30, paras: [P('투자자 구분별 참여 내역이 아직 수집되지 않았습니다(정정신고서 원문 파싱 후 채워짐).')], size: 8.5, color: C.muted, align: 'c', valign: 'm' });
  }

  // 오른쪽: 같은 등급 최근 1년과 비교
  const rx = X0 + lw + 14;
  const rw = X1 - rx;
  const peerMix = mixOf(peerPool(d, inp.peerScope).flatMap((p) => p.tranches));
  prims.push(...goldTitle(top, `최근 1년 ${grp}등급 참여 구성 비교`, rx, X1, '(단위: 억원, %)'));
  if (peerMix.total) {
    const rows: (Cell | null)[][] = [
      [TH('구분'), TH(`${grp}등급\n금액`), TH('비중'), TH(`${name}\n비중`), TH('차이\n(%p)')],
      ...peerMix.rows.map((r) => {
        const o = all.rows.find((x) => x.t === r.t)?.share ?? 0;
        const gap = o - r.share;
        return [LB(r.label, { size: 7 }), TD(eok(r.q), { size: 7 }), TD(`${r.share.toFixed(1)}%`, { size: 7 }), TD(all.total ? `${o.toFixed(1)}%` : '–', { size: 7 }), TD(all.total ? pp(gap) : '–', { size: 7, color: gap <= -5 ? C.red : undefined, bold: gap <= -5 })];
      }),
    ];
    const rh = fitRows(rows.length - 1, top + 18 + 26, tableBottom, 14, 24);
    prims.push(table(rx, top + 18, [rw * 0.34, rw * 0.2, rw * 0.14, rw * 0.16, rw * 0.16], [26, ...rows.slice(1).map(() => rh)], rows, 7));
  }

  if (bottomH) {
    const by = BOTTOM - bottomH;
    prims.push(...goldTitle(by, '기관별 수요예측 참여·배정 내역', X0, X1, '(내부 자료)'));
    prims.push(...pastedTable(X0, by + 18, CW, bottomH - 18, inv, 7));
  }
  prims.push(...footnote([`주) ${typed.label ? `${name} ${typed.label} 기준. ` : ''}투자자 구분은 발행조건확정 증권신고서(정정)의 수요예측 참여 내역 기준(운용사(집합)은 투자일임·집합투자재산). 배정 내역은 공시에 기관 합계만 있어 내부 자료로 보완.`, '자료: 금융감독원 DART']));
  return { id: 'sales', title: n.title, prims };
}

// I-5. 회사채 수요예측 예정 내역
function pipeline({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.pipeline, undefined, 80);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, `${yymmdd(d.asof)} 현재 회사채 발행 예정 내역`, X0, X1, '(단위: 억원, bp)')];
  const rows: (Cell | null)[][] = [[TH('발행회사'), TH('등급'), TH('만기'), TH('예측금액'), TH('증액\n가능금액'), TH('구분'), TH('공모밴드'), TH('수요예측'), TH('납입'), TH('대표주관')]];
  for (const p of pipelineOf(d).slice(0, 10)) {
    const trs = p.tranches.length ? p.tranches : [{ tenor: '–', months: null, initial_krw: null, band_type: p.band_type, band_low: p.band_low, band_high: p.band_high }];
    trs.forEach((t, i) => rows.push([
      i ? null : TD(p.corp_name + (p.sub_type && p.sub_type !== '일반회사채' ? `\n(${p.sub_type})` : ''), { rowspan: trs.length, valign: 'm', bold: true }),
      i ? null : TD(p.rating ?? '–', { rowspan: trs.length, valign: 'm' }),
      TD(t.tenor), TD(eok(t.initial_krw)),
      i ? null : TD(p.amount_max_krw ? eok(p.amount_max_krw) : '–', { rowspan: trs.length, valign: 'm' }),
      TD(t.band_low != null ? bandKind(t.band_type) : '미정', { bold: true }), TD(t.band_low != null ? bandRange(t) : '미정'),
      i ? null : TD(p.demand_dt ? `${mdw(p.demand_dt)}${p.demand_dt < d.asof ? '\n(완료)' : ''}` : '–', { rowspan: trs.length, valign: 'm' }),
      i ? null : TD(p.pay_dt ? mdw(p.pay_dt) : '–', { rowspan: trs.length, valign: 'm' }),
      i ? null : TD((p.lead ?? '–').split(',').map((s) => shortFirm(s.trim())).join(', '), { rowspan: trs.length, valign: 'm', size: 7.5 }),
    ]));
  }
  if (rows.length === 1) rows.push([TD('현재 제출된 발행 예정 증권신고서 없음', { colspan: 10 }), null, null, null, null, null, null, null, null, null]);
  const tTop = top + 20;
  const rh = fitRows(rows.length - 1, tTop + 24, BOTTOM, 14, 26);
  prims.push(table(X0, tTop, [108, 46, 40, 54, 56, 34, 76, 64, 64, 147], [24, ...rows.slice(1).map(() => rh)], rows, rows.length > 16 ? 7.5 : 8.5));
  prims.push(...footnote(['주) 증권신고서를 제출했고 납입 전인 일반 공모 회사채(금융채·신종·후순위 제외, 정정 신고 반영). 증액 가능금액은 증권신고서의 최대 발행금액. 수요예측일 아래 (완료)는 수요예측을 마치고 납입 전인 건. 시장에서 파악되는 미제출 예정 건은 포함하지 않음.', '자료: 금융감독원 DART']));
  return { id: 'pipeline', title: n.title, prims };
}

// 금리 차트 데이터 -------------------------------------------------------------------------
const stepAt = (hist: { dt: string; v: number }[], date: string) => {
  let v: number | null = null;
  for (const h of hist) if (h.dt <= date) v = h.v; else break;
  return v;
};
const fmtCat = (dt: string) => `${dt.slice(2, 4)}.${dt.slice(5, 7)}`;
function axis(values: number[], unitStep: number) {
  const lo = Math.floor(Math.min(...values) / unitStep) * unitStep;
  const hi = Math.ceil(Math.max(...values) / unitStep) * unitStep;
  return { min: lo === hi ? lo - unitStep : lo, max: hi, step: unitStep };
}
// 일별 값이 충분한지 (최근 2년 중 120영업일 이상)
function dailyOf(d: DeckData, key: string) {
  const s = d.daily.find((x) => x.key === key);
  const from = addMonths(d.asof, -24);
  const pts = (s?.pts ?? []).filter((p) => p[0] >= from);
  return pts.length >= 120 ? pts : null;
}

// 국고채 + 韓·美 기준금리 (일별이 있으면 2년 일별, 없으면 1년 월말)
function policyChart(d: DeckData, x: number, y: number, w: number, h: number): Prim {
  const k2 = dailyOf(d, 'ktb2y');
  const k3 = dailyOf(d, 'ktb3y');
  const kr = d.policyHistory.kr.map((p) => ({ dt: p.dt, v: p.rate }));
  const us = d.policyHistory.us.map((p) => ({ dt: p.dt, v: p.high }));
  let cats: string[];
  let dates: string[];
  const series: { name: string; color: string; values: (number | null)[] }[] = [];
  if (k3) {
    dates = k3.map((p) => p[0]);
    cats = dates.map(fmtCat);
    const m2 = new Map(k2?.map((p) => [p[0], p[1]]) ?? []);
    if (k2) series.push({ name: '국고 2년', color: C.bar, values: dates.map((dt) => m2.get(dt) ?? null) });
    series.push({ name: '국고 3년', color: C.th, values: k3.map((p) => p[1]) });
  } else {
    const ss = d.series.find((s) => s.key === 'ktb3y');
    if (!ss) return { k: 'text', x, y: y + 40, w, h: 40, paras: [P('금리 시계열이 부족해 차트를 그리지 않았습니다.')], size: 9, color: C.muted, align: 'c', valign: 'm' };
    dates = ss.pts.map((p) => p[0]);
    cats = dates.map(fmtCat);
    series.push({ name: '국고 3년(월말)', color: C.th, values: ss.pts.map((p) => p[1]) });
  }
  if (kr.length) series.push({ name: '韓 기준금리', color: C.yellow, values: dates.map((dt) => stepAt(kr, dt)) });
  if (us.length) series.push({ name: '美 기준금리(상단)', color: C.red, values: dates.map((dt) => stepAt(us, dt)) });
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const ax = axis(all, 0.25);
  return { k: 'chart', x, y, w, h, chart: { kind: 'line', cats, series, ...ax, step: ax.max - ax.min > 2.5 ? 0.5 : 0.25, unit: '%', labelEvery: Math.max(1, Math.round(cats.length / 8)) } };
}

// 국고 3년 대비 회사채 3년 스프레드 (AA-, BBB-), bp
// key: 월말 대체 차트에 쓸 회사채 시계열(BBB 등급 회사는 BBB-)
function spreadChart(d: DeckData, x: number, y: number, w: number, h: number, key: 'corp3y_aa' | 'corp3y_bbb' = 'corp3y_aa'): Prim {
  const k3 = dailyOf(d, 'ktb3y');
  const aa = dailyOf(d, 'corp3y_aa');
  const bbb = dailyOf(d, 'corp3y_bbb');
  let cats: string[] = [];
  const series: { name: string; color: string; values: (number | null)[] }[] = [];
  if (k3 && aa) {
    const mk = new Map(k3.map((p) => [p[0], p[1]]));
    const mb = new Map(bbb?.map((p) => [p[0], p[1]]) ?? []);
    const dates = aa.map((p) => p[0]).filter((dt) => mk.has(dt));
    cats = dates.map(fmtCat);
    series.push({ name: 'AA- 3년 − 국고 3년', color: C.th, values: dates.map((dt) => Math.round((aa.find((p) => p[0] === dt)![1] - mk.get(dt)!) * 1000) / 10) });
    if (bbb) series.push({ name: 'BBB- 3년 − 국고 3년', color: C.bar, values: dates.map((dt) => (mb.has(dt) ? Math.round((mb.get(dt)! - mk.get(dt)!) * 1000) / 10 : null)) });
  } else {
    const ks = d.series.find((s) => s.key === 'ktb3y');
    const as = d.series.find((s) => s.key === key) ?? d.series.find((s) => s.key === 'corp3y_aa');
    if (!ks || !as) return { k: 'text', x, y: y + 40, w, h: 40, paras: [P('금리 시계열이 부족해 차트를 그리지 않았습니다.')], size: 9, color: C.muted, align: 'c', valign: 'm' };
    const mk = new Map(ks.pts.map((p) => [p[0].slice(0, 7), p[1]]));
    const pts = as.pts.filter((p) => mk.has(p[0].slice(0, 7)));
    cats = pts.map((p) => fmtCat(p[0]));
    series.push({ name: `${as.key === 'corp3y_bbb' ? 'BBB-' : 'AA-'} 3년 − 국고 3년(월말)`, color: C.th, values: pts.map((p) => Math.round((p[1] - mk.get(p[0].slice(0, 7))!) * 100)) });
  }
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const ax = axis(all, 10);
  return { k: 'chart', x, y, w, h, chart: { kind: 'line', cats, series, min: ax.min - 10, max: ax.max + 10, step: Math.max(10, Math.ceil((ax.max - ax.min + 20) / 60) * 10), unit: 'bp', labelEvery: Math.max(1, Math.round(cats.length / 8)) } };
}

// II-1 ① 금리 동향
function ratesSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.rates, undefined, 96);
  const top = c.bottom + 8;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  // 금리 현황 띠 (값·1개월 변화)
  const keys = ['base_rate', 'cd91', 'ktb2y', 'ktb3y', 'ktb5y', 'ktb10y', 'corp3y_aa', 'corp3y_bbb'];
  const rs = keys.map((k) => d.rates.find((r) => r.key === k)).filter(Boolean) as DeckData['rates'];
  if (rs.length) {
    const wl = 64;
    const wc = (CW - wl) / rs.length;
    const rows: (Cell | null)[][] = [
      [TH('구분', { size: 7 }), ...rs.map((r) => TH(r.label.replace('한국은행 ', ''), { size: 7 }))],
      [LB('금리(%)', { size: 7 }), ...rs.map((r) => TD(r.key === 'base_rate' ? rate2(r.value) : rate3(r.value), { size: 7.5, bold: true }))],
      [LB('1개월(bp)', { size: 7 }), ...rs.map((r) => TD(bpS0(r.chg1m), { size: 7 }))],
    ];
    prims.push(table(X0, top, [wl, ...rs.map(() => wc)], [16, 15, 15], rows, 7));
  }
  const cy = top + (rs.length ? 56 : 0);
  const half = (CW - 16) / 2;
  const daily = !!dailyOf(d, 'ktb3y');
  prims.push(...goldTitle(cy, `국고채 및 韓·美 기준금리 추이${daily ? ' (일별)' : ' (월말)'}`, X0, X0 + half, '(단위: %)'));
  prims.push(policyChart(d, X0, cy + 20, half, BOTTOM - cy - 22));
  prims.push(...goldTitle(cy, `국고채 대비 회사채 신용스프레드 추이`, X0 + half + 16, X1, '(단위: bp)'));
  prims.push(spreadChart(d, X0 + half + 16, cy + 20, half, BOTTOM - cy - 22));
  const base = d.rates.find((r) => r.key === 'base_rate');
  prims.push(...footnote([`자료: ${rateSource(d)}${base ? `, ${yymmdd(base.dt)} 기준` : ''}, 한국은행·미 연준(정책금리 변경 이력). 美 기준금리는 목표범위 상단`]));
  return { id: 'rates', title: n.title, prims };
}
const rateSource = (d: DeckData) => (d.daily.some((s) => s.pts.length >= 120) ? '한국은행 ECOS' : d.rates.some((r) => r.source === 'research') ? '한국은행 발표·금융 언론 보도 집계' : '한국은행 ECOS');
const bpS0 = (v: number | null) => {
  if (v == null) return '–';
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}`;
};

// 회의 장표 아래 패널: 전망 표 / 점도표 분포(칸 색 진하기 = 인원)
const SHADE = ['EAF2FA', 'C9DDF0', '9DC1E3', '5E97CB', '2D6CA8'];
function panelPrims(p: MeetingPanel, x: number, y: number, w: number, h: number): Prim[] {
  const out: Prim[] = [{ k: 'text', x, y, w, h: 14, paras: [P(`■ ${p.title}`)], size: 8.5, color: C.ink, bold: true, pad: 0, valign: 'm' }];
  const ty = y + 16;
  const noteH = p.note ? 20 : 0;
  const avail = h - 16 - noteH;
  if (p.kind === 'table') {
    const n = p.columns.length;
    const w0 = Math.min(110, w * 0.3);
    const rows: (Cell | null)[][] = [p.columns.map((c, i) => TH(c, { size: 7.5, align: i ? 'c' : 'c' })), ...p.rows.map((r) => [LB(r.label, { size: 7.5 }), ...r.cells.map((c) => TD(c, { size: 7.5 }))])];
    const rh = Math.min(22, Math.max(13, (avail - 18) / p.rows.length));
    out.push(table(x, ty, [w0, ...Array(n - 1).fill((w - w0) / (n - 1))], [18, ...p.rows.map(() => rh)], rows, 7.5));
  } else {
    const max = Math.max(1, ...p.levels.flatMap((l) => l.counts));
    const w0 = 64;
    const rows: (Cell | null)[][] = [
      [TH('금리(%)', { size: 7.5 }), ...p.groups.map((g) => TH(g, { size: 7.5 }))],
      ...p.levels.map((l) => [LB(l.rate, { size: 7.5 }), ...l.counts.map((cnt) => {
        if (!cnt) return TD('', { size: 7.5 });
        const k = Math.min(SHADE.length - 1, Math.floor((cnt / max) * (SHADE.length - 0.01)));
        return TD(String(cnt), { size: 8, bold: true, fill: SHADE[k], color: k >= 3 ? C.white : C.ink });
      })]),
    ];
    const rh = Math.min(20, Math.max(12, (avail - 18) / p.levels.length));
    out.push(table(x, ty, [w0, ...p.groups.map(() => (w - w0) / p.groups.length)], [18, ...p.levels.map(() => rh)], rows, 7.5));
  }
  if (p.note) out.push({ k: 'text', x, y: y + h - noteH + 2, w, h: noteH, paras: [P(p.note)], size: 6.5, color: C.muted, pad: 0, line: 1.25 });
  return out;
}

// II-1 ②③ 금통위·FOMC 핵심 포인트 + 전망 표·점도표
function meeting({ d, tx }: Ctx, n: Numbered, kind: 'bok' | 'fomc'): Body {
  const m = kind === 'bok' ? d.policy.bok : d.policy.fomc;
  const lines = kind === 'bok' ? tx.bok : tx.fomc;
  const c = callout(78, lines, undefined, 80);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  if (!m) {
    prims.push({ k: 'text', x: X0, y: top + 40, w: CW, h: 30, paras: [P('회의 요약 자료가 아직 없습니다.')], size: 10, color: C.muted, align: 'c', valign: 'm' });
    return { id: kind, title: n.title, prims };
  }
  const mo = Number(m.meeting_dt.slice(5, 7));
  prims.push(...goldTitle(top, `${mo}월 ${kind === 'bok' ? '금통위' : 'FOMC'} 핵심 포인트`));
  const panels = m.panels.slice(0, 2);
  const y = top + 20;
  const boxBottom = panels.length ? y + Math.max(120, (BOTTOM - y) * 0.5) : BOTTOM;
  const ps: Para[] = m.points.flatMap((p, i) => [
    { runs: [{ t: `✓ ${p.label}`, b: true, color: C.red }], gap: i ? 5 : 0 },
    { runs: rich(p.text), bullet: true, gap: 1 },
  ]);
  const bh = boxBottom - y;
  let size = 10.5;
  const fits = (sz: number) => textHeight(ps.map((p) => ({ ...p, gap: (p.gap ?? 0) * sz / 9 })), CW - 24, sz, false, 1.35, BULLET_INDENT(sz)) <= bh - 16;
  while (size > 7.5 && !fits(size)) size -= 0.5;
  prims.push({ k: 'rect', x: X0, y, w: CW, h: bh, stroke: C.grid, sw: 0.75 });
  prims.push({ k: 'text', x: X0, y, w: CW, h: bh, paras: ps.map((p) => ({ ...p, gap: (p.gap ?? 0) * size / 9 })), size, color: C.ink, valign: 'm', pad: 10, line: 1.35 });
  if (panels.length) {
    const py = boxBottom + 10;
    const gap = 16;
    const pw = panels.length === 2 ? (CW - gap) * (panels[0].kind === 'table' ? 0.58 : 0.42) : CW;
    panels.forEach((p, i) => {
      const px = i === 0 ? X0 : X0 + pw + gap;
      const w = i === 0 ? pw : CW - pw - gap;
      prims.push(...panelPrims(p, px, py, w, BOTTOM - py - 6));
    });
  }
  prims.push(...footnote([`자료: ${m.sources.map((s) => `${s.title}${s.date ? ` ${yymmdd(s.date)}` : ''}`).join('; ')}`]));
  return { id: kind, title: n.title, prims };
}

// II-1 ④ 증권사별 국내 기준금리 전망
// 증권사 전망 표 10곳: NH 먼저, 요약 문장에 이름이 나오는 '다른 최종금리' 하우스는 반드시, 나머지는 최근 순
function pickViews<T extends { house: string; published_dt: string }>(list: T[], term: (v: T) => number | null) {
  const ts = list.map(term).filter((x): x is number => x != null);
  const cnt = new Map<number, number>();
  for (const t of ts) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  const mode = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  const rank = (v: T) => (/NH/.test(v.house) ? 0 : term(v) != null && term(v) !== mode ? 1 : 2);
  const top = [...list].sort((a, b) => rank(a) - rank(b) || b.published_dt.localeCompare(a.published_dt)).slice(0, 10);
  return list.filter((v) => top.includes(v)).sort((a, b) => Number(/NH/.test(b.house)) - Number(/NH/.test(a.house)));
}

function viewsSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.views, undefined, 80);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, '증권사별 국내 기준금리 전망')];
  const vs = pickViews(d.views, (v) => v.terminal);
  const rows: (Cell | null)[][] = [
    [TH('구분'), TH('Comment'), TH('Analyst'), TH('최종 기준금리'), TH('다음 조정')],
    ...vs.map((v) => {
      const nh = /NH/.test(v.house);
      const f = nh ? 'FFF4D6' : undefined;
      return [LB(v.house, { fill: nh ? 'FCE4A8' : C.label }), cell(`${v.summary} (${yymmdd(v.published_dt)})`, { align: 'l', fill: f, size: 8 }), TD(v.analysts ?? '–', { fill: f, size: 8 }), TD(v.terminal != null ? rate2(v.terminal) : '–', { fill: f, bold: nh }), TD(v.next_move ?? '–', { fill: f, size: 8 })];
    }),
  ];
  const tTop = top + 18;
  prims.push(table(X0, tTop, [86, 389, 80, 62, 72], [22, ...vs.map(() => fitRows(vs.length, tTop + 22, 494, 20, 40))], rows, 8.5));
  const srcs = [...new Map(d.views.map((v) => [v.url, `${v.title} ${yymmdd(v.published_dt)}`])).values()];
  prims.push(...footnote([`주) 각 사 리포트·언론 보도 요약. 자료: ${srcs.join('; ')}`], 497));
  return { id: 'views', title: n.title, prims };
}

// II-1 ⑤ 증권사별 미국 기준금리 전망
function usViewsSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.usviews, undefined, 70);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, '주요 하우스별 미국 통화정책 전망')];
  const vs = pickViews(d.usViews, (v) => v.end2026 ?? v.terminal);
  const rows: (Cell | null)[][] = [
    [TH('구분'), TH('Comment'), TH('Analyst'), TH('최종금리'), TH("'26년 말"), TH('다음 조정')],
    ...vs.map((v) => {
      const nh = /NH/.test(v.house);
      const f = nh ? 'FFF4D6' : undefined;
      return [LB(v.house, { fill: nh ? 'FCE4A8' : C.label }), cell(`${v.summary} (${yymmdd(v.published_dt)})`, { align: 'l', fill: f, size: 8 }), TD(v.analysts ?? '–', { fill: f, size: 8 }), TD(v.terminal != null ? rate2(v.terminal) : '–', { fill: f }), TD(v.end2026 != null ? rate2(v.end2026) : '–', { fill: f }), TD(v.next_move ?? '–', { fill: f, size: 8 })];
    }),
  ];
  if (!vs.length) rows.push([TD('수집된 전망 자료 없음', { colspan: 6 }), null, null, null, null, null]);
  const tTop = top + 18;
  prims.push(table(X0, tTop, [86, 349, 76, 56, 56, 66], [22, ...rows.slice(1).map(() => fitRows(rows.length - 1, tTop + 22, 494, 20, 40))], rows, 8.5));
  const srcs = [...new Map(d.usViews.map((v) => [v.url, `${v.title} ${yymmdd(v.published_dt)}`])).values()];
  prims.push(...footnote([`주) 연준 정책금리 상단 기준, 각 사 리포트·언론 보도 요약. 자료: ${srcs.join('; ')}`], 497));
  return { id: 'usviews', title: n.title, prims };
}

// 3-① 기준금리 및 국고채 금리(NH 리서치): 의견 + 전망표(내부 데이터, 없으면 공개 전망표)
// 3-② 회사채 금리: 회사채 의견 + 등급별 전망표(내부 데이터가 있을 때만 켜진다)
const onPlan = (plan: Plan, id: ItemId) => plan.sections.some((s) => s.items.some((i) => i.id === id));
type Notes = (NonNullable<DeckData['forecast']>['notes'][number] & { house?: string })[];
function noteBox(y: number, list: Notes, maxH: number) {
  if (!list.length) return { prims: [] as Prim[], bottom: y };
  let size = 9.5;
  const build = (sz: number): Para[] => list.flatMap((x, i) => [
    { runs: [{ t: x.house ? `■ ${x.topic} · ${x.house} (${yymmdd(x.date)})` : `■ ${x.topic} 전망 (${yymmdd(x.date)})`, b: true }], gap: i ? Math.round(sz * 0.7) : 0 },
    { runs: rich(x.text), gap: 2 },
  ]);
  let ps = build(size);
  let h = textHeight(ps, CW - 20, size, false, 1.32) + 20;
  while (h > maxH && size > 7.5) {
    size -= 0.5;
    ps = build(size);
    h = textHeight(ps, CW - 20, size, false, 1.32) + 20;
  }
  return { prims: [{ k: 'rect', x: X0, y, w: CW, h, fill: C.label } as Prim, { k: 'text', x: X0, y, w: CW, h, paras: ps, size, color: C.ink, valign: 'm', pad: 10, line: 1.32 } as Prim], bottom: y + h };
}

function forecastSlide({ d, inp, tx, plan }: Ctx, n: Numbered): Body {
  const fc = d.forecast;
  const rateGrid = parseTsv(inp.internal?.rateFc ?? '');
  const notes = fc?.notes ?? [];
  const rateNotes = notes.filter((x) => /기준금리|국고채/.test(x.topic));
  const creditNotes = notes.filter((x) => /회사채/.test(x.topic));
  // 회사채 금리 장표가 있으면 회사채 의견은 그쪽으로
  const list = onPlan(plan, 'credit_fc') ? rateNotes : [...rateNotes, ...creditNotes];
  const prims: Prim[] = [titleBox(n.head, n.sub)];
  const box = list.length ? noteBox(78, list, 190) : callout(78, tx.forecast, undefined, 120);
  prims.push(...box.prims);
  const top = box.bottom + 12;
  if (rateGrid.length >= 2) {
    prims.push(...goldTitle(top, '주요 금리 전망치', X0, X1, '(단위: %, 내부 데이터)'));
    prims.push(...pastedTable(X0, top + 20, CW, BOTTOM - top - 24, rateGrid, 8));
  } else if (fc && !forecastStale(d)) {
    prims.push(...goldTitle(top, `${fc.house} 리서치 주요 금리 전망 (${yymmdd(fc.published_dt)} 발표)`, X0, X1, '(단위: %)'));
    const periods = fc.rows[0]?.cells ?? [];
    const pw = (CW - 120 - 50) / Math.max(periods.length, 1);
    const rows: (Cell | null)[][] = [
      [TH('구분'), TH('기준'), ...periods.map((p) => TH(p.actual ? `${p.period}\n(실적)` : p.period))],
      ...fc.rows.map((r) => [LB(r.label), TD(r.basis), ...r.cells.map((x) => TD(rate2(x.value).replace('%', ''), { color: x.actual ? C.muted : undefined }))]),
    ];
    const rh = fitRows(fc.rows.length, top + 20 + 30, BOTTOM, 18, 30);
    prims.push(table(X0, top + 20, [120, 50, ...periods.map(() => pw)], [30, ...fc.rows.map(() => rh)], rows, 9));
  }
  const src = [...new Map(list.map((x) => [x.url, `${x.title} ${yymmdd(x.date)}`])).values()];
  prims.push(...footnote([
    rateGrid.length >= 2 ? '주) 금리 전망표는 NH 리서치 내부 데이터' : fc && !forecastStale(d) ? `주) 기준금리는 기말, 국고채는 기간 평균. ${yymmdd(fc.published_dt)} 발표 공개본으로 이후 금통위·FOMC 결과는 반영되지 않음. 자료: ${fc.title}` : '',
    src.length ? `의견 출처: ${src.join('; ')}` : '',
  ].filter(Boolean)));
  return { id: 'forecast', title: n.title, prims };
}

// 회사채 시장 의견: 시장 자료 팩(최근 60일 증권사·언론 크레딧 의견)이 있으면 그것, 없으면 NH 리서치 회사채 의견
const CREDIT_TOPICS = /회사채|크레딧/;
export const creditNotesOf = (d: DeckData): Notes => {
  const m = (d.marketNotes ?? []).filter((x) => CREDIT_TOPICS.test(x.topic));
  return m.length ? m : (d.forecast?.notes ?? []).filter((x) => CREDIT_TOPICS.test(x.topic));
};
// 3-② 회사채 금리: 현업 샘플 양식 = 위 '우량채·비우량채 회사채 시장 전망' 두 단락 + 아래 등급별 전망표(NH 리서치, 내부).
// 내부 전망표가 없으면 표 자리에 국고 대비 신용스프레드 추이를 넣는다. 단락 본문은 하우스 이름 없이 '- 요약', 출처는 각주.
// 등급별 금리 실적표(내부 전망표 대체): 전년 말 + 모든 줄에 값이 있는 최근 월말 3개 + 현재, 마지막 열은 전년 말 대비(bp)
function gradeRows(d: DeckData) {
  const ser = (k: string) => (d.series.find((s) => s.key === k)?.pts ?? []) as [string, number][];
  const k3 = ser('ktb3y');
  if (k3.length < 3) return null;
  const now = d.rates.find((r) => r.key === 'ktb3y');
  const curM = (now?.dt ?? d.asof).slice(0, 7);
  const yearEnd = `${Number(d.asof.slice(0, 4)) - 1}-12`;
  const keys = (['corp3y_aa', 'corp3y_bbb'] as const).filter((k) => ser(k).length);
  const at = (k: string, m: string) => ser(k).find((p) => p[0].startsWith(m))?.[1] ?? null;
  const cur = (k: string) => d.rates.find((r) => r.key === k)?.value ?? ser(k).at(-1)?.[1] ?? null;
  const full = (m: string) => ['ktb3y', ...keys].every((k) => at(k, m) != null);
  const months = [...new Set(k3.map((p) => p[0].slice(0, 7)))].filter((m) => m < curM && full(m));
  const cols = [...new Set([...(full(yearEnd) ? [yearEnd] : []), ...months.filter((m) => m > yearEnd).slice(-3)])];
  if (cols.length < 2) return null;
  const v = (k: string, m: string | null) => (m ? at(k, m) : cur(k));
  const spr = (k: string, m: string | null) => { const a = v(k, m); const b = v('ktb3y', m); return a == null || b == null ? null : a - b; };
  const f2 = (x: number | null) => (x == null ? '–' : x.toFixed(2));
  const bp = (x: number | null) => (x == null ? '–' : String(Math.round(x * 100)));
  const chg = (a: number | null, b: number | null) => (a == null || b == null ? '–' : `${b - a >= 0 ? '+' : ''}${Math.round((b - a) * 100)}`);
  const G: Record<string, string> = { corp3y_aa: 'AA-', corp3y_bbb: 'BBB-' };
  const lines: { label: string; get: (m: string | null) => number | null; fmt: (x: number | null) => string }[] = [
    { label: '국고채', get: (m) => v('ktb3y', m), fmt: f2 },
    ...keys.map((k) => ({ label: `회사채 ${G[k]}`, get: (m: string | null) => v(k, m), fmt: f2 })),
    ...keys.map((k) => ({ label: `신용스프레드 ${G[k]}(bp)`, get: (m: string | null) => spr(k, m), fmt: bp })),
  ];
  const head = [...cols.map((m) => `${m.slice(2, 4)}.${m.slice(5, 7)}말`), `현재(${md(now?.dt ?? d.asof)})`, `${yearEnd.slice(2, 4)}년말 대비(bp)`];
  const rows = lines.map((l) => ({ label: l.label, cells: [...[...cols, null].map((m) => l.fmt(l.get(m))), full(yearEnd) ? chg(l.get(yearEnd), l.get(null)) : '–'] }));
  return { head, rows };
}
const HIGH = ['우량 회사채', '크레딧 시장'];
function creditSlide({ d, inp }: Ctx, n: Numbered): Body {
  const grid = parseTsv(inp.internal?.creditFc ?? '');
  const notes = creditNotesOf(d);
  const yr = d.asof.slice(0, 4);
  const groups = [
    { title: `${yr}년 AA등급 이상(우량채) 회사채 시장 전망`, xs: notes.filter((x) => HIGH.includes(x.topic)).slice(0, 2) },
    { title: `${yr}년 A등급 이하(비우량채) 회사채 시장 전망`, xs: notes.filter((x) => x.topic === '비우량 회사채').slice(0, 2) },
  ].filter((g) => g.xs.length);
  const prims: Prim[] = [titleBox(n.head, n.sub)];
  let top = 78;
  if (groups.length) {
    let size = 9.5;
    const build = (sz: number): Para[] => groups.flatMap((g, i) => [
      { runs: [{ t: `■  ${g.title}`, b: true }], gap: i ? Math.round(sz * 0.9) : 0 },
      ...g.xs.map((x) => ({ runs: rich(x.text), bullet: true, gap: 3 })),
    ]);
    let ps = build(size);
    const maxH = grid.length >= 2 ? 150 : 140;
    let h = textHeight(ps, CW - 20, size, false, 1.32, BULLET_INDENT(size)) + 20;
    while (h > maxH && size > 7.5) {
      size -= 0.5;
      ps = build(size);
      h = textHeight(ps, CW - 20, size, false, 1.32, BULLET_INDENT(size)) + 20;
    }
    prims.push({ k: 'rect', x: X0, y: top, w: CW, h, fill: C.label }, { k: 'text', x: X0, y: top, w: CW, h, paras: ps, size, color: C.ink, valign: 'm', pad: 10, line: 1.32 });
    top += h + 12;
  }
  const gt = grid.length >= 2 ? null : gradeRows(d);
  if (grid.length >= 2) {
    prims.push(...goldTitle(top, '회사채 금리 전망', X0, X1, '(단위: %)'));
    prims.push(...pastedTable(X0, top + 20, CW, BOTTOM - top - 24, grid, 7.5));
  } else if (gt) {
    // 내부 전망표 자리: 같은 모양(구분·만기 × 기간)의 등급별 금리 실적표 + 아래 신용스프레드 추이
    prims.push(...goldTitle(top, '등급별 회사채 금리 추이', X0, X1, '(단위: %, bp)'));
    const lw = [118, 46];
    const cw = (CW - lw[0] - lw[1]) / gt.head.length;
    const rh = 19;
    const rows: (Cell | null)[][] = [
      [TH('구분'), TH('만기'), ...gt.head.map((h) => TH(h))],
      ...gt.rows.map((r) => [LB(r.label), TD('3년'), ...r.cells.map((v, i) => TD(v, { bold: i === r.cells.length - 2, color: i === r.cells.length - 1 ? C.muted : undefined }))]),
    ];
    const ty = top + 20;
    prims.push(table(X0, ty, [...lw, ...gt.head.map(() => cw)], [24, ...gt.rows.map(() => rh)], rows, 8.5));
    const cy = ty + 24 + rh * gt.rows.length + 14;
    if (BOTTOM - cy > 90) {
      prims.push(...goldTitle(cy, '국고채 3년 대비 회사채 3년 신용스프레드 추이', X0, X1, '(단위: bp)'));
      prims.push(spreadChart(d, X0, cy + 22, CW, BOTTOM - cy - 26, d.company.rating_group === 'BBB' ? 'corp3y_bbb' : 'corp3y_aa'));
    }
  }
  const used = groups.flatMap((g) => g.xs);
  const src = [...new Set(used.map((x) => `${x.house ? `${x.house} ` : ''}${x.title} ${yymmdd(x.date)}`))];
  prims.push(...footnote([
    grid.length >= 2 ? '주) 회사채 금리는 분기 평균 기준. 자료: NH투자증권 리서치본부' : `주) 등급별 금리는 월말 실적(세 금리가 모두 있는 달), 신용스프레드는 회사채 − 국고채. NH 리서치 등급별 전망표를 붙이면 이 자리에 전망표가 들어감. 자료: 한국은행 ECOS`,
    src.length ? `전망 출처: ${src.join('; ')}` : '',
  ].filter(Boolean)));
  return { id: 'credit_fc', title: n.title, prims };
}

// II-2 수요예측 결과 (여러 쪽)
function peerRows(list: PeerIssue[], self: string): (Cell | null)[][][] {
  // 발행 하나 = 행 묶음 (트랜치 수만큼)
  return list.map((p) => {
    const tr = p.tranches.length ? p.tranches : [null];
    const isSelf = p.corp_code === self;
    return tr.map((t, i) => {
      const span = tr.length;
      const ratio = t?.ratio ?? (span === 1 ? p.ratio : null);
      const under = t?.under ?? (span === 1 ? p.under : null);
      const dem = demOf(t);
      return [
        i ? null : cell(isSelf ? `^^${p.corp_name}^^` : p.corp_name, { bold: true, align: 'c', rowspan: span, valign: 'm', color: isSelf ? C.blue : undefined }),
        i ? null : TD(p.rating ?? '–', { rowspan: span, valign: 'm' }),
        TD(t ? years(t.months) : '–'), TD(eok(t?.initial_krw ?? p.initial_krw)), TD(eok(t?.amount_krw ?? p.amount_krw)),
        i ? null : TD(p.amount_max_krw ? eok(p.amount_max_krw) : '–', { rowspan: span, valign: 'm' }),
        TD(rate3(t?.yield_pct)),
        TD(bpSign(t?.spread_bp)),
        TD(bandKind(t?.band_type ?? p.band_type), { bold: true }), TD(bandRange(t ?? p)),
        i ? null : TD(p.demand_dt ? mdw(p.demand_dt) : '–', { rowspan: span, valign: 'm' }),
        i ? null : TD(p.deal_dt ? mdw(p.deal_dt) : '–', { rowspan: span, valign: 'm' }),
        TD(dem), TD(under || (ratio != null && ratio < 1) ? `!!${ratioX(ratio)}!!` : ratioX(ratio)),
      ];
    });
  });
}

function peersSlides({ d, inp, tx }: Ctx, n: Numbered): Body[] {
  const scope = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const pool = peerPool(d, inp.peerScope);
  const sel = inp.peerKeys.map((k) => pool.find((p) => p.key === k) ?? d.peers.find((p) => p.key === k)).filter(Boolean) as PeerIssue[];
  sel.sort((a, b) => (a.demand_dt ?? a.pricing_dt ?? a.deal_dt ?? '').localeCompare(b.demand_dt ?? b.pricing_dt ?? b.deal_dt ?? ''));
  // 증액가능(최대 발행금액)은 공시에 적힌 건이 30% 미만이면 열을 뺀다
  const showMax = sel.length > 0 && sel.filter((p) => p.amount_max_krw).length / sel.length >= 0.3;
  const dropMax = <T,>(r: T[]) => (showMax ? r : r.filter((_, k) => k !== 5));
  const groups = peerRows(sel, d.company.corp_code).map((g) => g.map(dropMax));
  const hd0: (Cell | null)[][] = [
    [TH('발행회사', { rowspan: 2 }), TH('신용\n등급', { rowspan: 2 }), TH('만기\n(Y)', { rowspan: 2 }), TH('예측금액\n(억)', { rowspan: 2 }), TH('발행금액\n(억)', { rowspan: 2 }), TH('증액가능\n(억)', { rowspan: 2 }), TH('발행금리', { rowspan: 2 }),
      TH('결정\n조건', { rowspan: 2 }), TH('금리밴드', { colspan: 2 }), null, TH('수요예측', { rowspan: 2 }), TH('납입\n기일', { rowspan: 2 }), TH('예측결과(밴드내/총참여)', { colspan: 2 }), null],
    [null, null, null, null, null, null, null, null, TH('구분'), TH('bp / %'), null, null, TH('금액(억)'), TH('경쟁률')],
  ];
  const hd = hd0.map(dropMax);
  const colW = showMax ? [86, 38, 28, 46, 46, 46, 50, 36, 30, 62, 54, 52, 70, 45] : [116, 40, 30, 50, 50, 52, 38, 32, 64, 56, 54, 72, 45];
  const nc = colW.length;
  // 첫 쪽은 요약 상자가 있어 행이 적다. 쪽마다 들어가는 행 수 = (표 영역 높이) / 최소 행 높이
  const c0 = callout(78, tx.peers, scheduleHead(d, inp), 130);
  const capOf = (top: number) => Math.max(4, Math.floor((BOTTOM - (top + 18 + 36)) / 17));
  const pages: (Cell | null)[][][][] = [[]];
  let count = 0;
  const totalRows = groups.reduce((a, g) => a + g.length, 0);
  const cap1 = capOf(c0.bottom + 10);
  // 두 쪽에 들어가면 행을 고르게 나눈다(둘째 쪽에 한두 건만 남지 않게)
  const even = totalRows > cap1 && totalRows <= cap1 + capOf(78) ? Math.ceil(totalRows / 2) : cap1;
  for (const g of groups) {
    const cap = pages.length === 1 ? Math.min(cap1, even) : capOf(78);
    if (count + g.length > cap && pages[pages.length - 1].length) {
      pages.push([]);
      count = 0;
    }
    pages[pages.length - 1].push(g);
    count += g.length;
  }
  return pages.map((pg, i) => {
    const prims: Prim[] = [titleBox(n.head, n.sub, i > 0)];
    let top = 78;
    if (i === 0) {
      prims.push(...c0.prims);
      top = c0.bottom + 10;
    }
    prims.push(...goldTitle(top, `${scope}등급 공모 회사채 수요예측 결과 (${sel.length}건, 수요예측일 순)`));
    const body = pg.flat();
    const rows = [...hd, ...(body.length ? body : [[TD('선택한 사례가 없습니다', { colspan: nc }), ...Array(nc - 1).fill(null)]])];
    const tTop = top + 18;
    const rh = fitRows(rows.length - 2, tTop + 36, BOTTOM, 16, 30);
    prims.push(table(X0, tTop, colW, [18, 18, ...rows.slice(2).map(() => rh)], rows, rows.length > 12 ? 8 : 8.5));
    prims.push(...footnote([`주) 일반 공모 회사채(신종·후순위·금융채·리츠 제외). 결정조건은 확정 가산금리(민평 대비 bp)${showMax ? ', 증액가능은 증권신고서 최대 발행금액' : ''}. 수요예측 결과는 발행조건확정 증권신고서(정정) 기준, 빨간색은 미달.`, '자료: 금융감독원 DART']));
    return { id: `peers-${i}`, title: n.title, prims };
  });
}

function scheduleHead(d: DeckData, inp: DeckInput) {
  const sch = scheduleOf(d, inp);
  return sch ? `${d.company.corp_name}의 수요예측 흥행을 위해 ${korDate(sch.pay)} 발행 일정을 제안` : undefined;
}

// II-2 미매각 사례 분석
function compare({ d, inp, tx }: Ctx, n: Numbered): Body {
  const cmp = inp.compareKeys.map((k) => d.peers.find((p) => p.key === k)).filter(Boolean).slice(0, 3) as PeerIssue[];
  // 쪽 제목: 전액 미달 사례가 있으면 그 회사, 일부 트랜치 미달만 있으면 '미매각 사례 분석', 미달이 없으면 '수요예측 사례 비교분석'
  const under = cmp.find(fullUnder);
  const c = callout(78, tx.compare, undefined, 130);
  const top = c.bottom + 10;
  const circ = n.sub?.match(/^[①-⑧]\s/)?.[0] ?? '';
  const sub = under ? `${circ}${under.corp_name} 수요예측 미매각 사례 분석` : cmp.some((p) => p.under) ? n.sub : `${circ}수요예측 사례 비교분석`;
  const title = `${n.head}${sub ? `_${sub}` : ''}`;
  const prims: Prim[] = [titleBox(n.head, sub), ...c.prims, ...goldTitle(top, `주요 ${d.company.rating_group ?? ''}등급 수요예측 사례 비교분석`)];
  const nn = Math.max(cmp.length, 1);
  const w0 = 130;
  const wn = (CW - w0) / nn;
  const R = (label: string, f: (p: PeerIssue) => string) => [LB(label), ...cmp.map((p) => TD(f(p)))];
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
    R('결과', (p) => verdictOf(p, true)),
  ];
  const tTop = top + 18;
  prims.push(table(X0, tTop, [w0, ...cmp.map(() => wn)], [24, ...rows.slice(1).map(() => fitRows(rows.length - 1, tTop + 24, BOTTOM, 18, 30))], cmp.length ? rows : [[TH('평가항목')]], 9));
  prims.push(...footnote(['자료: 금융감독원 DART(증권신고서, 발행조건확정 정정신고서)']));
  return { id: 'compare', title, prims };
}

// II-2 회사채 금리: 회사채 3년 AA-·BBB- 금리 추이 + 최근 같은 등급 발행금리(국고 대비)
function corp({ d, inp, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.corp, undefined, 100);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const lw = 360;
  const aa = dailyOf(d, 'corp3y_aa');
  const bbb = dailyOf(d, 'corp3y_bbb');
  const k3 = dailyOf(d, 'ktb3y');
  if (aa) {
    prims.push(...goldTitle(top, '국고채·회사채 3년 금리 추이 (일별)', X0, X0 + lw, '(단위: %)'));
    const dates = aa.map((p) => p[0]);
    const mk = new Map(k3?.map((p) => [p[0], p[1]]) ?? []);
    const mb = new Map(bbb?.map((p) => [p[0], p[1]]) ?? []);
    const series = [
      ...(k3 ? [{ name: '국고 3년', color: C.bar, values: dates.map((dt) => mk.get(dt) ?? null) }] : []),
      { name: 'AA- 3년', color: C.th, values: aa.map((p) => p[1]) },
      ...(bbb ? [{ name: 'BBB- 3년', color: C.red, values: dates.map((dt) => mb.get(dt) ?? null) }] : []),
    ];
    const all = series.flatMap((x) => x.values).filter((v): v is number => v != null);
    const ax = axis(all, 0.5);
    prims.push({ k: 'chart', x: X0, y: top + 22, w: lw, h: BOTTOM - top - 26, chart: { kind: 'line', cats: dates.map(fmtCat), series, min: ax.min, max: ax.max, step: ax.max - ax.min > 6 ? 1 : 0.5, unit: '%', labelEvery: Math.max(1, Math.round(dates.length / 7)) } });
  } else {
    // BBB 등급 회사는 BBB- 스프레드를 본다(월말 시계열이 있으면)
    const useBbb = d.company.rating_group === 'BBB' && d.series.some((s) => s.key === 'corp3y_bbb');
    prims.push(...goldTitle(top, `회사채 3년 ${useBbb ? 'BBB-' : 'AA-'} 신용스프레드 (국고채 3년 대비, 월말)`, X0, X0 + lw, '(단위: bp)'));
    prims.push(spreadChart(d, X0, top + 22, lw, BOTTOM - top - 26, useBbb ? 'corp3y_bbb' : 'corp3y_aa'));
  }
  const rx = X0 + lw + 14;
  const rw = X1 - rx;
  const g = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const win = recentWindow(d, inp);
  prims.push(...goldTitle(top, `최근 ${win.months}개월 ${g}등급 발행금리`, rx, X1, '(단위: %, bp)'));
  const rows: (Cell | null)[][] = [[TH('납입일'), TH('발행회사'), TH('등급'), TH('만기'), TH('발행금리'), TH('결정\n조건'), TH('국고\n대비')]];
  let nrow = 0;
  for (const p of win.list) {
    if (nrow + p.tranches.length > 16) break;
    nrow += p.tranches.length;
    p.tranches.forEach((t, i) => {
      const sp = spreadVsKtb(d, p, t);
      rows.push([
        i ? null : TD(p.deal_dt ? md(p.deal_dt) : '–', { rowspan: p.tranches.length, valign: 'm' }),
        i ? null : TD(p.corp_name, { rowspan: p.tranches.length, valign: 'm', bold: true }),
        i ? null : TD(p.rating ?? '–', { rowspan: p.tranches.length, valign: 'm' }),
        TD(t.tenor), TD(rate3(t.yield_pct)), TD(bpSign(t.spread_bp)), TD(sp == null ? '–' : String(sp)),
      ]);
    });
  }
  if (rows.length === 1) rows.push([TD(`최근 ${win.months}개월 발행 없음`, { colspan: 7 }), null, null, null, null, null, null]);
  const tTop = top + 22;
  const wn = rw - 38 - 36 - 32 - 46 - 34 - 34;
  prims.push(table(rx, tTop, [38, wn, 36, 32, 46, 34, 34], [24, ...rows.slice(1).map(() => fitRows(rows.length - 1, tTop + 24, BOTTOM, 13, 26))], rows, 7.5));
  prims.push(...footnote([`주) 결정조건은 확정 가산금리(민평 대비), 국고 대비는 발행금리 − 수요예측일 같은 만기 국고채. 자료: ${rateSource(d)}, 금융감독원 DART(발행조건확정 공시)`]));
  return { id: 'corp', title: n.title, prims };
}

// III-4 연간 League Table
function leagueSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.league, undefined, 60);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const ly = d.leagueYearly;
  const half = (BOTTOM - top - 10) / 2;
  const part = (y0: number, title: string, pick: (x: DeckData['leagueYearly'][number]) => DeckData['leagueYearly'][number]['lead']) => {
    prims.push(...goldTitle(y0, title, X0, X1, '(단위: 억원, %)'));
    const colW = [26, ...ly.flatMap(() => [(CW - 26) / ly.length * 0.42, (CW - 26) / ly.length * 0.36, (CW - 26) / ly.length * 0.22])];
    const head1: (Cell | null)[] = [TH('순위', { rowspan: 2 }), ...ly.flatMap((y) => [TH(y.ytd ? `${y.year}년 누적` : `${y.year}년`, { colspan: 3 }), null, null])];
    const head2: (Cell | null)[] = [null, ...ly.flatMap(() => [TH('증권사', { size: 7 }), TH('금액', { size: 7 }), TH('M/S', { size: 7 })])];
    const rows: (Cell | null)[][] = [head1, head2];
    const maxRows = Math.max(...ly.map((y) => pick(y).length), 5);
    for (let r = 0; r < Math.min(maxRows, 6); r++) {
      const row: (Cell | null)[] = [TD(r < 5 ? String(r + 1) : '', { bold: true })];
      for (const y of ly) {
        const x = pick(y)[r];
        const f = x?.isNh ? 'FFF0B3' : undefined;
        row.push(TD(x ? `${x.rank > 5 ? `${x.rank}. ` : ''}${shortFirm(x.firm)}` : '', { fill: f, bold: !!x?.isNh, size: 7.5 }), TD(x ? Math.round(x.krw / 1e8).toLocaleString('ko-KR') : '', { fill: f, size: 7.5 }), TD(x ? x.share.toFixed(1) : '', { fill: f, size: 7.5 }));
      }
      rows.push(row);
    }
    const rh = Math.min(24, (half - 22 - 30) / (rows.length - 2));
    prims.push(table(X0, y0 + 20, colW, [15, 15, ...rows.slice(2).map(() => rh)], rows, 7.5));
  };
  if (ly.length) {
    part(top, '회사채 대표주관 연간 League Table', (y) => y.lead);
    part(top + half + 6, '회사채 인수 연간 League Table', (y) => y.uw);
  }
  prims.push(...footnote(['주) DART 증권신고서 기준 공모 회사채(일괄신고 금융채 제외), 공동 대표주관은 금액을 균등 배분. 시장 집계(더벨 등)와 다를 수 있음.', '자료: 금융감독원 DART']));
  return { id: 'league', title: n.title, prims };
}

// III-4 같은 등급 대표주관 실적 (강점 상자 + 막대)
function strength({ d, tx }: Ctx, n: Numbered): Body {
  const g = d.company.rating_group ?? '';
  const prims: Prim[] = [titleBox(n.head, n.sub), ...goldTitle(80, `NH투자증권의 ${g}등급 공모 회사채 발행 경쟁력`)];
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
  return { id: 'strength', title: n.title, prims };
}

// Appendix 등급별 회사채 만기도래 현황: 등급·세부 등급 × 월(분기 소계)
function maturity({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.maturity, undefined, 78);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const mg = d.maturityByGrade;
  prims.push(...goldTitle(top, `${mg.months[0]?.slice(0, 4)}~ 등급별 공모 회사채 만기도래 현황`, X0, X1, '(단위: 억원)'));
  // 열: 월, 분기가 끝나면 분기 소계, 마지막 합계
  type Col = { label: string; idx: number[]; sub: boolean };
  const cols: Col[] = [];
  mg.months.forEach((m, i) => {
    cols.push({ label: `${Number(m.slice(5, 7))}월`, idx: [i], sub: false });
    const q = quarterOf(m);
    const next = mg.months[i + 1];
    if (!next || quarterOf(next) !== q) cols.push({ label: `${q}\n소계`, idx: mg.months.map((x, k) => (quarterOf(x) === q ? k : -1)).filter((k) => k >= 0), sub: true });
  });
  cols.push({ label: '합계', idx: mg.months.map((_, k) => k), sub: true });
  const eokS = (v: number) => (v ? Math.round(v / 1e8).toLocaleString('ko-KR') : '–');
  const sumIdx = (vals: number[], idx: number[]) => idx.reduce((t, k) => t + vals[k], 0);
  const w0 = 44;
  const w1 = 30;
  const wc = (CW - w0 - w1) / cols.length;
  const rows: (Cell | null)[][] = [[TH('등급', { colspan: 2, size: 6.5 }), null, ...cols.map((x) => TH(x.label, { size: 6.5, fill: x.sub ? '0B5A8E' : C.th }))]];
  for (const g of ['AAA', 'AA', 'A', 'BBB 이하', '등급 미확인']) {
    const gRows = mg.rows.filter((r) => r.grade === g);
    const head = gRows.find((r) => !r.notch);
    if (!head) continue;
    const subs = gRows.filter((r) => r.notch);
    const span = 1 + subs.length;
    rows.push([LB(g, { rowspan: span, size: 7 }), LB(subs.length ? '계' : '', { size: 6.5 }), ...cols.map((x) => TD(eokS(sumIdx(head.values, x.idx)), { size: 6.5, bold: true, fill: x.sub ? 'EEF3F9' : undefined }))]);
    for (const r of subs) rows.push([null, LB(r.notch ?? '', { size: 6.5, fill: 'FAFAFA' }), ...cols.map((x) => TD(eokS(sumIdx(r.values, x.idx)), { size: 6.5, color: C.sub, fill: x.sub ? 'F5F8FC' : undefined }))]);
  }
  rows.push([LB('합계', { colspan: 2, fill: 'E7EEF6', size: 7 }), null, ...cols.map((x) => TD(eokS(sumIdx(mg.total, x.idx)), { bold: true, fill: 'E7EEF6', size: 6.5 }))]);
  const tTop = top + 20;
  const rh = 13;
  prims.push(table(X0, tTop, [w0, w1, ...cols.map(() => wc)], [22, ...rows.slice(1).map(() => rh)], rows, 6.5));
  const g = d.company.rating_group;
  const gk = g === 'BBB' || g === 'BB' || g === 'B' ? 'BBB 이하' : g;
  const gr = mg.rows.find((r) => r.grade === gk && !r.notch) ?? null;
  const cy = tTop + 22 + (rows.length - 1) * rh + 12;
  if (gr && BOTTOM - cy > 70) {
    prims.push(...goldTitle(cy, `${gr.grade}등급 월별 만기도래`, X0, X1));
    prims.push({
      k: 'chart', x: X0 + 10, y: cy + 20, w: CW - 20, h: BOTTOM - cy - 22,
      chart: { kind: 'bar', cats: mg.months.map((m) => `${Number(m.slice(5, 7))}월`), values: gr.values.map((v) => Math.round(v / 1e8)), labels: gr.values.map((v) => (v ? Math.round(v / 1e8).toLocaleString('ko-KR') : '')), highlight: [], color: C.th, hiColor: C.yellow },
    });
  }
  prims.push(...footnote(['주) 일반 공모 회사채(신종·금융채·일괄신고 제외) 만기 기준. 등급은 발행 당시 등급(세부 등급 0 은 무부호).', '자료: 금융감독원 DART']));
  return { id: 'maturity', title: n.title, prims };
}

// Appendix 주요 이벤트 (12개월 달력)
function events({ d }: Ctx, n: Numbered): Body {
  const start = `${d.asof.slice(0, 7)}-01`;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
  const prims: Prim[] = [titleBox(n.head, `${yy(months[0])}~${yy(months[11])}`)];
  const evs = d.events;
  const hol = new Map(d.holidays.map((h) => [h.dt, h.name]));
  const mark = (dt: string) => {
    const e = evs.filter((x) => x.event_dt === dt || (x.kind === 'FOMC' && x.end_dt === dt));
    if (e.some((x) => x.kind === '금통위')) return { fill: C.blue, color: C.white };
    if (e.some((x) => x.kind === 'FOMC' && x.end_dt === dt)) return { fill: C.yellow, color: C.ink };
    if (e.some((x) => x.kind === '정기보고서')) return { fill: C.red, color: C.white };
    return null;
  };
  const gw = 468;
  const mw = (gw - 2 * 10) / 3;
  const mh = (BOTTOM - 80 - 3 * 8) / 4;
  months.forEach((m, i) => {
    const x = X0 + (i % 3) * (mw + 10);
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
        const dd = r * 7 + j - first + 1;
        if (dd < 1 || dd > days) return TD('', { size: 6 });
        const dt = `${m.slice(0, 8)}${String(dd).padStart(2, '0')}`;
        const mk = mark(dt);
        const red = j === 0 || hol.has(dt);
        return TD(String(dd), { size: 6, fill: mk?.fill, color: mk?.color ?? (red ? C.red : j === 6 ? C.blue : C.ink), bold: !!mk });
      }));
    }
    const t = table(x, y + 14, Array(7).fill(mw / 7), [10, ...Array(nW).fill((mh - 14 - 10) / 6)], rows, 6, false);
    t.grid = 'FFFFFF';
    prims.push(t);
  });
  const rx = X0 + gw + 14;
  const rw = X1 - rx;
  const legend: [string, string][] = [[C.blue, '금통위(통화정책방향 결정)'], [C.yellow, 'FOMC(미국 시간, 결과 발표일)'], [C.red, '정기보고서 제출기한']];
  legend.forEach(([col, t], i) => {
    prims.push({ k: 'rect', x: rx, y: 82 + i * 13, w: 9, h: 8, fill: col });
    prims.push({ k: 'text', x: rx + 13, y: 80 + i * 13, w: rw - 13, h: 12, paras: [P(t)], size: 7, color: C.ink, valign: 'm', pad: 0 });
  });
  const inWin = (dt: string) => dt >= start && dt < addMonths(start, 12);
  let y = 128;
  const listTable = (title: string, items: [string, string][]) => {
    if (!items.length) return;
    const rows: (Cell | null)[][] = [[TH(title, { colspan: 2, size: 7.5 }), null], ...items.map(([a, b]) => [TD(a, { size: 7 }), TD(b, { size: 7 })])];
    prims.push(table(rx, y, [rw * 0.45, rw * 0.55], [14, ...items.map(() => 12.5)], rows, 7));
    y += 14 + items.length * 12.5 + 10;
  };
  listTable('금통위', evs.filter((e) => e.kind === '금통위' && inWin(e.event_dt)).map((e) => [mdwY(e.event_dt), e.note ?? '통화정책방향']));
  listTable('FOMC', evs.filter((e) => e.kind === 'FOMC' && inWin(e.event_dt)).map((e) => [`${md(e.event_dt)}~${md(e.end_dt ?? e.event_dt)}`, e.note ?? '']));
  listTable('정기보고서 제출기한', evs.filter((e) => e.kind === '정기보고서' && inWin(e.event_dt)).map((e) => [mdwY(e.event_dt), e.title.replace(' 제출기한', '')]));
  prims.push(...footnote(['자료: 한국은행, 미 연방준비제도(2027년 FOMC는 잠정), 금융감독원(12월 결산법인 기준)']));
  return { id: 'events', title: n.title, prims };
}
const mdwY = (s: string) => `${s.slice(2, 4)}.${md(s)}(${WD[weekday(s)]})`;
function addMonths(s: string, k: number) {
  const x = new Date(`${s}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + k);
  return x.toISOString().slice(0, 10);
}

// Appendix 데이터 사용 현황: 장표별 외부 데이터(출처·기준일)와 내부 데이터 연결 상태. 길면 여러 쪽.
function dataReportSlides({ d, inp, plan }: Ctx, n: Numbered): Body[] {
  const rep = dataReport(d, inp, available(d, inp), plan);
  const size = 7;
  const W = [118, 300, CW - 118 - 300];
  const fmtExt = (s: (typeof rep.items)[number]['srcs'][number]) => `${s.status === 'missing' ? '!!없음!! ' : s.status === 'alt' ? '^^대체^^ ' : ''}${s.label} — ${s.source}${s.asof ? ` (${yymmdd(s.asof)})` : ''}${s.note ? ` · ${s.note}` : ''}`;
  const fmtInt = (s: (typeof rep.items)[number]['srcs'][number]) => s.status === 'used' ? `^^연결^^ ${s.label} (${s.source})` : `!!미연결!! ${s.label} (${s.source})${s.note ? ` → ${s.note}` : ''}`;
  const body: (Cell | null)[][] = rep.items.filter((x) => x.id !== 'datareport').map((x) => {
    const e = x.srcs.filter((s) => s.kind === 'ext').map(fmtExt);
    const i = x.srcs.filter((s) => s.kind === 'int').map(fmtInt);
    return [LB(x.label, { size, align: 'l' }), { paras: (e.length ? e : ['–']).map((t) => P(t, { bullet: e.length > 0 })), size, align: 'l', valign: 'm' } as Cell, { paras: (i.length ? i : ['–']).map((t) => P(t, { bullet: i.length > 0 })), size, align: 'l', valign: 'm' } as Cell];
  });
  for (const o of rep.omitted) body.push([LB(o.label, { size, align: 'l', color: C.muted }), TD(`생략 — ${o.reason}`, { size, align: 'l', color: C.muted, colspan: 2 }), null]);
  const hOf = (r: (Cell | null)[]) => Math.max(14, ...r.map((c, k) => (c ? textHeight(c.paras, W[k] * (c.colspan === 2 ? 1 + W[2] / W[1] : 1) - 8, size, false, 1.3, BULLET_INDENT(size)) + 6 : 0)));
  const head = [TH('장표', { size: 7.5 }), TH('사용한 외부 데이터 (출처 · 기준일)', { size: 7.5 }), TH('내부 데이터 (사내 연계 시)', { size: 7.5 })];
  const summary = callout(78, rep.intMissing.map((m) => `${m.label}(${m.source}): ${m.items.join(', ')} — ${m.note}`).slice(0, 4),
    `외부 데이터 ${rep.extSources.length}개 출처 사용 · 내부 데이터 미연결 ${rep.intMissing.length}건${rep.omitted.length ? ` · 생략 ${rep.omitted.length}장` : ''}`, 90);
  const pages: (Cell | null)[][][] = [[]];
  let y = summary.bottom + 10 + 18 + 18;
  for (const r of body) {
    const h = hOf(r);
    if (y + h > BOTTOM && pages[pages.length - 1].length) {
      pages.push([]);
      y = 78 + 18 + 18;
    }
    pages[pages.length - 1].push(r);
    y += h;
  }
  return pages.map((pg, i) => {
    const prims: Prim[] = [titleBox(n.head, n.sub, i > 0)];
    let top = 78;
    if (i === 0) {
      prims.push(...summary.prims);
      top = summary.bottom + 10;
    }
    prims.push(...goldTitle(top, '장표별 데이터 사용 현황', X0, X1, `${yymmdd(d.asof)} 기준`));
    prims.push(table(X0, top + 18, W, [18, ...pg.map(hOf)], [head, ...pg], size));
    prims.push(...footnote(['주) 외부 데이터는 사외에서 누구나 접근 가능한 공개 자료, 내부 데이터는 NH 자체 자료와 구독 데이터(민평 4사·FnGuide 등)로 사내 시스템에서 연계하면 채워짐. 대체는 내부·최신 자료 대신 쓴 공개 자료.']));
    return { id: `datareport-${i}`, title: n.title, prims };
  });
}

// ---------------------------------------------------------------------------------------------
// 데이터가 없는 항목은 목차에서 뺀다
export function available(d: DeckData, inp: DeckInput) {
  return (id: ItemId) => {
    if (id === 'views') return d.views.length > 0;
    if (id === 'usviews') return d.usViews.length > 0;
    if (id === 'bok') return !!d.policy.bok;
    if (id === 'fomc') return !!d.policy.fomc;
    if (id === 'forecast') return !!d.forecast || parseTsv(inp.internal?.rateFc ?? '').length >= 2;
    if (id === 'credit_fc') return parseTsv(inp.internal?.creditFc ?? '').length >= 2 || creditNotesOf(d).some((x) => x.date >= addMonths(d.asof, -2));
    if (id === 'sales') return d.own.some((p) => p.tranches.some((t) => t.byType?.length)) || parseTsv(inp.internal?.investors ?? '').length >= 2 || d.peers.some((p) => p.tranches.some((t) => t.byType?.length));
    if (id === 'compare') return inp.compareKeys.length > 0;
    if (id === 'league') return d.leagueYearly.length > 0;
    return true;
  };
}

export function buildSlides(d: DeckData, inp: DeckInput, tx: DeckText): Slide[] {
  const plan = planOf(inp.items, available(d, inp));
  const ctx: Ctx = { d, inp, tx, plan };
  const out: Slide[] = [];
  const nextPage = () => out.length + 1;
  const add = (b: Body | Body[]) => {
    for (const x of Array.isArray(b) ? b : [b]) out.push(body(x, nextPage()));
  };
  for (const id of plan.front) {
    if (id === 'cover') out.push(cover(inp));
    if (id === 'ceo') out.push(...staticSlides('ceo', null, nextPage));
    if (id === 'contents') out.push(contents(plan));
  }
  for (const sec of plan.sections) {
    {
      for (const n of sec.items) {
        const k = ALL_ITEMS.find((i) => i.id === n.id)!.kind;
        if (k === 'static') {
          for (const s of staticSlides(n.id, n, () => out.length + 1)) out.push(s);
          continue;
        }
        switch (n.id) {
          case 'terms': add(terms(ctx, n)); break;
          case 'sizing': add(sizing(ctx, n)); break;
          case 'schedule': add(schedule(ctx, n)); break;
          case 'sales': add(sales(ctx, n)); break;
          case 'pipeline': add(pipeline(ctx, n)); break;
          case 'rates': add(ratesSlide(ctx, n)); break;
          case 'bok': add(meeting(ctx, n, 'bok')); break;
          case 'fomc': add(meeting(ctx, n, 'fomc')); break;
          case 'views': add(viewsSlide(ctx, n)); break;
          case 'usviews': add(usViewsSlide(ctx, n)); break;
          case 'forecast': add(forecastSlide(ctx, n)); break;
          case 'credit_fc': add(creditSlide(ctx, n)); break;
          case 'datareport': add(dataReportSlides(ctx, n)); break;
          case 'peers': add(peersSlides(ctx, n)); break;
          case 'compare': add(compare(ctx, n)); break;
          case 'corp': add(corp(ctx, n)); break;
          case 'league': add(leagueSlide(ctx, n)); break;
          case 'strength': add(strength(ctx, n)); break;
          case 'maturity': add(maturity(ctx, n)); break;
          case 'events': add(events(ctx, n)); break;
          default: break;
        }
      }
    }
  }
  if (plan.back) out.push(back(inp));
  return out;
}

export { cellBoxes, rich };
export const pageOf = PAGE;
// 템플릿 고정 장표의 자리 표시 바꾸기 (PPTX). 템플릿 파일에는 고객사 이름 대신 {{발행사}} 같은 자리 표시만 있다.
// 미리보기 그림은 '발행사/귀사·커버리지'로 일반화해 두었다.
export function staticSubs(d: DeckData, inp: DeckInput): Subs {
  const dept = (inp.coverDept || 'IB사업부').trim().replace(/부$/, '');
  return [
    ['{{발행사표기}}', inp.issuer || `㈜${d.company.corp_name}`],
    ['{{발행사}}', d.company.corp_name],
    ['{{부서}}', dept],
    ['{{등급}}', inp.rating || '동일 등급'],
  ];
}

export const fileBase = (inp: DeckInput) => `NH ${inp.issuer.replace(/[㈜()]/g, '').replace(/^주식회사\s*/, '')} 제${inp.series}회 공모사채 제안서`;
export { korDate, eokW };

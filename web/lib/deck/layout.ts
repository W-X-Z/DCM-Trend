// 장표 레이아웃: 데이터·입력·문안 → 슬라이드 표시 목록 (NH 서식, 대한항공 공모사채 제안서 2025-04 구성)
// 목차(catalog.ts)에서 켜진 항목만 순서대로 만든다. chrome 은 NH 레이아웃이 그리는 부분(PPTX 에서는 템플릿이 그림).
import type { Subs } from './assemble';
import { ALL_ITEMS, planOf, type ItemId, type Numbered, type Plan } from './catalog';
import {
  bandKind, bandRange, eok, eokW, mdw, rate2, rate3, ratioX, shortFirm, years, yy, yymmdd,
} from './fmt';
import {
  BULLET_INDENT, P, cellBoxes, rich, textHeight, type Cell, type Para, type Prim, type Slide, type SlideLayout, type Table,
} from './model';
import { fullUnder, peerPool, recentWindow, scheduleOf, tenorText, totalEok, verdictOf } from './rules';
import { WD, korDate, md, weekday } from './schedule';
import { C, PAGE, textW } from './theme';
import type { DeckData, DeckInput, DeckText, PeerIssue } from './types';

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

function contents(plan: Plan): Slide {
  const items = plan.sections.map((s) => (s.key === 'A' ? 'Appendix' : `${s.roman}. ${s.label}`));
  return {
    id: 'contents', title: 'Contents', layout: 'contents',
    chrome: [layoutBg('contents')],
    prims: [
      { k: 'text', x: 54.2, y: 120.3, w: 200, h: 38.8, paras: [P('Contents')], size: 32, color: '333333', bold: true, pad: 0, valign: 'm' },
      { k: 'text', x: 89.5, y: 173.6, w: 500, h: 260, paras: items.map((t, i) => ({ runs: [{ t }], gap: i ? 6 : 0 })), size: 20, color: '333333', bold: true, pad: 0, line: 2.0 },
    ],
  };
}

function folder(sec: Plan['sections'][number]): Slide {
  const title = sec.key === 'A' ? 'Appendix' : `${sec.roman}. ${sec.label}`;
  return {
    id: `folder-${sec.key}`, title, layout: 'folder', bg: C.navy,
    chrome: [layoutBg('folder')],
    prims: [
      { k: 'text', x: 39, y: 212, w: 280, h: 51, paras: [P(title)], size: 20, color: C.white, bold: true, valign: 'm', pad: 0 },
      {
        k: 'text', x: 100, y: 308, w: 640, h: 180, size: 16, color: C.white, pad: 0, line: 1.5,
        paras: sec.groups.map((g) => ({ runs: [{ t: `${g.no}.   ${g.title}` }] })),
      },
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
// I-1. 발행조건 제안(案)
function terms({ d, inp, tx }: Ctx, n: Numbered): Body {
  const sch = scheduleOf(d, inp);
  const c = callout(78, [tx.lead, ...tx.structure.slice(0, 2)], undefined, 80);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, '주요 발행 조건 제안(案)')];
  const tr = inp.tranches.filter((t) => t.tenor);
  const bandOf = () => (inp.band.type === 'later'
    ? '^^추후 결정^^'
    : inp.band.type === 'fixed' ? `고정금리 ${inp.band.low ?? '–'}% ~ ${inp.band.high ?? '–'}%` : `개별민평 ${inp.band.low ?? '–'}bp ~ +${inp.band.high ?? '–'}bp`);
  const fee = [
    ...(inp.feeLead != null ? [`대표주관수수료 ${inp.feeLead}bp`] : []),
    inp.feeUw != null ? `인수수수료 ${inp.feeUw}bp` : '인수수수료 협의',
  ].join(' / ');
  const multi = tr.length > 1;
  const rows: (Cell | null)[][] = [[TH('구분', { colspan: 2 }), null, TH('주요 내용'), TH('비고')]];
  rows.push([LB('신용등급(예상)', { colspan: 2 }), null, TD(inp.rating || '–'), note(inp.ratingNote)]);
  rows.push([LB('만기', { colspan: 2 }), null, TD(`^^${tenorText(inp) || '–'}^^`), note('')]);
  if (multi) {
    tr.forEach((t, i) => rows.push([
      i ? null : LB('발행금액', { rowspan: tr.length + (inp.maxEok ? 1 : 0), valign: 'm' }), LB(t.tenor), TD(`^^${t.eok != null ? `${t.eok.toLocaleString('ko-KR')}억원` : '–'}^^`),
      i ? null : { ...note('시장 상황에 따라 트랜치별 금액 조정 가능\n수요예측 결과에 따라 증액 여부 협의'), rowspan: tr.length + (inp.maxEok ? 1 : 0) },
    ]));
    if (inp.maxEok) rows.push([null, LB('증액옵션'), TD(`^^Max ${inp.maxEok.toLocaleString('ko-KR')}억원^^`), null]);
  } else {
    rows.push([LB('발행금액', { colspan: 2 }), null, TD(`^^${totalEok(inp) ? `${totalEok(inp).toLocaleString('ko-KR')}억원` : '–'}^^${inp.maxEok ? `\n(증액 시 Max ${inp.maxEok.toLocaleString('ko-KR')}억원)` : ''}`), note('수요예측 결과에 따라 증액 여부 협의')]);
  }
  rows.push([LB('금리 밴드', { colspan: 2 }), null, TD(bandOf()), note(inp.bandNote)]);
  rows.push([LB('이자지급', { colspan: 2 }), null, TD(inp.coupon), note(/월단위|매월/.test(inp.coupon) ? '리테일 투자자 선호 반영' : '')]);
  rows.push([LB('수요예측일', { colspan: 2 }), null, TD(sch ? `^^${mdw(sch.demand)}^^` : '–'), note(sch ? `수요예측 가능일 ${mdw(sch.demandOptions[0])} ~ ${mdw(sch.demandOptions[2])}` : '')]);
  rows.push([LB('발행일', { colspan: 2 }), null, TD(sch ? `^^${mdw(sch.pay)}^^` : '–'), note('시장 상황 고려 변경 가능')]);
  rows.push([LB('인수희망금액', { colspan: 2 }), null, TD(inp.uw), note('협의 가능')]);
  rows.push([LB('수수료', { colspan: 2 }), null, TD(fee), note(inp.feeNote)]);
  const tTop = top + 16;
  const rh = fitRows(rows.length - 1, tTop + 22, BOTTOM, 20, 30);
  prims.push(table(X0, tTop, [107.7, 107.7, 215.3, 258.3], [22, ...rows.slice(1).map(() => rh)], rows, 9));
  return { id: 'terms', title: n.title, prims };
}

// I-2. 적정 발행규모 및 트랜치 구성 검토
function sizing({ d, inp, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.sizing, undefined, 92);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const lw = 430;
  prims.push(...goldTitle(top, `${d.company.corp_name} 최근 공모사채 발행 결과`, X0, X0 + lw, '(단위: 억원, %)'));
  const own = d.own.slice(0, 6);
  const rows: (Cell | null)[][] = [[TH('회차'), TH('수요예측'), TH('만기'), TH('최초신고'), TH('참여\n(밴드내/총)'), TH('경쟁률'), TH('확정'), TH('발행금리')]];
  for (const p of own) {
    const trs = p.tranches.length ? p.tranches : [null];
    trs.forEach((t, i) => rows.push([
      i ? null : TD(`제${p.series ?? ''}회`, { rowspan: trs.length, valign: 'm', bold: true }),
      i ? null : TD(p.demand_dt ? yymmdd(p.demand_dt) : yy(p.deal_dt), { rowspan: trs.length, valign: 'm' }),
      TD(t?.tenor ?? '–'), TD(eok(t?.initial_krw)),
      TD(t && (t.in_band_krw != null || t.demand_krw != null) ? `${eok(t.in_band_krw ?? t.demand_krw)}/${eok(t.demand_krw)}` : '–'),
      TD((t?.under || (t?.ratio != null && t.ratio < 1)) ? `!!${ratioX(t?.ratio)}!!` : ratioX(t?.ratio)),
      TD(eok(t?.amount_krw)), TD(rate3(t?.yield_pct)),
    ]));
  }
  if (rows.length === 1) rows.push([TD('공모 회사채 발행 이력 없음', { colspan: 8 }), null, null, null, null, null, null, null]);
  const tTop = top + 20;
  const rh = fitRows(rows.length - 1, tTop + 24, BOTTOM, 14, 24);
  prims.push(table(X0, tTop, [44, 50, 38, 50, 74, 54, 46, 74], [24, ...rows.slice(1).map(() => rh)], rows, rows.length > 12 ? 7.5 : 8));

  // 오른쪽: 연도별 만기도래 막대 + 만기구조 비교
  const rx = X0 + lw + 14;
  const rw = X1 - rx;
  prims.push(...goldTitle(top, `${d.company.corp_name} 공모사채 만기도래`, rx, X1, '(단위: 억원)'));
  const byYear = new Map<string, number>();
  for (const m of d.maturities) byYear.set(m.dt.slice(0, 4), (byYear.get(m.dt.slice(0, 4)) ?? 0) + Number(m.amount_krw ?? 0));
  const ys = [...byYear.keys()].sort();
  const chartH = 150;
  if (ys.length) {
    prims.push({
      k: 'chart', x: rx + 6, y: top + 22, w: rw - 12, h: chartH,
      chart: { kind: 'bar', cats: ys.map((y) => `'${y.slice(2)}`), values: ys.map((y) => Math.round(byYear.get(y)! / 1e8)), labels: ys.map((y) => Math.round(byYear.get(y)! / 1e8).toLocaleString('ko-KR')), highlight: [], color: C.th, hiColor: C.yellow },
    });
  } else {
    prims.push({ k: 'text', x: rx, y: top + 60, w: rw, h: 30, paras: [P('향후 3년 내 만기 도래 공모사채 없음')], size: 9, color: C.muted, align: 'c', valign: 'm' });
  }
  const sy = top + 22 + chartH + 10;
  prims.push(...goldTitle(sy, '만기 구조 비교', rx, X1));
  const sr = tx.structureRows.length ? tx.structureRows : [{ label: tenorText(inp) || '–', desc: '' }];
  const srows: (Cell | null)[][] = [[TH('구조'), TH('근거')], ...sr.slice(0, 4).map((r) => [LB(r.label, { size: 8 }), { paras: r.desc.split('\n').filter(Boolean).map((x) => P(x, { bullet: true })), align: 'l', valign: 'm', size: 7.5 } as Cell])];
  const srh = fitRows(srows.length - 1, sy + 18 + 18, BOTTOM, 24, 50);
  prims.push(table(rx, sy + 18, [58, rw - 58], [18, ...srows.slice(1).map(() => srh)], srows, 7.5));
  prims.push(...footnote(['주) 참여·경쟁률은 발행조건확정 증권신고서(정정) 기준. 만기 구조 통계는 최근 6개월 같은 등급군 일반 공모 회사채.', '자료: 금융감독원 DART']));
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

// I-4. Sales 전략 (내부 자료 입력용 빈 표)
function sales({ d }: Ctx, n: Numbered): Body {
  const prims: Prim[] = [titleBox(n.head, n.sub)];
  const c = callout(78, ['기관별 수요예측 참여·배정 내역은 내부 자료로 채웁니다(공시에는 기관 유형별 합계만 있음).'], undefined, 60);
  prims.push(...c.prims, ...goldTitle(c.bottom + 10, `${d.company.corp_name} 수요예측 참여 / 배정 내역`, X0, X1, '(단위: 억원)'));
  const rows: (Cell | null)[][] = [[TH('기관명'), TH('구분'), TH('참여'), TH('배정'), TH('참여'), TH('배정'), TH('비고')], ...Array.from({ length: 14 }, () => Array.from({ length: 7 }, () => TD('')))];
  const tTop = c.bottom + 28;
  prims.push(table(X0, tTop, [170, 80, 70, 70, 70, 70, 159], [22, ...Array(14).fill(fitRows(14, tTop + 22, BOTTOM, 14, 26))], rows, 8.5));
  prims.push(...footnote(['주) 내부 수요예측 참여·배정 자료 입력용']));
  return { id: 'sales', title: n.title, prims };
}

// I-5. 회사채 수요예측 예정 내역
function pipeline({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.pipeline, undefined, 80);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, `${yymmdd(d.asof)} 현재 회사채 발행 예정 내역`, X0, X1, '(단위: 억원)')];
  const rows: (Cell | null)[][] = [[TH('발행회사'), TH('등급'), TH('만기'), TH('예측금액'), TH('공모밴드'), TH('수요예측'), TH('납입'), TH('대표주관')]];
  for (const p of d.pipeline.slice(0, 10)) {
    const trs = p.tranches.length ? p.tranches : [{ tenor: '–', months: null, initial_krw: null }];
    trs.forEach((t, i) => rows.push([
      i ? null : TD(p.corp_name + (p.sub_type && p.sub_type !== '일반회사채' ? `\n(${p.sub_type})` : ''), { rowspan: trs.length, valign: 'm', bold: true }),
      i ? null : TD(p.rating ?? '–', { rowspan: trs.length, valign: 'm' }),
      TD(t.tenor), TD(eok(t.initial_krw)),
      i ? null : TD(p.band_low != null ? `${bandKind(p.band_type)} ${bandRange(p)}` : '–', { rowspan: trs.length, valign: 'm' }),
      i ? null : TD(p.demand_dt ? mdw(p.demand_dt) : '–', { rowspan: trs.length, valign: 'm' }),
      i ? null : TD(p.pay_dt ? mdw(p.pay_dt) : '–', { rowspan: trs.length, valign: 'm' }),
      i ? null : TD((p.lead ?? '–').split(',').map((s) => shortFirm(s.trim())).join(', '), { rowspan: trs.length, valign: 'm', size: 7.5 }),
    ]));
  }
  if (rows.length === 1) rows.push([TD('현재 제출된 발행 예정 증권신고서 없음', { colspan: 8 }), null, null, null, null, null, null, null]);
  const tTop = top + 20;
  const rh = fitRows(rows.length - 1, tTop + 22, BOTTOM, 15, 28);
  prims.push(table(X0, tTop, [120, 50, 50, 62, 96, 72, 72, 167], [22, ...rows.slice(1).map(() => rh)], rows, 8.5));
  prims.push(...footnote(['주) 증권신고서를 제출했고 납입 전인 공모채(정정 신고 반영). 시장에서 파악되는 미제출 예정 건은 포함하지 않음.', '자료: 금융감독원 DART']));
  return { id: 'pipeline', title: n.title, prims };
}

// II-1 ① 금리 동향
function ratesSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.rates, undefined, 100);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const lw = 280;
  prims.push(...goldTitle(top, '주요 금리 현황', X0, X0 + lw, '(단위: %, bp)'));
  const keys = ['base_rate', 'cd91', 'ktb3y', 'ktb5y', 'ktb10y', 'corp3y_aa'];
  const rs = keys.map((k) => d.rates.find((r) => r.key === k)).filter(Boolean) as DeckData['rates'];
  const lrows: (Cell | null)[][] = [
    [TH('구분'), TH('금리'), TH('1개월'), TH('3개월')],
    ...rs.map((r) => [LB(r.label.replace('한국은행 ', '')), TD(r.key === 'base_rate' ? rate2(r.value) : rate3(r.value)), TD(bpS0(r.chg1m)), TD(bpS0(r.chg3m))]),
  ];
  const tTop = top + 20;
  prims.push(table(X0, tTop, [94, 62, 62, 62], [20, ...rs.map(() => 19)], lrows, 8.5));
  // 향후 통화정책 일정
  const upcoming = d.events.filter((e) => (e.kind === '금통위' || e.kind === 'FOMC') && (e.end_dt ?? e.event_dt) > d.asof).slice(0, 5);
  if (upcoming.length) {
    const y2 = tTop + 20 + rs.length * 19 + 14;
    prims.push(...goldTitle(y2, '향후 통화정책 일정', X0, X0 + lw));
    const urows: (Cell | null)[][] = [
      [TH('구분'), TH('일정'), TH('비고')],
      ...upcoming.map((e) => [LB(e.kind === '금통위' ? '한국 금통위' : '미국 FOMC'), TD(e.kind === 'FOMC' && e.end_dt ? `${mdwY(e.event_dt)}~${md(e.end_dt)}` : mdwY(e.event_dt)), TD(e.note ?? (e.kind === '금통위' ? '통화정책방향' : ''), { size: 7.5 })]),
    ];
    prims.push(table(X0, y2 + 18, [78, 110, lw - 188], [18, ...upcoming.map(() => fitRows(upcoming.length, y2 + 36, BOTTOM, 14, 20))], urows, 8));
  }
  // 오른쪽: 금리 추이
  const rx = X0 + lw + 16;
  const rw = X1 - rx;
  prims.push(...goldTitle(top, '국고채·회사채 금리 추이 (최근 1년, 월말)', rx, X1, '(단위: %)'));
  prims.push(rateChart(d, rx, top + 22, rw, BOTTOM - top - 26));
  const base = d.rates.find((r) => r.key === 'base_rate');
  prims.push(...footnote([`자료: ${rateSource(d)}${base ? `, ${yymmdd(base.dt)} 기준` : ''}. 1개월·3개월은 변화폭(bp)`]));
  return { id: 'rates', title: n.title, prims };
}
function rateChart(d: DeckData, x: number, y: number, w: number, h: number): Prim {
  const ss = ['ktb3y', 'ktb10y', 'corp3y_aa'].map((k) => d.series.find((s) => s.key === k)).filter(Boolean) as DeckData['series'];
  if (!ss.length) return { k: 'text', x, y: y + 40, w, h: 40, paras: [P('금리 시계열이 6개월 미만이라 차트를 그리지 않았습니다.')], size: 9, color: C.muted, align: 'c', valign: 'm' };
  const months = [...new Set(ss.flatMap((s) => s.pts.map((p) => p[0].slice(0, 7))))].sort();
  const colors = [C.th, C.bar, C.yellow];
  const series = ss.map((s, i) => {
    const m = new Map(s.pts.map((p) => [p[0].slice(0, 7), p[1]]));
    return { name: s.label.replace('한국은행 ', ''), color: colors[i] ?? C.blue, values: months.map((mm) => m.get(mm) ?? null) };
  });
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  return {
    k: 'chart', x, y, w, h,
    chart: { kind: 'line', cats: months.map((mm) => `${mm.slice(2, 4)}.${mm.slice(5, 7)}`), series, min: Math.floor(Math.min(...all) * 4) / 4 - 0.25, max: Math.ceil(Math.max(...all) * 4) / 4, step: 0.25, unit: '%', labelEvery: months.length > 8 ? 2 : 1 },
  };
}
const rateSource = (d: DeckData) => (d.rates.some((r) => r.source === 'research') ? '한국은행 발표·금융 언론 보도 집계' : '한국은행 ECOS');
const bpS0 = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`);

// II-1 ②③ 금통위·FOMC 핵심 포인트
function meeting({ d, tx }: Ctx, n: Numbered, kind: 'bok' | 'fomc'): Body {
  const m = kind === 'bok' ? d.policy.bok : d.policy.fomc;
  const lines = kind === 'bok' ? tx.bok : tx.fomc;
  const c = callout(78, lines, undefined, 90);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  if (!m) {
    prims.push({ k: 'text', x: X0, y: top + 40, w: CW, h: 30, paras: [P('회의 요약 자료가 아직 없습니다.')], size: 10, color: C.muted, align: 'c', valign: 'm' });
    return { id: kind, title: n.title, prims };
  }
  const mo = Number(m.meeting_dt.slice(5, 7));
  prims.push(...goldTitle(top, `${mo}월 ${kind === 'bok' ? '금통위' : 'FOMC'} 핵심 포인트`));
  const ps: Para[] = m.points.flatMap((p, i) => [
    { runs: [{ t: `✓ ${p.label}`, b: true, color: C.red }], gap: i ? 8 : 0 },
    { runs: rich(p.text), bullet: true, gap: 2 },
  ]);
  const y = top + 22;
  // 상자를 채우도록 글자 크기를 고른다(11.5pt ~ 8.5pt)
  let size = 11.5;
  const fits = (sz: number) => textHeight(ps.map((p) => ({ ...p, gap: (p.gap ?? 0) * sz / 9.5 })), CW - 24, sz, false, 1.45, BULLET_INDENT(sz)) <= BOTTOM - y - 24;
  while (size > 8.5 && !fits(size)) size -= 0.5;
  const scaled = ps.map((p) => ({ ...p, gap: (p.gap ?? 0) * size / 9.5 }));
  prims.push({ k: 'rect', x: X0, y, w: CW, h: BOTTOM - y, stroke: C.grid, sw: 0.75 });
  prims.push({ k: 'text', x: X0, y, w: CW, h: BOTTOM - y, paras: scaled, size, color: C.ink, valign: 'm', pad: 12, line: 1.45 });
  prims.push(...footnote([`자료: ${m.sources.map((s) => `${s.title}${s.date ? ` ${yymmdd(s.date)}` : ''}`).join('; ')}`]));
  return { id: kind, title: n.title, prims };
}

// II-1 ④ 증권사별 국내 기준금리 전망
function viewsSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.views, undefined, 80);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, '증권사별 국내 기준금리 전망')];
  const vs = [...d.views].sort((a, b) => Number(/NH/.test(b.house)) - Number(/NH/.test(a.house))).slice(0, 10);
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
  prims.push(...footnote([`주) 기사·세미나 내용을 요약(원문 인용 아님). 자료: ${srcs.join('; ')}`], 497));
  return { id: 'views', title: n.title, prims };
}

// II-1 ⑤ 증권사별 미국 기준금리 전망
function usViewsSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.usviews, undefined, 70);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims, ...goldTitle(top, '주요 하우스별 미국 통화정책 전망')];
  const vs = [...d.usViews].sort((a, b) => Number(/NH/.test(b.house)) - Number(/NH/.test(a.house))).slice(0, 10);
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
  prims.push(...footnote([`주) 연준 정책금리 상단 기준. 기사·리포트 내용을 요약(원문 인용 아님). 자료: ${srcs.join('; ')}`], 497));
  return { id: 'usviews', title: n.title, prims };
}

// II-1 ⑥ 금리 전망(NH 리서치)
function forecastSlide({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.forecast, undefined, 110);
  const top = c.bottom + 14;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const fc = d.forecast;
  if (!fc) return { id: 'forecast', title: n.title, prims };
  prims.push(...goldTitle(top, `${fc.house} 리서치 주요 금리 전망 (${yymmdd(fc.published_dt)} 발표)`, X0, X1, '(단위: %)'));
  const periods = fc.rows[0]?.cells ?? [];
  const pw = (CW - 120 - 50) / Math.max(periods.length, 1);
  const rows: (Cell | null)[][] = [
    [TH('구분'), TH('기준'), ...periods.map((p) => TH(p.actual ? `${p.period}\n(실적)` : p.period))],
    ...fc.rows.map((r) => [LB(r.label), TD(r.basis), ...r.cells.map((x) => TD(rate2(x.value).replace('%', ''), { color: x.actual ? C.muted : undefined }))]),
  ];
  prims.push(table(X0, top + 20, [120, 50, ...periods.map(() => pw)], [30, ...fc.rows.map(() => 30)], rows, 9.5));
  prims.push(...footnote([`주) 기준금리는 기말, 국고채는 기간 평균. 발표 이후 금통위 결과는 반영되지 않음. 자료: ${fc.title}`]));
  return { id: 'forecast', title: n.title, prims };
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
      const dem = t ? (t.in_band_krw != null || t.demand_krw != null ? `${eok(t.in_band_krw ?? t.demand_krw)}/${eok(t.demand_krw)}` : '–') : '–';
      return [
        i ? null : cell(isSelf ? `^^${p.corp_name}^^` : p.corp_name, { bold: true, align: 'c', rowspan: span, valign: 'm', color: isSelf ? C.blue : undefined }),
        i ? null : TD(p.rating ?? '–', { rowspan: span, valign: 'm' }),
        TD(t ? years(t.months) : '–'), TD(eok(t?.initial_krw ?? p.initial_krw)), TD(eok(t?.amount_krw ?? p.amount_krw)), TD(rate3(t?.yield_pct)),
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
  const groups = peerRows(sel, d.company.corp_code);
  const hd: (Cell | null)[][] = [
    [TH('발행회사', { rowspan: 2 }), TH('신용\n등급', { rowspan: 2 }), TH('만기\n(Y)', { rowspan: 2 }), TH('예측금액\n(억)', { rowspan: 2 }), TH('발행금액\n(억)', { rowspan: 2 }), TH('발행금리', { rowspan: 2 }),
      TH('금리밴드', { colspan: 2 }), null, TH('수요예측', { rowspan: 2 }), TH('납입\n기일', { rowspan: 2 }), TH('예측결과(밴드내/총참여)', { colspan: 2 }), null],
    [null, null, null, null, null, null, TH('구분'), TH('bp / %'), null, null, TH('금액(억)'), TH('경쟁률')],
  ];
  const colW = [95, 50, 34, 54, 54, 56, 36, 70, 52, 52, 76, 60];
  // 첫 쪽은 요약 상자가 있어 행이 적다. 쪽마다 들어가는 행 수 = (표 영역 높이) / 최소 행 높이
  const c0 = callout(78, tx.peers, scheduleHead(d, inp), 130);
  const capOf = (top: number) => Math.max(4, Math.floor((BOTTOM - (top + 18 + 36)) / 17));
  const pages: (Cell | null)[][][][] = [[]];
  let count = 0;
  for (const g of groups) {
    const cap = pages.length === 1 ? capOf(c0.bottom + 10) : capOf(78);
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
    prims.push(...goldTitle(top, `최근 1년 ${scope}등급 공모 회사채 수요예측 결과`));
    const body = pg.flat();
    const rows = [...hd, ...(body.length ? body : [[TD('선택한 사례가 없습니다', { colspan: 12 }), null, null, null, null, null, null, null, null, null, null, null]])];
    const tTop = top + 18;
    const rh = fitRows(rows.length - 2, tTop + 36, BOTTOM, 16, 30);
    prims.push(table(X0, tTop, colW, [18, 18, ...rows.slice(2).map(() => rh)], rows, rows.length > 12 ? 8 : 8.5));
    prims.push(...footnote(['주) 일반 공모 회사채(신종·금융채 제외). 수요예측 결과는 발행조건확정 증권신고서(정정) 기준, 빨간색은 미달.', '자료: 금융감독원 DART']));
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
  const sub = under ? `${under.corp_name} 수요예측 미매각 사례 분석` : cmp.some((p) => p.under) ? n.sub : '수요예측 사례 비교분석';
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

// II-2 회사채 금리
function corp({ d, inp, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.corp, undefined, 100);
  const top = c.bottom + 12;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const lw = 380;
  prims.push(...goldTitle(top, '회사채 3년 AA- 신용스프레드 (국고채 3년 대비, 월말)', X0, X0 + lw, '(단위: bp)'));
  const k3 = d.series.find((s) => s.key === 'ktb3y');
  const aa = d.series.find((s) => s.key === 'corp3y_aa');
  if (k3 && aa) {
    const mk = new Map(k3.pts.map((p) => [p[0].slice(0, 7), p[1]]));
    const months = aa.pts.map((p) => p[0].slice(0, 7)).filter((m) => mk.has(m));
    const vals = months.map((m) => Math.round((aa.pts.find((p) => p[0].slice(0, 7) === m)![1] - mk.get(m)!) * 100));
    const lo = Math.floor(Math.min(...vals) / 10) * 10 - 10;
    const hi = Math.ceil(Math.max(...vals) / 10) * 10 + 10;
    prims.push({
      k: 'chart', x: X0, y: top + 22, w: lw, h: BOTTOM - top - 26,
      chart: { kind: 'line', cats: months.map((m) => `${m.slice(2, 4)}.${m.slice(5, 7)}`), series: [{ name: 'AA- 3년 − 국고 3년', color: C.th, values: vals }], min: lo, max: hi, step: Math.max(10, Math.round((hi - lo) / 50) * 10), unit: 'bp', labelEvery: months.length > 8 ? 2 : 1 },
    });
  } else {
    prims.push({ k: 'text', x: X0, y: top + 60, w: lw, h: 30, paras: [P('금리 시계열이 6개월 미만이라 차트를 그리지 않았습니다.')], size: 9, color: C.muted, align: 'c', valign: 'm' });
  }
  const rx = X0 + lw + 14;
  const rw = X1 - rx;
  const g = inp.peerScope === 'notch' && d.company.rating ? d.company.rating : `${d.company.rating_group ?? ''}`;
  const win = recentWindow(d, inp);
  prims.push(...goldTitle(top, `최근 ${win.months}개월 ${g}등급 발행금리`, rx, X1));
  const rows: (Cell | null)[][] = [[TH('납입일'), TH('발행회사'), TH('등급'), TH('만기'), TH('발행금리')]];
  for (const p of win.list.slice(0, 8)) {
    p.tranches.forEach((t, i) => rows.push([
      i ? null : TD(p.deal_dt ? md(p.deal_dt) : '–', { rowspan: p.tranches.length, valign: 'm' }),
      i ? null : TD(p.corp_name, { rowspan: p.tranches.length, valign: 'm', bold: true }),
      i ? null : TD(p.rating ?? '–', { rowspan: p.tranches.length, valign: 'm' }),
      TD(t.tenor), TD(rate3(t.yield_pct)),
    ]));
  }
  if (rows.length === 1) rows.push([TD(`최근 ${win.months}개월 발행 없음`, { colspan: 5 }), null, null, null, null]);
  const tTop = top + 22;
  prims.push(table(rx, tTop, [42, rw - 42 - 44 - 40 - 58, 44, 40, 58], [22, ...rows.slice(1).map(() => fitRows(rows.length - 1, tTop + 22, BOTTOM, 15, 28))], rows, 8));
  prims.push(...footnote([`자료: ${rateSource(d)}(시장금리, 월말 값), 금융감독원 DART(발행조건확정 공시)`]));
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

// Appendix 등급별 회사채 만기도래 현황
function maturity({ d, tx }: Ctx, n: Numbered): Body {
  const c = callout(78, tx.maturity, undefined, 70);
  const top = c.bottom + 10;
  const prims: Prim[] = [titleBox(n.head, n.sub), ...c.prims];
  const mg = d.maturityByGrade;
  prims.push(...goldTitle(top, `${mg.months[0]?.slice(0, 4)}~ 등급별 공모 회사채 만기도래 현황`, X0, X1, '(단위: 억원)'));
  const mw = (CW - 70 - 56) / mg.months.length;
  const rows: (Cell | null)[][] = [
    [TH('등급'), ...mg.months.map((m) => TH(`${m.slice(2, 4)}.${m.slice(5, 7)}`, { size: 7.5 })), TH('합계')],
    ...mg.rows.map((r) => [LB(r.grade, { size: 8 }), ...r.values.map((v) => TD(v ? Math.round(v / 1e8).toLocaleString('ko-KR') : '–', { size: 7.5 })), TD(Math.round(r.total / 1e8).toLocaleString('ko-KR'), { bold: true, size: 7.5 })]),
    [LB('합계', { fill: 'E7EEF6' }), ...mg.total.map((v) => TD(Math.round(v / 1e8).toLocaleString('ko-KR'), { bold: true, fill: 'E7EEF6', size: 7.5 })), TD(Math.round(mg.total.reduce((a, b) => a + b, 0) / 1e8).toLocaleString('ko-KR'), { bold: true, fill: 'E7EEF6', size: 7.5 })],
  ];
  const tTop = top + 20;
  prims.push(table(X0, tTop, [70, ...mg.months.map(() => mw), 56], [18, ...rows.slice(1).map(() => 17)], rows, 7.5));
  const g = d.company.rating_group;
  const gk = g === 'BBB' || g === 'BB' || g === 'B' ? 'BBB 이하' : g;
  const gr = mg.rows.find((r) => r.grade === gk) ?? null;
  const cy = tTop + 18 + (rows.length - 1) * 17 + 14;
  if (gr) {
    prims.push(...goldTitle(cy, `${gr.grade}등급 월별 만기도래`, X0, X1));
    prims.push({
      k: 'chart', x: X0 + 10, y: cy + 20, w: CW - 20, h: BOTTOM - cy - 22,
      chart: { kind: 'bar', cats: mg.months.map((m) => `${Number(m.slice(5, 7))}월`), values: gr.values.map((v) => Math.round(v / 1e8)), labels: gr.values.map((v) => (v ? Math.round(v / 1e8).toLocaleString('ko-KR') : '')), highlight: [], color: C.th, hiColor: C.yellow },
    });
  }
  prims.push(...footnote(['주) 일반 공모 회사채(신종·금융채·일괄신고 제외) 만기 기준. 등급은 발행 당시 등급.', '자료: 금융감독원 DART']));
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

// ---------------------------------------------------------------------------------------------
// 데이터가 없는 항목은 목차에서 뺀다
export function available(d: DeckData, inp: DeckInput) {
  return (id: ItemId) => {
    if (id === 'views') return d.views.length > 0;
    if (id === 'usviews') return d.usViews.length > 0;
    if (id === 'bok') return !!d.policy.bok;
    if (id === 'fomc') return !!d.policy.fomc;
    if (id === 'forecast') return !!d.forecast;
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
    if (sec.folder) out.push(folder(sec));
    for (const g of sec.groups) {
      for (const n of g.items) {
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

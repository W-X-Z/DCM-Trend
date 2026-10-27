// 슬라이드 표시 목록: 레이아웃이 만든 도형·글상자·표·차트를 렌더러(미리보기 HTML, PPTX, PDF)가 그대로 그린다.
// 좌표는 pt, 원점은 왼쪽 위.
import { LINE, textW } from './theme';

export type Run = { t: string; b?: boolean; u?: boolean; color?: string; size?: number };
export type Para = { runs: Run[]; bullet?: boolean; gap?: number }; // gap: 문단 앞 간격(pt)
export type Align = 'l' | 'c' | 'r';
export type VAlign = 't' | 'm' | 'b';

export type TextBox = {
  k: 'text'; x: number; y: number; w: number; h: number;
  paras: Para[]; size: number; color: string; bold?: boolean; xb?: boolean;
  align?: Align; valign?: VAlign; line?: number; pad?: number;
};
export type Rect = { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; dash?: boolean };
export type Line = { k: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; w: number };
// src: 'logo-color' | 'logo-white' | 정적 장표 그림 경로('/deck/static/…')
export type Img = { k: 'img'; x: number; y: number; w: number; h: number; src: string };

export type Cell = {
  paras: Para[]; fill?: string; color?: string; bold?: boolean; size?: number; align?: Align; valign?: VAlign;
  colspan?: number; rowspan?: number;
};
export type Table = {
  k: 'table'; x: number; y: number; colW: number[]; rowH: number[]; rows: (Cell | null)[][]; // null: 병합으로 가려진 칸
  size: number; color: string; grid: string; gridV?: boolean; // gridV: 세로선
  topLine?: string; // 표 위 굵은 선 색
};

export type BarChart = {
  kind: 'bar'; cats: string[]; values: number[]; labels: string[]; highlight: number[]; color: string; hiColor: string;
};
export type LineChart = {
  kind: 'line'; cats: string[]; series: { name: string; color: string; values: (number | null)[] }[];
  min: number; max: number; step: number; unit: string; labelEvery: number;
  ticks?: number[]; // 축 이름을 붙일 칸(없으면 labelEvery 간격)
  legend?: boolean; // 범례 (기본 표시)
  digits?: number; // 축 값 소수 자리 (없으면 간격으로 정함)
};
// 묶은 세로 막대(여러 계열, 쌓기 가능): DM 의 경제전망·점도표·월별 만기 차트
export type ColsChart = {
  kind: 'cols'; cats: string[]; series: { name: string; color: string; values: (number | null)[] }[];
  min: number; max: number; step: number; digits?: number; labels?: boolean; legend?: boolean; stacked?: boolean;
};
export type Chart = { k: 'chart'; x: number; y: number; w: number; h: number; chart: BarChart | LineChart | ColsChart };

// 축·값 표기: 1,000 이상은 천 단위 쉼표, 소수 자리는 digits(없으면 간격으로)
export function numLabel(v: number, digits: number) {
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : v.toFixed(digits);
}
export const axisDigits = (step: number, digits?: number) => digits ?? (step >= 1 ? 0 : step < 0.5 ? 2 : 1);
export const ticksOf = (min: number, max: number, step: number) => {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
};

export type Prim = TextBox | Rect | Line | Img | Table | Chart;
// layout: NH 템플릿 레이아웃. chrome 은 레이아웃이 그리는 부분(머리띠·로고·쪽번호 등)이라 PPTX 에서는 그리지 않고,
// 미리보기·PDF 에서만 그린다. static 은 템플릿 고정 장표(PPTX 는 원본 XML, 미리보기·PDF 는 그림)
export type SlideLayout = 'cover' | 'contents' | 'folder' | 'body' | 'back' | 'ceo';
export type Slide = {
  id: string; title: string; bg?: string; layout: SlideLayout; chrome: Prim[]; prims: Prim[];
  static?: { file: string; renumber?: string | null };
};

// 강조 표기: **굵게+밑줄**, !!빨강!!, ^^굵게^^
export function rich(s: string, base: Omit<Run, 't'> = {}): Run[] {
  const out: Run[] = [];
  const re = /\*\*(.+?)\*\*|!!(.+?)!!|\^\^(.+?)\^\^/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ ...base, t: s.slice(last, m.index) });
    if (m[1] != null) out.push({ ...base, t: m[1], b: true, u: true });
    else if (m[2] != null) out.push({ ...base, t: m[2], b: true, color: 'E0261B' });
    else out.push({ ...base, t: m[3], b: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ ...base, t: s.slice(last) });
  return out.length ? out : [{ ...base, t: '' }];
}
export const plain = (s: string) => s.replace(/\*\*|!!|\^\^/g, '');
export const P = (s: string, o: Omit<Para, 'runs'> = {}, base: Omit<Run, 't'> = {}): Para => ({ ...o, runs: rich(s, base) });

// 줄바꿈: 공백 단위로 끊고(한국어 keep-all), 한 단어가 폭을 넘으면 글자 단위로 끊는다.
export type LaidLine = { runs: Run[]; w: number };
export function wrapPara(p: Para, width: number, size: number, bold = false, bulletIndent = 0): LaidLine[] {
  const avail = width - (p.bullet ? bulletIndent : 0);
  type Tok = { t: string; r: Run };
  const toks: Tok[] = [];
  for (const r of p.runs) {
    for (const part of r.t.split(/(\s+)/)) if (part) toks.push({ t: part, r });
  }
  const lines: LaidLine[] = [];
  let cur: Run[] = [];
  let cw = 0;
  const push = (t: string, r: Run) => {
    const lastRun = cur[cur.length - 1];
    if (lastRun && lastRun.b === r.b && lastRun.u === r.u && lastRun.color === r.color && lastRun.size === r.size) lastRun.t += t;
    else cur.push({ ...r, t });
  };
  const flush = () => {
    // 줄 끝 공백 제거
    if (cur.length) cur[cur.length - 1].t = cur[cur.length - 1].t.replace(/\s+$/, '');
    lines.push({ runs: cur, w: cw });
    cur = [];
    cw = 0;
  };
  for (const tok of toks) {
    const isSpace = /^\s+$/.test(tok.t);
    if (isSpace && !cur.length) continue;
    const tw = textW(tok.t, tok.r.size ?? size, bold || !!tok.r.b);
    if (cw + tw <= avail || isSpace) {
      push(tok.t, tok.r);
      cw += tw;
      continue;
    }
    if (tw <= avail) {
      flush();
      push(tok.t, tok.r);
      cw = tw;
      continue;
    }
    // 긴 단어: 글자 단위
    for (const ch of tok.t) {
      const w = textW(ch, tok.r.size ?? size, bold || !!tok.r.b);
      if (cw + w > avail && cur.length) flush();
      push(ch, tok.r);
      cw += w;
    }
  }
  if (cur.length || !lines.length) flush();
  return lines;
}

export function textHeight(paras: Para[], width: number, size: number, bold = false, line = LINE, bulletIndent = 0) {
  let h = 0;
  paras.forEach((p, i) => {
    const n = wrapPara(p, width, size, bold, bulletIndent).length;
    h += (i ? (p.gap ?? 0) : 0) + n * size * line;
  });
  return h;
}

export const BULLET_INDENT = (size: number) => Math.round(size * 1.35);

// 병합을 반영한 표 칸 위치
export function cellBoxes(t: Table) {
  const xs = [t.x];
  for (const w of t.colW) xs.push(xs[xs.length - 1] + w);
  const ys = [t.y];
  for (const h of t.rowH) ys.push(ys[ys.length - 1] + h);
  const out: { r: number; c: number; cell: Cell; x: number; y: number; w: number; h: number }[] = [];
  t.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return;
      const cs = cell.colspan ?? 1;
      const rs = cell.rowspan ?? 1;
      out.push({ r, c, cell, x: xs[c], y: ys[r], w: xs[c + cs] - xs[c], h: ys[r + rs] - ys[r] });
    }),
  );
  return { boxes: out, xs, ys, w: xs[xs.length - 1] - t.x, h: ys[ys.length - 1] - t.y };
}

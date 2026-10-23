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
export type Img = { k: 'img'; x: number; y: number; w: number; h: number; src: 'logo-color' | 'logo-white' };

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
};
export type Chart = { k: 'chart'; x: number; y: number; w: number; h: number; chart: BarChart | LineChart };

export type Prim = TextBox | Rect | Line | Img | Table | Chart;
export type Slide = { id: string; title: string; bg?: string; prims: Prim[]; notes?: string };

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

// 선·묶은 막대 차트의 도형 계산(미리보기 SVG·PDF 가 같은 결과를 그린다). 좌표는 차트 왼쪽 위 기준 pt, y 는 아래로.
// PPTX 는 네이티브 차트(pptxgenjs)로 그려 이 계산을 쓰지 않는다.
import { axisDigits, numLabel, ticksOf, type ColsChart, type LineChart } from './model';
import { C, textW } from './theme';

export type GText = { x: number; y: number; t: string; size: number; anchor: 'start' | 'middle' | 'end'; color: string; bold?: boolean };
export type Geom = {
  grid: { y: number; x1: number; x2: number }[];
  base: { y: number; x1: number; x2: number } | null; // 0 선(막대)
  rects: { x: number; y: number; w: number; h: number; color: string }[];
  paths: { color: string; pts: [number, number][] }[];
  texts: GText[];
  legend: { x: number; y: number; color: string; name: string; kind: 'line' | 'box' }[];
};

const AX = 6.5; // 축 글자 크기
const LEG = 7.5;

function legendRow(series: { name: string; color: string }[], x0: number, y: number, w: number, kind: 'line' | 'box') {
  // 가운데 정렬, 항목 폭 = 표식 + 이름
  const items = series.map((s) => ({ ...s, w: 16 + textW(s.name, LEG) + 10 }));
  const total = items.reduce((a, b) => a + b.w, 0);
  let x = x0 + Math.max(0, (w - total) / 2);
  return items.map((s) => {
    const out = { x, y, color: s.color, name: s.name, kind };
    x += s.w;
    return out;
  });
}

function yAxis(min: number, max: number, step: number, digits: number | undefined, top: number, bottom: number) {
  const ticks = ticksOf(min, max, step);
  const dg = axisDigits(step, digits);
  const labs = ticks.map((v) => numLabel(v, dg));
  const left = Math.max(...labs.map((l) => textW(l, AX))) + 8;
  const sy = (v: number) => top + (1 - (v - min) / (max - min || 1)) * (bottom - top);
  return { ticks, labs, left, sy };
}

export function lineGeom(c: LineChart, w: number, h: number): Geom {
  const legend = c.legend !== false && c.series.length > 0;
  const top = 6;
  const bottom = h - 14 - (legend ? 14 : 0);
  const { ticks, labs, left, sy } = yAxis(c.min, c.max, c.step, c.digits, top, bottom);
  const pw = w - left - 6;
  const sx = (i: number) => left + (c.cats.length <= 1 ? 0 : (i / (c.cats.length - 1)) * pw);
  const g: Geom = { grid: [], base: null, rects: [], paths: [], texts: [], legend: [] };
  ticks.forEach((v, i) => {
    g.grid.push({ y: sy(v), x1: left, x2: left + pw });
    g.texts.push({ x: left - 4, y: sy(v) + 2.5, t: labs[i], size: AX, anchor: 'end', color: C.sub });
  });
  const marks = c.ticks ?? c.cats.map((_, i) => i).filter((i) => i % Math.max(1, c.labelEvery) === 0);
  for (const i of marks) g.texts.push({ x: sx(i), y: bottom + 10, t: c.cats[i], size: AX, anchor: 'middle', color: C.sub });
  for (const s of c.series) {
    const pts: [number, number][] = [];
    s.values.forEach((v, i) => {
      if (v == null) return;
      pts.push([sx(i), sy(Math.max(c.min, Math.min(c.max, v)))]);
    });
    g.paths.push({ color: s.color, pts });
  }
  if (legend) g.legend = legendRow(c.series, 0, h - 6, w, 'line');
  return g;
}

export function colsGeom(c: ColsChart, w: number, h: number): Geom {
  const legend = c.legend !== false && c.series.length > 1;
  const labels = c.labels !== false && !c.stacked;
  const top = labels || (c.stacked && c.labels !== false) ? 12 : 6;
  const bottom = h - 14 - (legend ? 14 : 0);
  const { ticks, labs, left, sy } = yAxis(c.min, c.max, c.step, c.digits, top, bottom);
  const pw = w - left - 4;
  const n = c.cats.length;
  const slot = pw / Math.max(n, 1);
  const g: Geom = { grid: [], base: null, rects: [], paths: [], texts: [], legend: [] };
  ticks.forEach((v, i) => {
    g.grid.push({ y: sy(v), x1: left, x2: left + pw });
    g.texts.push({ x: left - 4, y: sy(v) + 2.5, t: labs[i], size: AX, anchor: 'end', color: C.sub });
  });
  const zero = sy(Math.max(c.min, Math.min(c.max, 0)));
  g.base = { y: zero, x1: left, x2: left + pw };
  const dg = c.digits ?? 0;
  const ns = c.series.length;
  const groupW = slot * (c.stacked ? 0.55 : Math.min(0.8, 0.35 + 0.18 * ns));
  const bw = c.stacked ? groupW : groupW / Math.max(ns, 1);
  // 칸 이름이 많으면 건너뛰며 쓴다
  const catW = Math.max(...c.cats.map((k) => textW(k, AX)));
  const every = Math.max(1, Math.ceil((catW + 4) / slot));
  c.cats.forEach((k, i) => {
    const x0 = left + slot * i + (slot - groupW) / 2;
    let acc = 0;
    c.series.forEach((s, si) => {
      const v = s.values[i];
      if (v == null || v === 0) {
        if (labels && v === 0) g.texts.push({ x: x0 + bw * si + bw / 2, y: zero - 3, t: numLabel(0, dg), size: AX, anchor: 'middle', color: C.ink });
        return;
      }
      if (c.stacked) {
        const y1 = sy(acc + v);
        const y0 = sy(acc);
        g.rects.push({ x: x0, y: Math.min(y0, y1), w: bw, h: Math.abs(y0 - y1), color: s.color });
        acc += v;
        return;
      }
      const yv = sy(Math.max(c.min, Math.min(c.max, v)));
      const bx = x0 + bw * si;
      g.rects.push({ x: bx + bw * 0.06, y: Math.min(yv, zero), w: bw * 0.88, h: Math.abs(zero - yv), color: s.color });
      if (labels) g.texts.push({ x: bx + bw / 2, y: (v >= 0 ? yv : yv + 8) - 3, t: numLabel(v, dg), size: AX, anchor: 'middle', color: C.ink });
    });
    // 쌓은 막대는 합계를 막대 위에
    if (c.stacked && c.labels !== false && acc) g.texts.push({ x: x0 + bw / 2, y: sy(Math.min(c.max, acc)) - 3, t: numLabel(acc, dg), size: AX, anchor: 'middle', color: C.ink });
    if (i % every === 0) g.texts.push({ x: left + slot * i + slot / 2, y: bottom + 10, t: k, size: AX, anchor: 'middle', color: C.sub });
  });
  if (legend) g.legend = legendRow(c.series, 0, h - 6, w, 'box');
  return g;
}

// 날짜 칸(YYYY-MM-DD)의 축 이름: 몇 달 간격으로 달이 바뀌는 칸에 'yy/mm'
export function dateTicks(dates: string[], maxLabels = 7) {
  const starts: number[] = [];
  dates.forEach((d, i) => {
    if (i === 0 || d.slice(0, 7) !== dates[i - 1].slice(0, 7)) starts.push(i);
  });
  // 간격은 12의 약수(1·2·3·4·6개월) 또는 해 단위, 1월이 들어가게(1·4·7·10월 같은 자리)
  const k = [1, 2, 3, 4, 6, 12, 24, 36].find((x) => starts.length / x <= maxLabels) ?? 48;
  const ticks = starts.filter((i) => {
    const m = Number(dates[i].slice(5, 7)) - 1;
    if (k < 12) return m % k === 0;
    return m === 0 && Number(dates[i].slice(0, 4)) % (k / 12) === 0;
  });
  return { ticks, cats: dates.map((d) => `${d.slice(2, 4)}/${d.slice(5, 7)}`) };
}

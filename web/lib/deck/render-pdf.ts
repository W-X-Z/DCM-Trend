// PDF 렌더러 (브라우저에서 실행). 나눔고딕을 내장하고(사용한 글자만), 표시 목록을 그대로 그린다.
import { BULLET_INDENT, cellBoxes, wrapPara, type Para, type Prim, type Slide, type Table, type TextBox, type BarChart, type LineChart } from './model';
import { C, LINE, PAGE } from './theme';

type PDFLib = typeof import('pdf-lib');
type Font = Awaited<ReturnType<import('pdf-lib').PDFDocument['embedFont']>>;
type Page = ReturnType<import('pdf-lib').PDFDocument['addPage']>;
type FK = { hasGlyphForCodePoint(cp: number): boolean };

// 나눔고딕에 없는 글자 → 대체 표기
const SUB: Record<string, string> = {
  '㈜': '(주)', '案': '안', '▪': '■', '∼': '~', '−': '-', '中': '중', '前': '전', '內': '내', '✓': '√',
  '韓': '한', '美': '미', 'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', '①': '(1)', '②': '(2)', '③': '(3)', '④': '(4)', '⑤': '(5)', '⑥': '(6)', '⑦': '(7)', '⑧': '(8)',
};

async function bytes(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`파일을 불러오지 못했습니다 (${url})`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function toPdf(slides: Slide[], title: string): Promise<Blob> {
  const lib: PDFLib = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const [rB, bB, xB] = await Promise.all([
    bytes('/deck/NanumGothic-Regular.ttf'), bytes('/deck/NanumGothic-Bold.ttf'), bytes('/deck/NanumGothic-ExtraBold.ttf'),
  ]);
  const doc = await lib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setAuthor('NH투자증권');
  doc.setCreator('발행시장 트렌드 제안서 작성');
  const fR = await doc.embedFont(rB, { subset: true });
  const fB = await doc.embedFont(bB, { subset: true });
  // ExtraBold 는 pdf-lib 부분 내장 시 일부 글자가 빠져 통째로 내장한다(약 2MB)
  const fX = await doc.embedFont(xB, { subset: false });
  const glyphs = (fontkit as unknown as { create(b: Uint8Array): FK }).create(rB);
  // 그림: 로고(png), 레이아웃 배경·고정 장표(jpg). 장표에 쓰인 것만 한 번씩 내장한다.
  const imgUrl = (src: string) => (src === 'logo-color' ? '/deck/nh-logo-color.png' : src === 'logo-white' ? '/deck/nh-logo-white.png' : src);
  const srcs = [...new Set(slides.flatMap((sl) => [...sl.chrome, ...sl.prims]).filter((p) => p.k === 'img').map((p) => (p as { src: string }).src))];
  const imgs: Record<string, Awaited<ReturnType<typeof doc.embedPng>>> = {};
  await Promise.all(srcs.map(async (src) => {
    const url = imgUrl(src);
    const b = await bytes(url);
    imgs[src] = /\.png$/i.test(url) ? await doc.embedPng(b) : await doc.embedJpg(b);
  }));

  const clean = (s: string) => {
    let o = '';
    for (const ch of s) {
      const sub = SUB[ch];
      if (sub && !glyphs.hasGlyphForCodePoint(ch.codePointAt(0)!)) o += sub;
      else if (ch === ' ') o += ' ';
      else o += glyphs.hasGlyphForCodePoint(ch.codePointAt(0)!) ? ch : '?';
    }
    return o;
  };
  const col = (hex: string) => lib.rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
  const Y = (y: number) => PAGE.h - y;

  function drawParas(page: Page, paras: Para[], box: { x: number; y: number; w: number; h: number }, o: { size: number; color: string; bold?: boolean; xb?: boolean; align?: string; valign?: string; line: number }) {
    const ind = BULLET_INDENT(o.size);
    const laid = paras.map((p) => ({ p, lines: wrapPara({ ...p, runs: p.runs.map((r) => ({ ...r, t: r.t })) }, box.w, o.size, o.bold || o.xb, ind) }));
    const lh = o.size * o.line;
    const total = laid.reduce((s, x, i) => s + (i ? x.p.gap ?? 0 : 0) + x.lines.length * lh, 0);
    let y = o.valign === 'm' ? box.y + (box.h - total) / 2 : o.valign === 'b' ? box.y + box.h - total : box.y;
    laid.forEach(({ p, lines }, pi) => {
      if (pi) y += p.gap ?? 0;
      lines.forEach((ln, li) => {
        const fontOf = (b?: boolean) => (o.xb ? fX : b || o.bold ? fB : fR);
        const widths = ln.runs.map((r) => fontOf(r.b).widthOfTextAtSize(clean(r.t), r.size ?? o.size));
        const lw = widths.reduce((a, b) => a + b, 0);
        const left = box.x + (p.bullet ? ind : 0);
        const avail = box.w - (p.bullet ? ind : 0);
        let x = o.align === 'c' ? left + (avail - lw) / 2 : o.align === 'r' ? left + avail - lw : left;
        const base = y + (lh - o.size) / 2 + o.size * 0.84;
        if (p.bullet && li === 0) {
          const s = o.size * 0.34;
          page.drawRectangle({ x: box.x + o.size * 0.25, y: Y(y + lh / 2 + s / 2), width: s, height: s, color: col(o.color) });
        }
        ln.runs.forEach((r, i) => {
          const t = clean(r.t);
          const sz = r.size ?? o.size;
          const f = fontOf(r.b);
          if (t) page.drawText(t, { x, y: Y(base), size: sz, font: f, color: col(r.color ?? o.color) });
          if (r.u && t) page.drawLine({ start: { x, y: Y(base + sz * 0.13) }, end: { x: x + widths[i], y: Y(base + sz * 0.13) }, thickness: Math.max(0.5, sz * 0.06), color: col(r.color ?? o.color) });
          x += widths[i];
        });
        y += lh;
      });
    });
  }

  function text(page: Page, t: TextBox) {
    const pad = t.pad ?? 4;
    drawParas(page, t.paras, { x: t.x + pad, y: t.y + pad, w: t.w - pad * 2, h: t.h - pad * 2 }, {
      size: t.size, color: t.color, bold: t.bold, xb: t.xb, align: t.align, valign: t.valign, line: t.line ?? LINE,
    });
  }

  function table(page: Page, t: Table) {
    const { boxes } = cellBoxes(t);
    for (const b of boxes) {
      if (b.cell.fill) page.drawRectangle({ x: b.x, y: Y(b.y + b.h), width: b.w, height: b.h, color: col(b.cell.fill) });
    }
    const g = col(t.grid);
    for (const b of boxes) {
      page.drawLine({ start: { x: b.x, y: Y(b.y) }, end: { x: b.x + b.w, y: Y(b.y) }, thickness: 0.5, color: g });
      page.drawLine({ start: { x: b.x, y: Y(b.y + b.h) }, end: { x: b.x + b.w, y: Y(b.y + b.h) }, thickness: 0.5, color: g });
      if (t.gridV) {
        page.drawLine({ start: { x: b.x, y: Y(b.y) }, end: { x: b.x, y: Y(b.y + b.h) }, thickness: 0.5, color: g });
        page.drawLine({ start: { x: b.x + b.w, y: Y(b.y) }, end: { x: b.x + b.w, y: Y(b.y + b.h) }, thickness: 0.5, color: g });
      }
      drawParas(page, b.cell.paras, { x: b.x + 3, y: b.y + 1, w: b.w - 6, h: b.h - 2 }, {
        size: b.cell.size ?? t.size, color: b.cell.color ?? t.color, bold: b.cell.bold, align: b.cell.align ?? 'c', valign: b.cell.valign ?? 'm', line: 1.18,
      });
    }
  }

  function bar(page: Page, c: BarChart, x0: number, y0: number, w: number, h: number) {
    const max = Math.max(...c.values, 1);
    const slot = w / c.values.length;
    const bw = Math.min(34, slot * 0.55);
    const base = y0 + h - 18;
    page.drawLine({ start: { x: x0, y: Y(base) }, end: { x: x0 + w, y: Y(base) }, thickness: 0.75, color: col(C.grid) });
    c.values.forEach((v, i) => {
      const bh = (v / max) * (h - 34);
      const cx = x0 + slot * i + slot / 2;
      const hi = c.highlight.includes(i);
      page.drawRectangle({ x: cx - bw / 2, y: Y(base), width: bw, height: bh, color: col(hi ? c.hiColor : c.color) });
      const f = hi ? fB : fR;
      const lab = clean(c.labels[i]);
      page.drawText(lab, { x: cx - f.widthOfTextAtSize(lab, 8.5) / 2, y: Y(base - bh - 4), size: 8.5, font: f, color: col(C.ink) });
      const cat = clean(c.cats[i]);
      page.drawText(cat, { x: cx - f.widthOfTextAtSize(cat, 8.5) / 2, y: Y(base + 12), size: 8.5, font: f, color: col(C.sub) });
    });
  }

  function line(page: Page, c: LineChart, x0: number, y0: number, w: number, h: number) {
    const left = 28;
    const bottom = h - 34;
    const pw = w - left - 6;
    const sx = (i: number) => x0 + left + (c.cats.length <= 1 ? 0 : (i / (c.cats.length - 1)) * pw);
    const sy = (v: number) => y0 + 6 + (1 - (v - c.min) / (c.max - c.min || 1)) * (bottom - 6);
    for (let v = c.min; v <= c.max + 1e-9; v += c.step) {
      page.drawLine({ start: { x: x0 + left, y: Y(sy(v)) }, end: { x: x0 + left + pw, y: Y(sy(v)) }, thickness: 0.5, color: col(C.grid) });
      const lab = v.toFixed(c.step >= 1 ? 0 : c.step < 0.5 ? 2 : 1);
      page.drawText(lab, { x: x0 + left - 4 - fR.widthOfTextAtSize(lab, 7), y: Y(sy(v) + 3), size: 7, font: fR, color: col(C.sub) });
    }
    c.cats.forEach((k, i) => {
      if (i % c.labelEvery) return;
      page.drawText(k, { x: sx(i) - fR.widthOfTextAtSize(k, 7) / 2, y: Y(y0 + bottom + 11), size: 7, font: fR, color: col(C.sub) });
    });
    c.series.forEach((s, si) => {
      let prev: [number, number] | null = null;
      s.values.forEach((v, i) => {
        if (v == null) return;
        const pt: [number, number] = [sx(i), sy(v)];
        if (prev) page.drawLine({ start: { x: prev[0], y: Y(prev[1]) }, end: { x: pt[0], y: Y(pt[1]) }, thickness: 1.8, color: col(s.color) });
        prev = pt;
      });
      const lx = x0 + left + si * 110;
      const ly = y0 + h - 10;
      page.drawLine({ start: { x: lx, y: Y(ly - 3) }, end: { x: lx + 14, y: Y(ly - 3) }, thickness: 2, color: col(s.color) });
      page.drawText(clean(s.name), { x: lx + 18, y: Y(ly), size: 7.5, font: fR, color: col(C.ink) });
    });
  }

  function prim(page: Page, p: Prim) {
    switch (p.k) {
      case 'rect':
        page.drawRectangle({
          x: p.x, y: Y(p.y + p.h), width: p.w, height: p.h, color: p.fill ? col(p.fill) : undefined,
          borderColor: p.stroke ? col(p.stroke) : undefined, borderWidth: p.stroke ? p.sw ?? 0.75 : 0, borderDashArray: p.dash ? [2, 2] : undefined,
        });
        return;
      case 'line':
        page.drawLine({ start: { x: p.x1, y: Y(p.y1) }, end: { x: p.x2, y: Y(p.y2) }, thickness: p.w, color: col(p.color) });
        return;
      case 'img':
        if (imgs[p.src]) page.drawImage(imgs[p.src], { x: p.x, y: Y(p.y + p.h), width: p.w, height: p.h });
        return;
      case 'text':
        text(page, p);
        return;
      case 'table':
        table(page, p);
        return;
      case 'chart':
        if (p.chart.kind === 'bar') bar(page, p.chart, p.x, p.y, p.w, p.h);
        else line(page, p.chart, p.x, p.y, p.w, p.h);
    }
  }

  for (const s of slides) {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: col(s.bg ?? C.white) });
    for (const p of [...s.chrome, ...s.prims]) prim(page, p);
  }
  const out = await doc.save();
  return new Blob([out], { type: 'application/pdf' });
}

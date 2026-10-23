// PPTX 렌더러 (브라우저에서 실행). 표·차트는 PowerPoint에서 바로 고칠 수 있게 기본 표·차트로 만든다.
import type PptxGenJS from 'pptxgenjs';
import { BULLET_INDENT, type Cell, type Para, type Prim, type Slide, type Table, type TextBox } from './model';
import { C, FONT, LINE, PAGE } from './theme';

const IN = (pt: number) => pt / 72;
type Pptx = InstanceType<typeof PptxGenJS>;
type PSlide = ReturnType<Pptx['addSlide']>;

async function b64(url: string) {
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `image/png;base64,${btoa(s)}`;
}

const ALIGN = { l: 'left', c: 'center', r: 'right' } as const;
const VALIGN = { t: 'top', m: 'middle', b: 'bottom' } as const;

function runs(paras: Para[], size: number, color: string, bold: boolean, line: number, font: string) {
  const out: { text: string; options: Record<string, unknown> }[] = [];
  paras.forEach((p, pi) => {
    const rs = p.runs.length ? p.runs : [{ t: '' }];
    rs.forEach((r, ri) => {
      const last = ri === rs.length - 1;
      out.push({
        text: r.t,
        options: {
          fontFace: font,
          fontSize: r.size ?? size,
          color: r.color ?? color,
          bold: !!(r.b || bold),
          underline: r.u ? { style: 'sng' } : undefined,
          breakLine: last && pi < paras.length - 1,
          ...(ri === 0
            ? {
              bullet: p.bullet ? { characterCode: '25AA', indent: BULLET_INDENT(size) } : false,
              paraSpaceBefore: pi ? p.gap ?? 0 : 0,
              lineSpacing: Math.round(size * line * 10) / 10,
            }
            : {}),
        },
      });
    });
  });
  return out;
}

function addText(s: PSlide, t: TextBox) {
  const font = t.xb ? FONT.faceXB : FONT.face;
  s.addText(runs(t.paras, t.size, t.color, !!(t.bold || t.xb), t.line ?? LINE, font) as never, {
    x: IN(t.x), y: IN(t.y), w: IN(t.w), h: IN(t.h),
    align: ALIGN[t.align ?? 'l'], valign: VALIGN[t.valign ?? 't'],
    margin: Array(4).fill(t.pad ?? 4), fit: 'none', wrap: true, fontFace: font, fontSize: t.size, color: t.color,
  });
}

function addTable(s: PSlide, t: Table) {
  const line = (on: boolean) => (on ? { type: 'solid', pt: 0.5, color: t.grid } : { type: 'none' });
  const rows = t.rows.map((row) =>
    row
      .filter((c): c is Cell => c !== null)
      .map((c) => ({
        text: runs(c.paras, c.size ?? t.size, c.color ?? t.color, !!c.bold, 1.18, FONT.face),
        options: {
          fill: c.fill ? { color: c.fill } : undefined,
          align: ALIGN[c.align ?? 'c'], valign: VALIGN[c.valign ?? 'm'],
          colspan: c.colspan, rowspan: c.rowspan,
          border: [line(true), line(!!t.gridV), line(true), line(!!t.gridV)],
          margin: [1, 3, 1, 3],
          fontFace: FONT.face, fontSize: c.size ?? t.size, color: c.color ?? t.color,
        },
      })),
  );
  s.addTable(rows as never, {
    x: IN(t.x), y: IN(t.y), w: IN(t.colW.reduce((a, b) => a + b, 0)),
    colW: t.colW.map(IN), rowH: t.rowH.map(IN), autoPage: false,
  });
}

function addPrim(pptx: Pptx, s: PSlide, p: Prim, logos: Record<string, string>) {
  switch (p.k) {
    case 'rect':
      s.addShape(pptx.ShapeType.rect, {
        x: IN(p.x), y: IN(p.y), w: IN(p.w), h: IN(p.h),
        fill: p.fill ? { color: p.fill } : { type: 'none' } as never,
        line: p.stroke ? { color: p.stroke, width: p.sw ?? 0.75, dashType: p.dash ? 'dash' : 'solid' } : { type: 'none' } as never,
      });
      return;
    case 'line':
      s.addShape(pptx.ShapeType.line, { x: IN(Math.min(p.x1, p.x2)), y: IN(Math.min(p.y1, p.y2)), w: IN(Math.abs(p.x2 - p.x1)), h: IN(Math.abs(p.y2 - p.y1)), line: { color: p.color, width: p.w } });
      return;
    case 'img':
      s.addImage({ data: logos[p.src], x: IN(p.x), y: IN(p.y), w: IN(p.w), h: IN(p.h) });
      return;
    case 'text':
      addText(s, p);
      return;
    case 'table':
      addTable(s, p);
      return;
    case 'chart': {
      const c = p.chart;
      const box = { x: IN(p.x), y: IN(p.y), w: IN(p.w), h: IN(p.h) };
      if (c.kind === 'bar') {
        const hi = new Set(c.highlight);
        s.addChart(pptx.ChartType.bar, [
          { name: '실적', labels: c.cats, values: c.values.map((v, i) => (hi.has(i) ? 0 : v)) },
          { name: 'NH투자증권', labels: c.cats, values: c.values.map((v, i) => (hi.has(i) ? v : 0)) },
        ], {
          ...box, barDir: 'col', barGrouping: 'clustered', overlap: 100, barGapWidthPct: 90,
          chartColors: [c.color, c.hiColor], showLegend: false, showValue: true, dataLabelFormatCode: '#,##0;;',
          dataLabelPosition: 'outEnd', dataLabelFontSize: 9, dataLabelFontFace: FONT.face, dataLabelColor: C.ink,
          valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLabelFontSize: 9, catAxisLabelFontFace: FONT.face,
          catAxisLabelColor: C.sub, catAxisLineShow: true, catAxisLineColor: C.grid,
        } as never);
      } else {
        // 빈 주는 직전 값으로 채운다
        const series = c.series.map((sr) => {
          let prev: number | null = null;
          const values = sr.values.map((v) => (v == null ? prev : (prev = v)));
          const firstVal = values.find((v) => v != null) ?? 0;
          return { name: sr.name, labels: c.cats, values: values.map((v) => v ?? firstVal) };
        });
        s.addChart(pptx.ChartType.line, series, {
          ...box, chartColors: c.series.map((sr) => sr.color), lineSize: 2, lineDataSymbol: 'none',
          valAxisMinVal: c.min, valAxisMaxVal: c.max, valAxisMajorUnit: c.step, valAxisLabelFormatCode: c.step < 0.5 ? '0.00' : '0.0',
          valAxisLabelFontSize: 7.5, catAxisLabelFontSize: 7.5, catAxisLabelFrequency: c.labelEvery,
          catAxisLabelFontFace: FONT.face, valAxisLabelFontFace: FONT.face,
          valGridLine: { color: C.grid, size: 0.5 }, showLegend: true, legendPos: 'b', legendFontSize: 8, legendFontFace: FONT.face,
        } as never);
      }
    }
  }
}

export async function toPptx(slides: Slide[], fileName: string) {
  const { default: Pptx } = await import('pptxgenjs');
  const pptx = new Pptx();
  pptx.defineLayout({ name: 'NH', width: IN(PAGE.w), height: IN(PAGE.h) });
  pptx.layout = 'NH';
  pptx.author = 'NH투자증권';
  pptx.company = 'NH투자증권';
  pptx.title = fileName;
  pptx.theme = { headFontFace: FONT.face, bodyFontFace: FONT.face };
  const logos = { 'logo-color': await b64('/deck/nh-logo-color.png'), 'logo-white': await b64('/deck/nh-logo-white.png') };
  for (const sl of slides) {
    const s = pptx.addSlide();
    s.background = { color: sl.bg ?? C.white };
    for (const p of sl.prims) addPrim(pptx, s, p, logos);
  }
  const data = (await pptx.write({ outputType: 'blob' })) as Blob;
  return fixParagraphProps(data);
}

// pptxgenjs 는 여러 서식이 섞인 문단에서 <a:pPr> 를 글자 덩어리마다 넣는다. 문단당 하나만 남긴다.
async function fixParagraphProps(blob: Blob): Promise<Blob> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  for (const name of Object.keys(files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = strFromU8(files[name]);
    const fixed = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (whole, inner: string) => {
      let seen = false;
      const body = inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (m) => {
        if (seen) return '';
        seen = true;
        return m;
      });
      return `<a:p>${body}</a:p>`;
    });
    files[name] = strToU8(fixed);
  }
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

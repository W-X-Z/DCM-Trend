// PPTX 렌더러 (브라우저에서 실행). 표·차트는 PowerPoint에서 바로 고칠 수 있게 기본 표·차트로 만든다.
import type PptxGenJS from 'pptxgenjs';
import { BULLET_INDENT, axisDigits, type Cell, type Para, type Prim, type Slide, type Table, type TextBox } from './model';
import { assemble, type AsmSlide, type Subs } from './assemble';
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
    margin: [t.pad ?? 4, t.pad ?? 4, t.pad ?? 4, t.pad ?? 4], fit: 'none', wrap: true, fontFace: font, fontSize: t.size, color: t.color,
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
          // 칸 바탕은 늘 명시한다(비워 두면 템플릿 기본 표 스타일 색이 깔린다)
          fill: { color: c.fill ?? 'FFFFFF' },
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
      if (!logos[p.src]) return;
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
      } else if (c.kind === 'cols') {
        const dg = axisDigits(c.step, c.digits);
        const fmt = (d: number) => (d ? `#,##0.${'0'.repeat(d)}` : '#,##0');
        s.addChart(pptx.ChartType.bar, c.series.map((sr) => ({ name: sr.name, labels: c.cats, values: sr.values.map((v) => v ?? 0) })), {
          ...box, barDir: 'col', barGrouping: c.stacked ? 'stacked' : 'clustered', overlap: c.stacked ? 100 : 0, barGapWidthPct: c.stacked ? 60 : 80,
          chartColors: c.series.map((sr) => sr.color), showLegend: c.legend !== false && c.series.length > 1, legendPos: 't', legendFontSize: 7.5, legendFontFace: FONT.face,
          showValue: c.labels !== false && !c.stacked, dataLabelFormatCode: fmt(c.digits ?? 0), dataLabelPosition: 'outEnd', dataLabelFontSize: 7, dataLabelFontFace: FONT.face, dataLabelColor: C.ink,
          valAxisMinVal: c.min, valAxisMaxVal: c.max, valAxisMajorUnit: c.step, valAxisLabelFormatCode: fmt(dg), valAxisLabelFontSize: 7, valAxisLabelFontFace: FONT.face,
          valGridLine: { color: C.grid, size: 0.5 }, catAxisLabelFontSize: 7, catAxisLabelFontFace: FONT.face, catAxisLabelColor: C.sub,
        } as never);
      } else {
        // 빈 주는 직전 값으로 채운다
        const series = c.series.map((sr) => {
          let prev: number | null = null;
          const values = sr.values.map((v) => (v == null ? prev : (prev = v)));
          const firstVal = values.find((v) => v != null) ?? 0;
          return { name: sr.name, labels: c.cats, values: values.map((v) => v ?? firstVal) };
        });
        const dg = axisDigits(c.step, c.digits);
        // 축 이름 간격: 지정한 칸(ticks)이 있으면 그 평균 간격
        const every = c.ticks && c.ticks.length > 1 ? Math.max(1, Math.round((c.ticks[c.ticks.length - 1] - c.ticks[0]) / (c.ticks.length - 1))) : c.labelEvery;
        s.addChart(pptx.ChartType.line, series, {
          ...box, chartColors: c.series.map((sr) => sr.color), lineSize: c.cats.length > 200 ? 1 : 2, lineDataSymbol: 'none',
          valAxisMinVal: c.min, valAxisMaxVal: c.max, valAxisMajorUnit: c.step, valAxisLabelFormatCode: dg ? `#,##0.${'0'.repeat(dg)}` : '#,##0',
          valAxisLabelFontSize: 7.5, catAxisLabelFontSize: 7.5, catAxisLabelFrequency: every,
          catAxisLabelFontFace: FONT.face, valAxisLabelFontFace: FONT.face,
          valGridLine: { color: C.grid, size: 0.5 }, showLegend: c.legend !== false, legendPos: 'b', legendFontSize: 8, legendFontFace: FONT.face,
        } as never);
      }
    }
  }
}

// NH 템플릿(public/deck/nh-template.pptx)의 슬라이드 마스터·레이아웃 위에 장표를 얹는다.
// 데이터 장표는 pptxgenjs 로 내용만 그리고(머리띠·로고·쪽번호는 레이아웃), 고정 장표는 템플릿 원본 XML 을 쓴다.
export async function toPptx(slides: Slide[], fileName: string, subs: Subs = []) {
  const { default: Pptx } = await import('pptxgenjs');
  const pptx = new Pptx();
  pptx.defineLayout({ name: 'NH', width: IN(PAGE.w), height: IN(PAGE.h) });
  pptx.layout = 'NH';
  pptx.author = 'NH투자증권';
  pptx.company = 'NH투자증권';
  pptx.title = fileName;
  pptx.theme = { headFontFace: FONT.face, bodyFontFace: FONT.face };
  const logos = { 'logo-color': await b64('/deck/nh-logo-color.png'), 'logo-white': await b64('/deck/nh-logo-white.png') };
  const plan: AsmSlide[] = [];
  let gen = 0;
  for (const sl of slides) {
    if (sl.static) {
      plan.push({ kind: 'static', file: sl.static.file, renumber: sl.static.renumber });
      continue;
    }
    const s = pptx.addSlide();
    for (const p of sl.prims) addPrim(pptx, s, p, logos);
    gen += 1;
    plan.push({ kind: 'gen', genIndex: gen, layout: sl.layout });
  }
  const genBytes = gen ? await fixParagraphProps((await pptx.write({ outputType: 'uint8array' })) as Uint8Array) : null;
  const template = new Uint8Array(await (await fetch('/deck/nh-template.pptx')).arrayBuffer());
  const out = assemble(template, genBytes, plan, subs);
  return new Blob([out as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

// pptxgenjs 는 여러 서식이 섞인 문단에서 <a:pPr> 를 글자 덩어리마다 넣는다. 문단당 하나만 남긴다.
// 배경(<p:bg>)은 지워 템플릿 레이아웃 배경을 쓴다.
async function fixParagraphProps(bytes: Uint8Array): Promise<Uint8Array> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
  const files = unzipSync(bytes);
  for (const name of Object.keys(files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    // pptxgenjs 는 표 틀과 도형에 같은 id 를 줄 때가 있어 장표 안 id 를 차례로 다시 매긴다(PowerPoint 복구 경고 방지)
    let nextId = 1;
    const xml = strFromU8(files[name]).replace(/<p:bg>[\s\S]*?<\/p:bg>/, '').replace(/<p:cNvPr id="\d+"/g, () => `<p:cNvPr id="${nextId++}"`);
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
  return zipSync(files, { level: 1 });
}

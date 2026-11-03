// 드라이브에 올린 파일에서 글 · 구조를 뽑는다(서버 전용).
//   PPTX: 슬라이드 순서대로 제목 · 글(문단) · 표 · 차트 값(계열 · 항목) · 그림. 차트는 파일에 들어 있는 값(캐시)을 그대로 읽는다.
//   PDF: 쪽별 글. MD · CSV · TXT: 글 그대로.
// 뽑은 글(content)은 Agent 가 참고할 때 읽고, 슬라이드 구조(slides)는 DM 판 만들기에 쓴다.
import 'server-only';
import { strFromU8, unzipSync } from 'fflate';

export type DriveKind = 'pptx' | 'pdf' | 'md' | 'csv' | 'txt' | 'xlsx' | 'docx' | 'json';
export type ChartInfo = { type: 'line' | 'col' | 'bar' | 'pie' | 'area' | 'other'; title: string; dates: boolean; cats: string[]; series: { name: string; color?: string; values: (number | null)[] }[] };
export type SlideImage = { name: string; mime: string; data?: string; w?: number; h?: number };
export type SlideInfo = { n: number; title: string; texts: string[]; tables: string[][][]; charts: ChartInfo[]; images: SlideImage[] };
export type Extracted = { content: string; slides: SlideInfo[] | null; pages: number };

const KINDS: Record<string, DriveKind> = { pptx: 'pptx', pdf: 'pdf', md: 'md', markdown: 'md', csv: 'csv', txt: 'txt', xlsx: 'xlsx', docx: 'docx', json: 'json' };
export const kindOf = (name: string): DriveKind | null => KINDS[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : (ENT[e] ?? m)));
const blocks = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g')) ?? [];
// 문단: <a:p> 안의 글 조각을 이어 붙인다(줄바꿈 <a:br/>는 공백)
function paragraphs(xml: string): string[] {
  return blocks(xml, 'a:p')
    .map((p) => unxml(p.replace(/<a:br\/>/g, ' ').match(/<a:t(?:\s[^>]*)?>[^<]*<\/a:t>/g)?.map((t) => t.replace(/<[^>]+>/g, '')).join('') ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
function rels(files: Record<string, Uint8Array>, path: string): Record<string, string> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  const relPath = `${dir}/_rels/${path.slice(dir.length + 1)}.rels`;
  const x = files[relPath] ? strFromU8(files[relPath]) : '';
  const out: Record<string, string> = {};
  for (const m of x.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) out[m[1]] = resolve(dir, m[2]);
  for (const m of x.matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) out[m[2]] ??= resolve(dir, m[1]);
  return out;
}
function resolve(dir: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir.split('/');
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// 엑셀 날짜 일련번호 → YYYY-MM-DD
const serialDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
function cache(xml: string): { vals: (string | null)[]; date: boolean } {
  const n = Number(xml.match(/<c:ptCount val="(\d+)"/)?.[1] ?? 0);
  const vals: (string | null)[] = Array.from({ length: n }, () => null);
  for (const m of xml.matchAll(/<c:pt idx="(\d+)"[^>]*>\s*<c:v>([^<]*)<\/c:v>/g)) vals[Number(m[1])] = unxml(m[2]);
  const fmt = xml.match(/<c:formatCode>([^<]*)<\/c:formatCode>/)?.[1] ?? '';
  return { vals, date: /[yd]/i.test(fmt) && !/%/.test(fmt) };
}
function chart(xml: string): ChartInfo {
  const type: ChartInfo['type'] = /<c:lineChart>/.test(xml) ? 'line' : /<c:barChart>/.test(xml) ? (/<c:barDir val="bar"/.test(xml) ? 'bar' : 'col') : /<c:pieChart>/.test(xml) ? 'pie' : /<c:areaChart>/.test(xml) ? 'area' : 'other';
  const titleXml = xml.match(/<c:title>[\s\S]*?<\/c:title>/)?.[0] ?? '';
  let dates = false;
  let cats: string[] = [];
  const series = blocks(xml, 'c:ser').map((s) => {
    const name = unxml(s.match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/)?.[1] ?? s.match(/<c:tx>[\s\S]*?<a:t>([^<]*)<\/a:t>/)?.[1] ?? '');
    const catXml = s.match(/<c:(?:cat|xVal)>[\s\S]*?<\/c:(?:cat|xVal)>/)?.[0] ?? '';
    if (catXml && !cats.length) {
      const c = cache(catXml);
      dates = c.date && /<c:numCache>/.test(catXml);
      cats = c.vals.map((v) => (v == null ? '' : dates && /^\d+(\.\d+)?$/.test(v) ? serialDate(Number(v)) : v));
    }
    const valXml = s.match(/<c:(?:val|yVal)>[\s\S]*?<\/c:(?:val|yVal)>/)?.[0] ?? '';
    const values = cache(valXml).vals.map((v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)));
    // 계열 색: 선(a:ln) 또는 채우기의 RGB(테마 색이면 없음)
    const sp = s.match(/<c:spPr>[\s\S]*?<\/c:spPr>/)?.[0] ?? '';
    const color = (sp.match(/<a:ln[^>]*>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/) ?? sp.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/))?.[1]?.toUpperCase();
    return { name, color, values };
  });
  return { type, title: paragraphs(titleXml).join(' '), dates, cats, series };
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', emf: 'image/emf', wmf: 'image/wmf', svg: 'image/svg+xml' };
const EMU = 914400; // 1인치

export function extractPptx(buf: Uint8Array, opts: { images?: boolean } = {}): Extracted {
  const files = unzipSync(buf, { filter: (f) => /^ppt\/(presentation\.xml|_rels\/|slides\/|charts\/chart\d+\.xml|media\/)/.test(f.name) });
  const pres = strFromU8(files['ppt/presentation.xml'] ?? new Uint8Array());
  const presRels = rels(files, 'ppt/presentation.xml');
  const order = [...pres.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map((m) => presRels[m[1]]).filter(Boolean);
  const slides: SlideInfo[] = order.map((path, i) => {
    const x = strFromU8(files[path] ?? new Uint8Array());
    const r = rels(files, path);
    let title = '';
    const texts: string[] = [];
    for (const sp of blocks(x, 'p:sp')) {
      const ps = paragraphs(sp);
      if (!ps.length) continue;
      if (!title && /<p:ph [^>]*type="(title|ctrTitle)"/.test(sp)) title = ps.join(' ');
      else texts.push(...ps);
    }
    const tables = blocks(x, 'a:tbl').map((t) => blocks(t, 'a:tr').map((tr) => blocks(tr, 'a:tc').map((tc) => paragraphs(tc).join(' '))));
    const charts = [...x.matchAll(/<c:chart [^>]*r:id="([^"]+)"/g)].map((m) => r[m[1]]).filter((p) => files[p]).map((p) => chart(strFromU8(files[p])));
    const images: SlideImage[] = [];
    for (const pic of blocks(x, 'p:pic')) {
      const id = pic.match(/<a:blip [^>]*r:embed="([^"]+)"/)?.[1];
      const p = id ? r[id] : undefined;
      if (!p || !files[p]) continue;
      const ext = p.split('.').pop()?.toLowerCase() ?? '';
      const mime = MIME[ext] ?? 'application/octet-stream';
      const ext2 = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
      const img: SlideImage = { name: p.split('/').pop()!, mime, w: ext2 ? Number(ext2[1]) / EMU : undefined, h: ext2 ? Number(ext2[2]) / EMU : undefined };
      if (opts.images && /^image\/(png|jpeg|gif)$/.test(mime) && files[p].length < 1_500_000) img.data = `data:${mime};base64,${Buffer.from(files[p]).toString('base64')}`;
      images.push(img);
    }
    // 제목 칸이 없으면 첫 글 줄을 제목으로
    if (!title && texts.length) title = texts.shift()!;
    return { n: i + 1, title, texts, tables, charts, images };
  });
  return { content: slidesText(slides), slides, pages: slides.length };
}

// Agent · 미리보기용 글: 슬라이드마다 제목, 글, 표(행 줄), 차트(이름 · 계열)
export function slidesText(slides: SlideInfo[]): string {
  return slides
    .map((s) => {
      const out = [`## ${s.n}. ${s.title || '(제목 없음)'}`];
      for (const t of s.texts) out.push(`- ${t}`);
      for (const t of s.tables) out.push(...t.slice(0, 40).map((row) => `| ${row.join(' | ')} |`), '');
      for (const c of s.charts) out.push(`[차트] ${c.title || c.type} · ${c.series.map((x) => x.name).filter(Boolean).join(', ')} · ${c.cats.length}개 항목${c.cats.length ? ` (${c.cats[0]} ~ ${c.cats[c.cats.length - 1]})` : ''}`);
      if (s.images.length) out.push(`[그림 ${s.images.length}개]`);
      return out.join('\n');
    })
    .join('\n\n');
}

export async function extractPdf(buf: Uint8Array): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(doc, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t) => t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  return { content: pages.map((t, i) => `## p.${i + 1}\n${t}`).join('\n\n'), slides: null, pages: pages.length };
}

export async function extract(kind: DriveKind, buf: Uint8Array, opts: { images?: boolean } = {}): Promise<Extracted> {
  if (kind === 'pptx') return extractPptx(buf, opts);
  if (kind === 'pdf') return extractPdf(buf);
  if (kind === 'md' || kind === 'csv' || kind === 'txt' || kind === 'json') return { content: new TextDecoder().decode(buf).replace(/^﻿/, ''), slides: null, pages: 1 };
  return { content: '', slides: null, pages: 0 };
}

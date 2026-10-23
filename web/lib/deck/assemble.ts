// NH 템플릿(마스터·레이아웃·고정 장표)에 pptxgenjs 로 만든 장표를 끼워 넣어 PPTX 한 벌을 만든다.
// 결과 파일은 NH 원본 슬라이드 마스터를 그대로 쓰므로 PowerPoint 에서 'NH투자증권_본문1' 등으로 새 장표를 추가할 수 있다.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

type Files = Record<string, Uint8Array>;
export type LayoutKey = 'cover' | 'contents' | 'folder' | 'body' | 'back' | 'ceo';
export type AsmSlide =
  | { kind: 'gen'; genIndex: number; layout: LayoutKey }
  | { kind: 'static'; file: string; renumber?: string | null };

const LAYOUT_NAMES: Record<LayoutKey, string> = {
  cover: 'NH투자증권_표지',
  contents: '1_목차1',
  folder: 'NH투자증권_폴더커버1',
  body: 'NH투자증권_본문1',
  back: 'NH투자증권_폴더커버',
  ceo: '제목 및 내용',
};

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Rel = { id: string; type: string; target: string; extra: string };
function parseRels(xml: string): Rel[] {
  return [...xml.matchAll(/<Relationship\b([^>]*?)\/>/g)].map((m) => {
    const a = m[1];
    const get = (k: string) => a.match(new RegExp(`${k}="([^"]*)"`))?.[1] ?? '';
    return { id: get('Id'), type: get('Type'), target: get('Target'), extra: /TargetMode="External"/.test(a) ? ' TargetMode="External"' : '' };
  });
}
const relsXml = (rels: Rel[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"${r.extra}/>`)
    .join('')}</Relationships>`;

// 'ppt/slides/' 기준 상대 경로 → 패키지 경로
function resolve(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
const relsOf = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels');

// [찾을 글자, 바꿀 글자, 글상자 조각 전체가 같을 때만]
export type Subs = [string, string, boolean?][];

// 고정 장표 글자 바꾸기: subs 는 <a:t> 안의 글자만 바꾼다
function applySubs(xml: string, subs: Subs) {
  return xml.replace(/<a:t>([^<]*)<\/a:t>/g, (whole, text: string) => {
    let t = text;
    for (const [a, b, exact] of subs) {
      if (exact) {
        if (t.trim() === xmlEsc(a)) t = t.replace(xmlEsc(a), xmlEsc(b));
      } else t = t.split(xmlEsc(a)).join(xmlEsc(b));
    }
    return `<a:t>${t}</a:t>`;
  });
}

// 고정 장표 제목(왼쪽 위 글상자)의 앞 번호를 바꾼다: '6. 조직단위별…' → '3. 조직단위별…'
function renumberTitle(xml: string, no: string) {
  return xml.replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<a:off x="741125" y="361127"\/>[\s\S]*?<\/p:sp>/, (sp) =>
    sp.replace(/<a:t>(\s*)\d+\.(\s*)/, (_m, a: string, b: string) => `<a:t>${a}${no}${b || ' '}`),
  );
}

export function assemble(template: Uint8Array, gen: Uint8Array | null, plan: AsmSlide[], subs: Subs): Uint8Array {
  const T: Files = unzipSync(template);
  const G: Files = gen ? unzipSync(gen) : {};
  const out: Files = {};
  for (const [name, data] of Object.entries(T)) {
    if (/^ppt\/(slides|notesSlides|charts|embeddings)\//.test(name) || name === 'docProps/app.xml') continue;
    out[name] = data;
  }

  // 레이아웃 이름 → 파일
  const layoutFile: Partial<Record<LayoutKey, string>> = {};
  for (const name of Object.keys(T)) {
    const m = name.match(/^ppt\/slideLayouts\/(slideLayout\d+\.xml)$/);
    if (!m) continue;
    const nm = strFromU8(T[name]).match(/<p:cSld name="([^"]*)"/)?.[1];
    for (const [k, v] of Object.entries(LAYOUT_NAMES)) if (nm === v) layoutFile[k as LayoutKey] = m[1];
  }

  const ctAdd: string[] = [];
  let chartNo = 0;
  let mediaNo = 0;
  let embedNo = 0;

  plan.forEach((p, i) => {
    const n = i + 1;
    const slidePart = `ppt/slides/slide${n}.xml`;
    let xml: string;
    let rels: Rel[];
    if (p.kind === 'static') {
      xml = strFromU8(T[p.file]);
      xml = applySubs(xml, subs);
      if (p.renumber) xml = renumberTitle(xml, p.renumber);
      const rx = T[relsOf(p.file)];
      rels = rx ? parseRels(strFromU8(rx)).filter((r) => !r.type.endsWith('/notesSlide')) : [];
      // 고정 장표의 그림은 템플릿 media 를 그대로 쓴다(경로 동일)
    } else {
      const src = `ppt/slides/slide${p.genIndex}.xml`;
      xml = strFromU8(G[src]);
      const rx = G[relsOf(src)];
      rels = [];
      for (const r of rx ? parseRels(strFromU8(rx)) : []) {
        if (r.type.endsWith('/notesSlide')) continue;
        if (r.type.endsWith('/slideLayout')) {
          rels.push({ ...r, target: `../slideLayouts/${layoutFile[p.layout] ?? layoutFile.body}` });
          continue;
        }
        const from = resolve('ppt/slides', r.target);
        if (r.type.endsWith('/chart')) {
          chartNo += 1;
          const to = `ppt/charts/chart${chartNo}.xml`;
          out[to] = G[from];
          ctAdd.push(`<Override PartName="/${to}" ContentType="${CT_CHART}"/>`);
          const crx = G[relsOf(from)];
          if (crx) {
            const crels = parseRels(strFromU8(crx)).map((cr) => {
              const cf = resolve('ppt/charts', cr.target);
              if (!G[cf]) return cr;
              embedNo += 1;
              const ext = cf.split('.').pop();
              const ct = `ppt/embeddings/deck_ws${embedNo}.${ext}`;
              out[ct] = G[cf];
              return { ...cr, target: `../embeddings/deck_ws${embedNo}.${ext}` };
            });
            out[relsOf(to)] = strToU8(relsXml(crels));
          }
          rels.push({ ...r, target: `../charts/chart${chartNo}.xml` });
          continue;
        }
        if (r.type.endsWith('/image') && G[from]) {
          mediaNo += 1;
          const ext = from.split('.').pop();
          const to = `ppt/media/deck_img${mediaNo}.${ext}`;
          out[to] = G[from];
          rels.push({ ...r, target: `../media/deck_img${mediaNo}.${ext}` });
          continue;
        }
        rels.push(r);
      }
    }
    out[slidePart] = strToU8(xml);
    out[relsOf(slidePart)] = strToU8(relsXml(rels));
    ctAdd.push(`<Override PartName="/${slidePart}" ContentType="${CT_SLIDE}"/>`);
  });

  // presentation.xml · rels
  const presRelsName = 'ppt/_rels/presentation.xml.rels';
  const presRels = parseRels(strFromU8(T[presRelsName])).filter((r) => !r.type.endsWith('/slide'));
  const slideRels = plan.map((_, i) => ({ id: `rIdDeck${i + 1}`, type: `${REL}/slide`, target: `slides/slide${i + 1}.xml`, extra: '' }));
  out[presRelsName] = strToU8(relsXml([...presRels, ...slideRels]));
  let pres = strFromU8(T['ppt/presentation.xml']);
  const ids = slideRels.map((r, i) => `<p:sldId id="${256 + i}" r:id="${r.id}"/>`).join('');
  pres = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(pres)
    ? pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`)
    : pres.replace(/(<\/p:sldMasterIdLst>(?:<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>)?)/, `$1<p:sldIdLst>${ids}</p:sldIdLst>`);
  out['ppt/presentation.xml'] = strToU8(pres);

  // [Content_Types].xml
  let ct = strFromU8(T['[Content_Types].xml']);
  ct = ct.replace(/<Override PartName="\/ppt\/(slides|notesSlides|charts)\/[^"]*"[^>]*\/>/g, '');
  const defaults: [string, string][] = [
    ['png', 'image/png'], ['jpeg', 'image/jpeg'], ['jpg', 'image/jpeg'], ['wdp', 'image/vnd.ms-photo'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ];
  for (const [ext, type] of defaults) {
    if (!new RegExp(`<Default Extension="${ext}"`, 'i').test(ct)) ct = ct.replace('<Default ', `<Default Extension="${ext}" ContentType="${type}"/><Default `);
  }
  ct = ct.replace('</Types>', `${ctAdd.join('')}</Types>`);
  out['[Content_Types].xml'] = strToU8(ct);

  out['docProps/app.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><PresentationFormat>사용자 지정</PresentationFormat><Slides>${plan.length}</Slides><Company>NH투자증권</Company></Properties>`,
  );
  return zipSync(out, { level: 6 });
}

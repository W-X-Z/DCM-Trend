// 올린 DM(PPTX) → DM 판. 제안서 Ⅱ부는 지금처럼 '기준일 이전 가장 최근 판'을 그대로 쓴다(lib/deck/dm.ts).
//   코드: 슬라이드 종류 찾기(제목 · 장표 번호 줄의 낱말), 차트 값 · 표 · 그림 옮기기
//   Haiku: 슬라이드 글 줄을 칸(글상자 · 핵심 포인트 · 그림 제목)에 나누기 — 줄 번호만 고른다(새 문장을 쓰지 않음)
//   모델이 없거나 실패하면 같은 일을 규칙으로 한다(덜 깔끔할 수 있음).
import 'server-only';
import type { DmChart, DmEdition, DmMeeting } from '../deck/dm';
import { MODEL, type Msg } from '../agent/defs';
import { agentReady, claude, obj, usesOf, type ToolDef } from '../agent/llm';
import type { ChartInfo, SlideInfo } from './extract';

export type DmSlot = 'rates' | 'bok' | 'fomc' | 'forecast' | 'credit_fc' | 'views' | 'usviews' | 'issues';
export const SLOT_LABEL: Record<DmSlot, string> = {
  rates: '금리 동향', bok: '금통위', fomc: 'FOMC', forecast: '금리 전망(기준금리 · 국고채)', credit_fc: '회사채 금리 전망',
  views: '증권사별 국내 전망', usviews: '증권사별 미국 전망', issues: '주요 이슈',
};

// ── 슬라이드 종류 ──
// DM 마다 양식이 조금씩 달라(제목 칸이 '출처 : …'인 장 등) 줄을 세 단계로 본다:
//   ① 장표 번호 줄('2. 금리 전망_① …', '01 금리 동향', 'Appendix …') ② 제목 칸 ③ 나머지 짧은 줄(60자 미만)
const NUMBERED = /^(\d+\.\s|0\d\s|Appendix\b)|_[①-⑨]/;
const meetingOk = (s: SlideInfo) => !s.tables.length && s.texts.length >= 3 && s.texts.some((t) => /핵심\s*포인트|기준금리/.test(t) || /기준금리/.test(s.title));
const RULES: [DmSlot, RegExp, (s: SlideInfo) => boolean][] = [
  ['views', /증권사별\s*(국내|한국)\s*기준금리/, () => true],
  ['usviews', /증권사별\s*미국\s*기준금리/, () => true],
  ['forecast', /기준금리\s*및\s*(한미\s*)?국고채\s*금리/, (s) => s.tables.length > 0 || s.texts.length >= 3],
  ['credit_fc', /회사채\s*금리\s*$|금리\s*전망_②|등급\s*(이상|이하).*회사채\s*시장\s*전망/, (s) => s.texts.some((t) => /등급/.test(t))],
  ['bok', /금통위/, meetingOk],
  ['fomc', /FOMC/i, meetingOk],
  ['rates', /금리\s*동향|국고채\s*및\s*韓/, (s) => s.charts.some((c) => c.type === 'line')],
  ['issues', /주요\s*이슈/, (s) => s.texts.some((t) => /^\[[^\]]+\]$/.test(t))],
];
export function classify(slides: SlideInfo[]): { slot: DmSlot; s: SlideInfo }[] {
  const out: { slot: DmSlot; s: SlideInfo }[] = [];
  for (const s of slides) {
    const short = s.texts.filter((t) => t.length < 60);
    const tiers = [[s.title, ...short].filter((t) => NUMBERED.test(t)), [s.title], short];
    let hit: DmSlot | undefined;
    for (const lines of tiers) {
      for (const t of lines) {
        hit = RULES.find(([, re, ok]) => re.test(t) && ok(s))?.[0];
        if (hit) break;
      }
      if (hit) break;
    }
    // 주요 이슈는 장표 번호 줄이 없기도 해서 글 전체에서 한 번 더
    if (!hit && /주요\s*이슈/.test(s.texts.join(' ')) && RULES[7][2](s)) hit = 'issues';
    if (!hit) continue;
    // 한 판에 한 장씩(주요 이슈는 여러 장)
    if (hit !== 'issues' && out.some((x) => x.slot === hit)) continue;
    out.push({ slot: hit, s });
  }
  return out;
}

// ── 차트 · 표 ──
const PALETTE = ['1F3864', '8EA9DB', 'FF0000', 'ED7D31', '70AD47', 'A6A6A6'];
const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).map(Math.abs).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
function niceScale(vals: number[]) {
  const v = vals.filter((x) => Number.isFinite(x));
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (!v.length) return { min: 0, max: 1, step: 0.2 };
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / 6;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (lo > 0 && lo < step * 2) lo = 0;
  return { min: +lo.toFixed(6), max: +hi.toFixed(6), step: +step.toFixed(6) };
}
function toDmChart(c: ChartInfo, title: string, unit: string, src: string): DmChart | null {
  if ((c.type !== 'line' && c.type !== 'col') || !c.series.length || !c.cats.length) return null;
  let series = c.series.map((s) => ({ name: s.name.replace(/\s*\((좌|우)\)\s*$/, '').trim(), color: s.color, values: s.values }));
  // 축이 둘이면(좌 · 우) 한 축만: 제목이 Spread 면 스프레드 계열, 아니면 크기가 비슷한 쪽
  if (/spread/i.test(title) && series.some((s) => /spread/i.test(s.name))) series = series.filter((s) => /spread/i.test(s.name));
  else {
    const m = series.map((s) => median(s.values.filter((x): x is number => x != null)));
    const big = Math.max(...m);
    const small = Math.min(...m.filter((x) => x > 0));
    if (small > 0 && big / small > 8) series = series.filter((_, i) => (m[0] > small * 8 ? m[i] > small * 8 : m[i] <= small * 8));
  }
  // 날짜 항목: 'YYYY-MM-DD' · 'YYYY-MM' 그대로, 'YY-MM' 은 'YYYY-MM' 으로(축 눈금이 달 단위로 읽는다)
  const cats = c.cats.map((x) => (/^\d{2}-\d{2}$/.test(x) ? `20${x}` : x));
  const dates = cats.every((x) => /^\d{4}-\d{2}(-\d{2})?$/.test(x));
  const vals = series.flatMap((s) => s.values.filter((x): x is number => x != null));
  const sc = niceScale(vals);
  const used = new Set<string>();
  return {
    kind: c.type === 'line' ? 'line' : 'cols', title, unit, src, cats, dates,
    series: series.map((s, i) => {
      // DM 의 선 색을 그대로(없거나 겹치면 기본 색)
      const color = s.color && !used.has(s.color) ? s.color : PALETTE.find((x) => !used.has(x)) ?? PALETTE[i % PALETTE.length];
      used.add(color);
      return { name: s.name, color, values: s.values.map((x) => (x == null ? null : +x.toFixed(3))) };
    }),
    ...sc, digits: sc.max < 20 ? 1 : 0, legend: true,
  };
}
// 금리 전망표: 분기 열(연도 머리 아래 1Q~4Q)만 옮긴다
function forecastTable(t: string[][], title: string, unit: string, notes: string[]): DmEdition['forecastTable'] | undefined {
  if (t.length < 3) return undefined;
  const [h0, h1] = t;
  const cols: { year: string; period: string; i: number }[] = [];
  let year = '';
  h0.forEach((c, i) => {
    if (i < 2) return;
    if (c) year = c;
    const p = h1[i] ?? '';
    if (/^[1-4]Q$/i.test(p)) cols.push({ year, period: p.toUpperCase(), i });
  });
  if (!cols.length) return undefined;
  const years = [...new Set(cols.map((c) => c.year))].filter((y) => cols.filter((c) => c.year === y).length === 4);
  const keep = cols.filter((c) => years.includes(c.year));
  let group = '';
  const rows = t.slice(2).filter((r) => r.some(Boolean)).map((r) => {
    if (r[0]) group = r[0];
    return { group, tenor: r[1] || null, cells: keep.map((c) => r[c.i] || '–') };
  });
  return { title, unit, years, periods: keep.map((c) => c.period), rows, notes };
}

// ── 글 줄 나누기 ──
type Pick = {
  edition?: string; grade?: string;
  rates?: number[]; forecast?: number[]; views?: number[]; usviews?: number[];
  bok?: { callout?: number[]; title?: number; meeting_dt?: string; points?: { n: number; head?: boolean }[]; images?: number[] };
  fomc?: { callout?: number[]; title?: number; meeting_dt?: string; points?: { n: number; head?: boolean }[]; images?: number[] };
  credit_fc?: { high?: { title?: number; lines?: number[] }; low?: { title?: number; lines?: number[] } };
  issues?: { lines?: number[] }[];
};
const ids = { type: 'array', items: { type: 'integer' } };
const meetingSchema = obj({ callout: ids, title: { type: 'integer' }, meeting_dt: { type: 'string' }, points: { type: 'array', items: obj({ n: { type: 'integer' }, head: { type: 'boolean' } }, ['n']) }, images: ids });
const PICK_TOOL: ToolDef = {
  name: 'save',
  description: 'DM 슬라이드 글 줄을 칸에 나눠 저장한다. 줄 번호만 준다.',
  input_schema: obj({
    edition: { type: 'string', description: '표지 날짜 YYYY-MM-DD(일이 없으면 빈 값)' },
    grade: { type: 'string', description: '이 DM 이 다루는 등급(예: A+, A0). 모르면 빈 값' },
    rates: ids, forecast: ids, views: ids, usviews: ids,
    bok: meetingSchema, fomc: meetingSchema,
    credit_fc: obj({ high: obj({ title: { type: 'integer' }, lines: ids }), low: obj({ title: { type: 'integer' }, lines: ids }) }),
    issues: { type: 'array', items: obj({ lines: ids }) },
  }),
};
const PICK_SYSTEM = `너는 Discussion Material(회사채 시장 동향 자료) 슬라이드의 글 줄을 제안서 Ⅱ부 장표 칸에 옮기는 역할이다.
새 문장을 쓰지 않는다. 각 칸에 들어갈 줄의 번호만 순서대로 골라 save 도구를 한 번 부른다.

칸:
- rates: 금리 동향 글상자. [국고금리] · [크레딧 스프레드] 같은 대괄호 소제목 줄과 그 아래 본문 줄
- bok · fomc: callout = 맨 위 요약 1~2줄(보통 슬라이드 제목 줄 포함), title = '○월 금통위(FOMC) 핵심 포인트' 줄, meeting_dt = 회의 날짜(본문에서, YYYY-MM-DD, 모르면 빈 값), points = 핵심 포인트 줄(소제목은 head=true, 예: '통화정책 결정: …', '성장세 강화와 …'), images = '■ …' 그림 제목 줄
- forecast: '■ …' 소제목 줄과 [한국] · [미국] 본문 줄
- credit_fc: high = AA등급 이상(우량채) 소제목 줄 번호와 본문 줄, low = A등급 이하(비우량채)
- views · usviews: 증권사 전망 요약 본문 줄(표 제목 · 자료 · 주) 줄 빼고)
- issues: 이슈 장표마다 [주제] 소제목 줄과 본문 줄

넣지 않는 줄: (단위: …), 자료 · 출처 · 주) 줄, 장표 번호 줄(예: '1. 금리 동향_① …'), 차트 제목(… 추이), 목차.`;

function lineBook(classified: { slot: DmSlot; s: SlideInfo }[]) {
  const lines: { slot: DmSlot; slide: number; text: string }[] = [];
  for (const { slot, s } of classified) for (const t of [s.title, ...s.texts]) if (t) lines.push({ slot, slide: s.n, text: t });
  return lines;
}

async function pickWithModel(classified: { slot: DmSlot; s: SlideInfo }[], cover: string, left: number): Promise<Pick | null> {
  if (!agentReady()) return null;
  const book = lineBook(classified);
  const body = classified
    .map(({ slot, s }) => [`### 슬라이드 ${s.n} · ${SLOT_LABEL[slot]}`, ...book.map((l, i) => ({ l, i })).filter(({ l }) => l.slide === s.n).map(({ l, i }) => `${i + 1}. ${l.text}`)].join('\n'))
    .join('\n\n');
  const ask = `표지: ${cover.slice(0, 300)}\n\n${body}\n\n줄 번호로 칸을 나눠 save 를 부르세요.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs: Msg[] = [{ role: 'user', content: attempt ? `${ask}\n\n(앞선 답에 save 호출이 없었어요. 반드시 save 를 부르세요.)` : ask }];
    const res = await claude(MODEL, PICK_SYSTEM, msgs, [PICK_TOOL], 8000, left);
    const u = usesOf(res.content).find((x) => x.name === 'save');
    if (u) return u.input as Pick;
  }
  return null;
}

// 규칙으로 나누기(모델이 없을 때)
const NOISE = /^(\(단위|자료\s*[:：]|출처|주\)|Contents$|c$)|_[①-⑨]|추이\s*$|^\d+\.\s*\S+\s*(동향|전망)|^0\d\s/;
// 표 · 그림 제목 같은 짧은 이름 줄(문장으로 끝나지 않고 소제목 표시도 없음)
const LABELISH = (t: string) => t.length < 30 && !/^(■|\[|✓)/.test(t) && !/[.다음함임됨]$/.test(t);
function pickByRule(classified: { slot: DmSlot; s: SlideInfo }[]): Pick {
  const book = lineBook(classified);
  const idx = (slide: number, f: (t: string) => boolean) => book.map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => l.slide === slide && f(l.text)).map(({ i }) => i);
  const p: Pick = {};
  for (const { slot, s } of classified) {
    const body = idx(s.n, (t) => !NOISE.test(t) && !/^■/.test(t) && t !== s.title);
    if (slot === 'rates' || slot === 'forecast' || slot === 'views' || slot === 'usviews') p[slot] = idx(s.n, (t) => !NOISE.test(t) && !LABELISH(t) && (slot === 'forecast' || !/^■/.test(t)) && t !== s.title);
    if (slot === 'bok' || slot === 'fomc') {
      const kp = idx(s.n, (t) => /핵심\s*포인트/.test(t))[0];
      // 제목 칸이 결정 요약 문장이면 글상자 첫 줄로(장표 번호 줄이면 빼고)
      const title = NUMBERED.test(s.title) || s.title.length < 20 ? undefined : idx(s.n, (t) => t === s.title)[0];
      const pts = body.filter((i) => !kp || i > kp).filter((i) => i !== kp);
      p[slot] = {
        callout: [title, ...body.filter((i) => !kp || i < kp).slice(0, title ? 1 : 2)].filter((x): x is number => !!x),
        title: kp,
        points: pts.map((n) => ({ n, head: book[n - 1].text.length < 45 && !/[.다]$/.test(book[n - 1].text) })),
        images: idx(s.n, (t) => /^■/.test(t)),
      };
    }
    if (slot === 'credit_fc') {
      const heads = idx(s.n, (t) => /^■/.test(t));
      const hi = heads.find((i) => /AA/.test(book[i - 1].text));
      const lo = heads.find((i) => /A등급 이하|비우량/.test(book[i - 1].text));
      const after = (h?: number) => (h ? body.filter((i) => i > h && !heads.some((x) => x > h && x < i) && !LABELISH(book[i - 1].text)) : []);
      p.credit_fc = { high: { title: hi, lines: after(hi) }, low: { title: lo, lines: after(lo) } };
    }
    if (slot === 'issues') (p.issues ??= []).push({ lines: idx(s.n, (t) => !NOISE.test(t)) });
  }
  return p;
}

// 회의 날짜: 글의 'M월 D일'(없으면 'M월 금통위/FOMC' 의 그 달 말일 — 같은 달 DB 회의보다 DM 을 앞세우려고). 판보다 뒤 달이면 전년.
const kind = (k: 'bok' | 'fomc') => (k === 'bok' ? '금통위' : 'FOMC');
function meetingDate(word: string, lines: string[], edition: string): string | null {
  const txt = lines.join(' ');
  const full = txt.match(new RegExp(`(\\d{1,2})월\\s*(\\d{1,2})일[^.]{0,12}${word}`)) ?? txt.match(/(\d{1,2})월\s*(\d{1,2})일/);
  const mon = full ?? txt.match(new RegExp(`(\\d{1,2})월\\s*${word}`));
  if (!mon) return null;
  const mm = Number(mon[1]);
  if (mm < 1 || mm > 12) return null;
  const y = Number(edition.slice(0, 4)) - (mm > Number(edition.slice(5, 7)) ? 1 : 0);
  const dd = full ? Number(full[2]) : new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export type DmResult = { edition: DmEdition; filled: DmSlot[]; by: 'model' | 'rule' };

export async function dmFromSlides(slides: SlideInfo[], o: { fileName: string; author: string; today: string; left?: number }): Promise<DmResult> {
  const classified = classify(slides);
  if (!classified.length) throw new Error('DM 장표(금리 동향 · 금통위 · FOMC · 금리 전망)를 찾지 못했어요.');
  const book = lineBook(classified);
  let by: DmResult['by'] = 'model';
  const cover = slides[0] ? [slides[0].title, ...slides[0].texts].join(' ') : '';
  let pick = await pickWithModel(classified, cover, o.left ?? 90_000).catch(() => null);
  if (!pick) {
    pick = pickByRule(classified);
    by = 'rule';
  }
  const at = (n?: number) => (n && book[n - 1] ? book[n - 1].text : '');
  // 고른 줄은 그 칸의 슬라이드 줄이어야 한다(다른 장표 줄 · 없는 번호는 뺀다)
  const fromSlot = (slot: DmSlot, ns?: number[]) => [...new Set(ns ?? [])].filter((n) => book[n - 1]?.slot === slot).map((n) => book[n - 1].text);
  const slideOf = (slot: DmSlot) => classified.find((x) => x.slot === slot)?.s;

  // 판 날짜: 표지 'YYYY. MM. DD' → 모델 → 파일 이름(_MMDD) → 오늘
  const cm = cover.match(/(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  const fm = o.fileName.match(/(?:^|[_\s-])(\d{2})(\d{2})(?:\D|$)/);
  const edition = cm
    ? `${cm[1]}-${cm[2].padStart(2, '0')}-${cm[3].padStart(2, '0')}`
    : /^\d{4}-\d{2}-\d{2}$/.test(pick.edition ?? '') ? pick.edition!
      : fm ? `${o.today.slice(0, 4)}-${fm[1]}-${fm[2]}` : o.today;
  const titleLine = [slides[0]?.title, ...(slides[0]?.texts ?? [])].find((t) => t && /회사채|Discussion|시장/.test(t)) ?? 'Discussion Material';
  const gm = `${titleLine} ${slides.flatMap((s) => s.texts).join(' ')}`.match(/\b(AAA|AA[+0-]|A[+0-]|BBB[+0-])\s*(?:급|등급|회사채)/);
  const grade = (pick.grade && /^(AAA|AA[+0-]?|A[+0-]?|BBB[+0-]?)$/.test(pick.grade) ? pick.grade : gm?.[1]) || undefined;

  const pages: DmEdition['pages'] = {};
  const filled: DmSlot[] = [];
  for (const k of ['rates', 'forecast', 'views', 'usviews'] as const) {
    const xs = fromSlot(k, pick[k]);
    if (xs.length) {
      pages[k] = xs;
      filled.push(k);
    }
  }
  const meetings: DmEdition['meetings'] = {};
  for (const k of ['bok', 'fomc'] as const) {
    const m = pick[k];
    const s = slideOf(k);
    if (!m || !s) continue;
    const callout = fromSlot(k, m.callout);
    const points = (m.points ?? []).filter((p) => book[p.n - 1]?.slot === k).map((p) => (p.head ? `✓ ${at(p.n).replace(/^✓\s*/, '')}` : at(p.n)));
    if (!callout.length && !points.length) continue;
    pages[k] = callout;
    const titles = fromSlot(k, m.images).map((t) => t.replace(/^■\s*/, ''));
    const imgs = s.images.filter((x) => x.data).slice(0, 3).map((x, i) => ({ title: titles[i] ?? '', src: x.data!, ar: x.w && x.h ? +(x.w / x.h).toFixed(3) : undefined }));
    const said = meetingDate(kind(k), [s.title, ...callout, at(m.title)], edition);
    const dt0 = /^\d{4}-\d{2}-\d{2}$/.test(m.meeting_dt ?? '') && (!said || m.meeting_dt!.slice(0, 7) === said.slice(0, 7)) ? m.meeting_dt! : said ?? edition;
    const dt = dt0 > edition ? edition : dt0;
    const meet: DmMeeting = { meeting_dt: dt, title: at(m.title) || `${Number(dt.slice(5, 7))}월 ${k === 'bok' ? '금통위' : 'FOMC'} 핵심 포인트`, points, charts: [], images: imgs };
    meetings[k] = meet;
    filled.push(k);
  }
  if (pick.credit_fc) {
    const hi = { title: at(pick.credit_fc.high?.title).replace(/^■\s*/, '').replace(/^\d{4}년\s*/, ''), lines: fromSlot('credit_fc', pick.credit_fc.high?.lines) };
    const lo = { title: at(pick.credit_fc.low?.title).replace(/^■\s*/, '').replace(/^\d{4}년\s*/, ''), lines: fromSlot('credit_fc', pick.credit_fc.low?.lines) };
    if (hi.lines.length || lo.lines.length) {
      pages.credit_fc = { high: { title: hi.title || 'AA등급 이상(우량채) 회사채 시장 전망', lines: hi.lines }, low: { title: lo.title || 'A등급 이하(비우량채) 회사채 시장 전망', lines: lo.lines } };
      filled.push('credit_fc');
    }
  }

  // 금리 동향 차트(값은 파일의 차트 그대로)
  const charts: DmEdition['charts'] = {};
  const rs = slideOf('rates');
  if (rs) {
    const lines = [rs.title, ...rs.texts];
    const titles = lines.filter((t) => /추이\s*$/.test(t) && t.length < 50);
    const src = lines.filter((t) => /^자료/.test(t)).map((t) => t.replace(/^자료\s*[:：]\s*/, '자료: '))[0] ?? '';
    // 차트 순서가 파일마다 달라 내용으로 맞춘다: 스프레드 계열이 있는 쪽이 오른쪽(Credit Spread) 차트
    const spread = (c: ChartInfo) => c.series.some((x) => /spread/i.test(x.name)) || /spread/i.test(c.title);
    const lineCs = rs.charts.filter((c) => c.type === 'line');
    const sp = lineCs.find(spread);
    const rt = lineCs.find((c) => c !== sp);
    const a = rt && toDmChart(rt, titles.find((t) => !/spread/i.test(t)) ?? (rt.title || '국고채 및 기준금리 추이'), '(단위: %)', src);
    const b = sp && toDmChart(sp, titles.find((t) => /spread/i.test(t)) ?? (sp.title || 'Credit Spread 추이'), '(단위: bp)', src);
    // 스프레드를 %(0.5 = 50bp)로 둔 파일은 bp 로 바꾼다
    if (b && Math.max(...b.series.flatMap((x) => x.values.filter((v): v is number => v != null))) < 10) {
      b.series = b.series.map((x) => ({ ...x, values: x.values.map((v) => (v == null ? null : Math.round(v * 1000) / 10)) }));
      Object.assign(b, niceScale(b.series.flatMap((x) => x.values.filter((v): v is number => v != null))), { digits: 0 });
    }
    if (a && b) charts.rates = [a, b];
  }
  // 금리 전망표
  let ft: DmEdition['forecastTable'];
  const fs = slideOf('forecast');
  if (fs?.tables[0]) {
    const lines = [fs.title, ...fs.texts];
    const title = lines.find((t) => /금리\s*전망\s*$/.test(t) && !/^■/.test(t) && !/_[①-⑨]/.test(t)) ?? '기준금리 및 국고채 금리 전망';
    const unit = (lines.find((t) => /^\(단위/.test(t)) ?? '(단위: %)').replace(/\s*:\s*/, ': ');
    const notes = lines.filter((t) => /^(자료|출처)/.test(t)).map((t) => t.replace(/^(자료|출처)\s*[:：]\s*/, '자료: '));
    ft = forecastTable(fs.tables[0], title, unit, notes);
  }
  // 주요 이슈: 장표마다 [주제] 글 + 그 장의 차트(값) 또는 그림. 첫 [주제] 앞 짧은 줄은 차트 · 그림 제목
  const issuePages = (pick.issues ?? []).map((x) => {
    const ns = [...new Set(x.lines ?? [])].filter((n) => book[n - 1]?.slot === 'issues');
    const s = ns.length ? classified.find((c) => c.slot === 'issues' && c.s.n === book[ns[0] - 1].slide)?.s : undefined;
    const first = ns.findIndex((n) => /^\[[^\]]+\]/.test(book[n - 1].text));
    const lines = (first > 0 ? ns.slice(first) : ns).map((n) => book[n - 1].text);
    const titles = s ? [s.title, ...s.texts].filter((t) => t && t.length < 50 && !/^\[/.test(t) && !/^(\(단위|자료|출처|주\))|주요\s*이슈/.test(t) && !NUMBERED.test(t) && !lines.includes(t)) : [];
    const charts = (s?.charts ?? []).map((c, i) => toDmChart(c, titles[i] ?? c.title, '', '')).filter((c): c is DmChart => !!c).slice(0, 2);
    const images = charts.length ? [] : (s?.images ?? []).filter((im) => im.data).slice(0, 2).map((im, i) => ({ title: titles[i] ?? '', src: im.data!, ar: im.w && im.h ? +(im.w / im.h).toFixed(3) : undefined }));
    return { lines, charts, images: images.length ? images : undefined };
  }).filter((x) => x.lines.length);
  if (issuePages.length) filled.push('issues');

  const edition_: DmEdition = {
    edition, title: titleLine.replace(/^\(?NH투자증권\)?\s*/, ''), by: '드라이브 DM', grade,
    note: `드라이브에 올린 '${o.fileName}'(${o.author || '익명'})에서 만든 판. 장표 종류는 규칙으로, 글 줄 나누기는 ${by === 'model' ? 'Agent(Haiku)' : '규칙'}로`,
    pages, charts, meetings, issuePages: issuePages.length ? issuePages : undefined, forecastTable: ft,
    issues: [], market: [],
  };
  return { edition: edition_, filled, by };
}

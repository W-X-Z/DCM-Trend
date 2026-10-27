// 사람 검토 표시: 장표에서 담당자가 정하거나 확인해야 할 곳만 골라 위치를 돌려준다.
// 화면 미리보기에만 겹쳐 그리고(PPTX·PDF 에는 들어가지 않음), '확인'을 누르면 숨긴다.
// 위치는 장표 표시 목록(prims)에서 찾는다: 요약 상자(맨 위 회색 상자), 표의 항목 칸, 본문 영역.
import type { ItemId } from './catalog';
import { cellBoxes, plain, type Prim, type Slide, type Table } from './model';
import { defaultInput } from './rules';
import { hasTable } from './tsv';
import { C, PAGE } from './theme';
import type { Qa } from './qa';
import type { DeckData, DeckInput, DeckText } from './types';

// input: 담당자가 정할 값(기본값 그대로) / judge: 제안 판단 문장 / data: 대체·이상 데이터 / stale: 갱신 필요
export type MarkKind = 'input' | 'judge' | 'data' | 'stale';
export type Mark = { key: string; slide: number; item: string; kind: MarkKind; x: number; y: number; w: number; h: number; text: string };
export const MARK_LABEL: Record<MarkKind, string> = { input: '입력 확인', judge: '판단 확인', data: '데이터 확인', stale: '갱신 필요' };

type Box = { x: number; y: number; w: number; h: number };
const BODY: Box = { x: 47, y: 78, w: 689, h: 422 };

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const textOf = (cell: { paras: { runs: { t: string }[] }[] }) => plain(cell.paras.map((p) => p.runs.map((r) => r.t).join('')).join(' ')).replace(/\s+/g, ' ').trim();

// 맨 위 요약 상자(회색)
function calloutOf(s: Slide): Box | null {
  const r = s.prims.find((p): p is Extract<Prim, { k: 'rect' }> => p.k === 'rect' && p.fill === C.label && p.y >= 70 && p.y <= 90);
  return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
}
const tables = (s: Slide) => s.prims.filter((p): p is Table => p.k === 'table');
// 표 전체
function tableBox(t: Table): Box {
  const b = cellBoxes(t);
  return { x: t.x, y: t.y, w: b.w, h: b.h };
}
// 항목 칸(첫 열·둘째 열) 글자가 label 인 행: 표 폭 전체, 병합된 행 높이까지
function rowOf(s: Slide, label: string): Box | null {
  for (const t of tables(s)) {
    const b = cellBoxes(t);
    const hit = b.boxes.find((x) => x.c <= 1 && textOf(x.cell) === label);
    if (hit) return { x: t.x, y: hit.y, w: b.w, h: hit.h };
  }
  return null;
}
// 표 가운데 label 이 든 칸이 있는 표
function tableWith(s: Slide, label: string): Box | null {
  for (const t of tables(s)) if (cellBoxes(t).boxes.some((x) => textOf(x.cell).includes(label))) return tableBox(t);
  return null;
}
// 글상자 가운데 글자가 든 것
function textWith(s: Slide, re: RegExp): Box | null {
  const p = s.prims.find((x) => x.k === 'text' && re.test(x.paras.map((q) => q.runs.map((r) => r.t).join('')).join(' ')));
  return p && p.k === 'text' ? { x: p.x, y: p.y, w: p.w, h: p.h } : null;
}

const pad = (b: Box, k = 2): Box => ({ x: b.x - k, y: b.y - k, w: b.w + k * 2, h: b.h + k * 2 });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 검수(qa) 항목의 표시 종류
const QA_KIND: Partial<Record<ItemId, MarkKind>> = { bok: 'stale', fomc: 'stale', views: 'stale', usviews: 'stale', forecast: 'stale', schedule: 'input', cover: 'input' };

export function reviewMarks(slides: Slide[], d: DeckData, inp: DeckInput, tx: DeckText, qa: Qa[]): Mark[] {
  const out: Mark[] = [];
  const base = defaultInput(d);
  const idOf = (s: Slide) => s.id.replace(/-\d+$/, '');
  const add = (i: number, kind: MarkKind, what: string, box: Box | null, text: string, content: unknown) => {
    if (!box) return;
    const item = idOf(slides[i]);
    out.push({ key: `${item}:${what}:${hash(JSON.stringify(content))}`, slide: i, item, kind, ...pad(box), text });
  };
  const first = new Map<string, number>();
  slides.forEach((s, i) => {
    if (!first.has(idOf(s))) first.set(idOf(s), i);
  });

  slides.forEach((s, i) => {
    const id = idOf(s);
    const firstPage = first.get(id) === i;
    if (id === 'terms') {
      add(i, 'judge', 'lead', calloutOf(s), '발행 시기·구조 제안 문장입니다. 고객사 자금 일정·내부 방침과 맞는지 확인하세요.', [tx.lead, tx.structure.slice(0, 2)]);
      add(i, 'input', 'rating', rowOf(s, '신용등급'), '공시 기준 등급입니다. 최근 정기평가·등급 전망 변동이 없는지 확인하세요.', [inp.rating, inp.ratingNote]);
      if (same(inp.tranches, base.tranches) && same(inp.maxEok, base.maxEok)) {
        add(i, 'input', 'tenor', rowOf(s, '만기'), '직전 회차 만기 구성을 그대로 넣었습니다. 이번 회차 만기를 정하세요.', inp.tranches);
        add(i, 'input', 'amount', rowOf(s, '발행금액'), '직전 회차 신고금액과 그 2배(증액 최대)를 기본값으로 넣었습니다. 발행 규모를 확인하세요.', [inp.tranches, inp.maxEok]);
      }
      if (same(inp.band, base.band)) add(i, 'input', 'band', rowOf(s, '금리 밴드'), '현업 샘플 관행(개별민평 ±30bp)을 기본값으로 넣었습니다. 밴드를 확정하세요.', inp.band);
      if (inp.pay === base.pay && !inp.demand) {
        add(i, 'input', 'pay', rowOf(s, '발행일'), '납입일은 데이터 기준일 + 25영업일 기본값입니다. 고객사 희망 일정으로 바꾸세요.', inp.pay);
      }
      if (inp.feeUw === base.feeUw && inp.feeLead == null) add(i, 'input', 'fee', rowOf(s, '수수료'), '직전 회차 인수수수료를 준용했습니다. 대표주관·인수수수료 협의 결과를 넣으세요.', [inp.feeUw, inp.feeLead]);
    }
    if (id === 'sizing' && firstPage) {
      add(i, 'judge', 'call', calloutOf(s), '트랜치 구성 판단 문장입니다. 회사 자금 수요·투자자 반응과 맞는지 확인하세요.', tx.sizing);
      if (!hasTable(inp.internal?.minpyeong)) add(i, 'data', 'minpyeong', tableWith(s, '국고채 3년'), '개별민평이 연결되지 않아 ECOS 국고·회사채 금리로 대신했습니다(내부 데이터 연결 시 개별민평 표).', 'ecos');
    }
    if (id === 'schedule' && firstPage && inp.pay === base.pay && !inp.demand) {
      add(i, 'input', 'cal', calloutOf(s), '기본 납입일로 만든 일정입니다. 발행 희망일이 정해지면 바꾸세요.', inp.pay);
    }
    if (id === 'rates' && firstPage && !d.daily.some((x) => x.pts.length >= 120)) {
      add(i, 'data', 'monthly', { x: BODY.x, y: (calloutOf(s)?.y ?? 78) + (calloutOf(s)?.h ?? 0) + 6, w: BODY.w, h: 500 - ((calloutOf(s)?.y ?? 78) + (calloutOf(s)?.h ?? 0) + 6) }, '일별 금리를 받지 못해 월말 금리로 그렸습니다(ECOS 키 설정 시 일별).', 'monthly');
    }
    if (id === 'back' && !inp.contacts.trim()) {
      add(i, 'input', 'contacts', { x: 50, y: 448, w: 500, h: 60 }, '담당자 연락처가 비어 있습니다. 표지 탭에서 입력하세요.', 'contacts');
    }
    if (id === 'cover') {
      const m = textWith(s, new RegExp(inp.month.replace(/[.\s]/g, '.?\\s*')));
      if (qa.some((x) => x.item === 'cover')) add(i, 'input', 'month', m, qa.find((x) => x.item === 'cover')!.text, inp.month);
    }
  });

  // 검수 경고·알림: 해당 장표 첫 쪽의 요약 상자(사례 표·전망표는 표)에 표시
  for (const q of qa) {
    if (!q.item || q.item === 'cover') continue;
    const i = first.get(q.item);
    if (i == null) continue;
    const s = slides[i];
    const tbl = tables(s)[0];
    const box = (q.item === 'peers' || q.item === 'credit_fc') && tbl ? tableBox(tbl) : q.item === 'forecast' ? calloutOf(s) ?? BODY : calloutOf(s) ?? BODY;
    const kind = QA_KIND[q.item] ?? 'data';
    add(i, q.level === 'warn' ? kind : kind === 'stale' ? 'stale' : 'data', `qa-${hash(q.text.replace(/[\d.,]+/g, ''))}`, box, q.text, q.text);
  }
  // 같은 자리에 겹치면 뒤 것을 조금 안쪽으로
  const seen = new Map<string, number>();
  for (const m of out) {
    const k = `${m.slide}:${Math.round(m.x)}:${Math.round(m.y)}:${Math.round(m.w)}`;
    const n = seen.get(k) ?? 0;
    if (n) {
      m.x += 4 * n;
      m.y += 4 * n;
      m.w -= 8 * n;
      m.h -= 8 * n;
    }
    seen.set(k, n + 1);
  }
  return out.filter((m) => m.w > 4 && m.h > 4 && m.y < PAGE.h);
}

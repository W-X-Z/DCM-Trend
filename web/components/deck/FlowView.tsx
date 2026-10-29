'use client';

// 흐름도: 사용자 입력 → 제안서 Agent(의도 해석 → 실행 계획 → Sub-agent) → Output.
// Agent 아래에 암묵지(Skill)·도구(Tool)·데이터·기억(Memory)을 나란히. 상자를 누르면 아래에 짧게 열린다.
// 넷의 상세는 같은 나무 모양(왼쪽 묶음 | 태그 + 한 문장): 암묵지·데이터는 장표별, 도구는 기능별, 기억은 주제별.
// 암묵지 중 장표별 노하우는 여기서 바로 고치고 더한다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ACTION_TYPES, type ActionType } from '@/lib/deck/agent';
import { PARTS, SECTIONS, TEMPLATES } from '@/lib/deck/catalog';
import { KINDS, KIND_LABEL, SLIDES as TIP_SLIDES, forGrade, type Knowledge, type KnowledgeKind, type KnowledgeSlide } from '@/lib/deck/knowledge';
import type { DataReport } from '@/lib/deck/sources';
import type { Slide } from '@/lib/deck/model';
import type { DeckData } from '@/lib/deck/types';
import { rowsOf, short, type DataRow } from './DataView';

type Node = 'entry' | 'agent' | 'out' | 'tacit' | 'tool' | 'data' | 'memory';

// 도식 좌표 (960 × 232, 좁으면 비율대로 줄임)
const W = 960;
const H = 232;
const BOX: Record<Node, [x: number, y: number, w: number, h: number]> = {
  entry: [0, 12, 200, 76],
  agent: [280, 12, 400, 76],
  out: [760, 12, 200, 76],
  tacit: [61, 158, 196, 64],
  tool: [275, 158, 196, 64],
  data: [489, 158, 196, 64],
  memory: [703, 158, 196, 64],
};
const EDGES: { a: Node; b: Node; d: string; arrow?: boolean }[] = [
  { a: 'entry', b: 'agent', d: 'M200 50 H277', arrow: true },
  { a: 'agent', b: 'out', d: 'M680 50 H757', arrow: true },
  { a: 'agent', b: 'tacit', d: 'M480 88 V122 H159 V158' },
  { a: 'agent', b: 'tool', d: 'M480 88 V122 H373 V158' },
  { a: 'agent', b: 'data', d: 'M480 88 V122 H587 V158' },
  { a: 'agent', b: 'memory', d: 'M480 88 V122 H801 V158' },
];

const ACTION_LABEL: Record<ActionType, string> = {
  tranches: '트랜치', max_amount: '최대 증액', pay_date: '납입일', demand_date: '수요예측일', band: '금리 밴드',
  coupon: '이자 지급', rating: '등급', fee: '수수료', series: '회차', slides: '장표 넣기·빼기', template: '템플릿',
  peer_scope: '비교 범위', sales_ai: 'Sales 전략 문안', edit_text: '문안 고치기', goto: '장표 이동', reset: '처음으로',
};

// 코드에 반영된 암묵지 (rules.ts·validate.ts·catalog.ts 와 같은 내용). 여기서는 읽기만.
type Fixed = { slide: KnowledgeSlide | 'toc'; kind: 'rule' | 'toc'; body: string };
const RULES: Fixed[] = [
  { slide: 'all', kind: 'rule', body: '데이터에 있는 숫자만 쓰고, 출처 없는 시장 전망·단정 표현은 뺀다.' },
  { slide: 'terms', kind: 'rule', body: '금리 밴드는 개별민평 ±30bp로 제시한다.' },
  { slide: 'sizing', kind: 'rule', body: '최대 증액은 최근 4회 최대 증액 배율(1~2배) × 신고 금액, 100억 단위로 올린다.' },
  { slide: 'schedule', kind: 'rule', body: '납입일은 기준일 + 25영업일 이후. 150일 안에 기존 공모채 만기가 있으면 만기 2주 전에 맞추고 12/15~12/31은 피한다.' },
  { slide: 'peers', kind: 'rule', body: '같은 등급 최근 1년 사례만 쓰고, 보증·담보부로 보이는 회차와 공기업은 뺀다.' },
];
function tocAtoms(): Fixed[] {
  const on = (part: string) =>
    SECTIONS.filter((s) => (part === 'A' ? s.appendix : s.part === part) && s.items.some((i) => i.on)).map((s) => (part === 'A' ? s.items.filter((i) => i.on).map((i) => i.title).join(' · ') : s.label)).join(' · ');
  const [p1, p2] = PARTS;
  const lite = TEMPLATES.find((t) => t.key === 'lite');
  return [
    { slide: 'toc', kind: 'toc', body: `기본 목차는 ${p1.key} ${p1.label}(${on(p1.key)}) → ${p2.key} ${p2.label}(${on(p2.key)}) → Appendix(${on('A')}) 순서.` },
    { slide: 'toc', kind: 'toc', body: `${p1.key}부는 회사·발행 조건으로 장표마다 만들고, ${p2.key}부는 이번 달 Discussion Material 판을 순서·양식 그대로 붙인다(고객 등급 쪽만 맞춤).` },
    ...(lite ? [{ slide: 'toc' as const, kind: 'toc' as const, body: `간략 목차는 ${lite.hint.replace(/\(([^)]*)\)/, ', $1')}.` }] : []),
    { slide: 'toc', kind: 'toc', body: 'NH투자증권 강점·IR·미매각 사례 같은 상세 장표는 남겨 두되 기본으로 끈다.' },
    { slide: 'toc', kind: 'toc', body: '번호는 부마다 1부터, 한 장에 장표가 둘 이상이면 ①② 소제목, 간지는 부마다 한 장.' },
  ];
}

// 기억 예시: 개인·팀·회사 메모 (정책이 정해지면 붙인다. 지금은 보여 주기만, Agent 에는 보내지 않음)
const MEMORY: { head: string; items: [scope: string, body: string][] }[] = [
  { head: '승인', items: [['개인', 'DM 자료를 바꿀 때는 나에게 승인 요청을 보낸다.'], ['팀', '최종 PPT는 팀장 확인 뒤에 고객에게 보낸다.']] },
  { head: '제안 방식', items: [['개인', 'Term-sheet는 2년·3년 두 트랜치안을 먼저 보여 준다.'], ['개인', '수요예측 사례는 같은 등급만 쓴다.']] },
  { head: '회사', items: [['회사', '재무팀은 납입일을 월초로 잡길 원한다.']] },
];

// 도구: 기능 → 도구 (태그: 코드 / AI)
function toolGroups(checks: number) {
  const code = (key: string, body: string) => ({ key, tag: '코드', tone: 'code', body });
  return [
    { head: '계산', items: [code('sch', '발행 일정: 기준일 + 25영업일, 기존 만기·연말 피함'), code('max', '최대 증액: 최근 4회 증액 배율 × 신고 금액'), code('band', '금리 밴드: 개별민평 ±30bp')] },
    { head: '조회', items: [code('dart', '공시: 증권신고서 · 정정신고서 · 발행실적'), code('ecos', '금리: 국고채 · 회사채 · 기준금리'), code('peer', '같은 등급 최근 1년 발행 사례')] },
    { head: '판단', items: [{ key: 'judge', tag: 'AI', tone: 'llm', body: 'Skill 기반 내용 피드백' }] },
    { head: '산출', items: [code('pptx', 'PowerPoint(.pptx)'), code('pdf', 'PDF')] },
    { head: '검수', items: [code('num', '데이터에 없는 숫자가 든 문장 빼기'), code('view', '출처 없는 전망·단정 표현 빼기'), code('mark', checks ? `확인할 곳 표시 · 지금 ${checks}곳` : '확인할 곳 표시')] },
  ];
}

// 데이터: 처음 쓰이는 장표 → 데이터 (외부·내부 칩)
function dataGroups(report: DataReport, ext: DataRow[], int: DataRow[]) {
  const order = new Map(report.items.map((it, i) => [it.label, i]));
  const by = new Map<string, { at: number; items: Atom[] }>();
  const add = (r: DataRow, kind: 'ext' | 'int') => {
    const first = [...r.slides].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))[0] ?? '기타';
    const head = short(first);
    const g = by.get(head) ?? { at: order.get(first) ?? 999, items: [] };
    g.items.push(
      kind === 'ext'
        ? { key: `e|${r.label}|${r.source}`, tag: '외부', tone: 'ext', body: <>{r.label}<span className="fl-src" title={r.source}>{r.source}</span></> }
        : { key: `i|${r.label}|${r.source}`, tag: '내부', tone: 'int', body: <>{r.label}<span className="fl-src">{r.source} · <b className="dk2-unlinked">미연계</b></span></> },
    );
    by.set(head, g);
  };
  ext.forEach((r) => add(r, 'ext'));
  int.forEach((r) => add(r, 'int'));
  return [...by.entries()].sort((a, b) => a[1].at - b[1].at).map(([head, g]) => ({ head, items: g.items }));
}

// 도식을 칸 너비에 맞춰 줄임
function Fit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="fl-fit">
      <div style={{ width: W * k, height: H * k, margin: '0 auto' }}>
        <div className="fl-canvas" style={{ width: W, height: H, transform: `scale(${k})` }}>{children}</div>
      </div>
    </div>
  );
}

export function FlowView({ report, data, tips, slides, checks, examples, onGo, onData, onTips }: {
  report: DataReport;
  data: DeckData;
  tips: Knowledge[];
  slides: Slide[];
  checks: number;
  examples: string[];
  onGo: (i: number) => void;
  onData: () => void;
  onTips: (list: Knowledge[]) => void;
}) {
  const [on, setOn] = useState<Node>('agent');
  const ext = rowsOf(report, 'ext');
  const int = rowsOf(report, 'int');
  const myTips = forGrade(tips, data.company.rating_group);
  const tacitN = myTips.length + RULES.length + tocAtoms().length;

  const box = (id: Node, body: ReactNode, cls = '') => {
    const [x, y, w, h] = BOX[id];
    return (
      <button
        type="button"
        className={`fl-node n-${id}${cls ? ` ${cls}` : ''}`}
        style={{ left: x, top: y, width: w, height: h }}
        aria-pressed={on === id}
        onClick={() => setOn(id)}
      >
        {body}
      </button>
    );
  };
  const lit = (e: (typeof EDGES)[number]) => e.a === on || e.b === on;

  return (
    <div className="dk2-flow">
      <Fit>
        <svg className="fl-edges" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <defs>
            {(['', 'on'] as const).map((k) => (
              <marker key={k} id={`fl-ah${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className={k ? 'is-on' : undefined} />
              </marker>
            ))}
          </defs>
          {[...EDGES].sort((a, b) => Number(lit(a)) - Number(lit(b))).map((e) => (
            <path
              key={`${e.a}-${e.b}`}
              d={e.d}
              className={`fl-e${lit(e) ? ' is-on' : ''}`}
              markerEnd={e.arrow ? `url(#fl-ah${lit(e) ? 'on' : ''})` : undefined}
            />
          ))}
        </svg>

        {box('entry', <><strong>사용자 입력</strong><span>초안 작성 · 채팅</span></>)}
        {box(
          'agent',
          <>
            <strong>제안서 Agent</strong>
            <span className="fl-agent-steps">
              <em>의도 해석</em>
              <b aria-hidden>→</b>
              <em>실행 계획</em>
              <b aria-hidden>→</b>
              <em>Sub-agent</em>
            </span>
          </>,
          'is-core',
        )}
        {box('out', <><strong>Output</strong><span>편집·저장 가능한 장표</span></>)}
        {box('tacit', <><strong>암묵지 <i className="fl-kind">Skill</i></strong><span>목차 · 규칙 · 장표별 팁 {tacitN}</span></>, 'is-tacit')}
        {box('tool', <><strong>도구 <i className="fl-kind">Tool</i></strong><span>계산 · 조회 · 판단 · 산출 · 검수</span></>)}
        {box('data', <><strong>데이터</strong><span>외부 {ext.length} · 내부 {int.length} <b className="dk2-unlinked">미연계</b></span></>)}
        {box('memory', <><strong>기억 <i className="fl-kind">Memory</i></strong><span>개인 · 팀 · 회사 메모</span></>)}
      </Fit>

      <section className="fl-detail" aria-live="polite">
        {on === 'entry' && (
          <>
            <Head title="사용자 입력" />
            <Atoms
              groups={[{
                items: [
                  { key: 'draft', tag: '초안 작성', body: '회사를 고르면 기본 조건으로 바로 만든다.' },
                  { key: 'chat', tag: '채팅 입력', body: '딜 조건 · 전략 · 문안을 말로 바꾼다.' },
                ],
              }]}
            />
            <Chips label="예시" list={examples} />
          </>
        )}

        {on === 'agent' && (
          <>
            <Head title="제안서 Agent" />
            <div className="fl-steps">
              <div>
                <strong>의도 해석</strong><span className="fl-tag t-llm">LLM</span>
                <p>요청 → 할 일 목록</p>
              </div>
              <b aria-hidden>→</b>
              <div>
                <strong>실행 계획</strong><span className="fl-tag t-code">코드</span>
                <p>할 일마다 도구·Sub-agent를 정하고, 값을 검사한 뒤 반영</p>
              </div>
              <b aria-hidden>→</b>
              <div>
                <strong>Sub-agent 호출</strong><span className="fl-tag t-llm">LLM</span>
                <p>Tool · 데이터 호출</p>
              </div>
            </div>
            <Chips label={`할 수 있는 일 ${ACTION_TYPES.length}`} list={ACTION_TYPES.map((a) => ACTION_LABEL[a])} />
          </>
        )}

        {on === 'out' && (
          <>
            <Head title="Output" extra={<span className="muted small tnum">{slides.length}장{checks ? ` · 확인할 곳 ${checks}곳` : ''} · PPT·PDF</span>} />
            <ol className="fl-slides">
              {slides.map((s, i) => (
                <li key={`${s.id}-${i}`}>
                  <button type="button" className="linklike" onClick={() => onGo(i)}>
                    <span className="muted tnum">{i + 1}</span> {s.title}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}

        {on === 'tacit' && <Tacit mine={myTips} onTips={onTips} />}

        {on === 'tool' && (
          <>
            <Head title="도구" kind="Tool" />
            <Atoms groups={toolGroups(checks)} />
          </>
        )}

        {on === 'data' && (
          <>
            <Head title="데이터" extra={<span className="muted small tnum">{ext.length + int.length}건 · {data.asof} 기준</span>} />
            <Atoms groups={dataGroups(report, ext, int)} />
            <button type="button" className="dk2-more" onClick={onData}>데이터 탭에서 보기</button>
          </>
        )}

        {on === 'memory' && (
          <>
            <Head title="기억" kind="Memory" extra={<span className="muted small">예시</span>} />
            <Atoms groups={MEMORY.map((g) => ({ head: g.head, items: g.items.map(([scope, body], i) => ({ key: `${g.head}${i}`, tag: scope, tone: 'fixed', body })) }))} />
          </>
        )}
      </section>
    </div>
  );
}

function Head({ title, kind, extra, right }: { title: string; kind?: string; extra?: ReactNode; right?: ReactNode }) {
  return (
    <div className="fl-head-row">
      <h3 className="fl-head">
        {title}
        {kind && <i className="fl-kind">{kind}</i>}
        {extra}
      </h3>
      {right}
    </div>
  );
}

function Chips({ label, list }: { label: string; list: string[] }) {
  return (
    <div className="fl-chips">
      <p className="muted small">{label}</p>
      <ul>
        {list.map((x) => <li key={x}>{x}</li>)}
      </ul>
    </div>
  );
}

// 암묵지·도구·데이터·기억 공통 줄: 태그 + 한 문장 (+ 고치기·지우기)
type Atom = { key: string; tag: string; tone?: string; title?: string; body: ReactNode; act?: ReactNode; edit?: ReactNode };
function Atoms({ groups }: { groups: { head?: string; items: Atom[] }[] }) {
  return (
    <dl className="fl-atoms">
      {groups.map((g, gi) => {
        const items = g.items;
        if (!items.length) return null;
        return (
          <div key={g.head ?? gi} className={g.head ? undefined : 'is-flat'}>
            {g.head && <dt>{g.head}</dt>}
            <dd>
              <ul>
                {items.map((a) => (
                  <li key={a.key} className="fl-atom">
                    {a.edit ?? (
                      <>
                        <span className={`fl-tag${a.tone ? ` t-${a.tone}` : ''}`}>{a.tag}</span>
                        <p className="fl-atom-text">
                          {a.title && <strong>{a.title}</strong>}
                          {a.body}
                        </p>
                        {a.act}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// 암묵지: 목차·규칙(코드에 반영, 읽기만) + 장표별 노하우(DB, 고치기·더하기·지우기). 모두 같은 줄 모양.
const AUTHOR_KEY = 'dcm.fb.author';
const CLIENT_KEY = 'dcm.client.v1';
function ls(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function clientId() {
  let id = ls(CLIENT_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try {
      localStorage.setItem(CLIENT_KEY, id);
    } catch {
      /* 무시 */
    }
  }
  return id;
}
async function post(payload: Record<string, unknown>) {
  const r = await fetch('/api/deck/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, author: ls(AUTHOR_KEY) || null, clientId: clientId() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? '저장하지 못했어요.');
  return j as { id: number };
}

type Draft = { id: number | null; slide: KnowledgeSlide; kind: KnowledgeKind; grade: string | null; body: string; source: string | null };

function Tacit({ mine, onTips }: { mine: Knowledge[]; onTips: (list: Knowledge[]) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; undo?: number } | null>(null);
  const toc = tocAtoms();

  async function refresh() {
    const r = await fetch('/api/deck/knowledge', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) onTips(j.items ?? []);
  }
  async function run(fn: () => Promise<unknown>, done: { text: string; undo?: number }) {
    setBusy(true);
    try {
      await fn();
      setNote(done);
      setDraft(null);
      await refresh();
    } catch (e) {
      setNote({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const save = (d: Draft) => {
    if (d.body.trim().length < 5) return setNote({ text: '내용을 5자 이상 적어 주세요.' });
    run(() => post({ action: 'save', ...d }), { text: d.id ? '고쳤어요.' : '더했어요.' });
  };
  const remove = (k: Knowledge) => run(() => post({ action: 'delete', id: k.id }), { text: '지웠어요.', undo: k.id });
  const restore = (id: number) => run(() => post({ action: 'restore', id }), { text: '되살렸어요.' });

  const editor = (d: Draft) => (
    <form className="fl-edit" onSubmit={(e) => { e.preventDefault(); save(d); }} aria-label={d.id ? '암묵지 고치기' : '암묵지 더하기'}>
      <div className="fl-edit-row">
        <select aria-label="장표" value={d.slide} onChange={(e) => setDraft({ ...d, slide: e.target.value as KnowledgeSlide })}>
          {TIP_SLIDES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select aria-label="유형" value={d.kind} onChange={(e) => setDraft({ ...d, kind: e.target.value as KnowledgeKind })}>
          {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <textarea aria-label="내용" rows={2} maxLength={500} value={d.body} autoFocus onChange={(e) => setDraft({ ...d, body: e.target.value })} placeholder="예: AA급 2년물은 보험사 참여가 적어 3년물 중심으로 제안" />
      <div className="fl-edit-act">
        <button type="submit" className="btn" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
        <button type="button" className="linklike" onClick={() => setDraft(null)}>취소</button>
      </div>
    </form>
  );

  const fixedAtom = (f: Fixed, i: number): Atom => ({ key: `f${f.slide}${i}`, tag: f.kind === 'toc' ? '목차' : '규칙', tone: 'fixed', body: f.body });
  const tipAtom = (k: Knowledge): Atom => ({
    key: `k${k.id}`,
    tag: KIND_LABEL[k.kind],
    tone: k.kind,
    body: <>{k.body}{k.grade && <span className="fl-grade">{k.grade}</span>}</>,
    edit: draft?.id === k.id ? editor(draft) : undefined,
    act: (
      <span className="fl-atom-act">
        <button type="button" className="linklike" onClick={() => setDraft({ id: k.id, slide: k.slide, kind: k.kind, grade: k.grade, body: k.body, source: k.source })}>고치기</button>
        <button type="button" className="linklike" onClick={() => remove(k)} disabled={busy}>지우기</button>
      </span>
    ),
  });

  const groups = [
    { head: '목차', items: toc.map(fixedAtom) },
    ...TIP_SLIDES.map(([key, label]) => ({
      head: label,
      items: [...RULES.filter((r) => r.slide === key).map(fixedAtom), ...mine.filter((k) => k.slide === key).map(tipAtom)],
    })).filter((g) => g.items.length),
  ];

  return (
    <>
      <Head
        title="암묵지"
        kind="Skill"
        extra={<span className="muted small tnum">{toc.length + RULES.length + mine.length}개</span>}
        right={
          <button type="button" className="fl-add" onClick={() => setDraft({ id: null, slide: 'all', kind: 'judge', grade: null, body: '', source: null })} disabled={!!draft && !draft.id}>
            + 더하기
          </button>
        }
      />
      {note && (
        <p className="fl-note small" role="status">
          {note.text}
          {note.undo && <> <button type="button" className="linklike" onClick={() => restore(note.undo!)} disabled={busy}>되돌리기</button></>}
        </p>
      )}
      {draft && !draft.id && <div className="fl-edit-new">{editor(draft)}</div>}
      <Atoms groups={groups} />
    </>
  );
}

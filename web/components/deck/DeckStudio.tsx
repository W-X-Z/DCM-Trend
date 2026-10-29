'use client';

// 제안서 초안: 탭은 미리보기 | 데이터 | 흐름도, 오른쪽 위 다운로드(PPT·PDF), 오른쪽에 Agent 채팅(접기 가능).
// 조건·목차·문안은 채팅으로 바꾼다: LLM 은 요청을 행동 목록으로 해석만 하고(/api/deck/agent), 반영은 코드(lib/deck/agent.ts)가 검사 후 한다.
// 입력값·문안은 이 브라우저(localStorage)에만 저장한다. 서버에는 공개 데이터 조회, 채팅·Sales 문안 요청만 보낸다.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentState, applyActions, TEXT_FIELDS, type AgentAction } from '@/lib/deck/agent';
import type { Knowledge } from '@/lib/deck/knowledge';
import { available, buildSlides, fileBase, staticSubs } from '@/lib/deck/layout';
import { planOf, type ItemId } from '@/lib/deck/catalog';
import { defaultInput, factsFor, ruleText, salesFacts } from '@/lib/deck/rules';
import { dataReport } from '@/lib/deck/sources';
import { qaChecks, type Qa } from '@/lib/deck/qa';
import { reviewMarks } from '@/lib/deck/review';
import { allowedNumbers, lineOk } from '@/lib/deck/validate';
import { PAGE } from '@/lib/deck/theme';
import type { Slide } from '@/lib/deck/model';
import type { DeckData, DeckInput, DeckText } from '@/lib/deck/types';
import { AgentChat } from './AgentChat';
import { DataView } from './DataView';
import { FlowView } from './FlowView';
import { SlideView } from './SlideView';

// 문안: 규칙(로직) 그대로 또는 고친 문안. AI 는 Sales 전략 문안에만 쓰고 따로 둔다(salesAi).
type Mode = 'rule' | 'edited';
type View = 'preview' | 'data' | 'flow';
const VIEWS: [View, string][] = [['preview', '미리보기'], ['data', '데이터'], ['flow', '흐름도']];
type Saved = { v: 2 | 3 | 4; input: DeckInput; text: DeckText | null; mode: Mode | 'ai'; factsKey: string | null; at: string; salesAi?: string[] | null; salesKey?: string | null };
const KEY = (corp: string) => `deck:v2:${corp}`;
const CHAT_KEY = 'dk2.chat.v1';

const SUGGESTIONS = ['Sales 전략 문안 써줘', '납입일을 일주일 뒤로 미뤄줘', '이 트랜치 구조를 제안한 근거는?'];

// 행동 → 보여 줄 장표
const SLIDE_OF: Partial<Record<AgentAction['type'], ItemId>> = {
  tranches: 'terms', max_amount: 'terms', band: 'terms', coupon: 'terms', rating: 'terms', fee: 'terms', series: 'terms',
  pay_date: 'schedule', demand_date: 'schedule', peer_scope: 'peers', sales_ai: 'sales',
};
const SLIDE_OF_TEXT: Partial<Record<keyof DeckText, ItemId>> = {
  lead: 'terms', structure: 'terms', sizing: 'sizing', schedule: 'schedule', sales: 'sales', pipeline: 'pipeline',
  peers: 'peers', compare: 'compare', league: 'league', maturity: 'maturity',
};

function load(corp: string): Saved | null {
  try {
    const s = localStorage.getItem(KEY(corp));
    return s ? (JSON.parse(s) as Saved) : null;
  } catch {
    return null;
  }
}
function save(corp: string, s: Saved) {
  try {
    localStorage.setItem(KEY(corp), JSON.stringify(s));
  } catch {
    /* 저장 공간이 없거나 막힘: 이번 화면에서만 유지 */
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const keyOf = (facts: unknown) => {
  const s = JSON.stringify(facts);
  return `${s.length}:${hash(s)}`;
};
const baseId = (id: string) => id.replace(/-\d+$/, '');

export function DeckStudio({ corp, aiEnabled }: { corp: string; aiEnabled: boolean }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState<DeckInput | null>(null);
  const [text, setText] = useState<DeckText | null>(null);
  const [mode, setMode] = useState<Mode>('rule');
  const [salesAi, setSalesAi] = useState<string[] | null>(null);
  const [salesKey, setSalesKey] = useState<string | null>(null);
  const [factsKey, setFactsKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'ai' | 'pptx' | 'pdf'>('');
  const [note, setNote] = useState<string | null>(null);
  const [tips, setTips] = useState<Knowledge[]>([]);
  const [view, setView] = useState<View>('preview');
  const [cur, setCur] = useState(0);
  const [want, setWant] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  // Agent 패널 접기 (이 브라우저에 기억)
  const [chatOpen, setChatOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAT_KEY) === '0') setChatOpen(false);
    } catch {
      /* 저장소 막힘: 펼친 채로 */
    }
  }, []);
  const toggleChat = useCallback(() => {
    setChatOpen((v) => {
      try {
        localStorage.setItem(CHAT_KEY, v ? '0' : '1');
      } catch {
        /* 무시 */
      }
      return !v;
    });
  }, []);

  // 현업 노하우: 검수(숫자 허용)와 Sales 문안에 쓴다
  useEffect(() => {
    fetch('/api/deck/knowledge', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setTips(j.items ?? []))
      .catch(() => setTips([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    setGreeting(null);
    fetch(`/api/deck/data?corp=${encodeURIComponent(corp)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '데이터를 불러오지 못했습니다.');
        return j as DeckData;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        const s = load(corp);
        const base = defaultInput(d);
        if (s && s.v === 4) {
          setInput({ ...base, ...s.input, items: { ...base.items, ...s.input.items }, band: { ...base.band, ...s.input.band }, internal: { ...base.internal, ...s.input.internal } });
          setText(s.text);
          setMode(s.mode === 'edited' ? 'edited' : 'rule');
          setFactsKey(s.factsKey);
          setSalesAi(s.salesAi ?? null);
          setSalesKey(s.salesKey ?? null);
        } else {
          const keep = s ? { tranches: s.input.tranches, contacts: s.input.contacts, dept: s.input.dept, coverDept: s.input.coverDept, internal: { ...base.internal, ...s.input.internal } } : {};
          setInput({ ...base, ...keep });
          setText(null);
          setMode('rule');
          setSalesAi(null);
          setSalesKey(null);
        }
      })
      .catch((e: Error) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [corp]);

  const rule = useMemo(() => (data && input ? ruleText(data, input) : null), [data, input]);
  const facts = useMemo(() => (data && input ? factsFor(data, input) : null), [data, input]);
  const curKey = useMemo(() => (facts ? keyOf(facts) : null), [facts]);
  const shownText = useMemo(() => {
    const b = mode === 'rule' || !text ? rule : text;
    return b && salesAi ? { ...b, sales: salesAi } : b;
  }, [mode, text, rule, salesAi]);
  const slides = useMemo(() => (data && input && shownText ? buildSlides(data, input, shownText) : []), [data, input, shownText]);
  const stale = (mode !== 'rule' && factsKey && curKey && factsKey !== curKey) || (salesAi && salesKey && curKey && salesKey !== curKey);
  const avail = useMemo(() => (data && input ? available(data, input) : () => false), [data, input]);
  const report = useMemo(() => (data && input ? dataReport(data, input, avail) : null), [data, input, avail]);
  const qa = useMemo(() => {
    if (!data || !input || !shownText) return [] as Qa[];
    const plan = planOf(input.items, avail);
    const shown = new Set(plan.sections.flatMap((s) => s.items.map((i) => i.id)));
    return qaChecks(data, input, shownText, { on: (id) => shown.has(id), edited: mode === 'edited', extraAllowed: [tips.map((k) => k.body)] });
  }, [data, input, shownText, mode, tips, avail]);
  const marks = useMemo(() => (data && input && shownText ? reviewMarks(slides, data, input, shownText, qa) : []), [slides, data, input, shownText, qa]);

  // 첫 인사: 처음 만든 초안 기준으로 한 번만
  useEffect(() => {
    if (greeting || !data || !input || !slides.length) return;
    setGreeting(
      `${data.company.corp_name}${input.series ? ` 제${input.series}회` : ''} 공모사채 제안서 초안 ${slides.length}장을 만들었어요. ` +
        '딜 조건이나 전략을 바꾸고 싶으시면 편하게 말씀해주세요.',
    );
  }, [greeting, data, input, slides]);

  // 채팅으로 바꾼 장표로 이동
  useEffect(() => {
    if (!want) return;
    const i = slides.findIndex((s) => baseId(s.id) === want);
    if (i >= 0) setCur(i);
    setWant(null);
  }, [want, slides]);

  // 저장 (입력이 바뀌면 0.6초 뒤)
  useEffect(() => {
    if (!input) return;
    const t = setTimeout(() => {
      save(corp, { v: 4, input, text: mode === 'rule' ? null : text, mode, factsKey, salesAi, salesKey, at: new Date().toISOString() });
    }, 600);
    return () => clearTimeout(t);
  }, [corp, input, text, mode, factsKey, salesAi, salesKey]);

  // AI 는 Sales 전략 문안에만: 공개 수요예측 데이터(투자자 구분별 참여)로 쓴다. 내부 기관별 데이터는 보내지 않는다.
  const runSales = useCallback(async (inp: DeckInput): Promise<string> => {
    if (!data) return '';
    setBusy('ai');
    try {
      const r = await fetch('/api/deck/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts: salesFacts(data, inp), rule: ruleText(data, inp), grade: data.company.rating_group ?? null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Sales 문안을 만들지 못했어요.');
      setSalesAi(j.sales);
      setSalesKey(keyOf(factsFor(data, inp)));
      if (j.usedRule) return '근거 숫자가 맞는 문장이 없어 규칙 문안을 그대로 뒀어요.';
      const used = j.applied ? `Sales 노하우 ${j.applied}개를 반영했어요.` : '';
      return [used, j.dropped ? `근거 숫자가 없거나 전망 표현이 있는 ${j.dropped}줄은 뺐어요.` : '', '내려받기 전에 숫자를 확인해 주세요.'].filter(Boolean).join(' ');
    } catch (e) {
      return (e as Error).message;
    } finally {
      setBusy('');
    }
  }, [data]);

  // 채팅 행동 반영: 값 검사 → 입력값·문안 변경 → 바뀐 장표로 이동
  const apply = useCallback(async (actions: AgentAction[]) => {
    if (!data || !input || !rule || !facts) return { changes: [], notes: [] };
    const res = applyActions(data, input, actions, avail);
    const changes = [...res.changes];
    const notes = [...res.rejected];
    let next = res.input;
    if (res.reset) {
      try {
        localStorage.removeItem(KEY(corp));
      } catch {
        /* 무시 */
      }
      next = defaultInput(data);
      setText(null);
      setMode('rule');
      setFactsKey(null);
      setSalesAi(null);
      setSalesKey(null);
    }
    setInput(next);

    // 문안 고치기: 숫자는 사실 묶음·지금 문안에 있는 값만 허용
    if (res.edits.length && !res.reset) {
      const allowed = allowedNumbers(facts, rule, shownText, tips.map((k) => k.body));
      let base: DeckText = mode === 'rule' || !text ? rule : text;
      let sales = salesAi;
      for (const e of res.edits) {
        const label = TEXT_FIELDS.find((f) => f.key === e.field)?.label ?? e.field;
        const ok = e.lines.filter((l) => lineOk(l, allowed, false).ok);
        if (!ok.length) {
          notes.push(`${label} 문안은 데이터에 없는 숫자나 전망 표현이 있어 고치지 않았어요.`);
          continue;
        }
        if (e.field === 'sales' && sales) sales = ok;
        else base = { ...base, [e.field]: e.field === 'lead' ? ok[0] : ok };
        changes.push(`${label} 문안 고침${ok.length < e.lines.length ? ` (${e.lines.length - ok.length}줄 제외)` : ''}`);
      }
      if (base !== (mode === 'rule' || !text ? rule : text)) {
        setText(base);
        if (mode === 'rule') setFactsKey(curKey);
        setMode('edited');
      }
      if (sales !== salesAi) setSalesAi(sales);
    }

    const first = actions.find((a) => SLIDE_OF[a.type]);
    const target = res.goto ?? (res.edits[0] ? SLIDE_OF_TEXT[res.edits[0].field] : null) ?? (first ? SLIDE_OF[first.type] : null);
    if (res.sales) {
      notes.push(await runSales(next));
      changes.push('Sales 전략 문안 작성(AI)');
    }
    if (target) {
      setView('preview');
      setWant(target);
    }
    return { changes, notes };
  }, [data, input, rule, facts, avail, corp, shownText, tips, mode, text, salesAi, curKey, runSales]);

  async function exportAs(kind: 'pptx' | 'pdf') {
    if (!input || !slides.length || !data) return;
    setBusy(kind);
    setNote(null);
    try {
      const name = fileBase(input);
      if (kind === 'pptx') {
        const { toPptx } = await import('@/lib/deck/render-pptx');
        download(await toPptx(slides, name, staticSubs(data, input)), `${name}.pptx`);
      } else {
        const { toPdf } = await import('@/lib/deck/render-pdf');
        download(await toPdf(slides, name), `${name}.pdf`);
      }
    } catch (e) {
      setNote(`파일을 만들지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  if (err) return <p className="empty">{err} <Link href="/proposal">다른 회사 고르기</Link></p>;
  if (!data || !input || !shownText || !report || !facts) return <Loading />;

  const at = Math.min(cur, Math.max(slides.length - 1, 0));
  const state = () =>
    agentState(data, input, shownText, facts as Record<string, unknown>, {
      slides: slides.map((s) => ({ id: s.id, title: s.title })),
      cur: slides[at]?.title ?? null,
      review: marks.map((m) => `${slides[m.slide]?.title ?? ''}: ${m.text}`),
      available: avail,
    });

  return (
    <div className="dk dk2">
      <div className="dk2-bar">
        <div className="dk2-who">
          <Link href="/" className="dk2-home">발행시장 트렌드</Link>
          <h1>{data.company.corp_name} <span>공모사채 제안서</span></h1>
          <span className="dk2-meta muted small">
            {data.company.rating ?? '등급 미확인'} · 공모 회사채 {data.company.bond_count}회 · 데이터 {data.asof}
          </span>
        </div>
        <div className="dk2-tabs" role="tablist" aria-label="보기">
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className="dk2-tab" onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        <p className="dk2-status small" role="status">
          {note ?? (stale ? '조건이 바뀌었어요. 고친 문안의 숫자를 다시 확인해 주세요.' : '')}
        </p>
        <Download busy={busy} onPick={exportAs} />
      </div>

      <div className={`dk2-work${chatOpen ? '' : ' is-chat-closed'}`}>
        <div className="dk2-main">
          {view === 'preview' && (
            <div className="dk2-preview">
              <Rail slides={slides} cur={at} setCur={setCur} />
              <Stage slides={slides} cur={at} setCur={setCur} busy={busy === 'ai'} onFull={() => setFull(true)} />
            </div>
          )}
          {view === 'data' && <DataView report={report} asof={data.asof} />}
          {view === 'flow' && (
            <FlowView
              report={report}
              data={data}
              tips={tips}
              slides={slides}
              checks={marks.length}
              examples={SUGGESTIONS}
              onGo={(i) => {
                setCur(i);
                setView('preview');
              }}
              onData={() => setView('data')}
              onTips={setTips}
            />
          )}
        </div>
        <AgentChat
          enabled={aiEnabled}
          open={chatOpen}
          onToggle={toggleChat}
          greeting={greeting ?? '초안을 만드는 중이에요.'}
          suggestions={SUGGESTIONS}
          state={state}
          apply={apply}
        />
      </div>
      {full && <FullView slides={slides} cur={at} setCur={setCur} onClose={() => setFull(false)} />}
    </div>
  );
}

// 전체보기: 장표를 화면 가득. ←·→ 넘기기, Esc 닫기
function FullView({ slides, cur, setCur, onClose }: { slides: Slide[]; cur: number; setCur: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [w, setW] = useState(960);
  useEffect(() => {
    const fit = () => setW(Math.floor(Math.min(window.innerWidth - 140, ((window.innerHeight - 96) * PAGE.w) / PAGE.h)));
    fit();
    window.addEventListener('resize', fit);
    ref.current?.focus();
    // 브라우저 전체 화면도 시도 (막혀 있으면 화면 안에서만 크게)
    ref.current?.requestFullscreen?.().catch(() => undefined);
    const onFs = () => {
      if (!document.fullscreenElement) close.current();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const n = slides.length;
  const s = slides[cur];
  return (
    <div
      ref={ref}
      className="dk2-full"
      role="dialog"
      aria-modal="true"
      aria-label="장표 전체보기"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if ((e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') && cur < n - 1) setCur(cur + 1);
        else if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && cur > 0) setCur(cur - 1);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button type="button" className="dk2-full-x" aria-label="전체보기 닫기" onClick={onClose}>×</button>
      <button type="button" className="dk2-full-nav is-prev" aria-label="이전 장표" disabled={cur <= 0} onClick={() => setCur(cur - 1)}>‹</button>
      <div className="dk2-full-slide" style={{ width: w }}>{s && <SlideView slide={s} width={w} />}</div>
      <button type="button" className="dk2-full-nav is-next" aria-label="다음 장표" disabled={cur >= n - 1} onClick={() => setCur(cur + 1)}>›</button>
      <p className="dk2-full-foot tnum">{cur + 1} / {n} · {s?.title}</p>
    </div>
  );
}

// 다운로드: 버튼 하나, 누르면 PPT·PDF
function Download({ busy, onPick }: { busy: string; onPick: (k: 'pptx' | 'pdf') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const making = busy === 'pptx' || busy === 'pdf';
  return (
    <div className="dk2-dl" ref={ref}>
      <button type="button" className="btn dk2-dl-btn" aria-haspopup="menu" aria-expanded={open} disabled={!!busy} onClick={() => setOpen((v) => !v)}>
        {making ? `${busy === 'pptx' ? 'PPT' : 'PDF'} 만드는 중…` : '다운로드'}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <ul className="dk2-dl-menu" role="menu">
          <li role="none">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onPick('pptx'); }}>PowerPoint (.pptx)</button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onPick('pdf'); }}>PDF</button>
          </li>
        </ul>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="dk dk-loading" aria-busy="true">
      <div className="dk-skel"><span>공시·금리 데이터를 모아 장표를 만드는 중…</span></div>
    </div>
  );
}

// 왼쪽 장표 목록(썸네일)
function Rail({ slides, cur, setCur }: { slides: Slide[]; cur: number; setCur: (i: number) => void }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  return (
    <ol className="dk-rail" ref={ref} aria-label="장표 목록">
      {slides.map((s, i) => (
        <li key={`${s.id}-${i}`}>
          <button type="button" aria-current={i === cur} aria-label={`${i + 1}. ${s.title}`} onClick={() => setCur(i)}>
            <span className="dk-rail-no tnum" aria-hidden>{i + 1}</span>
            <span className="dk-rail-thumb">
              <SlideView slide={s} width={112} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// 가운데 큰 장표: 화면 높이에 맞춰 키우고, ←·→ 로 넘긴다
function Stage({ slides, cur, setCur, busy, onFull }: { slides: Slide[]; cur: number; setCur: (i: number) => void; busy: boolean; onFull: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const maxH = Math.max(260, window.innerHeight - 190);
      setW(Math.max(240, Math.floor(Math.min(inner, (maxH * PAGE.w) / PAGE.h))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);
  const n = slides.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || e.altKey || e.metaKey || e.ctrlKey)) return;
      if ((e.key === 'ArrowRight' || e.key === 'PageDown') && cur < n - 1) setCur(cur + 1);
      else if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && cur > 0) setCur(cur - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur, n, setCur]);
  const s = slides[cur];
  return (
    <section className="dk-stage" ref={ref} aria-label="장표 보기">
      <div className={`dk-stage-frame${busy ? ' is-busy' : ''}`} style={{ width: w }}>
        {s && <SlideView slide={s} width={w} />}
      </div>
      <div className="dk-stage-foot" style={{ width: w }}>
        <div className="dk-nav">
          <button type="button" aria-label="이전 장표" disabled={cur <= 0} onClick={() => setCur(cur - 1)}>‹</button>
          <span className="tnum" aria-live="polite">{n ? cur + 1 : 0} / {n}</span>
          <button type="button" aria-label="다음 장표" disabled={cur >= n - 1} onClick={() => setCur(cur + 1)}>›</button>
          <span className="dk-stage-title">{s?.title}</span>
        </div>
        <button type="button" className="dk2-full-btn" onClick={onFull}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          전체보기
        </button>
      </div>
    </section>
  );
}

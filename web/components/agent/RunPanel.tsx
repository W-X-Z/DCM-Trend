'use client';

// 실행: 채팅으로 제안서 Agent(Master + Sub-agent)를 돌린다. 도구 호출이 일어나는 대로 보여 주고,
// 엔진 상태가 바뀌면 오른쪽 미리보기를 그 장표로 옮긴다. PPTX·PDF 는 이 브라우저에서 만든다(웹 제안서 화면과 같은 렌더러).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLES, type AgentKey } from '@/lib/agent/config';
import { RUN_KEY, memoryText, readLS, writeLS, type MemoryFile, type Skill } from '@/lib/agent/store';
import type { Msg, RunEvent } from '@/lib/agent/run';
import { normalizeState, shownText, type EngineState } from '@/lib/deck/engine';
import { buildSlides, fileBase, staticSubs } from '@/lib/deck/layout';
import { factsFor, ruleText } from '@/lib/deck/rules';
import { PAGE } from '@/lib/deck/theme';
import type { DeckData } from '@/lib/deck/types';
import { SlideView } from '../deck/SlideView';

type Step = { id: string; label: string; status: 'run' | 'ok' | 'fail'; note: string };
type Part =
  | { k: 'text'; text: string }
  | { k: 'tool'; id: string; name: string; label: string; status: 'run' | 'ok' | 'fail'; note: string; sub?: { agent: AgentKey; steps: Step[]; text?: string } }
  | { k: 'render'; name: string; slides: number }
  | { k: 'error'; text: string };
type Turn = { role: 'user'; text: string } | { role: 'assistant'; parts: Part[]; model?: string; done?: boolean };
type Saved = { v: 1; turns: Turn[]; api: Msg[]; state: EngineState | null };

const AGENT_NAME: Record<AgentKey, string> = { master: 'Master', sales_writer: 'Sales Writer', reviewer: 'Reviewer' };
const MORE = ['확인할 곳 알려줘', 'Sales 전략 문안 써줘', '이 초안 검토해줘', 'PPT로 만들어줘'];

// 지난 턴의 긴 도구 결과는 줄여서 둔다(저장 공간·보내는 양)
function trimOld(api: Msg[]): Msg[] {
  let last = -1;
  api.forEach((m, i) => {
    if (m.role === 'user' && typeof m.content === 'string') last = i;
  });
  return api.map((m, i) =>
    i >= last || typeof m.content === 'string'
      ? m
      : { ...m, content: m.content.map((b) => (b.type === 'tool_result' && b.content.length > 600 ? { ...b, content: `${b.content.slice(0, 600)}\n…(지난 결과 줄임)` } : b)) },
  );
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

// 제안서 화면(DeckStudio)과 같은 저장 형식(v4)
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const keyOf = (facts: unknown) => {
  const s = JSON.stringify(facts);
  return `${s.length}:${hash(s)}`;
};

// 칸 크기 재기: 칸이 바뀌어도(빈 화면 → 장표) 다시 붙도록 콜백 ref 로
function useBox() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, box] as const;
}

export function RunPanel({ ready, skills, memory, loaded, onDeck, onConfig }: {
  ready: boolean;
  skills: Skill[];
  memory: MemoryFile[];
  loaded: boolean;
  onDeck: (d: { state: EngineState | null; data: DeckData | null }) => void;
  onConfig: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [api, setApi] = useState<Msg[]>([]);
  const [state, setState] = useState<EngineState | null>(null);
  const [data, setData] = useState<DeckData | null>(null);
  const [dataErr, setDataErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(0);
  const [fileBusy, setFileBusy] = useState<'' | 'pptx' | 'pdf'>('');
  const [fileNote, setFileNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [stageRef, stage] = useBox();

  // 지난 대화 불러오기
  useEffect(() => {
    const s = readLS<Saved>(RUN_KEY);
    if (s?.v === 1) {
      setTurns(s.turns.map((t) => (t.role === 'assistant' ? { ...t, done: true } : t)));
      setApi(s.api);
      setState(s.state);
    }
  }, []);
  const persist = useCallback((t: Turn[], a: Msg[], st: EngineState | null) => {
    writeLS(RUN_KEY, { v: 1, turns: t.slice(-60), api: trimOld(a), state: st } satisfies Saved);
  }, []);

  // 연 회사의 공개 데이터(미리보기·파일용)
  const corp = state?.corp ?? null;
  useEffect(() => {
    if (!corp) {
      setData(null);
      return;
    }
    if (data?.company.corp_code === corp) return;
    let alive = true;
    setDataErr(null);
    fetch(`/api/deck/data?corp=${encodeURIComponent(corp)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '데이터를 불러오지 못했어요.');
        return j as DeckData;
      })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setDataErr(e.message));
    return () => {
      alive = false;
    };
  }, [corp, data]);

  const st = useMemo(() => (data && state && data.company.corp_code === state.corp ? normalizeState(data, state) : null), [data, state]);
  const slides = useMemo(() => (data && st ? buildSlides(data, st.input, shownText(data, st)) : []), [data, st]);
  useEffect(() => onDeck({ state: st, data: st ? data : null }), [st, data, onDeck]);
  const at = Math.min(cur, Math.max(slides.length - 1, 0));

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // 스트림 이벤트 → 마지막 assistant 턴에 반영
  const patchLast = (f: (parts: Part[]) => Part[], extra?: Partial<Extract<Turn, { role: 'assistant' }>>) =>
    setTurns((ts) => {
      const i = ts.length - 1;
      const t = ts[i];
      if (!t || t.role !== 'assistant') return ts;
      return [...ts.slice(0, i), { ...t, parts: f(t.parts), ...extra }];
    });

  function onEvent(e: RunEvent) {
    switch (e.t) {
      case 'text':
        patchLast((p) => [...p, { k: 'text', text: e.text }]);
        break;
      case 'tool':
        if (e.agent === 'master') patchLast((p) => [...p, { k: 'tool', id: e.id, name: e.name, label: e.label, status: 'run', note: '' }]);
        else
          patchLast((p) =>
            p.map((x) => (x.k === 'tool' && x.sub && x.sub.agent === e.agent && x.status === 'run' ? { ...x, sub: { ...x.sub, steps: [...x.sub.steps, { id: e.id, label: e.label, status: 'run', note: '' }] } } : x)),
          );
        break;
      case 'tool_done':
        patchLast((p) =>
          p.map((x) => {
            if (x.k !== 'tool') return x;
            if (x.id === e.id) return { ...x, status: e.ok ? 'ok' : 'fail', note: e.note };
            if (x.sub?.steps.some((s) => s.id === e.id)) return { ...x, sub: { ...x.sub, steps: x.sub.steps.map((s) => (s.id === e.id ? { ...s, status: e.ok ? 'ok' : 'fail', note: e.note } : s)) } };
            return x;
          }),
        );
        break;
      case 'sub':
        patchLast((p) => {
          const i = p.map((x) => x.k === 'tool' && x.name === 'call_subagent' && x.status === 'run').lastIndexOf(true);
          if (i < 0) return p;
          const x = p[i] as Extract<Part, { k: 'tool' }>;
          const sub = e.phase === 'start' ? { agent: e.agent, steps: [] } : { ...(x.sub ?? { agent: e.agent, steps: [] }), text: e.text };
          return [...p.slice(0, i), { ...x, sub }, ...p.slice(i + 1)];
        });
        break;
      case 'state':
        setState(e.state);
        if (e.slide != null) setCur(e.slide);
        break;
      case 'render':
        patchLast((p) => [...p, { k: 'render', name: e.name, slides: e.slides }]);
        break;
      case 'error':
        patchLast((p) => [...p, { k: 'error', text: e.message }]);
        break;
      case 'done':
        break;
    }
  }

  // 한 번 요청: NDJSON 을 읽으며 이벤트 처리. 끝 이벤트(done)를 돌려준다.
  async function stream(messages: Msg[], stNow: EngineState | null, signal: AbortSignal) {
    const r = await fetch('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: trimOld(messages),
        state: stNow,
        skills: skills.map((s) => ({ name: s.name, files: s.files, agents: s.agents })),
        memory: memoryText(memory),
      }),
      signal,
    });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? `요청이 실패했어요 (${r.status})`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done: Extract<RunEvent, { t: 'done' }> | null = null;
    let latest = stNow;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let e: RunEvent;
        try {
          e = JSON.parse(line) as RunEvent;
        } catch {
          continue;
        }
        if (e.t === 'state') latest = e.state;
        if (e.t === 'done') done = e;
        onEvent(e);
      }
      if (end) break;
    }
    return { done, state: latest };
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !ready) return;
    setDraft('');
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let msgs: Msg[] = [...api, { role: 'user', content: q }];
    let stNow = state;
    setTurns([...turns, { role: 'user', text: q }, { role: 'assistant', parts: [] }]);
    try {
      for (let hop = 0; hop < 4; hop++) {
        const res = await stream(msgs, stNow, ac.signal);
        stNow = res.state;
        if (!res.done) throw new Error('응답이 중간에 끊겼어요.');
        msgs = res.done.messages;
        patchLast((p) => p, { model: res.done.model });
        if (!res.done.cont) break;
      }
      // 첫 호출부터 실패해 사용자 글만 남았으면 빼서 다음 요청과 짝이 맞게
      const last = msgs[msgs.length - 1];
      if (last?.role === 'user' && typeof last.content === 'string') {
        msgs = msgs.slice(0, -1);
        setDraft(q);
      }
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      patchLast((p) => [...p, { k: 'error', text: aborted ? '멈췄어요.' : (e as Error).message }]);
      if (msgs[msgs.length - 1]?.role === 'user' && typeof msgs[msgs.length - 1].content === 'string') msgs = msgs.slice(0, -1);
      if (!aborted) setDraft(q);
    } finally {
      abort.current = null;
      setBusy(false);
      setApi(msgs);
      setTurns((ts) => {
        const done = ts.map((t, i) => (i === ts.length - 1 && t.role === 'assistant' ? { ...t, done: true } : t));
        persist(done, msgs, stNow);
        return done;
      });
    }
  }

  function reset() {
    abort.current?.abort();
    setTurns([]);
    setApi([]);
    setState(null);
    setCur(0);
    persist([], [], null);
  }

  async function exportAs(kind: 'pptx' | 'pdf') {
    if (!data || !st || !slides.length) return;
    setFileBusy(kind);
    setFileNote(null);
    try {
      const name = fileBase(st.input);
      if (kind === 'pptx') {
        const { toPptx } = await import('@/lib/deck/render-pptx');
        download(await toPptx(slides, name, staticSubs(data, st.input)), `${name}.pptx`);
      } else {
        const { toPdf } = await import('@/lib/deck/render-pdf');
        download(await toPdf(slides, name), `${name}.pdf`);
      }
    } catch (e) {
      setFileNote(`파일을 만들지 못했어요: ${(e as Error).message}`);
    } finally {
      setFileBusy('');
    }
  }

  // 제안서 화면으로 넘기기: 같은 브라우저 저장소에 그 화면 형식으로 써 두고 연다
  function openInStudio() {
    if (!data || !st) return;
    const edited = Object.keys(st.edits).length > 0;
    const k = keyOf(factsFor(data, st.input));
    const saved = {
      v: 4,
      input: st.input,
      text: edited ? { ...ruleText(data, st.input), ...st.edits } : null,
      mode: edited ? 'edited' : 'rule',
      factsKey: edited ? k : null,
      salesAi: st.salesAi,
      salesKey: st.salesAi ? k : null,
      at: new Date().toISOString(),
    };
    writeLS(`deck:v2:${st.corp}`, saved);
    window.open(`/proposal/deck?corp=${encodeURIComponent(st.corp)}`, '_blank', 'noopener');
  }

  const chips = turns.length ? MORE : EXAMPLES;
  // 칸에 맞춤: 너비와 높이(아래 쪽 표시 줄 몫을 뺀) 중 작은 쪽
  const big = Math.max(280, Math.min(stage.w - 32, ((stage.h - 64) * PAGE.w) / PAGE.h, 1100));

  return (
    <div className="ag-run">
      <section className="ag-chat" aria-label="Agent 대화">
        <div className="ag-chat-top">
          <span className="ag-skills-on" title={skills.map((s) => s.name).join(', ')}>
            스킬 {skills.length}개 켬
            <button type="button" className="ag-link" onClick={onConfig}>구성</button>
          </span>
          <button type="button" className="ag-link" onClick={reset} disabled={!turns.length && !state}>새 대화</button>
        </div>
        <div className="dk2-chat-log ag-log" ref={logRef} aria-live="polite">
          {!ready && (
            <div className="dk2-msg is-assistant is-error">
              서버에 Claude API 키가 없어 Agent 를 실행할 수 없어요. Vercel 환경 변수 <code>ANTHROPIC_API_KEY</code> 를 넣으면 켜져요. 구성은 지금도 볼 수 있어요.
            </div>
          )}
          {ready && loaded && !turns.length && (
            <div className="dk2-msg is-assistant">
              회사 이름과 함께 말씀해 주시면 공모 회사채 제안서 초안을 만들고, 대화로 조건·문안을 고쳐 PPT로 드려요.
            </div>
          )}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="dk2-msg is-user">{t.text}</div>
            ) : (
              <AssistantTurn key={i} t={t} live={busy && i === turns.length - 1} onFile={exportAs} fileBusy={fileBusy} canFile={!!slides.length} />
            ),
          )}
        </div>
        <div className="dk2-chat-foot">
          <ul className="dk2-chips">
            {chips.map((c) => (
              <li key={c}>
                <button type="button" disabled={busy || !ready} onClick={() => send(c)}>{c}</button>
              </li>
            ))}
          </ul>
          <form
            className="dk2-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              rows={2}
              value={draft}
              placeholder={ready ? '예: 현대트랜시스 제안서 초안 만들어줘' : 'API 키가 없어 실행할 수 없어요'}
              disabled={!ready}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              aria-label="Agent 에게 보낼 말"
            />
            {busy ? (
              <button type="button" className="ag-stop" onClick={() => abort.current?.abort()}>멈춤</button>
            ) : (
              <button type="submit" disabled={!draft.trim() || !ready}>보내기</button>
            )}
          </form>
        </div>
      </section>

      <section className="ag-stage" aria-label="제안서 미리보기">
        {st && data ? (
          <>
            <div className="ag-stage-bar">
              <div className="ag-stage-title">
                <strong>{fileBase(st.input)}</strong>
                <span>{slides.length}장</span>
              </div>
              <div className="ag-stage-actions">
                <button type="button" className="btn" disabled={!!fileBusy || !slides.length} onClick={() => exportAs('pptx')}>{fileBusy === 'pptx' ? '만드는 중…' : 'PPTX 받기'}</button>
                <button type="button" className="btn btn-ghost" disabled={!!fileBusy || !slides.length} onClick={() => exportAs('pdf')}>{fileBusy === 'pdf' ? '만드는 중…' : 'PDF'}</button>
                <button type="button" className="btn btn-ghost" onClick={openInStudio}>제안서 화면에서 열기</button>
              </div>
            </div>
            {fileNote && <p className="ag-note is-error">{fileNote}</p>}
            <div className="ag-stage-body">
              <ol className="ag-rail" aria-label="장표 목록">
                {slides.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" aria-current={i === at ? 'true' : undefined} onClick={() => setCur(i)} title={s.title}>
                      <span>{i + 1}</span>
                      <SlideView slide={s} width={104} />
                    </button>
                  </li>
                ))}
              </ol>
              <div className="ag-big" ref={stageRef}>
                {slides[at] && (
                  <>
                    <SlideView slide={slides[at]} width={big} />
                    <p className="ag-cap">{at + 1} / {slides.length} · {slides[at].title}</p>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="ag-empty">
            {dataErr ? <p>{dataErr}</p> : corp ? <p>데이터를 불러오는 중…</p> : <p>초안이 만들어지면 여기에 장표가 보여요.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function AssistantTurn({ t, live, onFile, fileBusy, canFile }: { t: Extract<Turn, { role: 'assistant' }>; live: boolean; onFile: (k: 'pptx' | 'pdf') => void; fileBusy: string; canFile: boolean }) {
  const tools = t.parts.filter((p) => p.k === 'tool').length;
  return (
    <div className="ag-turn">
      {t.parts.map((p, i) => {
        if (p.k === 'text') return <div key={i} className="dk2-msg is-assistant ag-text">{p.text}</div>;
        if (p.k === 'error') return <div key={i} className="dk2-msg is-assistant is-error">{p.text}</div>;
        if (p.k === 'render')
          return (
            <div key={i} className="ag-file">
              <span>{p.name} · {p.slides}장</span>
              <button type="button" disabled={!canFile || !!fileBusy} onClick={() => onFile('pptx')}>PPTX</button>
              <button type="button" disabled={!canFile || !!fileBusy} onClick={() => onFile('pdf')}>PDF</button>
            </div>
          );
        return <ToolRow key={p.id} p={p} />;
      })}
      {live && <p className="ag-live">{tools ? '진행 중…' : '생각하는 중…'}</p>}
      {!live && t.done && t.model && tools > 0 && <p className="ag-meta">도구 {tools}번 · {t.model}</p>}
    </div>
  );
}

function ToolRow({ p }: { p: Extract<Part, { k: 'tool' }> }) {
  return (
    <div className={`ag-tool is-${p.status}`}>
      <div className="ag-tool-row">
        <i aria-hidden="true" />
        <span className="ag-tool-label">{p.label}</span>
        {p.note && <span className="ag-tool-note">{p.note}</span>}
      </div>
      {p.sub && (
        <div className="ag-sub">
          <span className="ag-sub-name">{AGENT_NAME[p.sub.agent]}</span>
          {p.sub.steps.map((s) => (
            <div key={s.id} className={`ag-tool-row is-${s.status}`}>
              <i aria-hidden="true" />
              <span className="ag-tool-label">{s.label}</span>
            </div>
          ))}
          {p.sub.text && (
            <details className="ag-sub-out">
              <summary>돌려준 내용</summary>
              <pre>{p.sub.text}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

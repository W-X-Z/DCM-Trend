'use client';

// 실행: 채팅으로 제안서 Agent(Master + 역할 6개)를 돌린다. 역할 호출·도구 결과가 일어나는 대로 보여 주고,
// 작업 세션(초안 상태·결정 기록)이 바뀌면 오른쪽 미리보기를 그 장표로 옮긴다. PPTX·PDF 는 이 브라우저에서 만든다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_LABEL, FIELD_SLIDE, ROLE_NAME, emptySession, staleFields, type AssetTexts, type Msg, type Session, type TextField } from '@/lib/agent/defs';
import type { DcmEvent } from '@/lib/agent/dcm';
import { RUN_KEY, memoryText, readLS, when, writeLS, type MemoryFile } from '@/lib/agent/store';
import { baseId, normalizeState, shownText, type EngineState } from '@/lib/deck/engine';
import { buildSlides, fileBase, staticSubs } from '@/lib/deck/layout';
import { factsFor, ruleText } from '@/lib/deck/rules';
import { PAGE } from '@/lib/deck/theme';
import type { DeckData, DeckText } from '@/lib/deck/types';
import { SlideView } from '../deck/SlideView';
import { ToolRow, applyCommon, postStream, trimOld, useBox, type Part, type Turn } from './chat';

type Saved = { v: 2; turns: Turn[]; api: Msg[]; session: Session };
export type Handoff = { label: string; detail: string };

const EXAMPLES = ['이랜드월드 제안서 초안 만들어줘', '3년 단일 1,500억으로 바꿔줘', '비교 사례에 미매각 사례 넣어줘', '이 초안 검토해줘'];
const MORE = ['검토해줘', 'Sales 문안 다시 써줘', '간략 목차로 바꿔줘', 'PPT로 만들어줘'];

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
const textOfTurn = (t: Extract<Turn, { role: 'assistant' }>) => t.parts.filter((p): p is Extract<Part, { k: 'text' }> => p.k === 'text').map((p) => p.text).join('\n');
const linesOf = (v: DeckText[keyof DeckText]) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : Object.entries(v).map(([k, x]) => `${k}: ${x}`));

export function RunPanel({ ready, texts, memory, loaded, onDeck, onBuilder, rerun }: {
  ready: boolean;
  texts: AssetTexts;
  memory: MemoryFile[];
  loaded: boolean;
  onDeck: (d: { state: EngineState | null; data: DeckData | null }) => void;
  onBuilder: (h: Handoff) => void;
  rerun: { text: string; n: number } | null;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [api, setApi] = useState<Msg[]>([]);
  const [session, setSession] = useState<Session>(emptySession);
  const [data, setData] = useState<DeckData | null>(null);
  const [dataErr, setDataErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(0);
  const [view, setView] = useState<'slides' | 'session'>('slides');
  const [fileBusy, setFileBusy] = useState<'' | 'pptx' | 'pdf'>('');
  const [fileNote, setFileNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [stageRef, stage] = useBox();

  useEffect(() => {
    const s = readLS<Saved>(RUN_KEY);
    if (s?.v === 2) {
      setTurns(s.turns.map((t) => (t.role === 'assistant' ? { ...t, done: true } : t)));
      setApi(s.api);
      setSession({ ...emptySession(), ...s.session });
    }
  }, []);
  const persist = useCallback((t: Turn[], a: Msg[], s: Session) => {
    writeLS(RUN_KEY, { v: 2, turns: t.slice(-60), api: trimOld(a), session: s } satisfies Saved);
  }, []);

  const state = session.state;
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
  const shown = useMemo(() => (data && st ? shownText(data, st) : null), [data, st]);
  const slides = useMemo(() => (data && st && shown ? buildSlides(data, st.input, shown) : []), [data, st, shown]);
  useEffect(() => onDeck({ state: st, data: st ? data : null }), [st, data, onDeck]);
  const at = Math.min(cur, Math.max(slides.length - 1, 0));

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const patchLast = (f: (parts: Part[]) => Part[], extra?: Partial<Extract<Turn, { role: 'assistant' }>>) =>
    setTurns((ts) => {
      const i = ts.length - 1;
      const t = ts[i];
      if (!t || t.role !== 'assistant') return ts;
      return [...ts.slice(0, i), { ...t, parts: f(t.parts), ...extra }];
    });

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !ready) return;
    setDraft('');
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let msgs: Msg[] = [...api, { role: 'user', content: q }];
    let sNow = session;
    setTurns((ts) => [...ts, { role: 'user', text: q }, { role: 'assistant', parts: [] }]);
    try {
      for (let hop = 0; hop < 4; hop++) {
        let done: Extract<DcmEvent, { t: 'done' }> | null = null;
        await postStream<DcmEvent>('/api/agent/run', { messages: trimOld(msgs), session: sNow, assets: texts, memory: memoryText(memory) }, ac.signal, (e) => {
          if (e.t === 'session') {
            sNow = e.session;
            setSession(e.session);
            if (e.slide != null) setCur(e.slide);
            return;
          }
          if (e.t === 'render') return patchLast((p) => [...p, { k: 'render', name: e.name, slides: e.slides }]);
          if (e.t === 'done') {
            done = e;
            return;
          }
          patchLast((p) => applyCommon(p, e));
        });
        const d = done as Extract<DcmEvent, { t: 'done' }> | null;
        if (!d) throw new Error('응답이 중간에 끊겼어요.');
        msgs = d.messages;
        patchLast((p) => p, { model: d.model });
        if (!d.cont) break;
      }
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
        persist(done, msgs, sNow);
        return done;
      });
    }
  }

  // Builder 에서 승인 후 '다시 실행'
  const lastRerun = useRef(0);
  useEffect(() => {
    if (!rerun || rerun.n === lastRerun.current || !loaded) return;
    lastRerun.current = rerun.n;
    void send(rerun.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun, loaded]);

  function reset() {
    abort.current?.abort();
    setTurns([]);
    setApi([]);
    setSession(emptySession());
    setCur(0);
    persist([], [], emptySession());
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

  function openInStudio() {
    if (!data || !st) return;
    const edited = Object.keys(st.edits).length > 0;
    const k = keyOf(factsFor(data, st.input));
    writeLS(`deck:v2:${st.corp}`, {
      v: 4, input: st.input, text: edited ? { ...ruleText(data, st.input), ...st.edits } : null, mode: edited ? 'edited' : 'rule',
      factsKey: edited ? k : null, salesAi: st.salesAi, salesKey: st.salesAi ? k : null, at: new Date().toISOString(),
    });
    window.open(`/proposal/deck?corp=${encodeURIComponent(st.corp)}`, '_blank', 'noopener');
  }

  // Builder 로 넘기기: 답변 또는 지금 장표
  function sendAnswer(t: Extract<Turn, { role: 'assistant' }>, i: number) {
    const q = [...turns.slice(0, i)].reverse().find((x) => x.role === 'user') as Extract<Turn, { role: 'user' }> | undefined;
    const roles = t.parts.flatMap((p) => (p.k === 'tool' ? p.roles ?? [] : [])).filter((r) => r.text).map((r) => `- ${ROLE_NAME[r.role] ?? r.role}: ${r.text?.split('\n')[0]}`);
    onBuilder({ label: '답변', detail: [`요청: ${q?.text ?? ''}`, `답: ${textOfTurn(t).slice(0, 600)}`, roles.length ? `역할 보고:\n${roles.join('\n')}` : ''].filter(Boolean).join('\n') });
  }
  function sendSlide() {
    const s = slides[at];
    if (!s || !shown) return;
    const id = baseId(s.id);
    const fields = (Object.keys(FIELD_SLIDE) as TextField[]).filter((f) => FIELD_SLIDE[f] === id);
    const body = fields.map((f) => `${FIELD_LABEL[f]}${session.texts[f] ? ` (${ROLE_NAME[session.texts[f]!.role]})` : ' (규칙)'}:\n${linesOf(shown[f as keyof DeckText]).map((l) => `  ${l}`).join('\n')}`);
    const dec = session.log.filter((x) => (id === 'terms' || id === 'sizing' || id === 'schedule' ? x.role === 'deal' : id === 'peers' || id === 'compare' ? x.role === 'market' : false)).slice(-4).map((x) => `- ${x.what} (${x.rules.join(', ') || '항목 없음'})`);
    onBuilder({ label: `장표 · ${s.title}`, detail: [`장표: ${at + 1}쪽 ${s.title}`, ...body, dec.length ? `관련 결정:\n${dec.join('\n')}` : ''].filter(Boolean).join('\n') });
  }

  const chips = turns.length ? MORE : EXAMPLES;
  const big = Math.max(280, Math.min(stage.w - 32, ((stage.h - 64) * PAGE.w) / PAGE.h, 1100));
  const stale = staleFields(session);

  return (
    <div className="ag-run">
      <section className="ag-chat" aria-label="Agent 대화">
        <div className="ag-chat-top">
          <span>제안서 Agent · 역할 6</span>
          <button type="button" className="ag-link" onClick={reset} disabled={!turns.length && !state}>새 대화</button>
        </div>
        <div className="dk2-chat-log ag-log" ref={logRef} aria-live="polite">
          {!ready && (
            <div className="dk2-msg is-assistant is-error">
              서버에 Claude API 키가 없어 Agent 를 실행할 수 없어요. Vercel 환경 변수 <code>ANTHROPIC_API_KEY</code> 를 넣으면 켜져요.
            </div>
          )}
          {ready && loaded && !turns.length && <div className="dk2-msg is-assistant">회사 이름과 함께 말씀해 주시면 역할들이 나눠 판단해 공모 회사채 제안서 초안을 만들어요.</div>}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="dk2-msg is-user">{t.text}</div>
            ) : (
              <AssistantTurn key={i} t={t} live={busy && i === turns.length - 1} onFile={exportAs} fileBusy={fileBusy} canFile={!!slides.length} onBuilder={() => sendAnswer(t, i)} />
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
              placeholder={ready ? '예: 이랜드월드 제안서 초안 만들어줘' : 'API 키가 없어 실행할 수 없어요'}
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
              <div className="ag-views" role="tablist" aria-label="보기">
                <button type="button" role="tab" aria-selected={view === 'slides'} onClick={() => setView('slides')}>장표 <span>{slides.length}</span></button>
                <button type="button" role="tab" aria-selected={view === 'session'} onClick={() => setView('session')}>
                  작업 세션 <span>{session.log.length}</span>
                  {(stale.length > 0 || session.flags.length > 0) && <em aria-label="확인할 것 있음" />}
                </button>
              </div>
              <div className="ag-stage-actions">
                {view === 'slides' && <button type="button" className="ag-link" onClick={sendSlide} disabled={!slides[at]}>이 장표 피드백</button>}
                <button type="button" className="btn" disabled={!!fileBusy || !slides.length} onClick={() => exportAs('pptx')}>{fileBusy === 'pptx' ? '만드는 중…' : 'PPTX 받기'}</button>
                <button type="button" className="btn btn-ghost" disabled={!!fileBusy || !slides.length} onClick={() => exportAs('pdf')}>{fileBusy === 'pdf' ? '만드는 중…' : 'PDF'}</button>
                <button type="button" className="btn btn-ghost" onClick={openInStudio}>제안서 화면</button>
              </div>
            </div>
            {fileNote && <p className="ag-note is-error">{fileNote}</p>}
            {view === 'slides' ? (
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
            ) : (
              <SessionView s={session} name={fileBase(st.input)} />
            )}
          </>
        ) : (
          <div className="ag-empty">
            {dataErr ? <p>{dataErr}</p> : corp ? <p>데이터를 불러오는 중…</p> : <p>초안이 만들어지면 여기에 장표와 작업 세션이 보여요.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function AssistantTurn({ t, live, onFile, fileBusy, canFile, onBuilder }: {
  t: Extract<Turn, { role: 'assistant' }>; live: boolean; onFile: (k: 'pptx' | 'pdf') => void; fileBusy: string; canFile: boolean; onBuilder: () => void;
}) {
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
        if (p.k === 'tool') return <ToolRow key={p.id} p={p} />;
        return null;
      })}
      {live && <p className="ag-live">{tools ? '진행 중…' : '생각하는 중…'}</p>}
      {!live && t.done && (
        <p className="ag-meta">
          {tools > 0 && t.model ? `도구 ${tools}번 · ${t.model}` : ''}
          <button type="button" className="ag-link" onClick={onBuilder}>Builder로 보내기</button>
        </p>
      )}
    </div>
  );
}

// 작업 세션: 결정 기록(최근 것부터), 다시 써야 할 문안, 확인 필요, 검토 의견, 역할 메모
function SessionView({ s, name }: { s: Session; name: string }) {
  const stale = staleFields(s);
  const log = [...s.log].reverse();
  return (
    <div className="ag-sess">
      <h2 className="ag-h2">{name}</h2>
      {(stale.length > 0 || s.flags.length > 0) && (
        <section className="ag-sess-warn">
          {stale.length > 0 && <p>조건이 바뀌어 다시 써야 할 문안: {stale.map((f) => `${FIELD_LABEL[f]}(${ROLE_NAME[s.texts[f]!.role]})`).join(', ')}</p>}
          {s.flags.slice(-6).reverse().map((f, i) => (
            <p key={i}>{ROLE_NAME[f.role]} · {f.text}</p>
          ))}
        </section>
      )}
      {s.review && (
        <section>
          <h3>검토 의견</h3>
          <pre className="ag-sess-review">{s.review}</pre>
        </section>
      )}
      <section>
        <h3>결정 기록 <span>{s.log.length}</span></h3>
        {log.length ? (
          <ol className="ag-decisions">
            {log.map((d, i) => (
              <li key={`${d.at}-${i}`}>
                <div className="ag-dec-head">
                  <span className={`ag-role-chip is-${d.role}`}>{ROLE_NAME[d.role] ?? d.role}</span>
                  <strong>{d.what}</strong>
                  <time>{when(d.at)}</time>
                </div>
                {d.reason && <p>{d.reason}</p>}
                {d.rules.length > 0 && <div className="ag-tags">{d.rules.map((r) => <code key={r} className="ag-tag">{r}</code>)}</div>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="ag-muted">아직 결정이 없어요.</p>
        )}
      </section>
      <section>
        <h3>AI가 쓴 문안</h3>
        <ul className="ag-sess-texts">
          {(Object.keys(s.texts) as TextField[]).map((f) => (
            <li key={f}>
              {FIELD_LABEL[f]} <span className="ag-muted">· {ROLE_NAME[s.texts[f]!.role]}{s.texts[f]!.dropped ? ` · ${s.texts[f]!.dropped}줄 뺌` : ''}{s.texts[f]!.stale ? ' · 다시 써야 함' : ''}</span>
            </li>
          ))}
          {!Object.keys(s.texts).length && <li className="ag-muted">없음(규칙 문안)</li>}
        </ul>
      </section>
      {Object.keys(s.memos).length > 0 && (
        <section>
          <h3>역할 메모</h3>
          {Object.entries(s.memos).map(([k, v]) => (
            <details key={k} className="ag-sess-memo">
              <summary>{ROLE_NAME[k]} · {v?.length ?? 0}줄</summary>
              <ul>{v?.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

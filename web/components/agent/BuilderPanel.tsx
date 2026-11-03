'use client';

// Agent Builder: 피드백을 보내면 Builder(Master + 노하우 편집·프롬프트 편집·영향 점검)가 수정안을 만든다.
// 승인하면 그 자산의 새 판으로 바로 반영(이 브라우저). 도구·데이터 피드백은 개발 요청, 개인 선호는 기억으로.
import { useEffect, useRef, useState } from 'react';
import { applyEdit, assetDef, type AssetTexts, type DevRequest, type Msg, type Proposal } from '@/lib/agent/defs';
import type { BuilderEvent } from '@/lib/agent/builder';
import { BUILDER_KEY, memoryText, readLS, when, writeLS, type MemoryFile } from '@/lib/agent/store';
import { ToolRow, applyCommon, postStream, trimOld, type Part, type Turn } from './chat';
import { Diff } from './Diff';
import type { Handoff } from './RunPanel';

type Saved = { v: 1; turns: Turn[]; api: Msg[]; proposals: Proposal[]; seq: number };
const EXAMPLES = ['A급은 3년물 위주로 트랜치를 잡아줘', '검토 의견은 3개까지만 말해줘', '민평 데이터를 밴드 근거에 넣어줘', '나는 답을 짧게 받고 싶어'];

export function BuilderPanel({ ready, texts, versions, onApprove, memory, onMemory, dev, onDev, handoff, clearHandoff, onRerun }: {
  ready: boolean;
  texts: AssetTexts;
  versions: Record<string, number>;
  onApprove: (asset: string, text: string, note: string) => number; // 새 판 번호
  memory: MemoryFile[];
  onMemory: (line: string) => void;
  dev: DevRequest[];
  onDev: (f: (d: DevRequest[]) => DevRequest[]) => void;
  handoff: Handoff | null;
  clearHandoff: () => void;
  onRerun: (text: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [api, setApi] = useState<Msg[]>([]);
  const [props, setProps] = useState<Proposal[]>([]);
  const [seq, setSeq] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = readLS<Saved>(BUILDER_KEY);
    if (s?.v === 1) {
      setTurns(s.turns.map((t) => (t.role === 'assistant' ? { ...t, done: true } : t)));
      setApi(s.api);
      setProps(s.proposals);
      setSeq(s.seq);
    }
  }, []);
  const save = (t: Turn[], a: Msg[], p: Proposal[], n: number) => writeLS(BUILDER_KEY, { v: 1, turns: t.slice(-60), api: trimOld(a), proposals: p.slice(-80), seq: n } satisfies Saved);
  useEffect(() => {
    if (!handoff || busy || !turns.length) return;
    const left = turns.some((t) => t.role === 'assistant' && t.parts.some((p) => p.k === 'proposal' && props.find((x) => x.id === p.id)?.status === 'open'));
    if (!left) {
      setTurns([]);
      setApi([]);
      save([], [], props, seq);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);
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
    const ctx = handoff;
    const content = ctx ? `${q}\n\n[관련 맥락: ${ctx.label}]\n${ctx.detail}` : q;
    setDraft('');
    clearHandoff();
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let m: Msg[] = [...api, { role: 'user', content }];
    let pNow = props;
    let n = seq;
    const made: string[] = [];
    setTurns((ts) => [...ts, { role: 'user', text: q, ctx: ctx?.label }, { role: 'assistant', parts: [] }]);
    try {
      let done: Extract<BuilderEvent, { t: 'done' }> | null = null;
      await postStream<BuilderEvent>('/api/agent/builder', { messages: trimOld(m), assets: texts, memory: memoryText(memory), seq: n }, ac.signal, (e) => {
        switch (e.t) {
          case 'proposal':
            pNow = [...pNow, e.proposal];
            n = Math.max(n, Number(e.proposal.id.slice(1)) || n);
            setProps(pNow);
            setSeq(n);
            made.push(e.proposal.id);
            return;
          case 'impact':
            pNow = pNow.map((p) => (p.id === e.id ? { ...p, impact: e.text } : p));
            setProps(pNow);
            return;
          case 'dev':
            onDev((d) => [...d, e.item]);
            patchLast((p) => [...p, { k: 'note', text: `개발 요청에 남겼어요 · ${e.item.title}` }]);
            return;
          case 'memory':
            onMemory(e.text);
            patchLast((p) => [...p, { k: 'note', text: `개인 기억(제안서 Agent)에 남겼어요 · ${e.text}` }]);
            return;
          case 'done':
            done = e;
            return;
          default:
            patchLast((p) => applyCommon(p, e));
        }
      });
      const d = done as Extract<BuilderEvent, { t: 'done' }> | null;
      if (!d) throw new Error('응답이 중간에 끊겼어요.');
      m = d.messages;
      patchLast((p) => p, { model: d.model });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      patchLast((p) => [...p, { k: 'error', text: aborted ? '멈췄어요.' : (e as Error).message }]);
      if (m[m.length - 1]?.role === 'user' && typeof m[m.length - 1].content === 'string') m = m.slice(0, -1);
      if (!aborted) setDraft(q);
    } finally {
      abort.current = null;
      setBusy(false);
      setApi(m);
      // 승인(사람 확인)은 Agent 가 일을 다 마친 뒤 맨 아래에 보인다
      setTurns((ts) => {
        const done = ts.map((t, i) =>
          i === ts.length - 1 && t.role === 'assistant' ? { ...t, parts: [...t.parts, ...made.map((id) => ({ k: 'proposal' as const, id }))], done: true } : t,
        );
        save(done, m, pNow, n);
        return done;
      });
    }
  }

  function setStatus(id: string, status: Proposal['status']) {
    setProps((ps) => {
      const next = ps.map((p) => (p.id === id ? { ...p, status } : p));
      save(turns, api, next, seq);
      return next;
    });
  }
  function approve(p: Proposal) {
    try {
      const next = applyEdit(texts[p.edit.asset] ?? '', p.edit);
      const v = onApprove(p.edit.asset, next, `${p.id} · ${p.feedback.split('\n')[0].slice(0, 60)}`);
      setStatus(p.id, 'approved');
      setMsgs((x) => ({ ...x, [p.id]: `v${v}로 반영했어요. 다음 실행부터 써요.` }));
    } catch (e) {
      setMsgs((x) => ({ ...x, [p.id]: `지금 글과 맞지 않아 반영하지 못했어요: ${(e as Error).message}` }));
    }
  }
  function reset() {
    abort.current?.abort();
    setTurns([]);
    setApi([]);
    save([], [], props, seq);
  }

  const byId = new Map(props.map((p) => [p.id, p]));
  const inConv = turns.flatMap((t) => (t.role === 'assistant' ? t.parts.filter((p): p is Extract<Part, { k: 'proposal' }> => p.k === 'proposal').map((p) => p.id) : []));
  const openLeft = inConv.filter((id) => byId.get(id)?.status === 'open').length;
  const finished = turns.length > 0 && !busy;
  const openDev = dev.filter((d) => d.status === 'open');
  const applied = props.filter((p) => p.status === 'approved').slice(-8).reverse();

  return (
    <div className="ag-run ag-builder">
      <section className="ag-chat" aria-label="Agent Builder 대화">
        <div className="ag-chat-top">
          <span>Agent Builder · 편집 2 + 영향 점검</span>
          <button type="button" className="ag-link" onClick={reset} disabled={!turns.length || busy || openLeft > 0}>새 대화</button>
        </div>
        <div className="dk2-chat-log ag-log" ref={logRef} aria-live="polite">
          {!ready && <div className="dk2-msg is-assistant is-error">서버에 Claude API 키가 없어 Builder 를 실행할 수 없어요.</div>}
          {ready && !turns.length && <div className="dk2-msg is-assistant">제안서 Agent 결과에 대한 피드백을 주시면, 노하우·프롬프트 중 고칠 곳을 찾아 수정안을 보여 드려요.</div>}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="dk2-msg is-user">
                {t.ctx && <span className="ag-ctx-chip">{t.ctx}</span>}
                {t.text}
              </div>
            ) : (
              <div key={i} className="ag-turn">
                {t.parts.map((p, j) => {
                  if (p.k === 'text') return <div key={j} className="dk2-msg is-assistant ag-text">{p.text}</div>;
                  if (p.k === 'error') return <div key={j} className="dk2-msg is-assistant is-error">{p.text}</div>;
                  if (p.k === 'note') return <p key={j} className="ag-note-line">{p.text}</p>;
                  if (p.k === 'tool') return <ToolRow key={p.id} p={p} />;
                  if (p.k === 'proposal') {
                    const pr = byId.get(p.id);
                    return pr ? <ProposalCard key={j} p={pr} cur={versions[pr.edit.asset]} msg={msgs[pr.id]} onApprove={() => approve(pr)} onDrop={() => setStatus(pr.id, 'dropped')} onRerun={onRerun} /> : null;
                  }
                  return null;
                })}
              </div>
            ),
          )}
        </div>
        <div className="dk2-chat-foot">
          {finished ? (
            <div className="ag-newconv">
              <button type="button" className="btn" onClick={reset} disabled={openLeft > 0}>새 대화로</button>
              {openLeft > 0 && <span className="ag-muted">승인 대기 {openLeft}</span>}
            </div>
          ) : busy ? (
            <div className="ag-newconv">
              <span className="ag-live">진행 중…</span>
              <button type="button" className="btn btn-ghost ag-stop-btn" onClick={() => abort.current?.abort()}>멈춤</button>
            </div>
          ) : (
            <>
              <ul className="dk2-chips">
                {EXAMPLES.map((c) => (
                  <li key={c}>
                    <button type="button" disabled={!ready} onClick={() => send(c)}>{c}</button>
                  </li>
                ))}
              </ul>
              {handoff && (
                <div className="ag-handoff">
                  <span className="ag-ctx-chip">{handoff.label}</span>
                  <span className="ag-muted">함께 보내요</span>
                  <button type="button" className="ag-link" onClick={clearHandoff}>빼기</button>
                  <details>
                    <summary>내용</summary>
                    <pre>{handoff.detail}</pre>
                  </details>
                </div>
              )}
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
                  placeholder="예: A급은 3년물 위주로 잡아줘"
                  disabled={!ready}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(draft);
                    }
                  }}
                  aria-label="Builder 에게 보낼 피드백"
                />
                <button type="submit" disabled={!draft.trim() || !ready}>보내기</button>
              </form>
            </>
          )}
        </div>
      </section>

      <section className="ag-stage ag-builder-side" aria-label="반영과 개발 요청">
        <div className="ag-side-body">
          <h2 className="ag-h2">최근 반영 <span className="ag-muted">{applied.length}</span></h2>
          {applied.length ? (
            <ul className="ag-applied">
              {applied.map((p) => (
                <li key={p.id}>
                  <strong>{p.target}</strong>
                  <span className="ag-muted">{when(p.at)} · {p.feedback.split('\n')[0].slice(0, 50)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ag-muted">없음</p>
          )}
          <h2 className="ag-h2">개발 요청 <span className="ag-muted">{openDev.length}</span></h2>
          {dev.length ? (
            <ul className="ag-dev">
              {[...dev].reverse().map((d) => (
                <li key={d.id} className={d.status === 'done' ? 'is-done' : ''}>
                  <label>
                    <input type="checkbox" checked={d.status === 'done'} onChange={(e) => onDev((xs) => xs.map((x) => (x.id === d.id ? { ...x, status: e.target.checked ? 'done' : 'open' } : x)))} />
                    <strong>{d.title}</strong>
                  </label>
                  <p>{d.detail}</p>
                  <span className="ag-muted">{when(d.at)} · {d.feedback.split('\n')[0].slice(0, 60)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ag-muted">없음</p>
          )}
        </div>
      </section>
    </div>
  );
}

function ProposalCard({ p, cur, msg, onApprove, onDrop, onRerun }: { p: Proposal; cur: number | undefined; msg: string | undefined; onApprove: () => void; onDrop: () => void; onRerun: (t: string) => void }) {
  const def = assetDef(p.edit.asset);
  const op = p.edit.kind === 'prompt' ? '부분 고침' : p.edit.op === 'add' ? '항목 추가' : p.edit.op === 'delete' ? '항목 삭제' : '항목 고침';
  return (
    <div className={`ag-prop is-${p.status}`}>
      <div className="ag-prop-head">
        <span className="ag-prop-id">{p.id}</span>
        <strong>{p.target}</strong>
        <span className="ag-muted">{op}{cur ? ` · 지금 v${cur}` : ''}</span>
      </div>
      {p.reason && <p className="ag-prop-why">{p.reason}</p>}
      <Diff before={p.before} after={p.after} ctx={3} label="바뀌는 내용" />
      {p.impact ? (
        <details className="ag-prop-impact" open>
          <summary>영향 점검</summary>
          <pre>{p.impact}</pre>
        </details>
      ) : (
        <p className="ag-muted">영향 점검 전</p>
      )}
      <div className="ag-prop-foot">
        {p.status === 'open' && (
          <>
            <button type="button" className="btn" onClick={onApprove}>승인</button>
            <button type="button" className="btn btn-ghost" onClick={onDrop}>버리기</button>
          </>
        )}
        {p.status === 'approved' && (
          <>
            <span className="ag-ok">반영됨</span>
            <button type="button" className="ag-link" onClick={() => onRerun(`노하우·프롬프트가 바뀌었어요(${def?.title ?? p.edit.asset} · ${p.target}). 지금 초안에서 영향받는 역할을 다시 돌려 반영해 주세요.`)}>제안서 Agent로 다시 실행</button>
          </>
        )}
        {p.status === 'dropped' && <span className="ag-muted">버림</span>}
        {msg && <span className={/못했/.test(msg) ? 'ag-err' : 'ag-muted'}>{msg}</span>}
      </div>
    </div>
  );
}

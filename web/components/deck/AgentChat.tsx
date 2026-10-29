'use client';

// 제안서 Agent 채팅 패널: 요청 → /api/deck/agent(의도 해석) → apply(코드로 반영) → 답 + 바뀐 것
// 접으면 얇은 띠만 남고(장표가 넓어짐), 대화와 쓰던 글은 그대로 둔다.
import { useEffect, useRef, useState } from 'react';
import type { AgentAction } from '@/lib/deck/agent';

export type ChatMsg = { role: 'user' | 'assistant'; text: string; changes?: string[]; notes?: string[]; error?: boolean };

export function AgentChat({ enabled, open, onToggle, greeting, suggestions, state, apply }: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
  greeting: string;
  suggestions: string[];
  state: () => unknown;
  apply: (actions: AgentAction[]) => Promise<{ changes: string[]; notes: string[] }>;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy, open]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || !enabled) return;
    const history = msgs.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role, content: m.text }));
    setMsgs((xs) => [...xs, { role: 'user', text: message }]);
    setQ('');
    setBusy(true);
    try {
      const r = await fetch('/api/deck/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, state: state() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '답을 받지 못했어요.');
      const { changes, notes } = await apply((j.actions ?? []) as AgentAction[]);
      setMsgs((xs) => [...xs, { role: 'assistant', text: j.reply || (changes.length ? '바꿨어요.' : '말씀하신 내용을 이해하지 못했어요.'), changes, notes }]);
    } catch (e) {
      setMsgs((xs) => [...xs, { role: 'assistant', text: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <aside className={`dk2-chat${open ? '' : ' is-closed'}`} aria-label="제안서 Agent">
      {open ? (
        <header className="dk2-chat-head">
          <h2>제안서 Agent</h2>
          <button type="button" className="dk2-chat-x" aria-expanded aria-controls="dk2-chat-body" title="Agent 접기" onClick={onToggle}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
              <path d="M4 3.5l4.5 4.5L4 12.5M8.5 3.5L13 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="sr-only">Agent 접기</span>
          </button>
        </header>
      ) : (
        <button type="button" className="dk2-chat-rail" aria-expanded={false} aria-controls="dk2-chat-body" onClick={onToggle}>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
            <path d="M12 3.5L7.5 8l4.5 4.5M7.5 3.5L3 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Agent</span>
          {busy && <i className="dk2-chat-dot" aria-label="답을 쓰는 중" />}
        </button>
      )}
      <div id="dk2-chat-body" className="dk2-chat-body" hidden={!open}>
        <div className="dk2-chat-log" aria-live="polite">
          <div className="dk2-msg is-assistant">
            <p>{greeting}</p>
          </div>
          {msgs.map((m, i) => (
            <div key={i} className={`dk2-msg is-${m.role}${m.error ? ' is-error' : ''}`}>
              <p>{m.text}</p>
              {!!m.changes?.length && (
                <ul className="dk2-changes" aria-label="바뀐 것">
                  {m.changes.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
              {!!m.notes?.length && m.notes.map((n) => <p key={n} className="dk2-note">{n}</p>)}
            </div>
          ))}
          {busy && (
            <div className="dk2-msg is-assistant is-busy">
              <p>초안을 보고 있어요…</p>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="dk2-chat-foot">
          <ul className="dk2-chips" aria-label="추천 요청">
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => send(s)} disabled={busy || !enabled}>{s}</button>
              </li>
            ))}
          </ul>
          <form
            className="dk2-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(q);
            }}
          >
            <label htmlFor="dk2-q" className="sr-only">요청</label>
            <textarea
              id="dk2-q"
              ref={inputRef}
              rows={2}
              maxLength={600}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(q);
                }
              }}
              placeholder={enabled ? '예) 3년 단일 1,500억으로 바꿔줘' : 'AI 키를 등록하면 쓸 수 있어요'}
              disabled={!enabled}
            />
            <button type="submit" disabled={!enabled || busy || !q.trim()}>보내기</button>
          </form>
        </div>
      </div>
    </aside>
  );
}

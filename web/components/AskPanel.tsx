'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

type Ref = { label: string; href: string };
type Turn = { q: string; steps: string[]; answer?: string; refs?: Ref[]; error?: string; pending: boolean };

const EXAMPLES = [
  '최근 한 달 A급 회사채 중 증액이 컸던 발행은?',
  '3~6개월 뒤 공모채 만기가 큰 AA급 회사 중 NH 대표주관 이력이 없는 곳은?',
  '이랜드월드 최근 조달 내역 정리해 줘',
  '올해 회사채 대표주관 순위 상위 5곳은?',
  '최근 2주 합병·분할·지분 인수 공시 요약',
  '최근 6개월 2년+3년 구조 회사채의 경쟁률과 증액 비중은?',
];

// 굵게(**…**)만 처리
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const m = line.match(/^[-*•]\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <div className="ai-answer">{blocks}</div>;
}

export function AskPanel({ enabled, examples = EXAMPLES }: { enabled: boolean; examples?: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const busy = turns.some((t) => t.pending);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  function update(i: number, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) {
    setTurns((ts) => ts.map((t, j) => (j === i ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)));
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || !enabled) return;
    const history = turns.filter((t) => t.answer).slice(-3).map((t) => ({ q: t.q, a: t.answer! }));
    const idx = turns.length;
    setTurns((ts) => [...ts, { q: text, steps: [], pending: true }]);
    setQ('');
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, history }),
      });
      if (!res.body) throw new Error('응답이 없습니다');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let done = false;
      while (!done) {
        const r = await reader.read();
        done = r.done;
        buf += dec.decode(r.value ?? new Uint8Array(), { stream: !done });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l);
          if (ev.type === 'step') update(idx, (t) => ({ steps: t.steps.includes(ev.label) ? t.steps : [...t.steps, ev.label] }));
          else if (ev.type === 'answer') update(idx, { answer: ev.text, refs: ev.refs, pending: false });
          else if (ev.type === 'error') update(idx, { error: ev.message, pending: false });
        }
      }
      update(idx, (t) => (t.pending ? { pending: false, error: t.answer ? undefined : '답을 받지 못했습니다. 다시 물어 보세요.' } : {}));
    } catch (e) {
      update(idx, { pending: false, error: `연결이 끊겼습니다. ${(e as Error).message}` });
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <div className="ai">
      {turns.length === 0 && (
        <div className="ai-start">
          <p className="ai-lede">수집한 공시·발행·금리 데이터를 조회해서 답합니다.</p>
          <ul className="ai-examples" aria-label="예시 질문">
            {examples.map((e) => (
              <li key={e}>
                <button type="button" onClick={() => ask(e)} disabled={!enabled}>{e}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="ai-log" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className="ai-turn">
            <p className="ai-q">{t.q}</p>
            {t.steps.length > 0 && (
              <p className="ai-steps">
                {t.steps.map((s, j) => (
                  <span key={s} className={t.pending && j === t.steps.length - 1 ? 'is-now' : undefined}>{s}</span>
                ))}
              </p>
            )}
            {t.pending && t.steps.length === 0 && <p className="ai-steps"><span className="is-now">질문 읽는 중</span></p>}
            {t.answer && <Answer text={t.answer} />}
            {t.error && <p className="ai-error">{t.error}</p>}
            {t.refs && t.refs.length > 0 && (
              <p className="ai-refs">
                <span>근거</span>
                {t.refs.map((r) =>
                  r.href.startsWith('/') ? (
                    <Link key={r.href} href={r.href}>{r.label}</Link>
                  ) : (
                    <a key={r.href} href={r.href} target="_blank" rel="noreferrer">{r.label}</a>
                  ),
                )}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      <form
        className="ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <label htmlFor="ai-q" className="sr-only">질문</label>
        <textarea
          id="ai-q"
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(q);
            }
          }}
          rows={2}
          maxLength={400}
          placeholder={enabled ? '예) 최근 3개월 BBB급 공모채 발행과 경쟁률' : 'AI 키를 등록하면 질문할 수 있습니다'}
          disabled={!enabled}
        />
        <button type="submit" disabled={!enabled || busy || !q.trim()}>{busy ? '찾는 중' : '묻기'}</button>
      </form>
      {!enabled && <p className="ai-off">Vercel 환경변수에 OPENAI_API_KEY 를 등록하면 켜집니다.</p>}
    </div>
  );
}

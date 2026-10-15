'use client';

import { useEffect, useId, useRef, useState } from 'react';

// 오른쪽 아래 '의견 보내기': 현업 피드백을 받아 /api/feedback 으로 보낸다.
// 함께 저장: 지금 화면 주소, 화면 크기, 브라우저별 임의 ID(사람 식별 아님). 이름·부서는 선택.
type Kind = 'good' | 'improve' | 'bug' | 'data';
const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: 'improve', label: '개선 의견', hint: '어느 화면에서 무엇이 불편했고, 어떻게 바뀌면 좋을지 적어 주세요.' },
  { key: 'data', label: '필요한 데이터·기능', hint: '제안서나 영업에 필요한데 여기 없는 데이터·기능을 적어 주세요.' },
  { key: 'bug', label: '오류', hint: '어느 화면의 어떤 값이 틀렸는지 적어 주세요. 회사 이름이나 공시 날짜가 있으면 함께 적어 주세요.' },
  { key: 'good', label: '좋은 점', hint: '업무에 쓸모 있었던 화면이나 기능을 적어 주세요.' },
];
const CLIENT_KEY = 'dcm.client.v1';
const AUTHOR_KEY = 'dcm.fb.author';

type State = 'idle' | 'sending' | 'sent' | 'error' | 'limit';

function load(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 무시 */
  }
}
function clientId() {
  let id = load(CLIENT_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    save(CLIENT_KEY, id);
  }
  return id;
}

export function Feedback() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('improve');
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('');
  const [state, setState] = useState<State>('idle');
  const fabRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => setAuthor(load(AUTHOR_KEY)), []);

  useEffect(() => {
    if (open) textRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  function close() {
    setOpen(false);
    if (state === 'sent') {
      setState('idle');
      setBody('');
    }
    fabRef.current?.focus();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'sending' || body.trim().length < 2) return;
    setState('sending');
    const form = new FormData(e.currentTarget);
    save(AUTHOR_KEY, author.trim());
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          body,
          author,
          page: `${location.pathname}${location.search}`,
          clientId: clientId(),
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          website: form.get('website') ?? '',
        }),
      });
      setState(res.ok ? 'sent' : res.status === 429 ? 'limit' : 'error');
    } catch {
      setState('error');
    }
  }

  const hint = KINDS.find((k) => k.key === kind)!.hint;

  return (
    <div className="fb">
      {open && (
        <section className="fb-panel" id={panelId} role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <div className="fb-head">
            <h2 id={titleId}>의견 보내기</h2>
            <button type="button" className="fb-x" onClick={close} aria-label="닫기">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {state === 'sent' ? (
            <div className="fb-done" role="status">
              <p className="fb-done-h">의견을 보냈습니다. 고맙습니다.</p>
              <p>보내 주신 내용은 다음 개선에 반영 여부를 검토합니다.</p>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setBody('');
                  setState('idle');
                  setTimeout(() => textRef.current?.focus(), 0);
                }}
              >
                하나 더 보내기
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="fb-form">
              <fieldset className="fb-kinds">
                <legend className="sr-only">의견 종류</legend>
                {KINDS.map((k) => (
                  <label key={k.key} className={kind === k.key ? 'is-on' : undefined}>
                    <input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} />
                    {k.label}
                  </label>
                ))}
              </fieldset>

              <label className="sr-only" htmlFor={`${panelId}-body`}>내용</label>
              <textarea
                ref={textRef}
                id={`${panelId}-body`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={hint}
                rows={5}
                maxLength={2000}
                required
              />

              <label className="fb-author">
                <span>이름·부서 (선택)</span>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  maxLength={60}
                  placeholder="예: 인더스트리1부 홍길동"
                  autoComplete="off"
                />
              </label>

              {/* 자동 입력 방지: 사람에게는 보이지 않는 칸 */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" className="fb-trap" aria-hidden />

              <p className="fb-note">지금 보고 있는 화면 주소가 함께 저장됩니다. 내부 자료·고객 정보는 적지 마세요.</p>

              {state === 'error' && <p className="fb-err" role="alert">보내지 못했습니다. 잠시 후 다시 보내 주세요.</p>}
              {state === 'limit' && <p className="fb-err" role="alert">짧은 시간에 여러 번 보냈습니다. 1분 뒤 다시 보내 주세요.</p>}

              <div className="fb-actions">
                <span className="fb-count tnum" aria-live="polite">{body.length > 1800 ? `${body.length}/2000` : ''}</span>
                <button type="submit" className="btn" disabled={state === 'sending' || body.trim().length < 2}>
                  {state === 'sending' ? '보내는 중' : '보내기'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      <button
        ref={fabRef}
        type="button"
        className={`fb-fab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <path
            d="M3.5 4.5h13v8.5h-7l-3.5 3v-3h-2.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        의견 보내기
      </button>
    </div>
  );
}

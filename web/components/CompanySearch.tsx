'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

type Hit = { corp_code: string; corp_name: string; market: string | null; deal_count: number; last_deal_dt: string | null };

// 회사 검색: 글자를 넣으면 회사 후보를 바로 보여 준다.
// mode 'company'(머리글): 고른 회사 화면으로, 고른 게 없으면 검색 화면으로. '/' 키로 열기.
// mode 'proposal'(제안서 초안): 고른 회사의 초안 화면으로. 'deck': 제안서 만들기 화면으로.
export function CompanySearch({ mode = 'company', placeholder = '회사 이름으로 찾기' }: { mode?: 'company' | 'proposal' | 'deck'; placeholder?: string }) {
  const isHeader = mode === 'company';
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = isHeader ? 'cs-input' : 'cs-input-proposal';
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const body = res.ok ? ((await res.json()) as Hit[]) : [];
        setHits(body);
        setActive(-1);
        setOpen(true);
      } catch {
        /* 입력이 바뀌어 취소된 요청 */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // '/' 키로 검색창 열기 (머리글만)
  useEffect(() => {
    if (!isHeader) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isHeader]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function go(h: Hit) {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    router.push(isHeader ? `/company/${h.corp_code}` : mode === 'deck' ? `/proposal/deck?corp=${h.corp_code}` : `/proposal?corp=${h.corp_code}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' && open && active >= 0 && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }

  const showList = open && q.trim().length > 0;

  return (
    <div className={`cs${isHeader ? '' : ' cs-wide'}`} ref={boxRef}>
      <form
        action="/search"
        method="get"
        role="search"
        className="cs-form"
        onSubmit={(e) => {
          setOpen(false);
          if (!isHeader) {
            e.preventDefault();
            if (hits[0]) go(hits[Math.max(0, active)]);
          }
        }}
      >
        <label htmlFor={inputId} className="sr-only">{placeholder}</label>
        <svg className="cs-icon" viewBox="0 0 20 20" aria-hidden width="16" height="16">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          required
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        />
        {isHeader && <kbd className="cs-kbd" aria-hidden>/</kbd>}
      </form>
      {showList && (
        <ul className="cs-list" id={listId} role="listbox" aria-label="회사 후보">
          {hits.length === 0 ? (
            <li className="cs-empty" role="presentation">{loading ? '찾는 중' : `‘${q.trim()}’에 맞는 회사가 없습니다`}</li>
          ) : (
            hits.map((h, i) => (
              <li
                key={h.corp_code}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="cs-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="cs-name">{h.corp_name}</span>
                <span className="cs-meta">
                  {h.market && h.market !== '기타' ? h.market : '비상장'}
                  {h.deal_count > 0 ? <span className="tnum"> 발행 {h.deal_count}건</span> : null}
                </span>
              </li>
            ))
          )}
          {hits.length > 0 && isHeader && (
            <li role="presentation" className="cs-all">
              <a href={`/search?q=${encodeURIComponent(q.trim())}`}>‘{q.trim()}’ 검색 결과 모두 보기</a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

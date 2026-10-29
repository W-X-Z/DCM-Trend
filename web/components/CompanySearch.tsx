'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

type Hit = { corp_code: string; corp_name: string; market: string | null; deal_count: number; last_deal_dt: string | null };

// 회사 검색: 글자를 넣으면 회사 후보를 바로 보여 준다.
// mode 'company'(머리글): 고른 회사 화면으로, 고른 게 없으면 검색 화면으로. '/' 키로 열기.
// mode 'proposal'(제안서 초안): 고른 회사의 초안으로(공모 회사채 발행사는 제안서 초안 화면, 메자닌은 점검 화면). 'deck': 제안서 초안 화면으로.
export function CompanySearch({ mode = 'company', placeholder = '회사 이름으로 찾기' }: { mode?: 'company' | 'proposal' | 'deck'; placeholder?: string }) {
  const isHeader = mode === 'company';
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  // 불러오기 실패(시간 초과·서버 오류)는 '없음'과 구분하고 다시 시도 버튼을 보인다
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const cache = useRef(new Map<string, Hit[]>());
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = isHeader ? 'cs-input' : 'cs-input-proposal';
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    // 글자를 넣자마자 목록을 열어 '찾는 중'을 보인다 (첫 조회가 느릴 때 빈 화면 방지)
    setOpen(true);
    setFailed(false);
    const hit = cache.current.get(term);
    if (hit) {
      setHits(hit);
      setActive(-1);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timedOut = false;
    const ctrl = new AbortController();
    setLoading(true);
    setHits([]);
    const t = setTimeout(async () => {
      const limit = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, 8000);
      try {
        const res = await fetch(`/api/companies?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Hit[];
        if (cancelled) return;
        if (body.length) cache.current.set(term, body);
        setHits(body);
        setActive(-1);
      } catch {
        // 입력이 바뀌어 취소된 요청은 무시, 시간 초과·오류만 실패로
        if (!cancelled || timedOut) setFailed(true);
      } finally {
        clearTimeout(limit);
        if (!cancelled) setLoading(false);
      }
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, nonce]);

  const retry = () => {
    cache.current.delete(q.trim());
    setNonce((n) => n + 1);
    inputRef.current?.focus();
  };

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
    if (isHeader) router.push(`/company/${h.corp_code}`);
    // 제안서 작성은 새 탭(사이트 머리글 없는 작업 화면)으로 연다
    else window.open(mode === 'deck' ? `/proposal/deck?corp=${h.corp_code}` : `/proposal?corp=${h.corp_code}`, '_blank', 'noopener');
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
            <li className="cs-empty" role="presentation">
              <span>{loading ? '찾는 중…' : failed ? '회사 목록을 불러오지 못했어요' : `‘${q.trim()}’에 맞는 회사가 없어요`}</span>
              {!loading && (
                <button type="button" className="cs-retry" onMouseDown={(e) => e.preventDefault()} onClick={retry}>
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
                    <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1M13.5 2.5V5.5H10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {failed ? '다시 시도' : '다시 찾기'}
                </button>
              )}
            </li>
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

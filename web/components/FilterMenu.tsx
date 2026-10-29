'use client';

// 필터 드롭다운: 버튼에는 고른 값(고르지 않았으면 필터 이름), 펼치면 항목과 건수. 고르면 주소(?p=·g=·mk=·nh=)를 바꾼다.
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

export type FilterOpt = { key: string; label: string; count: number; href: string; on: boolean };

export function FilterMenu({ name, value, active, options }: { name: string; value: string; active: boolean; options: FilterOpt[] }) {
  const [open, setOpen] = useState(false);
  // 버튼이 화면 왼쪽 절반에 있으면 목록을 왼쪽 끝에 맞춘다 (줄바꿈된 모바일 버튼이 화면 밖으로 나가지 않게)
  const [left, setLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[aria-current="true"], a')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="fm" ref={ref}>
      <button
        ref={btn}
        type="button"
        className={`fm-btn${active ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${name}: ${value}`}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (r) setLeft(r.left + r.width / 2 < window.innerWidth / 2);
          setOpen((v) => !v);
        }}
      >
        {value}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className={`fm-menu${left ? ' is-left' : ''}`} id={id} aria-label={name}>
          {options.map((o) => (
            <li key={o.key}>
              <Link href={o.href} scroll={false} aria-current={o.on ? 'true' : undefined} onClick={() => setOpen(false)}>
                <span>{o.label}</span>
                <span className="tnum">{o.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

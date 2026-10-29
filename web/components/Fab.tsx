'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AskPanel } from './AskPanel';
import { CompanySearch } from './CompanySearch';

// 화면 아래 플로팅 버튼: 제안서 작성 · AI 질문.
// 위계: 1depth 탭(모니터링) → 플로팅 버튼(행동) → 오른쪽 패널(2depth).
//  - AI 질문: 지금 화면 위에 패널로 열고, 탭을 옮겨도 대화가 남는다. 길게 볼 때만 /ai 전체 화면.
//  - 제안서 작성: 지금 탭의 회사 목록에서 고르면 초안 화면을 새 탭(사이트 머리글 없는 작업 공간)으로 연다.

export type FabCo = { c: string; n: string; sub?: string; href?: string };
export type FabCtx = { label: string; companies?: FabCo[]; corp?: FabCo };

// 화면(서버 컴포넌트)이 <FabContext> 로 '지금 보고 있는 회사들'을 알려 준다
let current: FabCtx | null = null;
const subs = new Set<() => void>();
const setCtx = (c: FabCtx | null) => {
  current = c;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function FabContext(props: FabCtx) {
  const key = JSON.stringify(props);
  useEffect(() => {
    setCtx(JSON.parse(key) as FabCtx);
    return () => setCtx(null);
  }, [key]);
  return null;
}

const EXAMPLES: { match: (p: string) => boolean; list: string[] }[] = [
  {
    match: (p) => p === '/',
    list: [
      '3~6개월 뒤 공모채 만기가 큰 AA급 회사 중 NH 대표주관 이력이 없는 곳은?',
      '다음 달 공모채 만기가 돌아오는 회사와 당시 대표주관은?',
      '올해 회사채 대표주관 순위 상위 5곳은?',
    ],
  },
  {
    match: (p) => p.startsWith('/maturities'),
    list: [
      '3~6개월 뒤 공모채 만기 상위 10곳과 당시 대표주관은?',
      '6개월 안에 조기상환청구가 시작되는 메자닌 중 금액이 큰 곳은?',
      '1년 안 만기 CP·전단채 잔액이 큰 회사는?',
    ],
  },
  {
    match: (p) => p.startsWith('/trends'),
    list: [
      '최근 한 달 A급 회사채 중 증액이 컸던 발행은?',
      '최근 6개월 2년+3년 구조 회사채의 경쟁률과 증액 비중은?',
      '올해 회사채 대표주관 순위 상위 5곳은?',
    ],
  },
  {
    match: (p) => p.startsWith('/filings'),
    list: [
      '최근 2주 합병·분할·지분 인수 공시 요약',
      '최근 한 달 단기차입금 증가 공시 중 금액이 큰 곳은?',
      '최근 3개월 신규 시설투자 결정 중 회사채 발행사는?',
    ],
  },
  {
    match: (p) => p.startsWith('/rates'),
    list: ['최근 한 달 국고채 3년과 회사채 AA- 3년 금리 변화는?', '다음 금통위 일정과 최근 기준금리 결정은?'],
  },
];

function examplesFor(path: string, ctx: FabCtx | null) {
  if (ctx?.corp) {
    const n = ctx.corp.n;
    return [`${n} 최근 조달 내역 정리해 줘`, `${n} 공모채 만기와 당시 대표주관은?`, `${n} 최근 주요 공시 요약`];
  }
  return EXAMPLES.find((e) => e.match(path))?.list;
}

// 제안서 작성은 새 탭(사이트 머리글 없는 작업 화면)으로 연다
const deckHref = (co: FabCo) => co.href ?? `/proposal/deck?corp=${co.c}`;

export function Fab({ aiEnabled }: { aiEnabled: boolean }) {
  const path = usePathname() ?? '/';
  const ctx = useSyncExternalStore(subscribe, () => current, () => null);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<'deck' | 'ai' | null>(null);
  const [aiMounted, setAiMounted] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const hidden = path.startsWith('/proposal') || path.startsWith('/ai');

  // 화면을 옮기면 메뉴와 제안서 패널은 닫는다 (AI 패널은 유지)
  useEffect(() => {
    setMenu(false);
    setPanel((p) => (p === 'deck' ? null : p));
  }, [path]);

  useEffect(() => {
    if (!menu && !panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (panel) setPanel(null);
      else setMenu(false);
      fabRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, panel]);

  useEffect(() => {
    if (panel) panelRef.current?.querySelector<HTMLElement>('input, textarea, a, button')?.focus();
  }, [panel]);

  if (hidden) return null;

  const open = (p: 'deck' | 'ai') => {
    setMenu(false);
    setPanel(p);
    if (p === 'ai') setAiMounted(true);
  };
  const cos = ctx?.companies ?? [];

  return (
    <>
      <div className={`fab${panel ? ' has-panel' : ''}`}>
        {menu && (
          <ul className="fab-menu" id="fab-menu">
            <li>
              {ctx?.corp ? (
                <Link href={deckHref(ctx.corp)} target="_blank" rel="noopener" className="fab-item" onClick={() => setMenu(false)}>
                  <strong>제안서 작성</strong>
                  <span>{ctx.corp.n}</span>
                </Link>
              ) : (
                <button type="button" className="fab-item" onClick={() => open('deck')}>
                  <strong>제안서 작성</strong>
                  <span>{ctx?.label ? `${ctx.label}에서 고르기` : '회사 고르기'}</span>
                </button>
              )}
            </li>
            <li>
              <button type="button" className="fab-item" onClick={() => open('ai')}>
                <strong>AI 질문</strong>
                <span>공시·발행·금리 데이터로 답하기</span>
              </button>
            </li>
          </ul>
        )}
        <button
          ref={fabRef}
          type="button"
          className={`fab-btn${menu ? ' is-open' : ''}`}
          aria-expanded={menu}
          aria-controls="fab-menu"
          onClick={() => setMenu((v) => !v)}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
            {menu ? (
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M10 2.5l1.9 4.6 4.6 1.9-4.6 1.9L10 15.5l-1.9-4.6L3.5 9l4.6-1.9z" fill="currentColor" />
            )}
          </svg>
          제안서 · AI
        </button>
      </div>

      {panel === 'deck' && (
        <aside ref={panelRef} className="fab-panel" aria-labelledby="fab-deck-h">
          <header className="fab-panel-head">
            <h2 id="fab-deck-h">제안서 작성</h2>
            <button type="button" className="fab-x" aria-label="닫기" onClick={() => setPanel(null)}>×</button>
          </header>
          <div className="fab-panel-body">
            <CompanySearch mode="deck" placeholder="회사 이름으로 찾기" />
            {cos.length > 0 && (
              <section className="fab-cos" aria-labelledby="fab-cos-h">
                <h3 id="fab-cos-h" className="sub-h">{ctx?.label}</h3>
                <ul>
                  {cos.map((co) => (
                    <li key={co.c}>
                      <Link href={deckHref(co)} target="_blank" rel="noopener" onClick={() => setPanel(null)}>
                        <strong>{co.n}</strong>
                        {co.sub && <span>{co.sub}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="fab-more small">
              <Link href="/proposal">만기도래 회사 전체에서 고르기</Link>
            </p>
          </div>
        </aside>
      )}

      {aiMounted && (
        <aside ref={panel === 'ai' ? panelRef : undefined} className="fab-panel is-ai" aria-labelledby="fab-ai-h" hidden={panel !== 'ai'}>
          <header className="fab-panel-head">
            <h2 id="fab-ai-h">AI 질문</h2>
            <Link href="/ai" className="small">전체 화면</Link>
            <button type="button" className="fab-x" aria-label="닫기" onClick={() => setPanel(null)}>×</button>
          </header>
          <div className="fab-panel-body">
            <AskPanel enabled={aiEnabled} examples={examplesFor(path, ctx)} />
          </div>
        </aside>
      )}
    </>
  );
}

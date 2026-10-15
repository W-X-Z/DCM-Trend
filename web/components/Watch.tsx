'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

// 관심 회사: 이 브라우저에만 저장한다 (서버로 목록을 보내 저장하지 않음)
type Item = { c: string; n: string };
type Ev = {
  when: 'recent' | 'upcoming'; dt: string; corp_code: string; corp_name: string;
  kind: string; title: string; detail: string | null; href: string; tone: 'alert' | null;
};

const KEY = 'dcm.watch.v1';
const MAX = 150;

function read(): Item[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && /^[0-9A-Za-z_]{1,20}$/.test(x.c)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(items: Item[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
    window.dispatchEvent(new Event('dcm-watch'));
  } catch {
    /* 저장 못 하는 브라우저(사생활 보호 모드 등)는 이번 화면에서만 유지 */
  }
}

function useWatch() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    const sync = () => setItems(read());
    sync();
    window.addEventListener('dcm-watch', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('dcm-watch', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const save = useCallback((next: Item[]) => {
    setItems(next);
    write(next);
  }, []);
  return [items, save] as const;
}

export function WatchButton({ corp, name }: { corp: string; name: string }) {
  const [items, save] = useWatch();
  if (items === null) return <span className="watch-btn is-loading" aria-hidden />;
  const on = items.some((i) => i.c === corp);
  return (
    <button
      type="button"
      className={`watch-btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={() => save(on ? items.filter((i) => i.c !== corp) : [{ c: corp, n: name }, ...items])}
    >
      <span aria-hidden>{on ? '★' : '☆'}</span> 관심 회사
    </button>
  );
}

const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;

const SHOW = 8;

function EventList({ rows, empty }: { rows: Ev[]; empty: string }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <>
      <Events rows={rows.slice(0, SHOW)} />
      {rows.length > SHOW && (
        <details className="disc-more">
          <summary>{rows.length - SHOW}건 더 보기</summary>
          <Events rows={rows.slice(SHOW, 60)} />
        </details>
      )}
    </>
  );
}

function Events({ rows }: { rows: Ev[] }) {
  return (
    <ul className="watch-events">
      {rows.map((e, i) => (
        <li key={`${e.corp_code}-${e.dt}-${e.title}-${i}`} className={e.tone === 'alert' ? 'is-alert' : undefined}>
          <span className="tnum we-dt">{md(e.dt)}</span>
          <span className="we-kind">{e.kind}</span>
          <span className="we-body">
            <Link href={`/company/${e.corp_code}`} className="we-corp">{e.corp_name}</Link>{' '}
            {e.href.startsWith('http') ? (
              <a href={e.href} target="_blank" rel="noreferrer">{e.title}</a>
            ) : (
              <span>{e.title}</span>
            )}
            {e.detail && <span className="we-detail tnum">{e.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// 회사 이름을 여러 개 붙여 넣으면 검색해서 한 번에 추가 (정확히 같은 이름 우선)
async function resolveNames(text: string): Promise<{ found: Item[]; missed: string[] }> {
  const names = [...new Set(text.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean))].slice(0, MAX);
  const found: Item[] = [];
  const missed: string[] = [];
  for (let i = 0; i < names.length; i += 4) {
    await Promise.all(
      names.slice(i, i + 4).map(async (n) => {
        try {
          const res = await fetch(`/api/companies?q=${encodeURIComponent(n)}`);
          const hits = (await res.json()) as { corp_code: string; corp_name: string }[];
          const norm = (s: string) => s.replace(/\(주\)|주식회사|\s/g, '');
          const hit = hits.find((h) => norm(h.corp_name) === norm(n)) ?? (hits.length === 1 ? hits[0] : null);
          if (hit) found.push({ c: hit.corp_code, n: hit.corp_name });
          else missed.push(n);
        } catch {
          missed.push(n);
        }
      }),
    );
  }
  return { found, missed };
}

export function WatchPanel() {
  const [items, save] = useWatch();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const codes = (items ?? []).map((i) => i.c).join(',');

  useEffect(() => {
    if (!codes) {
      setEvents([]);
      return;
    }
    let alive = true;
    setFailed(false);
    fetch(`/api/watch?c=${codes}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => alive && setEvents(j.events ?? []))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [codes]);

  if (items === null) return null;

  const addForm = (
    <form
      className="watch-add"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg('찾는 중…');
        const { found, missed } = await resolveNames(text);
        const merged = [...items];
        for (const f of found) if (!merged.some((m) => m.c === f.c)) merged.push(f);
        save(merged);
        setText('');
        setMsg(`${found.length}곳 추가${missed.length ? `, 못 찾음: ${missed.slice(0, 8).join(', ')}${missed.length > 8 ? ` 외 ${missed.length - 8}곳` : ''}` : ''}`);
      }}
    >
      <label htmlFor="watch-names" className="sr-only">회사 이름 (줄바꿈이나 쉼표로 구분)</label>
      <textarea id="watch-names" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="회사 이름을 줄바꿈이나 쉼표로 구분해 붙여 넣기" />
      <div className="watch-add-row">
        <button type="submit" className="btn" disabled={!text.trim()}>관심 회사에 추가</button>
        {msg && <span className="muted small" role="status">{msg}</span>}
      </div>
    </form>
  );

  if (!items.length) {
    return (
      <section className="section watch-sec is-empty" aria-labelledby="watch-h">
        <div className="section-head">
          <h2 id="watch-h">관심 회사</h2>
          <div className="section-right">
            <button type="button" className="linkish" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              {adding ? '닫기' : '여러 곳 한 번에 추가'}
            </button>
          </div>
        </div>
        <p className="muted small">회사 화면의 ‘관심 회사’를 누르면 그 회사의 공시·발행·만기를 여기에 모읍니다. 목록은 이 브라우저에만 저장됩니다.</p>
        {adding && addForm}
      </section>
    );
  }

  const recent = (events ?? []).filter((e) => e.when === 'recent');
  const upcoming = (events ?? []).filter((e) => e.when === 'upcoming');
  return (
    <section className="section watch-sec" aria-labelledby="watch-h">
      <div className="section-head">
        <h2 id="watch-h">
          관심 회사 <span className="muted small tnum">{items.length}곳</span>
        </h2>
        <div className="section-right">
          <button type="button" className="linkish" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {adding ? '닫기' : '회사 관리'}
          </button>
        </div>
      </div>
      {adding && (
        <div className="watch-manage">
          <ul className="watch-chips">
            {items.map((i) => (
              <li key={i.c}>
                <Link href={`/company/${i.c}`}>{i.n}</Link>
                <button type="button" aria-label={`${i.n} 빼기`} onClick={() => save(items.filter((x) => x.c !== i.c))}>×</button>
              </li>
            ))}
          </ul>
          {addForm}
        </div>
      )}
      {failed ? (
        <p className="empty">관심 회사 소식을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      ) : events === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : (
        <div className="watch-cols">
          <div>
            <h3 className="sub-h">최근 30일 공시·발행</h3>
            <EventList rows={recent} empty="최근 30일에 주요 공시나 발행이 없습니다." />
          </div>
          <div>
            <h3 className="sub-h">앞으로 90일 만기·풋옵션</h3>
            <EventList rows={upcoming} empty="앞으로 90일 안에 공모채 만기나 메자닌 풋옵션이 없습니다." />
          </div>
        </div>
      )}
    </section>
  );
}

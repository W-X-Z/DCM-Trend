'use client';

// 제안서 노하우 관리: 누구나 추가·수정·삭제. 삭제는 되돌릴 수 있고, 모든 변경은 이력에 남는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GRADES, KINDS, KIND_LABEL, SLIDES, SLIDE_LABEL, type Grade, type Knowledge, type KnowledgeKind, type KnowledgeLog, type KnowledgeSlide } from '@/lib/deck/knowledge';

const CLIENT_KEY = 'dcm.client.v1';
const AUTHOR_KEY = 'dcm.fb.author';

function load(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function store(key: string, v: string) {
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
    store(CLIENT_KEY, id);
  }
  return id;
}

type Draft = { id: number | null; slide: KnowledgeSlide; kind: KnowledgeKind; grade: Grade | ''; body: string; source: string };
const blank = (slide: KnowledgeSlide = 'all'): Draft => ({ id: null, slide, kind: 'judge', grade: '', body: '', source: '' });

const ACTION_LABEL: Record<KnowledgeLog['action'], string> = { create: '추가', update: '수정', delete: '삭제', restore: '되살림' };

async function post(payload: Record<string, unknown>) {
  const r = await fetch('/api/deck/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? '저장하지 못했습니다.');
  return j as { id: number };
}

export function KnowledgeBoard({ initialSlide }: { initialSlide?: string }) {
  const [items, setItems] = useState<Knowledge[] | null>(null);
  const [log, setLog] = useState<KnowledgeLog[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: number } | null>(null);
  const [slide, setSlide] = useState<KnowledgeSlide | ''>(SLIDES.some(([k]) => k === initialSlide) ? (initialSlide as KnowledgeSlide) : '');
  const [grade, setGrade] = useState<Grade | ''>('');
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (withLog = log !== null) => {
    try {
      const r = await fetch(`/api/deck/knowledge${withLog ? '?log=1' : ''}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '노하우를 불러오지 못했습니다.');
      setItems(j.items);
      if (withLog) setLog(j.log ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [log]);

  useEffect(() => {
    setAuthor(load(AUTHOR_KEY));
    refresh(false);
  }, []);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (items ?? []).filter((k) => (!slide || k.slide === slide)
      && (!grade || !k.grade || k.grade === grade)
      && (!words || `${k.body} ${k.source ?? ''}`.toLowerCase().includes(words)));
  }, [items, slide, grade, q]);

  const groups = useMemo(() => SLIDES.map(([key, label]) => ({ key, label, list: shown.filter((k) => k.slide === key) })).filter((g) => g.list.length), [shown]);

  async function save() {
    if (!draft) return;
    if (draft.body.trim().length < 5) {
      setNote({ text: '내용을 5자 이상 적어 주세요.' });
      return;
    }
    setBusy(true);
    try {
      await post({ action: 'save', ...draft, grade: draft.grade || null, author, clientId: clientId() });
      setNote({ text: draft.id ? '고쳤습니다.' : '추가했습니다.' });
      setDraft(null);
      await refresh();
    } catch (e) {
      setNote({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: Knowledge) {
    setBusy(true);
    try {
      await post({ action: 'delete', id: k.id, author, clientId: clientId() });
      setNote({ text: '지웠습니다.', undo: k.id });
      await refresh();
    } catch (e) {
      setNote({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: number) {
    setBusy(true);
    try {
      await post({ action: 'restore', id, author, clientId: clientId() });
      setNote({ text: '되살렸습니다.' });
      await refresh();
    } catch (e) {
      setNote({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function revert(l: KnowledgeLog) {
    if (!l.before) return;
    setBusy(true);
    try {
      await post({ action: 'save', id: l.knowledge_id, ...l.before, author, clientId: clientId() });
      setNote({ text: '이전 내용으로 되돌렸습니다.' });
      await refresh();
    } catch (e) {
      setNote({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const editor = (d: Draft) => (
    <form className="kb-edit" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={d.id ? '노하우 고치기' : '노하우 추가'}>
      <div className="kb-edit-row">
        <label className="dk-field">
          <span className="dk-label">장표</span>
          <select value={d.slide} onChange={(e) => setDraft({ ...d, slide: e.target.value as KnowledgeSlide })}>
            {SLIDES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="dk-field">
          <span className="dk-label">유형</span>
          <select value={d.kind} onChange={(e) => setDraft({ ...d, kind: e.target.value as KnowledgeKind })}>
            {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="dk-field">
          <span className="dk-label">적용 등급</span>
          <select value={d.grade} onChange={(e) => setDraft({ ...d, grade: e.target.value as Grade | '' })}>
            <option value="">모든 등급</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>
      <label className="dk-field">
        <span className="dk-label">내용</span>
        <textarea rows={3} maxLength={500} value={d.body} onChange={(e) => setDraft({ ...d, body: e.target.value })} autoFocus placeholder="예: AA급 2년물은 보험사 참여가 적어 3년물 중심으로 제안" />
      </label>
      <label className="dk-field">
        <span className="dk-label">근거·출처</span>
        <input maxLength={200} value={d.source} onChange={(e) => setDraft({ ...d, source: e.target.value })} placeholder="예: 2026 상반기 AA급 딜 경험, ○○ 제안서" />
      </label>
      <div className="kb-edit-act">
        <button type="submit" className="btn" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
        <button type="button" className="linklike" onClick={() => setDraft(null)}>취소</button>
        <span className="muted small">{d.body.length}/500</span>
      </div>
    </form>
  );

  return (
    <div className="kb">
      <div className="kb-bar">
        <div className="kb-filters" role="group" aria-label="거르기">
          <select aria-label="장표" value={slide} onChange={(e) => setSlide(e.target.value as KnowledgeSlide | '')}>
            <option value="">장표 전체</option>
            {SLIDES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select aria-label="적용 등급" value={grade} onChange={(e) => setGrade(e.target.value as Grade | '')}>
            <option value="">등급 전체</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}등급에 쓰는 것</option>)}
          </select>
          <input type="search" aria-label="내용 찾기" placeholder="내용 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="kb-who">
          <input aria-label="작성자 이름" placeholder="이름(선택)" value={author} maxLength={60}
            onChange={(e) => { setAuthor(e.target.value); store(AUTHOR_KEY, e.target.value); }} />
          <button type="button" className="btn" onClick={() => setDraft(blank(slide || 'all'))} disabled={!!draft && !draft.id}>노하우 추가</button>
        </div>
      </div>

      <p className="dk-status small" role="status">
        {items && <span className="muted">{shown.length === items.length ? `${items.length}개` : `${shown.length}개 / 전체 ${items.length}개`}</span>}
        {note && <span>{note.text}{note.undo && <> <button type="button" className="linklike" onClick={() => restore(note.undo!)}>되돌리기</button></>}</span>}
      </p>

      {draft && !draft.id && editor(draft)}
      {err && <p className="empty">{err}</p>}
      {!items && !err && <p className="empty" aria-busy="true">불러오는 중…</p>}
      {items && !groups.length && <p className="empty">조건에 맞는 노하우가 없습니다.</p>}

      {groups.map((g) => (
        <section key={g.key} className="kb-group" aria-labelledby={`kb-${g.key}`}>
          <h2 id={`kb-${g.key}`}>{g.label} <span className="muted small">{g.list.length}</span></h2>
          <ul className="kb-list">
            {g.list.map((k) => (
              <li key={k.id} className="kb-item">
                {draft?.id === k.id ? editor(draft) : (
                  <>
                    <div className="kb-tags">
                      <span className={`kb-kind k-${k.kind}`}>{KIND_LABEL[k.kind]}</span>
                      {k.grade && <span className="dk-tag">{k.grade}</span>}
                    </div>
                    <p className="kb-body">{k.body}</p>
                    <p className="kb-meta small muted">
                      {k.source && <span>{k.source}</span>}
                      <span>{k.updated_by ?? '이름 없음'} {k.updated_kst.slice(5)}</span>
                    </p>
                    <div className="kb-act small">
                      <button type="button" className="linklike" onClick={() => setDraft({ id: k.id, slide: k.slide, kind: k.kind, grade: k.grade ?? '', body: k.body, source: k.source ?? '' })}>고치기</button>
                      <button type="button" className="linklike" onClick={() => remove(k)} disabled={busy}>지우기</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <details className="kb-log" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && log === null) refresh(true); }}>
        <summary>변경 이력</summary>
        {log === null ? <p className="empty small" aria-busy="true">불러오는 중…</p> : !log.length ? <p className="empty small">아직 변경이 없습니다.</p> : (
          <ol className="kb-log-list small">
            {log.map((l, i) => {
              const v = l.after ?? l.before;
              // 되살리기·되돌리기는 그 항목의 가장 최근 변경에만 단다
              const latest = log.findIndex((x) => x.knowledge_id === l.knowledge_id) === i;
              return (
                <li key={l.id}>
                  <span className="tnum muted">{l.at_kst.slice(5)}</span>
                  <span>{l.author ?? '이름 없음'}</span>
                  <span className={`kb-act-${l.action}`}>{ACTION_LABEL[l.action]}</span>
                  <span className="kb-log-body">{v ? `${SLIDE_LABEL[v.slide]} · ${v.body}` : ''}</span>
                  <span>
                    {latest && l.action === 'delete' && l.is_deleted && <button type="button" className="linklike" onClick={() => restore(l.knowledge_id)} disabled={busy}>되살리기</button>}
                    {latest && l.action === 'update' && l.before && !l.is_deleted && <button type="button" className="linklike" onClick={() => revert(l)} disabled={busy}>이전 내용으로</button>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </details>
    </div>
  );
}

'use client';

// 대화에 드라이브 자료 붙이기: 부서 레퍼런스 · 내 자료에서 고르거나 바로 올린다. DM 을 올리면 제안서 Ⅱ부가 그 판으로 바뀐다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DriveFail, driveKey, listDrive, setDriveKey, uploadDrive } from '@/lib/drive/client';
import type { DriveRow } from '@/lib/drive/store';

export type FilePick = { id: number; name: string };
type Dest = 'mine' | '레퍼런스' | 'DM';
const DEST: { v: Dest; label: string }[] = [
  { v: 'mine', label: '내 자료' },
  { v: '레퍼런스', label: '부서 레퍼런스' },
  { v: 'DM', label: '부서 DM' },
];
const ACCEPT = '.pptx,.pdf,.md,.csv,.txt,.json,.xlsx,.docx';
const day = (s: string) => s.slice(2, 10).replace(/-/g, '.');

export function DrivePicker({ picked, onToggle, onDm, onClose }: { picked: FilePick[]; onToggle: (f: FilePick) => void; onDm: () => void; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [rows, setRows] = useState<{ refs: DriveRow[]; mine: DriveRow[]; dm: DriveRow | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [dest, setDest] = useState<Dest>('mine');
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setKey(driveKey()), []);
  const load = useCallback(async () => {
    setErr(null);
    try {
      const [dept, mine] = await Promise.all([listDrive('dept'), listDrive('mine')]);
      const dms = dept.files.filter((f) => f.folder === 'DM' && f.status === 'ready' && f.meta.dm);
      dms.sort((a, b) => (b.meta.dm!.edition).localeCompare(a.meta.dm!.edition));
      setRows({ refs: dept.files.filter((f) => f.folder === '레퍼런스'), mine: mine.files, dm: dms[0] ?? null });
    } catch (e) {
      if (e instanceof DriveFail && e.code === 'bad_key') {
        setDriveKey('');
        setKey('');
      }
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (key) load();
  }, [key, load]);
  useEffect(() => {
    const out = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', out);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  async function upload(file: File) {
    setBusy(file.name);
    setNote(null);
    setErr(null);
    try {
      const r = await uploadDrive(file, dest === 'mine' ? 'mine' : 'dept', dest === 'mine' ? '올린 자료' : dest);
      if (r.status === 'error') setErr(r.error ?? '처리하지 못했어요.');
      else if (dest === 'DM') {
        setNote('DM 판을 바꿨어요. 장표 Ⅱ부가 새 판으로 바뀌어요.');
        onDm();
      } else if (!picked.some((p) => p.id === r.id)) onToggle({ id: r.id, name: r.name });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const row = (f: DriveRow) => {
    const on = picked.some((p) => p.id === f.id);
    const ok = f.status === 'ready';
    return (
      <li key={f.id}>
        <label className={ok ? undefined : 'is-off'}>
          <input type="checkbox" checked={on} disabled={!ok} onChange={() => onToggle({ id: f.id, name: f.name })} />
          <span className="dp-name">{f.name}</span>
          <span className="dp-meta">{f.status === 'processing' ? '처리 중' : f.status === 'error' ? '오류' : [[f.meta.card?.industry, f.meta.card?.rating].filter(Boolean).join(' '), day(f.created_at), f.versions > 1 ? `v${f.ver}` : ''].filter(Boolean).join(' · ')}</span>
        </label>
      </li>
    );
  };

  return (
    <div className="dp" ref={boxRef} role="dialog" aria-label="드라이브 자료">
      <div className="dp-head">
        <b>드라이브 자료</b>
        <button type="button" className="dp-x" onClick={onClose} aria-label="닫기">×</button>
      </div>
      {!key ? (
        <form
          className="dp-key"
          onSubmit={(e) => {
            e.preventDefault();
            const k = keyDraft.trim();
            if (!k) return;
            setDriveKey(k);
            setKey(k);
            setKeyDraft('');
          }}
        >
          <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="드라이브 키" aria-label="드라이브 키" autoComplete="off" />
          <button type="submit" disabled={!keyDraft.trim()}>확인</button>
        </form>
      ) : (
        <>
          {rows?.dm && (
            <p className="dp-dm">
              DM <b>{day(rows.dm.meta.dm!.edition)} 판</b> 적용 중
            </p>
          )}
          <div className="dp-list">
            <h4>부서 레퍼런스</h4>
            {rows ? rows.refs.length ? <ul>{rows.refs.map(row)}</ul> : <p className="dp-empty">아직 없어요</p> : !err && <p className="dp-empty">불러오는 중…</p>}
            <h4>내 자료</h4>
            {rows ? rows.mine.length ? <ul>{rows.mine.map(row)}</ul> : <p className="dp-empty">아직 없어요</p> : null}
          </div>
          <div className="dp-up">
            <select value={dest} onChange={(e) => setDest(e.target.value as Dest)} aria-label="올릴 곳" disabled={!!busy}>
              {DEST.map((d) => (
                <option key={d.v} value={d.v}>{d.label}</option>
              ))}
            </select>
            <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy ? '올리는 중…' : '파일 올리기'}</button>
            <input ref={fileRef} type="file" hidden accept={dest === 'DM' ? '.pptx' : ACCEPT} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        </>
      )}
      {note && <p className="dp-note">{note}</p>}
      {err && <p className="dp-err">{err}</p>}
    </div>
  );
}

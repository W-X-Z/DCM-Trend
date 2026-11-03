'use client';

// 줄 비교 표시: 왼쪽 표시 칸(+ 추가, − 삭제)과 글. 바뀐 곳 주변만 보여 준다.
import { diffLines, hunks } from '@/lib/agent/diff';

export function Diff({ before, after, ctx = 2, label }: { before: string; after: string; ctx?: number; label: string }) {
  const d = hunks(diffLines(before, after), ctx);
  return (
    <div className="ag-diff" role="group" aria-label={label}>
      {d.map((l, i) =>
        l ? (
          <div key={i} className={`is-${l.t}`}>
            <span className="ag-diff-mk" aria-label={l.t === 'add' ? '추가' : l.t === 'del' ? '삭제' : undefined}>{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
            <span className="ag-diff-tx">{l.s || ' '}</span>
          </div>
        ) : (
          <div key={i} className="is-gap">
            <span className="ag-diff-mk" />
            <span className="ag-diff-tx">…</span>
          </div>
        ),
      )}
    </div>
  );
}

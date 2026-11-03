'use client';

// 실행·Builder 대화 공용: NDJSON 스트림 읽기, 이벤트 → 대화 조각, 도구·역할 진행 표시
import { useEffect, useState } from 'react';
import { BUILDER_NAME, ROLE_NAME, type Msg } from '@/lib/agent/defs';

export type Step = { id: string; label: string; status: 'run' | 'ok' | 'fail'; note: string };
export type RoleRun = { role: string; status: 'run' | 'ok'; steps: Step[]; text?: string };
export type Part =
  | { k: 'text'; text: string }
  | { k: 'tool'; id: string; name: string; label: string; status: 'run' | 'ok' | 'fail'; note: string; roles?: RoleRun[] }
  | { k: 'render'; name: string; slides: number }
  | { k: 'proposal'; id: string }
  | { k: 'note'; text: string }
  | { k: 'error'; text: string };
export type Turn = { role: 'user'; text: string; ctx?: string } | { role: 'assistant'; parts: Part[]; model?: string; done?: boolean };

type Common =
  | { t: 'text'; text: string }
  | { t: 'tool'; id: string; name: string; label: string; agent: string; call?: string }
  | { t: 'tool_done'; id: string; ok: boolean; note: string }
  | { t: 'role'; call: string; role: string; phase: 'start' | 'end'; text?: string }
  | { t: 'error'; message: string };

// 공용 이벤트를 대화 조각에 반영한다(모르는 이벤트는 그대로)
export function applyCommon(parts: Part[], e: Common | { t: string }): Part[] {
  const ev = e as Common;
  switch (ev.t) {
    case 'text':
      return [...parts, { k: 'text', text: ev.text }];
    case 'error':
      return [...parts, { k: 'error', text: ev.message }];
    case 'tool':
      if (ev.agent === 'master') return [...parts, { k: 'tool', id: ev.id, name: ev.name, label: ev.label, status: 'run', note: '' }];
      return parts.map((p) =>
        p.k === 'tool' && p.id === ev.call
          ? { ...p, roles: (p.roles ?? []).map((r) => (r.role === ev.agent && r.status === 'run' ? { ...r, steps: [...r.steps, { id: ev.id, label: ev.label, status: 'run', note: '' }] } : r)) }
          : p,
      );
    case 'tool_done':
      return parts.map((p) => {
        if (p.k !== 'tool') return p;
        if (p.id === ev.id) return { ...p, status: ev.ok ? 'ok' : 'fail', note: ev.note };
        if (!p.roles?.some((r) => r.steps.some((s) => s.id === ev.id))) return p;
        return { ...p, roles: p.roles.map((r) => ({ ...r, steps: r.steps.map((s) => (s.id === ev.id ? { ...s, status: ev.ok ? 'ok' : 'fail', note: ev.note } : s)) })) };
      });
    case 'role':
      return parts.map((p) => {
        if (p.k !== 'tool' || p.id !== ev.call) return p;
        if (ev.phase === 'start') return { ...p, roles: [...(p.roles ?? []), { role: ev.role, status: 'run', steps: [] }] };
        return { ...p, roles: (p.roles ?? []).map((r) => (r.role === ev.role && r.status === 'run' ? { ...r, status: 'ok', text: ev.text } : r)) };
      });
    default:
      return parts;
  }
}

// 한 번 요청: NDJSON 을 읽으며 이벤트를 넘긴다
export async function postStream<E extends { t: string }>(url: string, body: unknown, signal: AbortSignal, onEvent: (e: E) => void) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `요청이 실패했어요 (${r.status})`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as E);
      } catch {
        /* 깨진 줄은 건너뜀 */
      }
    }
    if (done) break;
  }
}

// 지난 턴의 긴 도구 결과는 줄여서 둔다(저장 공간·보내는 양)
export function trimOld(api: Msg[]): Msg[] {
  let last = -1;
  api.forEach((m, i) => {
    if (m.role === 'user' && typeof m.content === 'string') last = i;
  });
  return api.map((m, i) =>
    i >= last || typeof m.content === 'string'
      ? m
      : { ...m, content: m.content.map((b) => (b.type === 'tool_result' && b.content.length > 600 ? { ...b, content: `${b.content.slice(0, 600)}\n…(지난 결과 줄임)` } : b)) },
  );
}

const nameOf = (k: string) => ROLE_NAME[k] ?? BUILDER_NAME[k] ?? k;

export function ToolRow({ p }: { p: Extract<Part, { k: 'tool' }> }) {
  return (
    <div className={`ag-tool is-${p.status}`}>
      <div className="ag-tool-row">
        <i aria-hidden="true" />
        <span className="ag-tool-label">{p.label}</span>
        {p.note && <span className="ag-tool-note">{p.note}</span>}
      </div>
      {p.roles?.map((r, i) => (
        <div key={`${r.role}-${i}`} className={`ag-sub ag-role-run is-${r.status}`}>
          <span className="ag-sub-name">{nameOf(r.role)}</span>
          {r.steps.map((s) => (
            <div key={s.id} className={`ag-tool-row is-${s.status}`} title={s.note || undefined}>
              <i aria-hidden="true" />
              <span className="ag-tool-label">{s.label}</span>
              {s.note && <span className="ag-tool-note">{s.note}</span>}
            </div>
          ))}
          {r.text && (
            <details className="ag-sub-out">
              <summary>보고</summary>
              <pre>{r.text}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

// 칸 크기 재기(콜백 ref)
export function useBox() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, box] as const;
}

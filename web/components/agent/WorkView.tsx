'use client';

// 제안서 Agent 가 일하는 동안의 화면: 단계(데이터 → 역할 6 → 장표)별 진행과 방금 내린 결정.
// 첫 초안은 이 화면을 보여 주다가 Agent 가 장표를 만들면(render) 장표로 넘어간다.
import { useEffect, useState } from 'react';
import { FIELD_LABEL, ROLE_NAME, type Session, type TextField } from '@/lib/agent/defs';
import type { Part, RoleRun } from './chat';

type Status = 'wait' | 'run' | 'ok' | 'fail';
type Stage = { key: string; name: string; status: Status; now: string; meta: string };

const tools = (parts: Part[]) => parts.filter((p): p is Extract<Part, { k: 'tool' }> => p.k === 'tool');

function roleRun(parts: Part[], key: string): RoleRun | null {
  const runs = tools(parts).flatMap((p) => p.roles ?? []).filter((r) => r.role === key);
  return runs[runs.length - 1] ?? null;
}

function lastStep(r: RoleRun | null) {
  const s = r?.steps[r.steps.length - 1];
  return s ? `${s.label}${s.note ? ` · ${s.note}` : ''}` : '';
}

export function stagesOf(parts: Part[], s: Session, after: string): Stage[][] {
  const ts = tools(parts);
  const fetch = ts.filter((p) => p.name === 'find_company' || p.name === 'open_company');
  const dataStatus: Status = !fetch.length ? 'wait' : fetch.some((p) => p.status === 'fail') ? 'fail' : fetch.every((p) => p.status === 'ok') && fetch.some((p) => p.name === 'open_company') ? 'ok' : 'run';
  const render = ts.filter((p) => p.name === 'render');
  const dec = (k: string) => s.log.filter((x) => x.role === k && x.at > after).length;
  const txt = (k: string) => (Object.entries(s.texts) as [TextField, { role: string; at: string }][]).filter(([, m]) => m.role === k && m.at > after).map(([f]) => FIELD_LABEL[f]);
  const role = (key: string): Stage => {
    const r = roleRun(parts, key);
    const d = dec(key);
    const t = txt(key);
    const meta = [d ? `결정 ${d}` : '', t.length ? `문안 ${t.length}` : '', key === 'review' && r?.status === 'ok' ? '의견' : ''].filter(Boolean).join(' · ');
    return { key, name: ROLE_NAME[key], status: r ? r.status : 'wait', now: r?.status === 'run' ? lastStep(r) : r ? (r.text ?? '').split('\n')[0].slice(0, 80) : '', meta };
  };
  return [
    [{ key: 'data', name: '데이터 받기', status: dataStatus, now: fetch[fetch.length - 1]?.note ?? '', meta: '' }],
    [role('company'), role('market')],
    [role('deal')],
    [role('sales')],
    [role('deck')],
    [role('review')],
    [{ key: 'render', name: '장표 만들기', status: !render.length ? 'wait' : render[render.length - 1].status === 'ok' ? 'ok' : 'run', now: render[render.length - 1]?.note ?? '', meta: '' }],
  ];
}

// 지금 하는 일 한 줄(진행 중인 역할의 마지막 단계, 없으면 Master 의 마지막 도구)
export function nowDoing(parts: Part[]): string {
  const ts = tools(parts);
  const running = ts.flatMap((p) => p.roles ?? []).filter((r) => r.status === 'run');
  if (running.length) return running.map((r) => `${ROLE_NAME[r.role]}${lastStep(r) ? ` · ${lastStep(r).split(' · ')[0]}` : ''}`).join('  |  ');
  const t = ts[ts.length - 1];
  return t ? t.label : '요청을 읽는 중';
}

function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const MARK: Record<Status, string> = { wait: '대기', run: '진행 중', ok: '완료', fail: '실패' };

// since: 이번 요청을 보낸 때(경과 시간), after: 그 전 세션의 마지막 기록 시각(서버 시각 기준으로 이번 기록만 고르기)
export function WorkView({ parts, session, since, after, title }: { parts: Part[]; session: Session; since: number; after: string; title: string }) {
  const rows = stagesOf(parts, session, after);
  const elapsed = useElapsed(since);
  const feed = session.log.filter((x) => x.at > after).slice(-6).reverse();
  return (
    <div className="ag-work" aria-live="polite">
      <div className="ag-work-head">
        <strong>{title}</strong>
        <span className="ag-muted">{elapsed}</span>
      </div>
      <ol className="ag-pipe">
        {rows.map((row, i) => (
          <li key={i} className={row.length > 1 ? 'is-par' : ''}>
            {row.map((st) => (
              <div key={st.key} className={`ag-pipe-step is-${st.status}`}>
                <i aria-hidden="true" />
                <div>
                  <div className="ag-pipe-head">
                    <strong>{st.name}</strong>
                    <span className="ag-pipe-mark">{MARK[st.status]}</span>
                    {st.meta && <span className="ag-muted">{st.meta}</span>}
                  </div>
                  {st.now && <p>{st.now}</p>}
                </div>
              </div>
            ))}
          </li>
        ))}
      </ol>
      {feed.length > 0 && (
        <section className="ag-work-feed">
          <h3>방금 내린 결정</h3>
          <ul>
            {feed.map((d, i) => (
              <li key={`${d.at}-${i}`}>
                <span className={`ag-role-chip is-${d.role}`}>{ROLE_NAME[d.role]}</span>
                <span>{d.what}</span>
                {d.rules.length > 0 && <code className="ag-tag">{d.rules.join(', ')}</code>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

'use client';

// AI 기능별 체인과 프롬프트 구성. 프롬프트 글은 서버가 실제 코드의 상수를 그대로 넘긴다.
import { useState } from 'react';
import { Chain, type Node } from './Chain';

export type Feature = {
  key: string;
  name: string;
  when: string;
  files: string[];
  model: string;
  chain: Node[];
  system: { text: string; version: string };
  user: { label: string; desc: string }[];
  output: { title: string; rows: [string, string][] };
  checks: string[];
  fallback: string;
  limits: string[];
};

export function HowFeatures({ features }: { features: Feature[] }) {
  const [key, setKey] = useState(features[0]?.key);
  const f = features.find((x) => x.key === key) ?? features[0];
  if (!f) return null;
  return (
    <div className="hw-features">
      <div className="hw-switch" role="tablist" aria-label="AI 기능">
        {features.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={x.key === f.key} onClick={() => setKey(x.key)}>
            {x.name}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={f.name}>
        <p className="hw-when small">
          <span>{f.when}</span>
          <span className="muted">모델 {f.model}</span>
          {f.system.version !== '–' && <span className="muted">프롬프트 v{f.system.version}</span>}
        </p>
        <Chain nodes={f.chain} label={`${f.name} 흐름`} />

        <div className="hw-prompt">
          <section className="hw-block hw-sys" aria-label="시스템 지침">
            <h3>시스템 지침</h3>
            <pre className="hw-pre" tabIndex={0}>{f.system.text}</pre>
          </section>

          <div className="hw-side">
            <section className="hw-block" aria-label="사용자 메시지">
              <h3>사용자 메시지</h3>
              <dl className="hw-dl">
                {f.user.map((u) => (
                  <div key={u.label}><dt>{u.label}</dt><dd>{u.desc}</dd></div>
                ))}
              </dl>
            </section>
            <section className="hw-block" aria-label="검증">
              <h3>응답 검증</h3>
              <ul className="hw-list">
                {f.checks.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <p className="hw-fallback small"><strong>실패하면</strong> {f.fallback}</p>
            </section>
          </div>
        </div>

        <section className="hw-block hw-out" aria-label={f.output.title}>
          <h3>{f.output.title}</h3>
          <div className="table-wrap">
            <table className="data compact hw-table">
              <tbody>
                {f.output.rows.map(([a, b]) => (
                  <tr key={a}><th scope="row">{a}</th><td>{b}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="hw-files small muted">
          {f.limits.map((l) => <span key={l}>{l}</span>)}
          {f.files.map((p) => <code key={p}>{p}</code>)}
        </p>
      </div>
    </div>
  );
}

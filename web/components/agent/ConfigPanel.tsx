'use client';

// 구성: Managed Agent 패키지와 같은 단위로 보여 준다 — Agent(Master·Sub-agent), 스킬, 도구, 데이터, 기억.
// 스킬과 기억은 여기서 고치면 바로 다음 실행부터 쓰인다(이 브라우저에 저장).
import { useMemo, useState } from 'react';
import { AGENTS, DEFAULT_MEMORY, TOOL_CATALOG, type AgentKey } from '@/lib/agent/config';
import { TOOL_DEFS } from '@/lib/agent/tools';
import type { MemoryFile, Skill } from '@/lib/agent/store';
import type { EngineState } from '@/lib/deck/engine';
import { available } from '@/lib/deck/layout';
import { dataReport } from '@/lib/deck/sources';
import type { DeckData } from '@/lib/deck/types';
import type { Models } from './AgentConsole';
import { SkillsView } from './SkillsView';

type Sec = 'agents' | 'skills' | 'tools' | 'data' | 'memory';

export function ConfigPanel({ models, skills, setSkills, memory, setMemory, deck }: {
  models: Models;
  skills: Skill[];
  setSkills: (f: (s: Skill[]) => Skill[]) => void;
  memory: MemoryFile[];
  setMemory: (m: MemoryFile[]) => void;
  deck: { state: EngineState | null; data: DeckData | null };
}) {
  const [sec, setSec] = useState<Sec>('agents');
  const secs: [Sec, string, string][] = [
    ['agents', 'Agent', String(AGENTS.length)],
    ['skills', '스킬', `${skills.filter((s) => s.enabled).length}/${skills.length}`],
    ['tools', '도구', String(Object.keys(TOOL_DEFS).length)],
    ['data', '데이터', ''],
    ['memory', '기억', String(memory.length)],
  ];
  return (
    <div className="ag-cfg">
      <nav className="ag-cfg-nav" aria-label="구성">
        {secs.map(([k, l, n]) => (
          <button key={k} type="button" aria-current={sec === k ? 'true' : undefined} onClick={() => setSec(k)}>
            {l}
            {n && <span>{n}</span>}
          </button>
        ))}
      </nav>
      <div className="ag-cfg-body">
        {sec === 'agents' && <AgentsView models={models} skills={skills} />}
        {sec === 'skills' && <SkillsView skills={skills} setSkills={setSkills} />}
        {sec === 'tools' && <ToolsView />}
        {sec === 'data' && <DataView deck={deck} skills={skills} />}
        {sec === 'memory' && <MemoryView memory={memory} setMemory={setMemory} />}
      </div>
    </div>
  );
}

const modelOf = (k: AgentKey, m: Models) => (k === 'master' ? m.master : m.sub);

function AgentsView({ models, skills }: { models: Models; skills: Skill[] }) {
  const master = AGENTS[0];
  const subs = AGENTS.slice(1);
  const skillsOf = (k: AgentKey) => skills.filter((s) => s.enabled && s.agents.includes(k)).map((s) => s.name);
  return (
    <div className="ag-agents">
      <div className="ag-org" aria-hidden="true">
        <div className="ag-org-node is-master">
          <strong>{master.name}</strong>
          <span>{modelOf('master', models)}</span>
        </div>
        <div className="ag-org-edge">call_subagent</div>
        <div className="ag-org-subs">
          {subs.map((a) => (
            <div key={a.key} className="ag-org-node">
              <strong>{a.name}</strong>
              <span>{modelOf(a.key, models)}</span>
            </div>
          ))}
        </div>
      </div>
      {AGENTS.map((a) => (
        <section key={a.key} className="ag-agent">
          <h2>{a.name}</h2>
          <p className="ag-agent-role">{a.role}</p>
          <dl className="ag-dl">
            <dt>모델</dt>
            <dd><code>{modelOf(a.key, models)}</code></dd>
            <dt>스킬</dt>
            <dd className="ag-tags">{skillsOf(a.key).length ? skillsOf(a.key).map((n) => <span key={n} className="ag-tag">{n}</span>) : <span className="ag-muted">없음</span>}</dd>
            <dt>도구</dt>
            <dd className="ag-tags">{a.tools.map((t) => <code key={t} className="ag-tag is-tool">{t}</code>)}</dd>
          </dl>
          <details className="ag-prompt">
            <summary>시스템 프롬프트 · {a.system.length.toLocaleString()}자</summary>
            <pre>{a.system}</pre>
          </details>
        </section>
      ))}
    </div>
  );
}

function ToolsView() {
  const groups = useMemo(() => {
    const m = new Map<string, typeof TOOL_CATALOG>();
    for (const t of TOOL_CATALOG) m.set(t.group, [...(m.get(t.group) ?? []), t]);
    return [...m.entries()];
  }, []);
  const users = (name: string) => AGENTS.filter((a) => a.tools.includes(name)).map((a) => a.name.replace('DCM ', ''));
  return (
    <div className="ag-tools">
      <h2 className="ag-h2">기능</h2>
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col">묶음</th>
            <th scope="col">기능</th>
            <th scope="col">하는 일</th>
            <th scope="col">실행</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([g, list]) =>
            list.map((t, i) => (
              <tr key={t.name}>
                {i === 0 && <th scope="rowgroup" rowSpan={list.length}>{g}</th>}
                <td>
                  {t.name}
                  <span className={`ag-kind ${t.ai ? 'is-ai' : 'is-code'}`}>{t.ai ? 'AI' : '코드'}</span>
                </td>
                <td>{t.does}</td>
                <td>{t.run ? <code>{t.run}</code> : <span className="ag-muted">예시</span>}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>

      <h2 className="ag-h2">Claude 도구 정의</h2>
      <ul className="ag-defs">
        {Object.entries(TOOL_DEFS).map(([name, d]) => (
          <li key={name}>
            <div className="ag-def-head">
              <code>{name}</code>
              <span className="ag-muted">{users(name).join(' · ')}</span>
            </div>
            <p>{d.description}</p>
            <details>
              <summary>입력 형식</summary>
              <pre>{JSON.stringify(d.input_schema, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DataView({ deck, skills }: { deck: { state: EngineState | null; data: DeckData | null }; skills: Skill[] }) {
  const rep = useMemo(() => {
    if (!deck.state || !deck.data) return null;
    const avail = available(deck.data, deck.state.input);
    return dataReport(deck.data, deck.state.input, avail);
  }, [deck]);
  const guide = skills.find((s) => s.name === 'dcm-data-guide');
  if (!rep || !deck.data) {
    return (
      <div className="ag-data">
        <p className="ag-muted">실행에서 회사를 열면 그 초안이 쓰는 데이터가 장표별로 나와요. 아래는 데이터 안내 스킬 내용이에요.</p>
        {guide && <pre className="ag-doc">{guide.files['references/data-by-slide.md'] ?? guide.files['SKILL.md']}</pre>}
      </div>
    );
  }
  return (
    <div className="ag-data">
      <p className="ag-muted">{deck.data.company.corp_name} 초안 기준</p>
      <h2 className="ag-h2">외부 데이터</h2>
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col">장표</th>
            <th scope="col">데이터</th>
            <th scope="col">출처</th>
          </tr>
        </thead>
        <tbody>
          {rep.items.flatMap((it) =>
            it.srcs
              .filter((s) => s.kind === 'ext')
              .map((s, i) => (
                <tr key={`${it.id}-${i}`}>
                  <td>{i === 0 ? it.label : ''}</td>
                  <td>{s.label}{s.status === 'missing' && <span className="ag-kind is-miss">없음</span>}</td>
                  <td className="ag-muted">{s.source}</td>
                </tr>
              )),
          )}
        </tbody>
      </table>
      <h2 className="ag-h2">내부 데이터 <span className="dk2-unlinked">미연계</span></h2>
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col">데이터</th>
            <th scope="col">출처</th>
            <th scope="col">쓰는 장표</th>
          </tr>
        </thead>
        <tbody>
          {rep.intMissing.map((m) => (
            <tr key={`${m.label}|${m.source}`}>
              <td>{m.label}</td>
              <td className="ag-muted">{m.source}</td>
              <td>{m.items.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemoryView({ memory, setMemory }: { memory: MemoryFile[]; setMemory: (m: MemoryFile[]) => void }) {
  return (
    <div className="ag-memory">
      <p className="ag-muted">개인 기억이에요. 실행할 때마다 Master 에 함께 보내요. 팀 규칙은 암묵지(스킬)로 올려 주세요.</p>
      {memory.map((f, i) => {
        const def = DEFAULT_MEMORY.find((d) => d.path === f.path)?.body ?? '';
        return (
          <section key={f.path} className="ag-mem">
            <div className="ag-mem-head">
              <h2>{f.title}</h2>
              <code>{f.path}</code>
              {f.body !== def && (
                <button type="button" className="ag-link" onClick={() => setMemory(memory.map((m, j) => (j === i ? { ...m, body: def } : m)))}>예시로 되돌리기</button>
              )}
            </div>
            <textarea
              className="ag-code"
              rows={Math.max(3, f.body.split('\n').length + 1)}
              value={f.body}
              onChange={(e) => setMemory(memory.map((m, j) => (j === i ? { ...m, body: e.target.value } : m)))}
              aria-label={`${f.title} 기억`}
            />
          </section>
        );
      })}
    </div>
  );
}


'use client';

// 스킬: 목록(켬/끔) + 편집기(SKILL.md·references 파일, 쓰는 Agent) + 이력(저장할 때마다 이전 판을 남김, 되돌리기).
// 기본 스킬은 '기본값으로'로 배포된 판에 맞출 수 있고, 새 스킬은 이 브라우저에만 있다.
import { useEffect, useMemo, useState } from 'react';
import { AGENTS, skillMeta, type AgentKey, type SkillFiles } from '@/lib/agent/config';
import { NAME_RE, commitFiles, defaultFiles, newSkillFiles, sameFiles, skillProblems, type Skill } from '@/lib/agent/store';

const AGENT_SHORT: Record<AgentKey, string> = { master: 'Master', sales_writer: 'Sales Writer', reviewer: 'Reviewer' };
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const sortFiles = (f: SkillFiles) => Object.keys(f).sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)));

export function SkillsView({ skills, setSkills }: { skills: Skill[]; setSkills: (f: (s: Skill[]) => Skill[]) => void }) {
  const [sel, setSel] = useState(skills[0]?.name ?? '');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const cur = skills.find((s) => s.name === sel) ?? skills[0];

  const update = (name: string, f: (s: Skill) => Skill) => setSkills((list) => list.map((s) => (s.name === name ? f(s) : s)));

  function create() {
    const n = newName.trim();
    if (!NAME_RE.test(n) || skills.some((s) => s.name === n)) return;
    setSkills((list) => [...list, { name: n, origin: 'custom', enabled: true, agents: ['master'], files: newSkillFiles(n), history: [], edited: false }]);
    setSel(n);
    setAdding(false);
    setNewName('');
  }
  const nameErr = newName && (!NAME_RE.test(newName.trim()) ? '영문 소문자·숫자·하이픈, 2~64자' : skills.some((s) => s.name === newName.trim()) ? '같은 이름이 있어요' : '');

  return (
    <div className="ag-skills">
      <div className="ag-skill-list">
        <ul>
          {skills.map((s) => {
            const m = skillMeta(s.files);
            return (
              <li key={s.name}>
                <button type="button" aria-current={cur?.name === s.name ? 'true' : undefined} onClick={() => setSel(s.name)} className={s.enabled ? '' : 'is-off'}>
                  <strong>{s.name}</strong>
                  <span className="ag-skill-desc">{m.description || '설명 없음'}</span>
                  <span className="ag-skill-badges">
                    {s.origin === 'custom' ? <em>새 스킬</em> : s.edited ? <em>고침</em> : null}
                    {!s.enabled && <em className="is-off">끔</em>}
                    {s.history.length > 0 && <em className="is-plain">이력 {s.history.length}</em>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {adding ? (
          <form
            className="ag-new"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value.toLowerCase())} placeholder="예: dcm-ls-cable-notes" aria-label="새 스킬 이름" aria-invalid={!!nameErr} />
            {nameErr && <span className="ag-err">{nameErr}</span>}
            <div>
              <button type="submit" className="btn" disabled={!newName.trim() || !!nameErr}>만들기</button>
              <button type="button" className="ag-link" onClick={() => setAdding(false)}>취소</button>
            </div>
          </form>
        ) : (
          <button type="button" className="ag-add" onClick={() => setAdding(true)}>+ 새 스킬</button>
        )}
      </div>
      {cur && <SkillEditor key={cur.name} s={cur} update={(f) => update(cur.name, f)} remove={() => {
        setSkills((list) => list.filter((x) => x.name !== cur.name));
        setSel(skills.find((x) => x.name !== cur.name)?.name ?? '');
      }} />}
    </div>
  );
}

function SkillEditor({ s, update, remove }: { s: Skill; update: (f: (s: Skill) => Skill) => void; remove: () => void }) {
  const [draft, setDraft] = useState<SkillFiles>(s.files);
  const [file, setFile] = useState('SKILL.md');
  const [newPath, setNewPath] = useState<string | null>(null);
  const [showHist, setShowHist] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // 저장본이 바뀌면(되돌리기·기본값) 편집본도 맞춘다
  useEffect(() => setDraft(s.files), [s.files]);
  useEffect(() => {
    if (!(file in draft)) setFile('SKILL.md');
  }, [draft, file]);

  const dirty = !sameFiles(draft, s.files);
  const problems = useMemo(() => skillProblems(s.name, draft), [s.name, draft]);
  const def = s.origin === 'default' ? defaultFiles(s.name) : null;
  const files = sortFiles(draft);

  function save() {
    if (problems.length) return;
    update((x) => commitFiles(x, draft, '저장'));
    setSaved('저장했어요. 다음 실행부터 써요.');
  }
  function addFile() {
    const p = (newPath ?? '').trim();
    if (!/^[A-Za-z0-9._/-]{1,120}$/.test(p) || p.includes('..') || p in draft) return;
    setDraft({ ...draft, [p]: `# ${p.split('/').pop()?.replace(/\.md$/, '')}\n\n` });
    setFile(p);
    setNewPath(null);
  }
  const pathErr = newPath != null && newPath.trim() && (!/^[A-Za-z0-9._/-]{1,120}$/.test(newPath.trim()) || newPath.includes('..') ? '영문·숫자·._/- 만 (예: references/notes.md)' : newPath.trim() in draft ? '같은 파일이 있어요' : '');

  return (
    <div className="ag-editor">
      <div className="ag-editor-head">
        <h2>{s.name}</h2>
        <label className="ag-switch">
          <input type="checkbox" checked={s.enabled} onChange={(e) => update((x) => ({ ...x, enabled: e.target.checked }))} />
          <span>{s.enabled ? '켬' : '끔'}</span>
        </label>
      </div>
      <fieldset className="ag-agents-pick">
        <legend>쓰는 Agent</legend>
        {AGENTS.map((a) => (
          <label key={a.key}>
            <input
              type="checkbox"
              checked={s.agents.includes(a.key)}
              onChange={(e) => update((x) => ({ ...x, agents: e.target.checked ? [...x.agents, a.key] : x.agents.filter((k) => k !== a.key) }))}
            />
            {AGENT_SHORT[a.key]}
          </label>
        ))}
      </fieldset>

      <div className="ag-files" role="tablist" aria-label="파일">
        {files.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={file === p} onClick={() => setFile(p)} className={s.files[p] !== draft[p] ? 'is-dirty' : ''}>
            {p.replace(/^references\//, 'ref/')}
          </button>
        ))}
        {newPath == null ? (
          <button type="button" className="ag-files-add" onClick={() => setNewPath('references/')}>+ 파일</button>
        ) : (
          <form
            className="ag-files-new"
            onSubmit={(e) => {
              e.preventDefault();
              addFile();
            }}
          >
            <input autoFocus value={newPath} onChange={(e) => setNewPath(e.target.value)} aria-label="새 파일 경로" aria-invalid={!!pathErr} />
            <button type="submit" disabled={!!pathErr || !newPath.trim()}>추가</button>
            <button type="button" onClick={() => setNewPath(null)}>취소</button>
            {pathErr && <span className="ag-err">{pathErr}</span>}
          </form>
        )}
      </div>

      <textarea
        className="ag-code ag-editor-text"
        value={draft[file] ?? ''}
        onChange={(e) => {
          setDraft({ ...draft, [file]: e.target.value });
          setSaved(null);
        }}
        spellCheck={false}
        aria-label={`${s.name}/${file}`}
      />
      {problems.length > 0 && (
        <ul className="ag-problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <div className="ag-editor-foot">
        <button type="button" className="btn" disabled={!dirty || problems.length > 0} onClick={save}>저장</button>
        <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => setDraft(s.files)}>고친 것 버리기</button>
        {file !== 'SKILL.md' && (
          <button
            type="button"
            className="ag-link"
            onClick={() => {
              const { [file]: _gone, ...rest } = draft;
              void _gone;
              setDraft(rest);
            }}
          >
            이 파일 빼기
          </button>
        )}
        <span className="ag-grow" />
        {saved && !dirty && <span className="ag-ok">{saved}</span>}
        {def && s.edited && (
          <button type="button" className="ag-link" onClick={() => update((x) => commitFiles(x, def, '기본값으로'))}>기본값으로</button>
        )}
        {s.origin === 'custom' && (
          <button type="button" className="ag-link is-danger" onClick={() => window.confirm(`${s.name} 스킬을 지울까요? 이력도 함께 지워져요.`) && remove()}>스킬 지우기</button>
        )}
        <button type="button" className="ag-link" aria-expanded={showHist} onClick={() => setShowHist((v) => !v)} disabled={!s.history.length}>
          이력 {s.history.length}
        </button>
      </div>

      {showHist && s.history.length > 0 && (
        <ol className="ag-hist">
          {s.history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <span>{when(h.at)}</span>
              <span className="ag-muted">{h.note} 전 판 · 파일 {Object.keys(h.files).length}개</span>
              <button type="button" className="ag-link" onClick={() => update((x) => commitFiles(x, h.files, '되돌리기'))}>이 판으로</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

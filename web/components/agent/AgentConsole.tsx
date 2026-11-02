'use client';

// Agent 탭: 실행(채팅으로 제안서 Agent 돌리기 + 미리보기·PPT 받기) | 구성(Agent·스킬·도구·데이터·기억).
// 스킬·기억·대화는 이 브라우저(localStorage)에 둔다. 실행할 때 켠 스킬과 기억을 서버로 함께 보내고, 서버는 저장하지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EngineState } from '@/lib/deck/engine';
import type { DeckData } from '@/lib/deck/types';
import { MEMORY_KEY, SKILLS_KEY, readLS, resolveMemory, resolveSkills, toStored, writeLS, type MemoryFile, type Skill, type StoredSkill } from '@/lib/agent/store';
import { ConfigPanel } from './ConfigPanel';
import { RunPanel } from './RunPanel';

type Tab = 'run' | 'config';
export type Models = { master: string; sub: string };

export function AgentConsole({ ready, models }: { ready: boolean; models: Models }) {
  const [tab, setTab] = useState<Tab>('run');
  const [skills, setSkillsRaw] = useState<Skill[]>(() => resolveSkills(null));
  const [memory, setMemoryRaw] = useState<MemoryFile[]>(() => resolveMemory(null));
  const [loaded, setLoaded] = useState(false);
  // 실행 화면에서 연 회사(구성 → 데이터에서도 쓴다)
  const [deck, setDeck] = useState<{ state: EngineState | null; data: DeckData | null }>({ state: null, data: null });

  useEffect(() => {
    setSkillsRaw(resolveSkills(readLS<StoredSkill[]>(SKILLS_KEY)));
    setMemoryRaw(resolveMemory(readLS<MemoryFile[]>(MEMORY_KEY)));
    try {
      if (new URLSearchParams(location.search).get('tab') === 'config') setTab('config');
    } catch {
      /* 무시 */
    }
    setLoaded(true);
  }, []);

  const setSkills = useCallback((f: (s: Skill[]) => Skill[]) => {
    setSkillsRaw((prev) => {
      const next = f(prev);
      writeLS(SKILLS_KEY, toStored(next));
      return next;
    });
  }, []);
  const setMemory = useCallback((next: MemoryFile[]) => {
    setMemoryRaw(next);
    writeLS(MEMORY_KEY, next.map(({ path, body }) => ({ path, body })));
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    try {
      const u = new URL(location.href);
      if (t === 'config') u.searchParams.set('tab', 'config');
      else u.searchParams.delete('tab');
      history.replaceState(null, '', u);
    } catch {
      /* 무시 */
    }
  };

  const on = useMemo(() => skills.filter((s) => s.enabled), [skills]);

  return (
    <div className="ag">
      <div className="ag-head">
        <h1 className="page-title">Agent</h1>
        <div className="ag-tabs" role="tablist" aria-label="Agent 화면">
          {(
            [
              ['run', '실행'],
              ['config', '구성'],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} role="tab" type="button" className="dk2-tab" aria-selected={tab === k} onClick={() => go(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div hidden={tab !== 'run'}>
        <RunPanel ready={ready} skills={on} memory={memory} loaded={loaded} onDeck={setDeck} onConfig={() => go('config')} />
      </div>
      {tab === 'config' && <ConfigPanel models={models} skills={skills} setSkills={setSkills} memory={memory} setMemory={setMemory} deck={deck} />}
    </div>
  );
}

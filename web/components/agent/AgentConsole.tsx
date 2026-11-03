'use client';

// Agent 탭: 실행(제안서 Agent) | Builder(피드백 → 노하우·프롬프트 수정안) | 구성(구조·프롬프트·노하우·도구·데이터·기억).
// 프롬프트·노하우 판 이력, 작업 세션, 대화, 개발 요청, 기억은 이 브라우저(localStorage)에 둔다. 서버는 저장하지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DevRequest } from '@/lib/agent/defs';
import { ASSET_KEY, DEV_KEY, MEMORY_KEY, commit, currentOf, readLS, resolveMemory, textsOf, versionMap, writeLS, type AssetStore, type MemoryFile } from '@/lib/agent/store';
import type { EngineState } from '@/lib/deck/engine';
import type { DeckData } from '@/lib/deck/types';
import { BuilderPanel } from './BuilderPanel';
import { ConfigPanel } from './ConfigPanel';
import { RunPanel, type Handoff } from './RunPanel';

type Tab = 'run' | 'builder' | 'config';

export function AgentConsole({ ready, start, ask }: { ready: boolean; start: { corp: string; name: string } | null; ask: string | null }) {
  const [tab, setTab] = useState<Tab>('run');
  const [store, setStoreRaw] = useState<AssetStore>({});
  const [memory, setMemoryRaw] = useState<MemoryFile[]>(() => resolveMemory(null));
  const [dev, setDevRaw] = useState<DevRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deck, setDeck] = useState<{ state: EngineState | null; data: DeckData | null }>({ state: null, data: null });
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [rerun, setRerun] = useState<{ text: string; n: number } | null>(null);

  useEffect(() => {
    setStoreRaw(readLS<AssetStore>(ASSET_KEY) ?? {});
    setMemoryRaw(resolveMemory(readLS<{ path: string; body: string }[]>(MEMORY_KEY)));
    setDevRaw(readLS<DevRequest[]>(DEV_KEY) ?? []);
    try {
      const t = new URLSearchParams(location.search).get('tab');
      if (!start && !ask && (t === 'builder' || t === 'config')) setTab(t);
    } catch {
      /* 무시 */
    }
    setLoaded(true);
  }, []);

  const setStore = useCallback((f: (s: AssetStore) => AssetStore) => {
    setStoreRaw((prev) => {
      const next = f(prev);
      writeLS(ASSET_KEY, next);
      return next;
    });
  }, []);
  const setMemory = useCallback((next: MemoryFile[]) => {
    setMemoryRaw(next);
    writeLS(MEMORY_KEY, next.map(({ path, body }) => ({ path, body })));
  }, []);
  const onDev = useCallback((f: (d: DevRequest[]) => DevRequest[]) => {
    setDevRaw((prev) => {
      const next = f(prev);
      writeLS(DEV_KEY, next);
      return next;
    });
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    try {
      const u = new URL(location.href);
      if (t === 'run') u.searchParams.delete('tab');
      else u.searchParams.set('tab', t);
      history.replaceState(null, '', u);
    } catch {
      /* 무시 */
    }
  };

  const texts = useMemo(() => textsOf(store), [store]);
  const versions = useMemo(() => versionMap(store), [store]);

  const approve = useCallback(
    (asset: string, text: string, note: string) => {
      const next = commit(store, asset, text, note, 'builder');
      setStoreRaw(next);
      writeLS(ASSET_KEY, next);
      return currentOf(next, asset).v;
    },
    [store],
  );
  const addMemory = useCallback(
    (line: string) => {
      setMemory(memory.map((m) => (m.path === '/dcm-proposal-agent.md' ? { ...m, body: `${m.body.trim()}\n${line}`.trim() } : m)));
    },
    [memory, setMemory],
  );

  const builderOpen = useMemo(() => {
    const n = dev.filter((d) => d.status === 'open').length;
    return n ? String(n) : '';
  }, [dev]);

  return (
    <div className="ag">
      <div className="ag-head">
        <h1 className="page-title">Agent</h1>
        <div className="ag-tabs" role="tablist" aria-label="Agent 화면">
          {(
            [
              ['run', '실행', ''],
              ['builder', 'Builder', builderOpen],
              ['config', '구성', ''],
            ] as [Tab, string, string][]
          ).map(([k, l, n]) => (
            <button key={k} role="tab" type="button" className="dk2-tab" aria-selected={tab === k} onClick={() => go(k)}>
              {l}
              {n && <span className="ag-tab-n" title="열린 개발 요청">{n}</span>}
            </button>
          ))}
        </div>
      </div>
      <div hidden={tab !== 'run'}>
        <RunPanel
          ready={ready}
          texts={texts}
          memory={memory}
          loaded={loaded}
          onDeck={setDeck}
          onBuilder={(h) => {
            setHandoff(h);
            go('builder');
          }}
          rerun={rerun}
          start={start}
          ask={ask}
        />
      </div>
      <div hidden={tab !== 'builder'}>
        <BuilderPanel
          ready={ready}
          texts={texts}
          versions={versions}
          onApprove={approve}
          memory={memory}
          onMemory={addMemory}
          dev={dev}
          onDev={onDev}
          handoff={handoff}
          clearHandoff={() => setHandoff(null)}
          onRerun={(text) => {
            setRerun((r) => ({ text, n: (r?.n ?? 0) + 1 }));
            go('run');
          }}
        />
      </div>
      {tab === 'config' && (
        <ConfigPanel
          store={store}
          onSave={(id, text, note, by) => setStore((s) => commit(s, id, text, note, by))}
          memory={memory}
          setMemory={setMemory}
          deck={deck}
          focus={null}
        />
      )}
    </div>
  );
}

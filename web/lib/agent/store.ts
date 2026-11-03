// Agent 탭이 이 브라우저(localStorage)에 두는 것: 프롬프트·노하우 판 이력, 작업 세션·대화, Builder 대화·수정안, 개발 요청, 개인 기억.
// 저장이 막혀 있으면 화면이 열려 있는 동안만 유지한다.
import { ASSETS, DEFAULT_ASSETS, type AssetTexts } from './defs';

export const ASSET_KEY = 'agent2.assets.v1';
export const RUN_KEY = 'agent2.run.v1';
export const BUILDER_KEY = 'agent2.builder.v1';
export const DEV_KEY = 'agent2.dev.v1';
export const MEMORY_KEY = 'agent.memory.v1';

export function readLS<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
export function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

// ── 프롬프트·노하우 판 ───────────────────────────────────────────────
export type VerBy = 'default' | 'builder' | 'manual' | 'rollback';
export type Ver = { v: number; at: string; text: string; note: string; by: VerBy };
export type AssetStore = Record<string, Ver[]>; // 오래된 판부터. 고친 적 없으면 비어 있음(기본 1판)
const MAX_VERS = 30;

export const versionsOf = (store: AssetStore, id: string): Ver[] =>
  store[id]?.length ? store[id] : [{ v: 1, at: '', text: DEFAULT_ASSETS[id] ?? '', note: '기본', by: 'default' }];
export const currentOf = (store: AssetStore, id: string) => versionsOf(store, id)[versionsOf(store, id).length - 1];
export const textsOf = (store: AssetStore): AssetTexts => Object.fromEntries(ASSETS.map((a) => [a.id, currentOf(store, a.id).text]));
export const versionMap = (store: AssetStore): Record<string, number> => Object.fromEntries(ASSETS.map((a) => [a.id, currentOf(store, a.id).v]));

export function commit(store: AssetStore, id: string, text: string, note: string, by: VerBy): AssetStore {
  const vs = versionsOf(store, id);
  const last = vs[vs.length - 1];
  if (last.text === text) return store;
  return { ...store, [id]: [...vs, { v: last.v + 1, at: new Date().toISOString(), text, note: note.slice(0, 160), by }].slice(-MAX_VERS) };
}
export const BY_LABEL: Record<VerBy, string> = { default: '기본', builder: 'Builder', manual: '직접 수정', rollback: '되돌림' };

// ── 개인 기억 ────────────────────────────────────────────────────────
export type MemoryFile = { path: string; title: string; body: string };
export const DEFAULT_MEMORY: MemoryFile[] = [
  { path: '/common.md', title: '공통', body: '- [프로필] 위승종 대리, Technology Industry부 RA\n- [선호] 보고 문구는 개조식, 명사형으로 끝낸다.' },
  {
    path: '/dcm-proposal-agent.md', title: '제안서 Agent',
    body: '- [승인] DM 자료(Ⅱ부 시장 동향 장표)를 바꿀 때는 나에게 먼저 승인 요청을 보낸다.\n- [선호] 초안이 나오면 확인할 곳부터 채팅으로 알려 준다.',
  },
  { path: '/work.md', title: '업무', body: '- [담당] IT·반도체 섹터, A급 이상 발행사\n- [메모] (예시) 이 회사 재무팀은 납입일을 월초로 잡길 원한다.' },
];
export const resolveMemory = (stored: { path: string; body: string }[] | null): MemoryFile[] =>
  DEFAULT_MEMORY.map((d) => ({ ...d, body: stored?.find((s) => s.path === d.path)?.body ?? d.body }));
export const memoryText = (m: MemoryFile[]) => m.map((f) => `## ${f.title} (${f.path})\n${f.body.trim()}`).join('\n\n');

export const when = (iso: string) => {
  if (!iso) return '–';
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

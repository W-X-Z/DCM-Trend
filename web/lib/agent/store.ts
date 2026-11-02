// Agent 탭이 이 브라우저(localStorage)에 두는 것: 스킬(편집본·이력·켬/끔), 개인 기억, 대화.
// 저장이 막혀 있으면 화면이 열려 있는 동안만 유지한다.
import { AGENTS, DEFAULT_MEMORY, DEFAULT_SKILLS, skillMeta, type AgentKey, type SkillFiles } from './config';

export type SkillVer = { at: string; files: SkillFiles; note: string };
export type StoredSkill = {
  name: string;
  origin: 'default' | 'custom';
  enabled: boolean;
  agents: AgentKey[];
  files: SkillFiles | null; // 기본 스킬을 고치지 않았으면 null(배포된 최신 기본값을 쓴다)
  history: SkillVer[];
};
export type Skill = Omit<StoredSkill, 'files'> & { files: SkillFiles; edited: boolean };

export const SKILLS_KEY = 'agent.skills.v1';
export const MEMORY_KEY = 'agent.memory.v1';
export const RUN_KEY = 'agent.run.v1';
const HISTORY_MAX = 15;

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

const defaultAgents = (name: string): AgentKey[] => AGENTS.filter((a) => a.skills.includes(name)).map((a) => a.key);
const DEF = new Map(DEFAULT_SKILLS.map((s) => [s.name, s.files]));

export function seedSkills(): StoredSkill[] {
  return DEFAULT_SKILLS.map((s) => ({ name: s.name, origin: 'default', enabled: true, agents: defaultAgents(s.name), files: null, history: [] }));
}

// 저장본 + 지금 배포된 기본값 → 화면에서 쓰는 스킬 목록 (기본 스킬이 새로 생기면 뒤에 붙는다)
export function resolveSkills(stored: StoredSkill[] | null): Skill[] {
  const list = stored?.length ? stored : seedSkills();
  const have = new Set(list.map((s) => s.name));
  const extra = seedSkills().filter((s) => !have.has(s.name));
  return [...list, ...extra]
    .filter((s) => s.origin === 'custom' || DEF.has(s.name))
    .map((s) => {
      const files = s.files ?? DEF.get(s.name) ?? { 'SKILL.md': '' };
      return { ...s, files, edited: s.origin === 'default' && s.files != null };
    });
}
export const toStored = (list: Skill[]): StoredSkill[] =>
  list.map(({ edited, files, ...s }) => ({ ...s, files: s.origin === 'default' && !edited ? null : files }));

export const defaultFiles = (name: string) => DEF.get(name) ?? null;
export const sameFiles = (a: SkillFiles, b: SkillFiles) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// 파일을 바꾸면 바꾸기 전 판을 이력에 남긴다
export function commitFiles(s: Skill, files: SkillFiles, note: string): Skill {
  if (sameFiles(s.files, files)) return s;
  const history = [{ at: new Date().toISOString(), files: s.files, note }, ...s.history].slice(0, HISTORY_MAX);
  const def = s.origin === 'default' ? defaultFiles(s.name) : null;
  return { ...s, files, history, edited: s.origin === 'default' && !(def && sameFiles(def, files)) };
}

// SKILL.md 검사: 머리말(name·description), 이름 규칙
export const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
export function skillProblems(name: string, files: SkillFiles): string[] {
  const out: string[] = [];
  const md = files['SKILL.md'];
  if (md == null) return ['SKILL.md 가 없어요.'];
  if (!/^---\n[\s\S]*?\n---/.test(md)) out.push('SKILL.md 맨 앞에 --- 로 감싼 머리말(name, description)이 있어야 해요.');
  const m = skillMeta(files);
  if (!m.name) out.push('머리말에 name 이 없어요.');
  else if (m.name !== name) out.push(`머리말 name(${m.name})이 스킬 이름(${name})과 달라요.`);
  if (!m.description) out.push('머리말에 description 이 없어요. Agent 는 이 설명을 보고 스킬을 읽을지 정해요.');
  else if (m.description.length > 1024) out.push('description 은 1,024자 이하로 써 주세요.');
  return out;
}

export const newSkillFiles = (name: string): SkillFiles => ({
  'SKILL.md': `---\nname: ${name}\ndescription: 이 스킬이 하는 일과 언제 읽어야 하는지 한두 문장으로 쓴다.\n---\n\n# ${name}\n\n## 언제 쓰나\n\n- \n\n## 방법\n\n1. \n`,
});

// 기억
export type MemoryFile = { path: string; title: string; body: string };
export const resolveMemory = (stored: MemoryFile[] | null): MemoryFile[] =>
  DEFAULT_MEMORY.map((d) => ({ ...d, body: stored?.find((s) => s.path === d.path)?.body ?? d.body }));
export const memoryText = (m: MemoryFile[]) => m.map((f) => `## ${f.title} (${f.path})\n${f.body.trim()}`).join('\n\n');

// lib/agent/skills/<스킬>/**.md → lib/agent/skills.json (Agent 탭 기본 스킬). 스킬 md 를 고친 뒤 실행: node scripts/gen-agent-skills.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'agent', 'skills');
const ORDER = ['dcm-deck-engine', 'dcm-proposal-playbook', 'dcm-data-guide'];
const rank = (n) => (ORDER.includes(n) ? ORDER.indexOf(n) : 99);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const skills = readdirSync(root)
  .filter((n) => statSync(join(root, n)).isDirectory())
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  .map((name) => {
    const files = Object.fromEntries(
      walk(join(root, name))
        .map((f) => [relative(join(root, name), f).split('\\').join('/'), readFileSync(f, 'utf8')])
        .sort(([a], [b]) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b))),
    );
    return { name, files };
  });
writeFileSync(join(root, '..', 'skills.json'), `${JSON.stringify(skills, null, 1)}\n`);
console.log(skills.map((s) => `${s.name}(${Object.keys(s.files).length})`).join(' '));

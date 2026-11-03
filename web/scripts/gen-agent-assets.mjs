// lib/agent/assets/{knowhow,prompts}/**.md → lib/agent/assets.json (Agent 탭 기본 프롬프트·노하우). md 를 고친 뒤 실행: node scripts/gen-agent-assets.mjs
// id: knowhow/deal.md → 'knowhow.deal', prompts/dcm/master.md → 'dcm.master', prompts/builder/master.md → 'builder.master'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'agent', 'assets');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const out = {};
for (const f of walk(root).filter((x) => x.endsWith('.md')).sort()) {
  const rel = relative(root, f).split('\\').join('/').replace(/\.md$/, '');
  const id = rel.startsWith('prompts/') ? rel.slice('prompts/'.length).replace('/', '.') : rel.replace('/', '.');
  out[id] = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trimEnd() + '\n';
}
writeFileSync(join(root, '..', 'assets.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(Object.keys(out).join(' '));

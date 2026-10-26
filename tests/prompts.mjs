// 배치 AI 프롬프트와 웹 '작동 방식' 화면 사본이 같은지 확인한다 (다르면 npm run prompts:sync)
import { readFileSync } from 'node:fs';
import { OUT, generated } from '../scripts/sync-prompts.mjs';

const ok = readFileSync(OUT, 'utf8') === generated();
console.log(ok ? 'ok   프롬프트 사본이 최신' : 'FAIL 프롬프트 사본이 오래됨: npm run prompts:sync');
console.log(`\n${ok ? 1 : 0}/1 passed`);
process.exit(ok ? 0 : 1);

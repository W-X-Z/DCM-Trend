// 배치 AI(ingest)의 시스템 프롬프트를 웹 '작동 방식' 화면용 파일로 옮긴다.
// 웹(Vercel)은 web/ 만 배포하므로 ingest/ 를 직접 읽을 수 없다. 프롬프트를 고치면 `npm run prompts:sync` 를 돌린다.
// tests/prompts.mjs 가 두 쪽이 같은지 확인한다.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as feed from '../ingest/lib/feed.mjs';
import * as insights from '../ingest/lib/insights.mjs';
import * as issues from '../ingest/lib/issues.mjs';

export function generated() {
  const items = {
    feed: { version: feed.PROMPT_VERSION, system: feed.SYSTEM },
    insights: { version: insights.PROMPT_VERSION, system: insights.SYSTEM },
    issues: { version: issues.PROMPT_VERSION, system: issues.SYSTEM },
  };
  return `// 자동 생성: scripts/sync-prompts.mjs (직접 고치지 않는다)\nexport const BATCH_PROMPTS = ${JSON.stringify(items, null, 2)} as const;\n`;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(root, 'web', 'lib', 'llm', 'prompts.generated.ts');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, generated());
  console.log('wrote', OUT);
}

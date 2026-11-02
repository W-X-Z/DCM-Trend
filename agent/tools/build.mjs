// dcm.cjs 묶기: node agent/tools/build.mjs <출력 경로>
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const outfile = process.argv[2] ?? join(here, 'dist', 'dcm.cjs');
await build({
  entryPoints: [join(here, 'cli.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node18', outfile,
  tsconfig: join(here, '..', '..', 'web', 'tsconfig.json'),
  nodePaths: [join(here, '..', '..', 'web', 'node_modules')],
  loader: { '.json': 'json' }, legalComments: 'none', minify: true, logLevel: 'warning',
  banner: { js: '// dcm — NH 공모 회사채 제안서 엔진 (web/lib/deck 묶음). 소스: agent/tools/cli.ts' },
});
console.log('built', outfile);

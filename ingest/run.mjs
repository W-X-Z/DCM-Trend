// 수집 실행 진입점
//
//   node ingest/run.mjs probe
//   node ingest/run.mjs corp-codes
//   node ingest/run.mjs filings  --from 2026-09-01 --to 2026-09-30
//   node ingest/run.mjs details  [--max-groups 500]
//   node ingest/run.mjs refresh
//   node ingest/run.mjs daily                     최근 7일 공시 → 상세 → 변환
//   node ingest/run.mjs backfill --from 2024-10-01 --to 2026-10-15
//   node ingest/run.mjs history                   과거 백필: 회사채 신고서 2019~, 메자닌 결정 2021~ (해당 공시만 저장)
//   node ingest/run.mjs periodic [--max-calls-step 3000]   정기보고서 미상환 잔액 (회사채·CP·단기사채)
//   node ingest/run.mjs documents [--rcept-nos a,b]       신고서 원문 (지정 공시 또는 ref 규칙 대기 목록)
//   node ingest/run.mjs rates                     한국은행 ECOS 금리 (ECOS_API_KEY 없으면 건너뜀)
//   node ingest/run.mjs --config ingest/dev.config.json   (config 의 steps 를 차례로 실행)
//
// 공통 옵션: --max-calls N (이번 실행의 OpenDART 호출 상한, 기본 15000)
// 환경변수: OPENDART_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ECOS_API_KEY(선택)

import { readFileSync } from 'node:fs';
import { Dart, DartStopError } from './lib/dart.mjs';
import { Db } from './lib/db.mjs';
import {
  probe, corpCodes, filings, details, refresh, periodic, documents, rates, todayKst, addDays,
} from './lib/jobs.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = argv[i + 1];
      i++;
    } else out._.push(a);
  }
  return out;
}

let args = parseArgs(process.argv.slice(2));
if (args.config) args = { ...JSON.parse(readFileSync(args.config, 'utf8')), ...args, _: args._ };
const command = args._[0] ?? args.command;

const dart = new Dart({ key: process.env.OPENDART_API_KEY, maxCalls: Number(args.maxCalls ?? 15000) });
const db = new Db({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const env = { dart, db };

async function stats(label) {
  const s = await db.rpc('ingest_stats');
  console.log(`[${label}] ${JSON.stringify(s)}`);
  return s;
}

const HISTORY = {
  bond: { from: '2019-01-01', to: '2024-09-30', types: [{ ty: 'C' }], include: '증권신고서\\(채무증권\\)' },
  mezz: { from: '2021-01-01', to: '2024-09-30', types: [{ ty: 'B', detail: 'B001' }], include: '(전환사채권|신주인수권부사채권|교환사채권)\\s*발행\\s*결정' },
};

async function run(command, opts) {
  const today = todayKst();
  switch (command) {
    case 'probe':      return probe(env);
    case 'corp-codes': return corpCodes(env);
    case 'filings':    return filings(env, { from: opts.from, to: opts.to ?? today });
    case 'details':    return details(env, { maxGroups: Number(opts.maxGroups ?? 100000) });
    case 'refresh':    return refresh(env);
    case 'periodic':   return periodic(env, { maxCalls: Number(opts.maxCallsStep ?? 3000) });
    case 'documents':  return documents(env, {
      rceptNos: opts.rceptNos ? [].concat(opts.rceptNos).join(',').split(',').filter(Boolean) : null,
      maxDocs: Number(opts.maxDocs ?? 500),
    });
    case 'rates':      return rates(env);

    case 'history': {
      await probe(env);
      await filings(env, HISTORY.bond);
      await filings(env, HISTORY.mezz);
      await details(env);
      await refresh(env);
      return stats('after');
    }

    case 'sequence': {
      for (const step of opts.steps ?? []) {
        console.log(`== ${step.command} ==`);
        await run(step.command, { ...step });
      }
      return stats('after');
    }

    case 'daily': {
      await probe(env);
      const s = await stats('before');
      if (s.corp_codes < 1000 || new Date().getUTCDay() === 1) await corpCodes(env);   // 매주 월요일 갱신
      await filings(env, { from: addDays(today, -7), to: today });
      await details(env);
      await refresh(env);
      await periodic(env, { maxCalls: 2000 }).catch((e) => console.error(`periodic: ${e.message}`));
      await documents(env, { maxDocs: 300 }).catch((e) => console.error(`documents: ${e.message}`));
      await rates(env).catch((e) => console.error(`rates: ${e.message}`));
      await refresh(env);
      return stats('after');
    }

    case 'backfill': {
      if (!opts.from) throw new Error('--from 이 필요합니다');
      await probe(env);
      const s = await stats('before');
      if (s.corp_codes < 1000) await corpCodes(env);
      await filings(env, { from: opts.from, to: opts.to ?? today });
      await details(env);
      await refresh(env);
      return stats('after');
    }

    case 'dev': {
      // 개발 브랜치 검증용: 최근 N일만 소량 수집
      const days = Number(opts.days ?? 31);
      await probe(env);
      const s = await stats('before');
      if (s.corp_codes < 1000) await corpCodes(env);
      await filings(env, { from: addDays(today, -days), to: today });
      await details(env, { maxGroups: Number(opts.maxGroups ?? 400) });
      await refresh(env);
      return stats('after');
    }

    default:
      throw new Error(`알 수 없는 명령: ${command}`);
  }
}

async function main() {
  return run(command, args);
}

main().catch((e) => {
  console.error(e instanceof DartStopError ? `중단: ${e.message}` : e.stack ?? e.message);
  process.exit(1);
});

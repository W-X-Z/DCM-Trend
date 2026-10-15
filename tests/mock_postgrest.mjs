// 화면 개발용 모의 Supabase REST (PGlite + PostgREST 일부 문법).
// 마이그레이션 전체 + 실제 API 샘플 + 가상 딜(SYN_)을 넣고 mart 를 anon 권한으로 연다.
// 가상 딜은 화면 확인용이다. 운영 DB 에는 넣지 않는다.
//
// 실행: node tests/mock_postgrest.mjs [--port 54321]
// 화면: cd web && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=dev npm run dev

import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 54321) || 54321;

const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
const migDir = join(root, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'));
}

// 1) 실제 API 샘플 → 수집 RPC → 변환 -----------------------------------------
const fx = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'dart_api_sample_202609.json'), 'utf8'));
await db.exec('set role service_role');
const runId = (await db.query(`select public.ingest_start_run('mock') as id`)).rows[0].id;
await db.query(`select public.ingest_put_filings($1, $2::jsonb)`, [runId, JSON.stringify(fx.filings)]);
const groups = new Map();
for (const it of fx.items) {
  const k = `${it.endpoint}|${it.corp_code}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push({ group_title: it.group_title, item: it.item });
}
for (const [k, items] of groups) {
  const [endpoint, corp] = k.split('|');
  await db.query(`select public.ingest_put_api_items($1, $2, $3, '000', $4::jsonb, $5::text[])`,
    [runId, endpoint, corp, JSON.stringify(items), `{${[...new Set(items.map((i) => i.item.rcept_no))].join(',')}}`]);
}
await db.query(`select public.ingest_refresh()`);
await db.query(`select public.ingest_finish_run($1, 'success', 0, 0, 0, null)`, [runId]);
await db.query(`insert into ops.ingest_runs (job, status, started_at, finished_at) values ('refresh', 'success', now(), now())`).catch(() => {});
await db.exec('reset role');

// 2) 가상 딜 (화면 확인용) ---------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const pre = ['한빛', '가람', '새온', '다온', '누리', '미르', '하람', '온빛', '청솔', '라온', '솔빛', '해든'];
const suf = ['전자', '화학', '에너지', '건설', '캐피탈', '물산', '바이오', '소재', '리테일', '모빌리티'];
const corps = [];
for (let i = 0; i < 72; i++) {
  const name = `${pre[i % pre.length]}${suf[Math.floor(i / pre.length) % suf.length]}`;
  corps.push({ code: `SYN_${String(i).padStart(3, '0')}`, name, market: pick(['유가증권', '유가증권', '코스닥', '코스닥', '기타']) });
}
const firms = ['NH투자증권', 'KB증권', '한국투자증권', '삼성증권', '미래에셋증권', '신한투자증권', '키움증권', 'SK증권', '대신증권'];
const today = new Date();
const sql = [];
const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

sql.push(`insert into core.companies (corp_code, corp_name, market) values ${corps.map((c) => `(${q(c.code)}, ${q(c.name)}, ${q(c.market)})`).join(',')};`);
let n = 0;
for (let back = 24; back >= 0; back--) {
  const y = today.getUTCFullYear();
  const mo = today.getUTCMonth() - back;
  const day = (d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);
  const maxDay = back === 0 ? Math.min(today.getUTCDate() + 6, 28) : 28;
  // 회사채
  for (let i = 0, k = between(28, 52); i < k; i++) {
    const c = pick(corps);
    const key = `bond:${c.code}:${++n}`;
    const amt = between(3, 30) * 1e10;
    const inc = rnd() < 0.25;
    const tenor = pick([24, 36, 36, 60, 12]);
    const cat = c.name.endsWith('캐피탈') ? '금융채' : rnd() < 0.06 ? '신종자본증권' : '일반회사채';
    const pay = day(between(2, maxDay));
    sql.push(`insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status, announce_dt, pricing_dt, payment_dt, amount_krw, initial_amount_krw, latest_rcept_no)
      values (${q(key)}, 'bond', ${q(cat)}, ${q(c.code)}, ${q(`${between(10, 120)}-${between(1, 2)}`)}, true, 'completed', ${q(pay)}::date - 14, ${q(pay)}::date - 7, ${q(pay)}, ${amt}, ${inc ? amt * 0.6 : amt}, null);`);
    sql.push(`insert into core.bond_terms (deal_key, tenor_months) values (${q(key)}, ${tenor});`);
    const lead = pick(firms);
    sql.push(`insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw) values (${q(key)}, ${q(lead)}, ${q(lead)}, '대표주관', '총액인수', ${amt * 0.6}, ${Math.round(amt * 0.6 * between(10, 32) / 1e4)});`);
    const co = pick(firms.filter((f) => f !== lead));
    sql.push(`insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw) values (${q(key)}, ${q(co)}, ${q(co)}, '인수', '총액인수', ${amt * 0.4}, ${Math.round(amt * 0.4 * between(10, 30) / 1e4)});`);
  }
  // 메자닌
  for (let i = 0, k = between(30, 70); i < k; i++) {
    const c = pick(corps.filter((x) => x.market !== '기타'));
    const kind = rnd() < 0.72 ? 'CB' : rnd() < 0.5 ? 'BW' : 'EB';
    const key = `mezz:${c.code}:${kind}-${++n}`;
    const amt = between(3, 50) * 1e9;
    const pub = rnd() < 0.06;
    const zero = rnd() < 0.45;
    const cp = between(3000, 40000);
    sql.push(`insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status, announce_dt, payment_dt, amount_krw, initial_amount_krw)
      values (${q(key)}, 'mezz', ${q(kind)}, ${q(c.code)}, ${q(String(between(1, 30)))}, ${pub}, 'completed', ${q(day(between(1, maxDay)))}, null, ${amt}, ${amt});`);
    sql.push(`insert into core.mezz_terms (deal_key, coupon_pct, ytm_pct, conv_price, refix_floor_price, shares_ratio_pct, lead_manager)
      values (${q(key)}, ${zero ? 0 : between(0, 30) / 10}, ${zero ? 0 : between(10, 70) / 10}, ${cp}, ${Math.round(cp * pick([0.7, 0.7, 0.8, 0.9]))}, ${between(15, 220) / 10}, ${pub ? q(pick(firms)) : 'null'});`);
  }
  // 유상증자
  for (let i = 0, k = between(8, 22); i < k; i++) {
    const c = pick(corps.filter((x) => x.market !== '기타'));
    const key = `equity:${c.code}:${++n}`;
    const method = pick(['제3자배정', '제3자배정', '주주배정후 일반공모', '일반공모', '주주배정']);
    const amt = between(2, 120) * 1e9;
    sql.push(`insert into core.deals (deal_key, product_type, sub_type, corp_code, is_public, status, announce_dt, amount_krw, initial_amount_krw)
      values (${q(key)}, 'equity', ${q(method)}, ${q(c.code)}, ${method !== '제3자배정'}, 'completed', ${q(day(between(1, maxDay)))}, ${amt}, ${amt});`);
    const uw = method === '제3자배정' ? null : pick(['총액인수', '잔액인수']);
    sql.push(`insert into core.equity_terms (deal_key, dilution_pct, offer_price, underwriting_method) values (${q(key)}, ${between(20, 450) / 10}, ${between(1000, 30000)}, ${q(uw)});`);
    if (uw) {
      const lead = pick(firms);
      sql.push(`insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw) values (${q(key)}, ${q(lead)}, ${q(lead)}, '대표주관', ${q(uw)}, ${amt}, ${Math.round(amt * between(150, 350) / 1e4)});`);
    }
  }
}
await db.exec(sql.join('\n'));
console.log(`mock: 가상 딜 ${n}건 적재`);

// 3) PostgREST 일부 문법 ---------------------------------------------------
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return s;
};
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };

function cond(col, expr, params) {
  let not = false;
  if (expr.startsWith('not.')) { not = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  let s;
  if (op === 'is') s = `${ident(col)} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
  else if (op === 'in') {
    const items = val.replace(/^\(|\)$/g, '').match(/"[^"]*"|[^,]+/g) ?? [];
    const ph = items.map((v) => { params.push(v.replace(/^"|"$/g, '')); return `$${params.length}`; });
    s = `${ident(col)}::text in (${ph.join(',') || 'null'})`;
  } else if (OPS[op]) {
    params.push(op.endsWith('like') ? val.replaceAll('*', '%') : val);
    s = `${ident(col)}::text ${OPS[op]} $${params.length}`;
    if (['gt', 'gte', 'lt', 'lte'].includes(op)) s = `${ident(col)} ${OPS[op]} $${params.length}`;
  } else throw new Error(`unsupported op ${op}`);
  return not ? `not (${s})` : s;
}

async function handleSelect(view, sp) {
  const params = [];
  const where = [];
  let order = '';
  let limit = '';
  let offset = '';
  const select = (sp.get('select') ?? '*') === '*' ? '*' : sp.get('select').split(',').map(ident).join(',');
  for (const [k, v] of sp) {
    if (k === 'select') continue;
    if (k === 'order') {
      order = 'order by ' + v.split(',').map((p) => {
        const [c, ...mods] = p.split('.');
        return `${ident(c)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullslast') ? ' nulls last' : mods.includes('nullsfirst') ? ' nulls first' : ''}`;
      }).join(', ');
    } else if (k === 'limit') limit = `limit ${Number(v)}`;
    else if (k === 'offset') offset = `offset ${Number(v)}`;
    else if (k === 'or') {
      const parts = v.replace(/^\(|\)$/g, '').split(',');
      where.push(`(${parts.map((p) => { const i = p.indexOf('.'); return cond(p.slice(0, i), p.slice(i + 1), params); }).join(' or ')})`);
    } else where.push(cond(k, v, params));
  }
  const sqlText = `select coalesce(json_agg(t), '[]'::json) as j from (select ${select} from mart.${ident(view)} ${where.length ? 'where ' + where.join(' and ') : ''} ${order} ${limit} ${offset}) t`;
  return (await db.query(sqlText, params)).rows[0].j;
}

async function handleRpc(fn, args) {
  const meta = (await db.query(
    `select p.proretset, coalesce(p.proargnames, '{}') as names,
            coalesce((select array_agg(format_type(t, null)) from unnest(p.proargtypes) t), '{}') as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'mart' and p.proname = $1`, [ident(fn)])).rows[0];
  if (!meta) throw new Error(`no function mart.${fn}`);
  const names = Object.keys(args);
  const params = names.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
  const argSql = names.map((k, i) => `${ident(k)} => $${i + 1}::${meta.types[meta.names.indexOf(k)]}`).join(', ');
  const sqlText = meta.proretset
    ? `select coalesce(json_agg(t), '[]'::json) as j from mart.${fn}(${argSql}) t`
    : `select to_json(mart.${fn}(${argSql})) as j`;
  return (await db.query(sqlText, params)).rows[0].j;
}

let busy = Promise.resolve();
const server = http.createServer((req, res) => {
  busy = busy.then(async () => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    res.setHeader('content-type', 'application/json');
    const t0 = Date.now();
    try {
      await db.exec('set role anon');
      let out;
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      const view = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
      if (rpc) out = await handleRpc(rpc[1], body ? JSON.parse(body) : {});
      else if (view) out = await handleSelect(view[1], url.searchParams);
      else { res.statusCode = 404; out = { message: 'not found' }; }
      res.end(JSON.stringify(out));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: e.message }));
    } finally {
      await db.exec('reset role');
      console.log(`${res.statusCode} ${req.method} ${decodeURIComponent(url.pathname + url.search).slice(0, 140)} ${Date.now() - t0}ms`);
    }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`mock PostgREST http://127.0.0.1:${port}`));

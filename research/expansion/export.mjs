// 사업 확장 기업 스냅샷 내보내기 (개인 투자 아이디어 분석용)
//
//   node research/expansion/export.mjs --from-web https://ib-deal-agent.vercel.app   (키 없이, 웹의 공개 JSON)
//   SUPABASE_URL=... SUPABASE_KEY=<anon 키> node research/expansion/export.mjs         (DB 에서 바로)
//   node research/expansion/export.mjs --from-json data.json                           (/api/expansion/data 와 같은 형식 파일)
//   공통: [--out research/expansion/data]
//
// 읽는 곳: 웹 /api/expansion/data, 또는 Supabase mart.v_expansion_companies / v_expansion_events / v_company_overview
// 쓰는 곳: companies.csv, events.csv (엑셀용 UTF-8 BOM), summary.md, meta.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = opt('--out') ?? 'research/expansion/data';
const fromWeb = (opt('--from-web') ?? process.env.EXPANSION_WEB_URL ?? '').replace(/\/$/, '');
const fromJson = opt('--from-json');
const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.SUPABASE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
if (!fromWeb && !fromJson && (!base || !key)) {
  console.error('--from-web <웹 주소>, --from-json <파일>, 또는 SUPABASE_URL·SUPABASE_KEY(anon 키)가 필요합니다');
  process.exit(1);
}
const headers = { apikey: key, 'Accept-Profile': 'mart' };
if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

async function fromWebJson() {
  // 웹 함수가 막 깨어날 때(콜드 스타트) 첫 호출이 500 으로 끝나는 일이 있어 세 번까지 다시 부른다
  let res;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 5000 * i));
    res = await fetch(`${fromWeb}/api/expansion/data`, { signal: AbortSignal.timeout(120_000) });
    if (res.ok || res.status < 500) break;
  }
  if (!res.ok) throw new Error(`${fromWeb}/api/expansion/data ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  if (!Array.isArray(body.companies) || !Array.isArray(body.events)) throw new Error('응답 형식이 다릅니다');
  return body;
}

async function selectAll(view, params = {}) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${base}/rest/v1/${view}`);
    for (const [k, v] of Object.entries({ select: '*', ...params, limit: 1000, offset })) url.searchParams.set(k, String(v));
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${view} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const eok = (v) => (v == null ? '' : Math.round(Number(v) / 1e8));
const pct = (v) => (v == null ? '' : Number(v).toFixed(1));
const cell = (v) => {
  const s = v == null ? '' : String(v).replace(/\s*\n\s*/g, ' ').trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) => `\uFEFF${[header, ...rows].map((r) => r.map(cell).join(',')).join('\n')}\n`;
const won = (v) => {
  if (v == null) return '–';
  const e = Number(v) / 1e8;
  return e >= 10000 ? `${(e / 10000).toFixed(e >= 100000 ? 1 : 2)}조` : `${Math.round(e).toLocaleString('ko-KR')}억`;
};
const md = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim();
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '');

let companies;
let events;
const stock = new Map();
if (fromWeb || fromJson) {
  const body = fromJson ? JSON.parse(readFileSync(fromJson, 'utf8')) : await fromWebJson();
  if (!Array.isArray(body.companies) || !Array.isArray(body.events)) throw new Error('companies·events 배열이 없습니다');
  companies = body.companies;
  events = body.events;
  for (const [k, v] of Object.entries(body.stocks ?? {})) stock.set(k, v ?? '');
} else {
  [companies, events] = await Promise.all([
    selectAll('v_expansion_companies', { order: 'amount_krw.desc.nullslast,corp_code.asc' }),
    selectAll('v_expansion_events', { order: 'corp_name.asc,decided_dt.desc,rcept_no.desc' }),
  ]);
  const codes = [...new Set(companies.map((c) => c.corp_code))];
  for (let i = 0; i < codes.length; i += 80) {
    const part = await selectAll('v_company_overview', { select: 'corp_code,stock_code', corp_code: `in.(${codes.slice(i, i + 80).join(',')})` });
    for (const r of part) stock.set(r.corp_code, r.stock_code ?? '');
  }
}
// 정렬을 고정해 매주 diff 가 실제 변화만 보이게 한다 (원천에 상관없이 같은 순서)
const num0 = (v) => (v == null ? -Infinity : Number(v));
companies.sort((a, b) => num0(b.amount_krw) - num0(a.amount_krw) || String(a.corp_code).localeCompare(String(b.corp_code)));
events.sort((a, b) => String(a.corp_name).localeCompare(String(b.corp_name), 'ko')
  || String(b.decided_dt).localeCompare(String(a.decided_dt)) || String(b.rcept_no).localeCompare(String(a.rcept_no)));
const asof = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const fundText = (f) => {
  const list = (f ?? []).map((x) => `${x.type} ${won(x.amount_krw)}(${String(x.dt).slice(0, 10)})`);
  return list.length > 5 ? `${list.slice(0, 5).join(' / ')} 외 ${list.length - 5}건` : list.join(' / ');
};

mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'companies.csv'), csv(
  ['종목코드', '회사', '시장', '최근 회사채 등급', '확장 유형', '최근 1년 새 결정', '확장 공시 수', '확장 금액(억원)', '최대 규모 비율(%)', '비율 기준',
    '첫 결정일', '최근 결정일', '마지막 투자 종료일', '가장 큰 결정(공시)', '가장 큰 결정(억원)', '가장 큰 결정 내용', '최근 1년 공시 조달', '결정 후 조달 없음', 'NH 대표주관 이력', 'DART 회사코드'],
  companies.map((c) => [
    stock.get(c.corp_code) ?? '', c.corp_name, c.market ?? '비상장', c.latest_bond_rating ?? '', (c.cats ?? []).join(' / '),
    c.has_new_decision ? 'Y' : '진행 중', c.event_count, eok(c.amount_krw), pct(c.max_ratio_pct), c.max_ratio_basis ?? '',
    c.first_dt, c.last_dt, c.last_end_dt ?? '', c.top_src, eok(c.top_amount_krw), c.top_what ?? '', fundText(c.funding),
    c.no_funding_after ? 'Y' : '', c.nh_lead_ever ? 'Y' : '', c.corp_code,
  ]),
));

writeFileSync(join(outDir, 'events.csv'), csv(
  ['종목코드', '회사', '시장', '결정일', '공시일', '정정 공시(진행 중)', '투자 종료일', '공시 종류', '확장 유형', '금액(억원)', '규모 비율(%)', '비율 기준',
    '목적', '대상', '세부(자산 구분·대상 회사 사업)', '인수 후 지분(%)', '자금 조달', '접수번호', '원문'],
  events.map((e) => [
    stock.get(e.corp_code) ?? '', e.corp_name, e.market ?? '비상장', e.decided_dt, e.rcept_dt, e.is_amendment ? 'Y' : '', e.end_dt ?? '',
    `${e.src_label}${e.via_sub ? '(자회사)' : ''}`, e.cat, eok(e.amount_krw), pct(e.ratio_pct), e.ratio_basis, e.purpose ?? '', e.target ?? '', e.detail ?? '',
    e.stake_after_pct ?? '', e.funding_note ?? '', e.rcept_no, e.dart_url,
  ]),
));

// 요약: 유형·시장별 수, 금액 상위, 규모 비율 상위(새 결정), 결정 후 조달 없음 + 규모 비율 30% 이상
const CATS = ['생산·설비 증설', '부지·사업장 확보', '인수·신사업', '연구·업무시설'];
const byCat = CATS.map((k) => [k, companies.filter((c) => (c.cats ?? []).includes(k)).length]);
const mkts = {};
for (const c of companies) mkts[c.market ?? '비상장'] = (mkts[c.market ?? '비상장'] ?? 0) + 1;
const row = (c) => `| ${stock.get(c.corp_code) || '–'} | ${md(c.corp_name)} | ${c.market ?? '비상장'} | ${(c.cats ?? []).join(', ')} | ${won(c.amount_krw)} | ${c.max_ratio_pct == null ? '–' : `${pct(c.max_ratio_pct)}% (${c.max_ratio_basis})`} | ${c.last_dt} | ${md(clip(c.top_what, 48))} |`;
const head = '| 종목코드 | 회사 | 시장 | 유형 | 확장 금액 | 최대 규모 비율 | 최근 결정 | 가장 큰 결정 |\n|---|---|---|---|---:|---:|---|---|';
const fresh = companies.filter((c) => c.has_new_decision);
const byRatio = [...fresh].filter((c) => c.max_ratio_pct != null).sort((a, b) => Number(b.max_ratio_pct) - Number(a.max_ratio_pct));
const gapBig = fresh.filter((c) => c.no_funding_after && Number(c.max_ratio_pct ?? 0) >= 30)
  .sort((a, b) => Number(b.max_ratio_pct) - Number(a.max_ratio_pct));

const summary = `# 사업 확장 기업 요약 (${asof})

자동 생성 파일입니다(\`research/expansion/export.mjs\`). 기준과 열 설명은 [README](../README.md)를 보세요.

- 기업 ${companies.length}곳 (최근 1년 새 결정 ${fresh.length}곳, 이전 결정 진행 중 ${companies.length - fresh.length}곳), 확장 공시 ${events.length}건, 금액 합계 ${won(companies.reduce((s, c) => s + Number(c.amount_krw ?? 0), 0))}
- 유형별: ${byCat.map(([k, n]) => `${k} ${n}곳`).join(', ')} (한 기업이 여러 유형일 수 있음)
- 시장별: ${Object.entries(mkts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}곳`).join(', ')}
- 결정 후 공시된 조달(공모채·메자닌·유상증자·IPO)이 없는 기업 ${companies.filter((c) => c.no_funding_after).length}곳

## 확장 금액 상위 20

${head}
${companies.slice(0, 20).map(row).join('\n')}

## 규모 비율 상위 20 (최근 1년 새 결정)

자기자본 또는 자산총액 대비 크기입니다. 회사 규모에 비해 큰 결정일수록 위에 옵니다.

${head}
${byRatio.slice(0, 20).map(row).join('\n')}

## 규모 비율 30% 이상이면서 결정 후 공시된 조달이 없는 기업

은행 차입·자체 자금은 공시에 잡히지 않으므로 '조달이 필요하다'는 뜻은 아닙니다. 확인할 후보 목록입니다.

${head}
${gapBig.map(row).join('\n') || '| – | 없음 | | | | | | |'}
`;
writeFileSync(join(outDir, 'summary.md'), summary);
writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify({ asof, companies: companies.length, new_decision: fresh.length, events: events.length }, null, 2)}\n`);
console.log(`exported ${companies.length} companies, ${events.length} events → ${outDir}`);

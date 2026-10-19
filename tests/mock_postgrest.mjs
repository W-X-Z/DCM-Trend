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
  // 회사채: 한 발행에 트랜치 1~3개 (같은 본 회차·같은 납입일)
  for (let i = 0, k = between(14, 26); i < k; i++) {
    const c = pick(corps);
    const combo = pick([[24, 36], [24, 36], [24, 36], [36], [36, 60], [24, 36, 60], [12, 24], [36, 60, 120], [18, 24]]);
    const base = between(10, 120);
    const pay = day(between(2, maxDay));
    const cat = c.name.endsWith('캐피탈') ? '금융채' : rnd() < 0.06 ? '신종자본증권' : '일반회사채';
    const rating = pick(['AA+', 'AA0', 'AA0', 'AA-', 'A+', 'A0', 'A-', 'BBB+', 'BBB0']);
    const fixedBand = rating.startsWith('BBB');
    const lead = pick(firms);
    combo.forEach((tenor, t) => {
      const key = `bond:${c.code}:${++n}`;
      const amt = between(3, 15) * 1e10;
      const inc = rnd() < 0.6;
      const ratio = Math.round((rnd() < 0.08 ? rnd() * 0.9 : 1 + rnd() * 9) * 100) / 100;
      const init = inc ? Math.round(amt * 0.6 / 1e9) * 1e9 : amt;
      sql.push(`insert into core.deals (deal_key, product_type, sub_type, corp_code, series, is_public, status, announce_dt, pricing_dt, payment_dt, amount_krw, initial_amount_krw, latest_rcept_no)
        values (${q(key)}, 'bond', ${q(cat)}, ${q(c.code)}, ${q(combo.length > 1 ? `${base}-${t + 1}` : String(base))}, true, 'completed', ${q(pay)}::date - 14, ${q(pay)}::date - 7, ${q(pay)}, ${amt}, ${init}, null);`);
      sql.push(`insert into core.bond_terms (deal_key, tenor_months, maturity_dt, rating_raw, rating, band_type, band_low, band_high, competition_ratio, final_spread_bp, coupon_pct, demand_krw)
        values (${q(key)}, ${tenor}, (${q(pay)}::date + make_interval(months => ${tenor}))::date, ${q(rating)}, ${q(rating)},
                ${q(fixedBand ? '고정금리' : '개별민평')}, ${fixedBand ? 5.5 : -30}, ${fixedBand ? 6.8 : 30}, ${ratio},
                ${fixedBand ? 'null' : between(-25, 35)}, ${fixedBand ? (between(560, 680) / 100) : 'null'}, ${Math.round(init * ratio)});`);
      sql.push(`insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw) values (${q(key)}, ${q(lead)}, ${q(lead)}, '대표주관', '총액인수', ${amt * 0.6}, ${Math.round(amt * 0.6 * between(10, 32) / 1e4)});`);
      const co = pick(firms.filter((f) => f !== lead));
      sql.push(`insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw) values (${q(key)}, ${q(co)}, ${q(co)}, '인수', '총액인수', ${amt * 0.4}, ${Math.round(amt * 0.4 * between(10, 30) / 1e4)});`);
    });
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
    const issue = day(between(1, maxDay));
    sql.push(`insert into core.mezz_terms (deal_key, coupon_pct, ytm_pct, conv_price, refix_floor_price, shares_ratio_pct, lead_manager, maturity_dt, put_start_dt)
      values (${q(key)}, ${zero ? 0 : between(0, 30) / 10}, ${zero ? 0 : between(10, 70) / 10}, ${cp}, ${Math.round(cp * pick([0.7, 0.7, 0.8, 0.9]))}, ${between(15, 220) / 10}, ${pub ? q(pick(firms)) : 'null'},
              (${q(issue)}::date + interval '3 year')::date, (${q(issue)}::date + interval '18 month')::date);`);
  }
  // IPO
  for (let i = 0, k = between(4, 12); i < k; i++) {
    const c = pick(corps);
    const key = `ipo:${c.code}:${++n}`;
    const amt = between(10, 400) * 1e8;
    const pay = day(between(1, maxDay));
    const spac = rnd() < 0.2;
    sql.push(`insert into core.deals (deal_key, product_type, sub_type, corp_code, is_public, status, announce_dt, payment_dt, amount_krw)
      values (${q(key)}, 'ipo', ${q(spac ? '스팩' : '일반')}, ${q(c.code)}, true, 'completed', ${q(pay)}::date - 45, ${q(pay)}, ${amt});`);
    const price = spac ? 2000 : between(8, 60) * 1000;
    const bandHigh = Math.round(price * pick([0.9, 1, 1, 1.1]));
    sql.push(`insert into core.ipo_terms (deal_key, offer_price, shares_offered, secondary_pct, has_putback, band_low, band_high)
      values (${q(key)}, ${price}, ${Math.round(amt / price)}, ${spac ? 0 : between(0, 40)}, ${rnd() < 0.2}, ${Math.round(bandHigh * 0.85)}, ${bandHigh});`);
    const lead = pick(firms);
    sql.push(`insert into core.deal_underwriters (deal_key, firm_raw, firm_std, role, method, amount_krw, fee_krw) values (${q(key)}, ${q(lead)}, ${q(lead)}, '대표주관', '총액인수', ${amt}, ${Math.round(amt * between(250, 450) / 1e4)});`);
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
// 가상 정기보고서 잔액 (회사채 공모·사모·합계, 기업어음, 단기사채)
for (const c of corps) {
  const pub = between(0, 30) * 1e10, prv = between(0, 10) * 1e10, cp = between(0, 20) * 1e10;
  const row = (scope, total, y1) => ({ remndr_exprtn1: '미상환잔액', remndr_exprtn2: scope, sm: String(total), yy1_below: String(y1), stlm_dt: '2026-06-30', rcept_no: `SYN${c.code}` });
  const items = [row('공모', pub, pub * 0.3), row('사모', prv, prv * 0.5), row('합계', pub + prv, pub * 0.3 + prv * 0.5)];
  for (const it of items) sql.push(`insert into raw.api_items (endpoint, corp_code, rcept_no, period_key, item, item_hash) values ('cprndNrdmpBlce', ${q(c.code)}, ${q(it.rcept_no)}, '2026-11012', ${q(JSON.stringify(it))}::jsonb, md5(${q(JSON.stringify(it))}));`);
  if (cp > 0) {
    const it = { remndr_exprtn1: '미상환잔액', remndr_exprtn2: '합계', de10_below: String(cp * 0.2), de30_excess_de90_below: String(cp * 0.3), de90_excess_de180_below: String(cp * 0.5), sm: String(cp), stlm_dt: '2026-06-30', rcept_no: `SYN${c.code}` };
    sql.push(`insert into raw.api_items (endpoint, corp_code, rcept_no, period_key, item, item_hash) values ('entrprsBilScritsNrdmpBlce', ${q(c.code)}, ${q(it.rcept_no)}, '2026-11012', ${q(JSON.stringify(it))}::jsonb, md5(${q(JSON.stringify(it))}));`);
  }
}
await db.exec(sql.join('\n'));
console.log(`mock: 가상 딜 ${n}건 적재`);

// 가상 금리 (일별 랜덤 워크) + 금통위 기준금리 계단
{
  const start = new Date(Date.UTC(2021, 0, 4));
  const vals = { ktb3y: 1.0, ktb10y: 1.7, corp3y_aa: 1.5, corp3y_bbb: 7.4, cd91: 0.8, base_rate: 0.5 };
  const rows = [];
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    if ([0, 6].includes(d.getUTCDay())) continue;
    const dt = d.toISOString().slice(0, 10);
    const drift = d.getUTCFullYear() < 2023 ? 0.004 : -0.0015;
    const shock = (rnd() - 0.5) * 0.05;
    vals.ktb3y = Math.max(0.5, vals.ktb3y + drift + shock);
    vals.ktb10y = vals.ktb3y + 0.35 + (rnd() - 0.5) * 0.05;
    vals.corp3y_aa = vals.ktb3y + 0.55 + (rnd() - 0.5) * 0.04;
    vals.corp3y_bbb = vals.corp3y_aa + 5.9 + (rnd() - 0.5) * 0.06;
    vals.cd91 = vals.ktb3y - 0.1;
    if (d.getUTCDate() === 15 && rnd() < 0.25) vals.base_rate = Math.max(0.5, Math.round((vals.base_rate + (d.getUTCFullYear() < 2023 ? 0.25 : -0.25)) * 100) / 100);
    for (const [k, v] of Object.entries(vals)) rows.push(`(${q(k)}, ${q(dt)}, ${v.toFixed(3)})`);
  }
  for (let i = 0; i < rows.length; i += 5000) await db.exec(`insert into raw.rates (series_key, dt, value) values ${rows.slice(i, i + 5000).join(',')};`);
}

// 가상 주요사항보고서 (최근 2주) + 상세 API 값
{
  const d = (back) => new Date(today.getTime() + 9 * 3600_000 - back * 86400_000).toISOString().slice(0, 10);
  const ymdk = (s) => s.replaceAll('-', '');
  const kdate = (s) => `${s.slice(0, 4)}년 ${s.slice(5, 7)}월 ${s.slice(8, 10)}일`;
  const ev = [
    { c: corps[3], back: 1, nm: '주요사항보고서(유형자산양수결정)', ep: 'tgastInhDecsn', item: { ast_sen: '토지 및 건물', ast_nm: '경기 화성시 동탄 첨단산업단지 내 공장 부지', inhdtl_inhprc: '184,000,000,000', inhdtl_tast_vs: '38.2', inh_pp: '2차전지 소재 생산능력 확대', dlptn_cmpnm: '동탄도시개발(주)', inh_prd_inh_std: kdate(d(-90)) } },
    { c: corps[8], back: 2, nm: '주요사항보고서(타법인주식및출자증권양수결정)', ep: 'otcprStkInvscrInhDecsn', item: { iscmp_cmpnm: '그린모터스(주)', iscmp_mbsn: '전기차 구동모터 제조', inhdtl_inhprc: '326,000,000,000', inhdtl_ecpt_vs: '41.7', atinh_eqrt: '100', inh_pp: '전동화 부품 수직계열화', inh_prd: kdate(d(-60)) } },
    { c: corps[15], back: 4, nm: '주요사항보고서(회사합병결정)', ep: 'cmpMgDecsn', item: { mg_stn: '소규모합병', mgptncmp_cmpnm: '솔빛로지스(주)', mgptncmp_rl_cmpn: '자회사', mg_pp: '경영 효율성 제고', rbsnfdtl_tast: '21,000,000,000', mgsc_mgdt: kdate(d(-70)) } },
    { c: corps[21], back: 3, nm: '주요사항보고서(영업정지)', ep: 'bsnSp', item: { bsnsp_rm: '국내 진단검사 서비스', bsnsp_amt: '6,100,000,000', sl_vs: '62.4', bsnsp_rs: '신의료기술평가 결과 통보', bsnspd: kdate(d(3)) } },
    { c: corps[27], back: 6, nm: '주요사항보고서(유형자산양도결정)', ep: 'tgastTrfDecsn', item: { ast_sen: '토지 및 건물', ast_nm: '서울 중구 본사 사옥', trfdtl_trfprc: '212,000,000,000', trfdtl_tast_vs: '24.6', trf_pp: '재무구조 개선', dlptn_cmpnm: '한강리얼티(주)', trf_prd_trf_std: kdate(d(-120)) } },
    { c: corps[33], back: 8, nm: '주요사항보고서(회사분할결정)', ep: 'cmpDvDecsn', item: { dv_mth: '물적분할', dvfcmp_cmpnm: '누리배터리(주)', dvfcmp_mbsn: '배터리 소재', dv_impef: '전문성 제고 및 투자 유치 기반 마련', dvdt: kdate(d(-80)) } },
  ];
  const filings = ev.map((e, i) => ({ rm: '', flr_nm: e.c.name, corp_cls: 'Y', rcept_dt: ymdk(d(e.back)), rcept_no: `${ymdk(d(e.back))}9${String(i).padStart(5, '0')}`, corp_code: e.c.code, corp_name: e.c.name, report_nm: e.nm, stock_code: '' }));
  await db.exec('set role service_role');
  const rid = (await db.query(`select public.ingest_start_run('mock-disc') as id`)).rows[0].id;
  await db.query(`select public.ingest_put_filings($1, $2::jsonb)`, [rid, JSON.stringify(filings)]);
  for (const [i, e] of ev.entries()) {
    await db.query(`select public.ingest_put_api_items($1, $2, $3, '000', $4::jsonb, $5::text[])`,
      [rid, e.ep, e.c.code, JSON.stringify([{ group_title: null, item: { ...e.item, rcept_no: filings[i].rcept_no, corp_code: e.c.code } }]), `{${filings[i].rcept_no}}`]);
  }
  await db.exec('reset role');
}

// 가상 거래소 공시 + 원문에서 읽은 값 (주요 공시 화면 확인용)
{
  const d = (back) => new Date(today.getTime() + 9 * 3600_000 - back * 86400_000).toISOString().slice(0, 10);
  const ymdk = (s) => s.replaceAll('-', '');
  const ev = [
    { c: corps[2], back: 1, nm: '단기차입금증가결정', f: { '차입금액:krw': '25000000000', '자기자본 대비:pct': '20.86', '차입 목적:text': '운영자금 확보', '차입 형태:text': '금융기관 차입' } },
    { c: corps[5], back: 1, nm: '신규시설투자등', f: { '투자금액:krw': '216779761800', '자기자본 대비:pct': '8.16', '투자 대상:text': '2차전지 소재 신규 공장', '투자 종료일:date': '2028-12-31' } },
    { c: corps[9], back: 2, nm: '최대주주변경', f: { '변경 전 최대주주:text': '홍길동 외 4인', '변경 전 지분율:pct': '7.34', '변경 후 최대주주:text': '주식회사 한빛투자3호', '변경 후 지분율:pct': '41.2', '변경 사유:text': '제3자배정 유상증자' } },
    { c: corps[12], back: 3, nm: '최대주주변경을수반하는주식양수도계약체결', f: { '양도인:text': '김철수 외 3인', '양수인:text': '누리인베스트먼트 주식회사', '양수금액:krw': '23071298595', '예정 지분율:pct': '21.07', '변경 예정일:date': '2026-11-27' } },
    { c: corps[14], back: 4, nm: '타인에대한채무보증결정', f: { '채무자:text': '솔빛물류(주)', '채무자와의 관계:text': '계열회사', '채권자:text': '한빛저축은행', '채무보증금액:krw': '37450000000', '자기자본 대비:pct': '17.57' } },
    { c: corps[18], back: 5, nm: '사채원리금미지급발생', f: { '미지급 금액:krw': '3000000000', '사채 종류:text': '제5회 무기명식 이권부 무보증 사모 전환사채' } },
    { c: corps[20], back: 6, nm: '매출액또는손익구조30%(대규모법인은15%)이상변동', f: { '매출액 증감률:pct': '-2.3', '영업이익 증감률:pct': '343.4', '흑자·적자 전환:text': '당기순이익 흑자전환' } },
    { c: corps[24], back: 8, nm: '기타시장안내              (상장적격성 실질심사 대상 결정)', f: {} },
    { c: corps[26], back: 12, nm: '단기차입금증가결정', f: { '차입금액:krw': '120000000000', '자기자본 대비:pct': '6.1', '차입 목적:text': '회사채 상환 재원' } },
    { c: corps[30], back: 20, nm: '신규시설투자등', f: { '투자금액:krw': '58000000000', '자기자본 대비:pct': '12.4', '투자 대상:text': '물류센터 신축' } },
    { c: corps[6], back: 30, nm: '[기재정정]신규시설투자등', f: { '투자금액:krw': '92000000000', '자기자본 대비:pct': '45.2', '투자 대상:text': '아산 2공장 증설', '투자 목적:text': '생산능력 확대', '투자 종료일:date': '2027-06-30' } },
    { c: corps[10], back: 15, nm: '신규시설투자등', f: { '투자금액:krw': '15000000000', '자기자본 대비:pct': '9.1', '투자 대상:text': '판교 신사옥', '투자 목적:text': '본사 사옥 신축' } },
    { c: corps[3], back: 40, nm: '타인에대한담보제공결정', f: { '채무자:text': '동탄도시개발(주)', '담보제공금액:krw': '63000000000', '자기자본 대비:pct': '22.7', '담보 재산:text': '오송공장(토지, 건물)' } },
  ];
  const filings = ev.map((e, i) => ({ rm: '', flr_nm: e.c.name, corp_cls: 'K', rcept_dt: ymdk(d(e.back)), rcept_no: `${ymdk(d(e.back))}8${String(i).padStart(5, '0')}`, corp_code: e.c.code, corp_name: e.c.name, report_nm: e.nm, stock_code: '' }));
  await db.exec('set role service_role');
  const rid = (await db.query(`select public.ingest_start_run('mock-exch') as id`)).rows[0].id;
  await db.query(`select public.ingest_put_filings($1, $2::jsonb)`, [rid, JSON.stringify(filings)]);
  for (const [i, e] of ev.entries()) {
    const items = Object.entries(e.f).map(([field, value]) => ({ field, series: null, value }));
    if (items.length) await db.query(`select public.ingest_put_doc_fields($1, $2, 'disclosure', $3::jsonb)`, [rid, filings[i].rcept_no, JSON.stringify(items)]);
  }
  await db.exec('reset role');
}

// 눈여겨볼 회사·홈 피드 (수집기와 같은 코드, AI 키 없이 규칙으로 고름)
{
  const { buildIssues } = await import('../ingest/lib/issues.mjs');
  const { buildFeed } = await import('../ingest/lib/feed.mjs');
  const rpcDb = {
    rpc: async (fn, args = {}) => {
      const names = Object.keys(args);
      const r = await db.query(`select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`, names.map((k) => args[k]));
      return r.rows[0]?.v;
    },
  };
  await db.exec('set role service_role');
  await buildIssues({ db: rpcDb, key: '', log: (m) => console.log(`mock: ${m}`) });
  await buildFeed({ db: rpcDb, key: '', log: (m) => console.log(`mock: ${m}`) });
  await db.exec('reset role');
}

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
    else if (k === 'or' || k === 'and') {
      const parts = v.replace(/^\(|\)$/g, '').split(',');
      where.push(`(${parts.map((p) => { const i = p.indexOf('.'); return cond(p.slice(0, i), p.slice(i + 1), params); }).join(` ${k} `)})`);
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

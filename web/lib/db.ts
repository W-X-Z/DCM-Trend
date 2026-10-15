// Supabase REST(PostgREST) 조회. 화면은 mart 스키마만 읽는다 (docs/ARCHITECTURE.md 6장).
// 조회는 서버(서버 컴포넌트)에서만 하므로 키를 브라우저로 보내지 않는다.
//
// 캐시: 데이터 버전(mart.v_data_version, 변환이 돌 때마다 바뀜)을 요청 헤더에 넣는다.
// Next 의 fetch 캐시 키에는 헤더가 포함되므로, 변환 후 1분 안에 새 데이터로 바뀌고
// 그 사이에는 같은 조회를 다시 DB 에 보내지 않는다.

import 'server-only';
import { cache } from 'react';

const URL_BASE = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_ANON_KEY ?? '';
const VERSION_TTL = 60; // 데이터 버전 확인 주기(초)
const DATA_TTL = 6 * 3600; // 버전이 같을 때 데이터 캐시 상한(초)

function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: KEY, ...extra };
  if (!KEY.startsWith('sb_')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

export class DbError extends Error {}

function assertEnv() {
  if (!URL_BASE || !KEY) throw new DbError('SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.');
}

// 요청 하나 안에서는 한 번만 조회한다
const dataVersion = cache(async (): Promise<string> => {
  assertEnv();
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/v_data_version?select=data_version`, {
      headers: headers({ 'Accept-Profile': 'mart' }),
      next: { revalidate: VERSION_TTL },
    });
    if (!res.ok) return 'unknown';
    const rows = (await res.json()) as { data_version: string | null }[];
    return rows[0]?.data_version ?? 'empty';
  } catch {
    return 'unknown';
  }
});

export type Query = Record<string, string | number | undefined>;

// 예) select('v_deals', { corp_code: 'eq.00126380', order: 'deal_dt.desc', limit: 50 })
export async function select<T>(view: string, query: Query = {}): Promise<T[]> {
  assertEnv();
  const url = new URL(`${URL_BASE}/rest/v1/${view}`);
  url.searchParams.set('select', String(query.select ?? '*'));
  for (const [k, v] of Object.entries(query)) {
    if (k === 'select' || v === undefined) continue;
    url.searchParams.append(k, String(v));
  }
  const version = await dataVersion();
  const res = await fetch(url, {
    headers: headers({ 'Accept-Profile': 'mart', 'x-data-version': version }),
    next: { revalidate: version === 'unknown' ? VERSION_TTL : DATA_TTL },
  });
  if (!res.ok) throw new DbError(`${view} 조회 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// 1,000행 제한(PostgREST max-rows)을 넘는 조회: offset 으로 나눠 받는다
export async function selectAll<T>(view: string, query: Query = {}, pageSize = 1000, maxRows = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await select<T>(view, { ...query, limit: pageSize, offset });
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  assertEnv();
  const version = await dataVersion();
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/json',
      'Content-Profile': 'mart',
      'Accept-Profile': 'mart',
      'x-data-version': version,
    }),
    body: JSON.stringify(args),
    next: { revalidate: version === 'unknown' ? VERSION_TTL : DATA_TTL },
  });
  if (!res.ok) throw new DbError(`${fn} 실행 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// PostgREST in 필터. 값의 큰따옴표·괄호는 제거한다.
export const inList = (values: string[]) =>
  `in.(${values.map((v) => `"${v.replace(/["()]/g, '')}"`).join(',')})`;

// Supabase REST(PostgREST) 조회. 화면은 mart 스키마만 읽는다 (docs/ARCHITECTURE.md 6장).
// 조회는 서버(서버 컴포넌트)에서만 하므로 키를 브라우저로 보내지 않는다.

import 'server-only';

const URL_BASE = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_ANON_KEY ?? '';
const REVALIDATE = 3600; // 데이터는 하루 1회 갱신되므로 1시간 캐시

function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: KEY, ...extra };
  if (!KEY.startsWith('sb_')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

export class DbError extends Error {}

export type Query = Record<string, string | number | undefined>;

// 예) select('v_deals', { corp_code: 'eq.00126380', order: 'deal_dt.desc', limit: 50 })
export async function select<T>(view: string, query: Query = {}): Promise<T[]> {
  if (!URL_BASE || !KEY) throw new DbError('SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.');
  const url = new URL(`${URL_BASE}/rest/v1/${view}`);
  url.searchParams.set('select', String(query.select ?? '*'));
  for (const [k, v] of Object.entries(query)) {
    if (k === 'select' || v === undefined) continue;
    url.searchParams.append(k, String(v));
  }
  const res = await fetch(url, {
    headers: headers({ 'Accept-Profile': 'mart' }),
    next: { revalidate: REVALIDATE },
  });
  if (!res.ok) throw new DbError(`${view} 조회 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!URL_BASE || !KEY) throw new DbError('SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.');
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', 'Content-Profile': 'mart', 'Accept-Profile': 'mart' }),
    body: JSON.stringify(args),
    next: { revalidate: REVALIDATE },
  });
  if (!res.ok) throw new DbError(`${fn} 실행 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// PostgREST in 필터. 값의 큰따옴표·괄호는 제거한다.
export const inList = (values: string[]) =>
  `in.(${values.map((v) => `"${v.replace(/["()]/g, '')}"`).join(',')})`;

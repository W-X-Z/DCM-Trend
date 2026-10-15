// 회사 화면의 최근 공시: OpenDART 공시검색을 서버에서 바로 조회한다 (키는 서버 환경변수).
import 'server-only';
import type { Disclosure, DisclosureRule } from './types';

const KEY = process.env.OPENDART_API_KEY ?? '';

export const hasDartKey = () => Boolean(KEY);

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');

export async function fetchDisclosures(corp: string, rules: DisclosureRule[], days = 180): Promise<Disclosure[]> {
  if (!KEY) return [];
  const end = new Date(Date.now() + 9 * 3600_000);
  const bgn = new Date(end.getTime() - days * 86400_000);
  const url = new URL('https://opendart.fss.or.kr/api/list.json');
  url.searchParams.set('crtfc_key', KEY);
  url.searchParams.set('corp_code', corp);
  url.searchParams.set('bgn_de', ymd(bgn));
  url.searchParams.set('end_de', ymd(end));
  url.searchParams.set('page_count', '100');
  const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OpenDART HTTP ${res.status}`);
  const body = (await res.json()) as { status: string; message: string; list?: Record<string, string>[] };
  if (body.status === '013') return [];
  if (body.status !== '000') throw new Error(`OpenDART ${body.status}: ${body.message}`);
  const compiled = rules.map((r) => ({ ...r, re: new RegExp(r.pattern) }));
  return (body.list ?? []).map((x) => {
    const name = (x.report_nm ?? '').trim();
    const rule = compiled.find((r) => r.re.test(name));
    return {
      rcept_no: x.rcept_no,
      rcept_dt: `${x.rcept_dt.slice(0, 4)}-${x.rcept_dt.slice(4, 6)}-${x.rcept_dt.slice(6, 8)}`,
      report_nm: name,
      flr_nm: x.flr_nm,
      rm: x.rm ?? '',
      category: rule?.category ?? '기타',
      importance: rule?.importance ?? 3,
    };
  });
}

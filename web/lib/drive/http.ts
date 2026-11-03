// 드라이브 API 공통: 접근 키(DRIVE_KEY) 확인과 CORS(AX 플랫폼에서 부름).
import 'server-only';
import { timingSafeEqual } from 'node:crypto';

const KEY = process.env.DRIVE_KEY ?? '';
const ORIGIN_OK = /^(https:\/\/ax-platform[\w-]*\.vercel\.app|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

export function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  if (!ORIGIN_OK.test(o)) return {};
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-drive-key, x-client-id',
    'Access-Control-Expose-Headers': 'content-disposition',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
export const preflight = (req: Request) => new Response(null, { status: 204, headers: cors(req) });

export function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors(req), 'Cache-Control': 'no-store' } });
}

export function driveKeyOk(req: Request) {
  if (!KEY) return false;
  const got = Buffer.from(req.headers.get('x-drive-key') ?? '');
  const want = Buffer.from(KEY);
  return got.length === want.length && timingSafeEqual(got, want);
}
// 키가 맞으면 null, 아니면 막는 응답
export function guard(req: Request): Response | null {
  if (!KEY) return json(req, { error: '드라이브 키(DRIVE_KEY)가 서버에 설정되지 않았어요.', code: 'no_key' }, 503);
  if (!driveKeyOk(req)) return json(req, { error: '드라이브 키가 맞지 않아요.', code: 'bad_key' }, 401);
  return null;
}

export const clientOf = (req: Request) => (req.headers.get('x-client-id') ?? '').replace(/[^\w-]/g, '').slice(0, 40) || undefined;

export function dbWhy(e: unknown) {
  const m = (e as Error)?.message ?? '';
  if (/too many/.test(m)) return { error: '짧은 시간에 너무 많이 올렸어요. 1분쯤 뒤 다시 해 주세요.', status: 429 };
  if (/not found/.test(m)) return { error: '파일을 찾지 못했어요.', status: 404 };
  return { error: '드라이브 저장소에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.', status: 502 };
}

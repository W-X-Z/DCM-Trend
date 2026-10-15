// Supabase RPC 호출 (public.ingest_* 함수만 사용)

export class Db {
  constructor({ url, key }) {
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다');
    this.base = url.replace(/\/$/, '');
    // 새 형식 키(sb_secret_...)는 apikey 헤더만, 기존 JWT 키는 Authorization 도 함께 보낸다.
    this.headers = { apikey: key, 'Content-Type': 'application/json' };
    if (!key.startsWith('sb_')) this.headers.Authorization = `Bearer ${key}`;
  }

  async rpc(fn, args = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${this.base}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(120_000),
        });
        const text = await res.text();
        if (!res.ok) {
          const err = new Error(`${fn} HTTP ${res.status}: ${text.slice(0, 300)}`);
          if (res.status < 500) throw Object.assign(err, { fatal: true });
          throw err;
        }
        return text ? JSON.parse(text) : null;
      } catch (e) {
        if (e.fatal) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    throw lastErr;
  }
}

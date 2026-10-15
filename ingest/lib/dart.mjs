// OpenDART API 클라이언트
// - 호출 간격 제한, 재시도, 실행당 호출 상한(일일 한도 보호)
// - 인증키는 URL 에만 들어가며 로그에 남기지 않는다.

const BASE = process.env.OPENDART_BASE ?? 'https://opendart.fss.or.kr/api';   // 테스트에서 모의 서버로 교체

// OpenDART status 코드
// 000 정상 / 013 데이터 없음 / 020 요청 제한 초과 / 010·011·012·901 키·IP 문제 / 800 점검
export const STATUS = {
  OK: '000',
  NO_DATA: '013',
  LIMIT: '020',
  MAINTENANCE: '800',
};
const FATAL = new Set(['010', '011', '012', '901']);

export class DartStopError extends Error {}   // 더 호출하면 안 되는 상황 (한도·키·IP)
export class BudgetError extends Error {}     // 이번 실행의 호출 상한 도달

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Dart {
  constructor({ key, minIntervalMs = 200, maxCalls = 15000 }) {
    if (!key) throw new Error('OPENDART_API_KEY 가 없습니다');
    this.key = key;
    this.minIntervalMs = minIntervalMs;
    this.maxCalls = maxCalls;
    this.calls = 0;
    this.last = 0;
  }

  async #throttle() {
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  #url(path, params) {
    const url = new URL(`${BASE}/${path}`);
    url.searchParams.set('crtfc_key', this.key);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    return url;
  }

  async #request(path, params, parse) {
    if (this.calls >= this.maxCalls) throw new BudgetError(`호출 상한 ${this.maxCalls}회 도달`);
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.#throttle();
      this.calls++;
      try {
        const res = await fetch(this.#url(path, params), { signal: AbortSignal.timeout(60_000) });
        if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new DartStopError(`HTTP ${res.status} (${path})`);
        return await parse(res);
      } catch (e) {
        if (e instanceof DartStopError) throw e;
        lastErr = e;
        if (attempt < 4) await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`${path} 요청 실패: ${lastErr?.message}`);
  }

  // JSON API. 반환: { status, message, ...body }
  async json(endpoint, params) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const body = await this.#request(`${endpoint}.json`, params, (res) => res.json());
      if (body.status === STATUS.LIMIT) throw new DartStopError(`일일 호출 한도 초과 (020): ${body.message}`);
      if (FATAL.has(body.status)) throw new DartStopError(`인증키·IP 문제 (${body.status}): ${body.message}`);
      if (body.status === STATUS.MAINTENANCE) {
        if (attempt === 3) throw new DartStopError(`시스템 점검 (800): ${body.message}`);
        await sleep(60_000);
        continue;
      }
      return body;
    }
  }

  // 바이너리(zip) API. JSON 오류 응답이면 그 내용을 에러로 던진다.
  async binary(path, params) {
    return this.#request(path, params, async (res) => {
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder().decode(buf.slice(0, 200));
      if (head.trimStart().startsWith('{') || head.includes('<status>')) {
        throw new DartStopError(`${path} 오류 응답: ${head.slice(0, 160)}`);
      }
      return buf;
    });
  }
}

// 한국어 조사: 마지막 글자를 읽는 소리의 받침으로 고른다.
// 끝의 괄호 설명은 건너뛰고('3.7조(43건)' → '조'), 숫자·영문은 읽는 소리로 본다('BBB0' → 영, 'HMM' → 엠).
// 반환값: 받침 번호(0 = 받침 없음, 8 = ㄹ), 모르면 null
function jong(word: unknown): number | null {
  let s = String(word ?? '').trim();
  while (/\([^()]*\)$/.test(s)) s = s.replace(/\s*\([^()]*\)$/, '').trim();
  const ch = s.slice(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return code % 28;
  // 숫자: 영(ㅇ) 일(ㄹ) 이 삼(ㅁ) 사 오 육(ㄱ) 칠(ㄹ) 팔(ㄹ) 구
  const digit: Record<string, number> = { '0': 21, '1': 8, '2': 0, '3': 16, '4': 0, '5': 0, '6': 1, '7': 8, '8': 8, '9': 0 };
  if (ch in digit) return digit[ch];
  // 영문: 엘·알(ㄹ) 엠(ㅁ) 엔(ㄴ), 나머지는 받침 없음
  const up = ch.toUpperCase();
  if (/[A-Z]/.test(up)) return up === 'L' || up === 'R' ? 8 : up === 'M' ? 16 : up === 'N' ? 4 : 0;
  // 기호: % 퍼센트, + 플러스, - 마이너스
  if (ch === '%' || ch === '+' || ch === '-') return 0;
  return null;
}

const has = (w: unknown) => {
  const j = jong(w);
  return j !== null && j !== 0;
};

export const eun = (w: unknown) => (has(w) ? '은' : '는');
export const iga = (w: unknown) => (has(w) ? '이' : '가');
export const eul = (w: unknown) => (has(w) ? '을' : '를');
export const ida = (w: unknown) => (has(w) ? '이다' : '다');
export const ro = (w: unknown) => {
  const j = jong(w);
  return j === null || j === 0 || j === 8 ? '로' : '으로';
};

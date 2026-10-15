// 한국어 조사: 마지막 글자 받침으로 고른다. 한글이 아니면(숫자·기호·영문) 읽는 소리에 가까운 기본값.
function jong(word: unknown): number | null {
  const ch = String(word ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (Number.isNaN(code) || code < 0 || code > 11171) return null;
  return code % 28;
}

export const eun = (w: unknown) => (jong(w) === 0 || jong(w) === null ? '는' : '은');
export const iga = (w: unknown) => (jong(w) === 0 || jong(w) === null ? '가' : '이');
export const ida = (w: unknown) => (jong(w) === 0 ? '다' : '이다');
export const ro = (w: unknown) => {
  const j = jong(w);
  return j === null || j === 0 || j === 8 ? '로' : '으로';
};

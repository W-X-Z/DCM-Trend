// 내부 데이터 붙여넣기(엑셀 복사 → 탭 구분): 첫 줄 머리글, 첫 열 항목.
// 사내 시스템에서는 연계로 같은 모양의 표를 채운다. 프로토타입에서는 테스트용 붙여넣기만 받는다.
export function parseTsv(s: string): string[][] {
  const rows = s.replace(/\r/g, '').split('\n').map((l) => l.split('\t').map((c) => c.trim())).filter((r) => r.some((c) => c));
  const w = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(w - r.length).fill('')]);
}

export const hasTable = (s: string | null | undefined) => parseTsv(s ?? '').length >= 2;

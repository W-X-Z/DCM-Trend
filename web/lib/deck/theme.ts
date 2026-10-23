// NH투자증권 제안서 서식 (이랜드월드 108 대표주관 제안서에서 측정한 값)
// 단위는 pt. 페이지 780 x 540 (10.83in x 7.5in)

export const PAGE = { w: 780, h: 540 } as const;

export const C = {
  blue: '1E75BB',        // 표지·뒷표지 바탕, 머리띠 밑줄, 오른쪽 블록
  navy: '0A4C88',        // 간지 바탕
  navyDeep: '053168',    // 간지 오른쪽 블록
  secBar: '1461A2',      // 간지 제목 띠
  band: 'DAEBF6',        // 본문 머리띠, 일정표 요일 머리
  th: '074269',          // 표 머리
  label: 'F2F2F2',       // 표 항목 칸, 요약 상자
  grid: 'D9D9D9',        // 표 선
  gold: 'F0BE19',        // 표 제목 양옆 선
  yellow: 'FBB813',      // 표지 장식, 강조 막대
  sky: '8EC9EA',         // 표지 장식
  ink: '252525',         // 본문 글자
  sub: '595959',         // 보조 글자
  muted: '8C8C8C',       // 각주
  red: 'E0261B',         // 미달 등 경고 숫자
  orange: 'E8710A',      // 일정표 주요 단계
  teal: '2C8EC7',        // 일정표 수요예측 가능일
  green: 'D8E4BC',       // 일정표 납입일 칸
  bar: 'A6A6A6',         // 막대 차트 기본
  white: 'FFFFFF',
} as const;

export const FONT = {
  face: 'NanumGothic',
  faceBold: 'NanumGothic',
  faceXB: 'NanumGothic ExtraBold',
} as const;

// 글자 폭 (em). NanumGothic hmtx 에서 읽음: 한글 0.94em, ASCII 는 표
const ASCII_R = [0.28, 0.424, 0.43, 0.606, 0.606, 1.09, 0.727, 0.303, 0.363, 0.363, 0.606, 0.654, 0.303, 0.363, 0.303, 0.375, 0.606, 0.606, 0.606, 0.606, 0.606, 0.606, 0.606, 0.606, 0.606, 0.606, 0.303, 0.303, 0.547, 0.654, 0.547, 0.545, 0.872, 0.727, 0.606, 0.672, 0.727, 0.576, 0.503, 0.797, 0.727, 0.242, 0.363, 0.641, 0.484, 0.969, 0.727, 0.787, 0.577, 0.787, 0.622, 0.545, 0.545, 0.727, 0.666, 1.029, 0.666, 0.666, 0.545, 0.363, 0.375, 0.363, 0.654, 0.545, 0.491, 0.545, 0.606, 0.484, 0.606, 0.545, 0.363, 0.606, 0.606, 0.242, 0.269, 0.52, 0.242, 0.908, 0.606, 0.606, 0.606, 0.606, 0.363, 0.424, 0.363, 0.606, 0.484, 0.848, 0.51, 0.464, 0.484, 0.303, 0.242, 0.303, 0.654];
const NARROW: Record<string, number> = { '·': 0.29, '‘': 0.185, '’': 0.185, '“': 0.35, '”': 0.35, '「': 0.351, '」': 0.351, '↑': 0.464, '↓': 0.464, '~': 0.654 };

export function charW(ch: string): number {
  const c = ch.codePointAt(0) ?? 32;
  if (c >= 32 && c < 127) return ASCII_R[c - 32];
  if (NARROW[ch] != null) return NARROW[ch];
  if (c >= 0x2000 && c < 0x2070) return 0.5;
  return 0.94;
}

// 글자 폭 (pt). 굵은 글씨는 3% 넓게 잡는다(렌더러마다 자간이 조금씩 달라 여유를 둔다)
export function textW(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) w += charW(ch);
  return w * size * (bold ? 1.03 : 1.0);
}

export const LINE = 1.32; // 줄 높이 = 글자 크기 x LINE

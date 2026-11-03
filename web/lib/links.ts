// 공모 회사채 '제안서 초안' 버튼이 여는 곳: Agent 탭(제안서 Agent 가 그 회사 초안을 만든다)
export const deckHref = (corp: string) => `/agent?corp=${encodeURIComponent(corp)}`;

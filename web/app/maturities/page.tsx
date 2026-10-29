import { redirect } from 'next/navigation';

// 만기도래 탭은 없앴다(10-29): 홈 영업 추천(만기일정·신용등급·상장시장 필터)과 회사 화면(자세히 보기)으로 대신한다.
// 예전 링크·AI 답의 출처 링크는 홈으로 보낸다. 이전 화면은 git 기록(5482c26)에 있다.
export default function Maturities() {
  redirect('/');
}

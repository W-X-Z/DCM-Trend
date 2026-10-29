import { redirect } from 'next/navigation';

// 사업 확장 기업은 주요공시의 '사업 확장' 유형으로 합쳤다 (예전 주소 유지용)
export default function ExpansionPage() {
  redirect('/filings?t=exp&p=365');
}

import Link from 'next/link';
import { Header } from '@/components/Chrome';

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main" className="wrap">
        <div className="page-head">
          <h1 className="page-title">찾는 화면이 없습니다</h1>
          <p className="page-sub">
            <Link href="/">처음 화면</Link>에서 발행사 이름으로 다시 찾아 보세요.
          </p>
        </div>
      </main>
    </>
  );
}

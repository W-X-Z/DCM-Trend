import type { Metadata } from 'next';
import './globals.css';
import { Footer } from '@/components/Chrome';

export const metadata: Metadata = {
  title: { default: 'DCM 트렌드', template: '%s | DCM 트렌드' },
  description: 'DART 공시 기반 회사채·메자닌·유상증자 발행시장 모니터',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@500;700&display=swap"
        />
      </head>
      <body>
        <a href="#main" className="skip">본문으로 건너뛰기</a>
        {children}
        <Footer />
      </body>
    </html>
  );
}

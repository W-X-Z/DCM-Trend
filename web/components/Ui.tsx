import Link from 'next/link';
import type { ReactNode } from 'react';
import { PRODUCTS, type ProductType } from '@/lib/types';

// 설명은 화면에 늘어놓지 않고 '?' 에 숨긴다 (마우스를 올리거나 키보드로 초점을 주면 열림)
export function Info({ children, label }: { children: ReactNode; label?: string }) {
  const text = typeof children === 'string' ? children : label ?? '설명';
  return (
    <span className="info">
      <button type="button" className="info-btn" aria-label={text}>?</button>
      <span className="info-pop" aria-hidden>{children}</span>
    </span>
  );
}

export function SectionHead({ id, title, info, right }: { id: string; title: ReactNode; info?: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 id={id}>
        {title}
        {info && <Info>{info}</Info>}
      </h2>
      {right && <div className="section-right">{right}</div>}
    </div>
  );
}

export function PageHead({ title, info, children }: { title: ReactNode; info?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="page-title">
        {title}
        {info && <Info>{info}</Info>}
      </h1>
      {children}
    </div>
  );
}

// 상품 탭: 동향 화면 위쪽, 제목 바로 아래
export function ProductTabs({ active, query = '' }: { active: ProductType; query?: string }) {
  return (
    <nav className="tabs" aria-label="상품">
      {PRODUCTS.map((p) => (
        <Link
          key={p.key}
          href={`/trends/${p.key}${query}`}
          className={`tab p-${p.key}`}
          aria-current={active === p.key ? 'page' : undefined}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

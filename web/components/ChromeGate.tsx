'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// 제안서 작성 화면(새 탭)은 사이트 머리글·바닥글 없이 작업 공간만 보인다
export const isStudio = (p: string | null) => !!p && p.startsWith('/proposal/deck');

export function ChromeGate({ children }: { children: ReactNode }) {
  return isStudio(usePathname()) ? null : <>{children}</>;
}

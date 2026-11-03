// 드라이브 API 를 화면에서 부를 때(제안서 Agent 탭): 이 브라우저에 둔 드라이브 키를 붙인다.
import type { Area, DriveRow } from './store';

const KEY = 'drive.key.v1';
export const driveKey = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
export const setDriveKey = (k: string) => {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장이 막힌 브라우저: 이번 화면에서만 */
  }
};
export const keyHeader = (): Record<string, string> => {
  const k = driveKey();
  return k ? { 'x-drive-key': k } : {};
};

export class DriveFail extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}
async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), ...keyHeader() } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new DriveFail((j as { error?: string }).error ?? `드라이브 요청 실패 (${r.status})`, (j as { code?: string }).code);
  return j as T;
}
export const listDrive = (area: Area, folder?: string) =>
  call<{ folders: string[]; files: DriveRow[] }>(`/api/drive?area=${area}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`);
export function uploadDrive(file: File, area: Area, folder: string) {
  const f = new FormData();
  f.set('file', file);
  f.set('area', area);
  f.set('folder', folder);
  return call<{ id: number; ver: number; name: string; status: 'ready' | 'error'; error?: string }>('/api/drive', { method: 'POST', body: f });
}

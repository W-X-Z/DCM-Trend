// 드라이브 저장소(Supabase ops.drive_files, mart.drive_* 함수). 서버 전용.
import 'server-only';
import { rpcWrite } from '../db';
import type { DmEdition } from '../deck/dm';
import type { DriveKind, SlideInfo } from './extract';

export type Area = 'dept' | 'mine';
// 프로토타입: 부서는 DCM 하나, 사람은 김하늘 하나(AX 플랫폼 4안과 같다)
export const OWNER: Record<Area, string> = { dept: 'dcm', mine: 'u-kim' };
export const FOLDERS: Record<Area, string[]> = { dept: ['DM', '레퍼런스'], mine: ['올린 자료'] };

// 레퍼런스 카드: 올릴 때 Agent 가 만든 요약(장표 구성 · 말투). Master 가 비슷한 걸 고를 때 본다.
export type RefCard = {
  corp?: string; industry?: string; rating?: string; deal?: string; date?: string;
  summary: string; slides: string[]; strengths: string[]; tags: string[];
};
export type DriveMeta = {
  pages?: number; by?: string; card?: RefCard; edition?: DmEdition;
  dm?: { edition: string; filled: string[]; by: 'model' | 'rule' };
};
export type DriveRow = {
  id: number; folder: string; name: string; kind: DriveKind; size: number; ver: number; versions: number;
  status: 'processing' | 'ready' | 'error'; error: string | null; meta: DriveMeta; created_at: string; created_by: string | null;
};
export type DriveItem = {
  id: number; area: Area; owner: string; folder: string; name: string; kind: DriveKind; ver: number;
  content: string | null; slides: SlideInfo[] | null; meta: DriveMeta; status: DriveRow['status'];
};

export const driveList = (area: Area, folder?: string) =>
  rpcWrite<DriveRow[]>('drive_list', { p_area: area, p_owner: OWNER[area], p_folder: folder ?? null });

export async function drivePut(a: {
  area: Area; folder: string; name: string; kind: DriveKind; body: Uint8Array; content?: string | null;
  slides?: SlideInfo[] | null; meta?: DriveMeta; status?: DriveRow['status']; author?: string; client?: string;
}) {
  const [r] = await rpcWrite<{ id: number; ver: number }[]>('drive_put', {
    p_area: a.area, p_owner: OWNER[a.area], p_folder: a.folder, p_name: a.name, p_kind: a.kind,
    p_body_b64: Buffer.from(a.body).toString('base64'), p_content: a.content ?? null, p_slides: a.slides ?? null,
    p_meta: a.meta ?? {}, p_status: a.status ?? 'ready', p_author: a.author ?? null, p_client_id: a.client ?? null,
  });
  return r;
}
export const driveSet = (id: number, meta: DriveMeta, status: DriveRow['status'], error?: string) =>
  rpcWrite<number>('drive_set', { p_id: id, p_meta: meta, p_status: status, p_error: error ?? null });
export const driveVersions = (id: number) =>
  rpcWrite<{ id: number; ver: number; size: number; status: string; created_at: string; created_by: string | null }[]>('drive_versions', { p_id: id });
export async function driveBody(id: number) {
  const [r] = await rpcWrite<{ name: string; kind: DriveKind; body_b64: string }[]>('drive_body', { p_id: id });
  return r ? { name: r.name, kind: r.kind, body: Buffer.from(r.body_b64, 'base64') } : null;
}
export async function driveRead(id: number) {
  const [r] = await rpcWrite<DriveItem[]>('drive_read', { p_id: id });
  return r ?? null;
}
export const driveDelete = (id: number, client?: string) => rpcWrite<number>('drive_delete', { p_id: id, p_client_id: client ?? null });

// 기준일 이전 가장 최근에 올린 DM 판(없거나 DB 오류면 null)
export async function driveDmLatest(asof: string): Promise<{ id: number; name: string; edition: DmEdition } | null> {
  try {
    const [r] = await rpcWrite<{ id: number; name: string; edition: DmEdition }[]>('drive_dm_latest', { p_asof: asof });
    return r?.edition ? r : null;
  } catch {
    return null;
  }
}
export async function driveRefs() {
  return rpcWrite<{ id: number; name: string; kind: DriveKind; card: RefCard; created_at: string }[]>('drive_refs', { p_owner: OWNER.dept });
}

/**
 * Aturan akses (SPEC §13). Fungsi murni → mudah dites; dipakai oleh semua modul.
 */

export type Role = 'admin' | 'user' | 'guest';

export interface Viewer {
  userId: number | null;
  role: Role;
  guestHash: string | null;
}

export interface VideoAccessFields {
  owner_user_id: number | null;
  visibility: 'public' | 'private';
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'missing';
  deleted_at: Date | string | null;
}

export interface PlaylistAccessFields {
  owner_user_id: number | null;
  guest_hash: string | null;
  visibility: 'public' | 'private';
}

const isOwner = (ownerId: number | null, viewer: Viewer) => ownerId != null && ownerId === viewer.userId;

export function canWatch(v: VideoAccessFields, viewer: Viewer): boolean {
  if (v.deleted_at != null || v.status === 'missing') return false;
  if (viewer.role === 'admin') return true;
  if (isOwner(v.owner_user_id, viewer)) return true;
  return v.visibility === 'public' && v.status === 'ready';
}

export function canEditVideo(v: Pick<VideoAccessFields, 'owner_user_id'>, viewer: Viewer): boolean {
  return viewer.role === 'admin' || isOwner(v.owner_user_id, viewer);
}

export function canViewPlaylist(p: PlaylistAccessFields, viewer: Viewer): boolean {
  if (p.visibility === 'public' || viewer.role === 'admin') return true;
  if (isOwner(p.owner_user_id, viewer)) return true;
  return p.guest_hash != null && p.guest_hash === viewer.guestHash;
}

export function canEditPlaylist(p: PlaylistAccessFields, viewer: Viewer): boolean {
  if (viewer.role === 'admin') return true;
  if (isOwner(p.owner_user_id, viewer)) return true;
  return p.owner_user_id == null && p.guest_hash != null && p.guest_hash === viewer.guestHash;
}

/**
 * Daftar penemuan (beranda, kategori, cari, saran, rekomendasi, halaman channel): HANYA video publik, untuk siapa pun —
 * termasuk pemilik & admin (seperti YouTube). Video privat hanya muncul di "Video Anda" pemiliknya, playlist milik
 * pemiliknya, dan Panel Admin → Video; tetap bisa ditonton lewat link oleh pemilik & admin (canWatch).
 * Tanpa OR agar index idx_list (deleted_at, status, visibility, published_at) dipakai untuk urutan (tanpa filesort).
 */
export function discoverableSql(alias = 'v'): [string, unknown[]] {
  return [`${alias}.deleted_at IS NULL AND ${alias}.status = 'ready' AND ${alias}.visibility = 'public'`, []];
}

/**
 * Tab Video halaman channel milik `ownerId` (null = channel utama). Pengunjung lain: sama dengan daftar penemuan
 * (hanya publik). Pemilik yang membuka channel-nya sendiri juga melihat video PRIVAT-nya (seperti "Video Anda");
 * admin tidak mendapat pengecualian di channel orang lain maupun channel utama.
 * @returns [sql, params]
 */
export function channelVideosSql(viewer: Viewer, ownerId: number | null, alias = 'v'): [string, unknown[]] {
  if (ownerId != null && isOwner(ownerId, viewer)) {
    return [`${alias}.deleted_at IS NULL AND ${alias}.status = 'ready' AND ${alias}.owner_user_id = ?`, [ownerId]];
  }
  const [w, p] = discoverableSql(alias);
  return [`${w} AND ${alias}.owner_user_id <=> ?`, [...p, ownerId]];
}

/**
 * Isi playlist (milik siapa pun) untuk viewer: video publik + video privat MILIK viewer sendiri.
 * Admin tidak melihat video privat orang lain di playlist (kelola lewat /admin).
 * @param alias alias tabel videos
 * @returns [sql, params]
 */
export function listableSql(viewer: Viewer, alias = 'v'): [string, unknown[]] {
  // Tamu: tanpa OR agar index idx_list (deleted_at, status, visibility, published_at) bisa dipakai untuk urutan (tanpa filesort).
  if (viewer.userId == null) return [`${alias}.deleted_at IS NULL AND ${alias}.status = 'ready' AND ${alias}.visibility = 'public'`, []];
  return [
    `${alias}.deleted_at IS NULL AND ${alias}.status = 'ready' AND (${alias}.visibility = 'public' OR ${alias}.owner_user_id = ?)`,
    [viewer.userId],
  ];
}

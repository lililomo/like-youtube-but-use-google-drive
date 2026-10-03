/**
 * Rekomendasi personal (REKOMENDASI.md): beranda "Semua" & kolom kanan halaman tonton.
 * Profil = histori viewer sendiri (user: watch_history, tamu: guest_watch via dv_gid) + "Tidak tertarik".
 */
import { query, queryOne } from '../../db.js';
import { LruCache } from '../../lib/lru.js';
import type { Viewer } from '../../plugins/access.js';
import { getCatalog, getStats, importInfo, toItemInput } from './catalog.js';
import type { ItemFeatures } from './features.js';
import { buildProfile, rankHome, rankRelated, type Profile, type WatchRow } from './rank.js';

/** Peringkat per (viewer, seed, filter): infinite scroll & tombol Kembali memakai urutan yang sama. */
const rankCache = new LruCache<string, number[]>(3000, 15 * 60_000);

export const SEED_RE = /^[a-z0-9]{1,16}$/;

export function viewerKey(viewer: Viewer): string {
  if (viewer.userId) return `u${viewer.userId}`;
  if (viewer.guestHash) return `g${viewer.guestHash.slice(0, 24)}`;
  return 'anon';
}

interface HistRow {
  video_id: number;
  max_position_sec: number;
  duration_sec: number;
  plays: number;
  watched_at: Date;
}

async function loadProfile(viewer: Viewer, feats: Map<number, ItemFeatures>): Promise<Profile | null> {
  let rows: HistRow[];
  let disliked: { video_id: number }[];
  if (viewer.userId) {
    [rows, disliked] = await Promise.all([
      query<HistRow>(
        'SELECT video_id, max_position_sec, duration_sec, plays, watched_at FROM watch_history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 300',
        [viewer.userId],
      ),
      query<{ video_id: number }>('SELECT video_id FROM rec_feedback WHERE user_id = ? ORDER BY id DESC LIMIT 500', [viewer.userId]),
    ]);
  } else if (viewer.guestHash) {
    [rows, disliked] = await Promise.all([
      query<HistRow>(
        'SELECT video_id, max_position_sec, duration_sec, plays, watched_at FROM guest_watch WHERE guest_hash = ? ORDER BY watched_at DESC LIMIT 300',
        [viewer.guestHash],
      ),
      query<{ video_id: number }>('SELECT video_id FROM rec_feedback WHERE guest_hash = ? ORDER BY id DESC LIMIT 500', [viewer.guestHash]),
    ]);
  } else return null;
  if (!rows.length && !disliked.length) return null;
  const watch: WatchRow[] = rows.map((r) => ({
    videoId: r.video_id,
    maxPos: Number(r.max_position_sec),
    duration: Number(r.duration_sec),
    plays: Number(r.plays),
    watchedAt: new Date(r.watched_at).getTime(),
  }));
  return buildProfile(
    watch,
    feats,
    disliked.map((d) => d.video_id),
  );
}

/** Urutan ID video beranda "Semua" (personal bila ada histori, selain itu cold start). */
export async function homeIds(viewer: Viewer, seed: string, categoryIds: number[] | null): Promise<number[]> {
  const key = `h:${viewerKey(viewer)}:${seed}:${categoryIds?.join('.') ?? ''}`;
  const hit = rankCache.get(key);
  if (hit) return hit;
  const [cat, stats] = await Promise.all([getCatalog(), getStats()]);
  const profile = await loadProfile(viewer, cat.features.items);
  const allowed = categoryIds ? new Set(categoryIds) : null;
  const cands = allowed ? cat.candidates.filter((c) => allowed.has(cat.categoryOf.get(c.id) ?? -1)) : cat.candidates;
  const ids = rankHome(cands, profile, stats.cow, seed);
  rankCache.set(key, ids);
  return ids;
}

export interface BaseVideo {
  id: number;
  title: string;
  category_id: number | null;
  owner_user_id: number | null;
}

/** Urutan ID kolom kanan: filter `all` (personal) atau `related` (kemiripan murni). */
export async function relatedRankIds(viewer: Viewer, v: BaseVideo, seed: string, filter: 'all' | 'related'): Promise<number[]> {
  const key = `r:${viewerKey(viewer)}:${v.id}:${filter === 'all' ? seed : ''}:${filter}`;
  const hit = rankCache.get(key);
  if (hit) return hit;
  const [cat, stats] = await Promise.all([getCatalog(), getStats()]);
  let base = cat.features.items.get(v.id);
  if (!base) {
    // Video di luar katalog (privat milik viewer, atau belum masuk katalog) → vektor dari statistik katalog.
    const [imp, parent] = await Promise.all([
      importInfo([v.id]),
      v.category_id ? queryOne<{ parent_id: number | null }>('SELECT parent_id FROM categories WHERE id = ?', [v.category_id]) : null,
    ]);
    base = cat.features.vectorize(toItemInput({ ...v, category_parent: parent?.parent_id ?? null }, imp.get(v.id)));
  }
  const profile = filter === 'all' ? await loadProfile(viewer, cat.features.items) : null;
  const ids = rankRelated(base, cat.candidates, profile, stats.cow, seed, filter);
  rankCache.set(key, ids);
  return ids;
}

/** Setelah "Tidak tertarik"/hapus histori: peringkat viewer ini dihitung ulang (seed baru juga cukup). */
export function forgetViewerRanks(viewer: Viewer): void {
  const prefix = viewerKey(viewer);
  rankCache.deleteWhere((k) => k.slice(2).startsWith(`${prefix}:`));
}

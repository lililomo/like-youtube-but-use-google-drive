/**
 * Katalog rekomendasi di memori (REKOMENDASI.md §2): fitur semua video yang bisa ditemukan + co-watch + tren.
 * Katalog dibangun ulang tiap 2 menit, statistik tiap 20 menit; satu pembangunan berjalan pada satu waktu dan
 * permintaan memakai versi lama selama versi baru dibangun. Hasil akhir tetap disaring ulang dengan discoverableSql
 * saat diambil, jadi katalog yang sedikit basi tidak bisa membocorkan video yang baru dijadikan privat.
 */
import type { FastifyBaseLogger } from 'fastify';
import { query } from '../../db.js';
import { discoverableSql } from '../../plugins/access.js';
import { buildFeatures, type FeatureSet, type ItemInput } from './features.js';
import type { Candidate, CoWatch } from './rank.js';

const CATALOG_TTL = 2 * 60_000;
const STATS_TTL = 20 * 60_000;
const DAY = 86400_000;

export interface Catalog {
  builtAt: number;
  features: FeatureSet;
  candidates: Candidate[];
  byId: Map<number, Candidate>;
  categoryOf: Map<number, number | null>;
}

export interface Stats {
  builtAt: number;
  cow: CoWatch;
  /** video → jumlah penonton berbeda 7 hari terakhir. */
  trend: Map<number, number>;
}

interface VideoRow {
  id: number;
  title: string;
  category_id: number | null;
  category_parent: number | null;
  owner_user_id: number | null;
  view_count: number | string;
  published_at: Date;
}

interface ImportRow {
  video_id: number;
  playlist_id: string | null;
  playlist_index: number | null;
  channel: string | null;
}

/** Info impor YouTube terbaru per video (playlist asal, urutan, channel YouTube asal). */
export async function importInfo(videoIds?: number[]): Promise<Map<number, ImportRow>> {
  if (videoIds && !videoIds.length) return new Map();
  const rows = await query<ImportRow>(
    `SELECT video_id, playlist_id, playlist_index, channel FROM youtube_imports
      WHERE video_id IS NOT NULL ${videoIds ? 'AND video_id IN (?)' : ''} ORDER BY id`,
    videoIds ? [videoIds] : [],
  );
  const out = new Map<number, ImportRow>();
  for (const r of rows) out.set(r.video_id, r);
  return out;
}

export function toItemInput(v: Pick<VideoRow, 'id' | 'title' | 'category_id' | 'category_parent' | 'owner_user_id'>, imp?: ImportRow): ItemInput {
  return {
    id: v.id,
    title: v.title,
    categoryId: v.category_id,
    categoryParentId: v.category_parent,
    ownerId: v.owner_user_id,
    playlistId: imp?.playlist_id ?? null,
    playlistIndex: imp?.playlist_index ?? null,
    ytChannel: imp?.channel ?? null,
  };
}

let catalog: Catalog | null = null;
let catalogBuild: Promise<Catalog> | null = null;
let stats: Stats | null = null;
let statsBuild: Promise<Stats> | null = null;
let log: FastifyBaseLogger | null = null;

export function setRecommendLogger(l: FastifyBaseLogger): void {
  log = l;
}

async function buildCatalog(st: Stats): Promise<Catalog> {
  const [lw, lp] = discoverableSql();
  const rows = await query<VideoRow>(
    `SELECT v.id, v.title, v.category_id, c.parent_id AS category_parent, v.owner_user_id, v.view_count, v.published_at
       FROM videos v LEFT JOIN categories c ON c.id = v.category_id
      WHERE ${lw}`,
    lp,
  );
  const imports = await importInfo();
  const features = buildFeatures(rows.map((r) => toItemInput(r, imports.get(r.id))));
  const now = Date.now();
  const maxViews = rows.reduce((m, r) => Math.max(m, Number(r.view_count)), 1);
  let maxTrend = 0;
  for (const n of st.trend.values()) maxTrend = Math.max(maxTrend, n);
  const candidates: Candidate[] = rows.map((r) => {
    const pop = Math.log1p(Number(r.view_count)) / Math.log1p(maxViews);
    const trend = maxTrend > 0 ? Math.log1p(st.trend.get(r.id) ?? 0) / Math.log1p(maxTrend) : null;
    const age = Math.max(0, now - new Date(r.published_at).getTime()) / DAY;
    return { id: r.id, f: features.items.get(r.id)!, quality: trend === null ? pop : 0.5 * pop + 0.5 * trend, fresh: Math.exp(-age / 14) };
  });
  return {
    builtAt: now,
    features,
    candidates,
    byId: new Map(candidates.map((c) => [c.id, c])),
    categoryOf: new Map(rows.map((r) => [r.id, r.category_id])),
  };
}

interface WatchStatRow {
  k: string;
  video_id: number;
  mp: number;
  d: number;
  t: Date;
}

/** Co-watch: pasangan video yang ditonton viewer yang sama, makin dekat waktunya makin kuat; dinormalisasi + pseudo-count. */
export function computeStats(rows: { k: string; videoId: number; maxPos: number; duration: number; at: number }[], now = Date.now()): Stats {
  const byViewer = new Map<string, { id: number; at: number }[]>();
  const trendSets = new Map<number, Set<string>>();
  for (const r of rows) {
    const meaningful = r.maxPos >= 30 || (r.duration > 0 && r.maxPos / r.duration >= 0.5);
    if (!meaningful) continue;
    let list = byViewer.get(r.k);
    if (!list) byViewer.set(r.k, (list = []));
    list.push({ id: r.videoId, at: r.at });
    if (now - r.at <= 7 * DAY) {
      let s = trendSets.get(r.videoId);
      if (!s) trendSets.set(r.videoId, (s = new Set()));
      s.add(r.k);
    }
  }
  const count = new Map<number, number>();
  const pair = new Map<number, Map<number, number>>();
  const bump = (a: number, b: number, w: number) => {
    let m = pair.get(a);
    if (!m) pair.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + w);
  };
  for (const list of byViewer.values()) {
    list.sort((x, y) => y.at - x.at);
    const recent = list.slice(0, 60);
    for (const it of recent) count.set(it.id, (count.get(it.id) ?? 0) + 1);
    for (let i = 0; i < recent.length; i++) {
      for (let j = i + 1; j < recent.length; j++) {
        const a = recent[i]!;
        const b = recent[j]!;
        const gap = Math.abs(a.at - b.at);
        const w = gap <= 6 * 3600_000 ? 1 : gap <= 7 * DAY ? 0.5 : 0.25;
        bump(a.id, b.id, w);
        bump(b.id, a.id, w);
      }
    }
  }
  const cow: CoWatch = new Map();
  for (const [a, m] of pair) {
    const na = count.get(a) ?? 1;
    const top = [...m.entries()]
      .map(([b, c]) => [b, Math.min(1, c / (Math.sqrt(na * (count.get(b) ?? 1)) + 2))] as [number, number])
      .sort((x, y) => y[1] - x[1])
      .slice(0, 50);
    cow.set(a, new Map(top));
  }
  return { builtAt: now, cow, trend: new Map([...trendSets].map(([id, s]) => [id, s.size])) };
}

async function buildStats(): Promise<Stats> {
  const rows = await query<WatchStatRow>(
    `SELECT * FROM (
       SELECT CONCAT('u', user_id) AS k, video_id, max_position_sec AS mp, duration_sec AS d, watched_at AS t
         FROM watch_history WHERE watched_at > UTC_TIMESTAMP() - INTERVAL 120 DAY
       UNION ALL
       SELECT CONCAT('g', guest_hash), video_id, max_position_sec, duration_sec, watched_at
         FROM guest_watch WHERE watched_at > UTC_TIMESTAMP() - INTERVAL 120 DAY
     ) x ORDER BY t DESC LIMIT 200000`,
  );
  return computeStats(rows.map((r) => ({ k: r.k, videoId: r.video_id, maxPos: Number(r.mp), duration: Number(r.d), at: new Date(r.t).getTime() })));
}

function refreshStats(): Promise<Stats> {
  statsBuild ??= buildStats()
    .then((s) => (stats = s))
    .finally(() => (statsBuild = null));
  return statsBuild;
}

export async function getStats(): Promise<Stats> {
  if (!stats) return refreshStats();
  if (Date.now() - stats.builtAt > STATS_TTL) refreshStats().catch((err) => log?.warn({ err }, 'statistik rekomendasi gagal dibangun'));
  return stats;
}

function refreshCatalog(): Promise<Catalog> {
  catalogBuild ??= getStats()
    .then((st) => buildCatalog(st))
    .then((c) => (catalog = c))
    .finally(() => (catalogBuild = null));
  return catalogBuild;
}

export async function getCatalog(): Promise<Catalog> {
  if (!catalog) return refreshCatalog();
  if (Date.now() - catalog.builtAt > CATALOG_TTL) refreshCatalog().catch((err) => log?.warn({ err }, 'katalog rekomendasi gagal dibangun'));
  return catalog;
}

/** Paksa katalog dibangun ulang pada permintaan berikutnya (mis. video baru siap / visibilitas berubah). */
export function invalidateCatalog(): void {
  if (catalog) catalog.builtAt = 0;
}

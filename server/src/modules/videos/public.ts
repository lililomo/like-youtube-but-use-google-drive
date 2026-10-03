import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exec, query, queryOne } from '../../db.js';
import { sha256Hex } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { LruCache } from '../../lib/lru.js';
import { parse } from '../../lib/validate.js';
import { requireUser } from '../../plugins/auth.js';
import { channelVideosSql, discoverableSql, type Viewer } from '../../plugins/access.js';
import { settings } from '../settings/service.js';
import { channelOf, toSummary, VIDEO_SELECT, type VideoRecord } from './model.js';
import { loadWatchable } from './routes.js';
import { decodeCursor, encodeCursor, escapeLike, planSearch } from './search.js';
import { homeIds, relatedRankIds, SEED_RE } from '../recommend/service.js';
import { summarizePlaylists, type PlaylistRow } from '../playlists/routes.js';

const PAGE = 24;

/** Kolom posisi tonton (bar merah di thumbnail) untuk user login. */
function progressJoin(viewer: Viewer): [string, string, unknown[]] {
  if (!viewer.userId) return ['', ', NULL AS progress_sec', []];
  return [' LEFT JOIN watch_history wh ON wh.video_id = v.id AND wh.user_id = ?', ', wh.position_sec AS progress_sec', [viewer.userId]];
}

const FEED_SELECT = (viewer: Viewer) => {
  const [join, col, params] = progressJoin(viewer);
  const sql = VIDEO_SELECT.replace('FROM videos v', `${col} FROM videos v`) + join;
  return { sql, params };
};

type Row = VideoRecord & { progress_sec: number | null };

function summarize(rows: Row[], viewer: Viewer) {
  return rows.map((r) => ({ ...toSummary(r, viewer), ...(r.progress_sec != null ? { progressSec: r.progress_sec } : {}) }));
}

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

interface CatRow {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
}

async function categoriesWithCounts(viewer: Viewer) {
  const cats = await query<CatRow>('SELECT id, parent_id, name, slug, path, depth FROM categories WHERE missing_at IS NULL AND is_hidden = 0 ORDER BY sort_order, id');
  const [lw, lp] = discoverableSql();
  const counts = await query<{ category_id: number; n: number }>(
    `SELECT v.category_id, COUNT(*) AS n FROM videos v WHERE ${lw} AND v.category_id IS NOT NULL GROUP BY v.category_id`,
    lp,
  );
  const own = new Map(counts.map((c) => [c.category_id, Number(c.n)]));
  const total = new Map<number, number>();
  const byId = new Map(cats.map((c) => [c.id, c]));
  for (const c of cats) {
    let n = own.get(c.id) ?? 0;
    if (!n) continue;
    for (let cur: CatRow | undefined = c; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
      total.set(cur.id, (total.get(cur.id) ?? 0) + n);
      n = own.get(c.id) ?? 0;
    }
  }
  return cats
    .filter((c) => (total.get(c.id) ?? 0) > 0)
    .map((c) => ({ slug: c.slug, name: c.name, path: c.path, depth: c.depth, parentSlug: c.parent_id ? (byId.get(c.parent_id)?.slug ?? null) : null, videoCount: total.get(c.id) ?? 0 }));
}

async function descendantIds(slug: string): Promise<number[] | null> {
  const cats = await query<{ id: number; parent_id: number | null; slug: string }>('SELECT id, parent_id, slug FROM categories WHERE missing_at IS NULL');
  const root = cats.find((c) => c.slug === slug);
  if (!root) return null;
  const ids = [root.id];
  for (let i = 0; i < ids.length; i++) for (const c of cats) if (c.parent_id === ids[i]) ids.push(c.id);
  return ids;
}

// ---------------------------------------------------------------------------
// Tayangan (dedupe + flush berkala)
// ---------------------------------------------------------------------------

const viewSeen = new LruCache<string, true>(100_000, 6 * 3600_000);
const pendingViews = new Map<number, number>();

function viewerKeyFor(req: FastifyRequest): string {
  if (req.viewer.userId) return `u${req.viewer.userId}`;
  if (req.viewer.guestHash) return `g${req.viewer.guestHash}`;
  return `a${sha256Hex(`${req.ip}|${req.headers['user-agent'] ?? ''}`)}`;
}

export async function flushViews(): Promise<void> {
  if (!pendingViews.size) return;
  const batch = [...pendingViews.entries()];
  pendingViews.clear();
  for (const [id, n] of batch) await exec('UPDATE videos SET view_count = view_count + ? WHERE id = ?', [n, id]).catch(() => {});
}

let flushTimer: ReturnType<typeof setInterval> | undefined;
export function startViewFlusher(): void {
  flushTimer ??= setInterval(() => void flushViews(), 10_000);
  flushTimer.unref();
}

// ---------------------------------------------------------------------------
// Rekomendasi
// ---------------------------------------------------------------------------

type RelatedFilter = 'all' | 'channel' | 'related';
const channelCache = new LruCache<string, number[]>(2000, 10 * 60_000);

/**
 * Rekomendasi kolom kanan halaman tonton.
 * - all: personal — kemiripan konten/seri + co-watch + kebiasaan viewer + episode berikutnya (modules/recommend)
 * - related: kemiripan murni (chip "Terkait")
 * - channel: video lain dari channel yang sama (chip "Dari <channel>"), terbaru dulu
 */
async function relatedIds(v: Pick<VideoRecord, 'id' | 'title' | 'category_id' | 'owner_user_id'>, viewer: Viewer, seed: string, filter: RelatedFilter = 'all'): Promise<number[]> {
  if (filter !== 'channel') return relatedRankIds(viewer, v, seed, filter);
  const cacheKey = String(v.id);
  const hit = channelCache.get(cacheKey);
  if (hit) return hit;
  const [lw, lp] = discoverableSql();
  const rows = await query<{ id: number }>(`SELECT v.id FROM videos v WHERE ${lw} AND v.owner_user_id <=> ? AND v.id <> ? ORDER BY v.published_at DESC, v.id DESC LIMIT 60`, [
    ...lp,
    v.owner_user_id,
    v.id,
  ]);
  const ids = rows.map((r) => r.id);
  channelCache.set(cacheKey, ids);
  return ids;
}

/** Seed acak dari klien (beda tiap beranda dibuka); tanpa seed → acak per permintaan. */
const seedOf = (s: string | undefined) => (s && SEED_RE.test(s) ? s : Math.random().toString(36).slice(2, 10));

async function videosByIds(ids: number[], viewer: Viewer): Promise<Row[]> {
  if (!ids.length) return [];
  const { sql, params } = FEED_SELECT(viewer);
  const [lw, lp] = discoverableSql();
  const rows = await query<Row>(`${sql} WHERE ${lw} AND v.id IN (?)`, [...params, ...lp, ids]);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const feedQuery = z.object({
  category: z.string().max(191).optional(),
  /** for_you = beranda personal (REKOMENDASI.md); latest/popular = urutan biasa. */
  sort: z.enum(['for_you', 'latest', 'popular']).default('for_you'),
  seed: z.string().max(16).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(PAGE),
});

export async function publicVideoRoutes(app: FastifyInstance): Promise<void> {
  /** Semua kategori (folder) termasuk yang kosong — untuk pilihan kategori saat upload/ubah video. */
  app.get('/api/categories/all', { preHandler: requireUser }, async () => {
    const cats = await query<CatRow>('SELECT id, parent_id, name, slug, path, depth FROM categories WHERE missing_at IS NULL AND is_hidden = 0 ORDER BY path, id');
    return { items: cats.map((c) => ({ id: c.id, name: c.name, path: c.path, depth: c.depth })) };
  });

  app.get('/api/categories', async (req) => ({ items: await categoriesWithCounts(req.viewer) }));

  app.get('/api/feed', async (req) => {
    const q = parse(feedQuery, req.query);
    const catIds = q.category ? await descendantIds(q.category) : null;
    if (q.category && !catIds) throw notFound('Kategori tidak ditemukan');
    if (q.sort === 'for_you') {
      const ids = await homeIds(req.viewer, seedOf(q.seed), catIds);
      const offset = Math.min(Number(q.cursor) || 0, ids.length);
      const slice = ids.slice(offset, offset + q.limit);
      return { items: summarize(await videosByIds(slice, req.viewer), req.viewer), nextCursor: offset + q.limit < ids.length ? String(offset + q.limit) : null };
    }
    const { sql, params } = FEED_SELECT(req.viewer);
    const [lw, lp] = discoverableSql();
    const where = [lw];
    const wp: unknown[] = [...lp];
    if (catIds) {
      where.push('v.category_id IN (?)');
      wp.push(catIds);
    }
    const cur = decodeCursor<{ k: string | number; id: number }>(q.cursor);
    if (cur) {
      if (q.sort === 'popular') {
        where.push('(v.view_count < ? OR (v.view_count = ? AND v.id < ?))');
        wp.push(cur.k, cur.k, cur.id);
      } else {
        where.push('(v.published_at < ? OR (v.published_at = ? AND v.id < ?))');
        wp.push(new Date(cur.k), new Date(cur.k), cur.id);
      }
    }
    const order = q.sort === 'popular' ? 'v.view_count DESC, v.id DESC' : 'v.published_at DESC, v.id DESC';
    const rows = await query<Row>(`${sql} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, [...params, ...wp, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > q.limit && last
        ? encodeCursor({ k: q.sort === 'popular' ? Number(last.view_count) : new Date(last.published_at).toISOString(), id: last.id })
        : null;
    return { items: summarize(page, req.viewer), nextCursor };
  });

  app.get('/api/search', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const q = parse(z.object({ q: z.string().max(200).default(''), cursor: z.coerce.number().int().min(0).max(500).optional() }), req.query);
    const plan = planSearch(q.q);
    if (!plan.phrase) return { items: [], playlists: [], nextCursor: null };
    const offset = q.cursor ?? 0;
    const limit = 20;
    const { sql, params } = FEED_SELECT(req.viewer);
    const [lw, lp] = discoverableSql();
    const scoreSql = plan.boolean ? 'MATCH(v.search_text) AGAINST(? IN BOOLEAN MODE)' : '0';
    const scoreParams = plan.boolean ? [plan.boolean] : [];
    const conds: string[] = [];
    const cp: unknown[] = [];
    if (plan.boolean) {
      conds.push(`(${scoreSql} > 0${plan.likeTokens.map(() => ' AND v.search_text LIKE ?').join('')})`);
      cp.push(...scoreParams, ...plan.likeTokens.map((t) => `%${escapeLike(t)}%`));
    } else {
      conds.push(`(${plan.likeTokens.map(() => 'v.search_text LIKE ?').join(' AND ')})`);
      cp.push(...plan.likeTokens.map((t) => `%${escapeLike(t)}%`));
    }
    conds.push('v.search_text LIKE ?');
    cp.push(`%${escapeLike(plan.phrase)}%`);
    const selectWithScore = sql.replace(' FROM videos v', `, (${scoreSql}) + (v.search_text LIKE ?) AS score FROM videos v`);
    const rows = await query<Row & { score: number }>(
      `${selectWithScore} WHERE ${lw} AND (${conds.join(' OR ')}) ORDER BY score DESC, v.view_count DESC, v.id DESC LIMIT ? OFFSET ?`,
      [...scoreParams, `%${escapeLike(plan.phrase)}%`, ...params, ...lp, ...cp, limit + 1, offset],
    );
    const page = rows.slice(0, limit);
    // Playlist publik yang judulnya cocok (hanya halaman pertama, maks 4).
    let playlists: unknown[] = [];
    if (!offset) {
      const pl = await query<PlaylistRow>(
        `SELECT p.id, p.public_id, p.title, p.owner_user_id, p.guest_hash, p.visibility, p.item_count, p.created_at, p.updated_at,
                u.username AS owner_username, u.display_name AS owner_name
           FROM playlists p JOIN users u ON u.id = p.owner_user_id
          WHERE p.visibility = 'public' AND p.item_count > 0 AND p.title LIKE ?
          ORDER BY p.item_count DESC, p.updated_at DESC LIMIT 4`,
        [`%${escapeLike(plan.phrase)}%`],
      );
      playlists = await summarizePlaylists(pl, req.viewer);
    }
    return {
      items: summarize(page, req.viewer),
      playlists,
      nextCursor: rows.length > limit && offset + limit <= 500 ? String(offset + limit) : null,
    };
  });

  app.get('/api/search/suggest', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req) => {
    const q = parse(z.object({ q: z.string().max(100).default('') }), req.query);
    const plan = planSearch(q.q);
    if (!plan.phrase) return { items: [] };
    const [lw, lp] = discoverableSql();
    const like = escapeLike(plan.phrase);
    const rows = await query<{ title: string }>(
      `SELECT v.title FROM videos v WHERE ${lw} AND (v.search_text LIKE ? OR v.search_text LIKE ?) ORDER BY v.view_count DESC, v.id DESC LIMIT 12`,
      [...lp, `${like}%`, `% ${like}%`],
    );
    const seen = new Set<string>();
    const items = rows.map((r) => r.title).filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true))).slice(0, 8);
    return { items };
  });

  app.get<{ Params: { id: string } }>('/api/videos/:id/related', async (req) => {
    const q = parse(
      z.object({
        cursor: z.coerce.number().int().min(0).max(60).optional(),
        limit: z.coerce.number().int().min(1).max(30).default(20),
        filter: z.enum(['all', 'channel', 'related']).default('all'),
        seed: z.string().max(16).optional(),
      }),
      req.query,
    );
    const v = await loadWatchable(req.params.id, req.viewer);
    const seed = seedOf(q.seed);
    const ids = await relatedIds(v, req.viewer, seed, q.filter);
    const offset = q.cursor ?? 0;
    const slice = ids.slice(offset, offset + q.limit);
    const page = { items: summarize(await videosByIds(slice, req.viewer), req.viewer), nextCursor: offset + q.limit < ids.length ? String(offset + q.limit) : null };
    if (offset > 0 || q.filter !== 'all') return page;
    // Halaman pertama: chip filter mana yang punya isi (kolom kanan halaman tonton).
    const [channel, related] = await Promise.all([relatedIds(v, req.viewer, seed, 'channel'), relatedIds(v, req.viewer, seed, 'related')]);
    return { ...page, chips: { channel: channel.length > 0, related: related.length > 0 } };
  });

  app.post<{ Params: { id: string } }>('/api/videos/:id/view', async (req) => {
    const v = await loadWatchable(req.params.id, req.viewer);
    const key = sha256Hex(`${viewerKeyFor(req)}|${v.id}`);
    if (!viewSeen.get(key)) {
      viewSeen.set(key, true);
      pendingViews.set(v.id, (pendingViews.get(v.id) ?? 0) + 1);
    }
    return { ok: true };
  });

  app.get<{ Params: { handle: string } }>('/api/channels/:handle', async (req) => {
    const q = parse(z.object({ tab: z.enum(['videos', 'playlists']).default('videos'), sort: z.enum(['latest', 'popular']).default('latest'), cursor: z.coerce.number().int().min(0).max(5000).optional() }), req.query);
    const handle = req.params.handle.replace(/^@/, '').toLowerCase();
    const mainHandle = settings.get('site.channel_handle').toLowerCase();
    let ownerId: number | null = null;
    let joinedAt: string | null = null;
    let channel;
    if (handle === mainHandle) {
      channel = channelOf({ owner_user_id: null, owner_username: null, owner_name: null, owner_color: null });
    } else {
      const u = await queryOne<{ id: number; username: string; display_name: string; avatar_color: string; avatar_key: string | null; status: string; created_at: Date }>(
        'SELECT id, username, display_name, avatar_color, avatar_key, status, created_at FROM users WHERE username = ?',
        [handle],
      );
      if (!u || u.status !== 'active') throw notFound('Channel tidak ditemukan');
      ownerId = u.id;
      joinedAt = new Date(u.created_at).toISOString();
      channel = channelOf({ owner_user_id: u.id, owner_username: u.username, owner_name: u.display_name, owner_color: u.avatar_color, owner_avatar_key: u.avatar_key });
    }
    // Pemilik yang membuka channel-nya sendiri juga melihat video privatnya (hanya dia).
    const isOwner = ownerId !== null && req.viewer.userId === ownerId;
    const [lw, lp] = channelVideosSql(req.viewer, ownerId);
    const countRow = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM videos v WHERE ${lw}`, lp);
    let items: unknown[] = [];
    let nextCursor: string | null = null;
    if (q.tab === 'videos') {
      const { sql, params } = FEED_SELECT(req.viewer);
      const offset = q.cursor ?? 0;
      const order = q.sort === 'popular' ? 'v.view_count DESC, v.id DESC' : 'v.published_at DESC, v.id DESC';
      const rows = await query<Row>(`${sql} WHERE ${lw} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, ...lp, PAGE + 1, offset]);
      items = summarize(rows.slice(0, PAGE), req.viewer);
      nextCursor = rows.length > PAGE ? String(offset + PAGE) : null;
    } else if (ownerId !== null) {
      // Tab Playlist: playlist publik milik user (channel utama tidak punya playlist).
      const offset = q.cursor ?? 0;
      const rows = await query<PlaylistRow>(
        `SELECT p.id, p.public_id, p.title, p.owner_user_id, p.guest_hash, p.visibility, p.item_count, p.created_at, p.updated_at,
                u.username AS owner_username, u.display_name AS owner_name
           FROM playlists p JOIN users u ON u.id = p.owner_user_id
          WHERE p.owner_user_id = ? AND (p.visibility = 'public' OR p.owner_user_id = ?) AND p.item_count > 0
          ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
        [ownerId, req.viewer.userId ?? -1, PAGE + 1, offset],
      );
      items = await summarizePlaylists(rows.slice(0, PAGE), req.viewer);
      nextCursor = rows.length > PAGE ? String(offset + PAGE) : null;
    }
    return { channel: { ...channel, videoCount: Number(countRow?.n ?? 0), joinedAt, isMain: ownerId === null, isOwner }, items, nextCursor };
  });
}

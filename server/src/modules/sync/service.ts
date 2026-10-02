import type { FastifyBaseLogger } from 'fastify';
import { exec, pool, query, queryOne } from '../../db.js';
import { isVideoId, newVideoId } from '../../lib/ids.js';
import { slugify, uniqueSlug } from '../../lib/slug.js';
import {
  fileExtension,
  isFolder,
  isIgnoredFolder,
  isSubtitleFile,
  isVideoFile,
  languageLabel,
  matchSubtitle,
  searchTextFrom,
  titleFromName,
  type DriveFile,
} from '../drive/classify.js';
import { DriveError, getStartPageToken, isDriveConfigured, listChanges, listChildren } from '../drive/client.js';
import { enqueueJob } from '../processing/queue.js';
import { settings } from '../settings/service.js';

export type SyncMode = 'full' | 'incremental';

export interface SyncResult {
  mode: SyncMode;
  startedAt: string;
  finishedAt: string | null;
  added: number;
  updated: number;
  restored: number;
  missing: number;
  categories: number;
  subtitles: number;
  changes?: number;
  error?: string;
}

export const syncState: { running: SyncMode | null; startedAt: string | null; last: SyncResult | null; pendingFullAt: number | null } = {
  running: null,
  startedAt: null,
  last: null,
  pendingFullAt: null,
};

let log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'> = console;
export function setSyncLogger(l: typeof log): void {
  log = l;
}

interface VideoRow {
  id: number;
  public_id: string;
  drive_file_id: string;
  drive_parent_id: string | null;
  category_id: number | null;
  title: string;
  file_name: string;
  md5: string | null;
  size_bytes: number;
  mime_type: string | null;
  status: string;
  prev_status: string | null;
  deleted_at: Date | null;
}

interface CategoryRow {
  id: number;
  drive_folder_id: string;
  parent_id: number | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  missing_at: Date | null;
}

const VIDEO_COLS =
  'id, public_id, drive_file_id, drive_parent_id, category_id, title, file_name, md5, size_bytes, mime_type, status, prev_status, deleted_at';

const toDate = (s?: string) => (s ? new Date(s) : null);

function emptyResult(mode: SyncMode): SyncResult {
  return { mode, startedAt: new Date().toISOString(), finishedAt: null, added: 0, updated: 0, restored: 0, missing: 0, categories: 0, subtitles: 0 };
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

async function resolveOwner(props: Record<string, string>): Promise<number | null> {
  const raw = props.dvOwner;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE id = ?', [Number(raw)]);
  return user?.id ?? null;
}

/** Insert/update satu video dari file Drive. Mengembalikan id video. */
async function upsertVideo(file: DriveFile, parentId: string, categoryId: number | null, existing: VideoRow | null, result: SyncResult): Promise<number> {
  const title = titleFromName(file.name);
  const meta = file.videoMediaMetadata;
  const durationMs = meta?.durationMillis ? Number(meta.durationMillis) : null;

  if (!existing) {
    const props = file.appProperties ?? {};
    const taken = isVideoId(props.dvVid) ? await queryOne('SELECT id FROM videos WHERE public_id = ?', [props.dvVid]) : null;
    const publicId = isVideoId(props.dvVid) && !taken ? props.dvVid : newVideoId();
    const ownerId = await resolveOwner(props);
    const visibility = ownerId && props.dvVis === 'private' ? 'private' : 'public';
    const res = await exec(
      `INSERT INTO videos (public_id, drive_file_id, drive_parent_id, category_id, owner_user_id, source, visibility, status,
                           title, search_text, file_name, mime_type, size_bytes, md5, duration_ms, width, height,
                           drive_created_at, drive_modified_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        file.id,
        parentId,
        categoryId,
        ownerId,
        ownerId ? 'upload' : 'drive',
        visibility,
        title,
        searchTextFrom(title),
        file.name,
        file.mimeType,
        Number(file.size ?? 0),
        file.md5Checksum ?? null,
        durationMs,
        meta?.width ?? null,
        meta?.height ?? null,
        toDate(file.createdTime),
        toDate(file.modifiedTime),
        toDate(file.createdTime) ?? new Date(),
      ],
    );
    result.added++;
    await enqueueJob('probe', { videoId: res.insertId });
    return res.insertId;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if (existing.title !== title) {
    set('title', title);
    set('search_text', searchTextFrom(title));
  }
  if (existing.file_name !== file.name) set('file_name', file.name);
  if (existing.drive_parent_id !== parentId) set('drive_parent_id', parentId);
  if (existing.category_id !== categoryId) set('category_id', categoryId);
  if (existing.mime_type !== file.mimeType) set('mime_type', file.mimeType);
  const size = Number(file.size ?? 0);
  if (Number(existing.size_bytes) !== size) set('size_bytes', size);

  const contentChanged = Boolean(existing.md5 && file.md5Checksum && existing.md5 !== file.md5Checksum);
  let reprobe = false;
  if (existing.deleted_at) {
    // Kembali muncul (restore dari Trash / dipindah balik).
    const prev = existing.prev_status;
    const keep = !contentChanged && (prev === 'ready' || prev === 'processing' || prev === 'failed');
    set('deleted_at', null);
    set('prev_status', null);
    set('status', keep ? prev : 'pending');
    reprobe = !keep;
    result.restored++;
  }
  if (contentChanged) {
    set('md5', file.md5Checksum);
    set('status', 'pending');
    set('original_playable', null);
    set('processing_error', null);
    set('drive_modified_at', toDate(file.modifiedTime));
    reprobe = true;
    await enqueueJob('delete_assets', { videoId: existing.id, payload: { mode: 'renditions' } });
  } else if (!existing.md5 && file.md5Checksum) {
    set('md5', file.md5Checksum);
  }

  if (sets.length) {
    await exec(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`, [...params, existing.id]);
    if (!existing.deleted_at) result.updated++;
  }
  if (reprobe) await enqueueJob('probe', { videoId: existing.id });
  return existing.id;
}

async function markMissing(ids: number[], result: SyncResult): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const res = await exec(
      `UPDATE videos SET prev_status = status, status = 'missing', deleted_at = UTC_TIMESTAMP()
        WHERE id IN (?) AND deleted_at IS NULL`,
      [chunk],
    );
    result.missing += res.affectedRows;
  }
}

// ---------------------------------------------------------------------------
// Subtitle
// ---------------------------------------------------------------------------

async function upsertSubtitle(file: DriveFile, videoId: number, lang: string | null): Promise<void> {
  const format = fileExtension(file.name) === 'vtt' ? 'vtt' : 'srt';
  await exec(
    `INSERT INTO subtitles (video_id, drive_file_id, lang, label, format, drive_modified_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE video_id = VALUES(video_id), lang = VALUES(lang), label = VALUES(label),
                             format = VALUES(format), drive_modified_at = VALUES(drive_modified_at)`,
    [videoId, file.id, lang, languageLabel(lang), format, toDate(file.modifiedTime)],
  );
}

/** Subtitle default per video: bahasa Indonesia bila ada, kalau tidak yang pertama. */
async function refreshDefaultSubtitle(videoIds: number[]): Promise<void> {
  for (const videoId of videoIds) {
    const subs = await query<{ id: number; lang: string | null }>('SELECT id, lang FROM subtitles WHERE video_id = ? ORDER BY id', [videoId]);
    const def = subs.find((s) => s.lang === 'id' || s.lang?.startsWith('id-')) ?? subs[0];
    await exec('UPDATE subtitles SET is_default = (id = ?) WHERE video_id = ?', [def?.id ?? 0, videoId]);
  }
}

// ---------------------------------------------------------------------------
// Full sync
// ---------------------------------------------------------------------------

interface FolderInfo {
  id: string;
  name: string;
  parentId: string;
}

async function fullSync(result: SyncResult): Promise<void> {
  const rootId = settings.get('drive.root_folder_id');
  if (!rootId) throw new Error('Folder sumber belum diatur');
  const includeSub = settings.get('drive.include_subfolders');
  const allowed = settings.get('upload.allowed_ext');
  const startToken = await getStartPageToken();

  // 1) Jelajah pohon folder (BFS). Error API di sini → batal tanpa menandai apa pun.
  const folders: FolderInfo[] = [];
  const videos: { file: DriveFile; parentId: string }[] = [];
  const subs: { file: DriveFile; parentId: string }[] = [];
  const queue = [rootId];
  while (queue.length) {
    const folderId = queue.shift()!;
    for await (const page of listChildren(folderId)) {
      for (const f of page) {
        if (isFolder(f)) {
          if (isIgnoredFolder(f) || !includeSub) continue;
          folders.push({ id: f.id, name: f.name, parentId: folderId });
          queue.push(f.id);
        } else if (isVideoFile(f, allowed)) videos.push({ file: f, parentId: folderId });
        else if (isSubtitleFile(f)) subs.push({ file: f, parentId: folderId });
      }
    }
  }

  // 2) Kategori (urutan BFS menjamin induk diproses dulu).
  const cats = await query<CategoryRow>('SELECT id, drive_folder_id, parent_id, name, slug, path, depth, missing_at FROM categories');
  const byFolder = new Map(cats.map((c) => [c.drive_folder_id, c]));
  const slugs = new Set(cats.map((c) => c.slug));
  const catIdByFolder = new Map<string, number>();
  const pathByFolder = new Map<string, { path: string; depth: number }>();
  const seenCats = new Set<number>();
  let order = 0;
  for (const f of folders) {
    const parentCatId = f.parentId === rootId ? null : (catIdByFolder.get(f.parentId) ?? null);
    const parentPath = f.parentId === rootId ? null : pathByFolder.get(f.parentId);
    const path = parentPath ? `${parentPath.path} / ${f.name}` : f.name;
    const depth = (parentPath?.depth ?? 0) + 1;
    pathByFolder.set(f.id, { path, depth });
    const existing = byFolder.get(f.id);
    order++;
    if (existing) {
      let slug = existing.slug;
      if (existing.name !== f.name) {
        slugs.delete(existing.slug);
        slug = uniqueSlug(slugify(f.name), slugs);
        slugs.add(slug);
      }
      if (existing.name !== f.name || existing.parent_id !== parentCatId || existing.path !== path || existing.depth !== depth || existing.missing_at) {
        await exec('UPDATE categories SET name = ?, slug = ?, parent_id = ?, path = ?, depth = ?, missing_at = NULL, sort_order = ? WHERE id = ?', [
          f.name,
          slug,
          parentCatId,
          path.slice(0, 1024),
          depth,
          order,
          existing.id,
        ]);
      }
      catIdByFolder.set(f.id, existing.id);
      seenCats.add(existing.id);
    } else {
      const slug = uniqueSlug(slugify(f.name), slugs);
      slugs.add(slug);
      const res = await exec(
        'INSERT INTO categories (drive_folder_id, parent_id, name, slug, path, depth, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [f.id, parentCatId, f.name, slug, path.slice(0, 1024), depth, order],
      );
      catIdByFolder.set(f.id, res.insertId);
      seenCats.add(res.insertId);
      result.categories++;
    }
  }
  const goneCats = cats.filter((c) => !seenCats.has(c.id) && !c.missing_at).map((c) => c.id);
  if (goneCats.length) await exec('UPDATE categories SET missing_at = UTC_TIMESTAMP() WHERE id IN (?)', [goneCats]);

  // 3) Video.
  const existingVideos = await query<VideoRow>(`SELECT ${VIDEO_COLS} FROM videos`);
  const byDriveId = new Map(existingVideos.map((v) => [v.drive_file_id, v]));
  const seenVideoIds = new Set<number>();
  const titlesByFolder = new Map<string, Map<string, number>>();
  for (const { file, parentId } of videos) {
    const categoryId = parentId === rootId ? null : (catIdByFolder.get(parentId) ?? null);
    const id = await upsertVideo(file, parentId, categoryId, byDriveId.get(file.id) ?? null, result);
    seenVideoIds.add(id);
    const titles = titlesByFolder.get(parentId) ?? new Map<string, number>();
    const title = titleFromName(file.name);
    if (!titles.has(title)) titles.set(title, id);
    titlesByFolder.set(parentId, titles);
  }
  const missingIds = existingVideos.filter((v) => !v.deleted_at && !seenVideoIds.has(v.id)).map((v) => v.id);
  await markMissing(missingIds, result);

  // 4) Subtitle.
  const seenSubs = new Set<string>();
  const touchedVideos = new Set<number>();
  for (const { file, parentId } of subs) {
    const titles = titlesByFolder.get(parentId);
    if (!titles) continue;
    const match = matchSubtitle(file.name, new Set(titles.keys()));
    if (!match) continue;
    const videoId = titles.get(match.title)!;
    await upsertSubtitle(file, videoId, match.lang);
    seenSubs.add(file.id);
    touchedVideos.add(videoId);
    result.subtitles++;
  }
  const existingSubs = await query<{ id: number; drive_file_id: string; video_id: number }>('SELECT id, drive_file_id, video_id FROM subtitles');
  const goneSubs = existingSubs.filter((s) => !seenSubs.has(s.drive_file_id));
  if (goneSubs.length) {
    await exec('DELETE FROM subtitles WHERE id IN (?)', [goneSubs.map((s) => s.id)]);
    goneSubs.forEach((s) => touchedVideos.add(s.video_id));
  }
  await refreshDefaultSubtitle([...touchedVideos]);

  const nowIso = new Date().toISOString();
  await settings.set({
    'drive.changes_page_token': startToken,
    'drive.last_full_sync_at': nowIso,
    'drive.last_sync_at': nowIso,
    'drive.last_sync_error': null,
  });
}

// ---------------------------------------------------------------------------
// Incremental sync (Changes API)
// ---------------------------------------------------------------------------

async function knownFolders(): Promise<{ rootId: string; catByFolder: Map<string, number> }> {
  const rootId = settings.get('drive.root_folder_id')!;
  const cats = await query<{ id: number; drive_folder_id: string }>('SELECT id, drive_folder_id FROM categories WHERE missing_at IS NULL');
  return { rootId, catByFolder: new Map(cats.map((c) => [c.drive_folder_id, c.id])) };
}

async function attachSubtitlesFor(videoId: number, title: string, parentId: string): Promise<number> {
  const escaped = title.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let n = 0;
  for await (const page of listChildren(parentId, `name contains '${escaped}'`)) {
    for (const f of page) {
      if (!isSubtitleFile(f)) continue;
      const match = matchSubtitle(f.name, new Set([title]));
      if (!match) continue;
      await upsertSubtitle(f, videoId, match.lang);
      n++;
    }
  }
  if (n) await refreshDefaultSubtitle([videoId]);
  return n;
}

async function incrementalSync(result: SyncResult): Promise<void> {
  let token = settings.get('drive.changes_page_token');
  if (!token) {
    result.mode = 'full';
    return fullSync(result);
  }
  const { rootId, catByFolder } = await knownFolders();
  const includeSub = settings.get('drive.include_subfolders');
  const allowed = settings.get('upload.allowed_ext');
  const inTree = (parent?: string) => Boolean(parent && (parent === rootId || (includeSub && catByFolder.has(parent))));
  const categoryFor = (parent: string) => (parent === rootId ? null : (catByFolder.get(parent) ?? null));
  let changeCount = 0;
  let needFull = false;

  for (;;) {
    let page;
    try {
      page = await listChanges(token);
    } catch (err) {
      if (err instanceof DriveError && (err.status === 400 || err.status === 404 || err.status === 410)) {
        log.warn({ err: err.message }, 'page token tidak valid → full sync');
        result.mode = 'full';
        return fullSync(result);
      }
      throw err;
    }
    for (const change of page.changes) {
      changeCount++;
      const file = change.file;
      if (!file || change.removed || file.trashed) {
        const v = await queryOne<{ id: number }>('SELECT id FROM videos WHERE drive_file_id = ? AND deleted_at IS NULL', [change.fileId]);
        if (v) await markMissing([v.id], result);
        const s = await queryOne<{ id: number; video_id: number }>('SELECT id, video_id FROM subtitles WHERE drive_file_id = ?', [change.fileId]);
        if (s) {
          await exec('DELETE FROM subtitles WHERE id = ?', [s.id]);
          await refreshDefaultSubtitle([s.video_id]);
        }
        if (catByFolder.has(change.fileId) || change.fileId === rootId) needFull = true;
        continue;
      }
      if (file.appProperties?.dvRole) continue;
      if (isFolder(file)) {
        if (file.id === rootId || catByFolder.has(file.id) || file.parents?.some((p) => inTree(p))) needFull = true;
        continue;
      }
      const parent = file.parents?.[0];
      if (isVideoFile(file, allowed)) {
        const existing = await queryOne<VideoRow>(`SELECT ${VIDEO_COLS} FROM videos WHERE drive_file_id = ?`, [file.id]);
        if (inTree(parent)) {
          const before = result.added;
          const id = await upsertVideo(file, parent!, categoryFor(parent!), existing, result);
          if (result.added > before) result.subtitles += await attachSubtitlesFor(id, titleFromName(file.name), parent!);
        } else if (existing && !existing.deleted_at) {
          await markMissing([existing.id], result);
        }
      } else if (isSubtitleFile(file)) {
        if (inTree(parent)) {
          const vids = await query<{ id: number; title: string }>('SELECT id, title FROM videos WHERE drive_parent_id = ? AND deleted_at IS NULL', [parent]);
          const titles = new Map(vids.map((v) => [v.title, v.id]));
          const match = matchSubtitle(file.name, new Set(titles.keys()));
          if (match) {
            const vid = titles.get(match.title)!;
            await upsertSubtitle(file, vid, match.lang);
            await refreshDefaultSubtitle([vid]);
            result.subtitles++;
            continue;
          }
        }
        const s = await queryOne<{ id: number; video_id: number }>('SELECT id, video_id FROM subtitles WHERE drive_file_id = ?', [file.id]);
        if (s) {
          await exec('DELETE FROM subtitles WHERE id = ?', [s.id]);
          await refreshDefaultSubtitle([s.video_id]);
        }
      }
    }
    if (page.nextPageToken) {
      token = page.nextPageToken;
      continue;
    }
    token = page.newStartPageToken ?? token;
    break;
  }

  result.changes = changeCount;
  await settings.set({ 'drive.changes_page_token': token, 'drive.last_sync_at': new Date().toISOString(), 'drive.last_sync_error': null });
  if (needFull) scheduleFullSync(30_000);
}

// ---------------------------------------------------------------------------
// Runner & penjadwal
// ---------------------------------------------------------------------------

export function canSync(): boolean {
  return isDriveConfigured() && Boolean(settings.get('drive.root_folder_id'));
}

/** Jalankan sinkronisasi (satu per waktu; dikunci juga di DB). */
export async function runSync(mode: SyncMode): Promise<SyncResult | null> {
  if (syncState.running || !canSync()) return null;
  const conn = await pool.getConnection();
  const result = emptyResult(mode);
  try {
    const [rows] = await conn.query<import('mysql2').RowDataPacket[]>("SELECT GET_LOCK('dv_sync', 0) AS l");
    if (Number(rows[0]?.l) !== 1) return null;
    syncState.running = mode;
    syncState.startedAt = result.startedAt;
    if (mode === 'full') {
      syncState.pendingFullAt = null;
      await fullSync(result);
    } else {
      await incrementalSync(result);
    }
    if (result.mode === 'full' || result.added || result.missing || result.restored) {
      log.info({ sync: result }, 'sinkronisasi selesai');
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    log.error({ err }, `sinkronisasi ${mode} gagal`);
    await settings.set({ 'drive.last_sync_error': `Sinkronisasi gagal: ${result.error}` }).catch(() => {});
  } finally {
    result.finishedAt = new Date().toISOString();
    syncState.last = result;
    syncState.running = null;
    syncState.startedAt = null;
    await conn.query("SELECT RELEASE_LOCK('dv_sync')").catch(() => {});
    conn.release();
  }
  return result;
}

/** Jadwalkan full sync (debounce) — dipakai saat ada perubahan folder. */
export function scheduleFullSync(delayMs: number): void {
  const at = Date.now() + delayMs;
  if (!syncState.pendingFullAt || syncState.pendingFullAt > at) syncState.pendingFullAt = at;
}

let timer: ReturnType<typeof setInterval> | undefined;
let lastIncremental = 0;

async function tick(): Promise<void> {
  if (syncState.running || !canSync()) return;
  const now = Date.now();
  const lastFull = Date.parse(settings.get('drive.last_full_sync_at') ?? '') || 0;
  const fullDue = now - lastFull >= settings.get('drive.full_sync_interval_min') * 60_000;
  const pendingDue = syncState.pendingFullAt != null && now >= syncState.pendingFullAt;
  if (fullDue || pendingDue) {
    await runSync('full');
    lastIncremental = Date.now();
  } else if (now - lastIncremental >= settings.get('drive.sync_interval_sec') * 1000) {
    lastIncremental = now;
    await runSync('incremental');
  }
}

export function startSyncScheduler(logger: typeof log): void {
  setSyncLogger(logger);
  if (timer) return;
  timer = setInterval(() => void tick(), 10_000);
  timer.unref();
  setTimeout(() => void tick(), 5_000).unref();
}

export function stopSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

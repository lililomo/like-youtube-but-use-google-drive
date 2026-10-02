/**
 * Job `yt_import` (lane download, satu per satu): unduh video YouTube ≤1080p dengan yt-dlp → upload ke folder Drive
 * (root atau folder kategori) → daftarkan sebagai video channel utama → pipeline biasa (probe, thumbnail, konversi).
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { config } from '../../config.js';
import { exec, queryOne } from '../../db.js';
import { freeBytes } from '../../lib/disk.js';
import { newVideoId } from '../../lib/ids.js';
import { searchTextFrom, titleFromName, type DriveFile } from '../drive/classify.js';
import { uploadFileFromDisk } from '../drive/client.js';
import { DeferJob, FatalJobError, type JobContext } from '../processing/handlers.js';
import { enqueueJob } from '../processing/queue.js';
import { settings } from '../settings/service.js';
import { downloadVideo, fetchInfo, MAX_HEIGHT, YtPermanentError } from './ytdlp.js';

export interface ImportRow {
  id: number;
  url: string;
  yt_id: string;
  title: string | null;
  phase: 'queued' | 'downloading' | 'uploading' | 'done';
  visibility: 'public' | 'private';
  category_id: number | null;
  video_id: number | null;
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm' };

/** Nama file Drive dari judul YouTube (judul video di aplikasi = nama file tanpa ekstensi). */
export function driveFileName(title: string, ytId: string, ext: string): string {
  const clean = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
    .trim();
  return `${clean || ytId}${ext}`;
}

async function targetFolder(categoryId: number | null): Promise<{ folderId: string; categoryId: number | null }> {
  const root = settings.get('drive.root_folder_id');
  if (!root) throw new FatalJobError('Folder Google Drive belum diatur (Studio → Pengaturan → Google Drive)');
  if (categoryId != null) {
    const cat = await queryOne<{ drive_folder_id: string; missing_at: Date | null }>('SELECT drive_folder_id, missing_at FROM categories WHERE id = ?', [categoryId]);
    if (cat && !cat.missing_at) return { folderId: cat.drive_folder_id, categoryId };
  }
  return { folderId: root, categoryId: null };
}

/** Daftarkan file Drive sebagai video channel utama (aman bila sinkron lebih dulu memasukkannya). */
async function registerVideo(imp: ImportRow, file: DriveFile, publicId: string, categoryId: number | null): Promise<number> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM videos WHERE drive_file_id = ?', [file.id]);
  if (existing) {
    await exec('UPDATE videos SET visibility = ?, category_id = ?, deleted_at = NULL WHERE id = ?', [imp.visibility, categoryId, existing.id]);
    return existing.id;
  }
  const title = titleFromName(file.name);
  const meta = file.videoMediaMetadata;
  try {
    const taken = await queryOne('SELECT id FROM videos WHERE public_id = ?', [publicId]);
    const res = await exec(
      `INSERT INTO videos (public_id, drive_file_id, drive_parent_id, category_id, owner_user_id, source, visibility, status,
                           title, search_text, file_name, mime_type, size_bytes, md5, duration_ms, width, height,
                           drive_created_at, drive_modified_at, published_at)
       VALUES (?, ?, ?, ?, NULL, 'drive', ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        taken ? newVideoId() : publicId,
        file.id,
        file.parents?.[0] ?? null,
        categoryId,
        imp.visibility,
        title,
        searchTextFrom(title),
        file.name,
        file.mimeType,
        Number(file.size ?? 0),
        file.md5Checksum ?? null,
        meta?.durationMillis ? Number(meta.durationMillis) : null,
        meta?.width ?? null,
        meta?.height ?? null,
        file.createdTime ? new Date(file.createdTime) : null,
        file.modifiedTime ? new Date(file.modifiedTime) : null,
      ],
    );
    return res.insertId;
  } catch (err) {
    // Sinkron memasukkan file yang sama tepat bersamaan → pakai baris itu.
    if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    const row = await queryOne<{ id: number }>('SELECT id FROM videos WHERE drive_file_id = ?', [file.id]);
    if (!row) throw err;
    await exec('UPDATE videos SET visibility = ?, category_id = ? WHERE id = ?', [imp.visibility, categoryId, row.id]);
    return row.id;
  }
}

export async function ytImport(ctx: JobContext): Promise<void> {
  const importId = Number(ctx.job.payload?.importId);
  const imp = await queryOne<ImportRow>('SELECT id, url, yt_id, title, phase, visibility, category_id, video_id FROM youtube_imports WHERE id = ?', [importId]);
  if (!imp) throw new FatalJobError('data impor tidak ditemukan');
  if (imp.phase === 'done') return;
  const target = await targetFolder(imp.category_id);

  const dir = join(config.STORAGE_DIR, 'tmp', `yt-${imp.id}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    await exec("UPDATE youtube_imports SET phase = 'downloading' WHERE id = ?", [imp.id]);
    ctx.setProgress(1);
    let info;
    try {
      info = await fetchInfo(imp.url, dir, ctx.signal);
    } catch (err) {
      if (err instanceof YtPermanentError) throw new FatalJobError(err.message);
      throw err;
    }
    if (info.isLive) throw new FatalJobError('Siaran langsung / premiere yang belum selesai tidak bisa diimpor');
    const quality = [info.height ? `${info.height}p` : null, info.vcodec, info.acodec].filter(Boolean).join(' ');
    await exec('UPDATE youtube_imports SET title = ?, channel = ?, duration_sec = ?, format_note = ?, size_bytes = ? WHERE id = ?', [
      info.title.slice(0, 500),
      info.channel?.slice(0, 200) ?? null,
      info.durationSec,
      quality.slice(0, 100) || null,
      info.sizeEstimate,
      imp.id,
    ]);

    // Unduhan (+ sisa ruang untuk penggabungan video+audio) tidak boleh menghabiskan disk.
    const minFree = settings.get('processing.min_free_disk_gb') * 1024 ** 3;
    const estimate = info.sizeEstimate ?? (info.durationSec ?? 3600) * 1_000_000; // ±8 Mbps bila ukuran tak diketahui
    if ((await freeBytes(dir)) < estimate * 2.2 + minFree) throw new DeferJob(30 * 60_000, 'ruang disk tidak cukup untuk mengunduh, ditunda 30 menit');

    let file: string;
    try {
      file = await downloadVideo(dir, info, (f) => ctx.setProgress(1 + f * 84), ctx.signal);
    } catch (err) {
      if (err instanceof YtPermanentError) throw new FatalJobError(err.message);
      throw err;
    }
    const size = (await stat(file)).size;
    const ext = extname(file).toLowerCase();

    await exec("UPDATE youtube_imports SET phase = 'uploading', size_bytes = ? WHERE id = ?", [size, imp.id]);
    ctx.setProgress(85);
    const publicId = newVideoId();
    const uploaded = await uploadFileFromDisk(
      file,
      {
        name: driveFileName(info.title, info.id, ext),
        mimeType: MIME[ext] ?? 'video/mp4',
        parents: [target.folderId],
        appProperties: { dv: '1', dvVid: publicId, dvVis: imp.visibility, dvSrc: 'youtube', dvYt: info.id },
      },
      { signal: ctx.signal, onProgress: (sent) => ctx.setProgress(85 + (sent / size) * 14) },
    );
    const videoId = await registerVideo(imp, uploaded, publicId, target.categoryId);
    await enqueueJob('probe', { videoId });
    await exec(
      "UPDATE youtube_imports SET phase = 'done', video_id = ?, drive_file_id = ?, size_bytes = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?",
      [videoId, uploaded.id, size, imp.id],
    );
    ctx.log.info({ importId: imp.id, yt: info.id, size, quality, maxHeight: MAX_HEIGHT }, 'impor YouTube selesai');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exec, query, queryOne } from '../../db.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { canEditVideo, type Viewer } from '../../plugins/access.js';
import { requireUser } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { fileExtension, searchTextFrom, titleFromName } from '../drive/classify.js';
import { DriveError, getFile, trashFile, updateFile } from '../drive/client.js';
import { rotatePublicAssetKeys } from '../processing/assets.js';
import { enqueueJob } from '../processing/queue.js';
import { settings } from '../settings/service.js';
import { invalidateStreamCache } from '../stream/routes.js';
import { VIDEO_SELECT, buildDetail, findVideo, toSummary, type VideoRecord } from './model.js';
import { unavailable } from './routes.js';
import { escapeLike } from './search.js';

/** Judul: 1–100 karakter (batas YouTube), tanpa karakter kontrol; spasi dirapikan. */
export const titleSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Judul tidak boleh kosong').max(100, 'Judul maksimal 100 karakter'));

const patchBody = z
  .object({
    title: titleSchema.optional(),
    visibility: z.enum(['public', 'private']).optional(),
    categoryId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan');

const driveFailed = (err: unknown) =>
  new AppError(502, 'DRIVE_ERROR', `Gagal memperbarui file di Google Drive${err instanceof Error ? `: ${err.message}` : ''}`);

/** Video yang boleh diubah viewer (pemilik/admin); selain itu 404 seragam bila tak terlihat, 403 bila terlihat. */
export async function loadEditable(publicId: string, viewer: Viewer): Promise<VideoRecord> {
  const v = await findVideo(publicId);
  if (!v || v.deleted_at) throw unavailable();
  if (!canEditVideo(v, viewer)) {
    if (v.visibility === 'private') throw unavailable();
    throw forbidden('Hanya pemilik video atau admin yang dapat mengubah video ini');
  }
  return v;
}

/** Nama file baru = judul + ekstensi asli. Judul yang disimpan diturunkan lagi dari nama file agar sama dengan hasil sinkronisasi. */
export function renamedFile(currentFileName: string, newTitle: string): { fileName: string; title: string } {
  const ext = fileExtension(currentFileName);
  const fileName = ext ? `${newTitle}.${ext}` : newTitle;
  return { fileName, title: titleFromName(fileName) };
}

/** Subtitle Drive dicocokkan lewat nama ("<judul>.id.srt") → ikut di-rename agar tidak hilang saat sinkron berikutnya. */
async function renameSubtitles(videoId: number, oldTitle: string, newTitle: string): Promise<void> {
  const subs = await query<{ drive_file_id: string }>('SELECT drive_file_id FROM subtitles WHERE video_id = ?', [videoId]);
  for (const s of subs) {
    try {
      const f = await getFile(s.drive_file_id, 'id,name');
      if (f.name.startsWith(`${oldTitle}.`)) await updateFile(s.drive_file_id, { name: `${newTitle}${f.name.slice(oldTitle.length)}` });
    } catch {
      /* best effort — sinkron berikutnya tetap konsisten untuk video */
    }
  }
}

async function moveToCategory(v: VideoRecord, categoryId: number | null): Promise<string> {
  let folderId: string | null;
  if (categoryId == null) {
    folderId = settings.get('drive.root_folder_id');
  } else {
    const cat = await queryOne<{ drive_folder_id: string; missing_at: Date | null }>('SELECT drive_folder_id, missing_at FROM categories WHERE id = ?', [categoryId]);
    if (!cat || cat.missing_at) throw new AppError(400, 'BAD_REQUEST', 'Kategori tidak ditemukan');
    folderId = cat.drive_folder_id;
  }
  if (!folderId) throw new AppError(409, 'CONFLICT', 'Folder Google Drive belum diatur');
  const current = await getFile(v.drive_file_id, 'id,parents');
  const parents = (current as { parents?: string[] }).parents ?? [];
  if (!parents.includes(folderId)) {
    await updateFile(v.drive_file_id, {}, { addParents: folderId, removeParents: parents.join(',') || undefined });
  }
  return folderId;
}

/** Ubah judul / visibilitas / kategori (dipakai halaman tonton, Video Anda, admin). */
export async function patchVideo(req: FastifyRequest, publicId: string, body: z.infer<typeof patchBody>) {
  const v = await loadEditable(publicId, req.viewer);
  const changes: Record<string, unknown> = {};

  if (body.title !== undefined && body.title !== v.title) {
    const { fileName, title } = renamedFile(v.file_name, body.title);
    try {
      await updateFile(v.drive_file_id, { name: fileName });
    } catch (err) {
      throw driveFailed(err);
    }
    await exec('UPDATE videos SET title = ?, search_text = ?, file_name = ? WHERE id = ?', [title, searchTextFrom(title), fileName, v.id]);
    await renameSubtitles(v.id, v.title, title);
    changes.title = { from: v.title, to: title };
  }

  if (body.categoryId !== undefined && body.categoryId !== v.category_id) {
    let parentId: string;
    try {
      parentId = await moveToCategory(v, body.categoryId);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw driveFailed(err);
    }
    await exec('UPDATE videos SET category_id = ?, drive_parent_id = ? WHERE id = ?', [body.categoryId, parentId, v.id]);
    changes.categoryId = body.categoryId;
  }

  if (body.visibility !== undefined && body.visibility !== v.visibility) {
    await exec('UPDATE videos SET visibility = ? WHERE id = ?', [body.visibility, v.id]);
    invalidateStreamCache(v.public_id);
    // URL thumbnail/storyboard lama (statis di /media) tidak boleh tetap bisa dibuka setelah privat.
    if (body.visibility === 'private') {
      await rotatePublicAssetKeys(v.id).catch((err) => req.log.warn({ err, video: v.public_id }, 'gagal merotasi kunci aset'));
    }
    // appProperties agar database bisa dibangun ulang dari Drive (best effort).
    updateFile(v.drive_file_id, { appProperties: { dv: '1', dvVid: v.public_id, dvVis: body.visibility } }).catch((err) =>
      req.log.warn({ err, video: v.public_id }, 'gagal memperbarui appProperties visibilitas'),
    );
    changes.visibility = body.visibility;
  }

  if (Object.keys(changes).length) await audit(req, 'video.update', { type: 'video', id: v.public_id }, changes);
  const fresh = await findVideo(publicId);
  return buildDetail(fresh!, req.viewer);
}

/** Hapus video: file Drive ke Trash, soft delete, aset dibersihkan, kuota pemilik dikembalikan. */
export async function deleteVideo(req: FastifyRequest, publicId: string): Promise<void> {
  const v = await loadEditable(publicId, req.viewer);
  try {
    await trashFile(v.drive_file_id);
  } catch (err) {
    if (!(err instanceof DriveError && err.status === 404)) throw driveFailed(err);
  }
  await exec("UPDATE videos SET prev_status = status, status = 'missing', deleted_at = UTC_TIMESTAMP() WHERE id = ?", [v.id]);
  if (v.owner_user_id && v.source === 'upload') {
    await exec('UPDATE users SET storage_used_bytes = GREATEST(0, CAST(storage_used_bytes AS SIGNED) - ?) WHERE id = ?', [Number(v.size_bytes), v.owner_user_id]);
  }
  invalidateStreamCache(v.public_id);
  await enqueueJob('delete_assets', { videoId: v.id, payload: { mode: 'all', publicId: v.public_id } });
  await audit(req, 'video.delete', { type: 'video', id: v.public_id }, { title: v.title });
}

const myVideosQuery = z.object({
  q: z.string().trim().max(100).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  status: z.enum(['ready', 'processing', 'failed']).optional(),
  cursor: z.coerce.number().int().min(0).max(100_000).optional(),
});
const MY_PAGE = 30;

/** Ringkasan video untuk tabel Studio (Video Anda & admin): status proses, progres job, ukuran, jumlah subtitle. */
export async function studioRows(rows: VideoRecord[], viewer: Viewer) {
  const ids = rows.map((r) => r.id);
  const progress = new Map<number, number>();
  const subs = new Map<number, number>();
  if (ids.length) {
    for (const r of await query<{ video_id: number; p: number }>(
      "SELECT video_id, MAX(progress) AS p FROM jobs WHERE video_id IN (?) AND status = 'running' GROUP BY video_id",
      [ids],
    )) progress.set(r.video_id, Number(r.p));
    for (const r of await query<{ video_id: number; n: number }>('SELECT video_id, COUNT(*) AS n FROM subtitles WHERE video_id IN (?) GROUP BY video_id', [ids]))
      subs.set(r.video_id, Number(r.n));
  }
  return rows.map((r) => ({
    ...toSummary(r, { ...viewer, role: 'admin' }),
    status: r.status,
    processingError: r.processing_error,
    processingProgress: progress.get(r.id) ?? null,
    sizeBytes: Number(r.size_bytes),
    subtitleCount: subs.get(r.id) ?? 0,
    source: r.source,
    ownerId: r.owner_user_id,
    categoryId: r.category_id,
  }));
}

export async function manageRoutes(app: FastifyInstance): Promise<void> {
  /** Video Anda (semua status, tanpa yang dihapus). */
  app.get('/api/me/videos', { preHandler: requireUser }, async (req, reply) => {
    const q = parse(myVideosQuery, req.query);
    const where = ['v.owner_user_id = ?', 'v.deleted_at IS NULL'];
    const params: unknown[] = [req.viewer.userId];
    if (q.q) {
      where.push('v.search_text LIKE ?');
      params.push(`%${escapeLike(q.q.toLowerCase())}%`);
    }
    if (q.visibility) {
      where.push('v.visibility = ?');
      params.push(q.visibility);
    }
    if (q.status === 'processing') where.push("v.status IN ('pending','processing')");
    else if (q.status) {
      where.push('v.status = ?');
      params.push(q.status);
    }
    const offset = q.cursor ?? 0;
    const rows = await query<VideoRecord>(`${VIDEO_SELECT} WHERE ${where.join(' AND ')} ORDER BY v.published_at DESC, v.id DESC LIMIT ? OFFSET ?`, [
      ...params,
      MY_PAGE + 1,
      offset,
    ]);
    const total = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM videos v WHERE ${where.join(' AND ')}`, params);
    reply.header('Cache-Control', 'private, no-store');
    return {
      items: await studioRows(rows.slice(0, MY_PAGE), req.viewer),
      total: Number(total?.n ?? 0),
      nextCursor: rows.length > MY_PAGE ? String(offset + MY_PAGE) : null,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/videos/:id', { preHandler: requireUser }, async (req) => {
    const body = parse(patchBody, req.body);
    return patchVideo(req, req.params.id, body);
  });

  app.delete<{ Params: { id: string } }>('/api/videos/:id', { preHandler: requireUser }, async (req) => {
    await deleteVideo(req, req.params.id);
    return { ok: true };
  });
}

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { exec, query, queryOne } from '../../db.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';
import { decodeSubtitle, toWebVtt } from '../../lib/srt2vtt.js';
import { parse } from '../../lib/validate.js';
import { canEditVideo } from '../../plugins/access.js';
import { requireUser } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { languageLabel } from '../drive/classify.js';
import { DriveError, trashFile, uploadFileFromDisk } from '../drive/client.js';
import { loadEditable } from '../videos/manage.js';

const MAX_BYTES = 2 * 1024 * 1024;
const langSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'Kode bahasa tidak valid (mis. id, en, pt-BR)')
  .optional()
  .or(z.literal('').transform(() => undefined));

/** Pilih subtitle default: bahasa Indonesia bila ada, kalau tidak yang pertama. */
async function refreshDefault(videoId: number): Promise<void> {
  const subs = await query<{ id: number; lang: string | null }>('SELECT id, lang FROM subtitles WHERE video_id = ? ORDER BY id', [videoId]);
  const def = subs.find((s) => s.lang === 'id' || s.lang?.startsWith('id-')) ?? subs[0];
  await exec('UPDATE subtitles SET is_default = (id = ?) WHERE video_id = ?', [def?.id ?? 0, videoId]);
}

/** Subtitle untuk video milik sendiri (SPEC §11 butir 6): upload ke folder video di Drive dengan nama "<judul>.<lang>.<ext>". */
export async function subtitleManageRoutes(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_BYTES, files: 1, fields: 4, fieldSize: 100 } });

  app.post<{ Params: { id: string } }>('/api/videos/:id/subtitles', { preHandler: requireUser }, async (req, reply) => {
    const v = await loadEditable(req.params.id, req.viewer);
    const part = await req.file();
    if (!part) throw badRequest('Pilih file subtitle (.srt atau .vtt)');
    const ext = part.filename.toLowerCase().endsWith('.vtt') ? 'vtt' : part.filename.toLowerCase().endsWith('.srt') ? 'srt' : null;
    if (!ext) throw badRequest('Subtitle harus berformat .srt atau .vtt');
    const buf = await part.toBuffer().catch(() => {
      throw badRequest('Ukuran subtitle maksimal 2 MB');
    });
    if (part.file.truncated) throw badRequest('Ukuran subtitle maksimal 2 MB');
    const langField = part.fields.lang as { value?: string } | undefined;
    const lang = parse(langSchema, langField?.value ?? '') ?? null;
    // Validasi isi: harus bisa dibaca dan berisi minimal satu cue.
    const vtt = toWebVtt(decodeSubtitle(buf));
    if (!/-->/.test(vtt)) throw badRequest('File subtitle tidak berisi teks bertanda waktu');
    if (!v.drive_file_id) throw new AppError(409, 'CONFLICT', 'Video belum tersimpan di Google Drive');
    const parent = (await queryOne<{ drive_parent_id: string | null }>('SELECT drive_parent_id FROM videos WHERE id = ?', [v.id]))?.drive_parent_id;
    if (!parent) throw new AppError(409, 'CONFLICT', 'Folder video di Google Drive tidak diketahui');

    const name = `${v.title}${lang ? `.${lang}` : ''}.${ext}`;
    const tmp = join(config.STORAGE_DIR, 'tmp', `sub-${randomToken(8)}.${ext}`);
    await mkdir(join(config.STORAGE_DIR, 'tmp'), { recursive: true });
    await writeFile(tmp, buf);
    let file;
    try {
      file = await uploadFileFromDisk(tmp, { name, mimeType: ext === 'vtt' ? 'text/vtt' : 'application/x-subrip', parents: [parent] });
    } catch (err) {
      throw new AppError(502, 'DRIVE_ERROR', `Gagal mengupload subtitle ke Google Drive${err instanceof Error ? `: ${err.message}` : ''}`);
    } finally {
      await rm(tmp, { force: true });
    }
    const res = await exec(
      `INSERT INTO subtitles (video_id, drive_file_id, lang, label, format, drive_modified_at) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE video_id = VALUES(video_id), lang = VALUES(lang), label = VALUES(label)`,
      [v.id, file.id, lang, languageLabel(lang), ext, file.modifiedTime ? new Date(file.modifiedTime) : null],
    );
    await refreshDefault(v.id);
    await audit(req, 'subtitle.upload', { type: 'video', id: v.public_id }, { lang, name });
    reply.code(201);
    return { subtitle: { id: res.insertId, lang, label: languageLabel(lang), url: `/api/subtitles/${res.insertId}.vtt` } };
  });

  app.delete<{ Params: { id: string } }>('/api/subtitles/:id', { preHandler: requireUser }, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const sub = await queryOne<{ id: number; video_id: number; drive_file_id: string; owner_user_id: number | null; public_id: string }>(
      'SELECT s.id, s.video_id, s.drive_file_id, v.owner_user_id, v.public_id FROM subtitles s JOIN videos v ON v.id = s.video_id WHERE s.id = ?',
      [id],
    );
    if (!sub || !canEditVideo(sub, req.viewer)) throw notFound('Subtitle tidak ditemukan');
    try {
      await trashFile(sub.drive_file_id);
    } catch (err) {
      if (!(err instanceof DriveError && err.status === 404)) throw new AppError(502, 'DRIVE_ERROR', 'Gagal menghapus file subtitle di Google Drive');
    }
    await exec('DELETE FROM subtitles WHERE id = ?', [sub.id]);
    await refreshDefault(sub.video_id);
    await audit(req, 'subtitle.delete', { type: 'video', id: sub.public_id }, { subtitleId: sub.id });
    return { ok: true };
  });
}

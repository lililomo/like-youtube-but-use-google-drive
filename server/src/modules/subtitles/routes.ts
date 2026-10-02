import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { queryOne } from '../../db.js';
import { badRequest } from '../../lib/errors.js';
import { decodeSubtitle, toWebVtt } from '../../lib/srt2vtt.js';
import { mediaRequest } from '../drive/client.js';
import { loadWatchable } from '../videos/routes.js';

const MAX_SUB_BYTES = 5 * 1024 * 1024;
const cacheDir = () => join(config.STORAGE_DIR, 'cache', 'subs');

export async function subtitleRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { file: string } }>('/api/subtitles/:file', async (req, reply) => {
    const m = /^(\d{1,10})\.vtt$/.exec(req.params.file);
    if (!m) throw badRequest('Format subtitle tidak dikenal');
    const sub = await queryOne<{ id: number; drive_file_id: string; drive_modified_at: Date | null; public_id: string }>(
      'SELECT s.id, s.drive_file_id, s.drive_modified_at, v.public_id FROM subtitles s JOIN videos v ON v.id = s.video_id WHERE s.id = ?',
      [Number(m[1])],
    );
    if (!sub) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Subtitle tidak ditemukan' } });
    await loadWatchable(sub.public_id, req.viewer);

    const stamp = sub.drive_modified_at ? new Date(sub.drive_modified_at).getTime() : 0;
    const file = join(cacheDir(), `${sub.id}-${stamp}.vtt`);
    let vtt: string;
    if (existsSync(file)) {
      vtt = await readFile(file, 'utf8');
    } else {
      const res = await mediaRequest(sub.drive_file_id);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += (chunk as Buffer).length;
        if (size > MAX_SUB_BYTES) throw badRequest('File subtitle terlalu besar');
        chunks.push(chunk as Buffer);
      }
      vtt = toWebVtt(decodeSubtitle(Buffer.concat(chunks)));
      await mkdir(cacheDir(), { recursive: true });
      await writeFile(file, vtt);
    }
    return reply
      .header('Content-Type', 'text/vtt; charset=utf-8')
      .header('Cache-Control', 'private, max-age=3600')
      .send(vtt);
  });
}

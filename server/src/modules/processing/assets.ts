import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../../config.js';
import { exec, queryOne } from '../../db.js';
import { newAssetKey } from '../../lib/ids.js';

const publicDir = (...p: string[]) => join(config.STORAGE_DIR, 'public', ...p);

async function tryRename(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Ganti nama file thumbnail & folder storyboard ke kunci acak baru.
 * Dipakai saat video dijadikan privat: URL /media/… lama (yang mungkin sudah tersebar) langsung tidak berlaku.
 */
export async function rotatePublicAssetKeys(videoId: number): Promise<void> {
  const v = await queryOne<{ public_id: string; thumb_key: string | null; storyboard: string | { sheets?: string[] } | null }>(
    'SELECT public_id, thumb_key, storyboard FROM videos WHERE id = ?',
    [videoId],
  );
  if (!v) return;
  if (v.thumb_key) {
    const key = newAssetKey();
    for (const suffix of ['-480.webp', '-1280.webp', '-og.jpg']) {
      await tryRename(publicDir('thumbs', `${v.public_id}-${v.thumb_key}${suffix}`), publicDir('thumbs', `${v.public_id}-${key}${suffix}`));
    }
    await exec('UPDATE videos SET thumb_key = ? WHERE id = ? AND thumb_key = ?', [key, videoId, v.thumb_key]);
  }
  const sb = typeof v.storyboard === 'string' ? (JSON.parse(v.storyboard) as { sheets?: string[] }) : v.storyboard;
  const first = sb?.sheets?.[0];
  const m = first ? /^\/media\/sb\/([^/]+)\//.exec(first) : null;
  if (sb && m) {
    const oldDir = m[1]!;
    const newDir = `${v.public_id}-${newAssetKey()}`;
    await tryRename(publicDir('sb', oldDir), publicDir('sb', newDir));
    const next = { ...sb, sheets: sb.sheets!.map((s) => s.replace(`/media/sb/${oldDir}/`, `/media/sb/${newDir}/`)) };
    await exec('UPDATE videos SET storyboard = ? WHERE id = ?', [JSON.stringify(next), videoId]);
  }
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exec } from '../../db.js';
import { isVideoId } from '../../lib/ids.js';
import { parse } from '../../lib/validate.js';
import { ensureGuestId } from '../../plugins/auth.js';
import { loadWatchable } from '../videos/routes.js';
import { forgetViewerRanks } from './service.js';

const videoBody = z.object({ videoId: z.string().refine(isVideoId, 'ID video tidak valid') });

/** Umpan balik rekomendasi: "Tidak tertarik" (user atau tamu) & hapus histori tamu di server. */
export async function recommendRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/recommend/not-interested', async (req, reply) => {
    const { videoId } = parse(videoBody, req.body);
    const v = await loadWatchable(videoId, req.viewer);
    if (req.viewer.userId) {
      await exec('INSERT IGNORE INTO rec_feedback (user_id, video_id) VALUES (?, ?)', [req.viewer.userId, v.id]);
    } else {
      const guest = ensureGuestId(req, reply);
      await exec('INSERT IGNORE INTO rec_feedback (guest_hash, video_id) VALUES (?, ?)', [guest, v.id]);
    }
    forgetViewerRanks(req.viewer);
    return { ok: true };
  });

  app.delete<{ Params: { videoId: string } }>('/api/recommend/not-interested/:videoId', async (req) => {
    if (!isVideoId(req.params.videoId)) return { ok: true };
    const owner = req.viewer.userId ? ['user_id', req.viewer.userId] : req.viewer.guestHash ? ['guest_hash', req.viewer.guestHash] : null;
    if (owner) {
      await exec(`DELETE f FROM rec_feedback f JOIN videos v ON v.id = f.video_id WHERE f.${owner[0]} = ? AND v.public_id = ?`, [owner[1], req.params.videoId]);
      forgetViewerRanks(req.viewer);
    }
    return { ok: true };
  });

  // Tamu menghapus histori perangkat (halaman Histori) → sinyal rekomendasinya di server ikut dihapus.
  app.delete('/api/recommend/guest-history', async (req) => {
    if (!req.viewer.guestHash) return { ok: true, removed: 0 };
    const res = await exec('DELETE FROM guest_watch WHERE guest_hash = ?', [req.viewer.guestHash]);
    forgetViewerRanks(req.viewer);
    return { ok: true, removed: res.affectedRows };
  });

  app.delete<{ Params: { videoId: string } }>('/api/recommend/guest-history/:videoId', async (req) => {
    if (!req.viewer.guestHash || !isVideoId(req.params.videoId)) return { ok: true };
    await exec('DELETE g FROM guest_watch g JOIN videos v ON v.id = g.video_id WHERE g.guest_hash = ? AND v.public_id = ?', [req.viewer.guestHash, req.params.videoId]);
    forgetViewerRanks(req.viewer);
    return { ok: true };
  });
}

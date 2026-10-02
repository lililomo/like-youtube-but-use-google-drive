import type { FastifyInstance } from 'fastify';
import { notFound } from '../../lib/errors.js';
import { isVideoId } from '../../lib/ids.js';
import { canWatch } from '../../plugins/access.js';
import { buildDetail, buildSources, findVideo } from './model.js';

export const unavailable = () => notFound('Video tidak tersedia', 'VIDEO_UNAVAILABLE');

/** Video yang boleh ditonton viewer, atau 404 seragam (tidak membocorkan judul video privat). */
export async function loadWatchable(publicId: string, viewer: Parameters<typeof canWatch>[1]) {
  if (!isVideoId(publicId)) throw unavailable();
  const v = await findVideo(publicId);
  if (!v || !canWatch(v, viewer)) throw unavailable();
  return v;
}

export async function videoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/videos/:id', async (req, reply) => {
    const v = await loadWatchable(req.params.id, req.viewer);
    reply.header('Cache-Control', 'private, no-store');
    return buildDetail(v, req.viewer);
  });

  app.get<{ Params: { id: string } }>('/api/videos/:id/sources', async (req, reply) => {
    const v = await loadWatchable(req.params.id, req.viewer);
    reply.header('Cache-Control', 'private, no-store');
    const { sources, expireAt } = await buildSources(v, req.viewer);
    return { sources, sourcesExpireAt: expireAt };
  });
}

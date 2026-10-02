import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../db.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';
import { audit } from '../audit/service.js';
import { settings } from '../settings/service.js';
import { canSync, runSync, syncState } from './service.js';

export async function syncStatus() {
  const counts = await query<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM videos GROUP BY status',
  );
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
  const cats = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM categories WHERE missing_at IS NULL');
  return {
    canSync: canSync(),
    running: syncState.running,
    startedAt: syncState.startedAt,
    pendingFullAt: syncState.pendingFullAt ? new Date(syncState.pendingFullAt).toISOString() : null,
    last: syncState.last,
    lastSyncAt: settings.get('drive.last_sync_at'),
    lastFullSyncAt: settings.get('drive.last_full_sync_at'),
    lastError: settings.get('drive.last_sync_error'),
    videos: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      ready: byStatus.ready ?? 0,
      pending: byStatus.pending ?? 0,
      processing: byStatus.processing ?? 0,
      failed: byStatus.failed ?? 0,
      missing: byStatus.missing ?? 0,
    },
    categories: Number(cats?.n ?? 0),
  };
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/sync/status', { preHandler: requireAdmin }, async () => syncStatus());

  app.post('/api/admin/sync/run', { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(z.object({ mode: z.enum(['full', 'incremental']).default('full') }), req.body ?? {});
    if (!canSync()) throw badRequest('Hubungkan Google Drive dan pilih folder sumber terlebih dahulu');
    if (syncState.running) throw conflict(`Sinkronisasi ${syncState.running} sedang berjalan`);
    void runSync(body.mode);
    await audit(req, 'sync.run', null, { mode: body.mode });
    reply.code(202);
    return { started: true, mode: body.mode };
  });
}

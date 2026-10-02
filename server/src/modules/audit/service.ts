import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exec, query } from '../../db.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from '../../plugins/auth.js';

export interface AuditTarget {
  type: string;
  id: string | number;
}

/** Catat aksi ke audit_logs. Tidak pernah melempar (log saja bila gagal). */
export async function audit(
  req: FastifyRequest | null,
  action: string,
  target?: AuditTarget | null,
  meta?: Record<string, unknown> | null,
  userId?: number | null,
): Promise<void> {
  try {
    await exec('INSERT INTO audit_logs (user_id, action, target_type, target_id, meta, ip) VALUES (?, ?, ?, ?, ?, ?)', [
      userId !== undefined ? userId : (req?.viewer?.userId ?? null),
      action,
      target?.type ?? null,
      target ? String(target.id) : null,
      meta ? JSON.stringify(meta) : null,
      req?.ip ?? null,
    ]);
  } catch (err) {
    req?.log.warn({ err, action }, 'gagal menulis audit log');
  }
}

const listQuery = z.object({
  action: z.string().max(64).optional(),
  userId: z.coerce.number().int().positive().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/audit', { preHandler: requireAdmin }, async (req) => {
    const q = parse(listQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.action) {
      where.push('a.action LIKE ?');
      params.push(`${q.action}%`);
    }
    if (q.userId) {
      where.push('a.user_id = ?');
      params.push(q.userId);
    }
    if (q.cursor) {
      where.push('a.id < ?');
      params.push(q.cursor);
    }
    const rows = await query<{
      id: number;
      user_id: number | null;
      username: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      meta: string | null;
      ip: string | null;
      created_at: Date;
    }>(
      `SELECT a.id, a.user_id, u.username, a.action, a.target_type, a.target_id, a.meta, a.ip, a.created_at
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.id DESC LIMIT ?`,
      [...params, q.limit + 1],
    );
    const items = rows.slice(0, q.limit).map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      action: r.action,
      target: r.target_type ? { type: r.target_type, id: r.target_id } : null,
      meta: typeof r.meta === 'string' ? safeJson(r.meta) : r.meta,
      ip: r.ip,
      createdAt: new Date(r.created_at).toISOString(),
    }));
    return { items, nextCursor: rows.length > q.limit ? String(items[items.length - 1]?.id) : null };
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

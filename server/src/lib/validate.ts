import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse input dengan zod; error → 400 BAD_REQUEST dengan daftar field yang salah. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = fields[0];
    throw badRequest(first ? `Input tidak valid: ${first.path || 'body'} — ${first.message}` : 'Input tidak valid', fields);
  }
  return result.data;
}

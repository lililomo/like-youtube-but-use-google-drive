/** Util pencarian murni (SPEC §17) — mudah dites. Rekomendasi: modules/recommend. */
import { searchTextFrom } from '../drive/classify.js';

export interface SearchPlan {
  /** String BOOLEAN MODE untuk MATCH … AGAINST, atau null bila tidak ada token ≥ 3 huruf. */
  boolean: string | null;
  /** Token pendek (< 3 huruf) → dicari dengan LIKE. */
  likeTokens: string[];
  /** Frasa lengkap ternormalisasi (untuk LIKE cadangan). */
  phrase: string;
}

const MIN_FT = 3;

export function planSearch(q: string): SearchPlan {
  const phrase = searchTextFrom(q.replace(/[+\-<>()~*"@]/g, ' ')).slice(0, 100);
  const tokens = phrase.split(' ').filter(Boolean).slice(0, 10);
  const long = tokens.filter((t) => t.length >= MIN_FT);
  const short = tokens.filter((t) => t.length < MIN_FT);
  return { boolean: long.length ? long.map((t) => `+${t}*`).join(' ') : null, likeTokens: short, phrase };
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Kursor opak (base64url JSON). */
export function encodeCursor(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

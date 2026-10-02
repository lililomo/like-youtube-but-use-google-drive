/** Util pencarian & rekomendasi murni (SPEC §17) — mudah dites. */
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

const tokenSet = (s: string) => new Set(searchTextFrom(s).split(' ').filter((t) => t.length >= 2));

export function jaccard(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Jitter deterministik 0..1 dari string (seed = videoId + tanggal). */
export function seededJitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export interface RelatedCandidate {
  id: number;
  title: string;
  category_id: number | null;
  owner_user_id: number | null;
  view_count: number;
  published_at: Date | string;
}

export function relatedScore(
  base: { id: number; title: string; category_id: number | null; owner_user_id: number | null },
  c: RelatedCandidate,
  day: string,
  now = Date.now(),
): number {
  const sameCat = base.category_id != null && base.category_id === c.category_id ? 3 : 0;
  const sameOwner = base.owner_user_id === c.owner_user_id ? 2 : 0;
  const recent = now - new Date(c.published_at).getTime() <= 30 * 86400_000 ? 1 : 0;
  return sameCat + sameOwner + 1.5 * jaccard(base.title, c.title) + 0.5 * Math.log10(Number(c.view_count) + 1) + recent + seededJitter(`${base.id}:${c.id}:${day}`);
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

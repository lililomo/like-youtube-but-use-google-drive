import { deriveKey, hmacBase64Url, safeEqual } from './crypto.js';

/** URL stream bertanda tangan (SPEC §9.1). */
export const STREAM_TTL_SEC = 6 * 3600;
const streamKey = deriveKey('dv-stream');

export function streamSignature(publicId: string, q: string, exp: number, vk: string): string {
  return hmacBase64Url(streamKey, `${publicId}.${q}.${exp}.${vk}`).slice(0, 32);
}

/** vk = "-" untuk video publik, "u<userId>" untuk video privat (URL hanya berlaku dengan sesi user itu). */
export function viewerKey(visibility: 'public' | 'private', userId: number | null): string {
  return visibility === 'private' ? `u${userId ?? 0}` : '-';
}

export function signedStreamUrl(publicId: string, q: string, vk: string, nowMs = Date.now()): { url: string; exp: number } {
  const exp = Math.floor(nowMs / 1000) + STREAM_TTL_SEC;
  return { url: `/stream/${publicId}/${q}.mp4?e=${exp}&s=${streamSignature(publicId, q, exp, vk)}`, exp };
}

export type SigCheck = 'ok' | 'expired' | 'invalid';

export function verifyStream(publicId: string, q: string, e: unknown, s: unknown, vk: string, nowMs = Date.now()): SigCheck {
  if (typeof e !== 'string' || typeof s !== 'string' || !/^\d{9,11}$/.test(e) || s.length !== 32) return 'invalid';
  if (!safeEqual(streamSignature(publicId, q, Number(e), vk), s)) return 'invalid';
  if (Number(e) * 1000 < nowMs) return 'expired';
  return 'ok';
}

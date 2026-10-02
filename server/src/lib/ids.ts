import { randomBytes } from 'node:crypto';

/** ID publik video, 11 karakter base64url (seperti YouTube). */
export const newVideoId = (): string => randomBytes(8).toString('base64url');

/** ID publik playlist: "PL" + 22 karakter base64url. */
export const newPlaylistId = (): string => `PL${randomBytes(16).toString('base64url')}`;

/** ID upload: 22 karakter base64url. */
export const newUploadId = (): string => randomBytes(16).toString('base64url');

/** Kunci acak untuk nama file publik (thumbnail/storyboard), 12 karakter. */
export const newAssetKey = (): string => randomBytes(9).toString('base64url');

export const isVideoId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{11}$/.test(s);
export const isPlaylistId = (s: unknown): s is string => typeof s === 'string' && /^PL[A-Za-z0-9_-]{22}$/.test(s);
export const isUploadId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { appKeyBytes } from '../config.js';

/** Kunci turunan HKDF-SHA256 dari APP_KEY (SPEC §5.1). */
export function deriveKey(info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', appKeyBytes, Buffer.alloc(0), info, length));
}

const encKey = deriveKey('dv-enc');

/** AES-256-GCM → "v1:<iv b64>:<tag b64>:<ciphertext b64>". */
export function encrypt(plain: string, key: Buffer = encKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(token: string, key: Buffer = encKey): string {
  const parts = token.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('format ciphertext tidak dikenal');
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacBase64Url(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/** Perbandingan string waktu-konstan. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

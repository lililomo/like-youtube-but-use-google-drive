import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { badRequest } from './errors.js';

/**
 * Gambar unggahan user/admin (foto profil, logo, favicon).
 * Semua input — termasuk SVG — DI-RASTER ulang dengan sharp, sehingga file yang disajikan
 * tidak pernah berisi skrip/markup asli dan metadata (EXIF/GPS) ikut terbuang.
 */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'heif']);
export const IMAGE_CONTENT_TYPES = /^image\/(jpeg|png|webp|gif|svg\+xml|avif|heic|heif)$/;

export const publicDir = (...p: string[]) => join(config.STORAGE_DIR, 'public', ...p);

async function load(buf: Buffer): Promise<{ img: sharp.Sharp; meta: sharp.Metadata }> {
  if (buf.length === 0) throw badRequest('File gambar kosong');
  if (buf.length > IMAGE_MAX_BYTES) throw badRequest('Ukuran gambar maksimal 5 MB');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw badRequest('File bukan gambar yang didukung (JPG, PNG, WebP, GIF, SVG)');
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw badRequest('Format gambar tidak didukung (JPG, PNG, WebP, GIF, SVG)');
  }
  // SVG dirender pada densitas tinggi agar tetap tajam setelah diperkecil.
  const density = meta.format === 'svg' ? 288 : undefined;
  const img = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, density, animated: false, failOn: 'error' }).rotate();
  return { img, meta };
}

/** Foto profil: persegi 256×256 (crop ke area paling menarik), WebP. */
export async function renderAvatar(buf: Buffer): Promise<Buffer> {
  const { img } = await load(buf);
  return img
    .resize(256, 256, { fit: 'cover', position: sharp.strategy.attention })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 85 })
    .toBuffer();
}

export type LogoMode = 'icon' | 'full';

/**
 * Logo situs (PNG transparan).
 * - icon: gambar menggantikan ikon bulat merah, nama situs tetap ditulis di sebelahnya (maks 160×160).
 * - full: gambar menggantikan seluruh logo termasuk tulisan (tinggi 96 px, lebar maks 600 px).
 * Mode default ditebak dari rasio: lebar ≥ 1,6× tinggi → full.
 */
export async function renderLogo(buf: Buffer, mode?: LogoMode): Promise<{ png: Buffer; mode: LogoMode; width: number; height: number }> {
  const { img, meta } = await load(buf);
  const w = meta.autoOrient?.width ?? meta.width ?? 1;
  const h = meta.autoOrient?.height ?? meta.height ?? 1;
  const resolved: LogoMode = mode ?? (w / h >= 1.6 ? 'full' : 'icon');
  const out = await (resolved === 'full'
    ? img.resize({ height: 96, width: 600, fit: 'inside' })
    : img.resize({ height: 160, width: 160, fit: 'inside' })
  )
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return { png: out.data, mode: resolved, width: out.info.width, height: out.info.height };
}

/** Favicon: PNG persegi 64×64 (tab browser) dan 180×180 (apple-touch-icon), latar transparan. */
export async function renderFavicon(buf: Buffer): Promise<{ icon64: Buffer; icon180: Buffer }> {
  const { img } = await load(buf);
  const square = (size: number) =>
    img
      .clone()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  return { icon64: await square(64), icon180: await square(180) };
}

/** Tulis file publik (membuat folder bila perlu). */
export async function writePublic(subdir: string, name: string, data: Buffer): Promise<string> {
  const dir = publicDir(subdir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), data);
  return `/media/${subdir}/${name}`;
}

/** Hapus file di storage/public/<subdir> yang namanya diawali prefix, kecuali yang dipertahankan. */
export async function removePublic(subdir: string, prefix: string, keep: string[] = []): Promise<void> {
  let names: string[];
  try {
    names = await readdir(publicDir(subdir));
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((n) => n.startsWith(prefix) && !keep.includes(n))
      .map((n) => unlink(publicDir(subdir, n)).catch(() => {})),
  );
}

/** URL foto profil user (null = pakai avatar huruf). */
export function avatarUrl(userId: number, key: string | null | undefined): string | null {
  return key ? `/media/avatars/${userId}-${key}.webp` : null;
}

/**
 * Parser body gambar mentah (PUT dengan Content-Type image/*) — didaftarkan per plugin,
 * sehingga hanya berlaku di rute gambar (rute upload video memakai stream sendiri).
 */
export function registerImageParser(app: import('fastify').FastifyInstance): void {
  app.addContentTypeParser(IMAGE_CONTENT_TYPES, { parseAs: 'buffer', bodyLimit: IMAGE_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );
}

export function imageBody(body: unknown): Buffer {
  if (!Buffer.isBuffer(body)) throw badRequest('Kirim file gambar (JPG, PNG, WebP, GIF, SVG) sebagai isi permintaan');
  return body;
}

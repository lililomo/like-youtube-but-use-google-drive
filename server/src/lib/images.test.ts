import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { avatarUrl, renderAvatar, renderFavicon, renderLogo } from './images.js';

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();

describe('images', () => {
  it('avatar → WebP persegi 256 tanpa metadata', async () => {
    const out = await renderAvatar(await png(800, 500));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(meta.exif).toBeUndefined();
  });

  it('logo: mode ditebak dari rasio', async () => {
    const wide = await renderLogo(await png(900, 200));
    expect(wide.mode).toBe('full');
    expect(wide.height).toBe(96);
    const square = await renderLogo(await png(300, 300));
    expect(square.mode).toBe('icon');
    expect(square.width).toBe(160);
    const forced = await renderLogo(await png(300, 300), 'full');
    expect(forced.mode).toBe('full');
  });

  it('SVG berisi skrip di-raster menjadi PNG (skrip hilang)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><script>alert(1)</script><circle cx="32" cy="32" r="30" fill="red"/></svg>',
    );
    const out = await renderLogo(svg);
    expect((await sharp(out.png).metadata()).format).toBe('png');
    expect(out.png.includes(Buffer.from('alert'))).toBe(false);
  });

  it('foto profil menolak SVG', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(renderAvatar(svg)).rejects.toThrow(/JPG, PNG/);
  });

  it('favicon 64 & 180', async () => {
    const { icon64, icon180 } = await renderFavicon(await png(120, 60));
    expect((await sharp(icon64).metadata()).width).toBe(64);
    expect((await sharp(icon180).metadata()).height).toBe(180);
  });

  it('menolak data bukan gambar & file kosong', async () => {
    await expect(renderAvatar(Buffer.from('bukan gambar'))).rejects.toThrow(/gambar/);
    await expect(renderAvatar(Buffer.alloc(0))).rejects.toThrow(/kosong/);
  });

  it('avatarUrl', () => {
    expect(avatarUrl(5, null)).toBeNull();
    expect(avatarUrl(5, 'abc')).toBe('/media/avatars/5-abc.webp');
  });
});

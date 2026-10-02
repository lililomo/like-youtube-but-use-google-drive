import { describe, expect, it } from 'vitest';
import { applySiteHead, jsonForHtml } from './spa.js';

const INDEX = `<!doctype html><html><head><link rel="icon" href="/favicon.svg" type="image/svg+xml" /><title>GDrive Tube</title><!--DV_META--></head><body></body></html>`;
const site = (name: string, favicon: string | null = null) => ({
  title: name,
  faviconUrl: favicon,
  touchIconUrl: favicon ? '/media/branding/f-180.png' : null,
  boot: { name },
});

describe('applySiteHead', () => {
  it('mengganti title dengan nama situs (di-escape) & menyisipkan data awal', () => {
    const html = applySiteHead(INDEX, site('Video <Keluarga> & Teman'), null);
    expect(html).toContain('<title>Video &lt;Keluarga&gt; &amp; Teman</title>');
    expect(html).toContain('<script type="application/json" id="dv-site">');
    expect(html).not.toContain('<Keluarga>');
    expect(html).not.toContain('<!--DV_META-->');
  });

  it('favicon kustom menggantikan favicon bawaan', () => {
    const html = applySiteHead(INDEX, site('X', '/media/branding/f-64.png'), null);
    expect(html).toContain('href="/media/branding/f-64.png" type="image/png"');
    expect(html).not.toContain('/favicon.svg');
    expect(html).toContain('apple-touch-icon');
  });

  it('meta halaman (OG) menggantikan title bawaan', () => {
    const html = applySiteHead(INDEX, site('X'), '<title>Judul - X</title>');
    expect(html.match(/<title>/g)?.length).toBe(1);
    expect(html).toContain('<title>Judul - X</title>');
  });

  it('jsonForHtml tidak bisa menutup tag script', () => {
    const s = jsonForHtml({ name: '</script><script>alert(1)</script>' });
    expect(s).not.toContain('</script>');
    expect(JSON.parse(s)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});

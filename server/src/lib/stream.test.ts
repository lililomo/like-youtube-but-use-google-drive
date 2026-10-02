import { describe, expect, it } from 'vitest';
import { LruCache } from './lru.js';
import { normalizeRange } from './range.js';
import { signedStreamUrl, streamSignature, verifyStream, viewerKey } from './sign.js';
import { decodeSubtitle, toWebVtt } from './srt2vtt.js';

describe('signed stream URL', () => {
  const now = 1_790_000_000_000;
  it('valid lalu kedaluwarsa', () => {
    const { url, exp } = signedStreamUrl('abcdefghijk', 'orig', '-', now);
    const u = new URL(url, 'http://x');
    expect(u.pathname).toBe('/stream/abcdefghijk/orig.mp4');
    const e = u.searchParams.get('e')!;
    const s = u.searchParams.get('s')!;
    expect(Number(e)).toBe(exp);
    expect(verifyStream('abcdefghijk', 'orig', e, s, '-', now)).toBe('ok');
    expect(verifyStream('abcdefghijk', 'orig', e, s, '-', now + 7 * 3600_000)).toBe('expired');
  });
  it('menolak signature salah / parameter diubah / viewer berbeda', () => {
    const { url } = signedStreamUrl('abcdefghijk', '720', 'u5', now);
    const u = new URL(url, 'http://x');
    const e = u.searchParams.get('e')!;
    const s = u.searchParams.get('s')!;
    expect(verifyStream('abcdefghijk', '720', e, s, 'u5', now)).toBe('ok');
    expect(verifyStream('abcdefghijk', '720', e, s, 'u6', now)).toBe('invalid');
    expect(verifyStream('abcdefghijk', '360', e, s, 'u5', now)).toBe('invalid');
    expect(verifyStream('zzzzzzzzzzz', '720', e, s, 'u5', now)).toBe('invalid');
    expect(verifyStream('abcdefghijk', '720', String(Number(e) + 100), s, 'u5', now)).toBe('invalid');
    expect(verifyStream('abcdefghijk', '720', e, 'x'.repeat(32), 'u5', now)).toBe('invalid');
    expect(verifyStream('abcdefghijk', '720', undefined, s, 'u5', now)).toBe('invalid');
    expect(streamSignature('a', 'b', 1, '-')).toHaveLength(32);
  });
  it('viewer key', () => {
    expect(viewerKey('public', 3)).toBe('-');
    expect(viewerKey('private', 3)).toBe('u3');
    expect(viewerKey('private', null)).toBe('u0');
  });
});

describe('normalizeRange', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['bytes=0-1023', 'bytes=0-1023'],
    ['bytes=500-', 'bytes=500-'],
    ['bytes=-500', 'bytes=-500'],
    ['bytes=0-1,5-9', 'bytes=0-1'],
    ['bytes = 0-1', null],
    ['bytes=5-1', null],
    ['bytes=-', null],
    ['items=0-1', null],
    ['bytes=abc', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRange(input)).toBe(expected);
  });
});

describe('subtitle', () => {
  it('SRT → VTT', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:04,500\r\n{\\an8}Halo <i>dunia</i> <font color="red">merah</font>\r\n\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\nBaris 2\r\n';
    expect(toWebVtt(srt)).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.500\nHalo <i>dunia</i> merah\n\n2\n00:00:05.000 --> 00:00:06.000\nBaris 2\n');
  });
  it('VTT dibiarkan (hanya dibersihkan)', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    expect(toWebVtt(vtt)).toBe(vtt);
  });
  it('dekode BOM & encoding', () => {
    const text = 'Teks — é';
    expect(decodeSubtitle(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]))).toBe(text);
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeSubtitle(le)).toBe(text);
    expect(decodeSubtitle(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
  });
});

describe('LRU', () => {
  it('evict & ttl', () => {
    const c = new LruCache<string, number>(2, 1000);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    c.set('d', 4, -1);
    expect(c.get('d')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, hmacBase64Url, safeEqual, sha256Hex } from './crypto.js';
import { isPlaylistId, isUploadId, isVideoId, newAssetKey, newPlaylistId, newUploadId, newVideoId } from './ids.js';

describe('crypto', () => {
  it('encrypt/decrypt roundtrip termasuk unicode', () => {
    const plain = 'rahasia-🔐-1//0g-refresh-token';
    const ct = encrypt(plain);
    expect(ct.startsWith('v1:')).toBe(true);
    expect(ct).not.toContain(plain);
    expect(decrypt(ct)).toBe(plain);
  });

  it('ciphertext berbeda tiap kali (IV acak)', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'));
  });

  it('menolak ciphertext yang diubah', () => {
    const ct = encrypt('data penting');
    const parts = ct.split(':');
    const body = Buffer.from(parts[3]!, 'base64');
    body[0] = body[0]! ^ 0xff;
    parts[3] = body.toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('menolak format tak dikenal', () => {
    expect(() => decrypt('v2:a:b:c')).toThrow();
  });

  it('kunci turunan berbeda per info & deterministik', () => {
    expect(deriveKey('a').equals(deriveKey('a'))).toBe(true);
    expect(deriveKey('a').equals(deriveKey('b'))).toBe(false);
    expect(deriveKey('a')).toHaveLength(32);
  });

  it('sha256, hmac, safeEqual', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const k = deriveKey('t');
    expect(hmacBase64Url(k, 'x')).toBe(hmacBase64Url(k, 'x'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('ids', () => {
  it('format id', () => {
    for (let i = 0; i < 50; i++) {
      expect(isVideoId(newVideoId())).toBe(true);
      expect(isPlaylistId(newPlaylistId())).toBe(true);
      expect(isUploadId(newUploadId())).toBe(true);
      expect(newAssetKey()).toMatch(/^[A-Za-z0-9_-]{12}$/);
    }
    expect(newVideoId()).toHaveLength(11);
    expect(newPlaylistId()).toHaveLength(24);
  });

  it('validator menolak input salah', () => {
    expect(isVideoId('short')).toBe(false);
    expect(isVideoId('abc/def+ghi')).toBe(false);
    expect(isVideoId(123)).toBe(false);
    expect(isPlaylistId('XX' + 'a'.repeat(22))).toBe(false);
  });
});

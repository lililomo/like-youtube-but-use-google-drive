import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, escapeLike, jaccard, planSearch, relatedScore, seededJitter } from './search.js';

describe('planSearch', () => {
  it('token panjang → boolean, pendek → LIKE', () => {
    expect(planSearch('Belajar Matematika bab 1')).toEqual({ boolean: '+belajar* +matematika* +bab*', likeTokens: ['1'], phrase: 'belajar matematika bab 1' });
  });
  it('operator boolean dibuang (tidak bisa disuntikkan)', () => {
    expect(planSearch('+kucing -anjing "lucu" (x)').boolean).toBe('+kucing* +anjing* +lucu*');
  });
  it('kosong', () => {
    expect(planSearch('   ')).toEqual({ boolean: null, likeTokens: [], phrase: '' });
  });
  it('escapeLike', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('related', () => {
  it('jaccard', () => {
    expect(jaccard('Belajar Matematika Bab 1', 'Belajar Matematika Bab 2')).toBe(1);
    expect(jaccard('Lagu Satu Live', 'Lagu Dua Live')).toBeCloseTo(0.5, 2);
    expect(jaccard('a', '')).toBe(0);
  });
  it('jitter deterministik dalam 0..1', () => {
    const j = seededJitter('x');
    expect(j).toBe(seededJitter('x'));
    expect(j).toBeGreaterThanOrEqual(0);
    expect(j).toBeLessThan(1);
  });
  it('kategori & pemilik sama mendapat skor lebih tinggi', () => {
    const base = { id: 1, title: 'Lagu Satu', category_id: 5, owner_user_id: null };
    const now = Date.parse('2026-10-02');
    const same = relatedScore(base, { id: 2, title: 'Lagu Dua', category_id: 5, owner_user_id: null, view_count: 0, published_at: '2025-01-01' }, 'd', now);
    const other = relatedScore(base, { id: 3, title: 'Film', category_id: 9, owner_user_id: 7, view_count: 0, published_at: '2025-01-01' }, 'd', now);
    expect(same).toBeGreaterThan(other);
  });
  it('cursor', () => {
    const c = encodeCursor({ p: '2026-01-01', id: 3 });
    expect(decodeCursor(c)).toEqual({ p: '2026-01-01', id: 3 });
    expect(decodeCursor('!!rusak')).toBeNull();
  });
});

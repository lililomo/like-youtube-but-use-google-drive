import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, escapeLike, planSearch } from './search.js';

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

describe('cursor', () => {
  it('cursor', () => {
    const c = encodeCursor({ p: '2026-01-01', id: 3 });
    expect(decodeCursor(c)).toEqual({ p: '2026-01-01', id: 3 });
    expect(decodeCursor('!!rusak')).toBeNull();
  });
});

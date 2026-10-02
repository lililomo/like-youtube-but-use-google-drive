import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';

describe('slug', () => {
  it.each([
    ['Musik', 'musik'],
    ['Film & Aksi!', 'film-dan-aksi'],
    ['  Café Déjà Vu  ', 'cafe-deja-vu'],
    ['Belajar Matematika - Bab 1', 'belajar-matematika-bab-1'],
    ['日本語', 'kategori'],
    ['---', 'kategori'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
  it('unik', () => {
    expect(uniqueSlug('musik', new Set())).toBe('musik');
    expect(uniqueSlug('musik', new Set(['musik']))).toBe('musik-2');
    expect(uniqueSlug('musik', new Set(['musik', 'musik-2']))).toBe('musik-3');
  });
});

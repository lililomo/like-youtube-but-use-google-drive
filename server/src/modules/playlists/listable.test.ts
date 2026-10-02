import { describe, expect, it } from 'vitest';
import { isListable } from './routes.js';

const v = (o: Partial<Parameters<typeof isListable>[0]>) => ({ deleted_at: null, status: 'ready' as const, visibility: 'public' as const, owner_user_id: null, ...o });
const guest = { userId: null, role: 'guest' as const, guestHash: null };
const user7 = { userId: 7, role: 'user' as const, guestHash: null };
const admin = { userId: 1, role: 'admin' as const, guestHash: null };

describe('isListable (playlist)', () => {
  it('video privat channel utama tidak tampil untuk tamu', () => {
    expect(isListable(v({ visibility: 'private', owner_user_id: null }), guest)).toBe(false);
  });
  it('video privat milik sendiri tampil, milik orang lain tidak (admin pun tidak di halaman publik)', () => {
    expect(isListable(v({ visibility: 'private', owner_user_id: 7 }), user7)).toBe(true);
    expect(isListable(v({ visibility: 'private', owner_user_id: 7 }), admin)).toBe(false);
  });
  it('dihapus / belum siap tidak tampil', () => {
    expect(isListable(v({ deleted_at: new Date() }), user7)).toBe(false);
    expect(isListable(v({ status: 'processing' }), user7)).toBe(false);
    expect(isListable(v({}), guest)).toBe(true);
  });
});

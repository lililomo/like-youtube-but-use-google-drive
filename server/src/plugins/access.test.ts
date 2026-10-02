import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from '../lib/limiter.js';
import {
  canEditPlaylist,
  canEditVideo,
  canViewPlaylist,
  canWatch,
  discoverableSql,
  listableSql,
  type PlaylistAccessFields,
  type VideoAccessFields,
  type Viewer,
} from './access.js';

const guest: Viewer = { userId: null, role: 'guest', guestHash: 'g1' };
const otherGuest: Viewer = { userId: null, role: 'guest', guestHash: 'g2' };
const owner: Viewer = { userId: 10, role: 'user', guestHash: null };
const other: Viewer = { userId: 11, role: 'user', guestHash: null };
const admin: Viewer = { userId: 1, role: 'admin', guestHash: null };

const video = (o: Partial<VideoAccessFields>): VideoAccessFields => ({
  owner_user_id: 10,
  visibility: 'public',
  status: 'ready',
  deleted_at: null,
  ...o,
});

describe('canWatch', () => {
  const cases: [string, Partial<VideoAccessFields>, Viewer, boolean][] = [
    ['publik siap → tamu', {}, guest, true],
    ['publik siap → user lain', {}, other, true],
    ['privat → tamu', { visibility: 'private' }, guest, false],
    ['privat → user lain', { visibility: 'private' }, other, false],
    ['privat → pemilik', { visibility: 'private' }, owner, true],
    ['privat → admin', { visibility: 'private' }, admin, true],
    ['publik processing → tamu', { status: 'processing' }, guest, false],
    ['publik processing → pemilik', { status: 'processing' }, owner, true],
    ['publik pending → admin', { status: 'pending' }, admin, true],
    ['publik failed → user lain', { status: 'failed' }, other, false],
    ['missing → pemilik', { status: 'missing' }, owner, false],
    ['missing → admin', { status: 'missing' }, admin, false],
    ['terhapus → admin', { deleted_at: new Date() }, admin, false],
    ['channel utama (owner null) publik → tamu', { owner_user_id: null }, guest, true],
    ['channel utama privat → user', { owner_user_id: null, visibility: 'private' }, owner, false],
    ['channel utama privat → admin', { owner_user_id: null, visibility: 'private' }, admin, true],
  ];
  it.each(cases)('%s', (_name, fields, viewer, expected) => {
    expect(canWatch(video(fields), viewer)).toBe(expected);
  });

  it('tamu dengan userId null tidak dianggap pemilik video owner null', () => {
    expect(canWatch(video({ owner_user_id: null, visibility: 'private' }), guest)).toBe(false);
  });
});

describe('canEditVideo', () => {
  it('pemilik & admin saja', () => {
    expect(canEditVideo({ owner_user_id: 10 }, owner)).toBe(true);
    expect(canEditVideo({ owner_user_id: 10 }, admin)).toBe(true);
    expect(canEditVideo({ owner_user_id: 10 }, other)).toBe(false);
    expect(canEditVideo({ owner_user_id: 10 }, guest)).toBe(false);
    expect(canEditVideo({ owner_user_id: null }, owner)).toBe(false);
    expect(canEditVideo({ owner_user_id: null }, admin)).toBe(true);
  });
});

describe('playlist', () => {
  const pl = (o: Partial<PlaylistAccessFields>): PlaylistAccessFields => ({
    owner_user_id: 10,
    guest_hash: null,
    visibility: 'private',
    ...o,
  });

  it('publik terlihat semua orang, edit hanya pemilik/admin', () => {
    const p = pl({ visibility: 'public' });
    for (const v of [guest, other, owner, admin]) expect(canViewPlaylist(p, v)).toBe(true);
    expect(canEditPlaylist(p, owner)).toBe(true);
    expect(canEditPlaylist(p, admin)).toBe(true);
    expect(canEditPlaylist(p, other)).toBe(false);
    expect(canEditPlaylist(p, guest)).toBe(false);
  });

  it('privat user hanya pemilik & admin', () => {
    const p = pl({});
    expect(canViewPlaylist(p, owner)).toBe(true);
    expect(canViewPlaylist(p, admin)).toBe(true);
    expect(canViewPlaylist(p, other)).toBe(false);
    expect(canViewPlaylist(p, guest)).toBe(false);
  });

  it('playlist tamu hanya perangkat pembuat', () => {
    const p = pl({ owner_user_id: null, guest_hash: 'g1' });
    expect(canViewPlaylist(p, guest)).toBe(true);
    expect(canEditPlaylist(p, guest)).toBe(true);
    expect(canViewPlaylist(p, otherGuest)).toBe(false);
    expect(canEditPlaylist(p, otherGuest)).toBe(false);
    expect(canViewPlaylist(p, other)).toBe(false);
  });

  it('user login di perangkat yg sama tetap punya guestHash', () => {
    const p = pl({ owner_user_id: null, guest_hash: 'g1' });
    expect(canViewPlaylist(p, { userId: 11, role: 'user', guestHash: 'g1' })).toBe(true);
  });
});

describe('listableSql', () => {
  it('tamu: hanya publik (tanpa OR/owner, tidak cocok dengan owner NULL)', () => {
    const [sql, params] = listableSql(guest);
    expect(sql).toContain("v.status = 'ready'");
    expect(sql).toContain('v.deleted_at IS NULL');
    expect(sql).toContain("v.visibility = 'public'");
    expect(sql).not.toContain('owner_user_id');
    expect(params).toEqual([]);
    expect(listableSql(owner, 'x')[0]).toContain('x.owner_user_id = ?');
    expect(listableSql(owner)[1]).toEqual([10]);
  });
});

describe('discoverableSql', () => {
  it('hanya publik untuk semua (pemilik & admin pun tidak melihat video privat di beranda/cari/channel)', () => {
    const [sql, params] = discoverableSql();
    expect(sql).toBe("v.deleted_at IS NULL AND v.status = 'ready' AND v.visibility = 'public'");
    expect(sql).not.toContain('owner_user_id');
    expect(params).toEqual([]);
    expect(discoverableSql('x')[0]).toContain("x.visibility = 'public'");
  });
});

describe('AttemptLimiter', () => {
  it('memblokir setelah max kegagalan dalam jendela & lepas setelahnya', () => {
    const l = new AttemptLimiter(3, 1000);
    const t = 1_000_000;
    l.hit('k', t);
    l.hit('k', t + 1);
    expect(l.isBlocked('k', t + 2)).toBe(false);
    l.hit('k', t + 2);
    expect(l.isBlocked('k', t + 3)).toBe(true);
    expect(l.retryAfterSec('k', t + 3)).toBeGreaterThan(0);
    expect(l.isBlocked('k', t + 1001)).toBe(false);
    l.hit('k', t + 2000);
    l.reset('k');
    expect(l.isBlocked('k', t + 2001)).toBe(false);
  });
});

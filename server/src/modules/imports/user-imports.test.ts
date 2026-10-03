import { describe, expect, it } from 'vitest';
import { publicError, queueFromJobs } from './routes.js';
import { ownerLimitError, type OwnerLimits } from './service.js';

const GB = 1024 ** 3;
const base: OwnerLimits = { status: 'active', quotaBytes: null, usedBytes: 0, maxFileBytes: 10 * GB };

describe('ownerLimitError (impor pengguna = upload)', () => {
  it('lolos tanpa kuota & di bawah batas ukuran', () => {
    expect(ownerLimitError(base, 0)).toBeNull();
    expect(ownerLimitError(base, 10 * GB)).toBeNull();
  });

  it('pemilik hilang/nonaktif', () => {
    expect(ownerLimitError(null, 0)).toMatch(/dihapus atau dinonaktifkan/);
    expect(ownerLimitError({ ...base, status: 'disabled' }, 0)).toMatch(/dinonaktifkan/);
  });

  it('melebihi batas ukuran upload', () => {
    expect(ownerLimitError(base, 10 * GB + 1)).toMatch(/\(10\.00 GB\) melebihi batas upload 10 GB/);
  });

  it('kuota: used + ukuran > kuota ditolak dengan sisa kuota', () => {
    const o = { ...base, quotaBytes: 5 * GB, usedBytes: 4 * GB };
    expect(ownerLimitError(o, GB)).toBeNull();
    expect(ownerLimitError(o, GB + 1)).toMatch(/Kuota penyimpanan tidak cukup \(butuh 1\.00 GB, sisa 1\.00 GB\)/);
    expect(ownerLimitError({ ...o, usedBytes: 6 * GB }, 10 * 1024 ** 2)).toMatch(/butuh 10\.0 MB, sisa 0\.0 MB/);
  });
});

describe('queueFromJobs (antrean global lane download)', () => {
  it('urutan menunggu mengikuti urutan job; yang berjalan tidak diberi nomor', () => {
    const q = queueFromJobs([
      { id: 5, status: 'running' },
      { id: 7, status: 'queued' },
      { id: 9, status: 'queued' },
      { id: 12, status: 'queued' },
    ]);
    expect(q.running).toBe(1);
    expect(q.waiting).toBe(3);
    expect(q.position.get(5)).toBeUndefined();
    expect([7, 9, 12].map((id) => q.position.get(id))).toEqual([1, 2, 3]);
  });

  it('antrean kosong', () => {
    expect(queueFromJobs([])).toMatchObject({ waiting: 0, running: 0 });
  });
});

describe('publicError', () => {
  it('menyamarkan path server, URL & pesan biasa tetap', () => {
    expect(publicError("ENOSPC: no space left on device, write '/www/wwwroot/video.dymas.cloud/storage/tmp/yt-5/video.mp4'")).toBe(
      "ENOSPC: no space left on device, write '…'",
    );
    expect(publicError('spawn /www/wwwroot/x/storage/bin/yt-dlp ENOENT')).toBe('spawn … ENOENT');
    expect(publicError('Video ini privat di YouTube')).toBe('Video ini privat di YouTube');
    expect(publicError('lihat https://www.youtube.com/watch?v=abc')).toBe('lihat https://www.youtube.com/watch?v=abc');
    expect(publicError(null)).toBeNull();
  });
});

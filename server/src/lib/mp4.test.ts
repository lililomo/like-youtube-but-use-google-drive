import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localTopLevelBoxes, moovAfterMdat, readTopLevelBoxes } from './mp4.js';

const box = (type: string, payload = 0) => {
  const b = Buffer.alloc(8 + payload);
  b.writeUInt32BE(8 + payload, 0);
  b.write(type, 4, 'latin1');
  return b;
};
/** Kotak dengan ukuran 64-bit (size = 1). */
const largeBox = (type: string, payload: number) => {
  const b = Buffer.alloc(16 + payload);
  b.writeUInt32BE(1, 0);
  b.write(type, 4, 'latin1');
  b.writeBigUInt64BE(BigInt(16 + payload), 8);
  return b;
};
const reader = (buf: Buffer) => async (offset: number, length: number) => buf.subarray(offset, offset + length);
const boxesOf = (buf: Buffer) => readTopLevelBoxes(reader(buf), buf.length);

describe('mp4 top-level boxes', () => {
  it('faststart (moov sebelum mdat) → tidak perlu dirapikan', async () => {
    const buf = Buffer.concat([box('ftyp', 24), box('moov', 100), box('mdat', 1000)]);
    const boxes = await boxesOf(buf);
    expect(boxes?.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(moovAfterMdat(boxes)).toBe(false);
  });

  it('moov di akhir file → perlu faststart', async () => {
    const buf = Buffer.concat([box('ftyp', 24), box('free'), box('mdat', 1000), box('moov', 100)]);
    const boxes = await boxesOf(buf);
    expect(boxes?.map((b) => [b.type, b.offset])).toEqual([
      ['ftyp', 0],
      ['free', 32],
      ['mdat', 40],
      ['moov', 1048],
    ]);
    expect(moovAfterMdat(boxes)).toBe(true);
  });

  it('mdat 64-bit & kotak terakhir size 0', async () => {
    const tail = box('moov', 50);
    tail.writeUInt32BE(0, 0);
    const buf = Buffer.concat([box('ftyp', 8), largeBox('mdat', 500), tail]);
    const boxes = await boxesOf(buf);
    expect(boxes?.map((b) => [b.type, b.size])).toEqual([
      ['ftyp', 16],
      ['mdat', 516],
      ['moov', 58],
    ]);
    expect(moovAfterMdat(boxes)).toBe(true);
  });

  it('bukan MP4 / terpotong → null, dianggap tidak perlu', async () => {
    expect(await boxesOf(Buffer.from('\x1aE\xdf\xa3 webm/matroska bytes....', 'latin1'))).toBeNull();
    const truncated = Buffer.concat([box('ftyp', 8), box('mdat', 1000)]).subarray(0, 200);
    expect(await boxesOf(truncated)).toBeNull();
    expect(moovAfterMdat(null)).toBe(false);
  });

  describe('file lokal', () => {
    let dir = '';
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'dv-mp4-'));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });
    it('membaca header dari disk', async () => {
      const p = join(dir, 'a.mp4');
      await writeFile(p, Buffer.concat([box('ftyp', 24), box('mdat', 4096), box('moov', 64)]));
      expect(moovAfterMdat(await localTopLevelBoxes(p))).toBe(true);
    });
  });
});

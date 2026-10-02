import { open } from 'node:fs/promises';

/** Kotak (atom) tingkat atas MP4/MOV: ftyp, moov, mdat, free, … */
export interface Mp4Box {
  type: string;
  offset: number;
  size: number;
}

/**
 * Baca header kotak tingkat atas. `read(offset, length)` mengembalikan byte pada posisi tersebut
 * (file lokal atau Range ke Drive). Mengembalikan null bila struktur tidak dikenali.
 */
export async function readTopLevelBoxes(
  read: (offset: number, length: number) => Promise<Buffer>,
  fileSize: number,
  maxBoxes = 64,
): Promise<Mp4Box[] | null> {
  const boxes: Mp4Box[] = [];
  let off = 0;
  while (off + 8 <= fileSize && boxes.length < maxBoxes) {
    const h = await read(off, 16);
    if (h.length < 8) return null;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
    if (size === 1) {
      if (h.length < 16) return null;
      size = Number(h.readBigUInt64BE(8));
    } else if (size === 0) {
      size = fileSize - off; // kotak terakhir sampai akhir file
    }
    if (size < 8 || off + size > fileSize) return null;
    boxes.push({ type, offset: off, size });
    off += size;
  }
  return boxes;
}

/** true bila indeks `moov` terletak setelah `mdat` (bukan faststart): browser harus melompat ke akhir file sebelum bisa memutar. */
export function moovAfterMdat(boxes: Mp4Box[] | null): boolean {
  if (!boxes) return false;
  const moov = boxes.find((b) => b.type === 'moov');
  const mdat = boxes.find((b) => b.type === 'mdat');
  return Boolean(moov && mdat && moov.offset > mdat.offset);
}

export async function localTopLevelBoxes(path: string): Promise<Mp4Box[] | null> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    return await readTopLevelBoxes(async (offset, length) => {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    }, size);
  } finally {
    await fh.close();
  }
}

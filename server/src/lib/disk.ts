import { statfs } from 'node:fs/promises';

export async function freeBytes(path: string): Promise<number> {
  const s = await statfs(path);
  return s.bavail * s.bsize;
}

export async function diskInfo(path: string): Promise<{ free: number; total: number }> {
  const s = await statfs(path);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

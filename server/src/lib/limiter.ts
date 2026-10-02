/**
 * Pembatas percobaan sederhana (sliding window, in-memory, satu proses).
 * Dipakai untuk login: hitung kegagalan per IP & per username.
 */
export class AttemptLimiter {
  private readonly hits = new Map<string, number[]>();
  private ops = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  /** Detik sampai percobaan berikutnya diizinkan (0 bila tidak diblokir). */
  retryAfterSec(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.max) return 0;
    const oldest = list[list.length - this.max] ?? now;
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  hit(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
    if (++this.ops % 1000 === 0) this.prune(now);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const key of [...this.hits.keys()]) this.recent(key, now);
  }
}

/**
 * ABR sederhana untuk mode kualitas "Otomatis" (SPEC §16.6) — logika murni, waktu dalam ms.
 * - Turun satu tingkat bila ≥ 2 event `waiting` dalam 20 dtk, atau buffer < 3 dtk selama > 5 dtk saat bermain.
 * - Naik satu tingkat bila buffer > 30 dtk stabil selama 60 dtk, maks sekali per 2 menit.
 * Event `waiting` dalam 3 dtk setelah seek/ganti sumber diabaikan (wajar, bukan tanda bandwidth kurang).
 */
export type AbrDecision = 'down' | 'up' | null;

export const ABR = {
  stallWindow: 20_000,
  stallCount: 2,
  lowBuffer: 3,
  lowBufferFor: 5_000,
  highBuffer: 30,
  highBufferFor: 60_000,
  upEvery: 120_000,
  graceAfterSeek: 3_000,
} as const;

export class AbrController {
  private waits: number[] = [];
  private lowSince: number | null = null;
  private highSince: number | null = null;
  private lastSwitch = -Infinity;
  private lastUp = -Infinity;
  private graceUntil = 0;

  /** Dipanggil saat seek / ganti sumber / video baru. */
  reset(now: number): void {
    this.waits = [];
    this.lowSince = null;
    this.highSince = null;
    this.graceUntil = now + ABR.graceAfterSeek;
  }

  switched(now: number, dir: 'up' | 'down'): void {
    this.lastSwitch = now;
    if (dir === 'up') this.lastUp = now;
    this.reset(now);
  }

  onWaiting(now: number): AbrDecision {
    if (now < this.graceUntil) return null;
    this.waits = this.waits.filter((t) => now - t <= ABR.stallWindow);
    this.waits.push(now);
    return this.waits.length >= ABR.stallCount ? 'down' : null;
  }

  /** Panggil ±1×/detik. bufferAhead dalam detik; playing = sedang bermain (tidak jeda/seek). */
  onTick(now: number, bufferAhead: number, playing: boolean, nearEnd: boolean): AbrDecision {
    if (!playing || now < this.graceUntil) {
      this.lowSince = null;
      this.highSince = null;
      return null;
    }
    if (bufferAhead < ABR.lowBuffer && !nearEnd) {
      this.lowSince ??= now;
      if (now - this.lowSince > ABR.lowBufferFor) return 'down';
    } else {
      this.lowSince = null;
    }
    if (bufferAhead > ABR.highBuffer || nearEnd) {
      this.highSince ??= now;
      if (now - this.highSince >= ABR.highBufferFor && now - this.lastUp >= ABR.upEvery && now - this.lastSwitch >= ABR.upEvery / 2) {
        return 'up';
      }
    } else {
      this.highSince = null;
    }
    return null;
  }
}

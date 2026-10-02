import { describe, expect, it } from 'vitest';
import { ABR, AbrController } from './abr';

describe('ABR', () => {
  it('turun setelah 2 waiting dalam 20 dtk (di luar masa tenggang)', () => {
    const a = new AbrController();
    a.reset(0);
    expect(a.onWaiting(1_000)).toBeNull(); // masa tenggang setelah load
    expect(a.onWaiting(5_000)).toBeNull();
    expect(a.onWaiting(10_000)).toBe('down');
  });

  it('waiting berjauhan tidak memicu turun', () => {
    const a = new AbrController();
    a.reset(0);
    expect(a.onWaiting(5_000)).toBeNull();
    expect(a.onWaiting(30_000)).toBeNull();
  });

  it('buffer rendah > 5 dtk saat bermain → turun; jeda mereset', () => {
    const a = new AbrController();
    a.reset(0);
    expect(a.onTick(4_000, 1, true, false)).toBeNull();
    expect(a.onTick(8_000, 1, true, false)).toBeNull();
    expect(a.onTick(9_500, 1, true, false)).toBe('down');
    a.reset(10_000);
    expect(a.onTick(14_000, 1, false, false)).toBeNull();
    expect(a.onTick(20_000, 1, true, false)).toBeNull();
  });

  it('buffer tinggi stabil 60 dtk → naik, lalu tidak naik lagi < 2 menit', () => {
    const a = new AbrController();
    a.reset(0);
    let t = 4_000;
    let up = null;
    while (t < 4_000 + ABR.highBufferFor + 2_000 && !up) {
      up = a.onTick(t, 40, true, false);
      t += 1_000;
    }
    expect(up).toBe('up');
    a.switched(t, 'up');
    let again = null;
    for (let x = t + 4_000; x < t + 100_000; x += 1_000) again ??= a.onTick(x, 40, true, false);
    expect(again).toBeNull();
  });

  it('dekat akhir video: buffer kecil tidak dianggap masalah', () => {
    const a = new AbrController();
    a.reset(0);
    for (let x = 4_000; x < 20_000; x += 1_000) expect(a.onTick(x, 1, true, true)).not.toBe('down');
  });
});

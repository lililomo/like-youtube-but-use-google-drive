// Uji UI rekomendasi (REKOMENDASI.md): seed beranda, tombol Kembali, Tidak tertarik + Urungkan. BASE default instance uji.
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const SHOTS = process.env.SHOTS ?? '/root/dv-qa/shots';
let ok = 0, fail = 0;
const check = (name, cond, info = '') => { cond ? ok++ : fail++; console.log(`${cond ? 'OK  ' : 'GAGAL'} ${name}${info ? ` — ${info}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const titles = async () => {
  await page.waitForSelector('.dv-vcard__title a');
  return page.$$eval('.dv-vcard__title a', (as) => as.map((a) => a.textContent.trim()));
};
/** ID video kartu beranda (judul bisa kembar, mis. video yang sama diimpor beberapa kali). */
const cardIds = async () => {
  await page.waitForSelector('.dv-vcard__title a');
  return page.$$eval('.dv-vcard__title a', (as) => as.map((a) => new URL(a.href).searchParams.get('v')));
};
await page.goto(`${BASE}/`);
const first = await titles();
check('beranda tampil', first.length > 0, `${first.length} video`);
const chips = await page.$$eval('.dv-chip', (cs) => cs.map((c) => c.textContent.trim()));
check('chip Semua · Terbaru · Populer', chips.slice(0, 3).join('|') === 'Semua|Terbaru|Populer', chips.join('|'));
await page.screenshot({ path: `${SHOTS}/rec-home.png` });
// Buka video lalu Kembali → urutan sama
await page.click('.dv-vcard__title a');
await page.waitForSelector('.dv-compact');
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/rec-watch.png` });
await page.goBack();
const back = await titles();
check('tombol Kembali memulihkan urutan yang sama', back.slice(0, 8).join('|') === first.slice(0, 8).join('|'));
// Klik logo beberapa kali → urutan berubah (seed baru)
let changed = false;
for (let i = 0; i < 4 && !changed; i++) {
  await page.click('.dv-logo');
  await page.waitForTimeout(600);
  const now = await titles();
  changed = now.slice(0, 8).join('|') !== first.slice(0, 8).join('|');
}
check('klik logo (beranda dibuka lagi) → urutan baru', changed);
// Tidak tertarik
const target = (await titles())[0];
const targetId = (await cardIds())[0];
await page.hover('.dv-vcard >> nth=0');
await page.click('.dv-vcard >> nth=0 >> .dv-video-menu-btn');
await page.waitForSelector('text=Tidak tertarik');
await page.screenshot({ path: `${SHOTS}/rec-menu.png` });
const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/recommend/not-interested')), page.click('text=Tidak tertarik')]);
check('Tidak tertarik → API 200', res.status() === 200, String(res.status()));
await page.waitForSelector('.dv-dismissed');
await page.screenshot({ path: `${SHOTS}/rec-dismissed.png` });
check('kartu diganti pesan + Urungkan', (await page.textContent('.dv-dismissed')).includes('Urungkan'));
const [undo] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/recommend/not-interested/')), page.click('.dv-dismissed button')]);
check('Urungkan → API 200 & kartu kembali', undo.status() === 200 && !(await page.$('.dv-dismissed')) && (await titles())[0] === target);
await page.hover('.dv-vcard >> nth=0');
await page.click('.dv-vcard >> nth=0 >> .dv-video-menu-btn');
await Promise.all([page.waitForResponse((r) => r.url().includes('/api/recommend/not-interested')), page.click('text=Tidak tertarik')]);
await page.click('.dv-logo');
await page.waitForTimeout(700);
check('video tidak muncul lagi di beranda baru', !(await cardIds()).includes(targetId), `${target} (${targetId})`);
const csrf = (await ctx.cookies()).find((c) => c.name === 'dv_csrf')?.value ?? '';
const tid = await page.evaluate(async (t) => {
  const r = await fetch('/api/search?q=' + encodeURIComponent(t));
  return (await r.json()).items.find((v) => v.title === t)?.id;
}, target);
await page.request.delete(`${BASE}/api/recommend/not-interested/${tid}`, { headers: { 'X-CSRF-Token': csrf } });
// Tamu: progres terkirim (sinyal rekomendasi)
const vid = await page.$eval('.dv-vcard__title a', (a) => new URL(a.href).searchParams.get('v'));
const progress = page.waitForResponse((r) => r.url().endsWith('/api/progress') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
await page.goto(`${BASE}/watch?v=${vid}`);
await page.click('.dv-player', { timeout: 10000 }).catch(() => {});
const pr = await progress;
check('tamu mengirim progres', pr?.status() === 204, String(pr?.status()));
check('dv_gid dibuat untuk tamu', (await ctx.cookies()).some((c) => c.name === 'dv_gid'));
// Mobile
const m = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: 'light', isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(`${BASE}/`);
await mp.waitForSelector('.dv-vcard__title a');
await mp.screenshot({ path: `${SHOTS}/rec-home-mobile.png` });
check('mobile: tanpa scroll horizontal', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('tanpa error JS', errors.length === 0, errors.join(' | '));
console.log(`${ok}/${ok + fail} lulus`);
await browser.close();
process.exit(fail ? 1 : 0);

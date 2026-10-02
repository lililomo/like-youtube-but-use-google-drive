// Uji otomatis Step 14 (upload & Video Anda) di instance uji.
// Pemakaian: CHROME_PATH=… node upload-test.mjs <video-kecil.webm> <file-besar-acak.mp4>
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const SHOTS = process.env.SHOTS ?? '/root/dv-qa/shots';
const [small, big] = process.argv.slice(2);
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${name}${info ? ` — ${info}` : ''}`);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });

async function login(page, u, p) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', u);
  await page.fill('input[name=password]', p);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}
const itemStatus = (page) => page.locator('.dv-upitem__status').allTextContents();

try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'id-ID' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, 'budi', 'budi12345');

  // 1. Upload biasa lewat tombol Upload di masthead
  await page.click('.dv-create-btn');
  await page.waitForSelector('.dv-upload-drop');
  await page.screenshot({ path: `${SHOTS}/s14-dialog.png` });
  await page.setInputFiles('.dv-upload-dialog input[type=file][multiple]', small);
  await page.click('.dv-radio:has-text("Privat")');
  await page.screenshot({ path: `${SHOTS}/s14-details.png` });
  await page.click('.dv-upload-details__opts button:has-text("Upload")');
  await page.waitForSelector('.dv-upitem.is-done', { timeout: 30000 }).catch(() => {});
  check('upload kecil selesai', (await page.locator('.dv-upitem.is-done').count()) === 1, (await itemStatus(page)).join(' | '));
  await page.screenshot({ path: `${SHOTS}/s14-panel.png` });

  await page.goto(`${BASE}/my/videos`, { waitUntil: 'networkidle' });
  const rows = await page.locator('.dv-studio-table__title').allTextContents();
  check('Video Anda menampilkan video baru', rows.length >= 1, rows.join(' | '));
  const firstVis = await page.locator('.dv-studio-table__row select').first().inputValue();
  check('visibilitas Privat tersimpan', firstVis === 'private', firstVis);
  await page.waitForSelector('.dv-status--ok', { timeout: 40000 }).catch(() => {});
  check('status berubah ke Siap (polling)', (await page.locator('.dv-status--ok').count()) >= 1, (await page.locator('.dv-status').allTextContents()).join(' | '));
  await page.screenshot({ path: `${SHOTS}/s14-myvideos.png` });

  // 2. File besar: jaringan putus di tengah → lanjut dari offset yang benar
  if (big) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 4 * 1024 * 1024 });
    await page.click('button:has-text("Upload video")');
    await page.setInputFiles('.dv-upload-dialog input[type=file][multiple]', big);
    await page.click('.dv-upload-details__opts button:has-text("Upload")');
    await page.waitForFunction(() => {
      const t = document.querySelector('.dv-upitem.is-uploading .dv-upitem__status')?.textContent ?? '';
      const m = /(\d+)%/.exec(t);
      return m && Number(m[1]) >= 30;
    }, null, { timeout: 60000 });
    await ctx.setOffline(true);
    await page.waitForSelector('.dv-upitem.is-retrying', { timeout: 30000 }).catch(() => {});
    check('offline → status "mencoba lagi"', (await page.locator('.dv-upitem.is-retrying').count()) === 1, (await itemStatus(page)).join(' | '));
    await page.screenshot({ path: `${SHOTS}/s14-retrying.png` });
    await page.waitForTimeout(2500);
    await ctx.setOffline(false);
    const bigName = big.split('/').pop();
    await page.waitForSelector(`.dv-upitem.is-done:has-text("${bigName}")`, { timeout: 120000 }).catch(() => {});
    check('online lagi → upload besar selesai', (await page.locator(`.dv-upitem.is-done:has-text("${bigName}")`).count()) === 1, (await itemStatus(page)).join(' | '));
    const me = await (await page.request.get(`${BASE}/api/me/videos`)).json();
    check('ukuran file besar di server sama persis', me.items.some((v) => v.sizeBytes === 41943040), me.items.map((v) => v.sizeBytes).join(','));

    // 3. Muat ulang di tengah upload → "Pilih file lagi" → lanjut
    await page.click('button:has-text("Upload video")');
    await page.setInputFiles('.dv-upload-dialog input[type=file][multiple]', big);
    await page.click('.dv-upload-details__opts button:has-text("Upload")');
    await page.waitForFunction(() => {
      const t = document.querySelector('.dv-upitem.is-uploading .dv-upitem__status')?.textContent ?? '';
      const m = /(\d+)%/.exec(t);
      return m && Number(m[1]) >= 25;
    }, null, { timeout: 60000 });
    page.once('dialog', (d) => void d.accept());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.dv-upitem.is-needs-file', { timeout: 15000 }).catch(() => {});
    const restoreText = (await itemStatus(page)).join(' | ');
    check('setelah reload: upload tertunda ditampilkan', (await page.locator('.dv-upitem.is-needs-file').count()) === 1, restoreText);
    await page.screenshot({ path: `${SHOTS}/s14-needs-file.png` });
    const pct = Number(/(\d+)%/.exec(restoreText)?.[1] ?? 0);
    await page.setInputFiles('.dv-upitem.is-needs-file input[type=file]', big);
    await page.waitForSelector('.dv-upitem.is-done', { timeout: 120000 }).catch(() => {});
    check('pilih file sama → lanjut sampai selesai (bukan dari 0)', (await page.locator('.dv-upitem.is-done').count()) === 1 && pct > 0, `lanjut dari ${pct}%`);
  }
  check('tanpa error JS', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);

// Uji otomatis Step 12 (halaman tonton, histori, Anda) di instance uji.
// Pemakaian: CHROME_PATH=… node watch-test.mjs   (BASE default http://127.0.0.1:3299)
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const SHOTS = process.env.SHOTS ?? '/root/dv-qa/shots';
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${name}${info ? ` — ${info}` : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const feed = await (await fetch(`${BASE}/api/feed`)).json();
const playable = feed.items.find((v) => v.title.startsWith('Konser')) ?? feed.items[0];

async function login(page, u, p) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', u);
  await page.fill('input[name=password]', p);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}

async function admin() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'id-ID', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, 'admin', 'admin12345');
  await page.request.delete(`${BASE}/api/history`, { headers: { 'X-CSRF-Token': (await ctx.cookies()).find((c) => c.name === 'dv_csrf')?.value ?? '' } });
  await page.goto(`${BASE}/watch?v=${playable.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('pill visibilitas tampil untuk admin', (await page.locator('.dv-watch__actions button:has-text("Publik")').count()) === 1);
  check('chip kolom kanan', (await page.locator('.dv-watch__chips .dv-chip').count()) >= 2, String(await page.locator('.dv-watch__chips .dv-chip').allTextContents()));
  await page.screenshot({ path: `${SHOTS}/s12-watch-admin.png` });

  // Bagikan + Mulai pada
  await page.evaluate(() => {
    const v = document.querySelector('.dvp-video');
    v.pause();
    v.currentTime = 4.2;
  });
  await page.click('.dv-watch__actions button:has-text("Bagikan")');
  await page.waitForSelector('.dv-share');
  await page.click('.dv-share__start .dv-checkbox, .dv-share__start label');
  const shareUrl = await page.inputValue('.dv-share__input');
  check('Bagikan: "Mulai pada" menambah t=', /[?&]t=4$/.test(shareUrl), shareUrl);
  check('Bagikan: 4 tujuan', (await page.locator('.dv-share__target').count()) >= 4);
  await page.screenshot({ path: `${SHOTS}/s12-share.png` });
  await page.keyboard.press('Escape');

  // Ubah visibilitas → Privat → kembali Publik
  await page.click('.dv-watch__actions button:has-text("Publik")');
  await page.click('.dv-vis-menu .dv-menu-item:has-text("Privat")');
  await page.waitForTimeout(600);
  check('ubah ke Privat', (await page.locator('.dv-watch__actions button:has-text("Privat")').count()) === 1);
  const guestView = await (await fetch(`${BASE}/api/videos/${playable.id}`)).status;
  check('tamu tidak bisa membuka video privat', guestView === 404, String(guestView));
  await page.click('.dv-watch__actions button:has-text("Privat")');
  await page.click('.dv-vis-menu .dv-menu-item:has-text("Publik")');
  await page.waitForTimeout(600);

  // Ubah judul
  await page.click('.dv-watch__more');
  await page.click('.dv-popup .dv-menu-item:has-text("Ubah judul")');
  await page.fill('#dv-rename-form input', 'Konser Malam');
  await page.click('button[form="dv-rename-form"]');
  await page.waitForTimeout(800);
  check('ubah judul', (await page.locator('.dv-watch__title').textContent()).trim() === 'Konser Malam');
  await page.click('.dv-watch__more');
  await page.click('.dv-popup .dv-menu-item:has-text("Ubah judul")');
  await page.fill('#dv-rename-form input', 'Konser');
  await page.click('button[form="dv-rename-form"]');
  await page.waitForTimeout(800);

  // Progres → histori
  await page.evaluate(() => document.querySelector('.dvp-video').play());
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.dvp-video').pause());
  await page.waitForTimeout(800);
  // Pindah ke video lain (Berikutnya) lalu cek tombol Sebelumnya
  await page.mouse.move(400, 300);
  await page.click('.dvp-next');
  await page.waitForURL((u) => !u.toString().includes(playable.id));
  await page.waitForTimeout(1500);
  const hasPrev = await page.evaluate(() => document.querySelector('.dvp').dataset.hasPrev);
  check('tombol Sebelumnya tersedia setelah Berikutnya', hasPrev === 'true');
  await page.evaluate(() => (document.querySelector('.dvp-video').currentTime = 0));
  await page.mouse.move(400, 300);
  await page.click('.dvp-prev');
  await page.waitForTimeout(1200);
  check('Sebelumnya kembali ke video awal', page.url().includes(playable.id), page.url());

  await page.goto(`${BASE}/feed/history`, { waitUntil: 'networkidle' });
  const histTitles = await page.locator('.dv-history__title').allTextContents();
  check('histori berisi video yang ditonton', histTitles.some((t) => t.includes('Konser')), histTitles.join(' | '));
  check('histori dikelompokkan "Hari ini"', (await page.locator('.dv-history__day:has-text("Hari ini")').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/s12-history.png` });
  await page.locator('.dv-history__remove').first().click();
  await page.waitForTimeout(500);
  check('hapus satu item histori', (await page.locator('.dv-history__title').count()) === histTitles.length - 1);

  await page.goto(`${BASE}/feed/you`, { waitUntil: 'networkidle' });
  check('halaman Anda menampilkan nama user', (await page.locator('.dv-you__name').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/s12-you.png` });
  check('tanpa error JS (admin)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function guest() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', locale: 'id-ID' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/watch?v=${playable.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  check('tamu: tanpa aksi pemilik', (await page.locator('.dv-watch__more').count()) === 0);
  await page.evaluate(() => document.querySelector('.dvp-video').pause());
  await page.waitForTimeout(500);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dv.history') || '[]').map((h) => h.id));
  check('tamu: histori lokal tersimpan', stored.includes(playable.id), stored.join(','));
  await page.goto(`${BASE}/feed/history`, { waitUntil: 'networkidle' });
  check('tamu: halaman histori dari perangkat', (await page.locator('.dv-history__title').count()) >= 1);
  await page.goto(`${BASE}/watch?v=AAAAAAAAAAA`, { waitUntil: 'networkidle' });
  check('video tidak ada → "Video tidak tersedia"', (await page.locator('.dv-watch__unavailable:has-text("Video tidak tersedia")').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/s12-unavailable.png` });
  check('tanpa error JS (tamu)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

try {
  await admin();
  await guest();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);

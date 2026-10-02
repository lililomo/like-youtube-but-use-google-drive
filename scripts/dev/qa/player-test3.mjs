// Uji otomatis Step 11 (layar akhir, menu klik kanan, Media Session, sentuh, ABR) di instance uji.
// Pemakaian: CHROME_PATH=… node player-test3.mjs   (BASE default http://127.0.0.1:3299)
import { chromium, devices } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const SHOTS = process.env.SHOTS ?? '/root/dv-qa/shots';
const exe = process.env.CHROME_PATH;
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${name}${info ? ` — ${info}` : ''}`);
};

const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const feed = await (await fetch(`${BASE}/api/feed`)).json();
const byTitle = (p) => feed.items.find((v) => v.title.startsWith(p));
// Chromium build Playwright tidak punya codec H.264 → pakai video VP9/WebM ("Konser") untuk uji yang butuh pemutaran.
const shortVid = byTitle('Konser') ?? feed.items[0];

async function desktop() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'id-ID', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/watch?v=${shortVid.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const playing = await page.evaluate(() => !document.querySelector('.dvp-video').paused);
  check('autoplay berjalan', playing);

  // Media Session
  const ms = await page.evaluate(() => ({ title: navigator.mediaSession?.metadata?.title, artist: navigator.mediaSession?.metadata?.artist, state: navigator.mediaSession?.playbackState }));
  check('Media Session metadata', ms.title === shortVid.title, JSON.stringify(ms));

  // Menu klik kanan
  const box = await page.locator('.dvp').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.waitForTimeout(200);
  const ctxItems = await page.locator('.dvp-ctxmenu:not([hidden]) .dvp-ctxmenu__item').count();
  check('menu klik kanan tampil (3 item)', ctxItems === 3, String(ctxItems));
  await page.screenshot({ path: `${SHOTS}/s11-ctxmenu.png` });
  await page.click('.dvp-ctxmenu__item[data-act="loop"]');
  check('Ulangi → video.loop', await page.evaluate(() => document.querySelector('.dvp-video').loop));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.click('.dvp-ctxmenu__item[data-act="loop"]');
  await page.evaluate(() => (document.querySelector('.dvp-video').currentTime = 3.4));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.click('.dvp-ctxmenu__item[data-act="copytime"]');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Salin URL pada waktu saat ini', /\/watch\?v=[\w-]{11}&t=\d+$/.test(clip), clip);

  // Layar akhir: hitung mundur → video berikutnya
  const nextTitle = await page.locator('.dv-watch__secondary .dv-compact__title, .dv-watch__secondary h3').first().textContent().catch(() => null);
  await page.evaluate(() => {
    const v = document.querySelector('.dvp-video');
    v.currentTime = Math.max(0, v.duration - 0.5);
    v.play();
  });
  await page.waitForSelector('.dvp-endscreen.is-countdown:not([hidden])', { timeout: 5000 }).catch(() => {});
  const cd = await page.locator('.dvp-endscreen.is-countdown:not([hidden])').count();
  check('hitung mundur "Berikutnya" tampil', cd === 1);
  const cdTitle = await page.locator('.dvp-upnext__title').textContent().catch(() => '');
  check('judul berikutnya = rekomendasi pertama', !nextTitle || cdTitle.trim() === nextTitle.trim(), `${cdTitle} | ${nextTitle}`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/s11-countdown.png` });
  const urlBefore = page.url();
  await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 9000 }).catch(() => {});
  check('setelah hitung mundur pindah ke video berikutnya', page.url() !== urlBefore, page.url());
  await page.waitForTimeout(1500);
  check('layar akhir hilang di video baru', (await page.locator('.dvp-endscreen:not([hidden])').count()) === 0);

  // Batal → grid
  await page.goto(`${BASE}/watch?v=${shortVid.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const v = document.querySelector('.dvp-video');
    v.currentTime = Math.max(0, v.duration - 0.3);
    v.play();
  });
  await page.waitForSelector('.dvp-endscreen.is-countdown:not([hidden])', { timeout: 5000 }).catch(() => {});
  await page.click('.dvp-upnext__btn[data-act="cancel"]').catch(() => {});
  await page.waitForTimeout(300);
  check('Batal → grid rekomendasi', (await page.locator('.dvp-endscreen.is-grid:not([hidden]) .dvp-endgrid__item').count()) > 0);
  const urlNow = page.url();
  await page.waitForTimeout(6000);
  check('setelah Batal tidak pindah video', page.url() === urlNow);

  // Autoplay nonaktif → grid langsung, klik item → pindah
  await page.goto(`${BASE}/watch?v=${shortVid.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.click('.dvp-autoplay');
  await page.evaluate(() => {
    const v = document.querySelector('.dvp-video');
    v.currentTime = 0;
    v.play();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const v = document.querySelector('.dvp-video');
    v.currentTime = Math.max(0, v.duration - 0.3);
  });
  await page.waitForSelector('.dvp-endscreen.is-grid:not([hidden])', { timeout: 5000 }).catch(() => {});
  check('autoplay nonaktif → grid', (await page.locator('.dvp-endscreen.is-grid:not([hidden])').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/s11-grid.png` });
  const firstId = await page.locator('.dvp-endgrid__item').first().getAttribute('data-id');
  await page.locator('.dvp-endgrid__item').first().click();
  await page.waitForTimeout(800);
  check('klik item grid → pindah video', page.url().includes(firstId ?? '???'), page.url());
  await page.click('.dvp-autoplay').catch(() => {});
  check('tanpa error JS (desktop)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function mobile(name, device) {
  const ctx = await browser.newContext({ ...device, colorScheme: 'dark', locale: 'id-ID' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const vid = shortVid;
  await page.goto(`${BASE}/watch?v=${vid.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(`${name}: mode sentuh`, (await page.locator('.dvp[data-touch="true"]').count()) === 1);
  const box = await page.locator('.dvp').boundingBox();
  const progH = await page.evaluate(() => document.querySelector('.dvp-progress').getBoundingClientRect().height);
  check(`${name}: area sentuh progress 24px`, Math.round(progH) === 24, String(progH));
  // tap → kontrol tampil dengan tombol tengah
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(450);
  const center = await page.evaluate(() => getComputedStyle(document.querySelector('.dvp-mobile-center')).opacity);
  await page.screenshot({ path: `${SHOTS}/s11-${name}-controls.png` });
  check(`${name}: tombol tengah tampil setelah tap`, Number(center) > 0.5, center);
  // double-tap kanan akumulatif: 3 tap → +30
  await page.evaluate(() => {
    const v = document.querySelector('.dvp-video');
    v.currentTime = 0.2;
  });
  await page.waitForTimeout(300);
  const t0 = await page.evaluate(() => document.querySelector('.dvp-video').currentTime);
  // double-tap = 10 dtk, tiap tap tambahan ≤ 700 ms → +10 (4 tap = 30 dtk)
  for (let i = 0; i < 4; i++) {
    await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.4);
    await page.waitForTimeout(150);
  }
  const ripple = await page.locator('.dvp-ripple--right .dvp-ripple__text').textContent();
  await page.screenshot({ path: `${SHOTS}/s11-${name}-ripple.png` });
  await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => document.querySelector('.dvp-video').currentTime);
  check(`${name}: double-tap kanan akumulatif`, ripple?.trim() === '30 detik' && t1 > t0 + 5, `${t0.toFixed(1)} → ${t1.toFixed(1)}, ripple "${ripple}"`);
  check(`${name}: tanpa error JS`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function abr() {
  const vid = byTitle('Pemandangan');
  if (!vid) return check('ABR', false, 'video uji Pemandangan tidak ada');
  // Semua kualitas video ini dialihkan ke file WebM "Konser" (codec yang didukung Chromium ini);
  // path di video.src tetap menunjukkan kualitas yang dipilih pemutar.
  const konser = await (await fetch(`${BASE}/api/videos/${shortVid.id}/sources`)).json();
  const webmUrl = konser.sources.find((s) => s.q === 'orig').url;
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'id-ID' });
  // autoplay nonaktif agar tidak pindah video saat selesai; kualitas Otomatis
  await ctx.addInitScript(() => localStorage.setItem('dv.player', JSON.stringify({ volume: 1, muted: true, autoplay: false, quality: 'auto', captions: { on: false, lang: null } })));
  const page = await ctx.newPage();
  await page.route(`**/stream/${vid.id}/**`, (route) => route.continue({ url: new URL(webmUrl, BASE).toString() }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  // Jaringan lambat sejak sebelum navigasi: buffer video tidak pernah sempat penuh.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 40_000, uploadThroughput: 40_000 });
  await page.goto(`${BASE}/watch?v=${vid.id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.dvp-video', { timeout: 60_000 });
  await page.waitForFunction(() => new URL(document.querySelector('.dvp-video').src || 'x:/').pathname.includes('/stream/'), null, { timeout: 60_000 });
  const q0 = await page.evaluate(() => new URL(document.querySelector('.dvp-video').src).pathname);
  let q1 = q0;
  for (let i = 0; i < 60 && q1 === q0; i++) {
    await page.waitForTimeout(1000);
    q1 = await page.evaluate(() => new URL(document.querySelector('.dvp-video').src).pathname);
  }
  check('ABR turun kualitas saat jaringan lambat', q1 !== q0, `${q0} → ${q1}`);
  await ctx.close();
}

try {
  await desktop();
  await mobile('pixel', devices['Pixel 7']);
  await mobile('iphone', devices['iPhone 14']);
  await abr();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);

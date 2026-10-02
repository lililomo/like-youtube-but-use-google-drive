// Uji otomatis Step 13 (playlist) di instance uji.
// Pemakaian: CHROME_PATH=… node playlist-test.mjs   (BASE default http://127.0.0.1:3299)
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
const byTitle = (t) => feed.items.find((v) => v.title.startsWith(t));
const konser = byTitle('Konser');
const others = feed.items.filter((v) => v.id !== konser.id).slice(0, 3);
const stamp = Date.now().toString(36).slice(-4);

async function login(page, u, p) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', u);
  await page.fill('input[name=password]', p);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}
const csrf = async (ctx) => (await ctx.cookies()).find((c) => c.name === 'dv_csrf')?.value ?? '';

async function saveViaWatch(page, videoId, title, visibility) {
  await page.goto(`${BASE}/watch?v=${videoId}`, { waitUntil: 'networkidle' });
  await page.click('.dv-watch__actions button:has-text("Simpan")');
  await page.waitForSelector('.dv-save');
  await page.click('.dv-save__new');
  await page.fill('.dv-save__create input', title);
  if (visibility) await page.selectOption('.dv-save__create select', visibility);
  await page.click('.dv-save__create button[type=submit]');
  await page.waitForTimeout(600);
}

let guestCtx;
let publicPlaylistId;

async function guest() {
  guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'id-ID' });
  const page = await guestCtx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await saveViaWatch(page, konser.id, `Tamu ${stamp}`);
  await page.goto(`${BASE}/feed/playlists`, { waitUntil: 'networkidle' });
  const titles = await page.locator('.dv-plcard__title').allTextContents();
  check('tamu: playlist dibuat (perangkat ini)', titles.some((t) => t.includes(`Tamu ${stamp}`)), titles.join(' | '));
  check('tamu: playlist privat', (await page.locator('.dv-plcard:has-text("Tamu ' + stamp + '") .dv-private-tag').count()) === 1);
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto(`${BASE}/feed/playlists`, { waitUntil: 'networkidle' });
  check('tamu lain tidak melihat playlist tamu', (await op.locator(`.dv-plcard__title:has-text("Tamu ${stamp}")`).count()) === 0);
  await other.close();
  check('tanpa error JS (tamu)', errors.length === 0, errors.join(' | '));
}

async function admin() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'id-ID' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, 'admin', 'admin12345');
  await saveViaWatch(page, konser.id, `Publik ${stamp}`, 'public');
  const mine = await (await page.request.get(`${BASE}/api/playlists/mine`)).json();
  const pl = mine.items.find((p) => p.title === `Publik ${stamp}`);
  check('admin: playlist publik dibuat', pl?.visibility === 'public', JSON.stringify(pl?.visibility));
  publicPlaylistId = pl.id;
  // tambah 3 video lewat menu ⋮ kartu beranda
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  for (const v of others) {
    const card = page.locator(`.dv-vcard:has(a[href="/watch?v=${v.id}"])`).first();
    await card.hover();
    await card.locator('.dv-video-menu-btn').click();
    await page.click('.dv-popup .dv-menu-item:has-text("Simpan ke playlist")');
    await page.waitForSelector('.dv-save__row');
    await page.locator(`.dv-save__row:has-text("Publik ${stamp}") .dv-checkbox`).click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
  }
  await page.goto(`${BASE}/playlist?list=${pl.id}`, { waitUntil: 'networkidle' });
  const count = await page.locator('.dv-plitem').count();
  check('halaman playlist: 4 item', count === 4, String(count));
  await page.screenshot({ path: `${SHOTS}/s13-playlist.png` });
  // drag & drop via keyboard: item pertama ke posisi kedua
  const before = await page.locator('.dv-plitem__title').allTextContents();
  await page.locator('.dv-plitem__handle').first().focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  const detail = await (await page.request.get(`${BASE}/api/playlists/${pl.id}`)).json();
  const after = detail.items.map((v) => v.title);
  check('urutan ulang (drag & drop) tersimpan', after[0] === before[1].trim() && after[1] === before[0].trim(), `${before.slice(0, 2).join(',')} → ${after.slice(0, 2).join(',')}`);
  // hapus item terakhir
  const last = page.locator('.dv-plitem').last();
  await last.hover();
  await last.locator('.dv-plitem__menu button').click();
  await page.click('.dv-popup .dv-menu-item:has-text("Hapus dari playlist")');
  await page.waitForTimeout(600);
  check('hapus item', (await page.locator('.dv-plitem').count()) === 3);
  // ubah judul
  await page.click('button[aria-label="Ubah playlist"]');
  await page.fill('#dv-pl-edit input', `Publik ${stamp} baru`);
  await page.click('button[form="dv-pl-edit"]');
  await page.waitForTimeout(600);
  check('ubah judul playlist', (await page.locator('.dv-plpage__title').textContent()).includes('baru'));
  // putar semua → panel playlist
  await page.locator('.dv-plpage__play button:has-text("Putar semua")').click();
  await page.waitForURL(/\/watch\?v=.*list=/);
  await page.waitForSelector('.dv-plpanel');
  const sub = await page.locator('.dv-plpanel__sub').textContent();
  check('panel playlist "1 / 3"', /1 \/ 3/.test(sub), sub);
  await page.screenshot({ path: `${SHOTS}/s13-watch-panel.png` });
  check('pemutar mode playlist punya Berikutnya', (await page.evaluate(() => document.querySelector('.dvp').dataset.hasNext)) === 'true');
  await page.mouse.move(400, 300);
  await page.click('.dvp-next');
  await page.waitForTimeout(1200);
  const sub2 = await page.locator('.dv-plpanel__sub').textContent();
  check('Berikutnya → item 2 playlist', /2 \/ 3/.test(sub2) && page.url().includes('list='), sub2);
  // ulangi: di item terakhir, berikutnya kembali ke item 1
  await page.click('.dv-plpanel__controls button[aria-label^="Ulangi"]');
  await page.locator('.dv-plpanel__item').last().click();
  await page.waitForTimeout(1200);
  await page.mouse.move(400, 300);
  await page.click('.dvp-next');
  await page.waitForTimeout(1200);
  check('Ulangi: dari item terakhir ke item 1', /1 \/ 3/.test(await page.locator('.dv-plpanel__sub').textContent()));
  check('tanpa error JS (admin)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function publicView() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'id-ID' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/feed/playlists/public`, { waitUntil: 'networkidle' });
  const titles = await page.locator('.dv-plcard__title').allTextContents();
  check('Jelajahi Playlist menampilkan playlist publik', titles.some((t) => t.includes(`Publik ${stamp}`)), titles.join(' | '));
  check('Jelajahi tidak menampilkan playlist tamu/privat', !titles.some((t) => t.includes(`Tamu ${stamp}`)));
  await page.screenshot({ path: `${SHOTS}/s13-public.png` });
  await ctx.close();
}

async function importGuest() {
  const page = await guestCtx.newPage();
  await login(page, 'budi', 'budi12345');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.dv-dialog:has-text("Pindahkan playlist")', { timeout: 5000 }).catch(() => {});
  check('tawaran impor playlist tamu muncul', (await page.locator('.dv-dialog:has-text("Pindahkan playlist")').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/s13-import.png` });
  await page.click('.dv-dialog button:has-text("Pindahkan")');
  await page.waitForTimeout(800);
  const mine = await (await page.request.get(`${BASE}/api/playlists/mine`)).json();
  check('playlist tamu pindah ke akun', mine.items.some((p) => p.title === `Tamu ${stamp}` && !p.isGuest) && mine.guestCount === 0);
  await guestCtx.close();
}

try {
  await guest();
  await admin();
  await publicView();
  await importGuest();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);

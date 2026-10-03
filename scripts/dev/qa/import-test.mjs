// Uji otomatis impor YouTube untuk semua pengguna (/my/imports) + video privat di channel sendiri, di instance uji.
// Butuh yt-dlp palsu (tanpa YouTube asli): di /root/dv-qa/env.test set
//   YTDLP_PATH=<repo>/scripts/dev/fake-yt-dlp.mjs   (FAKE_YTDLP_DELAY_MS opsional, default 4000)
// lalu restart instance uji. User: admin/admin12345, budi/budi12345; citra dibuat bila belum ada.
// Pemakaian: CHROME_PATH=… node import-test.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const SHOTS = process.env.SHOTS ?? '/root/dv-qa/shots';
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

async function api(page, method, path, body) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'dv_csrf')?.value ?? '';
  const res = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, origin: BASE },
    data: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

const session = async (user, pass, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'id-ID', ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (user) await login(page, user, pass);
  return { ctx, page, errors };
};

const ytId = `imp${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}xx`;
const title = `Video uji ${ytId}`;

try {
  const admin = await session('admin', 'admin12345');
  await api(admin.page, 'POST', '/api/admin/users', { username: 'citra', displayName: 'Citra', password: 'citra12345' });
  await api(admin.page, 'PUT', '/api/admin/settings/upload', { youtube_import: true });
  const tool = await api(admin.page, 'GET', '/api/admin/imports/tool');
  check('yt-dlp palsu terpasang di instance uji', /fake/.test(tool.json?.version ?? ''), tool.json?.version ?? '');

  // 1. Tombol Upload → menu → Impor dari YouTube
  const budi = await session('budi', 'budi12345');
  const page = budi.page;
  await page.click('.dv-create-btn');
  const items = await page.locator('.dv-menu-item').allTextContents();
  check('menu Upload berisi Upload video & Impor dari YouTube', items.some((t) => t.includes('Upload video')) && items.some((t) => t.includes('Impor dari YouTube')), items.join(' | '));
  await page.click('.dv-menu-item:has-text("Impor dari YouTube")');
  await page.waitForURL((u) => u.pathname === '/my/imports');
  check('halaman /my/imports terbuka dengan tab aktif', (await page.locator('.dv-studio-tabs a.is-active').textContent())?.includes('Impor YouTube') === true);

  // 2. Tambah link privat → muncul di Antrean Anda
  await page.fill('textarea[aria-label="Link YouTube"]', `https://youtu.be/${ytId}`);
  await page.selectOption('select[aria-label="Visibilitas"]', 'private');
  await page.click('button:has-text("Tambah ke antrean")');
  const row = page.locator(`.dv-imp-item:has-text("${ytId}")`).first();
  await row.waitFor({ timeout: 10000 });
  const rowText = (await row.textContent()) ?? '';
  check('impor masuk Antrean Anda (menunggu/berjalan)', /Menunggu giliran|mengunduh|Menyimpan/.test(rowText), rowText.slice(0, 120));
  await page.screenshot({ path: `${SHOTS}/imp-queue.png`, fullPage: true });

  // 3. API pengguna: hanya miliknya, angka antrean, tanpa info channel pemilik lain
  const mine = await api(page, 'GET', '/api/imports');
  const imp = [...(mine.json?.active ?? []), ...(mine.json?.items ?? [])].find((i) => i.ytId === ytId);
  check(
    'API /api/imports: angka antrean & tanpa field owner',
    imp != null && typeof mine.json?.queue?.waiting === 'number' && !('owner' in imp) && (mine.json?.active ?? []).every((i) => !('owner' in i)),
    JSON.stringify(mine.json?.queue),
  );

  // 4. User lain tidak bisa melihat / membatalkan
  const citra = await session('citra', 'citra12345');
  const theirs = await api(citra.page, 'GET', '/api/imports');
  const leaked = [...(theirs.json?.active ?? []), ...(theirs.json?.items ?? [])].some((i) => i.ytId === ytId);
  const del = await api(citra.page, 'DELETE', `/api/imports/${imp?.id}`);
  const adminApi = await api(citra.page, 'GET', '/api/admin/imports');
  check('user lain: tidak melihat, tidak bisa batal (404), admin API 403', !leaked && del.status === 404 && adminApi.status === 403, `${del.status}/${adminApi.status}`);

  // 5. Selesai → riwayat, Video Anda
  const done = page.locator(`.dv-imp-item:has-text("${title}"):has-text("Selesai diimpor")`).first();
  await done.waitFor({ timeout: 90000 }).catch(() => {});
  check('impor selesai & tampil di Riwayat impor', await done.isVisible().catch(() => false));
  // Channel/beranda hanya memuat video berstatus siap → tunggu probe & thumbnail selesai.
  let finished;
  for (let i = 0; i < 60; i++) {
    const fin = await api(page, 'GET', '/api/imports');
    finished = (fin.json?.items ?? []).find((x) => x.ytId === ytId);
    if (finished?.video?.status === 'ready') break;
    await page.waitForTimeout(2000);
  }
  const videoId = finished?.video?.id;
  await page.goto(`${BASE}/my/videos`, { waitUntil: 'networkidle' });
  const titles = await page.locator('.dv-studio-table__title').allTextContents();
  check('video impor ada di Video Anda (milik budi) & siap', titles.some((t) => t.includes(title)) && finished?.video?.status === 'ready', `${videoId ?? '-'} ${finished?.video?.status ?? ''}`);

  // 6. Video privat: tampil di channel sendiri, tidak untuk orang lain / beranda
  const own = await api(page, 'GET', '/api/channels/budi');
  const other = await api(citra.page, 'GET', '/api/channels/budi');
  const guestCtx = await browser.newContext();
  const guest = await (await guestCtx.request.get(`${BASE}/api/channels/budi`)).json();
  const has = (d) => (d?.items ?? []).some((v) => v.id === videoId);
  check('channel sendiri menampilkan video privat (isOwner)', has(own.json) && own.json?.channel?.isOwner === true);
  check('channel dilihat user lain & tamu: video privat tidak ada', !has(other.json) && !has(guest) && other.json?.channel?.isOwner === false);
  const feed = await api(page, 'GET', '/api/feed?sort=latest&limit=48');
  check('beranda pemilik tetap tanpa video privat', !(feed.json?.items ?? []).some((v) => v.id === videoId));
  await page.goto(`${BASE}/@budi`, { waitUntil: 'networkidle' });
  const kelola = await page.locator('.dv-channel__owner a:has-text("Kelola video")').isVisible();
  const card = await page.locator(`text=${title}`).first().isVisible().catch(() => false);
  check('UI channel sendiri: tombol Kelola video + kartu video privat', kelola && card);
  await page.screenshot({ path: `${SHOTS}/imp-channel-own.png` });

  // 7. Admin melihat semua antrean + channel tujuan
  await admin.page.goto(`${BASE}/admin/imports`, { waitUntil: 'networkidle' });
  const adminRow = admin.page.locator(`tr:has-text("${ytId}")`).first();
  check('Studio admin: impor budi terlihat dengan kolom Channel @budi', (await adminRow.locator('a:has-text("@budi")').count()) === 1);

  // 8. Dialog upload menautkan ke impor
  await page.goto(`${BASE}/my/videos?upload=1`, { waitUntil: 'networkidle' });
  check('dialog Upload berisi tautan impor YouTube', await page.locator('.dv-upload-dialog button:has-text("impor dari link YouTube")').isVisible());

  // 9. HP: tanpa scroll horizontal, ikon upload membuka menu
  const mob = await session('budi', 'budi12345', { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await mob.page.goto(`${BASE}/my/imports`, { waitUntil: 'networkidle' });
  const hs = await mob.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await mob.page.click('.dv-masthead [aria-label="Upload"]');
  const mobMenu = await mob.page.locator('.dv-menu-item:has-text("Impor dari YouTube")').isVisible();
  check('HP: /my/imports tanpa scroll horizontal & menu Upload berisi Impor', hs <= 0 && mobMenu, `scroll ${hs}`);
  await mob.page.screenshot({ path: `${SHOTS}/imp-mobile.png`, fullPage: true });

  const errors = [...budi.errors, ...citra.errors, ...admin.errors, ...mob.errors];
  check('tanpa error JS', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('skrip selesai tanpa exception', false, String(err));
} finally {
  await browser.close();
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} lulus`);
process.exit(ok === results.length ? 0 : 1);

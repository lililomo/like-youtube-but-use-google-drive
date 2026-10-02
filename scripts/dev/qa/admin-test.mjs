// Uji otomatis Step 15 (panel admin) di instance uji.
// Pemakaian: CHROME_PATH=… node admin-test.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const SHOTS = process.env.SHOTS ?? '/root/dv-qa/shots';
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${name}${info ? ` — ${info}` : ''}`);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const stamp = Date.now().toString(36).slice(-4);

async function login(page, u, p) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', u);
  await page.fill('input[name=password]', p);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}

async function admin() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'id-ID', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await login(page, 'admin', 'admin12345');

  for (const [path, title] of [
    ['/admin', 'Dasbor'],
    ['/admin/users', 'Pengguna'],
    ['/admin/videos', 'Video'],
    ['/admin/playlists', 'Playlist'],
    ['/admin/jobs', 'Antrean'],
    ['/admin/settings/site', 'Situs'],
    ['/admin/settings/upload', 'Upload'],
    ['/admin/settings/player', 'Pemutar'],
    ['/admin/settings/security', 'Keamanan'],
    ['/admin/audit', 'Log Aktivitas'],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const h = (await page.locator('.dv-studio-page__title').first().textContent().catch(() => '')) ?? '';
    check(`halaman ${path}`, h.includes(title), h);
  }
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  check('dasbor: metrik video', (await page.locator('.dv-stat').count()) >= 5);
  await page.screenshot({ path: `${SHOTS}/s15-dashboard.png`, fullPage: true });

  // Pengguna: buat → ubah kuota → reset password → hapus
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Tambah pengguna")');
  await page.fill('#dv-user-form input >> nth=0', `uji${stamp}`);
  await page.fill('#dv-user-form input >> nth=1', `Uji ${stamp}`);
  await page.click('button[form="dv-user-form"]');
  await page.waitForTimeout(800);
  check('buat user', (await page.locator(`td:has-text("@uji${stamp}")`).count()) === 1);
  const pw = await page.evaluate(() => navigator.clipboard.readText());
  const probe = await browser.newContext();
  const pp = await probe.newPage();
  await login(pp, `uji${stamp}`, pw);
  check('user baru bisa login dengan password yang disalin', !pp.url().includes('/login'), pp.url());
  // user biasa: /admin ditolak, API admin 403
  await pp.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  check('user biasa tidak bisa membuka /admin', (await pp.locator('.dv-studio-page__title').count()) === 0, pp.url());
  const st = (await pp.request.get(`${BASE}/api/admin/stats`)).status();
  check('user biasa: /api/admin/stats → 403', st === 403, String(st));
  await probe.close();
  await page.screenshot({ path: `${SHOTS}/s15-users.png` });
  const row = page.locator(`tr:has-text("@uji${stamp}")`);
  await row.locator('button[aria-label="Ubah"]').click();
  await page.fill('#dv-user-form input[inputmode="decimal"]', '2');
  await page.click('button[form="dv-user-form"]');
  await page.waitForTimeout(700);
  check('ubah kuota user', (await row.textContent()).includes('2 GB'), await row.textContent());
  await row.locator('button[aria-label="Hapus"]').click();
  await page.click('.dv-dialog button:has-text("Hapus user")');
  await page.waitForTimeout(700);
  check('hapus user', (await page.locator(`td:has-text("@uji${stamp}")`).count()) === 0);

  // Video: aksi massal Privat lalu Publik
  await page.goto(`${BASE}/admin/videos`, { waitUntil: 'networkidle' });
  const boxes = page.locator('tbody input[type=checkbox]');
  const n = await boxes.count();
  check('daftar video admin', n > 0, String(n));
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.click('.dv-bulkbar button:has-text("Privat")');
  await page.waitForTimeout(1000);
  const vis = await page.locator('tbody select[aria-label="Visibilitas"]').evaluateAll((els) => els.slice(0, 2).map((e) => e.value));
  check('aksi massal → Privat', vis.every((v) => v === 'private'), vis.join(','));
  await page.screenshot({ path: `${SHOTS}/s15-videos.png` });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.click('.dv-bulkbar button:has-text("Publik")');
  await page.waitForTimeout(1000);
  await page.selectOption('select[aria-label="Status"]', 'ready');
  await page.waitForTimeout(800);
  check('filter status', (await page.locator('.dv-status--ok').count()) === (await page.locator('tbody tr').count()));

  // Pengaturan pemutar → langsung berlaku di /api/site
  await page.goto(`${BASE}/admin/settings/player`, { waitUntil: 'networkidle' });
  await page.fill('.dv-setting input[type=number]', '8');
  await page.click('button:has-text("Simpan")');
  await page.waitForTimeout(600);
  const site = await (await page.request.get(`${BASE}/api/site`)).json();
  check('pengaturan pemutar berlaku', site.player.endscreenCountdown === 8, JSON.stringify(site.player));
  await page.fill('.dv-setting input[type=number]', '5');
  await page.click('button:has-text("Simpan")');
  await page.waitForTimeout(400);

  await page.goto(`${BASE}/admin/audit`, { waitUntil: 'networkidle' });
  const acts = await page.locator('tbody tr td:nth-child(3)').allTextContents();
  check('log aktivitas mencatat aksi admin', acts.some((a) => a.includes('Ubah pengaturan')) && acts.some((a) => a.includes('Hapus user')), acts.slice(0, 6).join(' | '));
  await page.selectOption('select[aria-label="Filter aksi"]', 'user.');
  await page.waitForTimeout(500);
  const filtered = await page.locator('tbody tr td:nth-child(3)').allTextContents();
  check('filter log aktivitas', filtered.length > 0 && filtered.every((a) => /user|Buat user|Ubah user|Hapus user|Reset|profil|password|foto/i.test(a)), filtered.slice(0, 4).join(' | '));
  check('tanpa error JS (admin)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function guest() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  check('tamu → /admin dialihkan ke login', page.url().includes('/login'), page.url());
  for (const p of ['/api/admin/stats', '/api/admin/users', '/api/admin/videos', '/api/admin/settings']) {
    const s = (await page.request.get(`${BASE}${p}`)).status();
    check(`tamu: ${p} → 401`, s === 401, String(s));
  }
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

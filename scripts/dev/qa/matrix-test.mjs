// Matriks QA Step 17 di instance uji: perangkat (desktop, tablet, Android, iPhone — emulasi Chromium) ×
// peran (tamu, user A, user B, admin) × tema (gelap, terang). Mengecek elemen P0 per halaman, aturan
// visibilitas PRD §6, tidak ada error JS / scroll horizontal, lalu menyimpan screenshot ke $QA_DIR.
// Pemakaian: CHROME_PATH=… node matrix-test.mjs   (butuh admin/admin12345, budi/budi12345 dan video siap milik budi)
// Catatan: emulasi iPhone/iPad memakai mesin Chromium, BUKAN Safari — uji Safari/perangkat nyata tetap manual.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const QA_DIR = process.env.QA_DIR ?? 'storage/qa';
mkdirSync(QA_DIR, { recursive: true });
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'OK  ' : 'GAGAL'} ${name}${info ? ` — ${info}` : ''}`);
};

/** Klien API sederhana (cookie + CSRF) untuk menyiapkan data. */
async function api(user, pass) {
  const jar = new Map();
  const req = async (method, path, body) => {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (method !== 'GET') headers['x-csrf-token'] = jar.get('dv_csrf') ?? '';
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      jar.set(kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1));
    }
    return res.json().catch(() => null);
  };
  await req('GET', '/api/auth/me');
  if (user) await req('POST', '/api/auth/login', { username: user, password: pass });
  return { get: (p) => req('GET', p), post: (p, b) => req('POST', p, b ?? {}), patch: (p, b) => req('PATCH', p, b), del: (p, b) => req('DELETE', p, b ?? {}) };
}

// ---- data uji ----
const admin = await api('admin', 'admin12345');
const budi = await api('budi', 'budi12345');
const userB = `qab${Date.now().toString(36).slice(-4)}`;
await admin.post('/api/admin/users', { username: userB, displayName: 'QA User B', password: 'qauser12345' });
const mine = (await budi.get('/api/me/videos?status=ready')).items ?? [];
const priv = mine[0];
if (!priv) {
  console.log('Tidak ada video siap milik budi — jalankan upload-test.mjs dulu');
  process.exit(2);
}
// Judul unik agar tidak tertukar dengan video publik berjudul sama.
priv.title = `QA Privat ${userB}`;
await budi.patch(`/api/videos/${priv.id}`, { visibility: 'private', title: priv.title });
// Video publik diambil dari feed TAMU (feed budi juga berisi video privat miliknya sendiri).
const pub = (await (await api()).get('/api/feed')).items.find((v) => v.id !== priv.id);
const pl = (await budi.post('/api/playlists', { title: `QA Matriks ${userB}`, visibility: 'public' })).playlist;
await budi.post(`/api/playlists/${pl.id}/items`, { videoId: pub.id });
await budi.post(`/api/playlists/${pl.id}/items`, { videoId: priv.id });
const searchWord = pub.title.split(/\s+/)[0];

const ROLES = [
  { id: 'tamu', user: null },
  { id: 'userA', user: ['budi', 'budi12345'], owner: true },
  { id: 'userB', user: [userB, 'qauser12345'] },
  { id: 'admin', user: ['admin', 'admin12345'], admin: true, owner: true },
];
const DEVICES = [
  { id: 'desktop', opts: { viewport: { width: 1440, height: 900 } } },
  { id: 'ipad', opts: devices['iPad Pro 11'] },
  { id: 'android', opts: devices['Pixel 7'] },
  { id: 'iphone', opts: devices['iPhone 14'] },
];
const THEMES = ['dark', 'light'];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });

async function loginCtx(ctx, user) {
  const me = await ctx.request.get(`${BASE}/api/auth/me`);
  await me.body();
  const csrf = (await ctx.cookies()).find((c) => c.name === 'dv_csrf')?.value ?? '';
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: user[0], password: user[1] }, headers: { 'x-csrf-token': csrf } });
  return res.status();
}

async function run(device, role, theme) {
  const tag = `${device.id}/${role.id}/${theme}`;
  const ctx = await browser.newContext({ ...device.opts, locale: 'id-ID', colorScheme: theme });
  await ctx.addInitScript((th) => {
    try {
      localStorage.setItem('dv.theme', JSON.stringify(th));
    } catch {
      /* abaikan */
    }
  }, theme);
  if (role.user) check(`${tag}: login`, (await loginCtx(ctx, role.user)) === 200);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const width = device.opts.viewport.width;
  const mobile = width < 656;
  const shot = theme === 'dark' ? role.id === 'tamu' || role.id === 'admin' : role.id === 'tamu';

  const visit = async (name, path, extra) => {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const g = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      title: document.title,
    }));
    const darkBg = /rgb\((1[0-9]|[0-9]), (1[0-9]|[0-9]), (1[0-9]|[0-9])\)/.test(g.bg);
    check(`${tag} ${name}: tema ${theme}`, g.theme === theme && (theme === 'dark' ? darkBg : g.bg === 'rgb(255, 255, 255)'), `${g.theme} ${g.bg}`);
    check(`${tag} ${name}: tanpa scroll horizontal`, g.overflow <= 1, String(g.overflow));
    if (extra) await extra();
    if (shot) await page.screenshot({ path: `${QA_DIR}/${device.id}-${role.id}-${theme}-${name}.png` });
  };
  const count = (sel) => page.locator(sel).count();
  const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);

  await visit('beranda', '/', async () => {
    check(`${tag} beranda: kartu video`, (await count('.dv-vcard:not([aria-hidden])')) > 0);
    check(`${tag} beranda: chip kategori`, (await count('.dv-chip')) >= 2);
    check(`${tag} beranda: Login (tamu) / tanpa Login (user)`, (await visible('.dv-login-btn')) === !role.user);
    if (role.user) check(`${tag} beranda: tombol Upload`, mobile ? await visible('.dv-masthead [aria-label="Upload"]') : await visible('.dv-create-btn'));
    if (mobile) check(`${tag} beranda: navigasi bawah`, await visible('.dv-mobile-nav'));
    else if (width >= 1313) check(`${tag} beranda: guide 240px`, await visible('.dv-guide'));
    else if (width >= 792) check(`${tag} beranda: mini-guide`, await visible('.dv-mini-guide'));
    check(`${tag} beranda: video privat tidak tampil untuk non-pemilik`, role.owner || (await count(`a[href*="v=${priv.id}"]`)) === 0);
  });
  await visit('tonton', `/watch?v=${pub.id}`, async () => {
    check(`${tag} tonton: pemutar`, (await count('video.dvp-video')) === 1);
    check(`${tag} tonton: judul`, ((await page.locator('h1.dv-watch__title').textContent({ timeout: 5000 }).catch(() => '')) ?? '').includes(pub.title));
    check(`${tag} tonton: rekomendasi`, (await count('.dv-compact')) > 0);
  });
  await visit('privat', `/watch?v=${priv.id}`, async () => {
    const html = await page.content();
    if (role.owner) check(`${tag} privat: pemilik/admin bisa menonton`, (await count('video.dvp-video')) === 1 && html.includes(priv.title));
    else check(`${tag} privat: "Video tidak tersedia" tanpa judul`, (await count('.dv-watch__unavailable')) === 1 && !html.includes(priv.title));
  });
  await visit('cari', `/results?search_query=${encodeURIComponent(searchWord)}`, async () => {
    check(`${tag} cari: hasil`, (await count('.dv-result, .dv-vcard:not([aria-hidden])')) > 0);
  });
  await visit('playlist', `/playlist?list=${pl.id}`, async () => {
    // SPEC §13: daftar publik memakai listableSql yang sama untuk admin → hanya pemilik video yang melihat item privat.
    const n = await count('.dv-plitem');
    const own = role.id === 'userA';
    check(`${tag} playlist: item privat ${own ? 'terlihat pemilik' : 'disembunyikan'}`, n === (own ? 2 : 1), String(n));
  });
  await visit('jelajahi', '/feed/playlists/public', async () => {
    check(`${tag} jelajahi: playlist publik`, (await count('.dv-plcard')) > 0);
  });
  await visit('404', '/halaman-tidak-ada', async () => {
    check(`${tag} 404`, await visible('.dv-notfound'));
  });
  if (role.user) {
    await visit('akun', '/account', async () => {
      check(`${tag} akun: foto profil`, await visible('.dv-account-page__photo'));
    });
    await visit('video-anda', '/my/videos', async () => {
      check(`${tag} video anda: halaman`, ((await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => '')) ?? '').includes('Video Anda'));
      if (role.id === 'userA') check(`${tag} video anda: video privat sendiri tampil`, (await page.content()).includes(priv.title));
    });
  }
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  const studio = (await count('.dv-studio-page__title')) > 0;
  check(`${tag} /admin ${role.admin ? 'terbuka' : 'ditolak'}`, studio === Boolean(role.admin), page.url());
  if (role.admin && shot) await page.screenshot({ path: `${QA_DIR}/${device.id}-${role.id}-${theme}-admin.png` });
  check(`${tag}: tanpa error JS`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

try {
  for (const device of DEVICES) {
    for (const role of ROLES) {
      for (const theme of THEMES) await run(device, role, theme);
    }
    const done = results.length;
    const bad = results.filter((r) => !r.ok).length;
    console.log(`${device.id}: ${done} cek, ${bad} gagal (kumulatif)`);
  }
} finally {
  await browser.close();
  await budi.del(`/api/playlists/${pl.id}`);
  const users = (await admin.get(`/api/admin/users?q=${userB}`)).items ?? [];
  for (const u of users) await admin.del(`/api/admin/users/${u.id}`, { videos: 'transfer' });
}

// Ringkasan per kombinasi
const combos = new Map();
for (const r of results) {
  const key = r.name.split(/[ :]/)[0];
  const c = combos.get(key) ?? { ok: 0, bad: 0 };
  r.ok ? c.ok++ : c.bad++;
  combos.set(key, c);
}
console.log('\nKombinasi | lulus | gagal');
for (const [k, c] of combos) console.log(`${k} | ${c.ok} | ${c.bad}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);

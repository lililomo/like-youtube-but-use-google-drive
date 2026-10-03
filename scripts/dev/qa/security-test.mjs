// Uji keamanan black-box (Step 16) di instance uji: kebocoran video privat, akses, CSRF/Origin, header, batas.
// Catatan: uji rate limit login mengunci login dari IP ini 15 menit — restart instance uji sesudahnya.
// Pemakaian: node security-test.mjs   (BASE default http://127.0.0.1:3299; butuh user admin/admin12345 & budi/budi12345)
const BASE = process.env.BASE ?? 'http://127.0.0.1:3299';
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'GAGAL'} ${name}${info ? ` — ${info}` : ''}`);
};

/** Klien HTTP sederhana dengan cookie jar + CSRF. */
function client() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const store = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const req = async (method, path, body, extra = {}) => {
    const headers = { cookie: cookieHeader(), ...extra.headers };
    if (method !== 'GET' && !extra.noCsrf) headers['x-csrf-token'] = jar.get('dv_csrf') ?? '';
    let payload;
    if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== 'string') {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    } else payload = body;
    const res = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: 'manual' });
    store(res);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* bukan JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (p, e) => req('GET', p, undefined, e),
    post: (p, b, e) => req('POST', p, b ?? {}, e),
    patch: (p, b, e) => req('PATCH', p, b, e),
    put: (p, b, e) => req('PUT', p, b, e),
    del: (p, b, e) => req('DELETE', p, b ?? {}, e),
    async form(path, fd) {
      const res = await fetch(`${BASE}${path}`, { method: 'POST', body: fd, headers: { cookie: cookieHeader(), 'x-csrf-token': jar.get('dv_csrf') ?? '' } });
      store(res);
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    async login(u, pw) {
      await req('GET', '/api/auth/me');
      return req('POST', '/api/auth/login', { username: u, password: pw });
    },
  };
}

const admin = client();
await admin.login('admin', 'admin12345');
const budi = client();
await budi.login('budi', 'budi12345');
// user lain
const citraName = `citra${Date.now().toString(36).slice(-4)}`;
await admin.post('/api/admin/users', { username: citraName, displayName: 'Citra', password: 'citra12345' });
const citra = client();
await citra.login(citraName, 'citra12345');
const guest = client();
await guest.get('/api/auth/me');

// Video privat milik budi yang siap (dari uji upload) → pastikan privat & beri subtitle.
const mine = (await budi.get('/api/me/videos?status=ready')).json.items;
const P = mine[0];
if (!P) {
  console.log('Tidak ada video siap milik budi — jalankan upload-test dulu');
  process.exit(2);
}
// Judul unik agar cek saran/pencarian tidak tertukar dengan video publik berjudul sama (mis. "Konser").
P.title = `Rahasia Budi ${Date.now().toString(36)}`;
await budi.patch(`/api/videos/${P.id}`, { visibility: 'private', title: P.title });
const fd = new FormData();
fd.append('lang', 'id');
fd.append('file', new Blob(['1\n00:00:01,000 --> 00:00:02,000\nRAHASIA\n']), 'r.srt');
const subRes = await budi.form(`/api/videos/${P.id}/subtitles`, fd);
check('pemilik bisa menambah subtitle', subRes.status === 201, String(subRes.status));
const detailOwner = (await budi.get(`/api/videos/${P.id}`)).json;
const ownerStream = detailOwner.sources[0]?.url;
// Playlist publik budi berisi video privat + playlist privat budi
const pub = (await budi.post('/api/playlists', { title: 'Publik campur', visibility: 'public' })).json.playlist;
const priv = (await budi.post('/api/playlists', { title: 'Privat budi', visibility: 'private' })).json.playlist;
const other = (await budi.get('/api/feed')).json.items[0];
await budi.post(`/api/playlists/${pub.id}/items`, { videoId: P.id });
await budi.post(`/api/playlists/${pub.id}/items`, { videoId: other.id });
await budi.post(`/api/playlists/${priv.id}/items`, { videoId: other.id });

const has = (items, id) => (items ?? []).some((v) => v.id === id);
const titleWord = P.title.split(' ')[0];
for (const [name, c] of [
  ['tamu', guest],
  ['user lain', citra],
]) {
  check(`${name}: detail video privat → 404`, (await c.get(`/api/videos/${P.id}`)).status === 404);
  check(`${name}: sources video privat → 404`, (await c.get(`/api/videos/${P.id}/sources`)).status === 404);
  check(`${name}: related video privat → 404`, (await c.get(`/api/videos/${P.id}/related`)).status === 404);
  check(`${name}: tidak ada di feed`, !has((await c.get('/api/feed')).json.items, P.id));
  check(`${name}: tidak ada di pencarian`, !has((await c.get(`/api/search?q=${encodeURIComponent(P.title)}`)).json.items, P.id));
  const sug = (await c.get(`/api/search/suggest?q=${encodeURIComponent(titleWord)}`)).json.items;
  check(`${name}: tidak ada di saran`, !sug.includes(P.title), sug.join(','));
  const rel = (await c.get(`/api/videos/${other.id}/related`)).json.items;
  check(`${name}: tidak ada di rekomendasi`, !has(rel, P.id));
  // Rekomendasi personal (REKOMENDASI.md): seluruh peringkat beranda & kolom kanan, bukan hanya halaman pertama.
  const homeAll = (await c.get('/api/feed?sort=for_you&seed=sec1&limit=48')).json;
  check(`${name}: tidak ada di beranda personal`, !has(homeAll.items, P.id));
  check(`${name}: tidak ada di rekomendasi Terkait`, !has((await c.get(`/api/videos/${other.id}/related?filter=related&limit=30`)).json.items, P.id));
  check(`${name}: "Tidak tertarik" pada video privat → 404`, (await c.post('/api/recommend/not-interested', { videoId: P.id })).status === 404);
  check(`${name}: progres video privat diabaikan (204 tanpa error)`, (await c.post('/api/progress', { videoId: P.id, positionSec: 10, durationSec: 20, start: true })).status === 204);
  const ch = (await c.get('/api/channels/@budi')).json;
  check(`${name}: tidak ada di channel & jumlah video tidak menghitung privat`, !has(ch.items, P.id));
  const pd = (await c.get(`/api/playlists/${pub.id}`)).json;
  check(`${name}: tersembunyi di playlist publik (hiddenCount)`, !has(pd.items, P.id) && pd.hiddenCount >= 1 && pd.playlist.firstVideoId !== P.id);
  check(`${name}: playlist privat orang lain → 404`, (await c.get(`/api/playlists/${priv.id}`)).status === 404);
  check(`${name}: tidak bisa ubah playlist orang lain`, [403, 404].includes((await c.patch(`/api/playlists/${pub.id}`, { title: 'x' })).status));
  const og = (await c.get(`/watch?v=${P.id}`)).text;
  check(`${name}: OG meta tidak membocorkan judul privat`, !og.includes(P.title));
  for (const s of detailOwner.subtitles) check(`${name}: subtitle video privat → 404`, (await c.get(`/api/subtitles/${s.id}.vtt`)).status === 404);
  if (ownerStream) {
    const st = (await c.get(new URL(ownerStream, BASE).pathname + new URL(ownerStream, BASE).search, { headers: { range: 'bytes=0-10' } })).status;
    check(`${name}: URL stream milik pemilik tidak bisa dipakai`, st === 403 || st === 404, String(st));
  }
  check(`${name}: tidak bisa ubah/hapus video orang lain`, [401, 403, 404].includes((await c.del(`/api/videos/${P.id}`)).status));
  check(`${name}: /api/admin/* ditolak`, [401, 403].includes((await c.get('/api/admin/stats')).status));
}
const myCount = (await budi.get('/api/channels/@budi')).json.channel.videoCount;
const guestCount = (await guest.get('/api/channels/@budi')).json.channel.videoCount;
// Sejak 2026-10-03 video privat tidak dihitung di halaman channel untuk siapa pun (termasuk pemilik) — discoverableSql.
check('jumlah video channel: privat tidak dihitung, pemilik = tamu', myCount === guestCount, `${myCount} vs ${guestCount}`);

// CSRF & Origin
check('CSRF: POST tanpa header → 403', (await budi.post('/api/playlists', { title: 'x' }, { noCsrf: true })).status === 403);
check('Origin asing → 403', (await budi.post('/api/playlists', { title: 'x' }, { headers: { origin: 'https://evil.example' } })).status === 403);
// Upload milik orang lain
const up = (await budi.post('/api/uploads', { fileName: 'a.mp4', size: 1000 })).json;
check('chunk ke upload milik orang lain → 404', (await citra.put(`/api/uploads/${up.uploadId}`, new Uint8Array(10), { headers: { 'content-type': 'application/octet-stream', 'content-range': 'bytes 0-9/1000' } })).status === 404);
await budi.del(`/api/uploads/${up.uploadId}`);
// Header keamanan
const h = (await guest.get('/')).headers;
check('CSP', /default-src 'self'/.test(h.get('content-security-policy') ?? ''));
check('X-Content-Type-Options nosniff', h.get('x-content-type-options') === 'nosniff');
check('frame-ancestors / X-Frame-Options', /frame-ancestors 'self'/.test(h.get('content-security-policy') ?? '') || Boolean(h.get('x-frame-options')));
check('Referrer-Policy', h.get('referrer-policy') === 'strict-origin-when-cross-origin');
// Rahasia tidak keluar
const s = (await admin.get('/api/admin/settings')).text;
check('pengaturan: secret dimasking', !/"oauth_client_secret":"[^"]/.test(s) && !/"refresh_token":"[^"]/.test(s));
// Body terlalu besar
const big = 'x'.repeat(1_200_000);
check('body JSON > 1 MB → 413', (await budi.post('/api/playlists', { title: big })).status === 413);
// Login rate limit (username acak agar tidak mengunci akun nyata)
const bad = client();
let last = 0;
for (let i = 0; i < 11; i++) last = (await bad.login(`tidakada${Date.now()}`, 'salah')).status;
check('rate limit login per IP (≥ 10 gagal → 429)', last === 429, String(last));

// bersihkan
await budi.del(`/api/playlists/${pub.id}`);
await budi.del(`/api/playlists/${priv.id}`);
const users = (await admin.get(`/api/admin/users?q=${citraName}`)).json.items;
for (const u of users) await admin.del(`/api/admin/users/${u.id}`, { videos: 'transfer' });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);

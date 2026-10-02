# CLAUDE.md — Dymas Video

Platform video bergaya YouTube dengan sumber satu folder Google Drive. Domain: **https://video.dymas.cloud**.
Dokumen acuan: [PRD.md](PRD.md) (produk) · [SPEC.md](SPEC.md) (teknis) · [PROMPT.md](PROMPT.md) (langkah eksekusi Step 0–17).

## Aturan untuk Claude (wajib)
- Lapor dalam **Bahasa Indonesia**. UI aplikasi berbahasa Indonesia.
- **Setiap perubahan konfigurasi/setting dicatat di file ini saat itu juga** (bagian Konfigurasi, Progres, Changelog).
- Server dikelola **aaPanel**: project Node, database, SSL, nginx, cron dibuat/diubah lewat aaPanel (API `scripts/bt-api.py` atau instruksi UI ke user). Jangan pasang pm2/systemd/situs nginx sendiri.
- Nginx tambahan **hanya** di `/www/server/panel/vhost/rewrite/node_video_dymas.conf` (sumber: `scripts/nginx-custom.conf`). Jangan edit vhost utama `node_video_dymas.conf` (bisa ditimpa aaPanel).
- Node selalu dari `/www/server/nodejs/v24.18.0/bin` (tidak ada di PATH default).
- **Repo ini ada di GitHub (private).** Jangan pernah commit password, token, `.env`, isi `/root/dv-qa/.dbpass`, atau ID/secret OAuth selain Client ID. Password admin hanya di `.env` server.
- Jangan menulis secret ke file ini atau file lain di luar yang ditentukan SPEC: password root MySQL (ada di DB panel `/www/server/panel/data/default.db` → `config.mysql_root`), token API aaPanel (`/www/server/panel/config/api.json`), Client Secret / refresh token Google (tersimpan terenkripsi di tabel `settings`).
- Claude berjalan sebagai root → setelah build/ubah file jalankan `chown -R www:www /www/wwwroot/video.dymas.cloud`.
- Akhiri setiap step: build bersih, test lulus, deploy, update file ini, git commit lokal.

## Di mana Claude sedang berjalan?
- **Di server (`/www/wwwroot/video.dymas.cloud` ada, `/www/server/` ada):** semua aturan di atas berlaku penuh — bisa build, deploy (`bash scripts/deploy.sh`), akses DB, aaPanel, instance uji (`scripts/dev/test-instance.sh`).
- **Di Claude cloud / mesin lain (tidak ada `/www/server/`):** tidak ada akses ke server, aaPanel, MariaDB produksi, maupun Google Drive. Yang bisa dikerjakan: menulis kode, `npm ci && npm test` (unit test server & web tidak butuh DB), `npm run typecheck`, `npm run build`. Abaikan aturan path `/www/server/...`; pakai Node ≥ 24 yang tersedia. Kerjakan di branch, push ke GitHub, lalu catat di Changelog bahwa perubahan **belum di-deploy**. Uji integrasi dengan fake Drive butuh MariaDB + ffmpeg (opsional: pasang sendiri di cloud, lihat `scripts/dev/`).
- **Menerapkan perubahan dari GitHub ke server:** di server jalankan `bash scripts/pull-deploy.sh [branch]` (default `main`) — git pull (fast-forward saja) → build → migrate → restart aaPanel → health check. Lalu verifikasi di https://video.dymas.cloud dan perbarui Progres/Changelog.

## Status
**Fase: eksekusi berjalan.** Lihat Progres di bawah.

### Progres
- [x] Step 0 — Persiapan server (ffmpeg, bt-api.py, DB `dummy`, git) — 2026-10-02
- [x] Step 1 — Kerangka proyek, Node Project aaPanel, nginx custom, SSL — 2026-10-02
- [x] Step 2 — Database, migrasi, settings, kriptografi — 2026-10-02
- [x] Step 3 — Auth, sesi, CSRF, tamu, manajemen user — 2026-10-02
- [x] Step 4 — Fondasi frontend & design system YouTube — 2026-10-02
- [x] Step 5 — Integrasi Google Drive — 2026-10-02 (terhubung ke Drive asli; folder sumber masih kosong → verifikasi nyata Step 6–8 menunggu video diunggah ke folder)
- [x] Step 6 — Sinkronisasi folder — 2026-10-02 (diuji dengan fake Drive; verifikasi ulang dengan Drive asli setelah Step 5 terhubung)
- [x] Step 7 — Streaming — 2026-10-02 (diuji dengan fake Drive)
- [x] Step 8 — Pemrosesan media (ffmpeg) — 2026-10-02 (diuji dengan fake Drive & 8 video sintetis)
- [x] Step 9 — Beranda, pencarian, kategori, channel — 2026-10-02 (diuji dengan data fake Drive)
- [x] Step 10 — Pemutar inti — 2026-10-02 (diuji otomatis di Chromium headless; sebagian fitur Step 11/12 sudah ikut: gesture sentuh, double-tap akumulatif, tahan=2x, preview storyboard, orientasi layar penuh, halaman Tonton dasar)
- [ ] Step 11 — Pemutar mobile & lanjutan (🧑 uji di HP)
- [ ] Step 12 — Halaman tonton
- [ ] Step 13 — Playlist
- [ ] Step 14 — Upload & Video Anda
- [ ] Step 15 — Panel admin lengkap
- [ ] Step 16 — Keamanan, performa, operasional
- [ ] Step 17 — QA akhir & serah terima

## Infrastruktur (diverifikasi 2026-10-02)
| Item | Nilai |
|---|---|
| OS | Ubuntu 22.04.5 LTS · 6 vCPU · RAM 11 GB · disk sisa ±50 GB |
| IP publik | 164.152.166.91 — A record `video.dymas.cloud` sudah mengarah ke sini |
| aaPanel | v8.0.6; panel HTTPS port 11111; API aktif (whitelist berisi 164.152.166.91 → `scripts/bt-api.py` memanggil `https://164.152.166.91:11111`; entri `localhost` di whitelist tidak dihitung karena bukan IP). **Awas:** 20 kegagalan signature beruntun = API diblokir 1 jam |
| Nginx | 1.24.0 (`/www/server/nginx/sbin/nginx`), reload: `/etc/init.d/nginx reload`; global `client_max_body_size 50m` |
| Node | v24.18.0 + npm + pm2 di `/www/server/nodejs/v24.18.0/bin` |
| MariaDB | 10.11.10 (`/www/server/mysql/bin/mysql`), listen 0.0.0.0:3306 & [::]:3306, socket `/tmp/mysql.sock` |
| Redis | ada (6379, ber-password) — tidak dipakai |
| ffmpeg | 4.4.2 (apt) `/usr/bin/ffmpeg`, `/usr/bin/ffprobe` — encoder libx264, aac, mjpeg, libwebp tersedia; bisa dijalankan user www |
| DB `dummy` | dibuat via aaPanel API (`AddDatabase`, id panel 4), user `dummy@localhost` + `dummy@127.0.0.1`, charset utf8mb4 (collation default DB `utf8mb4_general_ci`; tabel aplikasi memakai `utf8mb4_unicode_ci`) |
| Port terpakai (sebagian) | 3001, 3306, 4000, 6379, 7080, 8188, 8190, 8288–8290, 11111, 18888, 19999 |
| Contoh Node Project lain | `masalah` (port 4000) — jangan diganggu |

## Konfigurasi Aplikasi (aktual)
| Item | Nilai |
|---|---|
| Folder aplikasi | `/www/wwwroot/video.dymas.cloud` |
| Stack | Node 24 + Fastify 5 + TypeScript (server) · React 19 + Vite 7 (web) · MariaDB · ffmpeg |
| aaPanel Node Project | `video_dymas` (site id **30**) · script `/www/wwwroot/video.dymas.cloud/server/dist/index.js` · port **3210** · run user `www` · Node v24.18.0 · auto start on boot · memory limit 2048 MB · dibuat via API `create_project` |
| Bind | `127.0.0.1:3210` (hanya lewat nginx) |
| Vhost aaPanel | `/www/server/panel/vhost/nginx/node_video_dymas.conf` (jangan diedit) |
| Nginx custom | `/www/server/panel/vhost/rewrite/node_video_dymas.conf` ← `scripts/nginx-custom.conf` |
| Log aplikasi | `/www/server/nodejs/vhost/logs/video_dymas.log` |
| Skrip start / pid aaPanel | `/www/server/nodejs/vhost/scripts/video_dymas.sh` · `/www/server/nodejs/vhost/pids/video_dymas.pid` |
| Log nginx | `/www/wwwlogs/` |
| SSL | Let's Encrypt (issuer YR1) via aaPanel ACME (`apply_cert_api` id=30, HTTP-01) + `SetSSL` siteName=video_dymas + Force HTTPS aktif; sertifikat di `/www/server/panel/vhost/cert/video_dymas/`; berlaku s/d 2026-12-31, auto-renew oleh aaPanel |
| Storage lokal | `storage/public/{thumbs,sb,branding}` (→ `/media/` via nginx), `storage/cache/subs`, `storage/tmp` |
| Database aplikasi | 15 tabel dari `server/migrations/001_init.sql` (users, sessions, categories, videos, video_renditions, subtitles, playlists, playlist_items, watch_history, jobs, uploads, settings, oauth_states, audit_logs, schema_migrations); semua `utf8mb4_unicode_ci`; waktu UTC (`SET time_zone='+00:00'` per koneksi, mysql2 `timezone:'Z'`). Koneksi app via socket `/tmp/mysql.sock` (DB_HOST=localhost + DB_SOCKET) |
| Admin awal | dibuat seeder 2026-10-02 (user id 1, argon2id m=19456,t=2,p=1) |
| Settings | tabel `settings` (JSON); rahasia (`drive.oauth_client_secret`, `drive.oauth_refresh_token`, `drive.service_account_json`) AES-256-GCM `v1:` dengan kunci HKDF(APP_KEY,"dv-enc"); default di `server/src/modules/settings/service.ts` |
| Auth | Cookie `dv_sid` (HttpOnly, Secure, Lax; 30 hari bila "Ingat saya", kalau tidak cookie sesi + 24 jam sliding), `dv_csrf` (dibaca JS, dikirim di header `X-CSRF-Token` untuk semua non-GET `/api/*`; Origin harus `https://video.dymas.cloud`), `dv_gid` (tamu, 400 hari). Login rate-limit in-memory 10 gagal/15 menit per IP **dan** per username (reset saat restart). Rate-limit global `/api/*` 600/menit/IP |
| Header keamanan | Helmet: CSP (SPEC §12), nosniff, X-Frame SAMEORIGIN, Referrer-Policy, **HSTS dari aplikasi** (max-age 1 th) — HSTS di vhost aaPanel tidak terkirim karena `add_header` di `location /` menimpanya |
| Frontend | React 19 SPA (`web/src`): router `router.tsx` (layout Root → App/Watch/Bare; `/admin/*` lazy chunk `pages/admin/AdminApp`), design token `styles/tokens.css` (tema terang/gelap via `html[data-theme]`, skrip anti-kedip `public/theme-init.js`), CSS global `styles/{base,ui,layout,pages,admin}.css` (prefix `dv-`), ikon SVG inline `components/icons/Icon.tsx` (Material Icons), teks UI `i18n/id.ts`. Bundle awal ±130 KB gzip |
| Build web | `vite build` dengan `emptyOutDir:false` (aset lama dipertahankan, deploy menghapus aset > 7 hari); `index.html` dibaca ulang server bila berubah |
| QA screenshot | `/root/dv-qa/shot.mjs` (playwright-core + Chromium cache `/root/.cache/ms-playwright/chromium_headless_shell-1234`) → `/root/dv-qa/shots/*.png`; `/root/dv-qa/yt.mjs` untuk pembanding youtube.com. Di luar folder proyek |
| Sinkronisasi | `modules/sync/service.ts`: full sync BFS (kategori = subfolder, slug unik, subtitle cocok nama), incremental via Changes API, kunci `GET_LOCK('dv_sync')`, error API → batal tanpa menandai missing; penjadwal tiap 10 dtk cek jatuh tempo (incremental `drive.sync_interval_sec`, full `drive.full_sync_interval_min`), perubahan folder → full sync terjadwal 30 dtk. Endpoint `GET /api/admin/sync/status`, `POST /api/admin/sync/run {mode}`; simpan folder memicu full sync. Pemeliharaan per jam: hapus sesi/oauth state kedaluwarsa, upload expired, job selesai > 14 hari; tmp > 24 jam |
| Streaming | `GET/HEAD /stream/:id/:q.mp4?e&s` (q: orig/compat/1080/720/480/360), signature HMAC (kunci HKDF "dv-stream", TTL 6 jam, video privat terikat `u<userId>`), Range diteruskan ke Drive, upstream dibatalkan saat klien putus, maks 8 stream/IP, cache video 10 dtk (`invalidateStreamCache()` saat visibilitas berubah). `/internal/drive/:fileId` hanya localhost + `X-Internal-Token` tanpa `X-Forwarded-For` (nginx juga memblok `/internal/`). Subtitle `GET /api/subtitles/:id.vtt` (SRT→VTT, BOM/UTF-16/windows-1252, cache `storage/cache/subs`). Detail `GET /api/videos/:id`, `/sources` |
| Pemrosesan | Worker dalam proses (`modules/processing/worker.ts`): lane `light` ×2 (probe, thumbnail, delete_assets), `heavy` ×1 (media); `FOR UPDATE SKIP LOCKED`, backoff 2^n menit, `DeferJob` (disk penuh → tunda 30 mnt), shutdown mengembalikan job ke antrean & membunuh ffmpeg. Probe via `/internal/drive` (ffprobe), aturan playable `media-rules.ts` (MP4/MOV H.264 8-bit + AAC/MP3; WebM VP8/VP9/AV1 + Opus/Vorbis). Thumbnail: 3 kandidat (10/25/50%) skor entropi+kecerahan → `storage/public/thumbs/<id>-<key>-{480,1280}.webp` + `-og.jpg` (vertikal: pillarbox hitam). Media: unduh ke `storage/tmp`, satu ffmpeg multi-output (nice, threads, preset dari settings), storyboard 160×90 tile 10×10 (`-skip_frame nokey`, fallback semua frame) → `storage/public/sb/<id>-<key>/N.jpg`, upload rendition ke Drive `_dymasvideo_system/renditions` (`<id>_<h>p.mp4`, appProperties dvRole=rendition), rendition lama di-trash. API admin: `GET /api/admin/jobs`, `POST /api/admin/jobs/:id/retry`, `DELETE /api/admin/jobs/:id`, `POST /api/admin/videos/:id/reprocess {only}`. UI: `/admin/jobs`, `/admin/settings/processing` |
| Halaman publik | API: `GET /api/categories` (kategori berisi video listable, termasuk turunan), `/api/feed?category&sort=latest|popular&cursor` (kursor opak), `/api/search?q&cursor` (FULLTEXT boolean `+tok*` untuk token ≥3 huruf + LIKE token pendek/frasa), `/api/search/suggest`, `/api/videos/:id/related` (skor kategori/pemilik/jaccard/popularitas/kebaruan + jitter harian, cache 10 mnt), `POST /api/videos/:id/view` (dedupe 6 jam per user/tamu/IP+UA, flush tiap 10 dtk), `/api/channels/:handle?tab&sort&cursor`. OG meta untuk `/watch?v=` (video publik). Frontend: Beranda (chip + grid kolom `floor((w+16)/336)` + infinite scroll), `/results`, `/@handle`, saran pencarian + riwayat lokal `dv.searchHistory` |
| Pemutar | `web/src/player/Player.ts` (vanilla TS, ±13 KB gzip, chunk `PlayerView`), CSS `player/player.css`, pembungkus `PlayerView.tsx` (instance tunggal; `load()` saat `v` berganti → layar penuh bertahan). Kualitas: Otomatis (tinggi pemutar×DPR, dibatasi `navigator.connection`) / manual; ganti kualitas membekukan frame di canvas. Subtitle dirender sendiri (parser VTT, sanitasi). Pemulihan: refresh URL bertanda tangan → ulang → fallback compat/kualitas lebih rendah → overlay error. Gesture: klik (tunda 200 ms), double-klik kiri/kanan ±10 dtk, tengah = layar penuh; sentuh: tap = kontrol, double-tap akumulatif, tahan = 2x. Keyboard YouTube lengkap. Preferensi `localStorage dv.player`. Halaman uji admin `/dev/player`. Uji otomatis: `/root/dv-qa/player-test.mjs`, `player-test2.mjs` (Chromium `/root/.cache/ms-playwright/chromium-1234`) |
| Halaman tonton (dasar) | `pages/Watch.tsx` + `styles/watch.css`: grid dua kolom (kanan 402px), mode bioskop (`dv.theater`), satu kolom < 1017px, pemutar sticky di mobile, rekomendasi infinite scroll, autoplay → video rekomendasi pertama, hitung tayangan saat `viewqualified`. Belum: panel playlist, Simpan, menu pemilik, simpan progres/histori (Step 12–14) |
| Static web | `web/dist` — `/assets/*` disajikan nginx (immutable 1 th); `index.html` & SPA fallback oleh Fastify (`no-cache`) |
| Log nginx situs | `/www/wwwlogs/video_dymas.log`, `/www/wwwlogs/video_dymas.error.log` |
| `.env` | dibuat Step 1 (APP_KEY & INTERNAL_TOKEN acak), mode 600 milik www; backup `/root/backup/video_dymas.env` (600) |
| Paket | npm workspaces (`server`, `web`); versi dipatok: TypeScript 5.9, Vite 7, React 19, react-router 7, Fastify 5, vitest 3, zod 4, undici 7, google-auth-library 10, sharp 0.34. `allowScripts` (npm 11) menyetujui esbuild & sharp |
| Google Drive | **Terhubung** (OAuth) sebagai `dymassedhayu@gmail.com`; folder sumber **"Dymas Tube"** (`1m07wAiRimwzZ82rOSbaI9lxJ4U83PUCQ`, My Drive), folder sistem `_dymasvideo_system` (`1rgUPx7aR2wrTO-h81rtQ7oKqnT7YYDr0`) / `renditions` (`1RtLYZGu6CYeZJ3pwr3BqfFYzKKJdGE1z`). OAuth client project Google Cloud status **In production** (wajib; Testing → token kedaluwarsa 7 hari). Mode OAuth (default) · redirect URI `https://video.dymas.cloud/api/admin/drive/oauth/callback` · scope `drive openid email`, `access_type=offline`, `prompt=consent` · folder sistem `_dymasvideo_system/renditions` dibuat saat folder disimpan · halaman admin `/admin/settings/drive` · API: `/api/admin/drive/{status,oauth/start,oauth/callback,disconnect,service-account,test,folder}`, `GET /api/admin/settings`, `PUT /api/admin/settings/:group` (site, drive, processing, upload, player, security) |

## Kredensial (non-rahasia/permintaan user)
- Admin aplikasi: username **admin**; password awal = `ADMIN_INITIAL_PASSWORD` di `.env` server (tidak pernah ditulis di repo — repo ada di GitHub). Jika diganti lewat aplikasi, cukup catat "sudah diganti" di sini.
- Database: host `localhost`, user `dummy`, password `dummy`, database `dummy` (disarankan diganti setelah stabil → ubah `.env`).
- `.env` (mode 600, milik www) berisi `APP_KEY` — **jangan diubah setelah ada data** (dipakai enkripsi secret). Backup: `/root/backup/video_dymas.env` (Step 16).

## Lingkungan uji (tanpa menyentuh produksi)
- Fake Google Drive: `scripts/dev/fake-drive.mjs` (port 3298, data `/root/dv-qa/fakedrive`), media sintetis `scripts/dev/make-test-media.sh` → `/root/dv-qa/media-src`.
- Instance uji: `bash scripts/dev/test-instance.sh start [--reseed] | stop | reset-db` → app port **3299**, DB **`dummy_test`** (user `dummy_test`, password di `/root/dv-qa/.dbpass`, dibuat via aaPanel id 5), env `/root/dv-qa/env.test` (DRIVE_API_BASE/DRIVE_UPLOAD_BASE → fake, `DRIVE_FAKE_TOKEN`, `SERVE_STATIC=1`, admin `admin/admin12345`), storage `/root/dv-qa/storage-test`, log `/root/dv-qa/app.log`.
- Helper curl: `source /root/dv-qa/api.sh; login; get /api/...; post /api/... '{json}'`. Salinan skrip QA ada di `scripts/dev/qa/` (lihat README di sana).
- Variabel env khusus uji (JANGAN di `.env` produksi): `DRIVE_API_BASE`, `DRIVE_UPLOAD_BASE`, `DRIVE_FAKE_TOKEN`, `SERVE_STATIC`, `DISABLE_SCHEDULER`, `DISABLE_WORKER`.

## GitHub
- Repo: **`like-youtube-but-use-google-drive`** (private) — remote `origin`, branch utama `main`.
- Server memakai GitHub CLI `/root/bin/gh` (login akun pemilik; `gh auth setup-git` sebagai credential helper git).
- Riwayat git dibersihkan dari password admin sebelum push pertama (2026-10-02).

## Helper aaPanel API
```bash
python3 scripts/bt-api.py '/system?action=GetSystemTotal'                 # tes koneksi
python3 scripts/bt-api.py '/data?action=getData' table=databases limit=20 p=1 search=dummy
```
Argumen `key=value` dikirim sebagai form field. Cookie jar: `/root/.bt-api-cookies.txt` (600). Host bisa diganti via env `BT_API_HOST`.

## Perintah
```bash
export PATH=/www/server/nodejs/v24.18.0/bin:$PATH
npm run build                       # tsc server + vite build web
npm run migrate                     # migrasi DB (setelah build; idempoten)
npm run seed                        # admin awal bila belum ada admin (idempoten)
npm test                            # vitest server + web
bash scripts/deploy.sh              # npm ci (bila lock berubah) → build → migrate → seed → chown → restart aaPanel → health
SKIP_BUILD=1 bash scripts/deploy.sh # restart saja
python3 scripts/bt-api.py /project/nodejs/restart_project/json 'data={"project_name":"video_dymas"}'
tail -f /www/server/nodejs/vhost/logs/video_dymas.log
curl -fsS https://video.dymas.cloud/api/health
```
Nginx custom: edit `scripts/nginx-custom.conf` → `cp scripts/nginx-custom.conf /www/server/panel/vhost/rewrite/node_video_dymas.conf && /www/server/nginx/sbin/nginx -t && /etc/init.d/nginx reload`.

### Catatan aaPanel penting
- Route API project: `/project/nodejs/<fungsi>/json` dengan parameter `data=<JSON>`.
- **Jangan klik "Install modules"/install_packages untuk project ini di UI aaPanel**: aaPanel memakai `yarn install` dan MENGHAPUS `package-lock.json`. Kalau terlanjur: `cp /root/backup/video_dymas.package-lock.json package-lock.json` (atau dari git), hapus `yarn.lock`, `npm ci`.
- Skrip start aaPanel hanya mengarahkan **stdout** ke log (`2>&1 >> log`), jadi pesan fatal aplikasi ditulis ke stdout.
- **Bug aaPanel 8.0.6** (`class/projectModel/nodejsModel.py` `get_project_stat`): `project_config` direset ke `{}` sebelum dibaca → `KeyError: 'port'` ketika project Node yang dijalankan aaPanel sedang listen. Akibatnya `get_project_list` (API maupun halaman *Node Project* di UI aaPanel) gagal (balasan 404 samaran). Belum ditambal — menunggu keputusan user (menambal file aaPanel butuh izin). Fungsi lain (restart/stop/start, SSL) tetap berfungsi.

## Keputusan
Ringkasan keputusan produk ada di PRD.md §4. Penyimpangan dari SPEC selama eksekusi dicatat di sini dengan tanggal & alasan.
- 2026-10-02 — Versi paket dipatok ke major yang sesuai SPEC (TS 5.9, Vite 7, react-router 7, vitest 3) walau npm sudah punya TS 7/Vite 8/react-router 8 — demi stabilitas.
- 2026-10-02 — Drive API diakses via REST (undici) + `google-auth-library` untuk token; `@googleapis/drive` tidak dipakai (lebih ringan & kontrol penuh atas streaming/resumable).
- 2026-10-02 — Hapus user dengan opsi `delete`: untuk sementara video ditandai `missing` + `deleted_at` di DB; trash file di Drive disambungkan di Step 14.
- 2026-10-02 — Limiter login per-username bisa dipakai pihak lain untuk mengunci akun selama 15 menit (trade-off SPEC). Darurat: restart aplikasi (`SKIP_BUILD=1 bash scripts/deploy.sh`) mengosongkan limiter.

## Changelog
- 2026-10-02 — Analisis server; dibuat PRD.md, SPEC.md, PROMPT.md, CLAUDE.md. Belum ada kode.
- 2026-10-02 — Step 0: ffmpeg 4.4.2 dipasang (apt); `scripts/bt-api.py` dibuat & teruji; DB `dummy` dibuat via aaPanel API; git lokal diinisialisasi (branch main, tanpa remote).
- 2026-10-02 — Step 1: monorepo server (Fastify 5/TS) + web (Vite 7/React 19); `/api/health`; SPA fallback; `.env`; `scripts/deploy.sh`; Node Project aaPanel `video_dymas` (id 30, port 3210); nginx custom terpasang di rewrite include; SSL Let's Encrypt + Force HTTPS.
- 2026-10-02 — Step 2: db.ts (pool mysql2), migrasi 001_init + runner, seeder admin, lib crypto/ids/password/errors, SettingsService (cache + enkripsi rahasia), `/api/health` cek DB; 13 unit test lulus.
- 2026-10-02 — Step 3: plugin auth (sesi/CSRF/tamu), login/logout/me/password/PATCH me, API admin users (CRUD, reset password, proteksi admin terakhir & diri sendiri), audit log + `GET /api/admin/audit`, aturan akses `plugins/access.ts`, helmet+CSP+HSTS, rate-limit; 37 unit test lulus; diuji end-to-end via curl.
- 2026-10-02 — Step 4: fondasi frontend — token tema YouTube, masthead + kotak Telusuri, guide/mini-guide/drawer/nav bawah mobile (breakpoint 1313/792/656), menu akun + submenu Tampilan, Login, Akun, 404, kerangka Studio admin (lazy), komponen UI (tombol, tooltip, popup, dialog, field, snackbar, skeleton, switch), `GET /api/site`; 30 unit test web; diverifikasi via screenshot vs youtube.com.
- 2026-10-02 — Step 5 (kode): klien Drive REST (undici keep-alive, retry/backoff, refresh token, OAuth & Service Account), klasifikasi file + parser URL folder (32 test), alur OAuth (state di `oauth_states`), service account, validasi folder + folder sistem + start page token, statistik folder, endpoint settings generik; halaman Studio Pengaturan → Google Drive dengan panduan. Menunggu kredensial user.
- 2026-10-02 — Infra uji: fake Drive + DB `dummy_test` (aaPanel) + instance uji port 3299.
- 2026-10-02 — Step 6: sinkronisasi full/incremental, kategori, subtitle, missing/restore, penjadwal & pemeliharaan, kartu Sinkronisasi di admin; diuji: tambah/rename/pindah/trash/restore/subtitle/folder baru/Drive mati.
- 2026-10-02 — Step 7: streaming bertanda tangan + Range + abort, proxy internal ffmpeg, subtitle VTT, detail video & sumber; diuji (206/HEAD/403/404/privat/abort/subtitle).
- 2026-10-02 — Step 8: antrean job + worker, probe/thumbnail/rendition/compat/storyboard/hapus aset, halaman Antrean & Pemrosesan; diuji: HEVC→compat, vertikal, VP9, frame hitam dihindari, rendition lama di-trash, restart di tengah job.
- 2026-10-02 — Step 9: feed/kategori/pencarian/saran/rekomendasi/tayangan/channel + OG meta; UI Beranda, Hasil, Channel, dropdown saran; diverifikasi via screenshot.
- 2026-10-02 — Step 10: pemutar custom (kontrol, progress + storyboard, menu setelan, kualitas, subtitle, keyboard, gesture mouse & sentuh, layar penuh + orientasi, pemulihan error) + halaman Tonton dasar + `/dev/player`; diuji otomatis (keyboard, seek, double-tap akumulatif, ganti kualitas, URL rusak pulih, HEVC→compat, mobile).
- 2026-10-02 — Step 5 selesai: OAuth client dipublikasikan (In production), Drive terhubung, folder "Dymas Tube" disimpan, folder sistem dibuat, full sync pertama sukses (folder masih kosong). Cek isi folder read-only: `node /root/dv-qa/drive-peek.mjs`.
- 2026-10-02 — Persiapan GitHub: password admin dihapus dari dokumen & seluruh riwayat git (filter-branch), `scripts/pull-deploy.sh`, skrip QA disalin ke `scripts/dev/qa/`, panduan kerja dari Claude cloud.

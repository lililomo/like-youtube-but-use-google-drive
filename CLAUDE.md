# CLAUDE.md — Dymas Video

Platform video bergaya YouTube dengan sumber satu folder Google Drive. Domain: **https://video.dymas.cloud**.
Dokumen acuan: [PRD.md](PRD.md) (produk) · [SPEC.md](SPEC.md) (teknis) · [PROMPT.md](PROMPT.md) (langkah eksekusi Step 0–17).

## Aturan untuk Claude (wajib)
- Lapor dalam **Bahasa Indonesia**. UI aplikasi berbahasa Indonesia.
- **Setiap perubahan konfigurasi/setting dicatat di file ini saat itu juga** (bagian Konfigurasi, Progres, Changelog).
- Server dikelola **aaPanel**: project Node, database, SSL, nginx, cron dibuat/diubah lewat aaPanel (API `scripts/bt-api.py` atau instruksi UI ke user). Jangan pasang pm2/systemd/situs nginx sendiri.
- Nginx tambahan **hanya** di `/www/server/panel/vhost/rewrite/node_video_dymas.conf` (sumber: `scripts/nginx-custom.conf`). Jangan edit vhost utama `node_video_dymas.conf` (bisa ditimpa aaPanel).
- Node selalu dari `/www/server/nodejs/v24.18.0/bin` (tidak ada di PATH default).
- Jangan menulis secret ke file ini atau file lain di luar yang ditentukan SPEC: password root MySQL (ada di DB panel `/www/server/panel/data/default.db` → `config.mysql_root`), token API aaPanel (`/www/server/panel/config/api.json`), Client Secret / refresh token Google (tersimpan terenkripsi di tabel `settings`).
- Claude berjalan sebagai root → setelah build/ubah file jalankan `chown -R www:www /www/wwwroot/video.dymas.cloud`.
- Akhiri setiap step: build bersih, test lulus, deploy, update file ini, git commit lokal.

## Status
**Fase: eksekusi berjalan.** Lihat Progres di bawah.

### Progres
- [x] Step 0 — Persiapan server (ffmpeg, bt-api.py, DB `dummy`, git) — 2026-10-02
- [ ] Step 1 — Kerangka proyek, Node Project aaPanel, nginx custom, SSL
- [ ] Step 2 — Database, migrasi, settings, kriptografi
- [ ] Step 3 — Auth, sesi, CSRF, tamu, manajemen user
- [ ] Step 4 — Fondasi frontend & design system YouTube
- [ ] Step 5 — Integrasi Google Drive (🧑 user membuat kredensial)
- [ ] Step 6 — Sinkronisasi folder
- [ ] Step 7 — Streaming
- [ ] Step 8 — Pemrosesan media (ffmpeg)
- [ ] Step 9 — Beranda, pencarian, kategori, channel
- [ ] Step 10 — Pemutar inti
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

## Konfigurasi Aplikasi (rencana — perbarui menjadi nilai aktual saat dieksekusi)
| Item | Nilai |
|---|---|
| Folder aplikasi | `/www/wwwroot/video.dymas.cloud` |
| Stack | Node 24 + Fastify 5 + TypeScript (server) · React 19 + Vite 7 (web) · MariaDB · ffmpeg |
| aaPanel Node Project | `video_dymas` · script `/www/wwwroot/video.dymas.cloud/server/dist/index.js` · port **3210** · run user `www` · auto start on |
| Bind | `127.0.0.1:3210` (hanya lewat nginx) |
| Vhost aaPanel | `/www/server/panel/vhost/nginx/node_video_dymas.conf` (jangan diedit) |
| Nginx custom | `/www/server/panel/vhost/rewrite/node_video_dymas.conf` ← `scripts/nginx-custom.conf` |
| Log aplikasi | `/www/server/nodejs/vhost/logs/video_dymas.log` |
| Skrip start / pid aaPanel | `/www/server/nodejs/vhost/scripts/video_dymas.sh` · `/www/server/nodejs/vhost/pids/video_dymas.pid` |
| Log nginx | `/www/wwwlogs/` |
| SSL | Let's Encrypt via aaPanel + Force HTTPS (belum) |
| Storage lokal | `storage/public` (→ `/media/`), `storage/cache`, `storage/tmp` |
| Google Drive | OAuth (default) · redirect URI `https://video.dymas.cloud/api/admin/drive/oauth/callback` · folder sistem `_dymasvideo_system/renditions` |

## Kredensial (non-rahasia/permintaan user)
- Admin aplikasi (awal): **admin / <lihat ADMIN_INITIAL_PASSWORD di .env server>** (seeder; jika diganti, catat bahwa sudah diganti — jangan tulis password baru).
- Database: host `localhost`, user `dummy`, password `dummy`, database `dummy` (disarankan diganti setelah stabil → ubah `.env`).
- `.env` (mode 600, milik www) berisi `APP_KEY` — **jangan diubah setelah ada data** (dipakai enkripsi secret). Backup: `/root/backup/video_dymas.env` (Step 16).

## Helper aaPanel API
```bash
python3 scripts/bt-api.py '/system?action=GetSystemTotal'                 # tes koneksi
python3 scripts/bt-api.py '/data?action=getData' table=databases limit=20 p=1 search=dummy
```
Argumen `key=value` dikirim sebagai form field. Cookie jar: `/root/.bt-api-cookies.txt` (600). Host bisa diganti via env `BT_API_HOST`.

## Perintah (diisi saat Step 1)
```bash
export PATH=/www/server/nodejs/v24.18.0/bin:$PATH
# build:    npm run build
# migrate:  npm run migrate
# deploy:   bash scripts/deploy.sh
# restart:  python3 scripts/bt-api.py /project/nodejs/restart_project project_name=video_dymas
# log:      tail -f /www/server/nodejs/vhost/logs/video_dymas.log
# health:   curl -fsS https://video.dymas.cloud/api/health
```

## Keputusan
Ringkasan keputusan produk ada di PRD.md §4. Penyimpangan dari SPEC selama eksekusi dicatat di sini dengan tanggal & alasan.

## Changelog
- 2026-10-02 — Analisis server; dibuat PRD.md, SPEC.md, PROMPT.md, CLAUDE.md. Belum ada kode.
- 2026-10-02 — Step 0: ffmpeg 4.4.2 dipasang (apt); `scripts/bt-api.py` dibuat & teruji; DB `dummy` dibuat via aaPanel API; git lokal diinisialisasi (branch main, tanpa remote).

# SPEC — GDrive Tube (Spesifikasi Teknis)

> Nama aplikasi = setting `site.name` (default **GDrive Tube**). Nama kode/infrastruktur tetap "Dymas Video" (`video_dymas`, `_dymasvideo_system`, prefix `dv-`/`dv_`).

> Versi: 1.0 · Tanggal: 2026-10-02 · Mengacu ke [PRD.md](PRD.md). Langkah eksekusi di [PROMPT.md](PROMPT.md). Konfigurasi aktual & progres dicatat di [CLAUDE.md](CLAUDE.md).
> Bila SPEC dan PRD bertentangan, **PRD menang** untuk perilaku produk, **SPEC menang** untuk detail teknis.

---

## 1. Ringkasan Arsitektur

```
 Browser (React SPA + Player TS)
    │  HTTPS (video.dymas.cloud)
    ▼
 Nginx 1.24 (aaPanel vhost: node_video_dymas.conf)
    ├── /assets/*  → file statis web/dist/assets (cache 1 tahun)
    ├── /media/*   → file statis storage/public (thumbnail, storyboard, logo)
    ├── /internal/* → 404 (hanya untuk localhost)
    ├── /stream/*  → proxy ke Node (proxy_buffering off)
    ├── /api/uploads* → proxy ke Node (body 64 MB, request buffering off)
    └── /*         → proxy ke Node 127.0.0.1:3210 (API + SPA index.html)
             │
             ▼
 Node.js 24 (Fastify) — satu proses (aaPanel Node Project "video_dymas")
    ├── HTTP API (/api/*), SPA fallback, OG meta injection
    ├── Stream proxy (/stream/*) ──Range──►  Google Drive API (alt=media)
    ├── Upload relay (/api/uploads/*) ──resumable──► Google Drive API
    ├── Internal proxy (/internal/drive/*) untuk ffmpeg/ffprobe
    ├── Scheduler: sync Drive (60 dtk incremental, 6 jam full), pembersihan
    └── Job worker (lane ringan ×2, lane berat ×1) ──► ffmpeg/ffprobe (child process, nice)
             │
             ▼
 MariaDB 10.11 (aaPanel) — database `dummy`
 Disk lokal: storage/ (thumbnail, storyboard, cache subtitle, tmp transcode)
 Google Drive: folder sumber + subfolder sistem `_dymasvideo_system/renditions`
```

Prinsip:
- File Drive **tidak pernah dibagikan publik**; semua akses media melalui server dengan kredensial admin.
- Database adalah indeks/cache dari Drive + data aplikasi (user, playlist, histori). Drive tetap sumber kebenaran file video.
- Satu proses Node cukup (I/O-bound); kerja berat (ffmpeg) di child process ber-`nice`.

---

## 2. Stack Teknologi

| Lapisan | Pilihan | Catatan |
|---|---|---|
| Runtime | **Node.js v24.18.0** (sudah terpasang via aaPanel: `/www/server/nodejs/v24.18.0/bin`) | ESM, `process.loadEnvFile()` bawaan |
| Bahasa | TypeScript 5 (strict) | Server di-build `tsc` → `server/dist`; dev pakai `tsx watch` |
| HTTP | **Fastify 5** + `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/multipart` | |
| Validasi | `zod` | |
| DB | **MariaDB 10.11** (aaPanel) via `mysql2/promise` (pool) | SQL murni + migrasi `.sql` |
| Password | `@node-rs/argon2` (argon2id, prebuilt) | |
| Google | `google-auth-library` (OAuth2/JWT) + `@googleapis/drive` (metadata) + `undici` (media & resumable upload) | |
| Gambar | `sharp` (resize/webp/entropy thumbnail) | |
| Media | **ffmpeg/ffprobe** (apt, Ubuntu 22.04: 4.4.x) | dipasang di Step 0 |
| Frontend | **React 19 + Vite 7 + TypeScript**, `react-router` 7, `@tanstack/react-query` 5, `zustand`, `@dnd-kit/sortable`, `@fontsource/roboto` (self-host) | Tanpa UI kit; CSS murni dengan design token |
| Player | **Custom vanilla TypeScript** (tanpa video.js/plyr/hls.js) dibungkus komponen React | Progressive MP4 + Range |
| Test | `vitest` (unit server & util web); Playwright (opsional, QA screenshot) | |

Monorepo npm workspaces: `server/` dan `web/`.

---

## 3. Infrastruktur Server & aaPanel

### 3.1 Fakta server (diverifikasi 2026-10-02)
| Item | Nilai |
|---|---|
| OS | Ubuntu 22.04.5 LTS, 6 vCPU, RAM 11 GB, disk sisa ±50 GB |
| IP publik | `164.152.166.91` (A record `video.dymas.cloud` sudah mengarah ke sini) |
| aaPanel | port panel `11111` (HTTPS), API aktif, whitelist: `localhost`, `164.152.166.91`, dll. Konfig API: `/www/server/panel/config/api.json` |
| Nginx | `/www/server/nginx/sbin/nginx` 1.24.0; vhost: `/www/server/panel/vhost/nginx/`; include rewrite: `/www/server/panel/vhost/rewrite/`; global `client_max_body_size 50m` |
| Node | `/www/server/nodejs/v24.18.0/bin/{node,npm,npx,pm2}` (tidak ada di PATH default → selalu pakai path lengkap atau `export PATH=/www/server/nodejs/v24.18.0/bin:$PATH`) |
| Node Project aaPanel | skrip start: `/www/server/nodejs/vhost/scripts/<nama>.sh`, log: `/www/server/nodejs/vhost/logs/<nama>.log`, pid: `/www/server/nodejs/vhost/pids/<nama>.pid` |
| MariaDB | 10.11 di `/www/server/mysql` (client: `/www/server/mysql/bin/mysql`); port 3306; password root tersimpan di DB panel (`/www/server/panel/data/default.db`, tabel `config`, kolom `mysql_root`) — **jangan ditulis ke file mana pun** |
| Redis | ada (port 6379, ber-password) — **tidak dipakai** |
| ffmpeg | **belum terpasang** → `apt-get install -y ffmpeg` |
| Port terpakai | 21 25 53 80 110 143 443 465 587 631 887 888 993 995 3001 3306 4000 6379 7080 8188 8190 8288-8290 11111 11332-11334 18888 19999 … |
| Port aplikasi | **3210** (bebas saat dicek) |
| DB `dummy` | **belum ada** (login `dummy/dummy` ditolak) → dibuat via aaPanel |

### 3.2 Nama & parameter aaPanel
| Item | Nilai |
|---|---|
| Node Project name | `video_dymas` |
| project_cwd | `/www/wwwroot/video.dymas.cloud` |
| project_script | `/www/wwwroot/video.dymas.cloud/server/dist/index.js` (path absolut → aaPanel menjalankan `node <script>`) |
| port | `3210` |
| run_user | `www` |
| nodejs_version | `v24.18.0` |
| bind_extranet / domains | `1` / `["video.dymas.cloud"]` |
| is_power_on | `1` |
| max_memory_limit | `2048` |
| vhost (dibuat aaPanel) | `/www/server/panel/vhost/nginx/node_video_dymas.conf` (**jangan diedit manual**, aaPanel bisa menimpanya) |
| custom nginx (aman diedit) | `/www/server/panel/vhost/rewrite/node_video_dymas.conf` (di-include di dalam blok `server`) |
| Database | name `dummy`, user `dummy`, password `dummy`, charset `utf8mb4`, akses lokal |

### 3.3 Helper API aaPanel — `scripts/bt-api.py`
aaPanel API: `POST https://127.0.0.1:11111/<path>` dengan field `request_time` (unix detik) dan `request_token = md5(request_time + token)`, `token` dibaca dari `/www/server/panel/config/api.json` (kunci `token`; lihat `class/common.py` baris ~395). Simpan cookie jar antar-request. Sertifikat panel self-signed → nonaktifkan verifikasi TLS untuk localhost.

Contoh pemakaian (dibuat di Step 0):
```bash
python3 scripts/bt-api.py /system?action=GetSystemTotal
python3 scripts/bt-api.py /database?action=AddDatabase name=dummy db_user=dummy password=dummy codeing=utf8mb4 address=127.0.0.1 dtype=MySQL ps="Dymas Video" sid=0
python3 scripts/bt-api.py /project/nodejs/create_project project_name=video_dymas ...   # parameter §3.2
python3 scripts/bt-api.py /project/nodejs/restart_project project_name=video_dymas
```
Catatan:
- Route project aaPanel ini: `/project/<mod>/<def>/<stype>` (lihat `BTPanel/__init__.py` ±baris 1580). Coba `/project/nodejs/create_project`; bila 404 coba dengan suffix (mis. `/project/nodejs/create_project/json`). Beberapa versi menerima parameter sebagai field biasa, versi lain sebagai `data=<JSON>` — verifikasi dengan pemanggilan read-only dulu (mis. `get_project_list`).
- Bila IP whitelist menolak (klien terlihat sebagai `127.0.0.1`, bukan `localhost`), minta user menambahkan `127.0.0.1` di aaPanel → Settings → API.
- **Fallback manual** (bila API tidak bisa dipakai): minta user membuat lewat UI aaPanel: *Website → Node Project → Add Node project* dengan parameter §3.2; *Databases → Add DB* dengan parameter §3.2; *SSL → Let's Encrypt*.
- Fungsi internal yang dipanggil: `projectModel/nodejsModel.py: create_project/start_project/restart_project`, `database.py: AddDatabase`, `acme_v2.py: apply_cert_api`, `panelSite.py: SetSSL / HttpToHttps`.

### 3.4 Database
Buat via aaPanel (`AddDatabase`) agar muncul di menu Database aaPanel. Verifikasi:
```bash
/www/server/mysql/bin/mysql -h localhost -udummy -pdummy dummy -e "select 1"
/www/server/mysql/bin/mysql -h 127.0.0.1 -udummy -pdummy dummy -e "select 1"
```
Kedua cara harus berhasil (user perlu ada untuk `localhost` dan `127.0.0.1`). Bila salah satu gagal, tambahkan grant yang kurang dengan root (password root dibaca dari DB panel saat runtime, tidak disimpan). Aplikasi memakai `DB_HOST=localhost` (TCP); `DB_SOCKET` opsional (`/tmp/mysql.sock`).

### 3.5 Nginx custom — isi `/www/server/panel/vhost/rewrite/node_video_dymas.conf`
```nginx
# === Dymas Video custom config (dikelola via CLAUDE.md; jangan hapus) ===
client_max_body_size 64m;

location ^~ /internal/ { return 404; }

location ^~ /assets/ {
    alias /www/wwwroot/video.dymas.cloud/web/dist/assets/;
    access_log off;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location ^~ /media/ {
    alias /www/wwwroot/video.dymas.cloud/storage/public/;
    access_log off;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable";
}

location ^~ /stream/ {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_max_temp_file_size 0;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    gzip off;
}

location ^~ /api/uploads {
    client_max_body_size 64m;
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```
Setelah mengubah: `/www/server/nginx/sbin/nginx -t && /etc/init.d/nginx reload`.

### 3.6 SSL
Let's Encrypt via aaPanel (HTTP-01) untuk `video.dymas.cloud`, aktifkan *Force HTTPS*. Lewat API (`/acme?action=apply_cert_api` dengan `id=<site id>`, `domains=["video.dymas.cloud"]`, `auth_type=http`, `auth_to=<site id>`, lalu `/site?action=SetSSL` dan `HttpToHttps`) atau manual di UI (Node Project → SSL). Auto-renew dikelola aaPanel.

### 3.7 Izin file & proses
- Semua file proyek milik `www:www` (`chown -R www:www /www/wwwroot/video.dymas.cloud` setelah build — Claude berjalan sebagai root).
- `.env` mode `600`, milik `www`.
- `storage/` writable oleh `www`. ffmpeg/ffprobe harus executable oleh `www`.
- Aplikasi bind ke `127.0.0.1:3210` saja (tidak terbuka ke publik; nginx sebagai pintu).

### 3.8 Deploy — `scripts/deploy.sh`
```
1. export PATH=/www/server/nodejs/v24.18.0/bin:$PATH
2. npm ci (root, workspaces)            # atau npm install bila lock berubah
3. npm run build                         # tsc server + vite build web
4. npm run migrate                       # migrasi DB (idempoten)
5. chown -R www:www /www/wwwroot/video.dymas.cloud && chmod 600 .env
6. restart via bt-api.py /project/nodejs/restart_project (fallback: kill pid file + jalankan /www/server/nodejs/vhost/scripts/video_dymas.sh)
7. health check: curl -fsS https://video.dymas.cloud/api/health (retry 10x/1 dtk)
```

---

## 4. Struktur Direktori

```
/www/wwwroot/video.dymas.cloud/
├── CLAUDE.md  PRD.md  SPEC.md  PROMPT.md
├── package.json            # workspaces: ["server","web"]; scripts: build, migrate, seed, dev, test, deploy
├── package-lock.json
├── .env  .env.example  .gitignore
├── scripts/
│   ├── bt-api.py           # helper API aaPanel
│   ├── deploy.sh
│   ├── smoke.sh            # uji cepat endpoint penting via curl
│   └── nginx-custom.conf   # salinan sumber §3.5 (yang dipasang ke rewrite/)
├── server/
│   ├── package.json  tsconfig.json
│   ├── migrations/         # 001_init.sql, 002_..., berurutan
│   └── src/
│       ├── index.ts        # bootstrap: config → db → app → scheduler → worker → listen; graceful shutdown
│       ├── app.ts          # buat instance Fastify, plugin, route
│       ├── config.ts       # load .env (process.loadEnvFile), validasi zod
│       ├── db.ts           # pool mysql2, helper query/tx
│       ├── migrate.ts  seed.ts
│       ├── lib/            # crypto.ts ids.ts sign.ts range.ts srt2vtt.ts format.ts disk.ts ffmpeg.ts lru.ts errors.ts
│       ├── plugins/        # auth.ts (session/guest/csrf), access.ts, rateLimit.ts, spa.ts (static+OG)
│       ├── modules/
│       │   ├── settings/   # service (cache + enkripsi secret), routes admin
│       │   ├── auth/       # login/logout/me/password
│       │   ├── users/      # admin CRUD
│       │   ├── drive/      # client (token, list, get, media, resumable, folders), oauth routes
│       │   ├── sync/       # full & incremental sync, kategori, subtitle matching
│       │   ├── videos/     # feed, detail, related, search, suggest, update, delete, views
│       │   ├── stream/     # /stream & /internal/drive
│       │   ├── subtitles/  # vtt endpoint, upload subtitle
│       │   ├── processing/ # job queue, worker, handlers (probe, thumbnail, media, delete_assets)
│       │   ├── uploads/    # init/chunk/status/cancel
│       │   ├── playlists/
│       │   ├── history/    # progress & histori
│       │   ├── channels/
│       │   └── admin/      # stats, system, audit, jobs
│       └── types.ts
├── web/
│   ├── package.json  tsconfig.json  vite.config.ts  index.html
│   ├── public/             # favicon default, robots.txt, manifest
│   └── src/
│       ├── main.tsx  App.tsx  router.tsx
│       ├── styles/         # tokens.css, base.css, utilities.css
│       ├── i18n/id.ts      # SEMUA teks UI
│       ├── lib/            # format.ts (angka/waktu id), api.ts, storage.ts (localStorage aman), dom.ts
│       ├── stores/         # session.ts theme.ts ui.ts uploads.ts history.ts (guest) prefs.ts
│       ├── components/
│       │   ├── layout/     # Masthead, SearchBox, Guide, MiniGuide, GuideDrawer, MobileNav, AccountMenu, TopProgress
│       │   ├── video/      # VideoCard, VideoGrid, CompactVideo, ResultItem, Thumbnail, DurationBadge, ChipBar
│       │   ├── playlist/   # SaveDialog, PlaylistCard, PlaylistPanel
│       │   ├── upload/     # UploadDialog, UploadManager
│       │   ├── ui/         # Button, IconButton, Menu, Dialog, Toast/Snackbar, Tooltip, Skeleton, Switch, Select, Avatar, Spinner, Tabs, Table
│       │   └── icons/      # Icon.tsx + paths Material Symbols (Apache-2.0)
│       ├── player/
│       │   ├── core/       # Player.ts (state machine), sources.ts (quality/ABR), subtitles.ts, storyboard.ts, prefs.ts, events.ts
│       │   ├── ui/         # controls.ts, progress.ts, settingsMenu.ts, gestures.ts, keyboard.ts, overlays.ts, endscreen.ts, contextMenu.ts, fullscreen.ts, mediaSession.ts
│       │   ├── player.css
│       │   └── PlayerView.tsx
│       └── pages/          # Home, Watch, Results, Playlist, PlaylistsMine, PlaylistsPublic, You, History, Channel, MyVideos, Login, Account, NotFound, admin/*
└── storage/                # milik www; tidak di-commit
    ├── public/thumbs/  public/sb/  public/branding/  public/avatars/
    ├── cache/subs/
    └── tmp/
```

---

## 5. Konfigurasi

### 5.1 `.env`
```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3210
APP_URL=https://video.dymas.cloud
TRUST_PROXY=127.0.0.1

DB_HOST=localhost
DB_PORT=3306
DB_USER=dummy
DB_PASSWORD=dummy
DB_NAME=dummy
DB_SOCKET=

# 32 byte acak, base64. JANGAN DIUBAH setelah ada data (dipakai enkripsi secret & HMAC).
APP_KEY=base64:...
INTERNAL_TOKEN=...            # 32 byte acak hex; untuk /internal/drive

STORAGE_DIR=/www/wwwroot/video.dymas.cloud/storage
WEB_DIST_DIR=/www/wwwroot/video.dymas.cloud/web/dist
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
LOG_LEVEL=info

ADMIN_USERNAME=admin
ADMIN_INITIAL_PASSWORD=...          # rahasia, hanya di .env server (tidak di repo)
```
Kunci turunan: `encKey = HKDF(APP_KEY, "dv-enc")`, `streamKey = HKDF(APP_KEY, "dv-stream")`, `stateKey = HKDF(APP_KEY, "dv-oauth-state")`.

### 5.2 Settings (tabel `settings`, dikelola dari admin)
Nilai disimpan JSON; `is_secret=1` → dienkripsi AES-256-GCM (`v1:<iv b64>:<tag b64>:<ct b64>`), tidak pernah dikirim balik ke browser (hanya `"••••" / configured: true`). Cache in-memory, invalidasi saat update.

| Key | Default | Keterangan |
|---|---|---|
| `site.name` | `"GDrive Tube"` | nama aplikasi: logo/wordmark, `<title>`, OG `site_name`, login; disisipkan server ke `index.html` |
| `site.logo_url` | `null` | logo (PNG hasil render) di `storage/public/branding/logo-<key>.png` |
| `site.logo_dark_url` | `null` | varian logo untuk tema gelap (`logodark-<key>.png`), opsional |
| `site.logo_mode` | `"icon"` | `icon` = gambar menggantikan ikon bulat + nama ditulis; `full` = gambar = seluruh logo. Ditebak saat upload (lebar ≥ 1,6× tinggi → `full`) |
| `site.favicon_url` / `site.touch_icon_url` | `null` | favicon PNG 64 px & apple-touch-icon 180 px (`favicon-<key>-{64,180}.png`); 180 px juga jadi foto channel utama |
| `site.channel_name` | `"GDrive Tube"` | channel utama (video dari Drive) |
| `site.channel_handle` | `"gdrivetube"` | `/@gdrivetube`; username user tidak boleh sama |
| `site.default_theme` | `"system"` | `system` / `dark` / `light` |
| `site.guest_playlists` | `true` | izinkan tamu membuat playlist |
| `drive.auth_mode` | `"oauth"` | `oauth` / `service_account` |
| `drive.oauth_client_id` | `""` | |
| `drive.oauth_client_secret` 🔒 | `""` | |
| `drive.oauth_refresh_token` 🔒 | `""` | diisi oleh callback OAuth |
| `drive.connected_email` | `null` | |
| `drive.service_account_json` 🔒 | `""` | mode SA (Shared Drive saja) |
| `drive.shared_drive_id` | `null` | terisi otomatis bila folder ada di Shared Drive |
| `drive.root_folder_id` / `drive.root_folder_name` | `null` | |
| `drive.system_folder_id` / `drive.renditions_folder_id` | `null` | dibuat otomatis: `_dymasvideo_system/renditions` |
| `drive.include_subfolders` | `true` | |
| `drive.sync_interval_sec` | `60` | incremental (Changes API) |
| `drive.full_sync_interval_min` | `360` | |
| `drive.changes_page_token` | `null` | |
| `drive.last_sync_at` / `drive.last_full_sync_at` / `drive.last_sync_error` | `null` | |
| `processing.enabled` | `true` | |
| `processing.renditions` | `[720, 360]` | pilihan: 1080, 720, 480, 360 |
| `processing.compat_max_height` | `1080` | versi kompatibel untuk sumber tak-terputar |
| `processing.storyboard` | `true` | |
| `processing.x264_preset` | `"veryfast"` | |
| `processing.threads` | `3` | |
| `processing.nice` | `15` | |
| `processing.min_free_disk_gb` | `5` | |
| `upload.enabled` | `true` | |
| `upload.max_file_gb` | `10` | |
| `upload.allowed_ext` | `["mp4","m4v","mov","mkv","webm","avi","wmv","flv","ts","mts","m2ts","3gp","mpg","mpeg","ogv"]` | |
| `upload.chunk_mb` | `16` | kelipatan 256 KiB |
| `upload.default_visibility` | `"public"` | |
| `upload.default_quota_gb` | `null` | null = tanpa batas |
| `player.autoplay_default` | `true` | |
| `player.seek_seconds` | `10` | |
| `player.endscreen_countdown` | `5` | detik |
| `security.session_days` | `30` | |

---

## 6. Skema Database (`server/migrations/001_init.sql`)

Semua tabel `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`. Waktu disimpan UTC (`SET time_zone='+00:00'` pada setiap koneksi pool).

```sql
CREATE TABLE schema_migrations (
  id VARCHAR(100) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,            -- ^[a-z0-9_.]{3,32}$
  display_name VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  avatar_color CHAR(7) NOT NULL DEFAULT '#5c6bc0',
  avatar_key VARCHAR(16) NULL,                     -- foto profil: storage/public/avatars/<id>-<key>.webp (migrasi 002)
  storage_quota_bytes BIGINT UNSIGNED NULL,
  storage_used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,              -- sha256 hex dari cookie dv_sid
  user_id INT UNSIGNED NOT NULL,
  remember TINYINT(1) NOT NULL DEFAULT 0,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id), KEY idx_exp (expires_at),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  drive_folder_id VARCHAR(128) NOT NULL UNIQUE,
  parent_id INT UNSIGNED NULL,                      -- NULL = anak langsung folder root
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(191) NOT NULL UNIQUE,
  path VARCHAR(1024) NOT NULL,                      -- "Film / Aksi"
  depth TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  missing_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parent_id)
);

CREATE TABLE videos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(11) NOT NULL UNIQUE,               -- randomBytes(8).base64url
  drive_file_id VARCHAR(128) NOT NULL UNIQUE,
  drive_parent_id VARCHAR(128) NULL,
  category_id INT UNSIGNED NULL,                    -- NULL = folder root
  owner_user_id INT UNSIGNED NULL,                  -- NULL = channel utama
  source ENUM('drive','upload') NOT NULL DEFAULT 'drive',
  visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  status ENUM('pending','processing','ready','failed','missing') NOT NULL DEFAULT 'pending',
  prev_status VARCHAR(16) NULL,                     -- untuk pemulihan dari 'missing'
  title VARCHAR(500) NOT NULL,                      -- nama file tanpa ekstensi terakhir
  search_text VARCHAR(600) NOT NULL,                -- lower(title) dengan _ . - diganti spasi
  file_name VARCHAR(512) NOT NULL,
  mime_type VARCHAR(100) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  md5 CHAR(32) NULL,
  duration_ms INT UNSIGNED NULL,
  width SMALLINT UNSIGNED NULL,
  height SMALLINT UNSIGNED NULL,
  rotation SMALLINT NULL,
  video_codec VARCHAR(32) NULL,
  audio_codec VARCHAR(32) NULL,
  container VARCHAR(64) NULL,
  bitrate_kbps INT UNSIGNED NULL,
  original_playable TINYINT(1) NULL,
  thumb_key CHAR(12) NULL,                          -- token acak di nama file thumbnail
  storyboard JSON NULL,
  processing_error TEXT NULL,
  view_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  drive_created_at DATETIME NULL,
  drive_modified_at DATETIME NULL,
  published_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_list (deleted_at, status, visibility, published_at),
  KEY idx_cat (category_id, published_at),
  KEY idx_owner (owner_user_id, published_at),
  KEY idx_views (view_count),
  FULLTEXT KEY ft_search (search_text),
  CONSTRAINT fk_vid_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_vid_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE video_renditions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT UNSIGNED NOT NULL,
  height SMALLINT UNSIGNED NOT NULL,                -- label (sisi pendek): 1080/720/480/360
  width SMALLINT UNSIGNED NOT NULL,
  real_height SMALLINT UNSIGNED NOT NULL,
  kind ENUM('quality','compat') NOT NULL DEFAULT 'quality',
  drive_file_id VARCHAR(128) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bitrate_kbps INT UNSIGNED NULL,
  status ENUM('pending','ready','failed') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vid_h (video_id, height),
  CONSTRAINT fk_rend_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE subtitles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(128) NOT NULL UNIQUE,
  lang VARCHAR(16) NULL,
  label VARCHAR(64) NOT NULL,
  format ENUM('srt','vtt') NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  drive_modified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_vid (video_id),
  CONSTRAINT fk_sub_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE playlists (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(34) NOT NULL UNIQUE,            -- 'PL' + randomBytes(16).base64url
  title VARCHAR(150) NOT NULL,
  owner_user_id INT UNSIGNED NULL,
  guest_hash CHAR(64) NULL,                         -- sha256(dv_gid)
  visibility ENUM('public','private') NOT NULL DEFAULT 'private',
  item_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_owner (owner_user_id, updated_at),
  KEY idx_guest (guest_hash, updated_at),
  KEY idx_vis (visibility, updated_at),
  CONSTRAINT fk_pl_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE playlist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  playlist_id BIGINT UNSIGNED NOT NULL,
  video_id BIGINT UNSIGNED NOT NULL,
  position INT UNSIGNED NOT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pl_vid (playlist_id, video_id),
  KEY idx_pos (playlist_id, position),
  CONSTRAINT fk_pli_pl FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_pli_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE watch_history (
  user_id INT UNSIGNED NOT NULL,
  video_id BIGINT UNSIGNED NOT NULL,
  position_sec INT UNSIGNED NOT NULL DEFAULT 0,
  duration_sec INT UNSIGNED NOT NULL DEFAULT 0,
  watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, video_id),
  KEY idx_user_time (user_id, watched_at),
  CONSTRAINT fk_wh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_wh_vid FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(32) NOT NULL,                        -- probe | thumbnail | media | delete_assets
  lane ENUM('light','heavy') NOT NULL DEFAULT 'light',
  video_id BIGINT UNSIGNED NULL,
  payload JSON NULL,
  priority TINYINT NOT NULL DEFAULT 5,              -- kecil = duluan
  status ENUM('queued','running','done','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  run_after DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pick (status, lane, priority, run_after),
  KEY idx_vid (video_id)
);

CREATE TABLE uploads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(22) NOT NULL UNIQUE,
  user_id INT UNSIGNED NOT NULL,
  video_public_id CHAR(11) NOT NULL,                -- dialokasikan saat init (ditaruh di appProperties)
  file_name VARCHAR(512) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  received_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  visibility ENUM('public','private') NOT NULL,
  category_id INT UNSIGNED NULL,
  target_folder_id VARCHAR(128) NOT NULL,
  session_url_enc TEXT NOT NULL,                    -- URL sesi resumable Drive (terenkripsi)
  status ENUM('uploading','completed','failed','cancelled','expired') NOT NULL DEFAULT 'uploading',
  drive_file_id VARCHAR(128) NULL,
  video_id BIGINT UNSIGNED NULL,
  error TEXT NULL,
  expires_at DATETIME NOT NULL,                     -- +7 hari (umur sesi Drive)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user (user_id, status),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE settings (
  `key` VARCHAR(100) PRIMARY KEY,
  `value` MEDIUMTEXT NOT NULL,
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL
);

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,                      -- login.success, login.fail, user.create, settings.update, video.delete, ...
  target_type VARCHAR(32) NULL,
  target_id VARCHAR(64) NULL,
  meta JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_time (created_at), KEY idx_user (user_id)
);
```
Seeder: buat admin `ADMIN_USERNAME`/`ADMIN_INITIAL_PASSWORD` **hanya jika belum ada user ber-role admin** (tidak menimpa password yang sudah diganti).

---

## 7. Integrasi Google Drive

### 7.1 Mode autentikasi
| Mode | Kapan | Scope |
|---|---|---|
| **OAuth (default)** | Folder di "My Drive" akun Google biasa/Workspace | `https://www.googleapis.com/auth/drive` + `openid email` |
| **Service Account** | Folder berada di **Shared Drive** (Workspace) dan SA ditambahkan sebagai anggota (Content manager) | `https://www.googleapis.com/auth/drive` |

Alasan scope `drive` (bukan `drive.file`): aplikasi harus membaca file yang **tidak** dibuat oleh aplikasi. API key polos tidak dipakai karena tidak bisa membaca file privat & tidak bisa upload (jelaskan ini di UI).

### 7.2 Alur OAuth
1. `POST /api/admin/drive/oauth/start` → buat `state` acak (simpan sha256 di `oauth_states`, 10 menit, terikat admin) → kembalikan `authUrl`:
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=https://video.dymas.cloud/api/admin/drive/oauth/callback&response_type=code&scope=<drive openid email>&access_type=offline&prompt=consent&include_granted_scopes=true&state=…`
2. `GET /api/admin/drive/oauth/callback?code&state` → validasi state + sesi admin → tukar code → simpan `refresh_token` (terenkripsi) + email (dari id_token / `about.get(fields=user)`) → redirect `/admin/settings/drive?connected=1` (atau `?error=…`).
3. Token akses di-cache di memori sampai 60 dtk sebelum kedaluwarsa; refresh otomatis; bila Google merotasi refresh token, simpan yang baru. `invalid_grant` → tandai `drive.last_sync_error = "Token tidak valid, hubungkan ulang"` dan tampilkan banner di admin.
4. `POST /api/admin/drive/disconnect` → revoke token (best effort) & hapus secret.

**Panduan di UI (wajib ditampilkan di halaman pengaturan Drive):**
1. Buka Google Cloud Console → buat project.
2. *APIs & Services → Library* → aktifkan **Google Drive API**.
3. *Google Auth Platform / OAuth consent screen*: tipe **External**, isi nama & email; *Data access* tambahkan scope `.../auth/drive`; *Audience* → **Publish app** (status **In production** — wajib, kalau masih *Testing* token kedaluwarsa tiap 7 hari).
4. *Clients → Create client → Web application* → Authorized redirect URI: `https://video.dymas.cloud/api/admin/drive/oauth/callback` (tampilkan dengan tombol salin).
5. Tempel Client ID & Secret → Simpan → **Hubungkan Google Drive** → pilih akun pemilik folder → bila muncul "Google hasn't verified this app": *Advanced → Go to … (unsafe)* → Allow.
6. Tempel URL folder → **Simpan & Sinkronkan**.

### 7.3 Folder sumber
- Input diterima: `https://drive.google.com/drive/folders/<ID>`, `…/drive/u/N/folders/<ID>`, `…/open?id=<ID>`, `…?id=<ID>`, atau ID polos. Regex ID: `[A-Za-z0-9_-]{10,}`.
- Validasi: `files.get(id, fields=id,name,mimeType,driveId,capabilities(canAddChildren,canListChildren))`, mimeType harus `application/vnd.google-apps.folder`, `canAddChildren` harus true (agar upload bisa). Simpan `driveId` sebagai `drive.shared_drive_id` bila ada.
- Saat disimpan: buat/temukan folder sistem `_dymasvideo_system` dan subfolder `renditions` di dalam root (appProperties `dvRole=system`), simpan ID-nya, ambil `changes.getStartPageToken`, lalu jalankan **full sync**.
- Mengganti folder root → konfirmasi di UI ("Video dari folder lama akan disembunyikan") → semua video `source='drive'` lama ditandai `missing` oleh full sync berikutnya.

### 7.4 Modul `drive/client.ts`
Semua request menyertakan `supportsAllDrives=true` (+ `includeItemsFromAllDrives=true` & `corpora=drive&driveId=…` untuk list di Shared Drive).
```
FILE_FIELDS = "id,name,mimeType,size,md5Checksum,parents,trashed,createdTime,modifiedTime,appProperties,videoMediaMetadata(width,height,durationMillis)"

listChildren(folderId, pageToken?)      // q: "'<id>' in parents and trashed=false", pageSize 1000
getFile(id)
createFolder(name, parentId, appProperties)
updateFile(id, {name?, appProperties?, addParents?, removeParents?})
trashFile(id)                            // files.update trashed=true (bukan delete permanen)
getStartPageToken() / listChanges(token)
mediaRequest(id, {range?, signal})       // undici.request GET /drive/v3/files/<id>?alt=media&acknowledgeAbuse=true&supportsAllDrives=true
createResumableSession({name, mimeType, size, parents, appProperties}, origin?)
uploadFileFromDisk(path, {name, parents, appProperties})   // resumable, untuk rendition
```
Retry: 429/5xx/`userRateLimitExceeded`/`rateLimitExceeded` → backoff eksponensial (0.5, 1, 2, 4 dtk + jitter, maks 5x). 401 → paksa refresh token sekali lalu ulangi. `undici.Agent` keep-alive, `connections: 64`.

### 7.5 `appProperties` yang ditulis aplikasi
| Pada | Properti |
|---|---|
| File upload user | `dv=1`, `dvVid=<public_id>`, `dvOwner=<user_id>`, `dvVis=public|private` |
| File rendition | `dv=1`, `dvRole=rendition`, `dvVid=<public_id>`, `dvH=<height>` |
| Folder sistem | `dv=1`, `dvRole=system` |

Perubahan visibilitas/pemilik juga memperbarui `appProperties` (async, best effort) agar database bisa dibangun ulang dari Drive.

---

## 8. Sinkronisasi Folder (`modules/sync`)

### 8.1 Klasifikasi file
- **Video**: `mimeType` diawali `video/` **atau** ekstensi ∈ `upload.allowed_ext`. Abaikan file dengan `appProperties.dvRole`.
- **Subtitle**: ekstensi `srt` / `vtt`.
- **Folder**: `application/vnd.google-apps.folder`; abaikan folder sistem dan nama diawali `_` atau `.`.
- Lainnya diabaikan.
- **Judul** = nama file tanpa ekstensi terakhir (`"Film.Bagus.2024.mp4"` → `"Film.Bagus.2024"`). `search_text` = lowercase, `[_\.\-]+` → spasi.

### 8.2 Pencocokan subtitle
Dalam folder yang sama, subtitle `S` cocok ke video `V` bila `basename(S)` (tanpa ekstensi) sama dengan judul `V`, atau berbentuk `<judul>.<lang>` / `<judul>.<lang>.<apa saja>`. `lang` valid bila cocok `^[a-z]{2,3}(-[A-Za-z]{2,4})?$`; label dari `Intl.DisplayNames(['id'], {type:'language'})` (mis. `id` → "Indonesia", `en` → "Inggris"); tanpa lang → label "Subtitle". Default track: `id` bila ada, lalu yang pertama.

### 8.3 Full sync
1. Kunci global `SELECT GET_LOCK('dv_sync', 0)`; bila gagal → lewati.
2. BFS dari root (`include_subfolders`), kumpulkan folder & file. **Jika ada error API di tengah → batalkan tanpa menandai apa pun sebagai missing.**
3. Upsert `categories` (slug unik dari nama, `path` gabungan nama induk), tandai yang tidak terlihat `missing_at`.
4. Upsert `videos` per file video:
   - Baru → `public_id` = `appProperties.dvVid` bila ada & belum terpakai, kalau tidak acak; `owner_user_id`/`visibility` dari `appProperties.dvOwner/dvVis` bila user ada, kalau tidak `NULL`/`public`; `source` = `upload` bila `dvOwner` ada; `published_at` = `createdTime`; status `pending`; enqueue `probe`.
   - Ada → update `title`, `file_name`, `category_id`, `drive_parent_id`, `drive_modified_at`; bila `md5` berubah → hapus rendition lama (job `delete_assets` mode renditions), reset metadata, enqueue `probe`; bila sebelumnya `missing` → pulihkan `status = prev_status` (atau `pending` + probe).
5. Video di DB (`source` apa pun, `deleted_at IS NULL`) yang tidak terlihat → `prev_status=status, status='missing', deleted_at=NOW()`.
6. Upsert `subtitles`; hapus yang tidak terlihat.
7. Simpan `last_full_sync_at`, reset `changes_page_token` ke token yang diambil **sebelum** langkah 2.

### 8.4 Incremental sync (Changes API, tiap `sync_interval_sec`)
- `changes.list(pageToken, fields="nextPageToken,newStartPageToken,changes(fileId,removed,file(<FILE_FIELDS>))", includeRemoved=true, pageSize=1000)`.
- Himpunan folder dikenal = root + semua `categories.drive_folder_id` (aktif).
- Per perubahan:
  - `removed` / `trashed` / parent bukan folder dikenal → bila file video/subtitle dikenal → tandai missing/hapus subtitle.
  - File video dengan parent dikenal → upsert seperti 8.3 langkah 4.
  - Subtitle dengan parent dikenal → upsert & cocokkan.
  - **Perubahan folder apa pun** (dibuat, rename, pindah, trash) di dalam pohon → jadwalkan full sync (debounce 30 dtk).
- Simpan `newStartPageToken`. Token invalid (410) → full sync.

### 8.5 Penjadwal (`setInterval` dengan guard "sedang berjalan")
| Tugas | Interval |
|---|---|
| Incremental sync | `drive.sync_interval_sec` (60 dtk) |
| Full sync | `drive.full_sync_interval_min` (360 mnt) + saat boot bila terakhir > interval |
| Bersih sesi kedaluwarsa, oauth_states, uploads expired | 1 jam |
| Flush view counter | 10 dtk |
| Bersih `storage/tmp` > 24 jam | 6 jam |

Endpoint admin: `POST /api/admin/sync/run {mode}` dan `GET /api/admin/sync/status` (sedang berjalan?, terakhir, error, jumlah video per status).

---

## 9. Streaming (`modules/stream`)

### 9.1 URL bertanda tangan
```
/stream/<publicId>/<q>.mp4?e=<expUnix>&s=<sig>
q   = "orig" | "1080" | "720" | "480" | "360" | "compat"
sig = base64url(HMAC_SHA256(streamKey, `${publicId}.${q}.${e}.${vk}`)).slice(0, 32)
vk  = "-" untuk video publik; "u<userId>" untuk video privat
e   = now + 6 jam
```
`GET /api/videos/:id` dan `GET /api/videos/:id/sources` mengembalikan URL ini. Untuk video privat, request stream juga harus membawa sesi user yang sama/admin.

### 9.2 Handler `GET|HEAD /stream/:publicId/:q.mp4`
1. Validasi signature (timing-safe) & kedaluwarsa → 403 `{code:'STREAM_EXPIRED'}`.
2. Ambil video (cache LRU 60 dtk), cek akses (§13). Tentukan `drive_file_id`: `orig` → file asli (hanya bila `original_playable`), lainnya → rendition `ready`.
3. Teruskan header `Range` (validasi format `bytes=a-b`, satu range saja; multi-range → abaikan & pakai range pertama) dan `If-Range` ke Drive via `mediaRequest` dengan `AbortController` yang di-abort saat klien putus (`request.raw.on('close')`).
4. Respons: status upstream (200/206/416), header `Content-Type` (dari DB; `.mkv/.webm` sesuai mime, `.mov` → `video/mp4` bila codec h264), `Content-Length`, `Content-Range`, `Accept-Ranges: bytes`, `ETag`/`Last-Modified` upstream, `Cache-Control: private, max-age=3600`, `X-Content-Type-Options: nosniff`. Pipe stream dengan backpressure (`stream.pipeline`).
5. Error upstream: 401 → refresh + retry sekali; 403 rate-limit / 5xx → retry 2x dengan backoff; 404 → tandai video `missing` (async) dan balas 404.
6. Tidak memakai rate-limit global; batas 8 stream paralel per IP (balas 429 bila lebih).

### 9.3 Proxy internal untuk ffmpeg — `GET /internal/drive/:fileId`
Hanya bila: remote address `127.0.0.1`/`::1`, **tanpa** header `X-Forwarded-For` (bukan lewat nginx), dan header `X-Internal-Token` = `INTERNAL_TOKEN`. Perilaku sama seperti 9.2 (Range pass-through) tanpa signature. Dipakai ffprobe/ffmpeg agar token Google tidak perlu diberikan ke ffmpeg dan refresh token tetap ditangani Node.

### 9.4 Subtitle — `GET /api/subtitles/:id.vtt`
Cek akses video; ambil dari cache `storage/cache/subs/<id>-<driveModifiedEpoch>.vtt`, atau unduh dari Drive → deteksi encoding (UTF-8/UTF-16 BOM; fallback windows-1252) → SRT→VTT (ganti `,` ms → `.`, tambahkan `WEBVTT`, hapus tag `{\an8}` dsb.) → simpan cache. `Content-Type: text/vtt; charset=utf-8`, `Cache-Control: private, max-age=3600`.

---

## 10. Pemrosesan Media (`modules/processing`)

### 10.1 Antrean
- Pengambilan job: transaksi `SELECT … FROM jobs WHERE status='queued' AND lane=? AND run_after<=NOW() ORDER BY priority, id LIMIT 1 FOR UPDATE SKIP LOCKED` → set `running`, `locked_at`, `attempts+1`.
- Lane `light` (probe, thumbnail, delete_assets) konkurensi 2; lane `heavy` (media) konkurensi 1. Worker bangun via event emitter saat enqueue + polling 3 dtk.
- Gagal → `run_after = NOW() + 2^attempts menit`; melewati `max_attempts` → `failed`, video `status='failed'` (kecuali original tetap playable → tetap `ready`, hanya catat error).
- Saat boot: `UPDATE jobs SET status='queued', locked_at=NULL WHERE status='running'`.
- Shutdown: kirim SIGTERM ke child ffmpeg, kembalikan job ke `queued`.
- Satu video tidak boleh punya dua job `media` aktif (cek sebelum enqueue).
- Progres ffmpeg dari `-progress pipe:1` (`out_time_ms` / durasi) → kolom `progress` (update maks tiap 2 dtk).

### 10.2 Job `probe` (light, prioritas 1)
```bash
ffprobe -v error -print_format json -show_format -show_streams \
  -headers $'X-Internal-Token: <token>\r\n' "http://127.0.0.1:3210/internal/drive/<fileId>"
```
Simpan durasi, width/height (perhitungkan rotasi 90/270 → tukar), codec, container, bitrate. **original_playable** = container ∈ {mp4, mov/m4v (brand isom/mp42/qt dengan h264), webm} **dan** video codec ∈ {h264, vp8, vp9, av1} **dan** audio ∈ {aac, mp3, opus, vorbis, tanpa audio} **dan** `pix_fmt` 8-bit (yuv420p/yuvj420p). Lalu enqueue `thumbnail` (prioritas 2) dan `media` (prioritas 5) bila: ada rendition yang perlu dibuat **atau** perlu compat **atau** storyboard aktif. Bila tidak playable → `status='processing'`.

### 10.3 Job `thumbnail` (light, prioritas 2)
- Kandidat waktu: 10%, 25%, 50% durasi (dibatasi 1 dtk … durasi−1). Untuk tiap kandidat:
  `ffmpeg -v error -ss <t> -headers … -i <internal url> -frames:v 1 -an -sn -f image2pipe -c:v mjpeg -q:v 2 pipe:1`
- Pilih frame dengan `sharp().stats().entropy` tertinggi (hindari frame hitam/polos).
- Simpan (sharp, `fit: cover`, 16:9): `storage/public/thumbs/<publicId>-<thumbKey>-480.webp` (q 78), `-1280.webp` (q 80), `-og.jpg` (1280×720, q 82). `thumbKey` = 12 karakter acak (baru setiap regenerasi; hapus file lama).
- Bila `original_playable` → `status='ready'`.

### 10.4 Job `media` (heavy, prioritas 5)
1. Cek disk: `free ≥ size_bytes × 2.5 + min_free_disk_gb` → jika tidak, tunda 30 menit (`run_after`).
2. Unduh asli → `storage/tmp/<publicId>.src` (stream via drive client, progress 0–30%).
3. Target rendition: `t ∈ processing.renditions` dengan `t < sisi_pendek_sumber`; tambah `compat` (tinggi = min(sisi pendek, `compat_max_height`)) bila `!original_playable`. Label = sisi pendek (video portrait 1080×1920 → "1080p").
4. **Satu proses ffmpeg, multi-output** (sekali decode):
```bash
nice -n 15 ffmpeg -hide_banner -y -i src \
  -filter_complex "[0:v]split=2[a][b];[a]scale=-2:720:flags=bicubic[v720];[b]scale=-2:360:flags=bicubic[v360]" \
  -map "[v720]" -map 0:a:0? -c:v libx264 -preset veryfast -crf 23 -maxrate 3000k -bufsize 6000k \
     -profile:v high -pix_fmt yuv420p -force_key_frames "expr:gte(t,n_forced*2)" \
     -c:a aac -b:a 128k -ac 2 -movflags +faststart -threads 3 out_720.mp4 \
  -map "[v360]" -map 0:a:0? -c:v libx264 -preset veryfast -crf 26 -maxrate 900k -bufsize 1800k \
     -profile:v main -pix_fmt yuv420p -force_key_frames "expr:gte(t,n_forced*2)" \
     -c:a aac -b:a 96k -ac 2 -movflags +faststart -threads 3 out_360.mp4 \
  -progress pipe:1 -nostats
```
   (Portrait: `scale=720:-2`. Tabel parameter: 1080 → crf 22, maxrate 5000k, aac 160k; 720 → 23/3000k/128k; 480 → 24/1500k/112k; 360 → 26/900k/96k.)
5. Storyboard (bila aktif) dari file lokal, cepat dengan keyframe saja:
```bash
nice -n 15 ffmpeg -v error -skip_frame nokey -i src -an -sn \
  -vf "fps=1/<I>,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=10x10" \
  -q:v 5 -vsync vfr storage/public/sb/<publicId>-<sbKey>/%d.jpg
```
   `I = max(2, ceil(durasi_dtk / 300))` (≤300 frame, ≤3 sheet). Simpan ke `videos.storyboard`:
   `{"v":1,"interval":I,"w":160,"h":90,"cols":10,"rows":10,"count":N,"sheets":["/media/sb/<id>-<key>/1.jpg", …]}`
   (Bila `-skip_frame nokey` menghasilkan frame terlalu sedikit untuk video dengan GOP panjang, ulangi tanpa `-skip_frame`.)
6. Upload tiap rendition ke folder `renditions` (nama `<publicId>_<h>p.mp4`, appProperties §7.5), insert `video_renditions` (`bitrate_kbps = size*8/durasi`).
7. Hapus file tmp (selalu, di `finally`). Bila compat dibuat → `status='ready'`.

### 10.5 Job `delete_assets` (light)
Mode `all` (video dihapus): trash rendition di Drive, hapus thumbnail & storyboard lokal, hapus cache subtitle. Mode `renditions` (sumber berubah): hanya rendition + storyboard.

---

## 11. Upload (`modules/uploads`)

Relay terpotong melalui server (andal di semua browser, tidak bergantung CORS Google).

1. **Init** `POST /api/uploads` `{fileName, size, mimeType, visibility, categoryId?}` (user aktif, `upload.enabled`):
   validasi ekstensi, `size ≤ max_file_gb`, kuota (`storage_used + size ≤ quota`), maks 3 upload aktif per user → alokasikan `video_public_id` → `createResumableSession` (metadata: `name`, `parents=[folder kategori atau root]`, `appProperties` §7.5; header `X-Upload-Content-Type`, `X-Upload-Content-Length`) → simpan URL sesi terenkripsi → `{uploadId, chunkSize, received: 0}`.
2. **Chunk** `PUT /api/uploads/:uploadId` — header `Content-Range: bytes <start>-<end>/<total>`, `Content-Type: application/octet-stream`, body mentah ≤ chunkSize (`bodyLimit` route = chunkSize + 1 MB; content-type parser octet-stream → stream mentah, **tidak di-buffer**):
   - `start != received_bytes` → 409 `{received}`.
   - Stream body ke `PUT <sessionUrl>` dengan `Content-Length` & `Content-Range` sama.
   - Drive 308 → baca header `Range: bytes=0-N` → `received = N+1` → `{received, done:false}`.
   - Drive 200/201 → finalize → `{received: total, done: true, video}`.
   - Drive 404/410 → `expired`; 5xx → 502 (klien retry).
3. **Status** `GET /api/uploads/:uploadId` → query Drive (`PUT` kosong dengan `Content-Range: bytes */<total>`) → `{received, status, video?}` (menangani kasus respons chunk terakhir hilang).
4. **Batal** `DELETE /api/uploads/:uploadId` → `DELETE <sessionUrl>` (best effort) → `cancelled`.
5. **Finalize**: insert `videos` (`source='upload'`, owner, visibility, kategori, `status='pending'`, `published_at=NOW()`), `storage_used_bytes += size`, enqueue `probe`, audit `video.upload`.
6. **Subtitle untuk video** `POST /api/videos/:id/subtitles` (multipart, ≤ 2 MB, `.srt/.vtt`, field `lang`) → upload ke folder video dengan nama `<judul>.<lang>.<ext>` → insert `subtitles`.

**Klien (UploadManager, zustand):** antrean multi-file, 2 file paralel, chunk berurutan per file via `XMLHttpRequest` (untuk progres upload), retry backoff 1-2-4-8-16-30 dtk hingga 10x lalu status "Dijeda — Coba lagi"; dengar event `online` untuk melanjutkan; sebelum retry panggil Status untuk sinkron offset; `beforeunload` peringatan bila ada upload aktif; bila halaman di-refresh, upload yang belum selesai ditampilkan dengan tombol "Pilih file lagi untuk melanjutkan" (cocokkan nama+ukuran+lastModified yang disimpan di localStorage).

---

## 12. Autentikasi, Sesi, Tamu & Keamanan

| Cookie | Isi | Atribut |
|---|---|---|
| `dv_sid` | token sesi 32 byte base64url (DB: sha256) | HttpOnly, Secure, SameSite=Lax, Path=/; Max-Age 30 hari bila "Ingat saya", kalau tidak cookie sesi (server: kedaluwarsa 24 jam sliding) |
| `dv_csrf` | 16 byte acak | **bukan** HttpOnly, Secure, SameSite=Lax; diterbitkan di `GET /api/auth/me` |
| `dv_gid` | id tamu 32 byte base64url (DB: sha256) | HttpOnly, Secure, SameSite=Lax, Max-Age 400 hari; dibuat saat tamu pertama kali membuat playlist |

- **Login** `POST /api/auth/login {username, password, remember}` → argon2id verify (hash dummy saat user tidak ada untuk timing seragam) → pesan generik "Username atau password salah" → rate limit 10 / 15 menit per IP **dan** per username → audit.
- Sesi sliding: perpanjang `expires_at` maks sekali per jam saat aktif. User `disabled` → semua sesi dihapus.
- **CSRF**: semua method non-GET/HEAD wajib header `X-CSRF-Token` = cookie `dv_csrf` (bandingkan timing-safe) **dan** bila ada header `Origin` harus = `APP_URL`. Kecuali: callback OAuth (GET).
- **Password**: min 8 karakter; argon2id (`memoryCost 19456, timeCost 2, parallelism 1`).
- **Helmet/CSP**: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com`. HSTS diatur aaPanel. `Referrer-Policy: strict-origin-when-cross-origin`.
- **Rate limit**: `/api/*` 600/menit/IP; login seperti di atas; `POST /api/uploads` 30/jam/user; pembuatan playlist 30/jam per user/tamu; `/api/search*` 120/menit/IP.
- Batas tamu: 50 playlist, 500 item per playlist (berlaku juga untuk user: 200 playlist, 5000 item).
- Validasi semua input dengan zod; batas panjang judul video 200 (rename), playlist 150.
- Log: redaksi header `cookie`, `authorization`, `x-csrf-token`, dan semua secret.
- Error API seragam: `{ "error": { "code": "NOT_FOUND", "message": "Video tidak ditemukan" } }`.

---

## 13. Aturan Akses (implementasi `plugins/access.ts`)

```ts
type Viewer = { userId: number | null; role: 'admin' | 'user' | 'guest'; guestHash: string | null };

canWatch(v, viewer) =
  v.deleted_at == null && v.status !== 'missing' &&
  (viewer.role === 'admin' ||
   (v.owner_user_id != null && v.owner_user_id === viewer.userId) ||
   (v.visibility === 'public' && v.status === 'ready'));

canEditVideo(v, viewer) = viewer.role === 'admin' || (v.owner_user_id != null && v.owner_user_id === viewer.userId);

// Fragmen SQL untuk SEMUA daftar publik (beranda, cari, rekomendasi, channel, playlist):
listableSql = "v.deleted_at IS NULL AND v.status='ready' AND (v.visibility='public' OR v.owner_user_id = :uid)"
// Tamu (uid null): fragmen tanpa klausa pemilik → "v.deleted_at IS NULL AND v.status='ready' AND v.visibility='public'"
// (setara secara makna, tetapi indeks (visibility,status,published_at) bisa dipakai — feed tamu 10k baris 17 ms → 0,5 ms).
// Admin pun memakai fragmen yang sama di halaman publik; admin melihat semuanya di /admin.

canViewPlaylist(p, viewer) =
  p.visibility === 'public' || viewer.role === 'admin' ||
  (p.owner_user_id != null && p.owner_user_id === viewer.userId) ||
  (p.guest_hash != null && p.guest_hash === viewer.guestHash);

canEditPlaylist(p, viewer) = (owner sama) || (guest_hash sama) || viewer.role === 'admin';
```
Video yang tidak boleh ditonton → `404 VIDEO_UNAVAILABLE` (jangan bocorkan judul). Saat video berubah publik → privat, key aset publik (thumbnail `-480/-1280.webp`, `-og.jpg`, folder storyboard) **dirotasi** (`processing/assets.ts`) sehingga URL `/media/...` yang pernah tersebar tidak berlaku lagi. Tamu tidak bisa membuat playlist publik (server memaksa `visibility='private'` bila `owner_user_id` null).

---

## 14. API

Base `/api`. JSON. Paginasi kursor: `?cursor=<opaque base64url>` → respons `{ items: [...], nextCursor: string|null }`. Ukuran halaman default 24 (beranda), 20 (lainnya).

### 14.1 Bentuk data
```ts
VideoSummary = {
  id: string; title: string; durationSec: number | null;
  thumb: { sd: string; hd: string } | null;             // /media/thumbs/...-480.webp, -1280.webp
  channel: { name: string; handle: string; avatarColor: string; avatarUrl: string | null };
  views: number; publishedAt: string;                    // ISO
  visibility: 'public' | 'private';
  status?: 'pending' | 'processing' | 'ready' | 'failed';  // hanya untuk pemilik/admin
  category?: { slug: string; name: string } | null;
  progressSec?: number;                                   // user login: posisi terakhir
}
VideoDetail = VideoSummary & {
  width: number; height: number;
  sources: { q: string; label: string; height: number; width: number; url: string; mime: string; bitrateKbps: number | null; isOriginal: boolean }[];
  sourcesExpireAt: string;
  subtitles: { id: number; lang: string | null; label: string; url: string; isDefault: boolean }[];
  storyboard: Storyboard | null;
  canEdit: boolean;
  resumeSec: number | null;
}
PlaylistSummary = { id; title; visibility; itemCount; thumb; owner: {name, handle} | null; isGuest: boolean; updatedAt; firstVideoId: string | null }
```

### 14.2 Endpoint
| Method & Path | Akses | Keterangan |
|---|---|---|
| GET `/api/health` | publik | `{ok, db, drive, version, uptime}` |
| GET `/api/site` | publik | nama, logo (+gelap, mode), favicon, channel utama, tema default, flag fitur, `player {autoplayDefault, seekSeconds, endscreenCountdown}` (juga disisipkan ke `index.html`) |
| GET `/api/auth/me` | publik | `{user|null, guest:boolean}` + set `dv_csrf` |
| POST `/api/auth/login` · `/api/auth/logout` | publik / login | |
| POST `/api/auth/password` | login | `{current, next}` |
| PATCH `/api/me` | login | `{displayName?, avatarColor?}` |
| PUT `/api/me/avatar` · DELETE `/api/me/avatar` | login | foto profil: body mentah `image/*` raster (png/jpg/webp/gif/avif; **SVG ditolak**) ≤ 5 MB → WebP 256×256 (crop otomatis `attention`), file lama dihapus; balasan `{user}` dengan `avatarUrl` |
| GET `/api/categories` | publik | kategori yang punya ≥1 video listable |
| GET `/api/feed` | publik | `?category=&sort=latest|popular&cursor=` |
| GET `/api/search` | publik | `?q=&cursor=` → `{videos, playlists(halaman 1 saja)}` |
| GET `/api/search/suggest` | publik | `?q=` → maks 8 judul |
| GET `/api/videos/:id` | sesuai §13 | `VideoDetail` |
| GET `/api/videos/:id/sources` | sesuai §13 | sources baru (refresh signature) |
| GET `/api/videos/:id/related` | sesuai §13 | `?cursor=&seed=&filter=all|channel|related` maks 60 total; halaman pertama `all` menyertakan `chips {channel, related}` (chip kolom kanan) |
| POST `/api/videos/:id/view` | publik | hitung tayangan (dedupe) |
| PATCH `/api/videos/:id` | pemilik/admin | `{title?, visibility?, categoryId?}` — title (1–100 karakter) → rename file Drive (ekstensi dipertahankan) **dan file subtitle `<judul>.*`** agar pencocokan subtitle tetap jalan; visibility → `appProperties.dvVis`; categoryId → pindah ke folder kategori (null = folder root) |
| DELETE `/api/videos/:id` | pemilik/admin | trash file Drive + soft delete + `delete_assets` |
| POST `/api/videos/:id/subtitles` | pemilik/admin | multipart |
| DELETE `/api/subtitles/:id` | pemilik/admin | trash file Drive |
| GET `/api/subtitles/:id.vtt` | sesuai §13 | WebVTT |
| GET `/api/channels/:handle` | publik | channel + `?tab=videos|playlists&cursor=` |
| GET `/api/me/videos` | login | `?q=&visibility=&status=&cursor=` (Video Anda; semua status) |
| POST `/api/uploads` · PUT/GET/DELETE `/api/uploads/:id` · GET `/api/uploads` | login | §11; `GET /api/uploads` = upload saya yang belum selesai (lanjut setelah reload) |
| GET `/api/categories/all` | login | semua kategori (termasuk kosong) dengan `id` untuk pilihan upload/ubah kategori |
| GET `/api/playlists/mine` | user/tamu | `{items, guestCount, guestAllowed}` — `guestCount` = playlist tamu di perangkat ini (tawaran impor setelah login) |
| GET `/api/playlists/public` | publik | `?cursor=` |
| POST `/api/playlists` | user/tamu | `{title, visibility?, videoId?}` |
| GET `/api/playlists/:id` | §13 | detail + items (`hiddenCount`) |
| PATCH / DELETE `/api/playlists/:id` | pemilik | |
| POST `/api/playlists/:id/items` | pemilik | `{videoId}` (tambah di akhir) |
| DELETE `/api/playlists/:id/items/:videoId` | pemilik | |
| PUT `/api/playlists/:id/order` | pemilik | `{videoIds: string[]}` |
| GET `/api/playlists/contains/:videoId` | user/tamu | id playlist milik saya yang berisi video (dialog Simpan) |
| POST `/api/playlists/import-guest` | login | pindahkan playlist `dv_gid` ke akun |
| GET `/api/history` · DELETE `/api/history` · DELETE `/api/history/:videoId` | login | |
| POST `/api/progress` | publik (tamu → 204 tanpa simpan) | `{videoId, positionSec, durationSec}` (fetch keepalive); posisi disimpan apa adanya, aturan resume di klien |
| GET `/api/progress?ids=a,b,c` | login | untuk bar merah thumbnail |
| GET `/api/admin/stats` · `/api/admin/system` | admin | dasbor; system: disk, versi ffmpeg/node, memori, ukuran antrean |
| GET/POST `/api/admin/users` · PATCH/DELETE `/api/admin/users/:id` · POST `/api/admin/users/:id/reset-password` | admin | DELETE body `{videos:'delete'|'transfer'}` |
| GET `/api/admin/videos` · POST `/api/admin/videos/:id/reprocess` · POST `/api/admin/videos/bulk` | admin | list: `?q&status(ready|processing|failed|missing)&visibility&owner(main|id)&category&sort(latest|oldest|views|size)&cursor`; bulk `{ids ≤ 200, action: public|private|reprocess|delete}` → `{done, failed[]}`. Ubah/hapus satu video memakai `PATCH/DELETE /api/videos/:id` (admin = pemilik) |
| GET `/api/admin/playlists` | admin | `?q&visibility&kind(user|guest)&cursor`; ubah/hapus memakai `PATCH/DELETE /api/playlists/:id` |
| GET `/api/admin/settings` · PUT `/api/admin/settings/:group` | admin | group: site, drive, processing, upload, player, security |
| PUT `/api/admin/branding/:slot` · DELETE | admin | slot `logo` (`?mode=icon\|full`), `logo_dark`, `favicon`; body mentah `image/*` (png/jpg/webp/gif/svg/avif ≤ 5 MB). **Semua gambar — termasuk SVG — di-render ulang ke PNG oleh sharp** (bukan sanitasi teks), sehingga skrip/markup SVG tidak pernah disajikan; balasan `{site}` |
| DELETE `/api/admin/users/:id/avatar` | admin | hapus foto profil user (moderasi) |
| GET `/api/admin/drive/status` | admin | terhubung?, email, folder, mode, error terakhir |
| POST `/api/admin/drive/oauth/start` · GET `/api/admin/drive/oauth/callback` · POST `/api/admin/drive/disconnect` | admin | §7.2 |
| POST `/api/admin/drive/service-account` | admin | upload/ tempel JSON |
| POST `/api/admin/drive/folder` · POST `/api/admin/drive/test` | admin | §7.3 |
| POST `/api/admin/sync/run` · GET `/api/admin/sync/status` | admin | |
| GET `/api/admin/jobs` · POST `/api/admin/jobs/:id/retry` · DELETE `/api/admin/jobs/:id` | admin | |
| GET `/api/admin/audit` | admin | |
| GET/HEAD `/stream/:id/:q.mp4` | signed | §9 |
| GET `/internal/drive/:fileId` | localhost + token | §9.3 |

### 14.3 SPA & meta
- Semua path non-`/api`, non-`/stream`, non-`/internal`, non-file → `index.html` (`Cache-Control: no-cache`).
- `/watch?v=<id>` dan `/playlist?list=<id>` untuk konten publik → sisipkan `<title>`, `og:title`, `og:image` (absolut, `-og.jpg`), `og:url`, `og:type=video.other`, `twitter:card=summary_large_image` ke placeholder `<!--DV_META-->` di `index.html`.

---

## 15. Frontend & Design System (replika YouTube)

### 15.1 Prinsip
- Replikasi **perilaku & ukuran** YouTube desktop/mobile 2025-2026 secara presisi. Saat implementasi, buka youtube.com sebagai referensi visual dan cocokkan ukuran dengan DevTools; nilai di bawah adalah patokan.
- Tidak memakai aset/logo/nama YouTube. Logo default: SVG sendiri (lingkaran merah dengan segitiga putih) + wordmark = `site.name` (kata pertama Roboto 700, sisanya 400), dapat diganti di admin (§18 Situs). Server menyisipkan `<title>`, favicon, apple-touch-icon dan `<script type="application/json" id="dv-site">` (data `/api/site`) ke setiap `index.html` sehingga nama/logo benar sejak render pertama (JSON tidak dieksekusi → aman untuk CSP).
- Font: **Roboto** 400/500/700 self-host (`@fontsource/roboto`), fallback `Arial, sans-serif`. Basis `font-size: 10px` pada `html` (seperti YouTube) sehingga `1.4rem = 14px`.
- Ikon: **Material Symbols Outlined** (Apache-2.0) sebagai SVG inline 24×24 `fill=currentColor`; varian *filled* untuk item navigasi aktif (seperti YouTube).
- Semua teks UI di `web/src/i18n/id.ts`.

### 15.2 Token warna (`styles/tokens.css`)
| Token | Terang | Gelap |
|---|---|---|
| `--bg` | `#ffffff` | `#0f0f0f` |
| `--bg-raised` (menu, dialog) | `#ffffff` | `#282828` |
| `--bg-secondary` | `#f2f2f2` | `#272727` |
| `--text` | `#0f0f0f` | `#f1f1f1` |
| `--text-secondary` | `#606060` | `#aaaaaa` |
| `--text-disabled` | `#909090` | `#717171` |
| `--divider` | `rgba(0,0,0,.1)` | `rgba(255,255,255,.2)` |
| `--hover` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.1)` |
| `--active` | `rgba(0,0,0,.1)` | `rgba(255,255,255,.2)` |
| `--chip-bg` / hover | `rgba(0,0,0,.05)` / `rgba(0,0,0,.1)` | `rgba(255,255,255,.1)` / `rgba(255,255,255,.2)` |
| `--chip-active-bg` / text | `#0f0f0f` / `#ffffff` | `#f1f1f1` / `#0f0f0f` |
| `--search-border` | `#c6c6c6` | `#303030` |
| `--search-input-bg` | `#ffffff` | `#121212` |
| `--search-btn-bg` | `#f8f8f8` | `#222222` |
| `--search-focus` | `#1c62b9` | `#1c62b9` |
| `--cta` (link/tombol biru) | `#065fd4` | `#3ea6ff` |
| `--cta-hover-bg` | `#def1ff` | `#263850` |
| `--brand` | `#ff0000` | `#ff0000` |
| `--badge-bg` (durasi) | `rgba(0,0,0,.6)` | `rgba(0,0,0,.6)` |
| `--snackbar-bg` / text | `#0f0f0f` / `#ffffff` | `#f1f1f1` / `#0f0f0f` |
| `--skeleton` | `rgba(0,0,0,.1)` | `rgba(255,255,255,.1)` |
| `--tooltip-bg` | `rgba(97,97,97,.92)` | `rgba(97,97,97,.92)` |
| `--shadow-menu` | `0 4px 32px rgba(0,0,0,.1)` | `0 4px 32px rgba(0,0,0,.1)` |
Tema diterapkan via `<html data-theme="dark|light">`; mode "system" mengikuti `prefers-color-scheme`. Script kecil inline di `index.html` menerapkan tema sebelum render (cegah kedip).

### 15.3 Tipografi & ukuran kunci
| Elemen | Spesifikasi |
|---|---|
| Body | 14px/20px 400 |
| Judul kartu grid | 16px/22px 500, maks 2 baris (`-webkit-line-clamp: 2`) |
| Meta kartu | 14px/20px 400 `--text-secondary` |
| Judul halaman tonton | 20px/28px 700, maks 2 baris |
| Judul item compact (rekomendasi) | 14px/20px 500; meta 12px/18px |
| Chip | tinggi 32px, padding 0 12px, radius 8px, 14px/20px 500, gap 12px |
| Item guide | tinggi 40px, padding 0 12px, radius 10px, ikon 24px, jarak ikon-teks 24px, 14px/20px (aktif 500 + bg `--hover`) ; guide padding 12px; header seksi 16px/22px 700 |
| Masthead | tinggi 56px, padding 0 16px; logo area 90×20 (padding 18px 14px 18px 16px) |
| Kotak cari | tinggi 40px, maks lebar 640px (min 120px) ; input: border 1px `--search-border`, radius `40px 0 0 40px`, padding `0 4px 0 16px`, 16px; fokus: border `--search-focus` + ikon kaca pembesar muncul di kiri dalam input ; tombol: lebar 64px, radius `0 40px 40px 0`, bg `--search-btn-bg` |
| Avatar | masthead 32px, kartu 36px, baris channel di tonton 40px |
| Tombol pill | tinggi 36px, padding 0 16px, radius 18px, 14px/36px 500; tombol "Login": border 1px `--divider`, teks `--cta`, ikon akun 24px di kiri |
| Thumbnail | grid radius 12px; compact radius 8px (168×94); hasil pencarian 360px lebar, radius 12px |
| Badge durasi | margin 4px dari kanan-bawah, padding 1px 4px, radius 4px, 12px/18px 500, bg `--badge-bg`, putih |
| Bar progres tonton di thumbnail | tinggi 4px, merah `#ff0000` di atas track `rgba(255,255,255,.6)` |
| Grid beranda | gap kolom 16px, baris 40px; padding konten 24px 24px 0; kolom: `floor((lebarKonten + 16) / 336)` dibatasi 1–6 |
| Tooltip ikon | bg `--tooltip-bg`, radius 4px, padding 8px, 12px/18px, muncul 0.1 dtk di bawah ikon |
| Menu popup | bg `--bg-raised`, radius 12px, padding 8px 0, item tinggi 40px, padding 0 16px, ikon 24px + gap 16px |
| Dialog | radius 12px, bg `--bg-raised`, padding 24px, judul 16px/22px 400 |
| Snackbar | kiri-bawah 12px, radius 8px, padding 14px 16px, 14px |
| Skeleton | blok `--skeleton`, radius sama dengan elemen asli; animasi shimmer 1.5 dtk |
| Top progress | tinggi 2px, `--brand`, di atas masthead, animasi ala YouTube |

### 15.4 Breakpoint & tata letak
| Lebar viewport | Perilaku |
|---|---|
| ≥ 1313px | Guide 240px terbuka permanen (toggle hamburger → mini-guide 72px; preferensi diingat) |
| 792–1312px | Mini-guide 72px (ikon + label 10px); hamburger → drawer overlay 240px + scrim |
| 657–791px | Tanpa mini-guide; hamburger → drawer |
| ≤ 656px | **Mobile**: masthead 48px (logo kiri; ikon cari, upload, avatar kanan; cari → mode input penuh), **bottom nav** 48px (Beranda, Upload ⊕, Anda), grid 1 kolom full-bleed, thumbnail tanpa radius, padding info 12px |
| Halaman tonton (semua lebar) | Tidak ada guide permanen; hamburger → drawer |

Mini-guide/guide item: Beranda, Jelajahi Playlist, Anda (Histori, Playlist, Video Anda), Kategori (maks 7 + "Tampilkan lainnya"), Admin (khusus admin). Footer guide: teks kecil © tahun nama situs.

### 15.5 Halaman tonton (layout)
- ≥ 1017px: dua kolom, padding atas 24px, jarak 24px, kolom kanan **402px** (min 300px). Lebar pemutar: `min(lebar tersedia, 1280px, (100vh − 169px) × 16/9)`, min 640px. Seluruh blok di tengah.
- < 1017px: satu kolom; rekomendasi di bawah judul.
- ≤ 656px: pemutar **sticky** di bawah masthead, full-width 16:9; konten di bawahnya menggulir.
- **Mode bioskop** (`T`): pemutar full-width bg hitam, tinggi `min(56.25vw, 100vh − 169px)`; kolom kanan pindah ke bawah pemutar sejajar judul (seperti YouTube).
- Di bawah pemutar: judul (20px/28px 700) → baris: avatar 40px + nama channel (16px 500) + "x x ditonton · y yang lalu" (14px secondary) ; kanan: tombol pill **Bagikan** (ikon share), **Simpan** (ikon playlist_add), dan untuk pemilik/admin pill **Publik/Privat** (dropdown ubah visibilitas) + menu ⋯ (Ubah judul, Hapus). Tidak ada deskripsi/komentar.
- Kolom kanan: bila `list=` → **PlaylistPanel** (header: judul playlist, pemilik, "3/12", tombol Ulangi & Acak, daftar item compact dengan nomor & indikator ▶) di atas daftar rekomendasi; tanpa `list` → chip filter kecil ("Semua", "Dari <channel>", "Terkait") + daftar **CompactVideo** dengan infinite scroll.

### 15.6 Komponen utama
- **VideoCard** (grid): thumbnail (img `srcset` 480w/1280w, `loading=lazy`, `decoding=async`, placeholder `--skeleton`), badge durasi, bar progres; info: avatar → judul → channel → "views · waktu"; ikon ⋮ muncul saat hover (Simpan ke playlist, Bagikan). Hover thumbnail: radius → 0 dengan transisi (seperti YouTube) — opsional P2: preview storyboard.
- **ResultItem** (pencarian): thumbnail 360×202 kiri, kanan: judul 18px/26px 400, meta 12px, baris channel (avatar 24px).
- **ChipBar**: scroll horizontal dengan tombol panah kiri/kanan bergradien di desktop; sticky di bawah masthead.
- **SaveDialog**: judul "Simpan video ke…", daftar checkbox playlist (ikon gembok/globe), toggle langsung tersimpan (optimistic), bagian "+ Buat playlist baru" → input nama (maks 150, counter), select visibilitas (user saja), tombol "Buat".
- **ShareDialog**: URL (dengan opsi "Mulai pada mm:ss" checkbox), tombol Salin; tombol bagikan WhatsApp/Telegram/X/Facebook via URL share standar (tanpa SDK).
- **AccountMenu**: header (avatar, nama, @username), Video Anda, Panel Admin (admin), Tampilan: Tema perangkat/Gelap/Terang (submenu), Akun, Keluar. Tamu: menu ⋮ dengan Tampilan + tombol Login.
- **UploadDialog** (gaya YouTube Studio): modal 960×(80vh), area drop dengan lingkaran ikon upload 136px, teks "Tarik lalu lepas file video untuk diupload", tombol **PILIH FILE**; setelah pilih: daftar file dengan field visibilitas (radio Publik/Privat + penjelasan), kategori (select), lampiran subtitle (opsional), progres. **UploadManager**: kartu pojok kanan-bawah yang bisa dilipat, menampilkan semua upload aktif.
- **TopProgress**: dimulai saat navigasi/route loader, selesai saat data siap.
- Navigasi SPA: klik kartu → prefetch data `GET /api/videos/:id` saat hover (React Query `prefetchQuery`) agar halaman tonton instan.

### 15.7 Format teks (`lib/format.ts`)
- Tayangan: 0 → "Belum ditonton"; <1.000 → "123 x ditonton"; <10.000 → "1,2 rb x ditonton"; <1 jt → "12 rb x ditonton"; <10 jt → "1,2 jt x ditonton"; → "12 jt …"; ≥1 M → "1,2 M x ditonton".
- Waktu relatif: "baru saja", "N menit yang lalu", "N jam yang lalu", "N hari yang lalu", "N minggu yang lalu", "N bulan yang lalu", "N tahun yang lalu".
- Durasi: `m:ss` atau `h:mm:ss`.
- Jumlah video playlist: "12 video".

### 15.8 State & data
- React Query untuk data server (staleTime feed 60 dtk, detail 30 dtk); zustand untuk sesi, tema, UI (guide), upload, preferensi pemutar.
- `lib/api.ts`: fetch wrapper (credentials same-origin, header `X-CSRF-Token`, parse error seragam, retry 1x untuk GET jaringan).
- Tamu: histori & progres di `localStorage` (`dv.history` maks 200, `dv.progress` maks 500), riwayat pencarian `dv.searchHistory` maks 20. Semua akses `localStorage` dibungkus try/catch.
- Code-splitting: `pages/admin/*`, `UploadDialog`, `pages/MyVideos` di-lazy-load; modul pemutar diprefetch saat idle di beranda.

---

## 16. Pemutar Video (`web/src/player`)

### 16.1 Arsitektur
- Kelas `Player` (vanilla TS) memiliki satu elemen `<video playsinline preload="metadata">` dan seluruh DOM kontrol; **komponen React `PlayerView` hanya membuat instance sekali** dan memanggil `player.load(detail, ctx)` saat video berganti. Halaman tonton **tidak me-unmount** pemutar ketika `v` berganti → fullscreen tetap bertahan saat autoplay/next.
- Event emitter: `ended`, `next`, `prev`, `theater`, `qualitychange`, `progress` (posisi tiap 15 dtk), `error`, `viewqualified` (≥ min(30 dtk, 50% durasi) diputar).
- State: `idle → loading → playing ⇄ paused ⇄ buffering → ended | error`. Atribut `data-state`, `data-mobile`, `data-fullscreen`, `data-controls-visible`, `data-theater` pada root untuk CSS.
- Deteksi UI sentuh: `matchMedia('(hover: none) and (pointer: coarse)')` (bukan user-agent).

### 16.2 Struktur DOM
```
.dvp[tabindex=0]
  video.dvp-video
  canvas.dvp-freeze                 // frame beku saat ganti kualitas
  .dvp-captions                     // subtitle custom render
  .dvp-gesture                      // zona klik/tap (kiri 35% · tengah · kanan 35%)
  .dvp-bezel                        // animasi ikon tengah
  .dvp-seek-ripple.left / .right    // animasi double-tap "10 detik"
  .dvp-speedup                      // "2x ▸▸"
  .dvp-spinner
  .dvp-osd                          // indikator volume %/kecepatan
  .dvp-endscreen  .dvp-error
  .dvp-mobile-center                // (mobile) prev · play/pause · next
  .dvp-gradient-bottom
  .dvp-chrome
     .dvp-progress (track, buffered, hover-fill, played, scrubber, preview[storyboard + waktu])
     .dvp-controls  [kiri: prev? play next volume(mute+slider) waktu] [kanan: autoplay cc settings theater fullscreen]
  .dvp-menu                         // menu setelan bertingkat
  .dvp-ctxmenu                      // menu klik kanan
```

### 16.3 Tampilan (patokan YouTube)
- Gradien bawah: tinggi 98px, `linear-gradient(transparent, rgba(0,0,0,.6))`.
- Bar kontrol tinggi 48px (fullscreen 54px & ikon 1.25×), tombol 48×48 dengan ikon 36px (SVG putih, drop-shadow halus), padding samping 12px.
- Progress: tinggi 3px → 5px saat hover; track `rgba(255,255,255,.2)`, buffer `rgba(255,255,255,.4)`, hover-fill `rgba(255,255,255,.5)`, played `#ff0000` (opsional gradien `linear-gradient(90deg,#f03 80%,#ff2791)`); scrubber bulat 13px merah muncul saat hover/drag.
- Preview hover: kotak storyboard 160×90 (atau lebih besar saat fullscreen) border 2px putih radius 8px + waktu di bawahnya 13px 500; tanpa storyboard → hanya waktu.
- Waktu: 13px (fullscreen 15px) putih, format `0:07 / 3:45`.
- Volume: ikon + slider 52px yang melebar saat hover (transisi 0.2 dtk), knob putih 12px.
- Toggle autoplay: switch 36×14 dengan knob berisi ikon ▶/❚❚.
- Menu setelan: bg `rgba(28,28,28,.9)`, radius 12px, lebar ±250px, item tinggi 40px 13px 500, nilai di kanan + chevron; submenu bergeser (slide) dengan header "‹ Kualitas"; centang pada pilihan aktif. Badge **HD** merah kecil di ikon gear bila kualitas ≥ 720p.
- Bezel tengah: lingkaran 52px `rgba(0,0,0,.5)` dengan ikon 36px, animasi scale 1→2 & opacity 1→0 selama 500 ms.
- Spinner: lingkaran putih/merah 64px berputar, muncul setelah buffering > 300 ms.
- Kontrol auto-hide 3 dtk saat bermain (mouse diam / tidak ada sentuhan); kursor disembunyikan saat kontrol tersembunyi di fullscreen.

### 16.4 Interaksi mouse & sentuh
| Input | Desktop | Mobile/sentuh |
|---|---|---|
| Klik/tap tunggal | Putar/jeda (ditunda 200 ms untuk membedakan dari double-klik) + bezel | Tampil/sembunyikan kontrol |
| Double di kiri 35% | Mundur 10 dtk + ripple kiri "10 detik" | Sama; tap tambahan dalam 700 ms terus menambah (20, 30 …) |
| Double di kanan 35% | Maju 10 dtk + ripple kanan | Sama (akumulatif) |
| Double di tengah | Layar penuh toggle | Putar/jeda |
| Tahan ≥ 500 ms | Kecepatan 2x selama ditahan (indikator "2x ▸▸"), lepas → kecepatan semula; klik tidak memicu jeda | Sama |
| Scroll roda di atas volume | ±5% volume | – |
| Drag progress | Scrub dengan preview; `video.currentTime` diset saat lepas (preview frame saat drag via storyboard) | Sama (touch events, area sentuh 24px) |
| Tombol mobile tengah | – | Sebelumnya · Putar/Jeda (56px) · Berikutnya |
| Klik kanan | Menu custom: Ulangi, Salin URL video, Salin URL pada waktu saat ini, Statistik (P2) | – |

### 16.5 Keyboard (aktif di halaman tonton; diabaikan bila fokus di input/textarea/contenteditable atau dengan Ctrl/Alt/Meta)
`Spasi`/`K` putar-jeda · `J`/`L` −/+10 dtk · `←`/`→` −/+5 dtk · `↑`/`↓` volume ±5% · `M` bisu · `F` layar penuh · `T` mode bioskop · `C` subtitle on/off · `0`–`9` lompat ke 0–90% · `Home`/`End` · `Shift+N` berikutnya · `Shift+P` sebelumnya · `Shift+.`/`Shift+,` kecepatan ±0.25 · `.`/`,` maju/mundur 1 frame (1/30 dtk) saat dijeda · `Esc` keluar layar penuh/menu · `I` PiP (P1). Setiap aksi menampilkan OSD/bezel yang sesuai.

### 16.6 Sumber & kualitas
- Daftar kualitas dari `sources` (urut tinggi menurun). Label: `${h}p` + `" HD"` bila ≥ 1080, `1440p HD`, `2160p 4K`. Item "Otomatis" menampilkan pilihan aktual: "Otomatis (720p)".
- **Pilihan awal (Otomatis)**: tinggi target = `min(tinggiPemutarCSS × devicePixelRatio, 1080)`; pilih kualitas terkecil ≥ target (atau tertinggi bila tidak ada). Batasi oleh `navigator.connection`: `saveData` atau `2g` → 360p, `3g` → ≤ 480p.
- **ABR sederhana (Otomatis)** (`player/core/abr.ts`, diuji unit): hitung *buffer ahead*; event `waiting` dalam 3 dtk setelah seek/ganti sumber diabaikan, dekat akhir video (< 10 dtk) buffer kecil tidak dihitung. Turun satu tingkat bila terjadi ≥ 2 event `waiting` dalam 20 dtk atau buffer < 3 dtk selama > 5 dtk saat bermain. Naik satu tingkat (maks ke target) bila buffer > 30 dtk stabil selama 60 dtk, maks sekali per 2 menit. Estimasi throughput = (pertambahan detik buffer × bitrate sumber) / waktu.
- **Ganti kualitas** (manual/otomatis): gambar frame saat ini ke `canvas.dvp-freeze` (same-origin), simpan `currentTime`, `paused`, `playbackRate`; ganti `src`; setelah `loadedmetadata` → seek, lanjut main, sembunyikan canvas saat `seeked`/`playing`. Tidak boleh layar hitam.
- Preferensi manual disimpan (`prefs.quality`), dipakai untuk video berikutnya bila tersedia (jika tidak, kualitas terdekat di bawahnya).

### 16.7 Subtitle
- Dari `subtitles` (URL VTT). Muat `<track kind="subtitles">` dengan `mode="hidden"`, render cue sendiri di `.dvp-captions` (agar tampil konsisten di fullscreen custom & bisa diposisikan).
- Gaya YouTube: teks putih, bg `rgba(8,8,8,.75)`, padding `.1em .3em`, font Roboto 500, ukuran `clamp(14px, 3.4% tinggi pemutar, 36px)`, posisi bawah 10% (naik 50px saat kontrol tampil), pusat.
- Tombol **CC** (garis merah di bawah ikon saat aktif) + submenu "Subtitel/CC" (Nonaktif + daftar bahasa). Preferensi on/off & bahasa disimpan. Tombol CC disembunyikan bila tidak ada subtitle.

### 16.8 Fullscreen & orientasi
```ts
async function enterFullscreen() {
  const el = root;
  if (el.requestFullscreen || (el as any).webkitRequestFullscreen) {
    await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? (el as any).webkitRequestFullscreen());
    if (isTouch && screen.orientation?.lock) {
      const portraitVideo = video.videoHeight > video.videoWidth;
      screen.orientation.lock(portraitVideo ? 'portrait' : 'landscape').catch(() => {});
    }
  } else if ((video as any).webkitEnterFullscreen) {
    (video as any).webkitEnterFullscreen();   // iPhone: pemutar bawaan iOS (rotasi otomatis)
  }
}
// on fullscreenchange (keluar): screen.orientation?.unlock?.()
```
- Auto-fullscreen saat HP diputar ke landscape (event `screen.orientation` `change`) bila sedang memutar di halaman tonton dan video landscape — coba `requestFullscreen()`, abaikan bila ditolak browser. Kembali ke portrait saat fullscreen hasil rotasi → keluar fullscreen.
- Tombol fullscreen & `F` & double-klik tengah.

### 16.9 Fitur lain
- **Prev/Next**: Next = item playlist berikutnya (hormati acak/ulangi) atau rekomendasi pertama yang belum diputar di sesi ini. Prev = bila `currentTime > 3` → ke 0; kalau tidak item playlist sebelumnya atau video sebelumnya di riwayat sesi. Tombol Prev hanya tampil bila ada sebelumnya (seperti YouTube).
- **Autoplay & end screen**: di playlist → langsung ke item berikutnya. Di luar playlist & autoplay ON → overlay "Berikutnya" (thumbnail, judul, channel) dengan lingkaran hitung mundur `player.endscreen_countdown` dtk, tombol **BATAL** / **PUTAR SEKARANG**. Autoplay OFF → grid 4–8 rekomendasi + tombol Putar ulang.
- **Resume**: `resumeSec` (user) atau `localStorage` (tamu) dipakai bila > 30 dtk dan < durasi − 15 dtk; `t=` di URL (detik atau `1m30s`) diprioritaskan.
- **Media Session**: metadata (judul, channel, artwork thumbnail 480/1280) + handler `play/pause/previoustrack/nexttrack/seekbackward/seekforward/seekto`; `setPositionState` tiap detik.
- **Wake Lock** saat bermain (lepas saat jeda/selesai), dengan try/catch.
- **PiP** via tombol di menu setelan / `I` bila `document.pictureInPictureEnabled`.
- **Preferensi** (`localStorage dv.player`): `volume`, `muted`, `autoplay`, `quality`, `captions {on, lang}`. Kecepatan tidak disimpan (seperti YouTube).
- **Ketahanan**:
  - `error` media atau stall (`waiting` > 10 dtk tanpa kemajuan buffer) → ambil `GET /api/videos/:id/sources` (signature baru) → muat ulang di posisi sama; maks 3 percobaan dengan backoff 1-2-4 dtk; gagal → overlay error "Terjadi error. Coba lagi" + tombol.
  - `MEDIA_ERR_SRC_NOT_SUPPORTED` pada `orig` → pindah ke rendition tertinggi/compat; bila tidak ada → pesan "Video sedang diproses, coba lagi nanti".
  - Refresh signature proaktif 10 menit sebelum `sourcesExpireAt` (dipakai pada pemuatan ulang berikutnya).
- **Tayangan**: kirim `POST /api/videos/:id/view` sekali saat `viewqualified`.
- **Progres**: `POST /api/progress` tiap 15 dtk saat bermain + saat jeda + `pagehide` (fetch `keepalive`); tamu → `localStorage`.
- **Ukuran**: seluruh modul player ≤ 35 KB gzip; tanpa dependensi.

---

## 17. Feed, Pencarian, Rekomendasi, Tayangan, Histori

- **Feed** `for_you` (default sejak 2026-10-03, chip "Semua"): beranda personal — lihat [REKOMENDASI.md](REKOMENDASI.md) §4; `?seed=` dari klien, kursor = offset. `latest`: `ORDER BY published_at DESC, id DESC`; `popular`: `ORDER BY view_count DESC, id DESC`; kategori menyertakan sub-kategori (`category_id IN (descendants)`). Kursor = nilai urut terakhir + id.
- **Chip beranda**: "Semua" (`for_you`), "Terbaru" (`latest`), "Populer", lalu kategori (yang punya video; personal di dalam kategori itu).
- **Pencarian**: normalisasi query sama seperti `search_text`. Token ≥ 3 huruf → `MATCH(search_text) AGAINST('+tok1* +tok2*' IN BOOLEAN MODE)`; ada token < 3 huruf → tambahan `search_text LIKE '%tok%'`. Urut: relevansi, lalu `view_count`. Playlist publik dicocokkan dengan `title LIKE` (maks 3, hanya halaman pertama).
- **Saran**: `search_text LIKE 'q%' OR search_text LIKE '% q%'` urut `view_count`, maks 8; ditambah riwayat pencarian lokal yang cocok (ikon jam, bisa dihapus).
- **Rekomendasi** (`related`): sejak 2026-10-03 dihitung modul `server/src/modules/recommend` — kemiripan konten/seri (IDF) + co-watch + kebiasaan viewer + episode berikutnya, lihat [REKOMENDASI.md](REKOMENDASI.md) §5; `?seed=` per tayangan halaman. Item pertama = "berikutnya" untuk autoplay.
- **Tayangan**: dedupe key `sha256(viewerKey + videoId)` di LRU (TTL 6 jam, 100k entri); `viewerKey` = `u<id>` / `g<guestHash>` / `ip+ua`. Penambahan diakumulasi di memori dan di-flush tiap 10 dtk (`UPDATE videos SET view_count = view_count + ? WHERE id = ?`).
- **Histori** (user): upsert `watch_history` saat progres (+ `max_position_sec`, `plays` bila `start`); progres tamu → `guest_watch` per `dv_gid` (hanya sinyal rekomendasi); daftar `/feed/history` urut `watched_at DESC`, dikelompokkan "Hari ini", "Kemarin", "Minggu ini", tanggal. Tamu: dari `localStorage`.

---

## 18. Panel Admin (`/admin`, gaya YouTube Studio)

- Layout Studio: masthead (logo + "Studio"), sidebar kiri 255px (avatar besar + nama), item: Dasbor, Pengguna, Video, Playlist, Antrean, Pengaturan (sub: Google Drive, Situs, Pemrosesan, Upload, Pemutar, Keamanan), Log Aktivitas, "← Kembali ke situs". Token warna sama (Studio gelap: bg `#1f1f1f`, sidebar `#282828`).
- **Dasbor**: kartu metrik; status Drive (hijau/merah + tombol perbaiki); sinkron terakhir + tombol "Sinkronkan sekarang"; antrean (berjalan/menunggu/gagal + progres job berjalan); disk server (dari `statfs`); top 5 video; 5 upload terbaru.
- **Pengguna**: tabel (avatar, username, nama, role, status, jumlah video, terpakai/kuota, login terakhir) + dialog Tambah/Ubah (username, nama, password + tombol generate, role, kuota GB, status), Reset password, Hapus (pilihan video: hapus / alihkan ke channel utama). Tidak bisa menghapus/menonaktifkan diri sendiri atau admin terakhir.
- **Video**: tabel gaya Studio "Konten" (thumbnail 120×68 + judul, visibilitas, status + progres, pemilik, kategori, tanggal, tayangan, ukuran), filter & cari, aksi per baris & massal (visibilitas, proses ulang, hapus).
- **Playlist**: tabel + ubah visibilitas/hapus.
- **Antrean**: tabel jobs (tipe, video, status, percobaan, progres, error, waktu) + retry/hapus; auto-refresh 5 dtk.
- **Pengaturan → Google Drive**: §7.2–7.3, kartu status koneksi, form kredensial (secret ditampilkan sebagai "Tersimpan ••••" dengan tombol Ganti), Redirect URI read-only + salin, tombol Hubungkan/Putuskan, form folder + "Tes koneksi" (menampilkan nama folder, jumlah video & subfolder), opsi subfolder & interval, panduan langkah demi langkah (collapsible), mode Service Account (textarea/upload JSON + email SA yang harus ditambahkan ke Shared Drive).
- **Pengaturan → Situs**: nama aplikasi; logo/logo gelap/favicon (unggah, ganti, hapus → kembali ke bawaan) dengan pratinjau masthead terang & gelap; mode logo (ikon + nama / gambar saja); nama & handle channel utama; tema default; playlist tamu. Simpan → cache `['site']` diperbarui sehingga masthead & `<title>` langsung berubah.
- **Log Aktivitas**: tabel audit dengan filter aksi.

---

## 19. Performa & Caching

| Aset | Cache |
|---|---|
| `/assets/*` (hash Vite) | 1 tahun immutable (nginx) |
| `/media/*` (nama berisi key acak) | 30 hari immutable (nginx) |
| `index.html` | `no-cache` |
| API list/detail | `Cache-Control: private, no-store` (data per-viewer; hook `onSend` di `app.ts` untuk semua `/api/*` yang belum memasang Cache-Control) ; `/api/site` & `/api/categories`: `private, no-cache` + ETag lemah → 304 |
| `/stream/*` | `private, max-age=3600` |
- Gzip teks oleh nginx aaPanel (pastikan `application/json`, `text/css`, `application/javascript`, `image/svg+xml` termasuk). Video tidak di-gzip.
- Query DB memakai indeks §6; hindari `OFFSET` besar (kursor). Pool mysql2 `connectionLimit 15`.
- Gambar: `srcset` + `sizes`, `loading=lazy` kecuali 8 kartu pertama (`fetchpriority=high` untuk 4 pertama).
- Bundle: JS awal ≤ 170 KB gzip; cek dengan `vite build` + `rollup-plugin-visualizer` (dev only).
- Memori proses target < 400 MB idle; `max_memory_limit` aaPanel 2048 MB.

---

## 20. Logging, Monitoring, Backup, Operasional

- Log Fastify (pino JSON) ke stdout → `/www/server/nodejs/vhost/logs/video_dymas.log` (dilihat di aaPanel). Level `info`; request log tanpa query `s=`. Logrotate: `/etc/logrotate.d/video_dymas` (harian, simpan 14, `copytruncate`, compress) — sumber `scripts/ops/logrotate-video_dymas.conf`.
- `/api/health` untuk pemantauan; aaPanel "auto start on boot" aktif.
- Backup: cron aaPanel "Backup Database" untuk `dummy` harian 03:00, simpan 7 (via UI atau API `crontab`). Thumbnail/storyboard bisa dibuat ulang (tidak wajib di-backup). `.env` disalin ke `/root/backup/video_dymas.env` (mode 600) karena `APP_KEY` wajib untuk membaca secret.
- Git lokal (tanpa remote) di folder proyek untuk riwayat perubahan; `.gitignore`: `node_modules`, `dist`, `.env`, `storage/`, `*.log`.

---

## 21. Testing & Definition of Done

**Unit (vitest)**: parsing URL folder, nama → judul, pencocokan subtitle, SRT→VTT, signature stream (valid/kedaluwarsa/salah), parsing Range, canWatch/canViewPlaylist (tabel kasus), format angka & waktu id, skor rekomendasi, enkripsi secret.
**Smoke (`scripts/smoke.sh`)**: health, login admin, me, feed, detail video publik, stream Range `bytes=0-1023` → 206, akses video privat sebagai tamu → 404, CSRF tanpa header → 403, tamu → `/api/admin/*` 401. Env: `BASE` (default produksi), `SMOKE_USER`, `SMOKE_PASS` (bila kosong dicoba `ADMIN_INITIAL_PASSWORD` dari `.env`). Keluar ≠ 0 bila ada yang gagal.
**Keamanan black-box**: `scripts/dev/qa/security-test.mjs` (instance uji; 48 cek kebocoran video privat di semua daftar/OG/subtitle/stream, akses lintas user, CSRF/Origin, header, body > 1 MB, rate limit login).
**Manual/E2E**: matriks di PROMPT Step 17 (desktop Chrome/Firefox/Safari, Android Chrome, iOS Safari; gelap/terang; tamu/user/admin). Bagian otomatisnya: `scripts/dev/qa/matrix-test.mjs` (Chromium: desktop + emulasi iPad/Android/iPhone × 4 peran × 2 tema); Safari/Firefox asli & perangkat nyata tetap manual (SERVER-TODO ST-008).
**Definition of Done (per step)**: build tanpa error TypeScript, test lulus, aplikasi berjalan di aaPanel, fitur diverifikasi di `https://video.dymas.cloud`, CLAUDE.md diperbarui (konfigurasi + progres + changelog), commit git lokal.

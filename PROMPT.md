# PROMPT — Langkah Eksekusi Dymas Video

> Dokumen ini berisi prompt berurutan (Step 0 → Step 17) untuk dieksekusi dengan Claude Code di folder `/www/wwwroot/video.dymas.cloud`.
> Acuan: [PRD.md](PRD.md) (apa & kenapa), [SPEC.md](SPEC.md) (bagaimana), [CLAUDE.md](CLAUDE.md) (konfigurasi aktual & progres).

---

## Cara Pakai

1. Jalankan Claude Code di `/www/wwwroot/video.dymas.cloud` (CLAUDE.md otomatis terbaca).
2. **Satu step = satu sesi.** Mulai sesi baru (atau `/clear`) sebelum setiap step, lalu tempel **Prompt Pembuka** + **prompt step** tersebut.
3. Jangan lompat step — setiap step bergantung pada step sebelumnya. Cek bagian *Progres* di CLAUDE.md untuk tahu posisi terakhir.
4. Beberapa step membutuhkan tindakan Anda (ditandai **🧑 Tindakan Anda**). Claude akan berhenti dan menunggu.
5. Bila sebuah step terputus, pakai **Prompt Lanjutan**. Bila ada bug setelah step selesai, pakai **Prompt Perbaikan**.

### Yang perlu Anda siapkan
- Akun Google pemilik folder video + akses ke [Google Cloud Console](https://console.cloud.google.com/) (untuk Step 5).
- Folder Google Drive berisi beberapa video uji, sebaiknya mencakup: MP4 biasa (H.264), satu file **MKV atau HEVC/H.265**, satu **video vertikal** dari HP, satu video dengan **subtitle** (`Judul.srt` atau `Judul.id.srt`), satu **subfolder** berisi video (untuk kategori), dan satu file besar (≥ 1 GB).
- HP Android (Chrome) dan iPhone (Safari) untuk uji pemutar di Step 11 & 17.

---

## Prompt Pembuka (tempel di awal SETIAP sesi)

```text
Kamu mengerjakan proyek "Dymas Video" di /www/wwwroot/video.dymas.cloud.
Sebelum bekerja: baca CLAUDE.md (status & konfigurasi terkini), lalu bagian PRD.md dan SPEC.md yang relevan dengan step yang saya minta. Gunakan Bahasa Indonesia saat melapor.

Aturan kerja:
- Ikuti SPEC.md. Bila harus menyimpang, jelaskan alasannya dan catat di CLAUDE.md bagian "Keputusan".
- Server dikelola aaPanel. Project Node, database, SSL, nginx, dan cron dibuat/diubah dengan cara aaPanel (API via scripts/bt-api.py atau instruksi UI untuk saya). Jangan memasang pm2/systemd/nginx site sendiri di luar aaPanel. Konfigurasi nginx tambahan HANYA di /www/server/panel/vhost/rewrite/node_video_dymas.conf.
- Node: /www/server/nodejs/v24.18.0/bin (tambahkan ke PATH di setiap perintah). Aplikasi berjalan hanya sebagai Node Project aaPanel "video_dymas" (port 3210).
- Jangan menulis secret (password root MySQL, token aaPanel, Client Secret/refresh token Google) ke file mana pun selain yang ditentukan SPEC.
- Setiap perubahan konfigurasi/setting → perbarui CLAUDE.md saat itu juga.
- Selesaikan step sampai semua kriteria selesai terpenuhi dan terverifikasi di https://video.dymas.cloud. Laporkan hasil uji apa adanya (termasuk yang gagal).
- Akhiri step dengan: build tanpa error, test lulus, deploy (scripts/deploy.sh), CLAUDE.md diperbarui (Progres + Changelog), git commit lokal.
```

---

## Step 0 — Persiapan Server

```text
Kerjakan STEP 0 — Persiapan server (SPEC §2, §3). Jangan membuat kode aplikasi di step ini.

1. Verifikasi ulang fakta server di SPEC §3.1: versi OS, Node v24.18.0 di /www/server/nodejs/v24.18.0/bin, nginx 1.24 aaPanel, MariaDB aaPanel, port 3210 masih bebas, DNS video.dymas.cloud mengarah ke IP server ini, sisa disk & RAM. Catat perbedaan ke CLAUDE.md.
2. Pasang ffmpeg: apt-get install -y ffmpeg. Pastikan encoder libx264 & aac tersedia dan user www bisa menjalankan ffmpeg/ffprobe.
3. Buat scripts/bt-api.py sesuai SPEC §3.3 (token dari /www/server/panel/config/api.json, request_token = md5(request_time + token), cookie jar, abaikan sertifikat self-signed panel, panel di https://127.0.0.1:<port dari /www/server/panel/data/port.pl>). Uji dengan endpoint read-only. Jika ditolak karena whitelist IP, BERHENTI dan minta saya menambahkan 127.0.0.1 di aaPanel → Settings → API interface.
4. Buat database lewat API aaPanel (AddDatabase): name=dummy, user=dummy, password=dummy, utf8mb4, akses lokal. Bila sudah ada, jangan buat ulang. Verifikasi login dengan -h localhost DAN -h 127.0.0.1 (SPEC §3.4); bila salah satu gagal, perbaiki grant memakai root (baca password root dari DB panel saat runtime, jangan disimpan).
5. git init lokal (tanpa remote) + .gitignore (SPEC §20). Commit dokumen awal.
6. Perbarui CLAUDE.md: hasil verifikasi, versi ffmpeg, cara pakai bt-api.py, status DB. Centang Step 0.

Kriteria selesai:
- `sudo -u www ffmpeg -version` dan `sudo -u www ffprobe -version` berjalan.
- `/www/server/mysql/bin/mysql -h localhost -udummy -pdummy dummy -e 'select 1'` dan versi -h 127.0.0.1 sukses.
- Database dummy terlihat di daftar Database aaPanel (cek lewat API).
- scripts/bt-api.py berfungsi.
```

---

## Step 1 — Kerangka Proyek, aaPanel Node Project, Nginx, SSL

```text
Kerjakan STEP 1 — Kerangka proyek & jalur deploy (SPEC §2, §3.2, §3.5–3.8, §4, §5.1, §14.3).

1. Buat monorepo npm workspaces sesuai struktur SPEC §4:
   - root package.json (scripts: build, dev, migrate, seed, test, deploy),
   - server/ : Fastify 5 + TypeScript strict, build tsc → server/dist (ESM),
   - web/ : Vite 7 + React 19 + TypeScript.
2. Server minimal: config.ts (process.loadEnvFile + validasi zod sesuai SPEC §5.1), logger pino (redaksi cookie/authorization), GET /api/health (ok, versi, uptime), static web/dist + SPA fallback index.html dengan placeholder <!--DV_META--> (SPEC §14.3), listen 127.0.0.1:3210, graceful shutdown SIGTERM/SIGINT.
3. Web minimal: halaman placeholder "Dymas Video".
4. Buat .env (APP_KEY 32 byte acak base64, INTERNAL_TOKEN acak), .env.example (tanpa nilai rahasia), folder storage/ (SPEC §4), scripts/deploy.sh (SPEC §3.8), scripts/nginx-custom.conf (isi SPEC §3.5).
5. npm install & build, chown -R www:www, chmod 600 .env.
6. Buat Node Project aaPanel lewat bt-api.py dengan parameter SPEC §3.2 (project_name video_dymas, script absolut server/dist/index.js, port 3210, run_user www, v24.18.0, domain video.dymas.cloud, auto start on boot, memory limit 2048). Jika API tidak bisa dipakai, berikan saya instruksi UI aaPanel yang persis lalu TUNGGU konfirmasi saya.
7. Pasang isi scripts/nginx-custom.conf ke /www/server/panel/vhost/rewrite/node_video_dymas.conf → nginx -t → reload. Jangan mengedit file vhost utama.
8. Terbitkan SSL Let's Encrypt untuk video.dymas.cloud lewat aaPanel + aktifkan Force HTTPS (SPEC §3.6). Bila gagal via API, beri saya instruksi UI.
9. Uji:
   - curl -fsS https://video.dymas.cloud/api/health → 200 JSON,
   - halaman utama tampil via HTTPS, http:// redirect ke https://,
   - https://video.dymas.cloud/internal/apa-saja → 404,
   - file /assets/* mendapat header Cache-Control immutable,
   - restart project via bt-api.py berhasil dan aplikasi kembali hidup.
10. Perbarui CLAUDE.md: struktur, perintah build/deploy/restart/log, nama project aaPanel, path vhost/rewrite/log/pid, port, status SSL. Centang Step 1, commit.
```

---

## Step 2 — Database, Migrasi, Settings, Kriptografi

```text
Kerjakan STEP 2 — Fondasi data (SPEC §5, §6).

1. server/src/db.ts: pool mysql2 (connectionLimit 15, SET time_zone='+00:00' per koneksi, dukung DB_SOCKET opsional), helper query & transaksi.
2. server/migrations/001_init.sql PERSIS seperti SPEC §6. migrate.ts menjalankan file .sql berurutan & mencatat ke schema_migrations (idempoten). seed.ts membuat admin dari ADMIN_USERNAME/ADMIN_INITIAL_PASSWORD hanya bila belum ada admin (argon2id, parameter SPEC §12).
3. lib/crypto.ts (HKDF kunci turunan SPEC §5.1, AES-256-GCM format v1), lib/ids.ts (public_id video 11 char, playlist 'PL'+22 char, token acak), lib/errors.ts (format error seragam SPEC §12).
4. modules/settings: default SPEC §5.2, cache in-memory + invalidasi, enkripsi secret, secret tidak pernah dikembalikan apa adanya (hanya {configured:true}).
5. /api/health menyertakan status db.
6. Unit test vitest: crypto roundtrip & tamper detection, ids, settings default & masking secret.
7. Jalankan migrate & seed; verifikasi tabel & user admin lewat mysql.
8. Deploy, cek health. Perbarui CLAUDE.md (perintah migrate/seed, daftar tabel). Centang Step 2, commit.
```

---

## Step 3 — Autentikasi, Sesi, CSRF, Tamu, Manajemen User

```text
Kerjakan STEP 3 — Auth & user (SPEC §12, §13, endpoint terkait di §14.2).

1. plugins/auth.ts: resolve Viewer dari cookie dv_sid (sliding expiry), dv_gid (tamu); terbitkan dv_csrf di GET /api/auth/me; validasi X-CSRF-Token + Origin untuk semua non-GET/HEAD.
2. Endpoint: GET /api/auth/me, POST /api/auth/login (argon2id, hash dummy untuk user tak dikenal, rate limit per IP & per username, pesan generik "Username atau password salah", audit), POST /api/auth/logout, POST /api/auth/password, PATCH /api/me.
3. Admin users API: list/create/update/delete, reset password, disable (hapus semua sesi user). Lindungi: tidak bisa hapus/nonaktifkan diri sendiri atau admin terakhir; username unik, pola ^[a-z0-9_.]{3,32}$, tidak boleh sama dengan site.channel_handle. Hapus user dengan opsi videos=delete|transfer (untuk sekarang hanya di DB; penghapusan file Drive disambungkan di Step 14).
4. plugins/access.ts: canWatch, canEditVideo, canViewPlaylist, canEditPlaylist, listableSql PERSIS SPEC §13 + unit test tabel kasus lengkap (tamu/user pemilik/user lain/admin × publik/privat × status).
5. Helper audit log + GET /api/admin/audit.
6. Helmet + CSP (SPEC §12), rate limit global.
7. Uji dengan curl (simpan cookie): login admin/<lihat ADMIN_INITIAL_PASSWORD di .env server>, me, buat user "tes1", login tes1, akses /api/admin/* sebagai tes1 → 403, POST tanpa X-CSRF-Token → 403, 11x login salah → 429.
8. Perbarui CLAUDE.md, centang Step 3, commit.
```

---

## Step 4 — Fondasi Frontend & Design System YouTube

```text
Kerjakan STEP 4 — Fondasi frontend (SPEC §15 seluruhnya; PRD §5.1).
Referensi visual: youtube.com versi desktop & mobile terbaru. Bila bisa, pasang Playwright (devDependency + chromium) untuk mengambil screenshot YouTube dan aplikasi kita pada ukuran yang sama lalu bandingkan. Jangan menyalin logo, nama, atau file aset/CSS YouTube.

1. styles/tokens.css (tema terang & gelap SPEC §15.2), base.css (html font-size 10px, Roboto self-host 400/500/700, reset, scrollbar ala YouTube), script anti-kedip tema di index.html, logo SVG "Dymas Video" (SPEC §15.1).
2. Ikon Material Symbols sebagai SVG inline (outlined + filled untuk item aktif).
3. Komponen ui/: Button (pill/teks/CTA), IconButton + Tooltip, Menu (popup + submenu), Dialog, Snackbar, Skeleton (shimmer), Switch, Select, Avatar (inisial + warna), Spinner, Tabs, Table.
4. Layout: Masthead (hamburger, logo, SearchBox dengan perilaku fokus/ikon/clear persis YouTube, tombol Upload untuk user, AccountMenu atau tombol "Login"), Guide 240px, MiniGuide 72px, GuideDrawer + scrim, MobileNav, TopProgress. Breakpoint & ukuran PERSIS SPEC §15.3–15.4; status guide diingat.
5. Router react-router 7 untuk semua rute PRD §5.3 (yang belum dibuat → placeholder skeleton), layout Watch (tanpa guide permanen), layout Admin (lazy, kerangka Studio).
6. lib/api.ts (CSRF header, error seragam), stores session/theme/ui, lib/format.ts (SPEC §15.7) + unit test, i18n/id.ts untuk semua teks.
7. Halaman Login (kartu tengah: logo, "Login", "untuk melanjutkan ke Dymas Video", username, password + tampilkan, Ingat saya, error; tanpa link daftar), AccountMenu (tema perangkat/gelap/terang juga untuk tamu, Keluar), halaman Akun (/account: nama, warna avatar, ganti password), halaman 404 gaya YouTube.
8. Screenshot aplikasi pada lebar 1920, 1280, 1000, 400 px × tema gelap & terang; bandingkan dengan YouTube; perbaiki selisih jarak/ukuran/warna sampai setara.
9. Deploy, perbarui CLAUDE.md, centang Step 4, commit.
```

---

## Step 5 — Integrasi Google Drive

```text
Kerjakan STEP 5 — Integrasi Google Drive (SPEC §7 seluruhnya, §18 bagian Pengaturan → Google Drive).

1. modules/drive/client.ts: token provider (OAuth refresh token & Service Account JWT), cache access token, retry/backoff & refresh saat 401, undici Agent keep-alive, semua fungsi SPEC §7.4 (termasuk mediaRequest, createResumableSession, uploadFileFromDisk).
2. OAuth: /api/admin/drive/oauth/start (state di oauth_states), /callback (validasi state + sesi admin, simpan refresh token terenkripsi + email), /disconnect (revoke best effort). Mode Service Account: simpan JSON terenkripsi, tampilkan email SA.
3. Folder: parser URL/ID (semua format SPEC §7.3) + unit test, validasi folder & canAddChildren, deteksi Shared Drive, buat folder sistem _dymasvideo_system/renditions (appProperties dvRole=system), simpan setting, ambil start page token.
4. Endpoint admin: drive/status, drive/test, drive/folder.
5. Halaman admin Pengaturan → Google Drive lengkap: kartu status, form kredensial (secret tampil "Tersimpan ••••" + Ganti), Redirect URI read-only + tombol salin, Hubungkan/Putuskan, form folder + Tes koneksi (nama folder, jumlah video & subfolder), opsi subfolder & interval, panduan langkah demi langkah SPEC §7.2 (collapsible), penjelasan kenapa API key biasa tidak cukup.
6. Setelah halaman siap: BERHENTI dan beri saya daftar langkah singkat yang harus saya lakukan di Google Cloud Console & di halaman admin. TUNGGU konfirmasi saya.
7. Setelah saya konfirmasi terhubung: verifikasi status terhubung, tes folder menampilkan nama & jumlah video yang benar, folder _dymasvideo_system terbentuk di Drive.
8. Perbarui CLAUDE.md (redirect URI, mode auth, email & folder terhubung — TANPA secret). Centang Step 5, commit.
```

**🧑 Tindakan Anda di Step 5:** buat project Google Cloud, aktifkan Drive API, atur OAuth consent screen ke **In production**, buat OAuth Client (Web) dengan redirect URI `https://video.dymas.cloud/api/admin/drive/oauth/callback`, isi Client ID/Secret di admin, klik **Hubungkan Google Drive**, lalu tempel URL folder.

---

## Step 6 — Sinkronisasi Folder

```text
Kerjakan STEP 6 — Sinkronisasi Drive (SPEC §8 seluruhnya).

1. Klasifikasi file, judul dari nama file, search_text, slug kategori unik, pencocokan subtitle (SPEC §8.1–8.2).
2. Full sync (BFS, GET_LOCK, upsert kategori/video/subtitle, pemulihan dari appProperties, aturan missing yang AMAN: error API di tengah = batalkan tanpa menandai missing).
3. Incremental sync via Changes API (SPEC §8.4), perubahan folder → full sync terjadwal (debounce 30 dtk), token invalid → full sync.
4. Penjadwal SPEC §8.5 dengan guard "sedang berjalan".
5. Enqueue job probe = insert ke tabel jobs saja (worker dibuat di Step 8).
6. Endpoint admin: POST /api/admin/sync/run, GET /api/admin/sync/status; tombol "Sinkronkan sekarang" + status di halaman admin Drive.
7. Unit test: judul dari nama file ("a.b.mp4" → "a.b"), search_text, subtitle (Judul.srt, Judul.id.srt, Judul.en.forced.vtt, nama tidak cocok), slug unik.
8. Uji nyata pada folder saya: jumlah video di DB = jumlah video di Drive (termasuk subfolder); kategori sesuai subfolder; subtitle terpasang. Minta saya menambah/rename/menghapus satu file di Drive lalu pastikan perubahan tercermin ≤ 2 menit.
9. Perbarui CLAUDE.md, centang Step 6, commit.
```

---

## Step 7 — Streaming

```text
Kerjakan STEP 7 — Streaming (SPEC §9 seluruhnya; bentuk data §14.1).

1. lib/sign.ts (signed URL SPEC §9.1), lib/range.ts (parsing Range), handler GET|HEAD /stream/:publicId/:q.mp4 (validasi signature, cek akses, Range/If-Range pass-through, abort upstream saat klien putus, retry 401/403-rate/5xx, header respons SPEC §9.2, batas 8 stream/IP).
2. /internal/drive/:fileId (hanya localhost, tanpa X-Forwarded-For, X-Internal-Token).
3. GET /api/subtitles/:id.vtt (cache, deteksi encoding, SRT→VTT).
4. GET /api/videos/:id dan /api/videos/:id/sources (VideoDetail SPEC §14.1). Sebelum Step 8, sumber 'orig' dianggap playable bila mime video/mp4 atau video/webm.
5. Unit test: sign/verify (valid, kedaluwarsa, salah, vk berbeda), parsing Range, srt2vtt (BOM UTF-8/UTF-16, tag {\an8}, koma milidetik).
6. Uji:
   - curl -r 0-1023 URL stream → 206 + Content-Range & Content-Length benar; HEAD → header tanpa body;
   - Range di tengah file besar → respons cepat (< 1 dtk TTFB);
   - tanpa/ salah signature → 403; kedaluwarsa → 403;
   - video privat sebagai tamu → 404;
   - klien memutus koneksi → request upstream ikut dibatalkan (buktikan dari log);
   - https://video.dymas.cloud/internal/... → 404;
   - URL stream dibuka di browser → video bisa diputar & di-seek.
7. Perbarui CLAUDE.md, centang Step 7, commit.
```

---

## Step 8 — Pemrosesan Media (ffmpeg)

```text
Kerjakan STEP 8 — Pemrosesan media (SPEC §10 seluruhnya).

1. Antrean jobs: dua lane (light ×2, heavy ×1), pengambilan FOR UPDATE SKIP LOCKED, backoff, max_attempts, recovery job 'running' saat boot, shutdown aman (SIGTERM ke ffmpeg, kembalikan ke queued), cegah dua job media aktif untuk video yang sama, progres dari -progress pipe:1.
2. Handler probe (ffprobe via /internal/drive, aturan original_playable), thumbnail (3 kandidat + entropy sharp, webp 480/1280 + og.jpg, thumbKey acak), media (cek disk, unduh tmp, ffmpeg multi-output sesuai tabel parameter, portrait, compat, storyboard dengan fallback tanpa -skip_frame, upload rendition ke Drive dengan appProperties, cleanup di finally), delete_assets.
3. Gunakan nice, threads, preset, renditions dari settings. Tampilkan sources lengkap (orig + rendition + compat, label kualitas SPEC §16.6) dan storyboard di VideoDetail.
4. Admin: halaman Antrean (SPEC §18, auto-refresh 5 dtk, retry/hapus) + Pengaturan → Pemrosesan.
5. Uji:
   - MP4 H.264 → ready cepat dengan thumbnail yang bukan frame hitam;
   - MKV/HEVC → processing → compat dibuat → ready dan bisa diputar di Chrome;
   - video vertikal → label kualitas benar (sisi pendek), tidak gepeng;
   - rendition 720/360 muncul di _dymasvideo_system/renditions;
   - restart aplikasi saat job media berjalan → job dilanjutkan, tidak ada file tmp yatim;
   - pantau CPU (top) saat transcode: situs lain di server tetap responsif.
6. Perbarui CLAUDE.md (versi ffmpeg, parameter encode, lokasi storage), centang Step 8, commit.
```

---

## Step 9 — Beranda, Pencarian, Kategori, Channel

```text
Kerjakan STEP 9 — Halaman publik (PRD §5.1, §5.3; SPEC §14, §15.6, §17).

Backend: /api/site, /api/categories, /api/feed (latest/popular/kategori + turunan, kursor), /api/search (FULLTEXT + LIKE untuk token pendek, playlist publik), /api/search/suggest, /api/channels/:handle (tab videos/playlists), /api/videos/:id/related (algoritma & cache SPEC §17), POST /api/videos/:id/view (dedupe + flush 10 dtk), injeksi OG meta (SPEC §14.3). Semua daftar memakai listableSql.

Frontend:
- Beranda: ChipBar sticky (panah gradien di desktop), VideoGrid (kolom SPEC §15.3), VideoCard lengkap (srcset, lazy, badge durasi, bar progres tonton, menu ⋮ — Simpan disambungkan di Step 13, Bagikan sudah jalan), skeleton, infinite scroll, prefetch detail saat hover.
- Hasil pencarian (ResultItem + playlist publik), saran pencarian + riwayat pencarian lokal (bisa dihapus), shortcut "/".
- Channel /@handle (header sederhana + tab Video & Playlist).
- Format angka & waktu Indonesia.

Uji: data nyata dari Drive tampil benar; video privat user tidak muncul untuk tamu di feed/cari/saran/related/channel; screenshot beranda & pencarian dibandingkan dengan YouTube di 1920/1280/1000/400 px (gelap & terang) dan selisih diperbaiki.
Perbarui CLAUDE.md, centang Step 9, commit.
```

---

## Step 10 — Pemutar Video (Inti)

```text
Kerjakan STEP 10 — Pemutar inti (baca SPEC §16 seluruhnya; PRD §5.4).
Bangun web/src/player sebagai modul vanilla TypeScript TANPA dependensi pemutar pihak ketiga + PlayerView.tsx:

1. Arsitektur SPEC §16.1–16.2: instance tunggal, player.load(detail, ctx) untuk ganti video tanpa membuat ulang elemen, event emitter, atribut data-state/mobile/fullscreen/controls-visible/theater.
2. Tampilan SPEC §16.3 PERSIS: gradien, bar kontrol 48px, ikon, progress bar (hover membesar, buffer, scrubber, tooltip waktu), waktu, volume (slider melebar saat hover, roda mouse), toggle autoplay, menu setelan bertingkat dengan animasi slide & badge HD, bezel tengah, spinner (delay 300 ms), auto-hide kontrol 3 dtk + sembunyikan kursor di fullscreen.
3. Interaksi desktop SPEC §16.4: klik tunda 200 ms, double-klik kiri/kanan 35% = ∓10 dtk dengan ripple "10 detik", double-klik tengah = fullscreen, tahan ≥ 500 ms = 2x, drag scrub.
4. Keyboard SPEC §16.5 lengkap dengan OSD.
5. Kualitas SPEC §16.6 (manual + pilihan awal Otomatis + ganti kualitas tanpa layar hitam via canvas), kecepatan 0.25–2, subtitle custom render SPEC §16.7 + tombol CC, fullscreen desktop, event mode bioskop.
6. Ketahanan SPEC §16.9 (retry + refresh signature + fallback compat + overlay error), preferensi tersimpan di localStorage (try/catch).
7. Halaman uji sementara /dev/player (khusus admin) untuk mencoba dengan video nyata (MP4, compat, ber-subtitle, vertikal).
8. Ukur ukuran bundle player (target ≤ 35 KB gzip) dan laporkan.
9. Uji di Chrome & Firefox desktop: semua kontrol, shortcut, ganti kualitas saat bermain (tanpa layar hitam), putuskan jaringan lalu sambungkan (pemutaran pulih), biarkan signature kedaluwarsa (ubah sementara TTL ke 1 menit) lalu seek → pulih otomatis.
10. Perbarui CLAUDE.md, centang Step 10, commit.
```

---

## Step 11 — Pemutar: Mobile & Fitur Lanjutan

```text
Kerjakan STEP 11 — Pemutar mobile & lanjutan (SPEC §16.4, §16.6, §16.8, §16.9).

1. UI sentuh (deteksi via media query hover:none & pointer:coarse): tap tampil/sembunyi kontrol, tombol tengah Sebelumnya · Putar/Jeda · Berikutnya, double-tap kiri/kanan akumulatif (10 → 20 → 30 dtk selama tap berlanjut ≤ 700 ms) dengan animasi ripple & teks, long-press = 2x dengan indikator, scrub sentuh (area sentuh 24px).
2. Fullscreen + orientasi SPEC §16.8: lock landscape (portrait untuk video vertikal), unlock saat keluar, iPhone → webkitEnterFullscreen, auto-fullscreen saat HP diputar ke landscape (best effort, abaikan penolakan browser), keluar saat diputar kembali ke portrait bila fullscreen dipicu rotasi.
3. Preview storyboard di progress bar (hover & saat drag), ukuran lebih besar di fullscreen.
4. Media Session (metadata + semua handler + setPositionState), Wake Lock, Picture-in-Picture (menu setelan & tombol I), menu klik kanan (Ulangi, Salin URL video, Salin URL pada waktu saat ini).
5. End screen: countdown autoplay (BATAL / PUTAR SEKARANG), grid rekomendasi bila autoplay mati, tombol putar ulang. Logika prev/next SPEC §16.9 via konteks yang disuplai halaman tonton (antarmuka saja; datanya dari Step 12/13).
6. ABR Otomatis SPEC §16.6 (turun saat stall, naik saat buffer sehat, batas frekuensi).
7. Uji dengan emulasi perangkat (Playwright/Chrome DevTools: Pixel & iPhone), lalu BERIKAN saya checklist uji manual singkat untuk HP Android & iPhone nyata dan TUNGGU hasil saya; perbaiki temuan.
8. Perbarui CLAUDE.md, centang Step 11, commit.
```

**🧑 Tindakan Anda di Step 11:** uji di HP Android & iPhone sesuai checklist dari Claude, laporkan hasilnya.

---

## Step 12 — Halaman Tonton

```text
Kerjakan STEP 12 — Halaman tonton (PRD §5.3, §5.4; SPEC §15.5, §16.9, §17).

1. Layout PERSIS SPEC §15.5: dua kolom (kolom kanan 402px), satu kolom < 1017px, pemutar sticky di mobile, mode bioskop (T / tombol) dengan perpindahan kolom kanan.
2. Pemutar persisten: ketika v berganti (next/prev/klik rekomendasi), PlayerView TIDAK di-unmount; fullscreen tetap bertahan saat autoplay.
3. Di bawah pemutar: judul, baris channel (avatar 40px, nama, tayangan · waktu), tombol Bagikan (ShareDialog dengan "Mulai pada mm:ss" + salin + tautan bagikan WhatsApp/Telegram/X/Facebook), Simpan (siapkan; backend di Step 13), untuk pemilik/admin: pill Publik/Privat (ubah langsung) & menu ⋯ (Ubah judul, Hapus). Tanpa deskripsi/komentar.
4. Kolom kanan: chip filter (Semua / Dari <channel> / Terkait) + CompactVideo list dengan infinite scroll; slot PlaylistPanel bila ada list= (komponen diisi di Step 13).
5. Next/prev, autoplay, resume (resumeSec / localStorage tamu), parameter t= (detik atau 1m30s), POST /api/progress tiap 15 dtk + jeda + pagehide (fetch keepalive), histori tamu lokal, view saat viewqualified, title dokumen "<judul> - Dymas Video".
6. Halaman Histori (/feed/history, dikelompokkan per hari, hapus satu/semua) & Anda (/feed/you).
7. Video tidak tersedia → layar "Video tidak tersedia" gaya YouTube.
8. Screenshot halaman tonton vs YouTube (1920/1280/1000/400 px, normal & bioskop, gelap & terang) → perbaiki selisih.
9. Perbarui CLAUDE.md, centang Step 12, commit.
```

---

## Step 13 — Playlist

```text
Kerjakan STEP 13 — Playlist (PRD §5.6; SPEC §13, §14.2).

Backend: semua endpoint playlist (mine, public, create, detail dengan hiddenCount, update, delete, items add/remove, order, contains, import-guest), aturan tamu via dv_gid (dibuat saat playlist pertama, selalu privat), batas jumlah SPEC §12, item_count terjaga, sampul = video listable pertama.

Frontend:
- SaveDialog "Simpan video ke…" (checkbox optimistic, ikon gembok/globe, buat playlist baru dengan counter 150 karakter, visibilitas hanya untuk user) — sambungkan dari halaman tonton & menu ⋮ kartu.
- Halaman /playlist?list= gaya YouTube: panel kiri (sampul dengan latar blur warna, judul, pemilik, jumlah video, Putar semua, Acak, ubah judul/visibilitas, hapus), daftar item dengan drag & drop (@dnd-kit, dukung sentuh) untuk pemilik, hapus item, keterangan "N video tidak tersedia disembunyikan".
- /feed/playlists (milik saya, termasuk playlist perangkat untuk tamu), /feed/playlists/public (Jelajahi Playlist), item sidebar.
- PlaylistPanel di halaman tonton (judul, pemilik, "3 / 12", Ulangi, Acak, item aktif tersorot & auto-scroll) + integrasi next/prev & autoplay pemutar (playlist langsung lanjut tanpa countdown).
- Setelah login dari perangkat yang punya playlist tamu: tawarkan "Pindahkan N playlist dari perangkat ini ke akun Anda".

Uji matriks: tamu membuat playlist (tidak terlihat dari browser lain), playlist publik user terlihat oleh tamu, playlist privat tidak, video privat di playlist publik tersembunyi bagi orang lain, urutan tersimpan, acak & ulangi bekerja, impor tamu → akun berhasil.
Perbarui CLAUDE.md, centang Step 13, commit.
```

---

## Step 14 — Upload & Video Anda

```text
Kerjakan STEP 14 — Upload & Video Anda (PRD §5.5; SPEC §11, §7.5).

Backend:
- Upload §11 seluruhnya: init (validasi ekstensi/ukuran/kuota/maks 3 aktif), chunk (stream body mentah ke sesi resumable Drive TANPA buffering penuh, 308/200/404/5xx), status (query offset ke Drive), batal, finalize (insert video, storage_used, enqueue probe, audit), pembersihan sesi kedaluwarsa.
- Subtitle upload per video; PATCH video (rename → rename file Drive dengan ekstensi asli; visibilitas → update appProperties); DELETE video → trash Drive + delete_assets + kurangi storage_used.
- Sambungkan opsi hapus user (delete → trash semua videonya di Drive; transfer → owner NULL + appProperties diperbarui).

Frontend:
- UploadDialog gaya YouTube Studio (drop area, PILIH FILE, multi-file, visibilitas Publik/Privat dengan penjelasan, kategori, subtitle opsional).
- UploadManager global pojok kanan bawah (bisa dilipat; 2 file paralel; progres; retry backoff; event online; beforeunload; lanjutkan setelah refresh dengan memilih file yang sama).
- Halaman Video Anda (/my/videos) gaya Studio "Konten": thumbnail, judul, dropdown visibilitas, status/progres proses, tanggal, tayangan, aksi ubah judul / subtitle / hapus, filter & cari.

Uji:
- upload file ≥ 1 GB; putuskan jaringan di tengah (DevTools offline / matikan wifi) → upload berlanjut dari offset yang benar;
- file muncul di folder Drive dengan appProperties benar, lalu Memproses → Siap;
- video privat: tidak terlihat oleh tamu & user lain di semua daftar, URL langsung → "Video tidak tersedia", stream → 404;
- melebihi kuota → ditolak dengan pesan jelas; batal upload → sesi dibersihkan;
- rename di aplikasi → nama file di Drive ikut berubah; hapus → file masuk Trash Drive.
Perbarui CLAUDE.md, centang Step 14, commit.
```

---

## Step 15 — Panel Admin Lengkap

```text
Kerjakan STEP 15 — Panel admin (PRD §5.7; SPEC §18).

Lengkapi layout Studio dan semua halaman: Dasbor (metrik, status Drive, sinkron terakhir + tombol, antrean + progres, disk, top 5 video, 5 upload terbaru), Pengguna (tabel + dialog tambah/ubah dengan generate password, kuota GB, role, status; reset password; hapus dengan pilihan video), Video (tabel Studio, filter status/visibilitas/pemilik/kategori, cari, aksi per baris & massal: visibilitas, proses ulang, hapus), Playlist (tabel, ubah visibilitas, hapus), Antrean (rapikan), Pengaturan: Situs (nama, logo & favicon upload — SVG disanitasi, channel utama & handle, tema default, izinkan playlist tamu), Upload, Pemutar, Keamanan; Log Aktivitas (filter aksi).
Semua perubahan pengaturan tercatat di audit log dan langsung berlaku (invalidasi cache settings; nama/logo situs langsung berubah di masthead & <title>).

Uji semua alur admin; pastikan user biasa & tamu tidak bisa membuka /admin maupun memanggil /api/admin/* (403/redirect login).
Perbarui CLAUDE.md, centang Step 15, commit.
```

---

## Step 16 — Keamanan, Performa, Operasional

```text
Kerjakan STEP 16 — Hardening (SPEC §12, §13, §19, §20, §21).

1. Review keamanan menyeluruh: setiap endpoint memakai aturan §13; tidak ada kebocoran video privat di feed, search, suggest, related, channel, playlist, OG meta, thumbnail, storyboard, subtitle, stream; CSRF & Origin; rate limit; header (CSP, nosniff, referrer-policy); validasi upload & ukuran body; SVG disanitasi; secret tidak pernah keluar ke API/log/HTML. Gunakan /security-review bila tersedia. Perbaiki temuan.
2. Performa: ukur bundle (JS awal ≤ 170 KB gzip, player ≤ 35 KB), Lighthouse mobile untuk beranda & tonton (target performa ≥ 85), EXPLAIN query feed/search/related dengan 10.000 baris data uji (bersihkan setelahnya), cek header cache SPEC §19 & gzip nginx untuk json/js/css/svg.
3. Operasional: logrotate /etc/logrotate.d/video_dymas, cron backup DB harian 03:00 simpan 7 di aaPanel (API atau instruksi UI untuk saya), salin .env ke /root/backup/video_dymas.env (600), tugas pembersihan berjalan, auto start on boot (uji restart project via aaPanel).
4. Buat & jalankan scripts/smoke.sh (SPEC §21).
5. Perbarui CLAUDE.md (operasional, backup, logrotate, hasil audit), centang Step 16, commit.
```

---

## Step 17 — QA Akhir & Serah Terima

```text
Kerjakan STEP 17 — QA akhir & serah terima.

1. Jalankan seluruh unit test & scripts/smoke.sh.
2. Jalankan matriks QA dan laporkan dalam tabel (✅/❌ + catatan), lalu perbaiki semua ❌:
   - Peran: tamu, user A, user B, admin.
   - Perangkat: Chrome & Firefox desktop, Safari (bila ada), Android Chrome, iPhone Safari, iPad (emulasi + uji nyata oleh saya dengan checklist darimu).
   - Tema: gelap & terang.
   - Cakupan: Kriteria Penerimaan PRD §10 (1–8) + semua item P0 di PRD §5 + aturan visibilitas PRD §6.
3. Screenshot berdampingan aplikasi vs YouTube (beranda, tonton, bioskop, pencarian, playlist, mobile) → simpan di storage/qa/ (tidak dipublikasikan) → perbaiki selisih yang terlihat.
4. Finalisasi CLAUDE.md: arsitektur aktual, semua konfigurasi & path, perintah (deploy, restart, log, migrate, sync manual), troubleshooting (token Drive invalid → hubungkan ulang; kuota/rate limit Drive; job gagal; disk penuh; restart aplikasi), daftar P2 yang belum dikerjakan.
5. Berikan saya ringkasan serah terima: URL, akun admin, cara menambah video (taruh di Drive / upload), cara membuat user, hal yang perlu diperhatikan (bandwidth, kuota Drive, ganti password DB & admin).
Centang Step 17, commit.
```

---

## Prompt Lanjutan (bila step terputus)

```text
Lanjutkan STEP <N> dari titik terakhir. Baca CLAUDE.md (Progres & Changelog) dan `git log --oneline -20` serta `git status` untuk mengetahui apa yang sudah selesai. Jangan mengulang pekerjaan yang sudah ada; verifikasi dulu, lalu lanjutkan sisa daftar tugas STEP <N> di PROMPT.md sampai kriteria selesai terpenuhi.
```

## Prompt Perbaikan (bug setelah step selesai)

```text
Ada masalah: <jelaskan apa yang terjadi, di halaman/perangkat apa, langkah untuk mereproduksi, dan yang diharapkan>.
Baca CLAUDE.md lalu bagian SPEC yang relevan. Reproduksi dulu masalahnya (log aaPanel: /www/server/nodejs/vhost/logs/video_dymas.log, nginx: /www/wwwlogs/), temukan akar penyebab, perbaiki, tambahkan test bila memungkinkan, deploy, verifikasi di https://video.dymas.cloud, catat di Changelog CLAUDE.md, commit.
```

## Prompt Perubahan Fitur

```text
Saya ingin mengubah/menambah: <deskripsi>.
Perbarui dulu PRD.md (bagian fitur/keputusan) dan SPEC.md (detail teknis) secukupnya, tunjukkan ringkasan perubahannya ke saya, lalu implementasikan, uji, deploy, perbarui CLAUDE.md, commit.
```

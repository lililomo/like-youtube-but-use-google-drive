# SERVER-TODO — Konfigurasi server yang belum diterapkan

Daftar pekerjaan **di server** (aaPanel, nginx, sistem, verifikasi produksi) yang muncul dari kode yang ditulis di luar server (Claude cloud).
Kode sampai ke server lewat `git pull`, tetapi konfigurasi di bawah ini **tidak** ikut terpasang otomatis oleh `scripts/pull-deploy.sh`.

---

## Protokol untuk Claude di SERVER

Berlaku bila `/www/server/` ada. Urutan setiap kali menerapkan update dari GitHub:

1. `PULL_ONLY=1 bash scripts/pull-deploy.sh <branch>` — tarik kode saja (belum build/restart). Skrip juga mencetak item yang masih terbuka di file ini.
2. Baca file ini. Kerjakan semua item `### [ ]` yang **Kapan: sebelum deploy**, berurutan menurut ID.
3. `bash scripts/deploy.sh` — build, migrate, restart, health check.
4. Kerjakan item `### [ ]` yang **Kapan: sesudah deploy**.
5. Untuk setiap item:
   - Jalankan **Langkah**, lalu **Verifikasi**. Laporkan hasil apa adanya.
   - Berhasil → ubah judul menjadi `### [x]` dan isi **Hasil** (tanggal + ringkasan, tanpa secret).
   - Gagal → biarkan `### [ ]`, isi **Hasil** dengan ❌ + penyebab, jalankan **Rollback** bila ada, dan jangan lanjut ke item yang bergantung padanya.
   - Item bertanda **🧑 Butuh user** → minta konfirmasi/tindakan user dulu; jangan dijalankan diam-diam.
6. Catat perubahan konfigurasi di CLAUDE.md (Konfigurasi + Changelog), ubah catatan "belum di-deploy" menjadi "sudah di-deploy".
7. Commit lalu **langsung push** (`git pull --ff-only` dulu bila perlu). Commit server yang tidak di-push membuat `pull-deploy.sh` (fast-forward saja) gagal di pull berikutnya.

Item yang sudah `[x]` tidak dijalankan ulang. Langkah ditulis idempoten bila memungkinkan.

## Protokol untuk Claude di CLOUD / mesin lain

- Setiap kali kode membutuhkan perubahan di server (nginx, `.env`, file sistem, aaPanel, cron, verifikasi produksi, uji perangkat), **tambahkan item baru** di bagian *Terbuka* dengan format di bawah. Jangan menunggu user mengingatkan.
- ID berurutan (`ST-001`, `ST-002`, …), tidak pernah dipakai ulang. Hanya menambah; jangan menghapus atau mengubah item `[x]`.
- Item dari bagian *Rencana* dipindah ke *Terbuka* saat kode step terkait di-push.
- Jangan pernah menulis secret di sini (password, token, isi `.env`). Tulis *nama* variabel dan cara membuat nilainya.

### Format item

```markdown
### [ ] ST-00N — Judul singkat
- **Asal:** Step N / commit / fitur
- **Kapan:** sebelum deploy | sesudah deploy
- **Butuh user:** tidak | 🧑 ya — <apa yang dibutuhkan>
- **Kenapa:** akibatnya bila tidak dikerjakan
- **Langkah:**
  ```bash
  perintah...
  ```
- **Verifikasi:** perintah/cek + hasil yang diharapkan
- **Rollback:** cara membatalkan (bila relevan)
- **Hasil:** _(diisi Claude di server)_
```

---

## Terbuka

### [ ] ST-001 — Nama aplikasi "GDrive Tube", logo & foto profil: cek setting lama + uji di produksi
- **Asal:** perubahan fitur 2026-10-02 (nama aplikasi bisa diatur, logo/favicon, foto profil) — commit di branch `claude/cloud-pricing-token-63p7bp`
- **Kapan:** sesudah deploy (migrasi `002_avatar.sql` dan folder `storage/public/avatars` dibuat otomatis oleh `deploy.sh`)
- **Butuh user:** 🧑 ya — hanya bila langkah 1 menemukan nama lama tersimpan: tanya user apakah diganti ke "GDrive Tube"
- **Kenapa:** default baru hanya berlaku bila kunci belum pernah disimpan. Bila `site.name`/`site.channel_name`/`site.channel_handle` sudah ada di tabel `settings`, situs tetap bernama lama.
- **Langkah:**
  ```bash
  # 1. Nilai site.* yang tersimpan (kosong = memakai default baru)
  P=$(grep '^DB_PASSWORD=' /www/wwwroot/video.dymas.cloud/.env | cut -d= -f2-)
  /www/server/mysql/bin/mysql -udummy -p"$P" dummy -e "SELECT \`key\`, value FROM settings WHERE \`key\` LIKE 'site.%'"
  # 2. Migrasi & folder
  /www/server/mysql/bin/mysql -udummy -p"$P" dummy -e "SELECT id FROM schema_migrations; SHOW COLUMNS FROM users LIKE 'avatar_key'"
  ls -ld /www/wwwroot/video.dymas.cloud/storage/public/avatars
  # 3. Nama di HTML & API
  curl -fsS https://video.dymas.cloud/ | grep -o '<title>[^<]*</title>'
  curl -fsS https://video.dymas.cloud/api/site
  ```
  Bila langkah 1 menampilkan nama lama dan user setuju diganti: ubah lewat Studio → Pengaturan → Situs (bukan SQL langsung, agar tercatat di audit log).
- **Verifikasi:** `<title>GDrive Tube</title>` (atau nama pilihan user); `avatar_key` ada; folder `avatars` milik `www`. Uji manual di browser: upload foto profil di `/account`, upload logo + favicon di `/admin/settings/site`, tab browser menampilkan favicon baru, lalu hapus lagi bila hanya uji. File baru muncul di `storage/public/{avatars,branding}` dan bisa dibuka lewat `https://video.dymas.cloud/media/...` (alias nginx `/media/` sudah mencakup subfolder baru — tidak perlu ubah nginx).
- **Rollback:** fitur tidak mengubah konfigurasi server; kolom `avatar_key` boleh dibiarkan.
- **Hasil:** _(diisi Claude di server)_

### [ ] ST-002 — Step 11 (pemutar mobile & lanjutan): verifikasi produksi + uji HP nyata
- **Asal:** Step 11 (branch `claude/cloud-pricing-token-63p7bp`)
- **Kapan:** sesudah deploy
- **Butuh user:** 🧑 ya — uji di HP Android (Chrome) & iPhone (Safari) nyata, laporkan hasil per butir
- **Kenapa:** Chromium di Claude cloud tidak punya codec H.264 dan tidak bisa merotasi layar/wake lock sungguhan; uji otomatis memakai video VP9 & emulasi perangkat.
- **Langkah (Claude di server):**
  ```bash
  bash scripts/dev/test-instance.sh start
  cd /root/dv-qa && cp /www/wwwroot/video.dymas.cloud/scripts/dev/qa/player-test3.mjs . && npm ls playwright-core >/dev/null || npm i playwright-core
  CHROME_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node player-test3.mjs   # harus 25/25
  bash /www/wwwroot/video.dymas.cloud/scripts/dev/test-instance.sh stop
  ```
  Lalu kirim checklist berikut ke user dan **tunggu hasilnya**; perbaiki temuan:
  1. Tap video → kontrol muncul dengan tombol tengah (⏮ ▶/❚❚ ⏭); tap lagi → hilang.
  2. Double-tap kanan/kiri → ±10 dtk dengan animasi; tap cepat berulang → 20, 30 dtk.
  3. Tahan jari di video → "2x" selama ditahan, lepas → normal.
  4. Geser progress bar dengan jari → pratinjau gambar + waktu, video lompat saat dilepas.
  5. Tombol layar penuh → video landscape memenuhi layar & HP berputar ke landscape (iPhone: pemutar bawaan iOS).
  6. Saat video bermain, putar HP ke landscape → otomatis layar penuh (Android; boleh gagal di beberapa browser); putar kembali → keluar layar penuh.
  7. Layar tidak mati sendiri selama video diputar (Wake Lock).
  8. Kunci layar / tarik panel notifikasi → kontrol media (judul, putar/jeda, maju/mundur) tampil dan berfungsi.
  9. Video selesai → "Berikutnya dalam 5" + BATAL / PUTAR SEKARANG; matikan "Putar otomatis" → grid rekomendasi.
  10. Jaringan lambat (mis. matikan Wi-Fi, pakai data 3G) → kualitas Otomatis turun tanpa layar hitam.
- **Verifikasi:** player-test3 25/25 di server + jawaban user untuk 10 butir (✅/❌ + catatan HP & browser).
- **Rollback:** tidak ada perubahan konfigurasi server.
- **Hasil:** _(diisi Claude di server)_

### [ ] ST-003 — Step 12 (halaman tonton): uji dengan Drive asli + bandingkan dengan YouTube
- **Asal:** Step 12 (branch `claude/cloud-pricing-token-63p7bp`)
- **Kapan:** sesudah deploy
- **Butuh user:** 🧑 ya — konfirmasi sebelum mengubah/menghapus video uji di Drive asli (pakai video uji, bukan video penting)
- **Kenapa:** rename/pindah/trash diuji dengan fake Drive; youtube.com tidak bisa diakses dari Claude cloud untuk perbandingan visual.
- **Langkah:**
  ```bash
  # uji otomatis di instance uji (fake Drive)
  bash scripts/dev/test-instance.sh start
  cd /root/dv-qa && cp /www/wwwroot/video.dymas.cloud/scripts/dev/qa/watch-test.mjs . && CHROME_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node watch-test.mjs   # harus 19/19
  bash /www/wwwroot/video.dymas.cloud/scripts/dev/test-instance.sh stop
  # perbandingan visual (skrip yt.mjs & shot.mjs di /root/dv-qa)
  for w in 1920 1280 1000 400; do for th in dark light; do node yt.mjs $w 900 $th yt-watch-$w-$th; BASE=https://video.dymas.cloud node shot.mjs app-watch-$w-$th "/watch?v=<id video publik>" $w 900 $th; done; done
  ```
  Di produksi (setelah user setuju): pada satu video uji → ubah judul (cek nama file di Drive ikut berubah, subtitle `.srt` ikut berganti nama), jadikan Privat lalu Publik, lalu Hapus (file masuk Trash Drive; pulihkan dari Trash → video kembali setelah sinkron).
- **Verifikasi:** watch-test 19/19; selisih visual yang mencolok dengan YouTube dicatat & diperbaiki; perilaku Drive sesuai.
- **Rollback:** tidak ada perubahan konfigurasi server.
- **Hasil:** _(diisi Claude di server)_

### [ ] ST-004 — Step 13 (playlist): npm ci paket baru + uji produksi
- **Asal:** Step 13 (branch `claude/cloud-pricing-token-63p7bp`)
- **Kapan:** sesudah deploy (`deploy.sh` otomatis `npm ci` karena `package-lock.json` berubah: paket baru `@dnd-kit/*`)
- **Butuh user:** tidak
- **Kenapa:** pastikan `npm ci` di server berhasil mengambil paket baru (lockfile kini berisi campuran URL `registry.npmmirror.com` lama + `registry.npmjs.org` untuk @dnd-kit) dan fitur playlist berjalan di produksi.
- **Langkah:**
  ```bash
  ls /www/wwwroot/video.dymas.cloud/node_modules/@dnd-kit   # core, sortable, utilities
  bash scripts/dev/test-instance.sh start
  cd /root/dv-qa && cp /www/wwwroot/video.dymas.cloud/scripts/dev/qa/playlist-test.mjs . && CHROME_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node playlist-test.mjs   # harus 18/18
  bash /www/wwwroot/video.dymas.cloud/scripts/dev/test-instance.sh stop
  ```
  Di https://video.dymas.cloud: Simpan video ke playlist baru (tamu & admin), buka /playlist?list=…, geser urutan, Putar semua.
- **Verifikasi:** folder @dnd-kit ada; playlist-test 18/18; alur manual berjalan.
- **Rollback:** bila `npm ci` gagal karena registry: `npm ci --registry=https://registry.npmmirror.com` (atau sebaliknya `--registry=https://registry.npmjs.org/`).
- **Hasil:** _(diisi Claude di server)_

### [ ] ST-005 — Step 14 (upload): uji upload besar ke Drive asli
- **Asal:** Step 14 (branch `claude/cloud-pricing-token-63p7bp`)
- **Kapan:** sesudah deploy
- **Butuh user:** 🧑 ya — user mengupload file ≥ 1 GB dari browser dan memutus jaringan sebentar di tengah (matikan Wi-Fi ±10 dtk)
- **Kenapa:** diuji dengan fake Drive (40 MB); perilaku sesi resumable Google asli (308 dengan Range kelipatan 256 KiB, timeout, kuota Drive) dan nginx untuk body besar perlu dibuktikan di produksi.
- **Langkah (Claude di server):**
  ```bash
  grep -n "location ^~ /api/uploads" -A12 /www/server/panel/vhost/rewrite/node_video_dymas.conf   # client_max_body_size 64m, proxy_request_buffering off
  bash scripts/dev/test-instance.sh start
  cd /root/dv-qa && cp /www/wwwroot/video.dymas.cloud/scripts/dev/qa/upload-test.mjs . && head -c 41943040 /dev/urandom > big.mp4
  # video kecil apa saja (mis. dari media-src) sebagai argumen pertama
  CHROME_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node upload-test.mjs media-src/Musik/Live/Konser.webm big.mp4   # harus 10/10
  bash /www/wwwroot/video.dymas.cloud/scripts/dev/test-instance.sh stop
  tail -n 100 /www/server/nodejs/vhost/logs/video_dymas.log | grep -i upload
  ```
  Lalu minta user: login sebagai user biasa → Upload file ≥ 1 GB (Privat) → putus Wi-Fi sebentar → upload lanjut → file muncul di folder Drive dengan nama sama → status Memproses → Siap; dari browser lain (tamu) URL video → "Video tidak tersedia".
- **Verifikasi:** upload-test 10/10; upload user selesai tanpa mulai dari 0; ukuran file di Drive sama; video privat tak terlihat tamu.
- **Rollback:** tidak ada perubahan konfigurasi server.
- **Hasil:** _(diisi Claude di server)_

### [ ] ST-006 — Step 15 (panel admin): verifikasi di produksi
- **Asal:** Step 15 (branch `claude/cloud-pricing-token-63p7bp`)
- **Kapan:** sesudah deploy
- **Butuh user:** tidak (jangan menghapus/mengubah user atau video asli; pakai user uji yang dibuat lalu dihapus lagi)
- **Kenapa:** dasbor memakai `statfs` folder storage, versi ffmpeg server, dan statistik DB produksi — perlu dicek tampil benar.
- **Langkah:**
  ```bash
  bash scripts/dev/test-instance.sh start
  cd /root/dv-qa && cp /www/wwwroot/video.dymas.cloud/scripts/dev/qa/admin-test.mjs . && CHROME_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome node admin-test.mjs   # harus 29/29
  bash /www/wwwroot/video.dymas.cloud/scripts/dev/test-instance.sh stop
  ```
  Lalu buka https://video.dymas.cloud/admin sebagai admin: dasbor (disk sesuai `df -h /www`, ffmpeg 4.4.2), Pengguna, Video, Log Aktivitas. Cek user biasa → `/admin` ditolak.
- **Verifikasi:** admin-test 29/29; angka dasbor masuk akal.
- **Rollback:** tidak ada perubahan konfigurasi server.
- **Hasil:** _(diisi Claude di server)_

### [ ] ST-007 — Step 16 (operasional): logrotate, backup DB harian, backup .env, gzip, smoke & uji keamanan
- **Asal:** Step 16 (branch `claude/cloud-pricing-token-63p7bp`)
- **Kapan:** sesudah deploy
- **Butuh user:** 🧑 ya — hanya bila API aaPanel untuk cron backup gagal (user membuat cron lewat UI, langkah 2b). Langkah lain tidak.
- **Kenapa:** tanpa logrotate log aplikasi tumbuh tanpa batas; tanpa backup harian data DB (user, playlist, histori, settings terenkripsi) bisa hilang; tanpa salinan `.env` (`APP_KEY`) secret Drive di DB tidak bisa dibaca setelah server dipulihkan.
- **Langkah:**
  1. Logrotate (idempoten):
     ```bash
     cd /www/wwwroot/video.dymas.cloud
     install -m 644 -o root -g root scripts/ops/logrotate-video_dymas.conf /etc/logrotate.d/video_dymas
     logrotate -d /etc/logrotate.d/video_dymas 2>&1 | tail -5     # dry run, tanpa error
     ```
  2. Cron aaPanel "Backup Database" `dummy` harian 03:00, simpan 7 — cek dulu belum ada (`python3 scripts/bt-api.py '/crontab?action=GetCrontab'`).
     a. Lewat API: baca dulu parameter yang diharapkan di `/www/server/panel/class/crontab.py` fungsi `AddCrontab` (nama field berbeda antar versi aaPanel — **perlu diverifikasi, jangan ditebak**), lalu panggil `python3 scripts/bt-api.py '/crontab?action=AddCrontab' name='[GDrive Tube] Backup DB dummy' type=day hour=3 minute=0 sType=database sName=dummy save=7 backupTo=localhost …` sesuai field yang ditemukan. Ingat: 20 kegagalan signature beruntun = API diblokir 1 jam.
     b. Bila API gagal → 🧑 minta user: aaPanel → **Cron** → Add Task → Type *Backup Database*, Name `[GDrive Tube] Backup DB dummy`, Period *Daily* 03:00, Database `dummy`, Backup to *Local disk*, Retain *7*.
  3. Backup `.env` (ulang setiap kali `.env` berubah):
     ```bash
     mkdir -p /root/backup && chmod 700 /root/backup
     install -m 600 -o root -g root .env /root/backup/video_dymas.env
     ```
  4. Gzip: `grep -n 'gzip' /www/server/nginx/conf/nginx.conf`. `gzip_types` harus memuat `application/json`, `text/css`, `application/javascript` (atau `text/javascript`), `image/svg+xml`. Bila kurang: tambahkan `gzip_types …` yang lengkap ke `scripts/nginx-custom.conf` (konteks server, dipakai vhost ini saja), commit, lalu pasang (`cp … /www/server/panel/vhost/rewrite/node_video_dymas.conf && /www/server/nginx/sbin/nginx -t && /etc/init.d/nginx reload`). Jangan edit nginx.conf global.
     ```bash
     curl -sI -H 'Accept-Encoding: gzip' https://video.dymas.cloud/api/categories | grep -i content-encoding
     curl -sI -H 'Accept-Encoding: gzip' "https://video.dymas.cloud$(curl -s https://video.dymas.cloud/ | grep -o '/assets/[^"]*\.js' | head -1)" | grep -i content-encoding
     ```
  5. Smoke produksi (password admin dari `.env` bila belum diganti; kalau sudah, minta user mengisi `SMOKE_PASS` di terminal — jangan ditulis ke file):
     ```bash
     bash scripts/smoke.sh          # BASE default https://video.dymas.cloud
     ```
     Catatan: cek "video privat sebagai tamu" dilewati bila belum ada video privat; "stream" dilewati bila belum ada video publik siap.
  6. Uji keamanan black-box di instance uji (butuh `budi/budi12345` + video siap milik budi dari `upload-test.mjs`):
     ```bash
     bash scripts/dev/test-instance.sh start
     cd /root/dv-qa && cp /www/wwwroot/video.dymas.cloud/scripts/dev/qa/security-test.mjs . && node security-test.mjs   # harus 48/48
     bash /www/wwwroot/video.dymas.cloud/scripts/dev/test-instance.sh stop   # uji rate limit mengunci login 127.0.0.1 → restart instance sebelum dipakai lagi
     ```
  7. Header cache produksi: `curl -sI https://video.dymas.cloud/api/feed | grep -i cache-control` → `private, no-store`; `curl -sI https://video.dymas.cloud/api/site` → `etag` + `private, no-cache`.
  8. Auto start: `python3 scripts/bt-api.py /project/nodejs/restart_project/json 'data={"project_name":"video_dymas"}'`, tunggu ±5 dtk, `curl -fsS https://video.dymas.cloud/api/health`. Cek opsi *auto start on boot* project `video_dymas` masih aktif (UI aaPanel → Website → Node Project; ingat bug `get_project_list` di CLAUDE.md).
  9. (Opsional) Lighthouse mobile beranda & `/watch?v=<id>` dengan Chromium server: `npx -y lighthouse@12 https://video.dymas.cloud/ --chrome-flags='--headless --no-sandbox' --only-categories=performance --form-factor=mobile --quiet --output=json | python3 -c 'import sys,json;print(json.load(sys.stdin)["categories"]["performance"]["score"])'` — target ≥ 0,85. Catat angkanya di CLAUDE.md.
- **Verifikasi:** `ls -l /etc/logrotate.d/video_dymas` ada; cron backup tampil di `GetCrontab` (03:00, save 7) dan — setelah 03:00 berikutnya — file backup ada di `/www/backup/database/`; `/root/backup/video_dymas.env` mode 600 dan `cmp` sama dengan `.env`; respons JSON & JS ber-`content-encoding: gzip`; smoke `0 gagal`; security-test 48/48; health OK setelah restart.
- **Rollback:** `rm /etc/logrotate.d/video_dymas`; hapus cron di aaPanel; kembalikan `scripts/nginx-custom.conf` dari git lalu pasang ulang & reload nginx.
- **Hasil:** _(diisi Claude di server)_

### [ ] ST-008 — Step 17 (QA akhir): regresi di server, perbandingan YouTube, uji perangkat nyata, serah terima
- **Asal:** Step 17 (branch `claude/cloud-pricing-token-63p7bp`)
- **Kapan:** sesudah deploy, **setelah ST-001 s/d ST-007 selesai**
- **Butuh user:** 🧑 ya — uji di perangkat nyata (checklist langkah 4) dan konfirmasi hasilnya. Langkah 1–3 tidak butuh user.
- **Kenapa:** di Claude cloud hanya ada Chromium (iPhone/iPad/Android = emulasi, bukan Safari/Firefox asli), youtube.com tidak bisa dibuka, dan tidak ada Drive asli. Kriteria Penerimaan PRD §10 (1, 3, 4, 5, 7) hanya bisa dibuktikan di sini.
- **Langkah:**
  1. Regresi di instance uji server (urutan penting — `security-test` terakhir karena mengunci login 127.0.0.1):
     ```bash
     cd /www/wwwroot/video.dymas.cloud && export PATH=/www/server/nodejs/v24.18.0/bin:$PATH
     npm test && bash scripts/dev/test-instance.sh start
     BASE=http://127.0.0.1:3299 SMOKE_PASS=admin12345 bash scripts/smoke.sh
     cd /root/dv-qa && cp /www/wwwroot/video.dymas.cloud/scripts/dev/qa/*.mjs . && export CHROME_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
     source /root/dv-qa/api.sh && login && post /api/admin/users '{"username":"budi","displayName":"Budi Santoso","password":"budi12345"}'   # bila budi belum ada (409 = sudah ada)
     for t in player-test3 watch-test playlist-test admin-test; do node $t.mjs | tail -1; done
     node upload-test.mjs media-src/Musik/Live/Konser.webm <file-acak-40MB>      # head -c 41943040 /dev/urandom > /root/dv-qa/big.mp4
     QA_DIR=/www/wwwroot/video.dymas.cloud/storage/qa node matrix-test.mjs | tail -1   # 1128/1128 di cloud
     node security-test.mjs | tail -1
     bash /www/wwwroot/video.dymas.cloud/scripts/dev/test-instance.sh stop
     ```
     Hasil cloud (2026-10-02): smoke 9/9, player-test3 25/25, watch 19/19, playlist 18/18, admin 29/29, upload 10/10, matrix 1128/1128, security 48/48 — angka di server harus sama.
  2. Smoke produksi: `bash scripts/smoke.sh` → `0 gagal`.
  3. Screenshot berdampingan aplikasi produksi vs youtube.com (beranda, tonton, mode bioskop, pencarian, playlist; desktop 1440×900 & mobile 412×915; gelap & terang) dengan `shot.mjs` + `yt.mjs` → simpan di `storage/qa/` (tidak disajikan nginx). Perbaiki selisih tata letak/jarak/ukuran font/warna yang terlihat, commit + push.
  4. 🧑 Minta user menguji di perangkat nyata dengan checklist ini (ditambah checklist pemutar ST-002), catat ✅/❌ per perangkat: **Firefox desktop, Safari macOS (bila ada), Android Chrome, iPhone Safari, iPad Safari**.
     - [ ] Beranda: kartu & chip kategori tampil, scroll tak berujung, tema Gelap/Terang/Ikuti perangkat dari menu akun.
     - [ ] Login (dengan & tanpa "Ingat saya"), logout.
     - [ ] Tonton: putar dalam ≤ ±2 dtk, lompat ke tengah video tanpa menunggu unduhan, ganti kualitas, subtitle, layar penuh (HP: otomatis landscape; iPhone: pemutar bawaan iOS), double-tap ±10 dtk, tahan = 2x, autoplay berikutnya.
     - [ ] Tamu: Simpan → Buat playlist baru → video tersimpan; playlist hanya ada di perangkat itu; setelah login muncul tawaran impor.
     - [ ] User: Upload dari HP (galeri) sebagai **Privat** → status Memproses → Siap; URL-nya dibuka dari perangkat lain tanpa login → "Video tidak tersedia".
     - [ ] User: playlist **Publik** → terlihat di Jelajahi Playlist dari perangkat lain.
     - [ ] Bagikan → WhatsApp/Salin link membuka video yang benar (dengan "Mulai pada").
     - [ ] Admin di tablet/desktop: Dasbor, Pengguna (buat user), Video (ubah visibilitas), Pengaturan → Situs (ganti nama → langsung berubah).
  5. Isi tabel Kriteria Penerimaan PRD §10 (1–8) di CLAUDE.md bagian *QA akhir* dengan hasil produksi; perbaiki semua ❌.
  6. Centang Step 17 di CLAUDE.md (ubah dari `[~]`), ubah catatan "belum di-deploy" Step 11–17 menjadi "sudah di-deploy", commit + push. Sampaikan ringkasan serah terima ke user (README.md bagian *Panduan singkat pemilik*).
- **Verifikasi:** semua angka regresi sama dengan hasil cloud; smoke produksi 0 gagal; checklist perangkat nyata ✅ (❌ diperbaiki atau dicatat sebagai keterbatasan browser); tabel PRD §10 lengkap.
- **Rollback:** tidak ada perubahan konfigurasi server.
- **Hasil:** _(diisi Claude di server)_

---

## Rencana (belum aktif — dipindah ke *Terbuka* saat step terkait di-push)

Jangan dikerjakan sebelum dipindah ke *Terbuka*.

_(kosong — semua step sudah di-push; item baru ditambahkan bila ada perubahan kode berikutnya)_

---

## Selesai

_(belum ada)_

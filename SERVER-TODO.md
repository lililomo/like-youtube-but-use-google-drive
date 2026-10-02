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

---

## Rencana (belum aktif — dipindah ke *Terbuka* saat step terkait di-push)

Jangan dikerjakan sebelum dipindah ke *Terbuka*.

- **Step 12–15** — Verifikasi fitur step di https://video.dymas.cloud setelah deploy (halaman tonton, playlist, upload ≥ 1 GB ke Drive asli, panel admin).
- **Step 16** — `/etc/logrotate.d/video_dymas` (harian, simpan 14, copytruncate, compress).
- **Step 16** — Cron aaPanel "Backup Database" `dummy` harian 03:00, simpan 7 (API `bt-api.py` atau UI).
- **Step 16** — Cek gzip nginx global aaPanel mencakup `application/json`, `text/css`, `application/javascript`, `image/svg+xml`.
- **Step 16** — Salin `.env` → `/root/backup/video_dymas.env` (600) bila berubah; jalankan `scripts/smoke.sh`; Lighthouse mobile beranda & tonton; `EXPLAIN` query feed/search/related dengan 10.000 baris uji di `dummy_test`; uji auto start (restart project via aaPanel).
- **Step 17** — Matriks QA di produksi + uji perangkat nyata (🧑).

---

## Selesai

_(belum ada)_

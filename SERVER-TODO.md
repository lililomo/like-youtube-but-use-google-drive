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

---

## Rencana (belum aktif — dipindah ke *Terbuka* saat step terkait di-push)

Jangan dikerjakan sebelum dipindah ke *Terbuka*.

- **Step 11** — Verifikasi pemutar di produksi setelah deploy, lalu berikan user checklist uji HP Android (Chrome) & iPhone (Safari) dan tunggu hasilnya (🧑).
- **Step 12–15** — Verifikasi fitur step di https://video.dymas.cloud setelah deploy (halaman tonton, playlist, upload ≥ 1 GB ke Drive asli, panel admin).
- **Step 16** — `/etc/logrotate.d/video_dymas` (harian, simpan 14, copytruncate, compress).
- **Step 16** — Cron aaPanel "Backup Database" `dummy` harian 03:00, simpan 7 (API `bt-api.py` atau UI).
- **Step 16** — Cek gzip nginx global aaPanel mencakup `application/json`, `text/css`, `application/javascript`, `image/svg+xml`.
- **Step 16** — Salin `.env` → `/root/backup/video_dymas.env` (600) bila berubah; jalankan `scripts/smoke.sh`; Lighthouse mobile beranda & tonton; `EXPLAIN` query feed/search/related dengan 10.000 baris uji di `dummy_test`; uji auto start (restart project via aaPanel).
- **Step 17** — Matriks QA di produksi + uji perangkat nyata (🧑).

---

## Selesai

_(belum ada)_

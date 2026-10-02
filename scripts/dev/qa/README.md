# Skrip QA (pengembangan)

Butuh `playwright-core` (pasang di folder lain, mis. `/root/dv-qa`: `npm i playwright-core`) dan Chromium
(`CHROME_PATH`, default cache Playwright di server). Screenshot disimpan ke `$SHOTS` (default `/root/dv-qa/shots`).

| Skrip | Fungsi |
|---|---|
| `shot.mjs <nama> <path> <w> <h> <dark\|light> [user:pass] [aksi]` | Screenshot halaman (`BASE` = URL situs, default produksi). Aksi: `focus-search`, `type:<teks>`, `hover-card`, `account-menu`, `theme-menu`, `drawer` |
| `yt.mjs <w> <h> <tema> <nama>` | Screenshot youtube.com sebagai pembanding |
| `player-test.mjs <videoId>` / `player-test2.mjs <hevcId> <videoId>` | Uji otomatis pemutar di instance uji (port 3299) |
| `player-test3.mjs` | Step 11: layar akhir, menu klik kanan, Media Session, sentuh, ABR (25 cek) |
| `watch-test.mjs` | Step 12: halaman tonton, chip, resume, progres, aksi pemilik, Bagikan, histori (19 cek) |
| `playlist-test.mjs` | Step 13: playlist API + UI, tamu & impor (18 cek) |
| `upload-test.mjs` | Step 14: upload resumable, putus jaringan, reload, subtitle (10 cek; butuh user `budi/budi12345`) |
| `admin-test.mjs` | Step 15: panel admin, akses user biasa/tamu ditolak (29 cek) |
| `matrix-test.mjs` | Step 17: matriks perangkat (desktop, iPad, Android, iPhone — emulasi Chromium) × peran (tamu, user A, user B, admin) × tema (gelap, terang); cek P0, visibilitas PRD §6, error JS, scroll horizontal; screenshot ke `$QA_DIR` (default `storage/qa`). Jalankan setelah `upload-test.mjs` |
| `security-test.mjs` | Step 16: uji keamanan black-box (48 cek; jalankan setelah `upload-test.mjs`). **Mengunci login dari 127.0.0.1 15 menit** → restart instance uji sesudahnya |
| `api.sh` | Helper curl: `source api.sh; login; get /api/...; post /api/... '{json}'` |
| `drive-peek.mjs` | Lihat isi folder Drive produksi (read-only), jalankan di server |

Smoke test (bukan skrip QA, dipakai juga di produksi): `scripts/smoke.sh` — lihat SPEC §21.

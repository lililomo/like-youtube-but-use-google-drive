# Skrip QA (pengembangan)

Butuh `playwright-core` (pasang di folder lain, mis. `/root/dv-qa`: `npm i playwright-core`) dan Chromium
(`CHROME_PATH`, default cache Playwright di server). Screenshot disimpan ke `$SHOTS` (default `/root/dv-qa/shots`).

| Skrip | Fungsi |
|---|---|
| `shot.mjs <nama> <path> <w> <h> <dark\|light> [user:pass] [aksi]` | Screenshot halaman (`BASE` = URL situs, default produksi). Aksi: `focus-search`, `type:<teks>`, `hover-card`, `account-menu`, `theme-menu`, `drawer` |
| `yt.mjs <w> <h> <tema> <nama>` | Screenshot youtube.com sebagai pembanding |
| `player-test.mjs <videoId>` / `player-test2.mjs <hevcId> <videoId>` | Uji otomatis pemutar di instance uji (port 3299) |
| `api.sh` | Helper curl: `source api.sh; login; get /api/...; post /api/... '{json}'` |
| `drive-peek.mjs` | Lihat isi folder Drive produksi (read-only), jalankan di server |

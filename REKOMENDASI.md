# Prompt — Algoritma Rekomendasi "Terasa Seperti YouTube"

> Prompt eksekusi untuk Claude (di server atau cloud). Disusun 2026-10-03 dari permintaan pemilik:
> *"Beranda jangan cuma acak atau urutan terbaru. Rekomendasikan yang biasa ditonton user. Saat menonton, kolom kanan
> menilai video mana yang terkait dengan video yang sedang diputar sekaligus dengan kebiasaan user. Beranda tidak boleh
> selalu sama setiap kali dibuka, seperti YouTube. Pikirkan juga tampilan untuk pengunjung tanpa akun."*

## 0. Peran & aturan
Kamu engineer senior di proyek GDrive Tube (lihat CLAUDE.md, SPEC.md). Patuhi CLAUDE.md (Bahasa Indonesia, catat
konfigurasi, build bersih, test lulus, deploy, commit). Jangan menambah layanan baru (Redis, Python, ML server):
semuanya dihitung **di proses Node yang sama**, dari MariaDB, dengan cache di memori. Privasi: daftar penemuan tetap
**hanya video publik** (`discoverableSql`). Profil viewer hanya dibangun dari datanya sendiri.

## 1. Kenyataan data (wajib jadi dasar desain)
Produksi per 2026-10-03: ±170 video, ±85% milik **channel utama**, **belum ada kategori** (folder Drive datar), tayangan
dan histori masih sangat sedikit, isinya kebanyakan **seri anak** yang diimpor dari **playlist YouTube** (Yufid Kids,
Bing, I'm Best Muslim, dll.). Mayoritas penonton kemungkinan **tamu** (anak menonton tanpa login).
Akibatnya:
- Kategori & pemilik **tidak cukup** sebagai sinyal kemiripan (hampir semua sama/kosong) → pakai **judul**, **seri**
  (playlist YouTube asal, channel YouTube asal, "batang judul" sebelum nomor episode), lalu kategori & pemilik bila ada.
  Semua sinyal diberi bobot **IDF**, jadi fitur yang dimiliki hampir semua video (mis. "channel utama") otomatis lemah.
- Popularitas global hampir nol → jangan bergantung padanya; acak terkontrol + kebaruan + awal seri untuk cold start.
- Sinyal tonton tamu harus disimpan di server (anonim, cookie `dv_gid`), kalau tidak personalisasi & co-watch tidak
  pernah punya data.
- Katalog kecil (ratusan sampai ±10 ribu video) → skor **semua kandidat** di memori setiap permintaan (± < 20 ms).

## 2. Sinyal
| Sinyal | Sumber | Dipakai untuk |
|---|---|---|
| Vektor konten video | judul (token tanpa stopword, IDF), `pl:` playlist YouTube asal, `st:` batang judul seri, `yc:` channel YouTube asal, `cat:`/`catp:` kategori & induk, `own:` pemilik — tiap kelompok punya bobot, lalu × IDF, L2-normal | kemiripan video↔video & video↔profil |
| Episode | `youtube_imports.playlist_index`, atau nomor dari judul (`Eps 12`, `Episode 8`, `Part 3`, `#5`, `Bagian 2`, `02. …`) + batang judul | "episode berikutnya", awal seri |
| Histori tonton | user: `watch_history`; tamu: tabel baru `guest_watch` (per hash `dv_gid`) — posisi maks, durasi, jumlah putar, waktu | profil jangka panjang & sesi, penalti sudah ditonton |
| Co-watch | pasangan video yang ditonton viewer yang sama (user + tamu, 120 hari, maks 60 video terbaru per viewer; bobot lebih besar bila berdekatan waktu) dinormalisasi `cnt / (√(nA·nB) + 2)` | "yang menonton ini juga menonton" |
| Tren | jumlah viewer berbeda 7 hari terakhir | kualitas |
| Popularitas | `view_count` (log, dinormalisasi) | kualitas |
| Kebaruan | `exp(−umur_hari/14)` | dorongan video baru |
| Tidak tertarik | tabel baru `rec_feedback` (user atau tamu) | dikecualikan + menurunkan video mirip + vektor negatif di profil |

## 3. Profil viewer (per permintaan)
Dari ≤ 300 baris histori terbaru milik viewer (video yang tidak ada di katalog diabaikan):
- `completion = min(1, posisi_maks / durasi)`; `engagement = 0.3 + 0.7·completion`.
- Klik lalu pergi (posisi maks < 15 dtk dan < 20%, lebih dari 30 menit lalu) = sinyal negatif lemah.
- Ditonton berulang: `× (1 + 0.3·min(putar−1, 5))` — penting untuk anak yang suka mengulang.
- Jangka panjang **P**: `Σ engagement·ulang·0.5^(umur_hari/30)·vektor` − negatif (tidak tertarik 0.6, klik-pergi 0.3).
- Sesi **S**: tontonan ≤ 3 jam terakhir, bobot `0.5^(menit_lalu/60)` → menangkap "sedang ingin menonton apa".
- `cf(c)` = rata-rata berbobot co-watch dari video yang ditonton ke kandidat c.

## 4. Beranda ("Semua")
**Viewer punya histori** — skor dasar:
`0.40·cos(P,c) + 0.20·cos(S,c) + 0.20·cf(c) + 0.10·kualitas + 0.10·kebaruan` (cos negatif dipotong 0)
`+ 0.25` bila c = episode berikutnya dari seri yang ≤ 30 hari lalu ditonton ≥ 70% dan c belum ditonton ("lanjutkan seri").
Faktor sudah ditonton: belum = 1 · sedang ditonton (10–90%) = 0.85 (bar merah, "lanjutkan") · selesai = 0.25
(0.6 bila diputar ≥ 3×, favorit) · selesai ≤ 3 jam lalu = 0.1 · klik-pergi = 0.4. Tidak tertarik → dibuang; mirip
(cos > 0.5) dengan yang tidak disukai → × 0.5.
**Tamu baru / user tanpa histori (cold start)**:
`0.30·kualitas + 0.20·kebaruan + 0.15·awal_seri + 0.35·acak` — tampil campuran populer, terbaru, dan **episode
pertama dari berbagai seri** (pintu masuk yang enak untuk penonton baru), berbeda setiap dibuka. Begitu satu video
ditonton, profil langsung berlaku (histori tamu tersimpan di server).
**Variasi setiap dibuka**: skor × `(0.8 + 0.4·acak) + 0.06·acak` dengan PRNG dari **seed** yang dikirim klien. Seed
baru setiap beranda dibuka lewat link/logo/muat ulang; tombol Kembali memakai seed yang sama (urutan dipulihkan, seperti
YouTube). Hasil peringkat di-cache per (viewer, seed, filter) 15 menit → infinite scroll konsisten.
**Eksplorasi**: ±1 dari 6 posisi (posisi 5, 11, 17, …) diisi video di luar minat (cos(P,c) < 0.15) yang diurutkan
kualitas + kebaruan + acak — supaya tidak terjebak satu seri saja.
**Keragaman**: re-rank greedy; klaster = `pl:` › `st:` › `yc:` › `cat:` › pemilik+token judul utama; skor × 0.6^(jumlah
klaster sama di 6 slot terakhir), × 0.5 bila sama dengan slot tepat sebelumnya.
Chip: **Semua** (personal) · **Terbaru** (urut upload) · **Populer** · kategori (personal, dibatasi kategori itu).

## 5. Kolom kanan halaman tonton ("Semua")
Untuk video yang diputar v:
`0.45·sim(v,c) + 0.20·cowatch(v,c) + 0.15·cos(P,c) + 0.05·cos(S,c) + 0.08·kualitas + 0.07·kebaruan`
`+ 0.8` episode berikutnya (jadi item pertama → autoplay "Berikutnya" melanjutkan seri), `+ 0.1·peluruhan` episode
n+2…n+5, `+ 0.05` episode sebelumnya.
Faktor: selesai ditonton × 0.35 (0.6 bila favorit) · ditonton ≤ 3 jam lalu × 0.3 · sedang ditonton × 0.9.
Variasi kecil × `(0.9 + 0.2·acak)` (seed per tayangan halaman). Keragaman ringan: × 0.85^(klaster sama di 4 slot
terakhir). Tidak tertarik → dibuang.
Chip **Terkait** = kemiripan murni (`0.7·sim + 0.3·cowatch`, ambang sim ≥ 0.15 atau cowatch ≥ 0.1), **Dari <channel>** tetap.
Tamu tanpa histori: suku P/S = 0 (tetap relevan lewat konten + co-watch dari penonton lain).

## 6. Perubahan teknis
- **Migrasi `005_recommend.sql`**: `watch_history` + `max_position_sec`, `plays`, `first_watched_at`; tabel
  `guest_watch` (PK guest_hash+video_id, kolom sama, FK video CASCADE, indeks waktu); tabel `rec_feedback`
  (user_id/guest_hash, video_id, kind `not_interested`, unik per pemilik+video).
- **`POST /api/progress`**: juga untuk tamu (buat `dv_gid` bila belum ada) → `guest_watch`; field opsional
  `start: true` menambah `plays`; `max_position_sec = GREATEST(...)`.
- **`GET /api/feed?sort=for_you|latest|popular&seed&category&cursor`** (default `for_you`; kursor = offset).
- **`GET /api/videos/:id/related?seed=`** — personal untuk filter `all`.
- **`POST /api/recommend/not-interested {videoId}`**, **`DELETE /api/recommend/not-interested/:videoId`** (urungkan).
- **`DELETE /api/recommend/guest-history[/:videoId]`** — dipanggil saat tamu menghapus histori perangkatnya.
- Modul baru `server/src/modules/recommend/`: `features.ts` (murni: token, stopword ID/EN, IDF, episode, vektor,
  cosine), `rank.ts` (murni: PRNG, skor beranda/terkait, keragaman, eksplorasi), `catalog.ts` (katalog + co-watch +
  tren dari DB, cache 2 mnt / 20 mnt, single-flight), `profile.ts` (histori + feedback viewer), `routes.ts`.
  `relatedScore`/`seededJitter` lama dihapus.
- Pemeliharaan per jam: hapus `guest_watch` > 180 hari & `rec_feedback` tamu > 400 hari.
- Frontend: beranda dengan seed per entri riwayat navigasi (`location.key`) + chip Terbaru; halaman tonton mengirim
  seed per tayangan; histori tamu dikirim ke server (tetap juga di localStorage untuk halaman Histori & resume);
  menu kartu **Tidak tertarik** (beranda & kolom kanan) → kartu diganti "Video dihapus dari rekomendasi · URUNGKAN";
  hapus histori tamu ikut menghapus di server.

## 7. Uji & kriteria terima
- Unit test: tokenisasi/stopword, parser episode, IDF (fitur yang dimiliki semua video ≈ 0), cosine, seed sama →
  urutan sama & seed beda → urutan beda, cold start memunculkan awal seri, keragaman (≤ 2 klaster sama per 6 slot bila
  ada alternatif), episode berikutnya di urutan 1 kolom kanan, video tidak tertarik tidak muncul, video selesai ditonton
  turun, profil seri A → beranda didominasi seri A tapi tetap ada eksplorasi.
- Instance uji (fake Drive): tamu tanpa histori → beranda berganti urutan antar seed; tamu menonton seri X → beranda &
  kolom kanan condong ke X; Tidak tertarik + urungkan; hapus histori tamu → kembali cold start; video privat tidak
  pernah muncul (security-test tetap lulus).
- Produksi: beranda dibuka 2× → urutan berbeda; tombol Kembali → urutan sama; waktu respons `/api/feed` < 100 ms.

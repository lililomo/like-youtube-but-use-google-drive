# PRD — GDrive Tube (YouTube-like Video Platform berbasis Google Drive)

> Nama aplikasi bawaan **GDrive Tube** — dapat diganti admin (Studio → Pengaturan → Situs). "Dymas Video" tetap dipakai sebagai nama kode proyek/infrastruktur (domain, project aaPanel `video_dymas`, folder Drive `_dymasvideo_system`).

> Versi dokumen: 1.0 · Tanggal: 2026-10-02 · Domain: `https://video.dymas.cloud`
> Dokumen terkait: [SPEC.md](SPEC.md) (spesifikasi teknis) · [PROMPT.md](PROMPT.md) (langkah eksekusi) · [CLAUDE.md](CLAUDE.md) (catatan konfigurasi & progres)

---

## 1. Ringkasan

Aplikasi web pemutar video yang **tampilan dan rasanya meniru YouTube** (layout, warna, tipografi, jarak, animasi, perilaku pemutar), dengan sumber video **satu folder Google Drive**. Semua video di folder tersebut (termasuk subfolder) otomatis muncul di aplikasi, dengan **judul = nama file tanpa ekstensi**.

Tidak ada komentar, deskripsi, like/dislike, subscribe. Halaman tonton hanya berisi **pemutar + judul + info singkat + tombol Simpan/Bagikan + daftar rekomendasi**.

Ada tiga jenis pengunjung:
- **Admin** — login, membuat/mengelola user, mengatur integrasi Google Drive dan pengaturan situs.
- **User** — dibuat oleh admin, bisa upload video (langsung masuk ke Google Drive) dengan status **Publik/Privat**, dan membuat playlist **Publik/Privat**.
- **Tamu (tidak login)** — bisa menonton video publik, melihat playlist publik, dan **membuat playlist sendiri** (tersimpan di perangkat/browser tersebut).

---

## 2. Tujuan & Non-Tujuan

### Tujuan
1. Tampilan nyaris identik dengan YouTube (desktop & mobile, tema gelap & terang).
2. Folder Google Drive menjadi "sumber kebenaran" video: tambah/hapus/rename file di Drive → otomatis tercermin di aplikasi.
3. Pemutar video custom yang ringan, robust, dan berperilaku seperti pemutar YouTube (double-tap seek, auto-landscape, kualitas, subtitle, shortcut keyboard, autoplay berikutnya, dll).
4. User dapat upload video besar dengan andal (resumable, tahan putus koneksi) langsung ke Drive.
5. Admin dapat mengikat kredensial Google Drive dari halaman pengaturan, tanpa menyentuh server.
6. Deploy dan konfigurasi mengikuti cara aaPanel (Node Project, Database, SSL, Nginx vhost).

### Non-Tujuan
- Komentar, deskripsi, like, subscribe, notifikasi, Shorts, live streaming, monetisasi.
- Registrasi mandiri user (user hanya dibuat oleh admin).
- Login dengan Google untuk user (login hanya username + password).
- Caption otomatis / terjemahan otomatis / dubbing (tidak mungkin dengan file Drive).

---

## 3. Peran & Hak Akses

| Kemampuan | Tamu | User | Admin |
|---|:-:|:-:|:-:|
| Menonton video **publik** | ✅ | ✅ | ✅ |
| Menonton video **privat** | ❌ | Hanya miliknya | ✅ semua (moderasi) |
| Pencarian, kategori, rekomendasi | ✅ | ✅ | ✅ |
| Membuat playlist | ✅ (tersimpan di perangkat ini, selalu privat) | ✅ Publik/Privat | ✅ Publik/Privat |
| Melihat playlist publik orang lain | ✅ | ✅ | ✅ |
| Upload video | ❌ | ✅ | ✅ |
| Mengubah judul/visibilitas/menghapus video | ❌ | Video miliknya | Semua video |
| Histori & lanjutkan menonton | ✅ (di perangkat) | ✅ (tersimpan di akun) | ✅ |
| Membuat/mengelola user | ❌ | ❌ | ✅ |
| Pengaturan Google Drive & situs | ❌ | ❌ | ✅ |

Akun admin awal: **username `admin`**, password awal disimpan di `.env` server (`ADMIN_INITIAL_PASSWORD`), tidak dicatat di repo (dibuat oleh seeder; bisa diganti dari halaman akun).

---

## 4. Penyempurnaan dari Permintaan Awal

Tabel ini menjelaskan bagaimana permintaan awal diterjemahkan menjadi keputusan produk. **Silakan ubah bagian ini sebelum eksekusi bila ada yang tidak sesuai** — SPEC.md dan PROMPT.md mengikuti keputusan di sini.

| # | Permintaan awal | Keputusan / penyempurnaan |
|---|---|---|
| 1 | "Persis banget dengan YouTube, ambil langsung temanya" | Tata letak, warna, ukuran, font (Roboto), ikon gaya Material, animasi, teks Bahasa Indonesia ala YouTube, tema gelap/terang direplikasi secara presisi (design token di SPEC §15). **Yang tidak disalin:** logo, nama "YouTube", dan file kode/CSS milik YouTube (merek dagang & hak cipta; CSS YouTube juga terikat framework internal mereka). Nama aplikasi default **"GDrive Tube"**; nama, logo (termasuk varian tema gelap) & favicon bisa diganti admin kapan saja tanpa deploy ulang. Hasil visual tetap hampir identik. |
| 2 | Video dari satu folder Google Drive, judul = nama file | Sinkronisasi otomatis (incremental tiap 60 detik + rekonsiliasi penuh tiap 6 jam + tombol "Sinkronkan sekarang"). Judul = nama file tanpa ekstensi terakhir. **Subfolder menjadi kategori** (muncul sebagai chip di atas beranda, seperti chip YouTube). Rename file di Drive → judul ikut berubah. File dihapus/dipindah keluar dari folder → video hilang dari aplikasi. |
| 3 | "Binding API key Google Drive di setting admin" | **API key biasa tidak cukup**: API key hanya bisa membaca file yang dibagikan publik dan **tidak bisa upload**. Maka pengaturan admin memakai **OAuth Client ID + Client Secret** lalu tombol **"Hubungkan Google Drive"** (sekali klik, token disimpan terenkripsi). Alternatif: **Service Account JSON** (hanya untuk Shared Drive Google Workspace). Panduan pembuatan kredensial ditampilkan langsung di halaman pengaturan. |
| 4 | Video tidak boleh bocor | File Drive **tidak perlu dibagikan publik**. Semua streaming lewat server (proxy dengan dukungan Range/seek) memakai URL bertanda tangan (signed URL, kedaluwarsa). Video privat dicek kepemilikannya di setiap request. |
| 5 | Upload user langsung masuk Drive | Upload **terpotong (chunked) & dapat dilanjutkan** (resumable) melalui server ke Drive. File masuk ke folder utama (atau subfolder kategori yang dipilih saat upload). Kepemilikan dicatat di database **dan** di metadata file Drive (`appProperties`) agar bisa dipulihkan. |
| 6 | Video privat hanya muncul & bisa diputar pemiliknya | Diterapkan di semua tempat: beranda, pencarian, rekomendasi, channel, playlist, streaming, thumbnail URL acak. Admin tetap bisa melihat (moderasi). |
| 7 | Siapapun bisa buat playlist, tamu juga | Tamu: playlist disimpan di server dan terikat ke cookie perangkat (anonim, ±400 hari), **selalu privat** untuk perangkat itu. Saat tamu kemudian login, aplikasi menawarkan **"Pindahkan playlist perangkat ini ke akun"**. User: playlist Publik/Privat; playlist publik tampil untuk semua orang (termasuk tamu) di halaman "Jelajahi Playlist" dan channel pemiliknya. |
| 8 | Video privat di playlist publik | Video yang tidak boleh dilihat oleh penonton otomatis disembunyikan dari playlist (dengan keterangan "1 video tidak tersedia disembunyikan", seperti YouTube). |
| 9 | Kualitas video "jika memang ada" | Google Drive API hanya memberikan file asli. Maka server membuat **versi kualitas tambahan dengan ffmpeg** (default 720p & 360p, bisa diatur) dan menyimpannya di subfolder sistem Drive (`_dymasvideo_system`). Menu kualitas: **Otomatis**, kualitas asli (mis. 1080p HD), 720p, 360p. Video yang formatnya tidak bisa diputar browser (mis. MKV/HEVC/AVI) otomatis dibuatkan versi MP4 H.264 yang kompatibel. |
| 10 | Subtitle "jika ada" | Subtitle diambil otomatis dari file `.srt`/`.vtt` di Drive yang namanya sama dengan video, mis. `Judul.srt`, `Judul.id.srt`, `Judul.en.vtt`. User juga bisa menambah subtitle saat/ setelah upload. SRT dikonversi ke WebVTT otomatis. |
| 11 | Pemutar robust mirip YouTube | Pemutar dibuat sendiri (tanpa library pemutar berat): double-tap/klik kanan-kiri ±10 detik (akumulatif 20/30 detik), auto-landscape saat fullscreen di HP (portrait untuk video vertikal), tahan tekan = kecepatan 2x, prev/next, volume, kecepatan, kualitas, subtitle, mode bioskop, fullscreen, PiP, preview gambar saat hover progress bar (storyboard), shortcut keyboard YouTube, kontrol di lock screen HP (Media Session), lanjutkan dari posisi terakhir, autoplay video berikutnya dengan hitung mundur, pemulihan otomatis jika koneksi putus. |
| 12 | Tidak ada komentar/deskripsi | Halaman tonton: pemutar, judul, baris channel (avatar + nama + jumlah ditonton + waktu), tombol **Simpan** & **Bagikan** (+ menu pemilik: ubah visibilitas). Kolom kanan: rekomendasi (atau panel playlist jika menonton dari playlist). |
| 13 | Platform bebas dipilih | **Node.js 24 (aaPanel Node Project)** + **Fastify** (backend) + **React + Vite** (frontend SPA) + **MariaDB/MySQL** + **ffmpeg**. Alasan: streaming proxy & upload besar paling efisien di Node (non-blocking, stream/backpressure), dan SPA memungkinkan perpindahan halaman instan seperti YouTube. |
| 14 | DB `dummy/dummy/dummy` | Dipakai persis seperti itu (dibuat lewat aaPanel bila belum ada). Catatan: password `dummy` lemah — disarankan diganti setelah aplikasi berjalan (cukup ubah `.env`). |
| 15 | Semua konfigurasi dicatat di CLAUDE.md | Setiap langkah eksekusi wajib memperbarui CLAUDE.md (bagian konfigurasi, progres, dan changelog). |

---

## 5. Fitur

Prioritas: **P0** = wajib untuk rilis, **P1** = sangat diharapkan (masuk rilis), **P2** = nanti/opsional.

### 5.1 Tampilan & Navigasi (YouTube look-and-feel)
- **P0** Masthead 56px: tombol menu (hamburger), logo, kotak "Telusuri" di tengah dengan tombol cari, di kanan: tombol Upload (ikon kamera +, khusus user login), avatar/menu akun atau tombol **"Login"** (pill biru bergaris seperti tombol "Login" YouTube).
- **P0** Sidebar "guide" 240px (Beranda, Jelajahi Playlist, bagian **Anda**: Histori, Playlist, Video Anda; bagian **Kategori**: daftar subfolder; bagian admin: Panel Admin). Mini-guide 72px pada lebar menengah. Drawer overlay di halaman tonton & layar kecil. Perilaku breakpoint sama seperti YouTube.
- **P0** Mobile (<656px): masthead mobile, **bottom navigation** (Beranda, Upload, Anda), kartu video full-width.
- **P0** Tema **Gelap / Terang / Ikuti perangkat**, dapat dipilih di menu akun (tamu juga bisa).
- **P0** Skeleton loading (kotak abu-abu berkilau) dan **progress bar merah tipis** di atas halaman saat berpindah halaman.
- **P0** Kartu video: thumbnail 16:9 sudut 12px, badge durasi, avatar channel, judul 2 baris, "nama channel", "1,2 rb x ditonton · 3 hari yang lalu", menu titik tiga (Simpan ke playlist, Bagikan). Bar merah progres tonton di bawah thumbnail jika pernah ditonton.
- **P0** Format angka & waktu Indonesia ala YouTube: "1,2 rb x ditonton", "5 jt x ditonton", "2 minggu yang lalu".
- **P1** Saran pencarian (dropdown di bawah kotak cari) + riwayat pencarian lokal yang bisa dihapus. Shortcut `/` untuk fokus ke pencarian.
- **P1** Snackbar (toast) kiri bawah: "Disimpan ke …", "Link disalin".
- **P2** Preview storyboard animasi saat hover thumbnail.

### 5.2 Sumber Video: Google Drive
- **P0** Admin mengisi kredensial & menghubungkan akun Google, lalu memasukkan **URL atau ID folder** Drive. Aplikasi memvalidasi folder dan menampilkan nama folder + jumlah video.
- **P0** Sinkronisasi: semua file video (mp4, m4v, mov, mkv, webm, avi, wmv, flv, ts, mts, m2ts, 3gp, mpg, mpeg, ogv) di folder & subfolder → masuk aplikasi. Judul = nama file tanpa ekstensi.
- **P0** Incremental sync (Google Drive Changes API) tiap 60 detik, full reconcile tiap 6 jam, tombol manual di admin.
- **P0** Subfolder = kategori (chip di beranda + daftar di sidebar). Folder yang diawali `_` atau `.` diabaikan.
- **P0** Video yang langsung diletakkan di Drive (bukan lewat upload aplikasi) dianggap milik **channel utama** (nama situs) dan **publik**. Admin bisa mengubah visibilitasnya.
- **P0** Subtitle `.srt/.vtt` dengan nama yang cocok otomatis terpasang.
- **P0** Thumbnail otomatis (dipilih dari beberapa frame, menghindari frame hitam), durasi & resolusi dibaca otomatis.
- **P1** Versi kualitas tambahan (720p/360p default) & versi kompatibel untuk format yang tidak didukung browser.
- **P1** Storyboard (gambar preview saat hover progress bar).

### 5.3 Halaman
| Halaman | URL | Isi | Prioritas |
|---|---|---|---|
| Beranda | `/` | Chip kategori ("Semua", "Terbaru", "Populer", kategori…), grid video, infinite scroll | P0 |
| Tonton | `/watch?v=ID[&list=PL…][&t=90]` | Pemutar, judul, info, Simpan/Bagikan, rekomendasi / panel playlist | P0 |
| Hasil pencarian | `/results?search_query=…` | Daftar video horizontal ala YouTube (thumbnail besar kiri) + playlist publik yang cocok | P0 |
| Kategori | `/?category=slug` (chip) | Grid video kategori | P0 |
| Playlist | `/playlist?list=PL…` | Panel kiri (sampul, judul, pemilik, jumlah video, tombol Putar semua / Acak), daftar video yang bisa diurutkan (drag) oleh pemilik | P0 |
| Jelajahi Playlist | `/feed/playlists/public` | Grid playlist publik | P0 |
| Playlist saya | `/feed/playlists` | Playlist milik user/perangkat | P0 |
| Anda | `/feed/you` | Ringkasan: Histori terbaru, Playlist, Video Anda | P1 |
| Histori | `/feed/history` | Riwayat tonton (hapus satu / hapus semua) | P1 |
| Channel | `/@username` | Header channel sederhana + tab Video & Playlist publik | P1 |
| Video Anda | `/my/videos` | Tabel ala YouTube Studio: thumbnail, judul, visibilitas (dropdown), tanggal, ditonton, status proses, aksi ubah judul/hapus/subtitle | P0 |
| Login | `/login` | Kartu login (username, password, "Ingat saya"); tanpa link daftar | P0 |
| Akun | `/account` | Ubah **foto profil** (upload/ganti/hapus), nama tampilan, warna avatar (bila tanpa foto), password | P0 (foto profil) / P1 |
| Panel Admin | `/admin/*` | Lihat §5.7 | P0 |
| 404 | `*` | Halaman "Halaman ini tidak tersedia" gaya YouTube | P0 |

### 5.4 Pemutar Video
Semua **P0** kecuali disebut lain.
- Kontrol bawah (desktop): Putar/Jeda, Sebelumnya (jika ada), Berikutnya, Volume (slider muncul saat hover), waktu `0:07 / 3:45`; kanan: toggle **Putar otomatis**, **CC**, **Setelan** (⚙ dengan badge HD bila ≥720p), **Mode bioskop**, **Layar penuh**.
- Menu Setelan bertingkat: **Subtitel/CC**, **Kecepatan pemutaran** (0.25–2, "Normal"), **Kualitas** ("Otomatis (720p)", 1080p HD, 720p, 480p, 360p).
- Progress bar merah dengan buffer abu-abu, membesar saat hover, titik scrubber, tooltip waktu **+ preview gambar (storyboard)** (P1), drag/scrub dengan mouse & sentuhan.
- Klik = putar/jeda (dengan animasi ikon di tengah). **Double-klik sisi kiri = mundur 10 detik, sisi kanan = maju 10 detik**, tengah = layar penuh.
- Mobile: tap = tampil/sembunyikan kontrol; **double-tap kiri/kanan = ±10 detik**, tap berikutnya terus menambah (20, 30 detik…) dengan animasi gelombang & tulisan "10 detik"; kontrol tengah: Sebelumnya · Putar/Jeda · Berikutnya.
- **Tahan tekan (mobile) / tahan klik (desktop) = kecepatan 2x** sementara, indikator "2x ▸▸" di atas.
- **Layar penuh di HP otomatis memutar layar ke landscape** (video vertikal tetap portrait); keluar layar penuh → orientasi kembali. Memutar HP ke landscape saat menonton → mencoba masuk layar penuh (best effort, tergantung browser). iPhone memakai pemutar layar penuh bawaan iOS (keterbatasan iOS).
- Shortcut keyboard YouTube: `Spasi/K` putar-jeda, `J/L` ±10 dtk, `←/→` ±5 dtk, `↑/↓` volume, `M` bisu, `F` layar penuh, `T` mode bioskop, `C` subtitle, `0–9` lompat ke 0–90%, `Home/End`, `Shift+N` berikutnya, `Shift+P` sebelumnya, `Shift+>`/`Shift+<` kecepatan, `,`/`.` frame-per-frame saat dijeda.
- Indikator volume/kecepatan/seek di tengah (overlay sementara), spinner buffering.
- **Putar otomatis**: saat video selesai, overlay "Berikutnya dalam 5" dengan thumbnail & tombol Batal/Putar sekarang. Dalam playlist: lanjut ke item berikutnya (dukung Ulangi & Acak playlist — P1).
- **Lanjutkan menonton**: mulai dari posisi terakhir (jika >30 dtk dan belum hampir selesai). Parameter `&t=` mengalahkan posisi tersimpan.
- **Media Session**: judul & thumbnail di notifikasi/lock screen HP, tombol play/pause/next/prev/seek.
- **Wake Lock**: layar HP tidak mati saat video diputar (P1).
- **Picture-in-Picture** (P1) dan menu klik-kanan custom: Ulangi (loop), Salin URL video, Salin URL pada waktu saat ini, Statistik (resolusi, buffer, kecepatan) (P2).
- Preferensi tersimpan: volume, bisu, kualitas, putar otomatis, subtitle & bahasanya.
- **Robust**: retry otomatis saat jaringan putus/stall (melanjutkan dari detik yang sama), URL stream diperbarui otomatis bila kedaluwarsa, fallback ke versi kompatibel bila format asli gagal diputar, ganti kualitas tanpa layar hitam (frame terakhir dipertahankan).
- **Ringan**: tanpa library pemutar pihak ketiga; target ukuran kode pemutar ≤ 35 KB (gzip).
- **P2** Miniplayer (video tetap berjalan di pojok saat berpindah halaman), timer tidur.

### 5.5 Upload & Visibilitas (User & Admin)
- **P0** Dialog upload ala YouTube: area "Tarik lalu lepas file video", tombol **PILIH FILE**, multi-file.
- **P0** Per file: pilih **Visibilitas** (Publik/Privat, dengan penjelasan), **Kategori** (folder tujuan; default folder utama), lampiran subtitle opsional.
- **P0** Upload terpotong 16 MB per bagian, dilanjutkan otomatis bila koneksi putus, dapat dibatalkan; progres global di pojok kanan bawah tetap tampil saat berpindah halaman. Peringatan saat menutup tab ketika upload berjalan.
- **P0** Setelah selesai: video langsung muncul di **Video Anda** dengan status "Memproses…" lalu "Siap" setelah thumbnail & metadata dibuat.
- **P0** Ubah visibilitas kapan saja dari Video Anda / halaman tonton. Ubah judul (mengganti nama file di Drive juga). Hapus (memindahkan file ke Trash Drive).
- **P1** Kuota penyimpanan per user (diatur admin; default tanpa batas) dan batas ukuran file (default 10 GB).

### 5.6 Playlist
- **P0** Tombol **Simpan** (halaman tonton & menu kartu) → dialog "Simpan video ke…" berisi checkbox playlist + "Buat playlist baru" (nama + visibilitas; tamu tanpa pilihan visibilitas).
- **P0** Halaman playlist: putar semua, acak, hapus item, urutkan ulang (drag & drop), ubah judul/visibilitas, hapus playlist.
- **P0** Menonton dari playlist: panel playlist di kolom kanan (item aktif disorot, posisi "3 / 12"), next/prev mengikuti playlist; tombol Ulangi & Acak (P1).
- **P0** Playlist publik tampil untuk semua orang; playlist privat hanya pemilik; playlist tamu hanya di perangkat pembuatnya.
- **P1** Impor playlist tamu ke akun setelah login.
- **P2** "Tonton nanti" sebagai playlist khusus.

### 5.7 Panel Admin (gaya YouTube Studio)
- **P0 Dasbor**: jumlah video (publik/privat/proses/gagal), total ukuran, jumlah user & playlist, status koneksi Drive, waktu sinkronisasi terakhir, antrean pemrosesan, sisa disk server, video terpopuler, upload terbaru.
- **P0 Pengguna**: buat user (username, nama tampilan, password, kuota), ubah, nonaktifkan, reset password, hapus (pilih: hapus videonya dari Drive atau alihkan ke channel utama).
- **P0 Video**: semua video (filter status/visibilitas/pemilik/kategori, cari), ubah visibilitas/judul/kategori, proses ulang, hapus; aksi massal.
- **P0 Playlist**: daftar semua playlist, ubah visibilitas, hapus.
- **P0 Pengaturan → Google Drive**: mode autentikasi (OAuth / Service Account), Client ID, Client Secret, Redirect URI (ditampilkan untuk disalin), tombol Hubungkan/Putuskan, akun terhubung, folder sumber (URL/ID), sertakan subfolder, interval sinkron, tombol Tes koneksi & Sinkronkan sekarang, panduan langkah demi langkah.
- **P0 Pengaturan → Situs**: **nama aplikasi** (default "GDrive Tube"), **logo** (mode ikon + nama atau gambar penuh, varian tema gelap opsional) & **favicon** dengan pratinjau langsung, nama & handle channel utama, tema default, izinkan playlist tamu. Perubahan langsung berlaku (masthead, `<title>`, OG meta, favicon) tanpa restart.
- **P1 Pengaturan → Pemrosesan**: aktif/nonaktif, daftar kualitas, preset kecepatan encode, jumlah thread, minimal sisa disk.
- **P1 Pengaturan → Upload**: aktif/nonaktif, ukuran maksimal, ekstensi yang diizinkan, visibilitas default, kuota default.
- **P1 Antrean Pemrosesan**: daftar job (menunggu/berjalan/gagal), retry, hapus, log error.
- **P1 Log Aktivitas**: login, perubahan pengaturan, aksi admin.

---

## 6. Aturan Visibilitas (normatif)

1. Video **publik** dengan status *siap* → terlihat & dapat diputar semua orang.
2. Video **privat** → hanya **pemilik** dan **admin** yang melihatnya di daftar apa pun dan dapat memutarnya. Untuk orang lain, URL tonton menampilkan "Video tidak tersedia" (tidak membocorkan judul).
3. Video yang masih *memproses* hanya terlihat oleh pemilik/admin (di Video Anda/admin), kecuali file asli sudah bisa diputar (langsung siap).
4. Video *hilang/terhapus* dari Drive → tidak tampil di mana pun; tetap tercatat (soft delete) untuk mempertahankan histori admin.
5. Playlist **publik** → terlihat semua orang; item yang tidak boleh dilihat penonton disembunyikan.
6. Playlist **privat** → hanya pemilik (user) atau perangkat pembuat (tamu).
7. File di Google Drive **tidak pernah perlu dibagikan publik**; semua akses lewat server.

---

## 7. Alur Pengguna Utama

1. **Setup awal (admin)**: Login `admin` → Pengaturan → Google Drive → isi Client ID/Secret (ikuti panduan) → "Hubungkan Google Drive" → izinkan di Google → tempel URL folder → "Simpan & Sinkronkan" → video mulai muncul (thumbnail menyusul beberapa detik/menit).
2. **Tamu menonton**: buka beranda → klik video → menonton; double-tap untuk seek; fullscreen di HP otomatis landscape; selesai → autoplay video berikutnya.
3. **Tamu membuat playlist**: klik Simpan → Buat playlist baru → beri nama → video tersimpan; playlist terlihat di "Playlist" sidebar (hanya di perangkat itu).
4. **Admin membuat user**: Admin → Pengguna → Tambah → isi username/password → beri tahu user.
5. **User upload**: Login → tombol Upload → pilih file → pilih Privat → upload berjalan (bisa pindah halaman) → selesai → status Memproses → Siap → hanya user itu (dan admin) yang melihatnya.
6. **User membuat playlist publik**: Simpan → Buat playlist baru → Publik → playlist muncul di Jelajahi Playlist untuk semua orang.

---

## 8. Persyaratan Non-Fungsional

| Area | Target |
|---|---|
| Performa halaman | LCP beranda < 2,5 dtk di 4G; JS awal ≤ 170 KB gzip; kode pemutar ≤ 35 KB gzip; panel admin di-lazy-load |
| Mulai putar | < 1,5 dtk (koneksi 20 Mbps, 720p) dari klik sampai frame pertama |
| API | p95 < 200 ms untuk feed/pencarian dengan 10.000 video |
| Skalabilitas | Hingga ±50.000 video & ratusan penonton bersamaan (dibatasi bandwidth server & kuota Drive) |
| Keamanan | Password argon2id; sesi httpOnly+Secure; proteksi CSRF; rate-limit login; rahasia (token Drive) terenkripsi AES-256-GCM; signed URL streaming; header keamanan (CSP, HSTS) |
| Kompatibilitas | Chrome/Edge/Firefox/Safari 2 versi terakhir, Android Chrome, iOS Safari 16+ |
| Ketahanan | Upload dilanjutkan setelah putus; streaming retry otomatis; job pemrosesan dilanjutkan setelah restart; sinkronisasi tidak menghapus data bila API Drive error |
| Operasional | Dikelola lewat aaPanel (Node Project, Database, SSL, log); backup database harian via cron aaPanel |
| Bahasa | Antarmuka Bahasa Indonesia |

---

## 9. Batasan & Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kuota/bandwidth Google Drive API (download per hari, rate limit) | Video gagal diputar saat ramai | Proxy dengan retry/backoff, koneksi keep-alive, kualitas rendah (360p) untuk koneksi lambat; opsi cache disk lokal (P2) |
| Semua streaming lewat server | Bandwidth server terpakai 1:1 | Diperlukan agar video privat aman & file Drive tidak dibagikan publik; dokumentasikan pemakaian bandwidth di dasbor |
| Token OAuth kedaluwarsa tiap 7 hari jika aplikasi Google masih status "Testing" | Sinkron & streaming berhenti | Panduan mewajibkan status **"In production"** di OAuth consent screen (aman untuk pemakaian pribadi; muncul layar "aplikasi belum diverifikasi" sekali saat menghubungkan) |
| Service Account tidak punya kuota penyimpanan di My Drive | Upload gagal | Mode Service Account hanya untuk **Shared Drive**; default memakai OAuth |
| Transcoding memakan CPU & disk | Server lain melambat | Antrean 1 job, `nice`, batas thread, cek sisa disk minimal, bisa dinonaktifkan |
| iOS iPhone tidak mengizinkan fullscreen elemen custom & kunci orientasi | Kontrol custom tidak tampil di fullscreen iPhone | Pakai fullscreen bawaan iOS (otomatis rotasi); di iPad/Android pakai kontrol custom |
| Kemiripan dengan YouTube | Isu merek dagang | Tidak memakai logo/nama YouTube; nama & logo bisa diatur |
| Format video eksotis/rusak | Gagal diputar | ffprobe validasi; status "Gagal" + log di admin; versi kompatibel dibuat otomatis |

---

## 10. Kriteria Penerimaan (ringkas)

1. `https://video.dymas.cloud` dapat diakses dengan SSL valid, terdaftar sebagai Node Project di aaPanel, database `dummy` terlihat di menu Database aaPanel.
2. Login `admin` dengan password awal berhasil; admin bisa membuat user.
3. Setelah Drive dihubungkan & folder diisi, semua video di folder (dan subfolder) tampil dengan judul = nama file, lengkap dengan thumbnail & durasi; file baru di Drive muncul ≤ 2 menit tanpa tindakan manual.
4. Video bisa diputar & di-seek ke posisi mana pun tanpa mengunduh seluruh file; semua fitur pemutar §5.4 P0 berfungsi di desktop Chrome, Android Chrome, dan iOS Safari (dengan batasan iOS).
5. User upload video 2 GB, koneksi diputus di tengah, upload berlanjut; file muncul di folder Drive; status privat dihormati (tidak terlihat oleh tamu/user lain, URL langsung menolak).
6. Tamu bisa membuat playlist; user bisa membuat playlist publik yang terlihat oleh tamu.
7. Perbandingan screenshot berdampingan dengan YouTube (beranda, tonton, pencarian, playlist; desktop & mobile; gelap & terang) menunjukkan tata letak, jarak, ukuran font, dan warna yang setara.
8. CLAUDE.md berisi semua konfigurasi aktual (port, path, nama project aaPanel, lokasi log, perintah deploy, pengaturan nginx tambahan).

---

## 11. Di Luar Cakupan (rilis ini)
Komentar, deskripsi, like/dislike, subscribe, notifikasi, Shorts, live, iklan, analitik detail per video, multi-folder Drive, multi-akun Drive, aplikasi mobile native, email/reset password mandiri (reset dilakukan admin).

# GDrive Tube

Platform video bergaya YouTube yang membaca video dari **satu folder Google Drive**. Nama aplikasi, logo dan favicon diatur dari panel admin (bawaan: "GDrive Tube"). Kode proyek/infrastruktur memakai nama *Dymas Video* (`video_dymas`).

- Situs: **https://video.dymas.cloud**
- Panel admin (Studio): https://video.dymas.cloud/admin
- Dokumen: [PRD.md](PRD.md) (produk) · [SPEC.md](SPEC.md) (teknis) · [PROMPT.md](PROMPT.md) (langkah build) · [CLAUDE.md](CLAUDE.md) (konfigurasi aktual & operasional) · [SERVER-TODO.md](SERVER-TODO.md) (konfigurasi server yang belum diterapkan)

## Panduan singkat pemilik

### Akun admin
- Username **`admin`**. Password awal = `ADMIN_INITIAL_PASSWORD` di file `.env` server (tidak pernah disimpan di repo ini).
- **Segera ganti** setelah login pertama: menu akun → *Akun Anda* → Password.
- Lupa password admin dan tidak ada admin lain → lihat *Troubleshooting* di CLAUDE.md (reset lewat server).

### Menambah video
1. **Lewat Google Drive (channel utama):** taruh file video di folder sumber Drive (saat ini "Dymas Tube"). Subfolder menjadi **kategori**; folder yang diawali `_` atau `.` diabaikan. Subtitle `.srt`/`.vtt` dengan nama sama (mis. `Judul.mp4` + `Judul.id.srt`) terpasang otomatis. Video muncul ≤ ±1–2 menit (sinkron otomatis) atau tekan **Sinkronkan sekarang** di Dasbor. Judul = nama file tanpa ekstensi.
2. **Lewat aplikasi (user login):** tombol **Upload** di kanan atas → pilih file → pilih Publik/Privat & kategori. Upload bisa ditinggal pindah halaman dan dilanjutkan bila koneksi putus. File tersimpan di folder Drive yang sama.
3. Setelah masuk, server membuat thumbnail, durasi, storyboard dan versi kualitas lain (720p/360p, versi kompatibel untuk format yang tidak didukung browser). Status terlihat di *Video Anda* / Studio → Antrean.

### Membuat user
Studio → **Pengguna** → *Tambah pengguna* → isi username & nama tampilan (password acak dibuat dan otomatis disalin) → kirim username + password ke orangnya. Tidak ada pendaftaran mandiri; reset password dilakukan admin.

### Mengganti nama aplikasi, logo, favicon
Studio → Pengaturan → **Situs**. Perubahan langsung berlaku tanpa restart.

### Hal yang perlu diperhatikan
- **Bandwidth:** semua video dialirkan lewat server (Drive → server → penonton), jadi pemakaian bandwidth server ≈ total yang ditonton. File Drive tidak perlu dibagikan publik.
- **Kuota Google Drive API:** Google membatasi unduhan per file per hari. Video yang sangat ramai bisa sementara gagal diputar; versi 360p/720p membantu karena lebih kecil.
- **Aplikasi OAuth Google harus berstatus "In production"** (bukan "Testing"), kalau tidak koneksi Drive putus tiap 7 hari.
- **Ganti password database** `dummy` (masih default) lewat aaPanel → Database, lalu ubah `DB_PASSWORD` di `.env` dan restart aplikasi.
- **Jangan ubah `APP_KEY`** di `.env` setelah ada data (dipakai mengenkripsi token Drive). Salinannya ada di `/root/backup/video_dymas.env`.
- **Disk server:** konversi video berhenti sementara bila sisa disk di bawah batas (Studio → Pengaturan → Pemrosesan). Dasbor menampilkan sisa disk.
- Di UI aaPanel **jangan klik "Install modules"** untuk project ini (menghapus `package-lock.json`).

## Pengembang
```bash
npm ci && npm test && npm run build      # Node ≥ 24
bash scripts/deploy.sh                   # di server (aaPanel)
bash scripts/pull-deploy.sh <branch>     # di server: tarik dari GitHub lalu deploy
bash scripts/smoke.sh                    # smoke test produksi
```
Perubahan yang ditulis di luar server dicatat di SERVER-TODO.md agar Claude di server menerapkan konfigurasi yang dibutuhkan.

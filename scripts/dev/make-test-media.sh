#!/usr/bin/env bash
# Membuat folder media uji (video sintetis ffmpeg + subtitle) untuk fake-drive.
# Pemakaian: bash scripts/dev/make-test-media.sh /root/dv-qa/media-src
set -euo pipefail
OUT=${1:-/root/dv-qa/media-src}
rm -rf "$OUT"; mkdir -p "$OUT/Musik/Live" "$OUT/_abaikan" "$OUT/Edukasi"
F="ffmpeg -hide_banner -loglevel error -y"
AUD="-f lavfi -i sine=frequency=440:sample_rate=48000"

$F -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=30" $AUD -t 30 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$OUT/Video Uji H264.mp4"
$F -f lavfi -i "mandelbrot=size=1920x1080:rate=30" $AUD -t 20 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart "$OUT/Pemandangan_Kota.1080p.mp4"
$F -f lavfi -i "testsrc=size=1280x720:rate=25:duration=12" $AUD -t 12 -c:v libx265 -preset ultrafast -pix_fmt yuv420p -c:a aac "$OUT/Film HEVC.mkv"
$F -f lavfi -i "smptebars=size=720x1280:rate=30:duration=10" $AUD -t 10 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart "$OUT/Vertikal HP.mp4"
$F -f lavfi -i "color=c=black:size=640x360:rate=30:duration=4,format=yuv420p[a];color=c=blue:size=640x360:rate=30:duration=11[b];[a][b]concat=n=2:v=1:a=0" $AUD -t 15 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart "$OUT/Musik/Lagu Satu.mp4"
$F -f lavfi -i "testsrc2=size=854x480:rate=30:duration=10" -f lavfi -i "sine=frequency=660:sample_rate=48000" -t 10 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 800k -c:a libopus "$OUT/Musik/Live/Konser.webm"
$F -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=8" $AUD -t 8 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart "$OUT/Edukasi/Belajar Matematika - Bab 1.mp4"
$F -f lavfi -i "testsrc2=size=320x240:rate=15:duration=3" -c:v libx264 -preset veryfast -pix_fmt yuv420p "$OUT/_abaikan/Rahasia.mp4"
echo "catatan bukan video" > "$OUT/catatan.txt"

cat > "$OUT/Musik/Lagu Satu.id.srt" <<'SRT'
1
00:00:01,000 --> 00:00:04,000
Halo, ini subtitle bahasa Indonesia.

2
00:00:05,000 --> 00:00:09,500
{\an8}Baris kedua dengan <i>miring</i>.
SRT
printf 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello, this is an English subtitle.\n\n00:00:05.000 --> 00:00:09.500\nSecond line.\n' > "$OUT/Musik/Lagu Satu.en.vtt"
# Subtitle UTF-16 dengan BOM untuk uji deteksi encoding
printf '1\r\n00:00:00,500 --> 00:00:03,000\r\nTeks uji UTF-16 — é\r\n' | iconv -f UTF-8 -t UTF-16 > "$OUT/Video Uji H264.srt"
ls -laR "$OUT" | grep -vE "^total|^d" | awk '{print $5, $9}'

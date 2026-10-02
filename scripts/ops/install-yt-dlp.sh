#!/usr/bin/env bash
# Pasang yt-dlp (binary mandiri yt-dlp_linux, tanpa Python) untuk Studio → Impor YouTube. Idempoten.
# Lokasi: storage/bin/yt-dlp milik www agar aplikasi bisa memperbaruinya sendiri (`yt-dlp -U`, harian + tombol di admin).
# Pemakaian (root): bash scripts/ops/install-yt-dlp.sh [--force]
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
BIN=$ROOT/storage/bin/yt-dlp
mkdir -p "$(dirname "$BIN")" "$ROOT/storage/cache/yt-dlp" "$ROOT/storage/private"
chmod 700 "$ROOT/storage/private"
if [ ! -x "$BIN" ] || [ "${1:-}" = "--force" ]; then
  curl -fsSL --retry 3 -o "$BIN.tmp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
  chmod 755 "$BIN.tmp"
  mv "$BIN.tmp" "$BIN"
fi
id www >/dev/null 2>&1 && chown -R www:www "$(dirname "$BIN")" "$ROOT/storage/cache/yt-dlp" "$ROOT/storage/private"
echo "yt-dlp $("$BIN" --version) → $BIN"

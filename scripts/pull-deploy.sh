#!/usr/bin/env bash
# Tarik perubahan dari GitHub lalu deploy ke server (dipakai setelah bekerja dari Claude cloud).
# Pemakaian (di server, sebagai root):  bash scripts/pull-deploy.sh [branch]   (default: main)
#   PULL_ONLY=1 bash scripts/pull-deploy.sh [branch]  → tarik kode + tampilkan pengingat saja, tanpa deploy
#   (dipakai Claude di server untuk mengerjakan item "sebelum deploy" di SERVER-TODO.md).
set -euo pipefail

ROOT=/www/wwwroot/video.dymas.cloud
BRANCH=${1:-main}
export PATH=/root/bin:/www/server/nodejs/v24.18.0/bin:$PATH
cd "$ROOT"
git config --global --get-all safe.directory | grep -qx "$ROOT" || git config --global --add safe.directory "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "Ada perubahan lokal yang belum di-commit di server:" >&2
  git status --short >&2
  echo "Commit/push dulu (atau buang) sebelum pull-deploy." >&2
  exit 1
fi

echo "[pull-deploy] fetch origin"
git fetch origin --prune
BEFORE=$(git rev-parse HEAD)
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  git checkout "$BRANCH"
fi
git merge --ff-only "origin/$BRANCH"
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "[pull-deploy] tidak ada commit baru di $BRANCH ($AFTER)"
else
  echo "[pull-deploy] $BEFORE → $AFTER"
  git log --oneline "$BEFORE..$AFTER"
fi

# --- Pengingat konfigurasi server yang tidak dipasang otomatis (lihat SERVER-TODO.md) ---
OPEN=$(grep -E '^### \[ \] ST-[0-9]{3} ' SERVER-TODO.md 2>/dev/null || true)
if [ -n "$OPEN" ]; then
  echo
  echo "[pull-deploy] PERHATIAN: item SERVER-TODO.md yang masih terbuka:"
  echo "$OPEN" | sed 's/^### /  /'
  echo "  Kerjakan item 'sebelum deploy' dulu (lihat protokol di SERVER-TODO.md)."
fi
NGINX_LIVE=/www/server/panel/vhost/rewrite/node_video_dymas.conf
if [ -f "$NGINX_LIVE" ] && ! cmp -s scripts/nginx-custom.conf "$NGINX_LIVE"; then
  echo
  echo "[pull-deploy] PERHATIAN: scripts/nginx-custom.conf berbeda dengan $NGINX_LIVE (tidak dipasang otomatis)."
fi
if [ -f .env ]; then
  MISSING=$(comm -23 <(grep -oE '^[A-Z_]+=' .env.example | sort -u) <(grep -oE '^[A-Z_]+=' .env | sort -u) | tr -d '=' | tr '\n' ' ')
  if [ -n "$MISSING" ]; then
    echo
    echo "[pull-deploy] PERHATIAN: variabel di .env.example yang belum ada di .env: $MISSING"
  fi
fi

if [ "${PULL_ONLY:-0}" = "1" ]; then
  echo
  echo "[pull-deploy] PULL_ONLY=1 → berhenti sebelum deploy. Lanjutkan dengan: bash scripts/deploy.sh"
  exit 0
fi

bash scripts/deploy.sh

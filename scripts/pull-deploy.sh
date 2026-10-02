#!/usr/bin/env bash
# Tarik perubahan dari GitHub lalu deploy ke server (dipakai setelah bekerja dari Claude cloud).
# Pemakaian (di server, sebagai root):  bash scripts/pull-deploy.sh [branch]   (default: main)
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

bash scripts/deploy.sh

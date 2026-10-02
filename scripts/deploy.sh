#!/usr/bin/env bash
# Deploy Dymas Video: install (bila lock berubah) → build → migrate → izin → restart aaPanel → health check.
# Pemakaian: bash scripts/deploy.sh   (env: SKIP_BUILD=1 untuk restart saja)
set -euo pipefail

ROOT=/www/wwwroot/video.dymas.cloud
PROJECT=video_dymas
export PATH=/www/server/nodejs/v24.18.0/bin:$PATH
cd "$ROOT"

log() { printf '\n\033[1;34m[deploy]\033[0m %s\n' "$*"; }

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
  if [ ! -d node_modules ] || [ "$(cat node_modules/.dv-lock-hash 2>/dev/null)" != "$LOCK_HASH" ]; then
    log "npm ci"
    npm ci --no-audit --no-fund
    echo "$LOCK_HASH" > node_modules/.dv-lock-hash
  fi
  log "build"
  npm run build
  if [ -f server/dist/migrate.js ]; then
    log "migrate"
    npm run migrate
  fi
fi

log "izin file"
mkdir -p storage/public/{thumbs,sb,branding} storage/cache/subs storage/tmp
chown -R www:www "$ROOT"
chmod 600 .env

log "restart project aaPanel ($PROJECT)"
python3 scripts/bt-api.py /project/nodejs/restart_project/json "data={\"project_name\":\"$PROJECT\"}" || true

log "health check"
for i in $(seq 1 20); do
  if out=$(curl -fsS --max-time 3 http://127.0.0.1:3210/api/health 2>/dev/null); then
    echo "$out"
    exit 0
  fi
  sleep 1
done
echo "Health check GAGAL. Lihat log: tail -n 50 /www/server/nodejs/vhost/logs/$PROJECT.log" >&2
exit 1

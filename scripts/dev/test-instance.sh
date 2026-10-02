#!/usr/bin/env bash
# Instance uji: fake-drive (port 3298) + aplikasi (port 3299, DB dummy_test) — TIDAK menyentuh produksi.
# Pemakaian:
#   bash scripts/dev/test-instance.sh start [--reseed]   # build harus sudah ada (npm run build)
#   bash scripts/dev/test-instance.sh stop
#   bash scripts/dev/test-instance.sh reset-db            # kosongkan DB uji + storage uji
set -euo pipefail
ROOT=/www/wwwroot/video.dymas.cloud
QA=/root/dv-qa
ENV=$QA/env.test
export PATH=/www/server/nodejs/v24.18.0/bin:$PATH

ensure_env() {
  [ -f "$ENV" ] && return
  cat > "$ENV" <<ENVEOF
NODE_ENV=development
HOST=127.0.0.1
PORT=3299
APP_URL=http://127.0.0.1:3299
TRUST_PROXY=127.0.0.1
DB_HOST=localhost
DB_SOCKET=/tmp/mysql.sock
DB_USER=dummy_test
DB_PASSWORD=$(cat $QA/.dbpass)
DB_NAME=dummy_test
APP_KEY=base64:$(openssl rand -base64 32)
INTERNAL_TOKEN=$(openssl rand -hex 32)
STORAGE_DIR=$QA/storage-test
WEB_DIST_DIR=$ROOT/web/dist
LOG_LEVEL=info
ADMIN_USERNAME=admin
ADMIN_INITIAL_PASSWORD=admin12345
DRIVE_API_BASE=http://127.0.0.1:3298/drive/v3
DRIVE_UPLOAD_BASE=http://127.0.0.1:3298/upload/drive/v3
DRIVE_FAKE_TOKEN=fake-token
SERVE_STATIC=1
ENVEOF
  chmod 600 "$ENV"
}

stop() {
  for p in app fakedrive; do
    if [ -f "$QA/$p.pid" ]; then kill "$(cat $QA/$p.pid)" 2>/dev/null || true; rm -f "$QA/$p.pid"; fi
  done
  sleep 1
}

case "${1:-}" in
  start)
    ensure_env
    stop
    mkdir -p $QA/storage-test/{public/thumbs,public/sb,public/branding,cache/subs,tmp} $QA/fakedrive
    SEED=""
    if [ "${2:-}" = "--reseed" ] || [ ! -f $QA/fakedrive/root-id.txt ]; then
      rm -rf $QA/fakedrive && mkdir -p $QA/fakedrive
      [ -d $QA/media-src ] || bash $ROOT/scripts/dev/make-test-media.sh $QA/media-src >/dev/null
      SEED="--seed $QA/media-src"
    fi
    nohup node $ROOT/scripts/dev/fake-drive.mjs --port 3298 --data $QA/fakedrive $SEED > $QA/fakedrive.log 2>&1 &
    echo $! > $QA/fakedrive.pid
    sleep 1
    DV_ENV_FILE=$ENV node $ROOT/server/dist/migrate.js
    DV_ENV_FILE=$ENV node $ROOT/server/dist/seed.js
    DV_ENV_FILE=$ENV nohup node $ROOT/server/dist/index.js > $QA/app.log 2>&1 &
    echo $! > $QA/app.pid
    for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3299/api/health >/dev/null 2>&1 && break; sleep 0.5; done
    echo "fake-drive root: $(cat $QA/fakedrive/root-id.txt)"
    curl -s http://127.0.0.1:3299/api/health; echo
    ;;
  stop) stop ;;
  reset-db)
    stop
    P=$(cat $QA/.dbpass)
    /www/server/mysql/bin/mysql -udummy_test -p"$P" dummy_test -N -e "SELECT CONCAT('DROP TABLE IF EXISTS \`',table_name,'\`;') FROM information_schema.tables WHERE table_schema='dummy_test'" > $QA/drop.sql
    (echo "SET FOREIGN_KEY_CHECKS=0;"; cat $QA/drop.sql; echo "SET FOREIGN_KEY_CHECKS=1;") | /www/server/mysql/bin/mysql -udummy_test -p"$P" dummy_test
    rm -rf $QA/storage-test $QA/drop.sql
    echo "DB uji & storage uji dikosongkan"
    ;;
  *) echo "pakai: start [--reseed] | stop | reset-db"; exit 1 ;;
esac

#!/usr/bin/env bash
# Smoke test (SPEC §21): health, login admin, me, feed, detail video publik, stream Range → 206,
# video privat sebagai tamu → 404, CSRF tanpa header → 403.
# Pemakaian: BASE=https://video.dymas.cloud SMOKE_USER=admin SMOKE_PASS=… bash scripts/smoke.sh
#   Tanpa SMOKE_PASS: dicoba ADMIN_INITIAL_PASSWORD dari .env (bila password admin belum diganti); bila gagal, cek yang butuh login dilewati.
set -uo pipefail
BASE=${BASE:-https://video.dymas.cloud}
USER_=${SMOKE_USER:-admin}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PASS=${SMOKE_PASS:-}
if [ -z "$PASS" ] && [ -r "$ROOT/.env" ]; then PASS=$(grep '^ADMIN_INITIAL_PASSWORD=' "$ROOT/.env" | cut -d= -f2-); fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
J=$TMP/jar
PASSED=0
FAILED=0
ok() { echo "OK    $1"; PASSED=$((PASSED + 1)); }
bad() { echo "GAGAL $1${2:+ — $2}"; FAILED=$((FAILED + 1)); }
skip() { echo "LEWAT $1${2:+ — $2}"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
csrf() { awk '$6=="dv_csrf"{print $7}' "$J"; }
code() { curl -s -o "$TMP/body" -w '%{http_code}' "$@"; }

c=$(code "$BASE/api/health")
[ "$c" = 200 ] && [ "$(json "d['ok']" < "$TMP/body")" = True ] && ok "health (db ok)" || bad "health" "HTTP $c $(head -c 200 "$TMP/body")"

curl -s -c "$J" -o /dev/null "$BASE/api/auth/me"
LOGGED=0
if [ -n "$PASS" ]; then
  c=$(code -b "$J" -c "$J" -H 'Content-Type: application/json' -H "X-CSRF-Token: $(csrf)" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"username":sys.argv[1],"password":sys.argv[2]}))' "$USER_" "$PASS")" "$BASE/api/auth/login")
  if [ "$c" = 200 ]; then ok "login $USER_"; LOGGED=1; else bad "login $USER_" "HTTP $c (set SMOKE_PASS bila password admin sudah diganti)"; fi
else
  skip "login" "SMOKE_PASS kosong"
fi
if [ $LOGGED = 1 ]; then
  c=$(code -b "$J" "$BASE/api/auth/me")
  [ "$(json "d['user']['username']" < "$TMP/body")" = "$USER_" ] && ok "me" || bad "me" "HTTP $c"
fi

c=$(code "$BASE/api/feed")
[ "$c" = 200 ] && ok "feed ($(json "len(d['items'])" < "$TMP/body") video)" || bad "feed" "HTTP $c"
VID=$(json "d['items'][0]['id'] if d['items'] else ''" < "$TMP/body")
if [ -n "$VID" ]; then
  c=$(code "$BASE/api/videos/$VID")
  [ "$c" = 200 ] && ok "detail video publik $VID" || bad "detail video publik" "HTTP $c"
  URL=$(json "d['sources'][0]['url'] if d['sources'] else ''" < "$TMP/body")
  if [ -n "$URL" ]; then
    c=$(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1023' "$BASE$URL")
    [ "$c" = 206 ] && ok "stream Range bytes=0-1023 → 206" || bad "stream Range" "HTTP $c"
  else
    skip "stream" "video belum punya sumber yang bisa diputar"
  fi
else
  skip "detail/stream" "belum ada video publik"
fi

if [ $LOGGED = 1 ]; then
  c=$(code -b "$J" "$BASE/api/admin/videos?visibility=private&status=ready")
  PRIV=$(json "d['items'][0]['id'] if d.get('items') else ''" < "$TMP/body")
  if [ -n "$PRIV" ]; then
    c=$(code "$BASE/api/videos/$PRIV")
    [ "$c" = 404 ] && ok "video privat sebagai tamu → 404" || bad "video privat sebagai tamu" "HTTP $c"
  else
    skip "video privat" "tidak ada video privat"
  fi
fi

c=$(code -b "$J" -X POST -H 'Content-Type: application/json' -d '{"title":"smoke"}' "$BASE/api/playlists")
[ "$c" = 403 ] && ok "CSRF tanpa header → 403" || bad "CSRF tanpa header" "HTTP $c"

c=$(code "$BASE/api/admin/stats")
[ "$c" = 401 ] && ok "tamu → /api/admin/stats 401" || bad "akses admin tamu" "HTTP $c"

[ $LOGGED = 1 ] && curl -s -b "$J" -X POST -H "X-CSRF-Token: $(csrf)" -H 'Content-Type: application/json' -d '{}' -o /dev/null "$BASE/api/auth/logout"
echo
echo "$PASSED lulus, $FAILED gagal"
[ $FAILED = 0 ]

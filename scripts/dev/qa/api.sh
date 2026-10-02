# helper curl untuk instance uji: source /root/dv-qa/api.sh
B=${B:-http://127.0.0.1:3299}
J=${J:-/root/dv-qa/admin.jar}
csrf() { awk '$6=="dv_csrf"{print $7}' $J; }
login() { rm -f $J; curl -s -c $J $B/api/auth/me >/dev/null; curl -s -b $J -c $J -H 'Content-Type: application/json' -H "X-CSRF-Token: $(csrf)" -d "{\"username\":\"${1:-admin}\",\"password\":\"${2:-admin12345}\"}" $B/api/auth/login >/dev/null; }
get() { curl -s -b $J "$B$1"; }
post() { curl -s -b $J -c $J -X POST -H 'Content-Type: application/json' -H "X-CSRF-Token: $(csrf)" -d "${2:-{\}}" "$B$1"; }
put() { curl -s -b $J -X PUT -H 'Content-Type: application/json' -H "X-CSRF-Token: $(csrf)" -d "$2" "$B$1"; }
patch() { curl -s -b $J -X PATCH -H 'Content-Type: application/json' -H "X-CSRF-Token: $(csrf)" -d "$2" "$B$1"; }
del() { curl -s -b $J -X DELETE -H 'Content-Type: application/json' -H "X-CSRF-Token: $(csrf)" -d "${2:-{\}}" "$B$1"; }

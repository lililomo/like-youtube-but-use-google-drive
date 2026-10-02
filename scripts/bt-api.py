#!/usr/bin/env python3
"""Helper untuk memanggil API aaPanel dari server ini (harus dijalankan sebagai root).

Pemakaian:
    python3 scripts/bt-api.py <path> [key=value ...]

Contoh:
    python3 scripts/bt-api.py /system?action=GetSystemTotal
    python3 scripts/bt-api.py /database?action=getData table=databases limit=50 p=1
    python3 scripts/bt-api.py /project/nodejs/restart_project project_name=video_dymas

Signature: request_token = md5(request_time + token), token dari
/www/server/panel/config/api.json (lihat class/common.py di aaPanel).
Host default = IP publik server (IP ini ada di whitelist API aaPanel);
bisa diganti dengan env BT_API_HOST.

PERINGATAN: aaPanel memblokir API selama 1 jam setelah 20 kegagalan
verifikasi beruntun — jangan memanggil dalam loop saat signature gagal.
"""
import hashlib
import http.cookiejar
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request

PANEL_DIR = "/www/server/panel"
COOKIE_FILE = "/root/.bt-api-cookies.txt"


def load_config():
    with open(os.path.join(PANEL_DIR, "config/api.json")) as f:
        cfg = json.load(f)
    with open(os.path.join(PANEL_DIR, "data/port.pl")) as f:
        port = f.read().strip()
    scheme = "https" if os.path.exists(os.path.join(PANEL_DIR, "data/ssl.pl")) else "http"
    host = os.environ.get("BT_API_HOST", "164.152.166.91")
    return cfg, f"{scheme}://{host}:{port}"


def call(path, data=None, timeout=300):
    cfg, base = load_config()
    now = str(int(time.time()))
    payload = dict(data or {})
    payload["request_time"] = now
    payload["request_token"] = hashlib.md5((now + cfg["token"]).encode()).hexdigest()

    jar = http.cookiejar.MozillaCookieJar(COOKIE_FILE)
    if os.path.exists(COOKIE_FILE):
        try:
            jar.load(ignore_discard=True, ignore_expires=True)
        except Exception:
            pass
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx)
    )
    body = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(base + path, data=body, method="POST")
    with opener.open(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", "replace")
    jar.save(ignore_discard=True, ignore_expires=True)
    os.chmod(COOKIE_FILE, 0o600)
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    data = {}
    for arg in sys.argv[2:]:
        key, _, value = arg.partition("=")
        data[key] = value
    result = call(path, data)
    if isinstance(result, (dict, list)):
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(result)


if __name__ == "__main__":
    main()

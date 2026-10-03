#!/usr/bin/env node
/**
 * yt-dlp PALSU untuk instance uji (tanpa internet / tanpa memancing verifikasi "bukan bot" YouTube dari IP server).
 * Pakai: di /root/dv-qa/env.test set `YTDLP_PATH=<repo>/scripts/dev/fake-yt-dlp.mjs` (chmod +x), restart instance uji.
 *
 * Perilaku menurut ID video (11 karakter):
 *   private…  → "ERROR: … Private video" (gagal permanen)
 *   bigfile…  → ukuran 20 GB di metadata (ditolak batas ukuran/kuota sebelum mengunduh)
 *   lainnya   → "mengunduh" FAKE_YTDLP_MEDIA (default /root/dv-qa/media-src/Video Uji H264.mp4)
 *               selama FAKE_YTDLP_DELAY_MS (default 4000) dengan progres
 * Playlist (`--flat-playlist -J …list=ID`): 3 video `<ID>-0..2` dipotong/diisi jadi 11 karakter.
 */
import { copyFileSync, readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const media = process.env.FAKE_YTDLP_MEDIA || '/root/dv-qa/media-src/Video Uji H264.mp4';
const delay = Number(process.env.FAKE_YTDLP_DELAY_MS ?? 4000);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args.includes('--version')) {
  console.log('2026.10.03-fake');
  process.exit(0);
}
if (args.includes('-U')) {
  console.log('yt-dlp palsu: tidak ada pembaruan');
  process.exit(0);
}

const url = args.at(-1) ?? '';
const idFrom = (u) => {
  try {
    const p = new URL(u);
    return p.searchParams.get('v') ?? p.pathname.split('/').pop() ?? u;
  } catch {
    return u;
  }
};

if (args.includes('--flat-playlist')) {
  const list = new URL(url).searchParams.get('list') ?? 'PLfake';
  const entries = [0, 1, 2].map((i) => {
    const id = `${list.slice(-9)}-${i}`.padStart(11, 'x').slice(-11);
    return { id, title: `Playlist uji ${list} #${i + 1}`, duration: 10 };
  });
  console.log(JSON.stringify({ id: list, title: `Playlist uji ${list}`, channel: 'Channel Uji', entries }));
  process.exit(0);
}

const loadInfo = argOf('--load-info-json');
if (!loadInfo) {
  // Ambil metadata (-J).
  const id = idFrom(url);
  if (id.startsWith('private')) {
    console.error(`ERROR: [youtube] ${id}: Private video. Sign in if you've been granted access to this video`);
    process.exit(1);
  }
  const size = id.startsWith('bigfile') ? 20 * 1024 ** 3 : statSync(media).size;
  const info = {
    id,
    title: `Video uji ${id}`,
    channel: 'Channel Uji',
    duration: 10,
    ext: 'mp4',
    requested_formats: [
      { format_id: '137', filesize: Math.round(size * 0.9), height: 1080, width: 1920, vcodec: 'avc1.640028', acodec: 'none', ext: 'mp4' },
      { format_id: '140', filesize: size - Math.round(size * 0.9), vcodec: 'none', acodec: 'mp4a.40.2', ext: 'm4a' },
    ],
  };
  console.log(JSON.stringify(info));
  process.exit(0);
}

// Unduh: salin file media sintetis dengan progres bertahap.
const info = JSON.parse(readFileSync(loadInfo, 'utf8'));
const out = (argOf('-o') ?? 'video.%(ext)s').replace('%(ext)s', 'mp4');
const total = statSync(media).size;
const steps = 4;
for (let i = 1; i <= steps; i++) {
  await sleep(delay / steps);
  const got = Math.round((total * i) / steps);
  const v = Math.min(got, Math.round(total * 0.9));
  console.log(`DVP 137 ${v} ${Math.round(total * 0.9)} NA`);
  if (i === steps) console.log(`DVP 140 ${total - Math.round(total * 0.9)} ${total - Math.round(total * 0.9)} NA`);
}
copyFileSync(media, out);
console.error(`[fake] ${info.id} → ${out}`);

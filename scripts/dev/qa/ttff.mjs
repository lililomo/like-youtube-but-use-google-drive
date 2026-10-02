// Waktu sampai video bisa diputar & setelah seek ke 60%, per sumber. node ttff.mjs <videoId>...
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const get = async (id) => (await (await fetch(`https://video.dymas.cloud/api/videos/${id}`)).json()).sources;
const targets = [];
for (const id of process.argv.slice(2)) for (const s of await get(id)) if (s.q !== '360') targets.push([`${id} ${s.q}`, 'https://video.dymas.cloud' + s.url]);
for (const [label, url] of targets) {
  for (let run = 0; run < 2; run++) {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    let reqs = 0; p.on('request', (r) => { if (r.url().includes('/stream/')) reqs++; });
    await p.goto('https://video.dymas.cloud/api/health');
    const r = await p.evaluate(async (u) => {
      const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; document.body.append(v);
      const wait = (ev, ms = 20000) => new Promise((res, rej) => { v.addEventListener(ev, res, { once: true }); setTimeout(() => rej(new Error(`timeout ${ev} rs=${v.readyState} err=${v.error?.code}`)), ms); });
      try {
        let t = performance.now(); v.src = u; const c = wait('canplay'); v.play().catch(() => {}); await c;
        const start = performance.now() - t;
        t = performance.now(); const sk = wait('seeked'); v.currentTime = v.duration * 0.6; await sk; if (v.readyState < 3) await wait('canplay');
        return `mulai ${Math.round(start)} ms   seek 60% ${Math.round(performance.now() - t)} ms`;
      } catch (e) { return String(e.message); }
    }, url);
    console.log(`${label.padEnd(18)} ${r}   (${reqs} request)`);
    await ctx.close();
  }
}
await b.close();

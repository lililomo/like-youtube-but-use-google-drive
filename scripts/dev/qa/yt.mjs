import { chromium } from 'playwright-core';
const [w='1280', h='800', theme='dark', out='yt'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell' });
const c = await b.newContext({ viewport: { width: +w, height: +h }, colorScheme: theme, locale: 'id-ID', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });
const p = await c.newPage();
await p.goto('https://www.youtube.com/?hl=id&gl=ID', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(5000);
await p.screenshot({ path: `/root/dv-qa/shots/${out}.png` });
const m = await p.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  return { masthead: q('#masthead-container'), search: q('yt-searchbox, #search-form, ytd-searchbox'), guideEntry: q('ytd-guide-entry-renderer'), chip: q('yt-chip-cloud-chip-renderer'), signin: q('ytd-button-renderer a[href*="ServiceLogin"], #buttons ytd-button-renderer'), logo: q('#logo-icon, ytd-topbar-logo-renderer') };
});
console.log(JSON.stringify(m));
await b.close();

import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:3299';
const [vid] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'id-ID' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const st = () => page.evaluate(() => { const v = document.querySelector('.dvp-video'); return { t: +v.currentTime.toFixed(2), paused: v.paused, muted: v.muted, src: v.src.replace(/\?.*/, ''), rate: v.playbackRate, state: document.querySelector('.dvp').dataset.state, cap: document.querySelector('.dvp-captions').textContent }; });
const log = (label, o) => console.log(label.padEnd(34), JSON.stringify(o));
await page.goto(`${BASE}/watch?v=${vid}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
log('autoplay', await st());
await page.mouse.move(700, 400);
await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-playing.png' });
await page.keyboard.press('k'); await page.waitForTimeout(300); log('k (jeda)', await st());
await page.keyboard.press('l'); await page.waitForTimeout(300); log('l (+10)', await st());
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300); log('← (-5)', await st());
await page.keyboard.press('5'); await page.waitForTimeout(300); log('5 (50%)', await st());
await page.keyboard.press('0'); await page.waitForTimeout(300);
await page.keyboard.press('m'); await page.waitForTimeout(200); log('m (bisu)', await st());
await page.keyboard.press('m');
await page.keyboard.press('Shift+Period'); await page.waitForTimeout(200); log('> (kecepatan)', await st());
await page.keyboard.press('Shift+Comma');
// subtitle: c → aktif, putar ke 1.5 dtk
await page.keyboard.press('c'); await page.waitForTimeout(800);
await page.evaluate(() => { const v = document.querySelector('.dvp-video'); v.currentTime = 1.5; });
await page.waitForTimeout(700); log('c (subtitle) @1.5s', await st());
await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-subtitle.png' });
// double-klik kanan → +10
const box = await page.locator('.dvp').boundingBox();
const before = (await st()).t;
await page.mouse.dblclick(box.x + box.width * 0.85, box.y + box.height * 0.4);
await page.waitForTimeout(200);
await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-ripple.png' });
await page.waitForTimeout(400); log(`dblclick kanan (sebelum ${before})`, await st());
await page.mouse.dblclick(box.x + box.width * 0.15, box.y + box.height * 0.4);
await page.waitForTimeout(500); log('dblclick kiri', await st());
// menu setelan → kualitas 360p
await page.mouse.move(box.x + 500, box.y + 300);
await page.click('.dvp-settings'); await page.waitForTimeout(300);
await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-menu.png' });
await page.click('.dvp-menu__item[data-go="quality"]'); await page.waitForTimeout(300);
await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-menu-quality.png' });
const tq = (await st()).t;
await page.click('.dvp-menu__option[data-q="360"]'); await page.waitForTimeout(1500);
log(`kualitas → 360 (t sebelum ${tq})`, await st());
// URL rusak → pemulihan otomatis
await page.evaluate(() => { const v = document.querySelector('.dvp-video'); v.src = v.src.replace(/s=[^&]+/, 's=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'); v.load(); v.play().catch(() => {}); });
await page.waitForTimeout(4000); log('setelah URL rusak (pulih?)', await st());
// storyboard preview: hover progress bar
await page.mouse.move(box.x + 300, box.y + 300);
const bar = await page.locator('.dvp-progress').boundingBox();
await page.mouse.move(bar.x + bar.width * 0.6, bar.y + bar.height / 2);
await page.waitForTimeout(400);
await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-preview.png' });
// mode bioskop
await page.mouse.move(100, 100);
await page.keyboard.press('t'); await page.waitForTimeout(500);
await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-theater.png' });
await page.keyboard.press('t');
// tahan klik = 2x
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down(); await page.waitForTimeout(700); log('tahan klik (2x)', await st());
await page.mouse.up(); await page.waitForTimeout(200); log('lepas', await st());
console.log('ERRORS:', errors.length ? errors : 'tidak ada');
await b.close();

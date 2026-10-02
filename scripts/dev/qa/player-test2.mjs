import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:3299';
const [hevc, lagu] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const st = (page) => page.evaluate(() => { const v = document.querySelector('.dvp-video'); return { t: +v.currentTime.toFixed(2), paused: v.paused, src: v.src.replace(/\?.*/, ''), state: document.querySelector('.dvp').dataset.state, err: v.error?.code ?? null }; });
{ const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await page.goto(`${BASE}/watch?v=${hevc}`); await page.waitForTimeout(3000); console.log('HEVC →', JSON.stringify(await st(page))); await ctx.close(); }
{ const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/watch?v=${lagu}&t=2`); await page.waitForTimeout(1500); await page.evaluate(() => document.querySelector(".dvp-video").pause());
  console.log('mobile t=5 →', JSON.stringify(await st(page)));
  const box = await page.locator('.dvp').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(400);
  await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-mobile.png' });
  const t0 = (await st(page)).t;
  // double-tap kanan lalu tap ketiga (akumulatif 20 dtk)
  for (let i = 0; i < 3; i++) { await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2); await page.waitForTimeout(120); }
  await page.waitForTimeout(150);
  await page.screenshot({ path: (process.env.SHOTS ?? '/root/dv-qa/shots') + '/p-mobile-ripple.png' });
  const t1 = (await st(page)).t; console.log(`double-tap+tap kanan: ${t0} → ${t1} (≈ +20)`);
  await ctx.close(); }
await b.close();

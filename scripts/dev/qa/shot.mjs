// Screenshot QA (GDrive Tube). Pemakaian: node shot.mjs <nama> <path> <lebar> <tinggi> <dark|light> [login] [aksi]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [name, path = '/', w = '1920', h = '1080', theme = 'dark', login = '', action = ''] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'https://video.dymas.cloud';
mkdirSync((process.env.SHOTS ?? '/root/dv-qa/shots') + '', { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
});
const mobile = Number(w) <= 600;
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  colorScheme: theme,
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
  locale: 'id-ID',
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

if (login) {
  const [u, p] = login.split(':');
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=username]', u);
  await page.fill('input[name=password]', p);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}
await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
if (action === 'focus-search') await page.focus('.dv-search__input');
if (action.startsWith('type:')) {
  await page.click('.dv-search__input');
  await page.keyboard.type(action.slice(5), { delay: 30 });
  await page.waitForTimeout(600);
}
if (action === 'hover-card') {
  await page.hover('.dv-vcard');
  await page.waitForTimeout(300);
}
if (action === 'account-menu') await page.click('.dv-masthead__avatar, .dv-masthead__end .dv-icon-btn[aria-label="Setelan"]');
if (action === 'drawer') await page.click('.dv-masthead__menu');
if (action === 'theme-menu') {
  await page.click('.dv-masthead__avatar, .dv-masthead__end .dv-icon-btn[aria-label="Setelan"]');
  await page.click('text=Tampilan:');
}
await page.waitForTimeout(400);
await page.screenshot({ path: `/root/dv-qa/shots/${name}.png`, fullPage: process.env.FULL === '1' });
if (errors.length) console.log('CONSOLE ERRORS:', errors.join('\n'));
console.log('saved', name);
await browser.close();

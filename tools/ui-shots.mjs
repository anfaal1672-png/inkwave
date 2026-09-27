// Menu layout shots on a phone, fast: the UI lab (tools/ui-lab.html) mounts the real Menus + HUD without the 3D game,
// so every screen is on film in seconds. Default device: iPhone 17 in landscape as a home-screen app — 874×402 with the
// notch / home-bar safe areas (62 px left and right, 21 px bottom), touch input, Japanese.
// usage: node tools/ui-shots.mjs <outdir> [--screens setup,howto,…] [--w 874 --h 402 --inset 62] [--url http://localhost:8490/]
// Screens: title main setup loadout locker(+tabs) settings(+tabs) howto credits pause results hud. Needs the dev server.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchOptions } from './browser.mjs';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'ui-shots';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +opt('w', 874), H = +opt('h', 402), inset = +opt('inset', 62);
const base = opt('url', 'http://localhost:8490/');
const ALL = ['title', 'main', 'setup', 'loadout', 'locker', 'settings', 'howto', 'credits', 'pause', 'results', 'hud'];
const want = (opt('screens', null) || ALL.join(',')).split(',');
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch(launchOptions({ width: W, height: H }));
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
if (inset) await (await page.createCDPSession()).send('Emulation.setSafeAreaInsetsOverride', { insets: { left: inset, right: inset, bottom: Math.round(inset / 3), top: 0 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}tools/ui-lab.html?screen=main&clean=1&auto=0`, { waitUntil: 'load' });
await page.waitForFunction('window.lab && window.lab.menus', { timeout: 60000 });
await page.evaluate(() => { lab.input('touch'); });
const settle = async (ms = 2200) => {
  await new Promise((r) => setTimeout(r, 300));
  await page.waitForFunction('!lab.menus.wipe || !lab.menus.wipe.busy', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, ms));
};
const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`) }); console.log(name); };
for (const s of want) {
  if (s === 'results') { await page.evaluate(() => lab.results()); await settle(2600); await shot('results'); continue; }
  if (s === 'hud') { await page.evaluate(() => { lab.go(null); lab.hud(true); }); await settle(1500); await shot('hud'); continue; }
  await page.evaluate((x) => lab.go(x), s); await settle();
  await shot(s);
  if (s === 'settings' || s === 'locker') {
    for (let i = 1; i < (s === 'settings' ? 6 : 4); i++) { await page.evaluate(() => lab.menus._nav('tab_next')); await settle(700); await shot(`${s}-${i}`); }
  }
}
if (errors.length) console.log('page errors:', errors);
await browser.close();

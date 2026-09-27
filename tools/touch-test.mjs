// Touch-only play-through: a landscape phone (touch events only, no mouse or keyboard) goes from the title screen to
// the results, using every on-screen control once. Each step checks the game state it should have changed.
// usage: node tools/touch-test.mjs [--url http://localhost:8490/] [--shots dir] [--lang ja]
// Needs the dev server. Exit 1 if any step fails or the page logs an error.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchOptions } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const base = opt('url', 'http://localhost:8490/');
const shots = opt('shots', null);
const lang = opt('lang', 'ja');
const W = 844, H = 390;
if (shots) mkdirSync(shots, { recursive: true });

const browser = await puppeteer.launch({ ...launchOptions({ width: W, height: H }), protocolTimeout: 1200000 });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36');
await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('inkwave.settings', JSON.stringify({ lang: l, quality: 'low', fovMode: 'h' })); } catch { /* ignore */ } }, lang);
const cdp = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const until = (js, ms = 600000) => page.waitForFunction(js, { timeout: ms, polling: 200 });
// multi-touch: each active finger keeps its id; every call sends the full set of fingers still down
const fingers = new Map();
async function touch(type, id, x, y) {
  if (type === 'touchEnd' || type === 'touchCancel') fingers.delete(id); else fingers.set(id, { x, y, id, radiusX: 8, radiusY: 8, force: 1 });
  const touchPoints = type === 'touchEnd' ? [...fingers.values()] : [...fingers.values()];
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints, ...(type === 'touchEnd' && !touchPoints.length ? {} : {}) });
}
const down = (id, x, y) => touch('touchStart', id, x, y);
const move = (id, x, y) => touch('touchMove', id, x, y);
const up = (id) => touch('touchEnd', id);
async function drag(id, x0, y0, x1, y1, steps = 8, holdMs = 0) {
  await down(id, x0, y0);
  for (let i = 1; i <= steps; i++) { await move(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await wait(40); }
  if (holdMs) await wait(holdMs);
  await up(id);
}
const center = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
async function tap(sel, id = 9) {
  const c = await center(sel);
  if (!c) throw new Error('not on screen: ' + sel);
  await down(id, c.x, c.y); await wait(60); await up(id);
  return c;
}
async function hold(sel, ms, id = 8) {
  const c = await center(sel);
  if (!c) throw new Error('not on screen: ' + sel);
  await down(id, c.x, c.y); await wait(ms); await up(id);
}
const results = [];
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    process.stderr.write(`ok   ${name}${detail ? ' — ' + detail : ''}\n`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message.split('\n')[0] });
    process.stderr.write(`FAIL ${name} — ${e.message.split('\n')[0]}\n`);
  }
  if (shots) await page.screenshot({ path: join(shots, `${String(results.length).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
}
const A = 'window.__inkwave.match.local';

await page.goto(base, { waitUntil: 'load', timeout: 600000 });
await until('window.__inkwave && __inkwave.bootMs && __inkwave.menus.current === "title"', 900000);

await step('title: tap to start', async () => {
  await wait(1500);   // the title ignores taps in its first 350 ms (a tap meant for the loading screen)
  await down(1, W / 2, H * 0.6); await wait(80); await up(1);
  await until('__inkwave.menus.current === "main"', 60000);
  return await ev(() => document.querySelector('.iw-title__presstext')?.textContent || __inkwave.menus._input);
});
await step('main: PLAY', async () => { await wait(1200); await tap('[data-id="play"]'); await until('__inkwave.menus.current === "setup"', 60000); });
await step('setup: START', async () => {
  await wait(1500);
  await tap('[data-id="start"]');
  await until('__inkwave.match && !__inkwave.match.attract && __inkwave.match.state === "playing"', 900000);
  await until('document.querySelector(".iw-touch.is-on")', 60000);
  return 'touch controls shown';
});
await step('move stick (left side)', async () => {
  const p0 = await ev(new Function(`const a=${A}; return {x:a.pos.x, z:a.pos.z};`));
  await drag(1, W * 0.18, H * 0.78, W * 0.18, H * 0.5, 6, 5000);
  const p1 = await ev(new Function(`const a=${A}; return {x:a.pos.x, z:a.pos.z};`));
  const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  if (d < 0.8) throw new Error(`moved only ${d.toFixed(2)} m`);
  return `moved ${d.toFixed(1)} m`;
});
await step('look (right side swipe)', async () => {
  const y0 = await ev(() => __inkwave.rig.yaw);
  await drag(2, W * 0.55, H * 0.5, W * 0.7, H * 0.5, 6);
  const y1 = await ev(() => __inkwave.rig.yaw);
  if (Math.abs(y1 - y0) < 0.2) throw new Error(`yaw changed ${(y1 - y0).toFixed(3)} rad`);
  return `yaw ${(y1 - y0).toFixed(2)} rad`;
});
await step('shoot button (hold)', async () => {
  const i0 = await ev(new Function(`return ${A}.ink;`));
  await ev(new Function(`${A}.ink = 100;`));
  await hold('.iw-tbtn--fire', 2500);
  const i1 = await ev(new Function(`return ${A}.ink;`));
  if (!(i1 < 95)) throw new Error(`ink ${i0.toFixed(0)} → ${i1.toFixed(0)}: nothing fired`);
  return `ink 100 → ${i1.toFixed(0)}`;
});
await step('squid button (hold)', async () => {
  const c = await center('.iw-tbtn--squid');
  await down(3, c.x, c.y);
  await until(`${A}.form === "squid"`, 30000);
  await up(3);
  await until(`${A}.form !== "squid"`, 30000);
  return 'squid while held, kid on release';
});
await step('jump button', async () => {
  await until(`${A}.grounded`, 30000);
  const c = await center('.iw-tbtn--jump');
  await down(4, c.x, c.y);
  await until(`!${A}.grounded && ${A}.vel.y > 0`, 30000);
  await up(4);
  return 'airborne';
});
await step('bomb button (hold + release)', async () => {
  await until(`${A}.grounded`, 30000);
  await ev(new Function(`${A}.ink = 100;`));
  const c = await center('.iw-tbtn--sub');
  await down(5, c.x, c.y); await wait(1200); await up(5);
  await until(`${A}.ink < 45`, 30000);
  return 'bomb thrown';
});
await step('special button', async () => {
  await ev(new Function(`const a=${A}; a.special = a.specialCost();`));
  await until('document.querySelector(".iw-tbtn--special.is-ready")', 30000);
  await tap('.iw-tbtn--special', 6);
  await until(`${A}.specialActive || ${A}.special < ${A}.specialCost()`, 30000);
  return 'special used';
});
await step('map button + tap base pin → Super Jump', async () => {
  await until(`${A}.alive && !${A}.superJumpState && ${A}.canSuperJump()`, 60000);
  const c = await center('.iw-tbtn--map');
  await down(7, c.x, c.y);
  await until('__inkwave.rig.mapK > 0.9', 60000);
  await wait(400);
  await tap('.iw-pin--home .iw-pin__badge', 11);
  await until(`!!${A}.superJumpState`, 30000);
  await up(7);
  return 'super jump started';
});
await step('pause button → resume', async () => {
  await until('!__inkwave.match.paused && document.querySelector(".iw-touch.is-on")', 60000);
  await tap('.iw-tbtn--pause');
  await until('__inkwave.match.paused && __inkwave.menus.current === "pause"', 30000);
  await wait(800);
  await tap('[data-id="resume"]');
  await until('!__inkwave.match.paused && !__inkwave.menus.current', 30000);
});
await step('finish → results', async () => {
  await ev(() => __inkwave.debug.endMatch());
  await until('__inkwave.menus.current === "results"', 900000);
  const t = await ev(() => document.querySelector('.iw-res__title')?.textContent);
  return t;
});

await browser.close();
const failed = results.filter((r) => !r.ok);
if (errors.length) { console.log('page errors:'); for (const e of [...new Set(errors)].slice(0, 15)) console.log('   ', e); }
console.log(`${results.length - failed.length}/${results.length} steps passed`);
console.log(failed.length || errors.length ? 'TOUCH TEST FAIL' : 'TOUCH TEST OK');
process.exit(failed.length || errors.length ? 1 : 0);

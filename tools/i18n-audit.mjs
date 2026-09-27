// Rendered-text audit: opens every menu screen (and each settings / locker tab) plus the in-match HUD states in the
// browser, collects the visible text and flags English words that slipped through the translation. Saves a
// screenshot of each state for a visual check (overflow, clipping, font fallback).
// usage: node tools/i18n-audit.mjs [--lang ja] [--shots dir] [--url http://localhost:8490/] [--no-match] [--mobile]
//   --mobile: a landscape phone (844×390, touch) — also a layout check for the small screen
// Needs the dev server. Exit 1 when a screen shows an English word that is not a name, key cap, unit or brand.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchOptions } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const lang = opt('lang', 'ja');
const shots = opt('shots', null);
const base = opt('url', 'http://localhost:8490/');
const mobile = args.includes('--mobile');
const W = mobile ? 844 : 1280, H = mobile ? 390 : 720;
if (shots) mkdirSync(shots, { recursive: true });

// Latin words allowed on a Japanese screen: proper nouns, units, key/pad glyph labels, brand and licence names
const ALLOW = new Set([
  'INKWAVE', 'MVP', 'XP', 'Lv', 'FPS', 'BGM', 'MSAA', 'OK', 'GO', 'vs', 'VS', 'px', 'HP', 'BOOM', 'English',
  'SHIFT', 'SPACE', 'TAB', 'ESC', 'Esc', 'Enter', 'VIEW', 'LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'LMB', 'RMB',
  'Titan', 'One', 'Font', 'Diner', 'Rubik', 'Hubert', 'Fischer', 'PLUS', 'Rounded', 'FONTS', 'PROJECT', 'SIL', 'Open',
  'License', 'three', 'js', 'Player', 'SEC', 'MIN', 'Language', 'HUD',
]);

const browser = await puppeteer.launch({ ...launchOptions({ width: W, height: H }), protocolTimeout: 1200000 });
const page = await browser.newPage();
if (mobile) await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
await page.evaluateOnNewDocument((l) => {
  try { localStorage.setItem('inkwave.settings', JSON.stringify({ lang: l, quality: 'low', fovMode: 'h' })); } catch { /* ignore */ }
}, lang);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fontReqs = [];
page.on('request', (r) => { if (/\.woff2/.test(r.url())) fontReqs.push(r.url().split('/').pop()); });
await page.goto(`${base}?map=tidewater&i18n=debug`, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction('window.__inkwave && __inkwave.bootMs', { timeout: 900000, polling: 250 });
const names = await page.evaluate(async () => {
  const cfg = await import('/src/config.js');
  return [...cfg.BOT_NAMES, __inkwave.profile.name];
});
for (const n of names) for (const w of n.split(/[^A-Za-z]+/)) if (w) ALLOW.add(w);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
async function capture(label) {
  await wait(900);
  const texts = await page.evaluate(() => {
    const out = [];
    const root = document.getElementById('ui-root');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || el.closest('kbd, .iw-pad, .iw-key, svg, [aria-hidden="true"] .iw-mapthumb')) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || r.width === 0 || r.height === 0) continue;
      if (el.closest('.is-hidden, .is-leaving')) continue;
      out.push(t);
    }
    return out;
  });
  const bad = [];
  for (const t of texts) {
    const words = t.match(/[A-Za-z]{2,}/g) || [];
    const off = words.filter((w) => !ALLOW.has(w));
    if (off.length) bad.push(t.slice(0, 90));
  }
  report.push({ label, bad: [...new Set(bad)] });
  if (shots) await page.screenshot({ path: join(shots, `${label}.png`) });
  process.stderr.write(`${label}: ${bad.length ? bad.length + ' English strings' : 'ok'}\n`);
}

if (mobile) await page.evaluate(() => { __inkwave.input.lastDevice = 'touch'; __inkwave.menus.setInputMode('touch'); });
const show = (name, extra = '') => page.evaluate(`(() => { const m = __inkwave.menus; ${extra}; m.show(${JSON.stringify(name)}, { force: true }); })()`);
for (const s of ['title', 'main', 'setup', 'loadout']) { await show(s); await capture(s); }
for (let i = 0; i < 4; i++) { await show('locker', `m._lockerTab = ${i}`); await capture(`locker-${i}`); }
await show('settings');
const nTabs = await page.evaluate(() => document.querySelectorAll('.iw-settings .iw-tab').length);
for (let i = 0; i < nTabs; i++) { await show('settings', `m._settingsTab = ${i}`); await capture(`settings-${i}`); }
for (const s of ['howto', 'credits', 'pause', 'results']) { await show(s); await capture(s); }
await page.evaluate(() => __inkwave.menus.show('loading', { force: true }));
await capture('loading');

if (!args.includes('--no-match')) {
  await page.evaluate(() => { __inkwave.menus.show('main', { force: true }); __inkwave.api.startMatch({ mapId: 'tidewater', difficulty: 'normal', duration: 180 }); });
  await page.waitForFunction('__inkwave.match && !__inkwave.match.attract && __inkwave.match.state === "intro"', { timeout: 900000, polling: 250 });
  await capture('hud-intro');
  await page.waitForFunction('__inkwave.match.state === "playing"', { timeout: 900000, polling: 250 });
  await page.evaluate(() => { const h = __inkwave.hud; h.banner('one_minute'); h.banner('special', null); });
  await capture('hud-playing');
  await page.evaluate(() => { const h = __inkwave.hud; h.showSplatted({ by: 'Squiddo', respawn: 5 }); });
  await capture('hud-splatted');
  await page.evaluate(() => { const h = __inkwave.hud; h.hideSplatted(true); h.judge({ percents: [52.3, 41.8], names: ['Tangerine', 'Cobalt'] }); });
  await wait(4500);
  await capture('hud-judge');
}

const missing = await page.evaluate(() => [...(window.__i18nMissing || [])]);
await browser.close();

let fails = 0;
for (const r of report) if (r.bad.length && lang === 'ja') { fails += r.bad.length; console.log(`[${r.label}]`); for (const b of r.bad) console.log('   ', b); }
if (missing.length) { console.log('tr() keys without a Japanese entry seen at runtime:'); for (const k of missing) console.log('   ', k); }
console.log(`fonts requested: ${[...new Set(fontReqs)].join(', ') || 'none'}`);
if (errors.length) { console.log('page errors:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log('   ', e); }
console.log(fails || errors.length || (lang === 'ja' && missing.length) ? `I18N AUDIT FAIL (${lang})` : `I18N AUDIT OK (${lang})`);
process.exit(fails || errors.length || (lang === 'ja' && missing.length) ? 1 : 0);

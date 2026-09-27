// Load + runtime measurement: download size, boot timeline and in-match frame rate, as JSON.
// usage: node tools/measure-load.mjs [--profile desktop|mobile] [--runs 3] [--seconds 10] [--cache cold|warm]
//                                    [--settings '{"quality":"low"}'] [--url http://localhost:8490/] [--map tidewater]
//                                    [--out result.json]
// Needs the dev server (npm start) or any static server on --url. Each run is a fresh browser profile.
//   transfer  bytes per resource type as served (the dev server does not compress), plus the gzip / brotli size of
//             the same files — what a compressing CDN (Cloudflare Pages) would actually send
//   boot      bootMs (navigation → title screen), bootMarks (per loading stage), DOMContentLoaded / load / FCP
//   frame     over --seconds of live play on autopilot: average fps, 1 % low fps (99th percentile frame time),
//             draw calls / triangles, dynamic-resolution scale, GPU resource counts, JS heap
// With --cache warm the page is loaded once to fill the HTTP cache and the second load is measured.
// Summary values are medians over the runs; `spread` gives min..max for the headline numbers.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions, applyProfile, PROFILES } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const profileName = opt('profile', 'desktop');
const profile = PROFILES[profileName];
if (!profile) throw new Error('unknown profile ' + profileName);
const runs = +opt('runs', 1), seconds = +opt('seconds', 10), cache = opt('cache', 'cold');
const base = opt('url', 'http://localhost:8490/'), map = opt('map', 'tidewater');
const settings = opt('settings', null), outFile = opt('out', null);
const url = `${base}?map=${map}&autostart=60&autopilot`;

const median = (a) => { const s = a.filter((v) => typeof v === 'number').sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
const kb = (n) => Math.round(n / 102.4) / 10;

// gzip / brotli sizes of a served file (read from disk; cached across runs)
const packCache = new Map();
function packed(pathname) {
  if (packCache.has(pathname)) return packCache.get(pathname);
  const f = resolve(ROOT, '.' + decodeURIComponent(pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  let r = null;
  if (f.startsWith(ROOT) && existsSync(f) && statSync(f).isFile()) {
    const buf = readFileSync(f);
    r = { gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 11 } }).length };
  }
  packCache.set(pathname, r);
  return r;
}

async function oneRun(i) {
  const browser = await puppeteer.launch(launchOptions({ width: profile.width, height: profile.height }));
  try {
    const page = await browser.newPage();
    const cdp = await applyProfile(page, profile);
    await cdp.send('Network.enable');
    if (settings) await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('inkwave.settings', v); } catch { /* ignore */ } }, settings);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    if (cache === 'warm') {
      await page.goto(url, { waitUntil: 'load', timeout: 300000 });
      await page.waitForFunction('window.__inkwave && __inkwave.bootMs', { timeout: 600000, polling: 250 });
    } else {
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    }

    // resource accounting for the measured navigation
    const reqs = new Map();
    const onResp = (e) => { reqs.set(e.requestId, { url: e.response.url, type: e.type, status: e.response.status, fromCache: e.response.fromDiskCache || e.response.fromServiceWorker, bytes: 0 }); };
    const onDone = (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; };
    cdp.on('Network.responseReceived', onResp);
    cdp.on('Network.loadingFinished', onDone);

    await page.goto(url, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction('window.__inkwave && __inkwave.bootMs', { timeout: 600000, polling: 250 });
    const boot = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        bootMs: __inkwave.bootMs,
        marks: __inkwave.bootMarks,
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        load: nav ? Math.round(nav.loadEventEnd) : null,
        fcp: fcp ? Math.round(fcp.startTime) : null,
      };
    });
    cdp.off('Network.responseReceived', onResp);
    cdp.off('Network.loadingFinished', onDone);

    const transfer = { total: { count: 0, bytes: 0, gzip: 0, brotli: 0, cached: 0 }, byType: {} };
    for (const r of reqs.values()) {
      if (r.url.startsWith('data:')) continue;
      const t = (transfer.byType[r.type] ||= { count: 0, bytes: 0, gzip: 0, brotli: 0 });
      const p = packed(new URL(r.url).pathname);
      for (const o of [t, transfer.total]) {
        o.count++; o.bytes += r.bytes;
        o.gzip += p ? Math.min(p.gzip, r.bytes || p.gzip) : r.bytes;
        o.brotli += p ? Math.min(p.brotli, r.bytes || p.brotli) : r.bytes;
      }
      if (r.fromCache) transfer.total.cached++;
    }

    // live play: wait for the round, let it settle, then sample every frame
    await page.waitForFunction('__inkwave.match && __inkwave.match.state === "playing" && __inkwave.match.local', { timeout: 600000, polling: 250 });
    await new Promise((r) => setTimeout(r, 2000));
    const frame = await page.evaluate((sec) => new Promise((done) => {
      const dts = [], calls = [], tris = [];
      let last = performance.now();
      const t0 = last;
      const tick = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        const p = __inkwave.perf; if (p) { calls.push(p.calls); tris.push(p.tris); }
        if (now - t0 < sec * 1000) { requestAnimationFrame(tick); return; }
        const s = [...dts].sort((a, b) => a - b);
        const avgDt = dts.reduce((a, b) => a + b, 0) / dts.length;
        const p99 = s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
        const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
        const mem = window.__G?.renderer?.info?.memory || {};
        done({
          frames: dts.length,
          fpsAvg: +(1000 / avgDt).toFixed(1),
          fps1Low: +(1000 / p99).toFixed(1),
          frameMsAvg: +avgDt.toFixed(1),
          frameMsP99: +p99.toFixed(1),
          simMs: +(__inkwave.perf?.sim || 0).toFixed(2),
          renderMs: +(__inkwave.perf?.render || 0).toFixed(2),
          drawCalls: mean(calls),
          triangles: mean(tris),
          dynScale: __inkwave.R?.dynScale ?? null,
          quality: __inkwave.settings?.quality,
          geometries: mem.geometries ?? null,
          textures: mem.textures ?? null,
          jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        });
      };
      requestAnimationFrame(tick);
    }), seconds);
    process.stderr.write(`run ${i + 1}/${runs}: boot ${boot.bootMs} ms, ${kb(transfer.total.bytes)} KB, ${frame.fpsAvg} fps\n`);
    return { boot, transfer, frame, errors };
  } finally {
    await browser.close();
  }
}

const results = [];
for (let i = 0; i < runs; i++) results.push(await oneRun(i));

const pick = (f) => results.map(f);
const spread = (f) => { const v = pick(f).filter((x) => typeof x === 'number'); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
const markNames = results[0].boot.marks.map((m) => m[0]);
const summary = {
  when: new Date().toISOString(),
  profile: profileName,
  cache,
  settings: settings ? JSON.parse(settings) : null,
  runs,
  url,
  renderer: process.platform === 'linux' ? 'swiftshader (software)' : 'gpu',
  boot: {
    bootMs: median(pick((r) => r.boot.bootMs)),
    domContentLoaded: median(pick((r) => r.boot.domContentLoaded)),
    load: median(pick((r) => r.boot.load)),
    fcp: median(pick((r) => r.boot.fcp)),
    // per stage: ms spent from the previous mark to this one (median over runs)
    stages: markNames.map((name, k) => [name, median(pick((r) => (r.boot.marks[k] ? r.boot.marks[k][1] - (k ? r.boot.marks[k - 1][1] : 0) : null)))]),
  },
  transfer: {
    requests: results[0].transfer.total.count,
    kb: kb(results[0].transfer.total.bytes),
    gzipKb: kb(results[0].transfer.total.gzip),
    brotliKb: kb(results[0].transfer.total.brotli),
    byType: Object.fromEntries(Object.entries(results[0].transfer.byType).sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([t, v]) => [t, { count: v.count, kb: kb(v.bytes), brotliKb: kb(v.brotli) }])),
  },
  frame: Object.fromEntries(Object.keys(results[0].frame).map((k) => [k, typeof results[0].frame[k] === 'number' ? median(pick((r) => r.frame[k])) : results[0].frame[k]])),
  spread: {
    bootMs: spread((r) => r.boot.bootMs),
    fpsAvg: spread((r) => r.frame.fpsAvg),
    fps1Low: spread((r) => r.frame.fps1Low),
  },
  errors: [...new Set(results.flatMap((r) => r.errors))].slice(0, 20),
};
const json = JSON.stringify(summary, null, 2);
if (outFile) writeFileSync(outFile, json + '\n');
console.log(json);

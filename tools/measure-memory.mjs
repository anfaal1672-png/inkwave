// How much memory does a session hold, and does it grow from match to match? Phones (iOS Safari above all) kill a tab
// that holds too much, so this counts what the page keeps alive, not what it downloads:
//   gpu MB     bytes of every live WebGL texture / renderbuffer / buffer (sizes recorded at upload, freed on delete;
//              mip chains counted at 4/3, MSAA renderbuffers × samples)
//   canvas MB  4 bytes per pixel of every <canvas> still referenced (2D scratch canvases hold their bitmap)
//   heap MB    JS heap in use (performance.memory, after a forced GC)
//   tex/geo/prog  renderer.info.memory / programs
// It boots to the title, then plays a short round on every stage (day and dusk) and samples after each one: numbers that
// keep climbing after the first visit to every stage are a leak.
// usage: node tools/measure-memory.mjs [--profile mobile] [--settings '{"quality":"saver"}'] [--rounds 6] [--secs 8]
//                                      [--url http://localhost:8490/] [--json]
import puppeteer from 'puppeteer-core';
import { launchOptions, applyProfile, PROFILES } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const profileName = opt('profile', 'mobile');
const profile = PROFILES[profileName];
const settings = opt('settings', '{"quality":"saver","fovMode":"h"}');
const rounds = +opt('rounds', 6), secs = +opt('secs', 8);
const asJson = args.includes('--json');
const u = new URL(opt('url', 'http://localhost:8490/'));
u.searchParams.set('skipTitle', ''); u.searchParams.set('autopilot', '');

const browser = await puppeteer.launch({ ...launchOptions({ width: profile.width, height: profile.height, extraArgs: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] }), protocolTimeout: 1800000 });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await applyProfile(page, { ...profile, cpuThrottle: 1, network: null });   // memory does not depend on speed
await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('inkwave.settings', v); } catch { /* ignore */ } }, settings);
// count live GPU allocations by hooking the upload / delete calls of both WebGL contexts
await page.evaluateOnNewDocument(() => {
  const M = (window.__mem = { bytes: new Map(), kinds: new Map(), canvases: [] });
  const BPP = { 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190a: 2, 0x1903: 1 };   // RGBA RGB LUMINANCE LUMINANCE_ALPHA RED
  const SIZED = { 0x8058: 4, 0x8c43: 4, 0x881a: 8, 0x8814: 16, 0x822e: 4, 0x8229: 1, 0x822b: 2, 0x8230: 8, 0x881b: 6, 0x8815: 12, 0x81a5: 2, 0x81a6: 4, 0x88f0: 4, 0x8cac: 4, 0x8cad: 8, 0x8d48: 1, 0x8051: 3, 0x8c41: 3, 0x8d62: 2, 0x8056: 2, 0x8057: 2 };
  const bpp = (fmt, type) => {
    if (SIZED[fmt]) return SIZED[fmt];
    const c = BPP[fmt] || 4;
    return type === 0x140b || type === 0x8d61 ? c * 2 : type === 0x1406 ? c * 4 : c;   // HALF_FLOAT(_OES) / FLOAT
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    const bound = new WeakMap();   // ctx → { tex: Map(unitTarget → tex), unit, rb, buf: Map(target → buf) }
    const st = (gl) => { let s = bound.get(gl); if (!s) bound.set(gl, (s = { tex: new Map(), unit: 0, rb: null, buf: new Map() })); return s; };
    const set = (obj, kind, key, bytes) => {
      if (!obj) return;
      let m = M.bytes.get(obj); if (!m) { m = new Map(); M.bytes.set(obj, m); M.kinds.set(obj, kind); }
      m.set(key, bytes);
    };
    const wrap = (name, fn) => { const o = P[name]; if (o) P[name] = function (...a) { fn.call(this, a); return o.apply(this, a); }; };
    wrap('activeTexture', function (a) { st(this).unit = a[0]; });
    wrap('bindTexture', function (a) { st(this).tex.set(st(this).unit + ':' + a[0], a[1]); });
    wrap('bindRenderbuffer', function (a) { st(this).rb = a[1]; });
    wrap('bindBuffer', function (a) { st(this).buf.set(a[0], a[1]); });
    // ask the context which texture is bound (tracking binds by hand mis-attributed mip chains to the wrong texture)
    const BINDING = { 0x0de1: 0x8069, 0x8513: 0x8514, 0x806f: 0x806a, 0x8c1a: 0x8c1d };   // 2D, CUBE, 3D, 2D_ARRAY
    const texOf = (gl, target) => {
      const t = target >= 0x8515 && target <= 0x851a ? 0x8513 : target;   // cube faces bind as TEXTURE_CUBE_MAP
      return BINDING[t] ? gl.getParameter(BINDING[t]) : st(gl).tex.get(st(gl).unit + ':' + t);
    };
    wrap('texImage2D', function (a) {
      const [target, level, ifmt] = a;
      let w, h, type;
      if (a.length >= 8) { w = a[3]; h = a[4]; type = a[7]; } else { const src = a[5]; w = src.width || src.videoWidth || src.displayWidth; h = src.height || src.videoHeight || src.displayHeight; type = a[4]; }
      set(texOf(this, target), 'texture', target + ':' + level, w * h * bpp(ifmt, type));
    });
    wrap('texStorage2D', function (a) {
      const [target, levels, ifmt, w, h] = a;
      let b = 0; for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(ifmt);
      set(texOf(this, target), 'texture', 'storage', b * (target === 0x8513 ? 6 : 1));
    });
    wrap('texImage3D', function (a) { set(texOf(this, a[0]), 'texture', a[0] + ':' + a[1], a[3] * a[4] * a[5] * bpp(a[2], a[8])); });
    wrap('texStorage3D', function (a) { set(texOf(this, a[0]), 'texture', 'storage', a[3] * a[4] * a[5] * bpp(a[2])); });
    wrap('compressedTexImage2D', function (a) { set(texOf(this, a[0]), 'texture', a[0] + ':' + a[1], (a[6] && a[6].byteLength) || 0); });
    wrap('generateMipmap', function (a) {
      const t = texOf(this, a[0]); const m = t && M.bytes.get(t);
      if (m) { const base = m.get(a[0] + ':0') || 0; if (base) m.set('mips', base / 3); }
    });
    wrap('renderbufferStorage', function (a) { set(st(this).rb, 'renderbuffer', 0, a[2] * a[3] * bpp(a[1])); });
    wrap('renderbufferStorageMultisample', function (a) { set(st(this).rb, 'renderbuffer', 0, a[3] * a[4] * bpp(a[2]) * Math.max(1, a[1])); });
    wrap('bufferData', function (a) {
      const b = st(this).buf.get(a[0]); const n = typeof a[1] === 'number' ? a[1] : (a[1] && a[1].byteLength) || 0;
      set(b, 'buffer', 0, n);
    });
    for (const d of ['deleteTexture', 'deleteRenderbuffer', 'deleteBuffer']) wrap(d, function (a) { M.bytes.delete(a[0]); M.kinds.delete(a[0]); });
  }
  const ce = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...r) {
    const el = ce.call(this, tag, ...r);
    if (String(tag).toLowerCase() === 'canvas') M.canvases.push(new WeakRef(el));
    return el;
  };
  const OC = window.OffscreenCanvas;
  if (OC) window.OffscreenCanvas = class extends OC { constructor(...a) { super(...a); M.canvases.push(new WeakRef(this)); } };
});
await page.goto(u.href, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction('window.__inkwave && __inkwave.match && __inkwave.match.state === "playing"', { timeout: 900000, polling: 250 });

const sample = (label) => page.evaluate((label) => {
  if (window.gc) { window.gc(); window.gc(); }
  const M = window.__mem, by = { texture: 0, renderbuffer: 0, buffer: 0 };
  let big = [];
  for (const [obj, m] of M.bytes) {
    let b = 0; for (const v of m.values()) b += v;
    by[M.kinds.get(obj)] += b;
    if (M.kinds.get(obj) !== 'buffer') big.push(b);
  }
  big = big.sort((a, b) => b - a).slice(0, 6).map((b) => +(b / 1048576).toFixed(1));
  let canvas = 0, nCanvas = 0;
  M.canvases = M.canvases.filter((r) => r.deref());
  for (const r of M.canvases) { const c = r.deref(); if (c) { canvas += c.width * c.height * 4; nCanvas++; } }
  const info = window.__G.renderer.info;
  const mb = (b) => +(b / 1048576).toFixed(1);
  return {
    label, gpu: mb(by.texture + by.renderbuffer + by.buffer), tex: mb(by.texture), rb: mb(by.renderbuffer), buf: mb(by.buffer), big,
    canvas: mb(canvas), nCanvas, heap: performance.memory ? mb(performance.memory.usedJSHeapSize) : null,
    textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs ? info.programs.length : null,
  };
}, label);

const rows = [];
await new Promise((r) => setTimeout(r, 3000));
rows.push(await sample('title'));
const stages = ['tidewater', 'kelpline', 'halyard'];
for (let i = 0; i < rounds; i++) {
  const mapId = stages[i % stages.length], time = Math.floor(i / stages.length) % 2 ? 'dusk' : 'day';
  await page.evaluate((o) => window.__inkwave.api.startMatch(o), { mapId, time, duration: 60 });
  await page.waitForFunction('__inkwave.match && !__inkwave.match.attract && __inkwave.match.state === "playing"', { timeout: 900000, polling: 250 });
  await new Promise((r) => setTimeout(r, secs * 1000));
  rows.push(await sample(`${mapId} ${time}`));
}
await browser.close();

if (asJson) console.log(JSON.stringify({ settings, profile: profileName, rows, errors }, null, 1));
else {
  console.log(`memory · ${profileName} · ${settings}`);
  console.log('| after | gpu MB | textures MB | renderbuffers MB | buffers MB | largest (MB) | canvas MB (n) | heap MB | tex | geo | prog |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.label} | ${r.gpu} | ${r.tex} | ${r.rb} | ${r.buf} | ${r.big.join(' ')} | ${r.canvas} (${r.nCanvas}) | ${r.heap} | ${r.textures} | ${r.geometries} | ${r.programs} |`);
  if (errors.length) console.log('page errors:', errors);
}

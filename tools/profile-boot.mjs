// CPU profile of the boot (navigation → title screen): where the main thread spends its time.
// usage: node tools/profile-boot.mjs [--profile desktop|mobile] [--settings '{"quality":"low"}'] [--top 40]
//                                    [--url http://localhost:8490/] [--out boot.cpuprofile] [--shaders]
//   --shaders: also time every shader program's compile + link (measured at the first query on the linked program,
//              where the main thread blocks), grouped by three.js SHADER_NAME and by loading stage
// Prints self time per function and per source file, plus the boot marks. Time inside blocking WebGL calls
// (shader compile / link status queries, readPixels, texture uploads) shows up under those native functions —
// under software WebGL they dominate; on a real GPU the JS share is the part to look at.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { launchOptions, applyProfile, PROFILES } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const profileName = opt('profile', 'desktop');
const profile = PROFILES[profileName];
const settings = opt('settings', null);
const top = +opt('top', 40);
const base = opt('url', 'http://localhost:8490/');
const out = opt('out', null);

const browser = await puppeteer.launch({ ...launchOptions({ width: profile.width, height: profile.height }), protocolTimeout: 1200000 });
const page = await browser.newPage();
const cdp = await applyProfile(page, profile);
if (settings) await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('inkwave.settings', v); } catch { /* ignore */ } }, settings);
if (args.includes('--shaders')) await page.evaluateOnNewDocument(() => {
  const P = WebGL2RenderingContext.prototype;
  const names = new WeakMap(), progs = new WeakMap(), out = (window.__shaderLog = []);
  const src = P.shaderSource, att = P.attachShader, link = P.linkProgram, gpp = P.getProgramParameter, gpl = P.getProgramInfoLog;
  P.shaderSource = function (sh, s) {
    const m = /#define SHADER_NAME (.+)/.exec(s) || /#define SHADER_TYPE (.+)/.exec(s);
    names.set(sh, { name: m ? m[1].trim() : '?', len: s.length });
    return src.call(this, sh, s);
  };
  P.attachShader = function (pr, sh) { const o = progs.get(pr) || { shaders: [] }; o.shaders.push(names.get(sh)); progs.set(pr, o); return att.call(this, pr, sh); };
  P.linkProgram = function (pr) { const o = progs.get(pr) || { shaders: [] }; o.linkAt = performance.now(); progs.set(pr, o); return link.call(this, pr); };
  // three's first use of a linked program (info logs, then LINK_STATUS) blocks until compile + link finish: sum the
  // time of every query until LINK_STATUS has been read once
  const shaderOf = new WeakMap();
  const rec = (pr) => {
    let o = progs.get(pr);
    if (!o) return null;
    if (!o.entry) {
      o.entry = { name: o.shaders.map((x) => x?.name).find((n) => n && n !== '?') || '?', ms: 0, len: o.shaders.reduce((a, x) => a + (x?.len || 0), 0),
        stage: document.querySelector('.iw-loading__label')?.textContent || '(no loading screen)' };
      out.push(o.entry);
    }
    return o;
  };
  const timed = (fn, isProgram) => function (obj, ...rest) {
    const o = isProgram ? rec(obj) : rec(shaderOf.get(obj));
    if (!o || o.done) return fn.call(this, obj, ...rest);
    const t0 = performance.now(); const r = fn.call(this, obj, ...rest); o.entry.ms += performance.now() - t0;
    if (isProgram && rest[0] === this.LINK_STATUS) o.done = true;
    return r;
  };
  const att2 = P.attachShader;
  P.attachShader = function (pr, sh) { shaderOf.set(sh, pr); return att2.call(this, pr, sh); };
  P.getProgramParameter = timed(gpp, true);
  P.getProgramInfoLog = timed(gpl, true);
  P.getShaderInfoLog = timed(P.getShaderInfoLog, false);
});
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.goto(base, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction('window.__inkwave && __inkwave.bootMs', { timeout: 900000, polling: 250 });
const { profile: prof } = await cdp.send('Profiler.stop');
const marks = await page.evaluate(() => ({ bootMs: __inkwave.bootMs, marks: __inkwave.bootMarks }));
const shaderLog = await page.evaluate(() => window.__shaderLog || null);
await browser.close();
if (out) writeFileSync(out, JSON.stringify(prof));

// self time per node from the sample stream
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000;
  self.set(prof.samples[i], (self.get(prof.samples[i]) || 0) + dt);
}
const fn = new Map(), file = new Map();
let total = 0;
for (const [id, ms] of self) {
  const n = byId.get(id); if (!n) continue;
  const cf = n.callFrame;
  total += ms;
  if (cf.functionName === '(idle)' || cf.functionName === '(program)') { fn.set(cf.functionName, (fn.get(cf.functionName) || 0) + ms); continue; }
  const src = cf.url ? cf.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '') : '(native)';
  const key = `${cf.functionName || '(anonymous)'}  ${src}${cf.url ? ':' + (cf.lineNumber + 1) : ''}`;
  fn.set(key, (fn.get(key) || 0) + ms);
  file.set(src, (file.get(src) || 0) + ms);
}
const fmt = (m) => `${m.toFixed(0).padStart(7)} ms`;
console.log(`boot ${marks.bootMs} ms · profiled ${total.toFixed(0)} ms (${profileName}${settings ? ' ' + settings : ''})`);
console.log('stages:', marks.marks.map(([l, t], i, a) => `${l} ${t - (i ? a[i - 1][1] : 0)}`).join(' | '));
console.log('\n-- self time by function');
for (const [k, v] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(fmt(v), k);
if (shaderLog) {
  const byStage = new Map();
  for (const s of shaderLog) { const o = byStage.get(s.stage) || { n: 0, ms: 0 }; o.n++; o.ms += s.ms; byStage.set(s.stage, o); }
  console.log('\n-- shader compile by loading stage (the label on screen while it compiled)');
  for (const [k, v] of byStage) console.log(fmt(v.ms), `×${v.n}`.padStart(4), k);
  const byName = new Map();
  let sum = 0;
  for (const s of shaderLog) { const o = byName.get(s.name) || { n: 0, ms: 0, len: 0 }; o.n++; o.ms += s.ms; o.len = Math.max(o.len, s.len); byName.set(s.name, o); sum += s.ms; }
  console.log(`\n-- shader programs: ${shaderLog.length} linked, ${sum.toFixed(0)} ms blocked on compile/link`);
  for (const [k, v] of [...byName].sort((a, b) => b[1].ms - a[1].ms).slice(0, 40)) console.log(fmt(v.ms), `×${v.n}`.padStart(4), `${(v.len / 1024).toFixed(0).padStart(4)} KB src`, k);
}
console.log('\n-- self time by file');
for (const [k, v] of [...file].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(fmt(v), k);

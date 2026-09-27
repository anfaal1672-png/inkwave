// CPU cost of one game frame without the draw: boots into a live round on autopilot, freezes the clock, then runs
// --frames frames of the whole per-frame update (match + bots + physics + paint + fx + HUD + minimap …) at a fixed
// 1/--fps step with rendering skipped. Software WebGL makes the rendered frame rate meaningless here; this number is
// not — it is the main-thread budget the frame loop eats before three.js draws anything.
// usage: node tools/bench-frame.mjs [--profile mobile] [--settings '{"quality":"low"}'] [--frames 240] [--fps 30]
//                                   [--url http://localhost:8490/] [--top 30] [--map tidewater] [--render]
//   --render: draw every frame too (fewer frames: software WebGL is slow). The main thread only queues GL commands, so
//             the JS side of three.js (culling, sorting, uniforms, state) shows up while the GPU work mostly does not.
// Prints ms per frame (mean / p95) and, from a CPU profile of the run, self time per function and per file.
import puppeteer from 'puppeteer-core';
import { launchOptions, applyProfile, PROFILES } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const profileName = opt('profile', 'mobile');
const profile = PROFILES[profileName];
const settings = opt('settings', '{"quality":"low","fovMode":"h"}');
const withRender = args.includes('--render');
const frames = +opt('frames', withRender ? 20 : 240), fps = +opt('fps', 30), top = +opt('top', 30);
const u = new URL(opt('url', 'http://localhost:8490/'));
u.searchParams.set('autostart', '300'); u.searchParams.set('autopilot', '');
if (opt('map', null)) u.searchParams.set('map', opt('map'));

const browser = await puppeteer.launch({ ...launchOptions({ width: profile.width, height: profile.height }), protocolTimeout: 1800000 });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await applyProfile(page, profile);
await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('inkwave.settings', v); } catch { /* ignore */ } }, settings);
await page.goto(u.href, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction('window.__inkwave && __inkwave.match && __inkwave.match.state === "playing" && __inkwave.match.local', { timeout: 900000, polling: 250 });
await new Promise((r) => setTimeout(r, 2000));
// the clock stays frozen from the warm-up to the end, so the profile holds nothing but the benchmarked frames
const run = (n) => page.evaluate((n, fps, withRender) => {
  const g = window.__inkwave;
  g.debug.freeze(); g._skipRender = !withRender;
  const t = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); g._frame(1 / fps); t.push(performance.now() - a); }
  g._skipRender = false;
  return t;
}, n, fps, withRender);
await run(withRender ? 5 : 60); // warm-up (JIT, first-use allocations)
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const t = await run(frames);
const { profile: prof } = await cdp.send('Profiler.stop');
await browser.close();

const s = [...t].sort((a, b) => a - b);
const mean = t.reduce((a, b) => a + b, 0) / t.length;
console.log(`${profileName} ${settings}${withRender ? ' · with render' : ''} · ${frames} frames at 1/${fps} s · ms/frame mean ${mean.toFixed(2)} · p50 ${s[Math.floor(s.length * 0.5)].toFixed(2)} · p95 ${s[Math.floor(s.length * 0.95)].toFixed(2)} · max ${s[s.length - 1].toFixed(2)}`);
if (errors.length) console.log('page errors:', errors);

const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) || 0) + (prof.timeDeltas[i + 1] ?? 0) / 1000);
const fn = new Map(), file = new Map();
let total = 0;
for (const [id, ms] of self) {
  const cf = byId.get(id)?.callFrame; if (!cf) continue;
  if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
  total += ms;
  const src = cf.url ? cf.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '') : '(native)';
  const key = `${cf.functionName || '(anonymous)'}  ${src}${cf.url ? ':' + (cf.lineNumber + 1) : ''}`;
  fn.set(key, (fn.get(key) || 0) + ms);
  file.set(src, (file.get(src) || 0) + ms);
}
const per = (ms) => `${(ms / frames).toFixed(2).padStart(6)} ms/frame`;
console.log(`\n-- self time by function (profiled ${total.toFixed(0)} ms)`);
for (const [k, v] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(per(v), k);
console.log('\n-- self time by file');
for (const [k, v] of [...file].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(per(v), k);

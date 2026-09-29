// How strong is each autoplay level (Settings → Cheats → Autoplay)? Plays whole matches of your character on autopilot
// against the enemy bots and prints a table per level: win rate, kills, deaths, K/D, and your team's share of the turf.
// The rounds run headless with rendering skipped: the clock is frozen and every frame is stepped by hand at a fixed
// 1/30 s (the same trick as bench-frame.mjs), so a 60 s match costs a few seconds of CPU instead of software-WebGL time.
// usage: node tools/autoplay-eval.mjs [--levels 1,3,5] [--runs 3] [--maps tidewater,kelpline] [--port 8490]
//                                     [--difficulty hard] [--duration 60] [--weapons shooter,roller] [--fps 30] [--parallel 3]
//   --parallel N  plays N levels at once, each in its own browser (software rendering is CPU-bound: keep N below the cores)
//   --url http://host:port/   overrides --port. The dev server has to serve the code you want measured
//                             (python3 tools/serve.py <port>). --weapons cycles through the list, one per run.
import puppeteer from 'puppeteer-core';
import { launchOptions } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const levels = opt('levels', '1,3,5').split(',').map(Number);
const runs = +opt('runs', 3);
const maps = opt('maps', 'tidewater,kelpline').split(',');
const weapons = opt('weapons', 'shooter').split(',');
const difficulty = opt('difficulty', 'hard');
const duration = +opt('duration', 60);
const fps = +opt('fps', 30);
const parallel = Math.max(1, +opt('parallel', 1));
const base = opt('url', `http://localhost:${opt('port', 8490)}/`);

// one browser per level: a background tab gets no animation frames, and the game boots on them
async function evalLevel(level) {
  const browser = await puppeteer.launch({ ...launchOptions({ width: 960, height: 540 }), protocolTimeout: 3600000 });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('inkwave.settings', v); } catch { /* ignore */ } }, JSON.stringify({ quality: 'low', difficulty, fovMode: 'h' }));
  const u = new URL(base);
  u.searchParams.set('autopilot', String(level)); u.searchParams.set('skipTitle', '');
  await page.goto(u.href, { waitUntil: 'load', timeout: 600000 });
  await page.waitForFunction('window.__inkwave && __inkwave.api && __inkwave.debug', { timeout: 900000, polling: 250 });
  await page.evaluate(() => window.__inkwave.debug.freeze());
  const rows = [];
  let n = 0;
  for (const map of maps) {
    for (let r = 0; r < runs; r++, n++) {
      const weapon = weapons[n % weapons.length];
      const t0 = Date.now();
      await page.evaluate((o) => { const g = window.__inkwave; g.profile.weapon = o.weapon; return g.api.startMatch({ mapId: o.map, difficulty: o.difficulty, duration: o.duration }); }, { map, weapon, difficulty, duration });
      await page.waitForFunction('__inkwave.match && !__inkwave.match.attract && __inkwave.match.state !== "init"', { timeout: 600000, polling: 100 });
      // step by hand until the judge (intro 4.2 s + the match + time's up 2.6 s)
      const total = Math.ceil((duration + 12) * fps);
      for (let done = 0; done < total; done += 300) {
        const fin = await page.evaluate((k, fps) => {
          const g = window.__inkwave; g._skipRender = true;
          const M = (window.__modes ||= {});
          for (let i = 0; i < k; i++) {
            g._frame(1 / fps);
            const b = g.match.local?.bot;
            if (b && g.match.state === 'playing') M[b.mode] = (M[b.mode] || 0) + 1;
            if (g.match.state === 'judge' || g.match.state === 'results') break;
          }
          g._skipRender = false;
          return g.match.state === 'judge' || g.match.state === 'results';
        }, 300, fps);
        if (fin) break;
      }
      const res = await page.evaluate(() => {
        const M = window.__modes || {}; window.__modes = {};
        const tot = Object.values(M).reduce((x, y) => x + y, 0) || 1;
        const modes = Object.entries(M).map(([k, v]) => k + ' ' + Math.round(v / tot * 100) + '%').join(' ');
        const m = window.__inkwave.match, a = m.local, mates = m.actors.filter((o) => o.team === a.team && o !== a);
        const mateTurf = mates.reduce((x, o) => x + o.stats.turf, 0) / Math.max(1, mates.length);
        const cov = m.result ? m.result.coverage : window.__G.paint.coverage();
        return { state: m.state, winner: m.result ? m.result.winner : -1, modes, mateTurf, k: a.stats.splats, d: a.stats.deaths, turf: a.stats.turf, cov0: cov[0], cov1: cov[1], team: a.team };
      });
      if (res.state !== 'judge' && res.state !== 'results') console.error(`level ${level} ${map} #${r}: match did not finish (state ${res.state})`);
      rows.push({ ...res, map, weapon });
      console.error(`  L${level} ${map} ${weapon} #${r + 1}: ${res.winner === res.team ? 'WIN ' : 'lose'}  K${res.k} D${res.d}  turf ${(res.cov0 * 100).toFixed(0)}% vs ${(res.cov1 * 100).toFixed(0)}%  pts ${res.turf.toFixed(0)} (mates ${res.mateTurf.toFixed(0)})  ${res.modes}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
  if (errors.length) console.error(`level ${level} page errors:`, [...new Set(errors)].slice(0, 5));
  await browser.close();
  return rows;
}

const results = new Map();
const queue = [...levels];
await Promise.all(Array.from({ length: Math.min(parallel, levels.length) }, async () => {
  while (queue.length) { const lv = queue.shift(); results.set(lv, await evalLevel(lv)); }
}));
const table = levels.map((lv) => {
  const rows = results.get(lv);
  const N = rows.length, sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  return {
    level: lv, matches: N, wins: sum((r) => (r.winner === r.team ? 1 : 0)),
    K: sum((r) => r.k) / N, D: sum((r) => r.d) / N, KD: sum((r) => r.k) / Math.max(1, sum((r) => r.d)),
    turf: sum((r) => r.cov0) / N * 100, enemyTurf: sum((r) => r.cov1) / N * 100, points: sum((r) => r.turf) / N,
  };
});

const f = (v, w, p = 1) => v.toFixed(p).padStart(w);
console.log(`\nautoplay vs ${difficulty} enemies · ${duration} s matches · maps ${maps.join(',')} · weapons ${weapons.join(',')} · ${runs} run(s) per map`);
console.log('level  matches  win rate   K/match  D/match   K/D   your turf  enemy turf  your points');
for (const t of table) {
  console.log(`${String(t.level).padStart(5)}  ${String(t.matches).padStart(7)}  ${f(t.wins / t.matches * 100, 6, 0)}%   ${f(t.K, 7)}  ${f(t.D, 7)}  ${f(t.KD, 5, 2)}  ${f(t.turf, 8)}%  ${f(t.enemyTurf, 9)}%  ${f(t.points, 10, 0)}`);
}

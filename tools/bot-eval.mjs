// How good are the enemy / ally bots at painting and fighting? Plays whole all-bot matches (?autopilot: your own
// character is a bot too, at the match difficulty) with rendering skipped and every frame stepped by hand at a fixed
// 1/30 s (same trick as autoplay-eval.mjs), and prints one table row per map plus a total:
//   painted   share of the turf that is covered by either team at the end (less bare ground = better painters)
//   kills/min per bot     ink eff.   turf area painted per 100 ink spent (summed over the frames the ink dropped)
//   modes      share of bot-frames per BotBrain mode        stuck   share of bot-frames with noProg > 1.5 s
//   ms/bot     mean CPU time of one bot's update() (performance.now around it)
// usage: node tools/bot-eval.mjs [--runs 3] [--maps tidewater,kelpline] [--difficulty hard] [--duration 90]
//                                [--fps 30] [--port 8490] [--url http://localhost:8493/] [--parallel 2] [--json]
//                                [--weapons random] [--focus brush,wiper] [--out per-weapon.json] [--chunk 3]
//   --url points at another checkout (python3 tools/serve.py 8493 in a git worktree) for a before / after comparison.
//   --weapons random prints a per-weapon table (kills, deaths, K/D, turf/min, win%, modes) instead of the per-map one,
//   for weapon balance; --chunk N restarts the browser every N matches of a map so --parallel can split one map.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { launchOptions } from './browser.mjs';
import { WEAPONS, WEAPON_ORDER } from '../src/config.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const runs = +opt('runs', 3);
const maps = opt('maps', 'tidewater,kelpline').split(',');
const difficulty = opt('difficulty', 'hard');
const duration = +opt('duration', 90);
const fps = +opt('fps', 30);
const parallel = Math.max(1, +opt('parallel', 1));
const base = opt('url', `http://localhost:${opt('port', 8490)}/`);
const asJson = args.includes('--json');
// --weapons random: all 8 bots get random weapons (distinct kinds within a team, least-used first so every weapon appears
// about equally often) and the run prints a per-weapon table; --out <file> also writes it as JSON.
const randomWeapons = opt('weapons', '') === 'random';
// --focus brush,wiper: with --weapons random, every match puts these weapons on the teams (team t gets focus[t]) so a
// few runs are enough to judge them; the rest of each team is drawn as usual
const focus = opt('focus', '') ? opt('focus', '').split(',') : [];
const outFile = opt('out', '');
const chunk = Math.max(1, +opt('chunk', runs));
const used = Object.fromEntries(WEAPON_ORDER.map((id) => [id, 0]));
const pickWeapons = () => {
  const teams = [];
  for (let t = 0; t < 2; t++) {
    const kinds = new Set(), out = [];
    const kindOf = (id) => WEAPONS[id].icon || WEAPONS[id].kind;   // brush / wiper / … count as their own kind
    if (focus.length) { const id = focus[t % focus.length]; out.push(id); kinds.add(kindOf(id)); used[id]++; }
    while (out.length < 4) {
      const pool = WEAPON_ORDER.filter((id) => !kinds.has(kindOf(id))).sort((a, b) => used[a] - used[b] + (Math.random() - 0.5) * 0.9);
      const id = pool[0]; out.push(id); kinds.add(kindOf(id)); used[id]++;
    }
    teams.push(out);
  }
  return teams;
};

async function evalMap(map, runs) {
  const browser = await puppeteer.launch({ ...launchOptions({ width: 960, height: 540 }), protocolTimeout: 3600000 });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('inkwave.settings', v); } catch { /* ignore */ } }, JSON.stringify({ quality: 'low', difficulty, fovMode: 'h' }));
  const u = new URL(base);
  u.searchParams.set('autopilot', ''); u.searchParams.set('skipTitle', '');
  await page.goto(u.href, { waitUntil: 'load', timeout: 600000 });
  await page.waitForFunction('window.__inkwave && __inkwave.api && __inkwave.debug', { timeout: 900000, polling: 250 });
  await page.evaluate(() => window.__inkwave.debug.freeze());
  const rows = [];
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now();
    await page.evaluate((o) => window.__inkwave.api.startMatch({ mapId: o.map, difficulty: o.difficulty, duration: o.duration }), { map, difficulty, duration });
    await page.waitForFunction('__inkwave.match && !__inkwave.match.attract && __inkwave.match.state !== "init"', { timeout: 600000, polling: 100 });
    if (randomWeapons) {
      const teams = pickWeapons();
      await page.evaluate((teams) => {
        const cnt = [0, 0];
        for (const a of window.__inkwave.match.actors) a.setWeapon(teams[a.team][cnt[a.team]++]);
      }, teams);
    }
    // instrument: time each bot's update, remember the ink of every actor, count modes
    await page.evaluate(() => {
      const g = window.__inkwave;
      const S = window.__bs = { wm: {}, modes: {}, frames: 0, stuck: 0, botFrames: 0, ink: 0, upMs: 0, upN: 0, prev: new Map() };
      for (const a of g.match.actors) {
        if (!a.bot) continue;
        const b = a.bot, orig = b.update;
        b.update = function (dt) { const t = performance.now(); orig.call(this, dt); S.upMs += performance.now() - t; S.upN++; };
        S.prev.set(a, a.ink);
      }
    });
    const total = Math.ceil((duration + 12) * fps);
    for (let done = 0; done < total; done += 300) {
      const fin = await page.evaluate((k, fps) => {
        const g = window.__inkwave; g._skipRender = true;
        const S = window.__bs;
        // paint splats are GPU draws: with rendering skipped nothing else flushes them, and 300 frames of queued ink
        // (sprinklers, brushes…) has made SwiftShader drop the WebGL context mid-run — drain the queue every 30 frames
        const gl = window.__G.renderer.getContext();
        for (let i = 0; i < k; i++) {
          if (i % 30 === 29) gl.finish();
          g._frame(1 / fps);
          if (g.match.state === 'playing') {
            for (const a of g.match.actors) {
              const b = a.bot; if (!b || !a.alive) continue;
              S.botFrames++;
              S.modes[b.mode] = (S.modes[b.mode] || 0) + 1;
              const wm = S.wm[a.weaponId] || (S.wm[a.weaponId] = {}); wm[b.mode] = (wm[b.mode] || 0) + 1;
              if (b.noProg > 1.5) S.stuck++;
              const p = S.prev.get(a); if (p > a.ink) S.ink += p - a.ink;
              S.prev.set(a, a.ink);
            }
          }
          if (g.match.state === 'judge' || g.match.state === 'results') break;
        }
        g._skipRender = false;
        return g.match.state === 'judge' || g.match.state === 'results';
      }, 300, fps);
      if (fin) break;
    }
    const res = await page.evaluate(() => {
      const S = window.__bs, m = window.__inkwave.match;
      const cov = m.result ? m.result.coverage : window.__G.paint.coverage();
      const bots = m.actors.filter((o) => o.bot);
      const turf = bots.reduce((x, o) => x + o.stats.turf, 0);
      const kills = bots.reduce((x, o) => x + o.stats.splats, 0);
      const players = m.actors.map((o) => ({ id: o.weaponId, team: o.team, kills: o.stats.splats, deaths: o.stats.deaths, turf: o.stats.turf, specials: o.stats.specials }));
      return { players, winner: m.result ? m.result.winner : -1, wm: S.wm, state: m.state, cov0: cov[0], cov1: cov[1], turf, kills, nBots: bots.length, S: { modes: S.modes, botFrames: S.botFrames, stuck: S.stuck, ink: S.ink, upMs: S.upMs, upN: S.upN } };
    });
    if (res.state !== 'judge' && res.state !== 'results') console.error(`${map} #${r}: match did not finish (state ${res.state})`);
    rows.push({ ...res, map });
    console.error(`  ${map} #${r + 1}: painted ${((res.cov0 + res.cov1) * 100).toFixed(0)}%  kills ${res.kills}  eff ${(res.turf / Math.max(1, res.S.ink) * 100).toFixed(1)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (errors.length) console.error(`${map} page errors:`, [...new Set(errors)].slice(0, 5));
  await browser.close();
  return rows;
}

const results = new Map();
const queue = [];
for (const m of maps) { results.set(m, []); for (let left = runs; left > 0; left -= chunk) queue.push([m, Math.min(chunk, left)]); }
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
  while (queue.length) { const [m, n] = queue.shift(); results.get(m).push(...await evalMap(m, n)); }
}));

const summarize = (rows) => {
  const N = rows.length, sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const bf = sum((r) => r.S.botFrames) || 1;
  const modes = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.S.modes)) modes[k] = (modes[k] || 0) + v;
  return {
    matches: N,
    painted: sum((r) => r.cov0 + r.cov1) / N * 100,
    perBotPoints: sum((r) => r.turf / r.nBots) / N,
    killsPerMinPerBot: sum((r) => r.kills / r.nBots) / N / (duration / 60),
    inkEff: sum((r) => r.turf) / Math.max(1, sum((r) => r.S.ink)) * 100,
    stuck: sum((r) => r.S.stuck) / bf * 100,
    msPerBot: sum((r) => r.S.upMs) / Math.max(1, sum((r) => r.S.upN)),
    modes: Object.fromEntries(Object.entries(modes).map(([k, v]) => [k, v / bf * 100])),
  };
};
if (randomWeapons) {
  const W = {};
  const wmAll = {};
  for (const r of [...results.values()].flat()) {
    for (const p of r.players) {
      const w = W[p.id] || (W[p.id] = { n: 0, kills: 0, deaths: 0, turf: 0, specials: 0, wins: 0 });
      w.n++; w.kills += p.kills; w.deaths += p.deaths; w.turf += p.turf; w.specials += p.specials; if (p.team === r.winner) w.wins++;
    }
    for (const [id, m] of Object.entries(r.wm)) for (const [k, v] of Object.entries(m)) { const o = wmAll[id] || (wmAll[id] = {}); o[k] = (o[k] || 0) + v; }
  }
  const min = duration / 60;
  const rows = WEAPON_ORDER.filter((id) => W[id]).map((id) => {
    const w = W[id], tot = Object.values(wmAll[id] || {}).reduce((x, y) => x + y, 0) || 1;
    const md = Object.fromEntries(['paint', 'fight', 'retreat', 'refill', 'hunt', 'ambush'].map((k) => [k, ((wmAll[id] || {})[k] || 0) / tot * 100]));
    return { id, n: w.n, kpm: w.kills / w.n / min, dpm: w.deaths / w.n / min, kd: w.kills / Math.max(1, w.deaths), tpm: w.turf / w.n / min, sp: w.specials / w.n, win: w.wins / w.n * 100, modes: md };
  });
  const med = [...rows].map((r) => r.tpm).sort((a, b) => a - b)[rows.length >> 1];
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ duration, median_tpm: med, rows }, null, 1));
  console.log(`\nper weapon · ${difficulty} · ${duration} s · ${[...results.values()].flat().length} matches · median turf/min ${med.toFixed(0)}`);
  console.log('| weapon | n | kills/min | deaths/min | K/D | turf/min | vs median | specials | win% | paint/fight/retreat/refill/hunt/ambush % |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.n} | ${r.kpm.toFixed(2)} | ${r.dpm.toFixed(2)} | ${r.kd.toFixed(2)} | ${r.tpm.toFixed(0)} | ${((r.tpm / med - 1) * 100).toFixed(0)}% | ${r.sp.toFixed(1)} | ${r.win.toFixed(0)} | ${Object.values(r.modes).map((v) => v.toFixed(0)).join('/')} |`);
  process.exit(0);
}
const perMap = maps.map((m) => [m, summarize(results.get(m))]);
const all = summarize([...results.values()].flat());
if (asJson) { console.log(JSON.stringify({ perMap: Object.fromEntries(perMap), all }, null, 1)); process.exit(0); }
const f = (v, w, p = 1) => v.toFixed(p).padStart(w);
const modeStr = (s) => ['paint', 'fight', 'retreat', 'refill', 'hunt', 'ambush'].map((k) => `${k.slice(0, 3)} ${(s.modes[k] || 0).toFixed(1)}`).join(' ');
console.log(`\nbot-eval · ${base} · all-bot ${difficulty} matches · ${duration} s · ${runs} run(s) per map`);
console.log('map          painted%  pts/bot  kills/min/bot  ink eff (pts/100 ink)  stuck%  ms/bot   modes % (paint fight retreat refill hunt ambush)');
for (const [m, s] of [...perMap, ['ALL', all]]) {
  console.log(`${m.padEnd(11)}  ${f(s.painted, 8)}  ${f(s.perBotPoints, 7, 0)}  ${f(s.killsPerMinPerBot, 13, 2)}  ${f(s.inkEff, 21)}  ${f(s.stuck, 6)}  ${f(s.msPerBot, 6, 3)}   ${modeStr(s)}`);
}

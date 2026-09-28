// Cheats (Settings → Cheats tab). Session-only: every switch starts off on each load and is never saved, so a
// forgotten "invincible" never follows a player into the next session.
//
// The switches live in CHEATS (keys prefixed "cheat"; main.js mirrors them into the settings object the menus read,
// and leaves them out of what it saves). The game code reads them where each rule lives:
//   actor.js    invincible (you / your team), respawn time, move speed, jump height, gravity
//   weapons.js  fire rate, damage, steady aim (no spread)
//   player.js   aimbot (+ auto-fire)
//   match.js    enemies frozen / passive, timer stopped
//   paint.js    ink splat size (your team)
//   main.js     slow motion, and tickCheats() once a frame for the "keep it full" ones (ink, special)
// One-shot actions (paint the stage, +1 minute, end the match) run through runCheat().
import { G } from '../core/ctx.js';

export const CHEAT_DEFAULTS = {
  cheatGod: false, cheatTeamGod: false, cheatInk: false, cheatSpecial: false, cheatRespawn: false, cheatSteady: false,
  cheatSpeed: 1, cheatJump: 1, cheatGravity: 1, cheatFire: 1, cheatDamage: 1, cheatPaint: 1,
  cheatAimbot: false, cheatAutoFire: false,
  cheatFreeze: false, cheatPassive: false, cheatTimer: false, cheatSlowmo: 1,
};
export const CHEATS = { ...CHEAT_DEFAULTS };
export const isCheatKey = (k) => typeof k === 'string' && k.startsWith('cheat');

const local = () => G.match && !G.match.attract ? G.match.local : null;
const localTeam = () => local()?.team ?? 0;

/** Is this actor protected from damage by a cheat? */
export const cheatInvincible = (a) => !!a && ((CHEATS.cheatGod && a.isLocal) || (CHEATS.cheatTeamGod && !G.match?.attract && a.team === localTeam()));
/** Multiplier for the local player's movement (1 for everyone else). */
export const cheatMove = (a, k) => (a && a.isLocal && !G.match?.attract ? CHEATS[k] : 1);
/** Does a bot on the enemy team stand still / hold its fire? */
export const cheatEnemyFrozen = (a) => CHEATS.cheatFreeze && !G.match?.attract && a.team !== localTeam();
export const cheatEnemyPassive = (a) => CHEATS.cheatPassive && !G.match?.attract && a.team !== localTeam();
/** Ink splat radius multiplier for a team. */
export const cheatPaint = (team) => (CHEATS.cheatPaint !== 1 && !G.match?.attract && team === localTeam() ? CHEATS.cheatPaint : 1);

/** Once a frame (main.js): keep the local player's ink / special topped up. */
export function tickCheats() {
  const a = local();
  if (!a || !a.alive) return;
  if (CHEATS.cheatInk) a.ink = 100;
  if (CHEATS.cheatSpecial && !a.specialActive && a.special < a.specialCost()) {
    a.special = a.specialCost();
  }
}

// ---- one-shot actions
let _fill = null;
/** Paint every turf face of the stage in your team's ink, a slice per frame (a few thousand splats). */
function paintStage() {
  const P = G.paint, a = local();
  if (!P || !a || _fill) return false;
  const pts = [];
  for (const f of P.paintFaces || []) {
    if (!f.turf) continue;
    const step = 1.1;
    for (let i = step / 2; i < f.su; i += step) {
      for (let j = step / 2; j < f.sv; j += step) {
        pts.push([
          f.origin.x + f.u.x * i + f.v.x * j + f.n.x * 0.08,
          f.origin.y + f.u.y * i + f.v.y * j + f.n.y * 0.08,
          f.origin.z + f.u.z * i + f.v.z * j + f.n.z * 0.08,
        ]);
      }
    }
  }
  _fill = { pts, i: 0, team: a.team };
  return true;
}
/** Advance a running stage fill (main.js calls this with tickCheats). */
export function tickFill(v) {
  if (!_fill || !G.paint) return;
  const end = Math.min(_fill.pts.length, _fill.i + 160);
  for (; _fill.i < end; _fill.i++) {
    const p = _fill.pts[_fill.i];
    G.paint.splat(v.set(p[0], p[1], p[2]), 1.0, _fill.team, { seed: Math.random() });
  }
  if (_fill.i >= _fill.pts.length) _fill = null;
}

/** Run a one-shot cheat. Returns false when it cannot run now (no live match). */
export function runCheat(id) {
  const m = G.match;
  if (!m || m.attract) return false;
  if (id === 'paint') return paintStage();
  if (id === 'time') { if (m.state !== 'playing') return false; m.time += 60; m.duration += 60; return true; }
  if (id === 'end') { if (m.state !== 'playing') return false; m.time = 0.05; return true; }
  if (id === 'refill') {
    const a = m.local;
    if (!a || !a.alive) return false;
    a.hp = 100; a.ink = 100; a.special = a.specialCost();
    return true;
  }
  return false;
}

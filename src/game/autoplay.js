// Autoplay (Settings → Cheats → Autoplay): a bot plays your own character. Levels 1–4 are the ordinary BotBrain
// (bots.js) with the AUTOPLAY table's reaction / aim numbers; level 5 is the ApexBrain below. It is the same physics
// and the same weapons as everyone else — what it has over the enemy bots is information and precision:
//   · it knows where every enemy is (walls do not hide them) and picks the one it can kill soonest
//   · its shots come from aimbot.js (lead, arcs, lobs over cover) and it aims with no spring
//   · it steps out of the way of incoming shots, keeps to the edge of an enemy weapon's reach, and uses bombs and
//     specials by rule rather than by dice
// player.js swaps it in for the human while cheatAutoplay is on, and hands control back for a moment on any input.
import * as THREE from 'three';
import { G, clamp, angleDiff } from '../core/ctx.js';
import { PLAYER, AUTOPLAY, SUB, SPECIALS } from '../config.js';
import { CHEATS } from './cheats.js';
import { BotBrain } from './bots.js';
import { solveWeapon, weaponReach, autoFire } from './aimbot.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _mz = new THREE.Vector3(), _c = new THREE.Vector3();
const _stats = { own: 0, enemy: 0, empty: 0, n: 0 };
const HITTERS = new Set(['shot', 'slosh', 'blast', 'drop']);   // projectile types that damage on contact
const BOMB_G = 24;                                            // Projectiles._updateBombs gravity

/** The AUTOPLAY row picked in the cheat menu. */
export const autoplayLevel = () => AUTOPLAY[clamp(Math.round(CHEATS.cheatAutoplayLevel) || 3, 1, 5) - 1];

export function makeAutoBrain(actor, lvl) {
  return lvl.apex ? new ApexBrain(actor, lvl) : new BotBrain(actor, lvl);
}

// rough damage per second of a weapon, for "how long to kill" estimates
function dps(w) {
  switch (w.kind) {
    case 'charger': return w.damageMax / (w.chargeTime + 0.3);
    case 'roller': return w.rollDamage / w.flickInterval;
    case 'blaster': return w.directDamage / w.fireInterval;
    case 'slosher': return w.damageHead / w.fireInterval;
    default: return w.damage / w.fireInterval;
  }
}

export class ApexBrain extends BotBrain {
  reset() {
    super.reset();
    this.dodgeT = 0; this.dodgeDir = new THREE.Vector3(); this.scanT = 0; this.paintT = 0; this.needPaint = false;
    this.lock = { enemy: null }; this.los = false;
    this.bombT = 2; this.bombPhase = 0; this.bombPitch = 0;
  }

  update(dt) {
    this._apexPre(dt);
    super.update(dt);
    this._apexPost(dt);
  }

  // ---- overridden rules --------------------------------------------------------------------------------------

  _retreatWanted(hpFrac, w) {
    const t = this.target;
    // hurt and the duel is not about to be won: one more hit finishes it, or 0.6 s of fire does
    return hpFrac < 0.4 && !!t && t.hp > Math.max(w.damage || w.directDamage || w.damageHead || 100, dps(w) * 0.6) && this.a.lastDamage < 0.8;
  }
  _refillWanted(inkFrac) { return inkFrac < 0.25 && !this._enemyNear(this.a.pos, 7); }
  // keep to the edge of the enemy weapon's reach when ours is longer; close in fast when it is shorter
  _prefDist(w, range) {
    const t = this.target;
    if (!t || w.kind === 'roller') return super._prefDist(w, range);
    const mine = weaponReach(w), theirs = weaponReach(t.weapon);
    return mine >= theirs ? Math.min(mine * 0.85, theirs + 1.5) : 1;
  }

  // pick the enemy to kill next (no line of sight needed: this bot knows where everyone is)
  _perceive() {
    const a = this.a, w = a.weapon;
    const muzzle = G.projectiles._muzzle(a, _mz);
    const delay = w.kind === 'slosher' ? w.windup || 0.13 : w.kind === 'roller' ? w.flickWindup || 0.15 : 0.02;
    const reach = weaponReach(w), mineDps = dps(w);
    let best = null, bestScore = -Infinity, near = null, nearD = Infinity;
    for (const e of G.actors) {
      if (e.team === a.team || !e.alive) continue;
      const d = e.pos.distanceTo(a.pos);
      // submerged in its own ink nothing can hit it
      if (e.anim.form === 'swim' && d > 3) continue;
      if (d < nearD) { nearD = d; near = e; }
      if (d > reach) continue;
      if (!solveWeapon(a, e, muzzle, delay)) continue;
      const ttk = e.hp / Math.max(1, mineDps);
      const onMe = Math.abs(angleDiff(e.aimYaw, Math.atan2(a.pos.x - e.pos.x, a.pos.z - e.pos.z))) < 0.35;
      const score = 100 - ttk * 4 - d * 0.3 + (onMe ? 3 : 0) + (1 - e.hp / PLAYER.hp) * 6 + (e === this.target ? 2 : 0) - (e.invuln > 0 ? 60 : 0);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    // nobody hittable: walk toward the nearest one if it is close, otherwise go back to painting
    const pick = best || (nearD < 12 ? near : null);
    if (pick !== this.target) { this.target = pick; this.repath = 0; }
    if (pick) {
      this.seeTimer = 1.2; this.react = -1; this.lostTimer = 0;
      _c.set(pick.pos.x, pick.pos.y + (pick.form === 'squid' ? 0.3 : 1.0), pick.pos.z);
      this.los = G.physics.los(_v.set(a.pos.x, a.pos.y + 1.3, a.pos.z), _c);
    } else this.seeTimer = 0;
  }

  // ---- before the base update: what is coming at me? ----------------------------------------------------------

  _apexPre(dt) {
    const a = this.a;
    this.dodgeT -= dt; this.scanT -= dt; this.bombT -= dt; this.paintT -= dt;
    if (!a.alive || a.superJumpState) return;
    // a refill started with an enemy on top of us is not worth finishing
    if (this.mode === 'refill' && a.ink > 8 && this._enemyNear(a.pos, 7)) this.mode = 'paint';
    if (this.scanT <= 0 && this.dodgeT <= 0) { this.scanT = 0.05; this._scanShots(); }
    if (this.paintT <= 0) {
      this.paintT = 0.5;
      this.needPaint = G.paint.regionStats(a.pos.x, a.pos.y, a.pos.z, 5, a.team, _stats).own < 0.4;
    }
  }

  // The first enemy round that will pass through my body in the next 0.5 s → a sidestep, 0.25 s long, toward the side
  // with ground under it and (all else equal) more of my ink.
  _scanShots() {
    const a = this.a, list = G.projectiles.list;
    const cx = a.pos.x, cy = a.pos.y + 0.8, cz = a.pos.z;
    let bestT = Infinity, hx = 0, hz = 0, sx = 0, sz = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.team === a.team || !HITTERS.has(p.type)) continue;
      const rx = p.pos.x - cx, ry = p.pos.y - cy, rz = p.pos.z - cz;
      const vx = p.vel.x, vy = p.vel.y, vz = p.vel.z;
      const vv = vx * vx + vy * vy + vz * vz;
      if (vv < 1) continue;
      const t = clamp(-(rx * vx + ry * vy + rz * vz) / vv, 0, 0.5);
      const dx = rx + vx * t, dy = ry + vy * t, dz = rz + vz * t;
      const R = 0.6 + p.radius;
      if (dx * dx + dy * dy + dz * dz > R * R || t >= bestT) continue;
      bestT = t; hx = vx; hz = vz; sx = dx; sz = dz;
    }
    if (bestT === Infinity) return;
    const hl = Math.hypot(hx, hz);
    if (hl < 0.5) return;
    const px = -hz / hl, pz = hx / hl;                      // perpendicular to the round's heading
    const away = sx * px + sz * pz > 0 ? -1 : 1;           // the side the round is not passing on
    let pick = 0, ps = -Infinity;
    for (const side of [away, -away]) {
      const ox = a.pos.x + px * side * 1.6, oz = a.pos.z + pz * side * 1.6;
      if (!this._dryLine(a.pos.x, a.pos.y, a.pos.z, ox, oz)) continue;
      const own = G.paint.regionStats(ox, a.pos.y, oz, 1.2, a.team, _stats).own;
      const s = own + (side === away ? 0.5 : 0);
      if (s > ps) { ps = s; pick = side; }
    }
    if (!pick) return;
    this.dodgeDir.set(px * pick, 0, pz * pick);
    this.dodgeT = 0.25;
  }

  // ---- after the base update: aim, fire, sidestep, bombs, specials --------------------------------------------

  _apexPost(dt) {
    const a = this.a, it = a.intent, w = a.weapon;
    if (!a.alive || a.superJumpState || !G.match || !G.match.playing()) { a.aimLock = null; return; }
    const t = this.target;
    const fighting = this.mode === 'fight' && !!t && t.alive;
    const dist = t ? a.pos.distanceTo(t.pos) : 0;
    let sol = null;

    // ---- bomb throw in progress: hold the aim for the release step, no shots meanwhile
    if (this.bombPhase === 1) {
      this.bombPhase = 0; it.sub = false; it.fire = false; a.aimLock = null;
      this._setAim(this.aimYaw, this.bombPitch - 0.28);
      return;
    }
    // ---- exact shot
    if (fighting) {
      const muzzle = G.projectiles._muzzle(a, _mz);
      const delay = w.kind === 'slosher' ? w.windup || 0.13 : w.kind === 'roller' ? w.flickWindup || 0.15 : 0.02;
      sol = solveWeapon(a, t, muzzle, delay);
    }
    if (sol) {
      this.lock.enemy = t; a.aimLock = this.lock;
      _d.copy(sol.point); _d.x -= a.pos.x; _d.y -= a.pos.y + 1.1; _d.z -= a.pos.z;
      this._setAim(Math.atan2(_d.x, _d.z), Math.atan2(_d.y, Math.hypot(_d.x, _d.z)));
      a.aimPoint.copy(sol.point);
      it.fire = a.ink > 1 && autoFire(a, t, dist);
    } else {
      a.aimLock = null;
      // no way to reach it (behind a wall, out of range): keep the ink for painting
      if (fighting && !this.los) it.fire = false;
    }
    if (it.fire) it.squid = false;

    // ---- sidestep incoming shots (shooting continues); with nothing to shoot at, dive into own ink instead
    if (this.dodgeT > 0 && a.grounded && !(a.weaponRunner.charging && w.kind === 'charger')) {
      it.move.copy(this.dodgeDir);
      this._edgeGuard(a, it.move);
      if (!it.fire && a.groundTeam === 1) it.squid = true;
    }

    // ---- sub and special
    this._bomb(t, fighting, dist, it);
    this._special(t, dist, it);
  }

  _setAim(yaw, pitch) {
    const a = this.a;
    this.aimYaw = a.aimYaw = yaw;
    this.aimPitch = a.aimPitch = clamp(pitch, -1.1, 1.0);
  }

  // Splat bomb: at an enemy behind cover, or two of them bunched up. Throws are 13.5 m/s lobs — the pitch that lands
  // the bomb on the target is searched with the game's own integrator (throwVelocity + 24 m/s² gravity).
  _bomb(t, fighting, dist, it) {
    const a = this.a;
    it.sub = false; this._bombAim = this._releaseBomb = false;
    // (the weapon's own sub: a burst bomb is thrown closer, a sprinkler is never thrown at a foe)
    const sub = SUB[a.weapon.sub] || SUB.bomb, burst = sub.id === 'burst';
    if (sub.id === 'sprinkler') return;
    if (!fighting || this.bombT > 0 || a.ink < sub.inkCost + 15 || !a.grounded || a.weaponRunner.charging || dist < (burst ? 3 : 5) || dist > (burst ? 10 : 9.5)) return;
    let bunched = 0;
    for (const e of G.actors) {
      if (e.team === a.team || !e.alive || e === t) continue;
      if (e.pos.distanceToSquared(t.pos) < 9) bunched++;
    }
    if (this.los && bunched === 0 && !(burst && t.hp < 70)) return;   // a burst bomb also finishes a hurt foe in the open
    const p = this._bombSolve(t, sub.throwSpeed);
    this.bombT = p === null ? 0.5 : burst ? 1.5 : 3;
    if (p === null) return;
    this.bombPitch = p;
    this.bombPhase = 1;
    it.sub = true; it.fire = false; a.aimLock = null;
    this._setAim(Math.atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z), p - 0.28);
  }

  // launch pitch that lands a thrown bomb on the target's ground point, or null
  _bombSolve(t, v = SUB.bomb.throwSpeed) {
    const a = this.a;
    const hd = Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z);
    const y0 = a.pos.y + 1.35, ty = t.pos.y + 0.2;
    let best = null, bestErr = 0.6;
    for (let p = -0.3; p <= 1.1; p += 0.05) {
      let x = 0, y = y0, vh = Math.cos(p) * v, vy = Math.sin(p) * v + 1.5;
      for (let i = 0; i < 140; i++) {
        vy -= BOMB_G / 60; x += vh / 60; y += vy / 60;
        if (y <= ty && vy < 0) break;
      }
      const err = Math.abs(x - hd);
      if (y <= ty && err < bestErr) { bestErr = err; best = p; }
    }
    return best;
  }

  _special(t, dist, it) {
    const a = this.a, w = a.weapon;
    it.special = false;
    // Bomb Rush running: every throw is aimed with the bomb solver (free ink, so nothing else to weigh)
    if (a.specialBuff && a.specialBuff.id === 'bombrush') {
      const p = t && dist < 14 ? this._bombSolve(t) : null;
      if (p !== null) { it.fire = true; it.sub = false; a.aimLock = null; this._setAim(Math.atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z), p - 0.28); }
      return;
    }
    if (!a.specialReady()) return;
    let near = 0, close = 0, far = 0, weak = 0, allies = 0, hurt = a.hp < PLAYER.hp * 0.6;
    for (const e of G.actors) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(a.pos);
      if (e.team === a.team) { if (e !== a && d < 12) allies++; continue; }
      if (d < 12) near++;
      if (d < 4) close++;
      if (d < SPECIALS.missiles.range) { far++; if (e.hp < 70) weak++; }
    }
    if (w.special === 'slam') it.special = close > 0 && !!t && dist < 4;
    else if (w.special === 'storm') it.special = near >= 2 || (near >= 1 && this.needPaint);
    else if (w.special === 'armor') it.special = near >= 1 && (allies >= 1 || hurt);
    else if (w.special === 'missiles') it.special = weak >= 1 || far >= 2;
    else if (w.special === 'bombrush') it.special = !!t && dist > 4.5 && dist < 12 && this.los;
    else if (w.special === 'barrier') it.special = near >= 1 && (hurt || near >= 2);
    // spend it on the turf when nothing else needs it and the ground around is not ours (armor / barrier need a fight)
    if (!it.special && this.needPaint && !this.target && w.special !== 'armor' && w.special !== 'barrier') it.special = true;
  }
}

// Aimbot (Settings → Cheats → Aimbot). Per-weapon fire solutions for the local player:
//   · lead:  where the target will be when the shot arrives — its velocity (walls stop the extrapolation), gravity
//            while it is airborne (never below the ground under it); flight time and aim point solved together
//   · arcs:  the same integrator Projectiles.update() runs (straight phase, then gravity + drag, the frame's own dt),
//            searched over launch pitch for every crossing of the target: the flat shot first, then the high lob —
//            each flown through the level, so a lob that clears a wall wins when the direct line is blocked
//   · kinds: shooter / dualies / splatling (ballistic rounds), slosher (drag-free lob), roller flick (heavy drops),
//            blaster (straight intercept, or a burst on the wall / floor next to a target behind cover), charger
//            (hitscan: straight at the body, no lead)
// player.js picks the target and turns the camera; weapons.js asks for the exact launch direction at the moment each
// shot leaves the muzzle (aimLock on the actor), so dualies' two hands and a moving shooter stay exact.
import * as THREE from 'three';
import { G, clamp } from '../core/ctx.js';
import { PLAYER } from '../config.js';
import { Hit } from './physics.js';

const SHOT_GRAV = 28, SHOT_DRAG = 0.8;           // Projectiles: shooter-family rounds
const FLICK_GRAV = 26, FLICK_DRAG = 0.4;         // roller flick drops
const DOWN = new THREE.Vector3(0, -1, 0);
const _hit = new Hit(), _hit2 = new Hit();
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();

/** Integration step the projectiles will actually use (main.js records each frame's dt). */
const stepDt = () => clamp(G.frameDt || 1 / 60, 1 / 120, 1 / 24);

/** Centre of the target's hitbox (the capsule Projectiles tests against). */
export function bodyCenter(e, out) {
  const h = e.form === 'squid' ? PLAYER.squidHeight : PLAYER.height;
  return out.set(e.pos.x, e.pos.y + (e.smoothY || 0) + h * 0.5, e.pos.z);
}

/** Where e's body centre will be in t seconds. */
export function predictCenter(e, t, out) {
  bodyCenter(e, out);
  if (t <= 0) return out;
  const vx = e.vel.x, vz = e.vel.z;
  const hs = Math.hypot(vx, vz);
  if (hs > 0.05) {
    // horizontal: straight on, stopped short of a wall in the way
    const dist = hs * t;
    _d.set(vx / hs, 0, vz / hs);
    const r = G.physics.raycast(_o.copy(out), _d, dist + PLAYER.radius, _hit, false);
    const go = r.hit ? Math.max(0, r.dist - PLAYER.radius) : dist;
    out.addScaledVector(_d, go);
  }
  if (!e.grounded) {
    // airborne: a ballistic fall, floored at the ground under the landing point
    const y = out.y + e.vel.y * t - 0.5 * PLAYER.gravity * t * t;
    const g = G.physics.raycast(_o.set(out.x, out.y + 0.2, out.z), DOWN, 30, _hit2, false);
    const h = e.form === 'squid' ? PLAYER.squidHeight : PLAYER.height;
    out.y = g.hit ? Math.max(y, g.point.y + h * 0.5) : y;
  }
  return out;
}

// Fly one projectile (same update order as Projectiles.update). Returns the time it passes within `hitR` of `target`,
// or -1 when it hits the level first / runs out of life / falls away.
function fly(from, vx, vy, vz, straight, grav, drag, life, target, hitR, world) {
  const dt = stepDt();
  let x = from.x, y = from.y, z = from.z, age = 0;
  const r2 = hitR * hitR;
  for (let i = 0; i < 400 && age < life; i++) {
    age += dt;
    const px = x, py = y, pz = z;
    if (age > straight) { vy -= grav * dt; if (drag) { const k = 1 - drag * dt; vx *= k; vy *= k; vz *= k; } }
    x += vx * dt; y += vy * dt; z += vz * dt;
    // closest approach of this segment to the target
    const sx = x - px, sy = y - py, sz = z - pz, ss = sx * sx + sy * sy + sz * sz || 1e-9;
    const u = clamp(((target.x - px) * sx + (target.y - py) * sy + (target.z - pz) * sz) / ss, 0, 1);
    const cx = px + sx * u - target.x, cy = py + sy * u - target.y, cz = pz + sz * u - target.z;
    const reached = cx * cx + cy * cy + cz * cz <= r2;
    if (world) {
      const h = G.physics.segment(_p.set(px, py, pz), _q.set(x, y, z), _hit, true);
      if (h.hit && (!reached || h.dist < u * Math.sqrt(ss) - 0.05)) return -1;
    }
    if (reached) return age - dt * (1 - u);
    if (y < PLAYER.waterY - 1.8) return -1;
  }
  return -1;
}

// Height the shot has when it has covered horizontal distance hd (no level), or NaN when it never gets there.
function heightAt(hd, speed, pitch, straight, grav, drag, life) {
  const dt = stepDt();
  let vh = Math.cos(pitch) * speed, vy = Math.sin(pitch) * speed, x = 0, y = 0, age = 0;
  for (let i = 0; i < 400 && age < life; i++) {
    age += dt;
    const px = x, py = y;
    if (age > straight) { vy -= grav * dt; if (drag) { const k = 1 - drag * dt; vh *= k; vy *= k; } }
    x += vh * dt; y += vy * dt;
    if (x >= hd) { const f = (hd - px) / Math.max(1e-6, x - px); return py + (y - py) * f; }
    if (vh < 0.3) break;
  }
  return NaN;
}

/**
 * Launch direction that puts a ballistic projectile through `target` from `from` without touching the level.
 * Every pitch where the arc crosses the target height is a candidate, flattest first (a lob over cover when the flat
 * one is blocked). Returns { dir, t, lob } or null.
 */
export function solveArc(from, target, speed, straight, grav, drag, life, hitR = 0.45) {
  const hx = target.x - from.x, hz = target.z - from.z, hd = Math.hypot(hx, hz), dy = target.y - from.y;
  if (hd < 0.3) return null;
  const ux = hx / hd, uz = hz / hd;
  const f = (p) => heightAt(hd, speed, p, straight, grav, drag, life) - dy;
  const roots = [];
  let p0 = -1.2, f0 = f(p0);
  for (let p1 = p0 + 0.03; p1 <= 1.45; p1 += 0.03) {
    const f1 = f(p1);
    if (Number.isFinite(f0) && Number.isFinite(f1) && (f0 <= 0) !== (f1 <= 0)) {
      let a = p0, b = p1, fa = f0;
      for (let k = 0; k < 14; k++) { const m = (a + b) / 2, fm = f(m); if (!Number.isFinite(fm)) break; if ((fa <= 0) === (fm <= 0)) { a = m; fa = fm; } else b = m; }
      roots.push((a + b) / 2);
    }
    p0 = p1; f0 = f1;
  }
  for (let i = 0; i < roots.length; i++) {
    const p = roots[i], c = Math.cos(p);
    const t = fly(from, ux * c * speed, Math.sin(p) * speed, uz * c * speed, straight, grav, drag, life, target, hitR, true);
    if (t >= 0) return { dir: new THREE.Vector3(ux * c, Math.sin(p), uz * c), pitch: p, yaw: Math.atan2(ux, uz), t, lob: i > 0 };
  }
  return null;
}

// ---- per weapon ----------------------------------------------------------------------------------------------

/** Flight-model parameters of the local player's weapon (null for kinds without a projectile to lead). */
function model(w) {
  switch (w.kind) {
    case 'shooter': case 'dualies': case 'splatling':
      return { speed: w.projSpeed, straight: w.straightTime, grav: SHOT_GRAV, drag: SHOT_DRAG, life: 1.2 };
    case 'slosher': return { speed: w.projSpeed, straight: 0, grav: w.grav, drag: 0, life: 2.4 };
    case 'roller': return w.slash ? { speed: w.slashSpeed, straight: 0.08, grav: 22, drag: 0.5, life: 0.9 }   // wiper sheet
      : { speed: w.flickSpeed * 1.14, straight: 0, grav: FLICK_GRAV, drag: FLICK_DRAG, life: 1.4 };
    case 'charger': return w.arrows ? { speed: w.arrowSpeed, straight: w.rangeMax / w.arrowSpeed, grav: 30, drag: 0.4, life: 1.2 } : null;   // stringer arrows
    case 'blaster': return { speed: w.projSpeed, straight: 99, grav: 0, drag: 0, life: w.range / w.projSpeed };
    default: return null;   // charger: hitscan
  }
}

/** Longest reach worth locking onto for this weapon (m). */
export function weaponReach(w) {
  if (w.kind === 'charger') return w.rangeMax;
  if (w.kind === 'roller') return 9;
  if (w.kind === 'slosher') return w.range + 1.5;
  return (w.range || 12) + 2.5;
}

/**
 * Auto-fire decision for this weapon against a locked enemy at `dist` (the player's aimbot and the level-5 autoplay
 * bot share it): chargers charge until this charge splats (or is full) inside its range, splatlings spin up fully and
 * let the stream run, rollers flick (a fresh press every other call), everything else holds the trigger.
 */
export function autoFire(a, e, dist) {
  const w = a.weapon, wr = a.weaponRunner;
  if (w.kind === 'charger') {
    const c = wr.charge || 0;
    const dmg = c >= 0.999 ? w.damageMax : c * (w.damageMax * 0.62 - w.damageMin) + w.damageMin;
    const range = w.rangeMin + (w.rangeMax - w.rangeMin) * c;
    return !(wr.charging && (c >= 0.999 || (dmg >= e.hp && c > 0.2)) && dist <= range);
  }
  if (w.kind === 'splatling') return wr.streaming ? false : (wr.charge || 0) < 1;
  if (w.kind === 'roller') { a._flickT = !a._flickT; return a._flickT; }
  return true;
}

/**
 * Full solution for the actor's weapon against enemy e, fired from `from` (the muzzle): lead + arc, iterated so the
 * flight time and the predicted position agree. Returns { point, dir, t, lob, splash } or null (no way to hit now).
 */
export function solveWeapon(a, e, from, delay = 0) {
  const w = a.weapon;
  const point = new THREE.Vector3();
  const m = model(w);
  if (!m) {
    // charger: the beam is instant — the body right now, if the muzzle can see it and it is inside the full charge range
    const hh = e.form === 'squid' ? PLAYER.squidHeight : PLAYER.height;
    for (const oy of e.form === 'squid' ? [0] : [0, hh * 0.32, -hh * 0.28]) {
      bodyCenter(e, point); point.y += oy;
      if (from.distanceTo(point) > w.rangeMax || !G.physics.los(from, point)) continue;
      return { point, dir: _v.copy(point).sub(from).normalize().clone(), t: 0, lob: false, splash: false };
    }
    return null;
  }
  // aim points on the body, centre first: the capsule counts a hit anywhere, so a target half behind a ledge is still
  // reachable at its head (or its feet under an overhang)
  const h = e.form === 'squid' ? PLAYER.squidHeight : PLAYER.height;
  const offs = e.form === 'squid' ? [0] : [0, h * 0.32, -h * 0.28];
  const t0 = from.distanceTo(bodyCenter(e, point)) / m.speed;
  for (const oy of offs) {
    let t = t0, sol = null;
    for (let it = 0; it < 4; it++) {
      predictCenter(e, t + delay, point); point.y += oy;
      if (w.kind === 'blaster') sol = solveBlast(from, point, m, w);
      else sol = solveArc(from, point, m.speed, m.straight, m.grav, m.drag, m.life, 0.36);
      if (!sol) break;
      if (Math.abs(sol.t - t) < 0.004) break;
      t = sol.t;
    }
    if (sol) { sol.point = point; return sol; }
  }
  return null;
}

// Blaster: a straight ball. Direct if the line is clear; otherwise a burst against the wall / floor beside the target
// (the burst damages through its splash radius when it can see the target).
function solveBlast(from, target, m, w) {
  const d = from.distanceTo(target);
  if (d <= w.range && G.physics.los(from, target)) {
    return { dir: _v.copy(target).sub(from).normalize().clone(), t: d / m.speed, lob: false, splash: false };
  }
  const R = w.splashRadius * 0.8;
  let best = null;
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2;
    const rr = i % 2 ? R * 0.9 : R * 0.5;
    _p.set(target.x + Math.cos(ang) * rr, target.y + (i % 3 === 0 ? -0.9 : i % 3 === 1 ? 0.6 : 1.4), target.z + Math.sin(ang) * rr);
    _d.copy(_p).sub(from); const L = _d.length(); _d.multiplyScalar(1 / L);
    const h = G.physics.raycast(from, _d, Math.min(w.range, L + 1.5), _hit, true);
    if (!h.hit) continue;
    const c = _q.copy(h.point).addScaledVector(h.normal, 0.1);
    const dc = c.distanceTo(target);
    if (dc > R || !G.physics.los(c, target)) continue;
    if (!best || dc < best.dc) best = { dc, dir: _d.clone(), t: h.dist / m.speed };
  }
  return best ? { dir: best.dir, t: best.t, lob: false, splash: true } : null;
}

/** weapons.js: the live lock for this actor (local player, aimbot on), or null. */
export function aimLockFor(a) {
  const L = a.aimLock;
  return L && L.enemy && L.enemy.alive ? L : null;
}

/** weapons.js: exact launch direction from this muzzle for the current lock (null → the weapon aims as usual). */
export function lockDir(a, muzzle) {
  const L = aimLockFor(a);
  if (!L) return null;
  return solveWeapon(a, L.enemy, muzzle);
}

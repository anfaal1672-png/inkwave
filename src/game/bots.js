// Bot brain: picks turf to claim, paths there (swimming through its own ink), paints on the move, spots and
// fights enemies with human-ish reaction time and aim error, refills ink, throws bombs and uses specials.
// Motion: aim is a critically-damped spring with a turn-rate cap and a smoothly wandering error (plus an
// acquisition over/undershoot that settles), shots follow the bot's *actual* aim ray, the move command slews its
// heading (no twitch at waypoint switches / strafe flips), strafes ease, bots dodge-hop when hit, swim in to close
// distance and retreat through own ink to heal when they're losing a duel.
// Human-ness: every bot has a fixed personality (aggro / painter / caution / curious / jumpy, seeded by its name) that
// bends its decisions, sees only what is inside its field of view (or heard, or shot it), remembers where it lost an
// enemy and hunts there, calls out sightings to allies, ambushes from its own ink, glances around and shoots its way
// forward in short bursts instead of sweeping its aim blindly. The level-5 ApexBrain keeps omniscient perception.
import * as THREE from 'three';
import { G, clamp, angleDiff } from '../core/ctx.js';
import { Hit } from './physics.js';
import { PLAYER, DIFFICULTY, SUB, SPECIALS } from '../config.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _stats = { own: 0, enemy: 0, empty: 0, n: 0 };
const _wallHit = new Hit();
const PAINT_OFFS = [-1.05, -0.52, 0, 0.52, 1.05];        // paint-aim candidates around the heading (±60°)
const SQUID_DODGERS = new Set(['shooter', 'dualies', 'splatling']);
const LANES = [[0.5, 0], [0.42, -8], [0.42, 8], [0.2, 0]];   // opening lanes by slot: [share of the way to the enemy base, sideways m]

function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// a bot's temperament for the whole match: same name → same values
function personality(name, apex) {
  if (apex) return { aggro: 0.5, painter: 0.5, caution: 0.3, curious: 0, jumpy: 0 };
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = mulberry32(h >>> 0);
  return { aggro: r(), painter: r(), caution: r(), curious: r(), jumpy: r() };
}
const rangeOf = (w) => (w.kind === 'charger' ? w.rangeMax * 0.9 : w.kind === 'roller' ? 6 : w.range);

export class BotBrain {
  constructor(actor, difficulty = 'normal') {
    this.a = actor;
    this.setDifficulty(difficulty);
    this.pers = personality(actor.name || '', !!this.diff.apex);
    this.reset();
  }
  // a level name ('easy'…) or a full level object (AUTOPLAY rows, for the bot that plays your own character)
  setDifficulty(d) {
    this.diff = typeof d === 'object' && d ? d : (DIFFICULTY[d] || DIFFICULTY.normal);
    if (this.a) this.pers = personality(this.a.name || '', !!this.diff.apex);
  }
  reset() {
    this.path = null; this.pi = 0; this.goal = -1; this.repath = 0; this.goalTimer = 0;
    this.target = null; this.seeTimer = 0; this.react = 0; this.lostTimer = 0;
    this.stuck = 0; this.lastPos = new THREE.Vector3(); this.jumpCd = 0; this.bestD = Infinity; this.noProg = 0;
    this.mode = 'paint';
    this.sweep = Math.random() * 10;
    this.aimYaw = this.a.yaw; this.aimPitch = 0;
    this.errYaw = 0; this.errPitch = 0; this.errT = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0;
    this.bombCd = 3 + Math.random() * 4;
    this.fireHold = 0;
    this.think = Math.random() * 0.2;
    this.refillUntil = 0;
    this.chargeRelease = 0.95 + Math.random() * 0.05;
    this.paintPause = 0;
    this.aimYawV = 0; this.aimPitchV = 0;
    this.acqT = 9; this.acqSignY = 0; this.acqSignP = 0;
    this.ph1 = Math.random() * 20; this.ph2 = Math.random() * 20; this.t = Math.random() * 10;
    this.strafeS = 0; this.strafeAmp = 1;
    this.mvYaw = this.a.yaw; this.mvMag = 0;
    this.dodgeCd = 1 + Math.random() * 2;
    this.retreatT = 0; this._firing = false;
    // memory + attention
    this.lastSeen = { actor: null, x: 0, y: 0, z: 0, t: 0 };
    this.repActor = null; this.repDelay = 0; this.repX = 0; this.repY = 0; this.repZ = 0; this._repCd = 0;
    this.alertT = 0; this.alertYaw = 0; this._thinkDt = 0.2;
    this._outnum = false; this._prevD = 0; this._fleeing = false; this._bombOk = false;
    this._ambushRoll = false; this._ambushGo = false; this.ambushT = 0; this.ambushCd = 0;
    // painting
    this.pyOff = 0; this.pPitch = -0.3; this.pDist = 6; this.paintAimT = 0; this.needPaint = true;
    this.rhy = true; this.rhyT = 0.5; this.exitPaintT = 0; this.dwellT = 0; this._dwelled = false;
    this.latOff = 0; this.latCur = 0; this.latT = 0;
    // fighting / manners
    this.bombPrep = 0; this.bombYaw = 0; this.bombPitch = 0; this._huntBomb = false;
    this.tailT = 0; this._wy = 0; this._wp = 0; this._splats = this.a.stats ? this.a.stats.splats : 0;
    this.hopN = 0; this.hopT = 0; this.sqDodgeT = 0; this.sqCd = 0; this.sqSide = 1; this.strafeRun = 0;
    this._tap = false; this._wipeHold = 0;
    this.rollCd = 0; this.rollOn = false; this.rollX = 0; this.rollZ = 0; this.surgePlan = -1;
    this.lookT = 0; this.lookNext = 1 + Math.random() * 3; this.lookOff = 0;
    // a human's picture of the fight: the target's motion as it was taken in (lags behind the real one), whether it is in
    // sight right now, and hits that register a beat after they land
    this.pvX = 0; this.pvZ = 0; this.tgtVis = false; this._hidT = -99;
    this._prevLD = 99; this._hitPend = -1; this._hitHp = 0; this._hitD = 0; this._hitAt = -99; this.hurt = 99; this.feltHp = PLAYER.hp;
  }

  update(dt) {
    const a = this.a;
    const it = a.intent;
    if (!a.alive) { it.move.set(0, 0, 0); it.fire = it.squid = it.sub = it.jump = it.special = false; this.path = null; this.target = null; this._wasDead = true; this.mvMag = 0;
      this.mode = 'paint'; this.lastSeen.actor = null; this.repActor = null; this.ambushT = 0; this.hopN = 0; this.tailT = 0; this.bombPrep = 0; this.sqDodgeT = 0; this._splats = a.stats.splats;
      return;
    }
    if (this._wasDead && G.match && G.match.playing()) {
      // just respawned: face the way the body faces, then sometimes super jump to the teammate furthest up the field
      this._wasDead = false;
      this.aimYaw = a.yaw; this.aimPitch = 0; this.aimYawV = 0; this.aimPitchV = 0;
      let jumped = false;
      if (this.diff.apex || Math.random() < 0.5) {
        const enemyPad = G.level.spawnPads[1 - a.team];
        let best = null, bd = Infinity;
        for (const o of G.actors) {
          if (o === a || o.team !== a.team || !o.alive || o.superJumpState) continue;
          const d = o.pos.distanceTo(enemyPad);
          if (d < bd && o.pos.distanceTo(a.pos) > 18 && !(this.diff.apex && this._enemyNear(o.pos, 8))) { bd = d; best = o; }
        }
        if (best && a.superJump(best)) { this.path = null; this.goalTimer = 0; jumped = true; }
      }
      // walking out instead: lay ink in front of the spawn deck as it goes
      if (!jumped) this.exitPaintT = 1.6;
    }
    if (a.superJumpState) { it.move.set(0, 0, 0); it.fire = it.squid = it.sub = it.jump = it.special = false; this.mvMag = 0; return; }
    if (!G.match || !G.match.playing()) { it.move.set(0, 0, 0); it.fire = it.squid = it.sub = it.jump = it.special = false; this.mvMag = 0; return; }
    this.think -= dt; this.jumpCd -= dt; this.bombCd -= dt; this.strafeT -= dt; this.paintPause -= dt; this.dodgeCd -= dt;
    this.acqT += dt; this.t += dt;
    this.sqCd -= dt; this.sqDodgeT -= dt; this.rollCd -= dt; this.ambushCd -= dt; this._repCd -= dt; this.lookT -= dt; this.exitPaintT -= dt;
    this.react -= dt;
    const apex = !!this.diff.apex;

    // ---------------- feeling hits: a hit registers a reaction time after it lands, so the dodge / retreat it sets off
    // can't start on the very frame (the bot also reads its health as of then). Only the first hit of a burst is timed;
    // the ones landing while it is still "on its way" are taken in with it.
    if (a.lastDamage < this._prevLD - 1e-4 && this._hitPend < 0) {
      this._hitPend = this.t - a.lastDamage; this._hitHp = a.hp;
      this._hitD = apex ? 0 : Math.max(0.12, this.diff.reaction * (0.6 + Math.random() * 0.5));
    }
    this._prevLD = a.lastDamage;
    if (this._hitPend >= 0 && this.t - this._hitPend >= this._hitD) { this._hitAt = this._hitPend + this._hitD; this.feltHp = this._hitHp; this._hitPend = -1; }
    else if (this._hitPend < 0) this.feltHp = a.hp;
    this.hurt = this.t - this._hitAt;

    // ---------------- perception
    if (this.think <= 0) {
      this._thinkDt = apex ? 0.1 : 0.15 + Math.random() * 0.1;
      this.think = this._thinkDt;
      this._perceive();
    }
    if (this.repActor) { this.repDelay -= dt; if (this.repDelay <= 0) this._takeReport(); }
    const tgt = this.target;
    if (tgt && !tgt.alive) {
      this.target = null; this.lastSeen.actor = null;
      if (!apex) {
        // a beat of trigger finger after the kill (less the sharper the bot is)
        this.tailT = clamp(0.08 + this.diff.reaction * 0.25, 0.1, 0.2) * (0.8 + Math.random() * 0.4);
        if (a.stats.splats > this._splats) this._onKill();
      }
    }
    this._splats = a.stats.splats;

    // ---------------- mode selection (retreat = break line of sight and heal in own ink when losing a duel)
    const inkFrac = a.ink / PLAYER.inkMax;
    const hpFrac = this.feltHp / PLAYER.hp;
    const w = a.weapon;
    if (this.mode === 'retreat') {
      this.retreatT -= dt;
      if (hpFrac > 0.85 || this.retreatT <= 0 || (!this.target && hpFrac > 0.6)) { this.mode = 'paint'; this.path = null; this.goalTimer = 0; }
    } else if (this.target && this.seeTimer > 0 && this._retreatWanted(hpFrac, w) && Math.random() < 0.6 * dt * 60 * this.diff.fireDiscipline) {
      this.mode = 'retreat'; this.retreatT = 2.2 + Math.random() * 1.4; this.repath = 0; this._pickRetreat();
    }
    if (this.mode !== 'refill' && this.mode !== 'retreat' && this._refillWanted(inkFrac, w)) {
      this.mode = 'refill'; this.refillUntil = 0.85 + Math.random() * 0.1;
    }
    if (this.mode === 'refill' && inkFrac >= this.refillUntil) this.mode = 'paint';
    if (this.mode !== 'refill' && this.mode !== 'retreat') this._pickMode(dt, apex);

    // ---------------- navigation goal
    this.goalTimer -= dt; this.repath -= dt; this.dwellT -= dt;
    if (this.mode === 'fight' && this.target) {
      if (this.repath <= 0) this._pathTo(this.tgtVis || apex ? this.target.pos : _v3.set(this.lastSeen.x, this.lastSeen.y, this.lastSeen.z), 0.6);
    } else if (this.mode === 'hunt') {
      if (this.repath <= 0 && this.lastSeen.actor) this._pathTo(_v3.set(this.lastSeen.x, this.lastSeen.y, this.lastSeen.z), 1.2);
    } else if (this.mode === 'ambush') {
      this.path = null;
    } else if (this.mode === 'refill') {
      if (this.repath <= 0 || !this.path) this._pickRefill();
    } else if (this.mode === 'retreat') {
      if (this.repath <= 0 || !this.path) this._pickRetreat();
    } else {
      // on arrival: a short beat to look around before the next goal
      const arrived = !!this.path && this.pi >= this.path.length;
      if (arrived && !this._dwelled && !apex) {
        this._dwelled = true;
        this.dwellT = (0.2 + Math.random() * 0.3) * (1.5 - this.pers.painter * 0.8);
        if (Math.random() < 0.4 + this.pers.curious * 0.6) this.lookNext = Math.min(this.lookNext, 0.05);
      }
      if (this.dwellT > 0 && arrived) { /* standing still, looking around */ }
      else if (this.goalTimer <= 0 || !this.path || arrived) { this._dwelled = false; this._pickPaintGoal(); }
    }

    // ---------------- steering along the path
    const move = this._steer(dt);
    const wantMove = move.lengthSq() > 0.01;

    // ---------------- actions
    it.fire = false; it.sub = false; it.special = false; it.squid = false; it.jump = false;
    let wantYaw = wantMove ? Math.atan2(move.x, move.z) : a.yaw;
    let wantPitch = -0.1;
    const enemyVisible = this.target && this.seeTimer > 0;
    let fightDist = 0, idealYaw = 0, idealPitch = 0, aimDist = 6;

    if ((this.mode === 'fight' || this.mode === 'retreat') && this.target) {
      const t = this.target;
      // where the bot thinks it is: in sight → where it is; behind cover → where it was last seen, carried on along
      // its last known motion for half a second (no tracking through walls)
      let tx = t.pos.x, ty = t.pos.y + (t.smoothY || 0), tz = t.pos.z;
      if (apex) { this.pvX = t.vel.x; this.pvZ = t.vel.z; }
      else if (this.tgtVis) {
        // motion is read with a lag: a strafe flip takes a moment to show up in the lead
        const kv = 1 - Math.exp(-dt / (0.08 + 0.5 * this.diff.reaction));
        this.pvX += (t.vel.x - this.pvX) * kv; this.pvZ += (t.vel.z - this.pvZ) * kv;
      } else {
        const ls = this.lastSeen, k = Math.min(this.t - ls.t, 0.5);
        tx = ls.x + this.pvX * k; ty = ls.y; tz = ls.z + this.pvZ * k;
      }
      const dx = tx - a.pos.x, dz = tz - a.pos.z;
      const dist = Math.hypot(dx, dz);
      fightDist = dist;
      const range = this._range();
      // lead the target by the projectile's time to arrive (lobs: the heave windup + a slower, longer arc)
      const lead = w.kind === 'charger' ? 0 : w.kind === 'slosher' ? (w.windup || 0.13) + dist / ((w.projSpeed || 15) * 0.88) : dist / (w.projSpeed || 30);
      _v.set(tx + this.pvX * lead, ty + (t.form === 'squid' ? 0.3 : 0.85), tz + this.pvZ * lead);
      _v2.copy(_v); _v2.x -= a.pos.x; _v2.y -= a.pos.y + 1.1; _v2.z -= a.pos.z;
      idealYaw = Math.atan2(_v2.x, _v2.z);
      idealPitch = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
      aimDist = _v2.length();
      // human aim error: a slow wander plus an acquisition error that settles over the reaction time
      const e = this.diff.aimError;
      const acq = Math.exp(-this.acqT / Math.max(0.12, this.diff.reaction * 0.9));
      const wander = (x) => Math.sin(x) * 0.6 + Math.sin(x * 2.27 + 1.3) * 0.4;
      wantYaw = idealYaw + e * (0.75 * wander(this.t * 1.7 + this.ph1) + 2.4 * acq * this.acqSignY);
      wantPitch = idealPitch + e * 0.6 * (0.75 * wander(this.t * 2.1 + this.ph2) + 1.6 * acq * this.acqSignP);
      if (this.mode === 'fight') {
        // movement in combat: keep preferred distance + eased strafing (+ swim in to close distance)
        const pref = this._prefDist(w, range);
        if (this.strafeT <= 0) {
          // human A-D: short, uneven legs, and a third leg the same way is unlikely
          this.strafeT = 0.35 + Math.random() * 0.55;
          let nd = Math.random() < 0.5 ? -1 : 1;
          if (nd === this.strafe && this.strafeRun >= 1 && Math.random() < 0.8) nd = -nd;
          this.strafeRun = nd === this.strafe ? this.strafeRun + 1 : 0;
          this.strafe = nd; this.strafeAmp = 0.5 + Math.random() * 0.5;
        }
        this.strafeS += (this.strafe * this.strafeAmp - this.strafeS) * (1 - Math.exp(-5 * dt));
        const nx = dx / Math.max(dist, 0.01), nz = dz / Math.max(dist, 0.01);
        let mvx = 0, mvz = 0;
        if (dist > pref + 1.2 && wantMove) { mvx = move.x; mvz = move.z; }
        else if (dist < pref - 1.5 && w.kind !== 'roller') { mvx = -nx; mvz = -nz; }
        if (w.kind !== 'charger' || !a.weaponRunner.charging) { mvx += -nz * this.strafeS * 0.9; mvz += nx * this.strafeS * 0.9; }
        if (w.kind === 'roller' && dist < 7) { mvx = nx; mvz = nz; }
        const l = Math.hypot(mvx, mvz);
        if (l > 0.01) move.set(mvx / l, 0, mvz / l); else move.set(0, 0, 0);
        // fire only when the *actual* aim is on the body (shots follow the visible aim, not the target)
        const off = Math.hypot(angleDiff(this.aimYaw, idealYaw), this.aimPitch - idealPitch);
        const tol = Math.max(0.05, Math.atan2(0.55, dist)) * (this._firing ? 2.4 : 1.5);
        const aimed = off < tol;
        this._firing = false;
        // shooting at it: while in sight, plus a short burst into the spot it just ducked out of (no long hosing of the
        // wall it is behind — and it has to be seen again before the next shot, see _perceive)
        const inView = enemyVisible && (apex || this.tgtVis || this.t - this._hidT < 0.35);
        if (inView && this.react <= 0 && aimed && inkFrac > 0.02) {
          if (w.kind === 'charger') {
            it.fire = !(a.weaponRunner.charging && a.weaponRunner.charge >= this.chargeRelease);
            if (a.weaponRunner.charging) move.multiplyScalar(0.3);
          } else if (w.kind === 'roller' && (w.slash || w.flickInterval < 0.3)) {
            // wiper / brush: rapid taps up close (holding would only charge the wiper or roll the brush into the foe);
            // a wiper now and then holds for a fully charged cut
            const wr = a.weaponRunner;
            if (wr.charging) it.fire = wr.charge < 1;
            else if (this._wipeHold > 0) { this._wipeHold -= dt; it.fire = true; }
            else if (!w.slash && dist >= 5 && dist < 14 && a.grounded && a.ink > 20) {
              // brush: close the gap at full rolling speed (painting a road and hitting what it runs into), then flick
              it.fire = true; move.set(nx, 0, nz);
            } else { this._tap = !this._tap; it.fire = dist < (w.slash ? 6.5 : 5) && this._tap; if (w.slash && it.fire && dist > 2.5 && Math.random() < 0.12) this._wipeHold = 0.35; }
          } else if (w.kind === 'roller') {
            it.fire = dist < (w.botFlickDist || 5.5) || (a.weaponRunner.rolling && dist < 8);
          } else if (w.kind === 'splatling') {
            // spin up (a full charge at range, a quicker partial one up close), release, track while the stream runs
            const wr = a.weaponRunner, want = dist > range * 0.55 ? this.chargeRelease : 0.55 + 0.25 * this.chargeRelease;
            it.fire = !wr.streaming && dist < range * 1.1 && !(wr.charging && wr.charge >= want);
            if (wr.charging) move.multiplyScalar(0.45);
          } else if (w.kind === 'slosher') {
            it.fire = dist < range * 1.05;   // the lob also reaches targets up on ledges / behind low cover
          } else {
            it.fire = dist < range * 1.08;
          }
          this._firing = it.fire;
          // bombs are thrown with a reason (bunched-up or running enemies), never on a dice roll
          // (a burst bomb is cheap and pops on contact: thrown closer and more often; a sprinkler is for painting only)
          const sub = this._subDef(), burst = sub.id === 'burst';
          if (!apex && this._bombOk && sub.id !== 'sprinkler' && this.bombCd <= 0 && this.bombPrep <= 0 && a.ink > sub.inkCost + 8 && dist > (burst ? 3 : 5) && dist < (burst ? 11 : 13)) {
            this._bombOk = false; this._startBomb(t.pos.x, t.pos.y, t.pos.z);
          }
        } else if ((w.kind === 'charger' || w.kind === 'splatling') && a.weaponRunner.charging && !inView) {
          it.fire = true; // keep charge while target briefly hidden
        }
        // out of range with own ink underfoot: swim in (fast, hard to hit) instead of walking
        // (a shorter weapon dives in from further out to get inside the other's reach)
        if (!it.fire && !a.weaponRunner.charging && dist > range * (range - this._rangeOf(t.weapon) <= -2 ? 0.85 : 1.15) && a.groundTeam === 1) it.squid = true;
        // squid dodge: hurt in own ink, a quarter second as a squid off to the side, then back to shooting
        if (!apex && this.sqDodgeT <= 0 && this.sqCd <= 0 && hpFrac <= 0.5 && this.hurt < 0.15 && a.groundTeam === 1 && SQUID_DODGERS.has(w.kind)
            && !a.weaponRunner.charging && Math.random() < 0.7) {
          this.sqDodgeT = 0.25; this.sqCd = 1.6 + Math.random() * 1.4; this.sqSide = Math.random() < 0.5 ? -1 : 1;
        }
        if (this.sqDodgeT > 0 && !apex) {
          it.squid = true; it.fire = false; move.set(-nz * this.sqSide, 0, nx * this.sqSide);
          // end of the dodge: sometimes Squid Roll straight back across, armoured, and come out shooting
          if (this.sqDodgeT < 0.08 && this.rollCd <= 0) { if (Math.random() < 0.6 * this.diff.fireDiscipline) this._planRoll(Math.PI); else this.rollCd = 0.5; }
        }
        else if (!apex && w.kind !== 'charger' && !a.weaponRunner.charging && a.grounded && this.dodgeCd <= 0 && dist > 3
                 && Math.random() < 0.35 * this.pers.jumpy * dt && !this._nearWater(a, 1.6)) { it.jump = true; this.dodgeCd = 1.2 + Math.random() * 1.5; }
        // dodge: a strafe-hop right after taking a hit
        if (this.sqDodgeT > 0 && !apex) { /* already dodging as a squid */ }
        else if (w.kind === 'dualies') {
          // dodge roll: while firing, roll sideways when hit or when the fight gets close (the runner locks the turret after)
          const wr = a.weaponRunner;
          if (it.fire && this.dodgeCd <= 0 && a.grounded && !wr.dodge && wr.rollsLeft > 0 && (this.hurt < 0.3 || dist < 5.5) && Math.random() < 0.08 * dt * 60) {
            const side = Math.random() < 0.5 ? -1 : 1;
            if (!this._nearWater(a, 3.2)) { move.set(-nz * side, 0, nx * side); it.jump = true; this.dodgeCd = 1.4 + Math.random() * 1.6; }
          }
        } else if (this.hurt < 0.25 && this.dodgeCd <= 0 && a.grounded && w.kind !== 'charger' && Math.random() < 0.3 && !this._nearWater(a, 1.6)) { it.jump = true; this.dodgeCd = 2 + Math.random() * 2.5; }
        // special
        if (a.specialReady()) {
          const sp = w.special;
          if (sp === 'slam' && dist < 4.5) it.special = true;
          else if (sp === 'storm' && dist < 16) it.special = true;
          else if (sp === 'armor') it.special = true;
          else if (sp === 'missiles') it.special = this._foesWithin(SPECIALS.missiles.range) >= 1;
          else if (sp === 'bombrush') it.special = dist > 5 && dist < 12;
          else if (sp === 'barrier') it.special = hpFrac <= 0.6 || this._foesWithin(10) >= 2;
        }
        // Bomb Rush: keep lobbing bombs at the target (the launch pitch that lands a 13.5 m/s bomb at this distance)
        if (a.specialBuff && a.specialBuff.id === 'bombrush' && enemyVisible && dist < 14) {
          it.fire = true;
          wantPitch = clamp(0.2 + 0.06 * dist - 0.28, -0.3, 0.9);
        }
        this._wy = wantYaw; this._wp = wantPitch;
      } else {
        // retreat: swim away through own ink, keep eyes on the threat; hit on the way out → sometimes a Squid Roll
        // juke ~120° off the swim line (its damage cut soaks the next shots), then carry on
        it.squid = true;
        if (this.hurt < 0.05 && this.rollCd <= 0) { if (Math.random() < 0.5 * this.diff.fireDiscipline) this._planRoll((Math.random() < 0.5 ? -1 : 1) * 2.1); else this.rollCd = 1; }
      }
    } else if (this.mode === 'ambush' && this.target) {
      // sit still in own ink (a squid in ink can't be seen from afar), eyes on the enemy walking up
      const t = this.target;
      wantYaw = Math.atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z); wantPitch = -0.1;
      it.squid = true; move.set(0, 0, 0);
    } else if (this.mode === 'hunt') {
      // go to where the enemy was last seen, eyes sweeping around that spot
      const ls = this.lastSeen;
      wantYaw = Math.atan2(ls.x - a.pos.x, ls.z - a.pos.z) + Math.sin(this.t * 2.2 + this.ph1) * 0.7; wantPitch = -0.1;
      if ((w.kind === 'charger' || w.kind === 'splatling') && a.weaponRunner.charging) it.fire = true;   // let a held charge go
      else if (a.groundTeam === 1 && this._pathRemaining() > 4) it.squid = true;
      if (!apex && !this._huntBomb && this._subDef().id !== 'sprinkler' && this.bombCd <= 0 && a.ink > this._subDef().inkCost + 8 && this.tailT <= 0) {
        // smoke it out: it ducked behind a wall 5–12 m away
        this._huntBomb = true;
        const hd = Math.hypot(ls.x - a.pos.x, ls.z - a.pos.z);
        if (hd > 5 && hd < 12 && Math.random() < 0.35 + 0.4 * this.pers.aggro
            && !G.physics.los(_v.set(a.pos.x, a.pos.y + 1.3, a.pos.z), _v2.set(ls.x, ls.y + 1, ls.z))) this._startBomb(ls.x, ls.y, ls.z);
      }
    } else if (this.mode === 'paint') {
      // paint where the ground ahead is least ours: re-aimed every 0.25 s among five directions around the heading
      const heading = wantMove ? Math.atan2(move.x, move.z) : a.yaw;
      this.paintAimT -= dt;
      if (this.paintAimT <= 0) { this.paintAimT = 0.25; this._paintAim(w, heading); }
      const needPaint = this.needPaint;
      // a slow wobble on top so the aim doesn't look ruled
      wantYaw = heading + this.pyOff + Math.sin(this.t * 0.9 + this.ph2) * 0.1;
      wantPitch = this.pPitch;
      if (w.kind === 'roller' && w.slash) {
        // wiper: paint with a stream of quick slashes (holding would only charge)
        this._tap = !this._tap;
        it.fire = this._tap && inkFrac > 0.08 && needPaint;
      } else if (w.kind === 'roller') {
        it.fire = inkFrac > 0.08 && (needPaint || Math.random() < 0.02) && wantMove;
      } else if (w.kind === 'charger') {
        // charge to ~70 % and release a paint line, then a short breather before the next one
        if (a.weaponRunner.charging) {
          it.fire = a.weaponRunner.charge < 0.7;
          if (!it.fire) this.paintPause = 0.3 + Math.random() * 0.35;
        } else it.fire = needPaint && inkFrac > 0.3 && this.paintPause <= 0;
      } else if (w.kind === 'splatling') {
        // spin up ~60 %, hose the lane while the stream runs, breathe, repeat
        const wr = a.weaponRunner;
        if (wr.streaming) it.fire = false;
        else if (wr.charging) { it.fire = wr.charge < 0.6; if (!it.fire) this.paintPause = 0.25 + Math.random() * 0.3; }
        else it.fire = needPaint && inkFrac > 0.25 && this.paintPause <= 0;
      } else if (this.exitPaintT > 0) {
        it.fire = inkFrac > 0.15;                        // just respawned on foot: paint a path out of the deck
      } else if (needPaint && inkFrac > 0.18) {
        if (!apex && wantMove && a.groundTeam === 1 && this._pathRemaining() > 6) {
          // a long way to go over ground that isn't ours yet: shoot a road (0.4–0.6 s), swim it (0.5–0.8 s), repeat
          this.rhyT -= dt;
          if (this.rhyT <= 0) { this.rhy = !this.rhy; this.rhyT = this.rhy ? (0.4 + Math.random() * 0.2) * (0.8 + this.pers.painter * 0.6) : 0.5 + Math.random() * 0.3; }
          it.fire = this.rhy;
        } else it.fire = true;
      } else it.fire = false;
      // travel as a squid through own ink when not painting
      if (!it.fire && this._pathRemaining() > 5 && a.groundTeam === 1) it.squid = true;
      if (a.specialReady() && Math.random() < 0.01 && (w.special === 'slam' || w.special === 'storm' || w.special === 'bombrush')) {
        const r = G.paint.regionStats(a.pos.x, a.pos.y, a.pos.z, 5, a.team, _stats);
        if (r.own < 0.5) it.special = true;
      }
      if (a.specialReady() && w.special === 'missiles' && this._foesWithin(SPECIALS.missiles.range) >= 1) it.special = true;
      // Bomb Rush while painting: bombs spread over the ground ahead
      if (a.specialBuff && a.specialBuff.id === 'bombrush') { it.fire = true; it.squid = false; wantPitch = -0.1; }
    } else if (this.mode === 'refill') {
      it.squid = a.groundTeam === 1 || this._pathRemaining() > 2;
      if (a.groundTeam !== 1 && this._pathRemaining() < 1.5 && inkFrac > 0.03) {
        // no ink here: paint a puddle to swim in
        it.squid = false; it.fire = true;
        wantPitch = -1.0;
      }
    }
    // ---- manners: everything below is skipped by the level-5 bot
    if (!apex) {
      // a beat of fire after the kill
      if (this.tailT > 0) {
        this.tailT -= dt;
        if (this.mode === 'paint' || this.mode === 'hunt') {
          if (w.kind === 'shooter' || w.kind === 'dualies' || w.kind === 'blaster' || w.kind === 'slosher') it.fire = inkFrac > 0.03;
          it.squid = false; wantYaw = this._wy; wantPitch = this._wp;
        }
      }
      // squid-hop celebration
      if (this.hopN > 0 && (this.mode === 'paint' || this.mode === 'hunt')) {
        this.hopT -= dt; it.squid = this.hopN % 2 === 0; it.fire = false; move.set(0, 0, 0);
        if (this.hopT <= 0) { this.hopT = 0.14; this.hopN--; }
      } else this.hopN = 0;
      // glance around while painting / walking; a shout from an ally turns the head that way first
      wantYaw = this._lookYaw(dt, wantYaw, it);
      // hold the aim for a bomb throw, release once it is on line
      if (this.bombPrep > 0 && this.mode !== 'retreat' && this.mode !== 'refill') {
        this.bombPrep -= dt; wantYaw = this.bombYaw; wantPitch = this.bombPitch; it.fire = false; it.squid = false;
        if (Math.abs(angleDiff(this.aimYaw, this.bombYaw)) < 0.1 && Math.abs(this.aimPitch - this.bombPitch) < 0.1) { this._bombAim = true; this.bombPrep = 0; }
      }
    }
    if (this._bombAim) { it.sub = true; this._bombAim = false; this._releaseBomb = true; }
    else if (this._releaseBomb) { it.sub = false; this._releaseBomb = false; }

    // ---------------- aim: critically-damped spring with a turn-rate cap (flicks accelerate and settle; no twitch)
    const fighting = this.mode === 'fight';
    const om = fighting ? (this.diff.aimOmega ?? 13) : 8;
    const maxRate = fighting ? (this.diff.aimTurn ?? 10) : 6;
    wantPitch = clamp(wantPitch, -1.1, 1.0);
    if (this.diff.apex) {
      // a spring this stiff is unstable at a 30 fps step, and the level-5 bot has no reaction to model anyway
      this.aimYaw = wantYaw; this.aimPitch = wantPitch; this.aimYawV = this.aimPitchV = 0;
    } else {
      this.aimYawV += (om * om * angleDiff(this.aimYaw, wantYaw) - 2 * om * this.aimYawV) * dt;
      this.aimYawV = clamp(this.aimYawV, -maxRate, maxRate);
      this.aimYaw += this.aimYawV * dt;
      if (this.aimYaw > Math.PI) this.aimYaw -= Math.PI * 2; else if (this.aimYaw < -Math.PI) this.aimYaw += Math.PI * 2;
      this.aimPitchV += (om * om * (wantPitch - this.aimPitch) - 2 * om * this.aimPitchV) * dt;
      this.aimPitchV = clamp(this.aimPitchV, -maxRate * 0.7, maxRate * 0.7);
      this.aimPitch = clamp(this.aimPitch + this.aimPitchV * dt, -1.1, 1.0);
    }
    a.aimYaw = this.aimYaw; a.aimPitch = this.aimPitch;
    // shots go where the bot is actually aiming (its eye ray at the target's distance), never straight to the target
    {
      const cp = Math.cos(this.aimPitch);
      const d = fighting && this.target ? aimDist : this.mode === 'refill' ? 1.6 : this.mode === 'paint' ? this.pDist : 6;
      a.aimPoint.set(a.pos.x + Math.sin(this.aimYaw) * cp * d, a.pos.y + 1.1 + Math.sin(this.aimPitch) * d, a.pos.z + Math.cos(this.aimYaw) * cp * d);
      if (!fighting) { const gy = a.pos.y; if (a.aimPoint.y < gy) a.aimPoint.y = gy; }
    }

    // ---------------- smooth the move command: heading slews (no twitch at waypoint switches / strafe flips)
    const ml = Math.min(1, move.length());
    if (ml > 0.01) {
      const des = Math.atan2(move.x, move.z);
      const d = angleDiff(this.mvYaw, des);
      if (this.mvMag < 0.05) this.mvYaw = des;
      else if (Math.abs(d) > 2.1) { this.mvYaw = des; this.mvMag *= 0.35; }      // reversal: let the body plant and reverse
      else this.mvYaw += clamp(d, -11 * dt, 11 * dt);
    }
    this.mvMag += (ml - this.mvMag) * (1 - Math.exp(-14 * dt));
    it.move.set(Math.sin(this.mvYaw) * this.mvMag, 0, Math.cos(this.mvYaw) * this.mvMag);
    // edge guard: never steer off a deck into the sea. Probe the ground a stopping distance ahead; if it's water, slide
    // along the edge (whichever diagonal is safe) or stop.
    if (this.mvMag > 0.05 && a.grounded) this._edgeGuard(a, it.move);
    // stuck recovery, based on progress toward the current waypoint: hop → skip the waypoint → replan
    const trying = this.path && wantMove && !(w.kind === 'charger' && a.weaponRunner.charging);
    if (!trying) this.noProg = 0;
    if (this.noProg > 0.7 && this.jumpCd <= 0 && a.grounded && !this._nearWater(a, 1.2)) { it.jump = true; this.jumpCd = 1.0; }
    if (this.noProg > 1.5 && this.path && this.pi < this.path.length - 1 && !this._skipped) { this.pi++; this._skipped = true; this.bestD = Infinity; }
    if (this.noProg > 2.4) { this.noProg = 0; this._skipped = false; this.path = null; this.goalTimer = 0; this.repath = 0; }
    if (this.noProg === 0) this._skipped = false;
    this.stuck = this.noProg;
    if (this._needJump && this.jumpCd <= 0 && a.grounded) { it.jump = true; this.jumpCd = 0.6; this._needJump = false; }
    // Squid Roll: the stick snaps to the planned direction (bypassing the steering smoothing) on the jump frame
    if (this.rollOn) {
      this.rollOn = false;
      if (a.submerged && it.squid) { it.move.set(this.rollX, 0, this.rollZ); it.jump = true; this.mvYaw = Math.atan2(this.rollX, this.rollZ); }
    }
    // Squid Surge: on a tall wall, cling and charge, then let go (a short wall is just climbed)
    if (a.climbing) {
      if (this.surgePlan < 0) this.surgePlan = this._tallWall(a) && Math.random() < 0.35 + 0.6 * this.diff.fireDiscipline ? PLAYER.surgeCharge * (0.7 + 0.4 * Math.random()) : 0;
      if (this.surgePlan > 0 && !a.surging) { if (a.surgeT < this.surgePlan) it.jump = true; else this.surgePlan = 0; }
    } else this.surgePlan = -1;
  }

  // Plan a Squid Roll this frame: `turn` rad off the current fast swim heading (only while swimming near full speed)
  _planRoll(turn) {
    const a = this.a;
    if (a._fastT <= 0 || a.rollCd > 0) return;
    const c = Math.cos(turn), s = Math.sin(turn);
    this.rollX = a._fastX * c + a._fastZ * s; this.rollZ = -a._fastX * s + a._fastZ * c;
    this.rollOn = true; this.rollCd = 2.5 + Math.random() * 2.5;
  }

  // Is the wall we cling to still a wall ~2.4 m up? (worth a Squid Surge)
  _tallWall(a) {
    _v.set(a.pos.x, a.pos.y + 2.4, a.pos.z); _v2.set(-a.wallN.x, 0, -a.wallN.z);
    const h = G.physics.raycast(_v, _v2, PLAYER.radius + 0.7, _wallHit);
    return h.hit && Math.abs(h.normal.y) < 0.5;
  }

  // Low on health mid-duel: head for own ink away from the threat (swim = heal + hard to spot), then come back.
  _pickRetreat() {
    const a = this.a, t = this.target;
    let bestP = null, bs = -Infinity;
    for (let i = 0; i < 16; i++) {
      const ang = Math.random() * Math.PI * 2, r = 3 + Math.random() * 8;
      _v.set(a.pos.x + Math.cos(ang) * r, a.pos.y, a.pos.z + Math.sin(ang) * r);
      const st = G.paint.regionStats(_v.x, _v.y, _v.z, 1.4, a.team, _stats);
      if (!st.n) continue;
      const away = t ? Math.hypot(_v.x - t.pos.x, _v.z - t.pos.z) - Math.hypot(a.pos.x - t.pos.x, a.pos.z - t.pos.z) : 0;
      const score = st.own * 6 + away * 0.8 - r * 0.15 + (t && !G.physics.los(_v2.set(_v.x, _v.y + 1, _v.z), _v3.set(t.pos.x, t.pos.y + 1, t.pos.z)) ? 4 : 0);
      if (score > bs) { bs = score; bestP = _v.clone(); }
    }
    if (bestP) this._pathTo(bestP, 0.5); else this.path = null;
    this.repath = 1.0;
  }

  // overridable rules (the level-5 bot in autoplay.js changes them)
  _retreatWanted(hpFrac, w) {
    // when to back off: a careful bot goes earlier, a hot-headed one later; and anyone outnumbered 2 or more to one gives up
    // a hurt duel unless it is really aggressive
    const p = this.pers, lim = 0.24 + 0.2 * (0.5 * (1 - p.aggro) + 0.5 * p.caution);
    return (hpFrac < lim && w.kind !== 'roller' && this.hurt < 0.8) || hpFrac < 0.2 || (this._outnum && hpFrac < 0.7 && p.aggro < 0.7);
  }
  _refillWanted(inkFrac, w) { return inkFrac < 0.12 && !(this.target && this.seeTimer > 0 && w.kind !== 'roller' && inkFrac > 0.05); }
  // the distance to fight at: outside the enemy weapon's reach when ours is longer, right up in its face when shorter
  _prefDist(w, range) {
    if (w.kind === 'roller') return 0.5;
    let pref = w.kind === 'charger' ? range * 0.8 : range * 0.7;
    const t = this.target;
    if (t) {
      const gap = range - this._rangeOf(t.weapon);
      if (gap >= 2) pref = Math.min(this._rangeOf(t.weapon) + 1.5, range * 0.9);
      else if (gap <= -2) pref = range * 0.55;
    }
    return pref * (1 + (0.5 - this.pers.aggro) * 0.3);   // the bold stand closer, the careful further (±15 %)
  }
  _rangeOf(w) { return rangeOf(w); }
  _enemyNear(pos, r) {
    const a = this.a, r2 = r * r;
    for (const e of G.actors) {
      if (e.team === a.team || !e.alive) continue;
      const dx = e.pos.x - pos.x, dy = e.pos.y - pos.y, dz = e.pos.z - pos.z;
      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  // living enemies within r metres (special decisions)
  _foesWithin(r) {
    const a = this.a;
    let n = 0;
    for (const e of G.actors) if (e.team !== a.team && e.alive && e.pos.distanceTo(a.pos) <= r) n++;
    return n;
  }

  _range() { return rangeOf(this.a.weapon); }

  // Who do I notice? Only what is inside the field of view around where I'm actually aiming — plus anyone close enough
  // to hear (5 m; 12 m if they just fired) and whoever just shot me (after a slower, turn-around reaction).
  _perceive() {
    const a = this.a, d0 = this.diff, w = a.weapon;
    const eye = _v.copy(a.pos); eye.y += 1.3;
    const aw = d0.awareness, dt = this._thinkDt;
    const sy = Math.sin(this.aimYaw), cy = Math.cos(this.aimYaw), cosFov = Math.cos(d0.fov ?? 1.3);
    let best = null, bs = Infinity, bd = 0, bSeen = true, bCos = 1;
    for (const e of G.actors) {
      if (e.team === a.team || !e.alive) continue;
      const ex = e.pos.x - a.pos.x, ey = e.pos.y - a.pos.y, ez = e.pos.z - a.pos.z;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d > aw) continue;
      const swimming = e.anim.form === 'swim';
      const hs = Math.hypot(e.vel.x, e.vel.z);
      if (swimming && d > 3 && !(hs > 7 && d < 9)) continue;
      const hd = Math.hypot(ex, ez);
      const inFov = hd < 0.5 || ex * sy + ez * cy >= cosFov * hd;
      if (!inFov && !(d < 5 || (d < 12 && e.lastFire < 0.4) || (a.lastAttacker === e && this.hurt < 0.3))) continue;
      _v2.copy(e.pos); _v2.y += e.form === 'squid' ? 0.3 : 1.0;
      if (!G.physics.los(eye, _v2)) continue;
      // nearest first, but the wounded, whoever is aiming at me, whoever my mates are on, and the one I'm on all count
      let score = d - (1 - e.hp / PLAYER.hp) * 6 - (e === this.target ? 4 : 0);
      if (d < 25 && Math.abs(angleDiff(e.aimYaw, Math.atan2(-ex, -ez))) < 0.35) score -= 3;
      for (const m of G.actors) if (m !== a && m.team === a.team && m.bot && m.bot.target === e && m.bot.seeTimer > 0) score -= 3 * (d0.team ?? 0.5);
      if (score < bs) { bs = score; best = e; bd = d; bSeen = inFov; bCos = hd < 0.5 ? 1 : (ex * sy + ez * cy) / hd; }
    }
    if (best) {
      const fresh = best !== this.target;
      if (fresh) {
        this.target = best; this.repath = 0; this._prevD = 0; this._huntBomb = false;
        // noticed by ear or by getting hit: it takes a turn-around to get on it; off to the side of the view (the corner
        // of the eye) is slower to register than straight ahead
        const side = 1 + 0.8 * clamp((Math.acos(clamp(bCos, -1, 1)) - 0.35) / 0.9, 0, 1);
        this.react = d0.reaction * (bSeen ? (0.7 + Math.random() * 0.6) * side : 1.5 * (0.8 + Math.random() * 0.4));
        this.pvX = 0; this.pvZ = 0;
        // first look lands a little off (over- or under-shoot) and settles — like a human flick
        this.acqT = 0; this.acqSignY = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5); this.acqSignP = (Math.random() - 0.5) * 1.2;
        const cn = this.pers.caution * 0.75 * (w.kind === 'roller' ? 1.6 : 1);
        this._ambushRoll = Math.random() < Math.min(0.9, cn);
      }
      // back in sight after ducking out of it: a beat to see it again and get the shot off (less than a fresh one — the
      // bot was watching for it)
      else if (!this.tgtVis && this.t - this._hidT > 0.4 && !d0.apex) this.react = Math.max(this.react, d0.reaction * (0.4 + Math.random() * 0.4));
      this.tgtVis = true;
      const wasSeen = this.seeTimer > 0;
      this.seeTimer = 1.2;
      this.lostTimer = 0;
      const ls = this.lastSeen; ls.actor = best; ls.x = best.pos.x; ls.y = best.pos.y; ls.z = best.pos.z; ls.t = this.t;
      this._sizeUp(best, bd);
      if (!wasSeen || fresh) this._callOut(best);
      this._fleeing = this._prevD > 0 && bd > this._prevD + 0.5; this._prevD = bd;
      this._ambushCheck(best, bd, w);
    } else {
      if (this.tgtVis) this._hidT = this.t;
      this.tgtVis = false;
      this.seeTimer -= 0.2;
      if (this.target) {
        this.lostTimer += dt;
        if (this.lostTimer > this._huntMax() || this.target.pos.distanceTo(a.pos) > aw + 6) { this.target = null; this.lastSeen.actor = null; }
      }
    }
  }

  // how long a bot keeps chasing an enemy it lost: its memory, cut short if it isn't the chasing type
  _huntMax() { return Math.min(this.diff.memory ?? 2.5, 0.4 + 4 * this.pers.aggro); }

  // outnumbered? (enemies around the target vs my side around me) and is a bomb worth throwing? Once per look.
  _sizeUp(e, d) {
    const a = this.a;
    let foes = 0, friends = 1, near = 0;
    for (const o of G.actors) {
      if (!o.alive || o === a) continue;
      if (o.team === a.team) { if (o.pos.distanceToSquared(a.pos) < 144) friends++; continue; }
      if (o.pos.distanceToSquared(e.pos) < 144) foes++;
      if (o !== e && o.pos.distanceToSquared(e.pos) < 9) near++;
    }
    foes++;   // the target itself
    this._outnum = foes - friends >= 2;
    this._bombOk = !this.diff.apex && d > 5 && d < 13 && (near > 0 || (this._fleeing && d < 12)) && Math.random() < 0.6;
  }

  // tell allies within 15 m who don't see anybody (they hear it half a second later)
  _callOut(e) {
    const a = this.a;
    if (this._repCd > 0 || Math.random() > (this.diff.team ?? 0.5)) return;
    this._repCd = 1.5;
    for (const m of G.actors) {
      if (m === a || m.team !== a.team || !m.alive || !m.bot || m.bot.diff.apex || m.bot.seeTimer > 0 || m.bot.repActor) continue;
      if (m.pos.distanceToSquared(a.pos) > 225) continue;
      const b = m.bot;
      b.repActor = e; b.repDelay = 0.5; b.repX = e.pos.x; b.repY = e.pos.y; b.repZ = e.pos.z;
    }
  }
  _takeReport() {
    const a = this.a, e = this.repActor;
    this.repActor = null;
    if (!e || !e.alive || this.seeTimer > 0) return;
    const ls = this.lastSeen;
    if (!ls.actor) { ls.actor = e; ls.x = this.repX; ls.y = this.repY; ls.z = this.repZ; ls.t = this.t; }
    // look once toward the call; noticing it is up to the field of view afterwards
    this.alertYaw = Math.atan2(this.repX - a.pos.x, this.repZ - a.pos.z); this.alertT = 0.8;
  }

  // Ambush: on my own ink, an enemy who has not noticed me walks up → sit in the ink and wait for it.
  _ambushCheck(e, d, w) {
    const a = this.a;
    this._ambushGo = false;
    if (!this._ambushRoll || this.ambushCd > 0 || this.mode === 'ambush' || this.mode === 'retreat' || this.mode === 'refill' || a.groundTeam !== 1) return;
    const exit = w.kind === 'roller' ? 7 : this._range() * 0.7;
    if (d > Math.max(12, exit + 5) || d < exit + 0.5) return;   // (a long-reach weapon needs room to wait in)
    const ex = a.pos.x - e.pos.x, ez = a.pos.z - e.pos.z;
    if (ex * e.vel.x + ez * e.vel.z <= 0.5) return;                                   // not coming this way
    const unaware = d > 10 || Math.abs(angleDiff(e.aimYaw, Math.atan2(ex, ez))) > 1.3;
    if (unaware) this._ambushGo = true;
  }

  // which mode when not retreating / refilling
  _pickMode(dt, apex) {
    if (apex) { this.mode = this.target ? 'fight' : 'paint'; return; }
    if (this.mode === 'ambush') {
      this.ambushT -= dt;
      const t = this.target, a = this.a;
      const out = !t || this.ambushT <= 0 || this.hurt < 0.25 || a.groundTeam !== 1
        || (this.seeTimer > 0 && a.pos.distanceTo(t.pos) < (a.weapon.kind === 'roller' ? 7 : this._range() * 0.7));
      if (!out) return;
      this.ambushCd = 5;
      if (t) this.react = Math.min(this.react, this.diff.reaction * 0.35);   // sprung: it was waiting for this
      this.mode = t ? 'fight' : 'paint';
      return;
    }
    if (this.target && this.seeTimer > 0) {
      if (this._ambushGo) { this._ambushGo = false; this.mode = 'ambush'; this.ambushT = 3; this.path = null; return; }
      this.mode = 'fight';
    } else if (this.target && this.lastSeen.actor && this.lostTimer < this._huntMax()) {
      if (this.mode !== 'hunt') { this._huntBomb = false; this.repath = 0; }
      this.mode = 'hunt';
    } else this.mode = this.target ? 'fight' : 'paint';
  }

  _onKill() {
    const a = this.a;
    // squid-hop (2–3 flips) if the bot is the showy kind
    if (Math.random() < this.pers.jumpy * 0.8 && a.grounded && !this._nearWater(a, 1.5)) { this.hopN = 4 + 2 * ((Math.random() * 2) | 0); this.hopT = 0; }
    this.lookNext = 0.3;
  }

  // Bomb throw at a world point: hold the aim until it is on line (see update), then release.
  _subDef() { return SUB[this.a.weapon.sub] || SUB.bomb; }

  _startBomb(x, y, z) {
    const a = this.a;
    const hd = Math.hypot(x - a.pos.x, z - a.pos.z);
    const p = this._bombPitchFor(hd, y - a.pos.y);
    const id = this._subDef().id;
    this.bombCd = id === 'burst' ? 2 + Math.random() * 2.5 : id === 'sprinkler' ? 12 + Math.random() * 8 : 5 + Math.random() * 6;
    if (p === null) return;
    this.bombYaw = Math.atan2(x - a.pos.x, z - a.pos.z); this.bombPitch = clamp(p - 0.28, -1.1, 1.0); this.bombPrep = 0.7;
  }
  // launch pitch that lands a thrown bomb hd metres away (dy above my feet) — the game's own integrator (throwSpeed + 1.5 m/s lift, 24 m/s² gravity)
  _bombPitchFor(hd, dy) {
    const y0 = 1.35, ty = dy + 0.2, v = this._subDef().throwSpeed;
    let best = null, bestErr = 0.8;
    for (let p = -0.3; p <= 1.1; p += 0.05) {
      let x = 0, y = y0, vh = Math.cos(p) * v, vy = Math.sin(p) * v + 1.5;
      for (let i = 0; i < 140; i++) {
        vy -= 24 / 60; x += vh / 60; y += vy / 60;
        if (y <= ty && vy < 0) break;
      }
      const err = Math.abs(x - hd);
      if (y <= ty && err < bestErr) { bestErr = err; best = p; }
    }
    return best;
  }

  // Painting aim, refreshed every 0.25 s: which of five directions around the heading has the most ground that isn't
  // mine, and the pitch that lands the shot on the ground there.
  _paintAim(w, heading) {
    const a = this.a;
    if (w.kind === 'roller') {
      const st = G.paint.regionStats(a.pos.x + Math.sin(heading) * 3.5, a.pos.y, a.pos.z + Math.cos(heading) * 3.5, 2, a.team, _stats);
      this.pyOff = 0; this.pPitch = -0.42; this.pDist = 6; this.needPaint = st.n === 0 || st.own < 0.75;
      return;
    }
    const ds = Math.min(9, this._range() * 0.55);
    let bo = 0, bn = -1, found = false;
    for (let i = 0; i < PAINT_OFFS.length; i++) {
      const off = PAINT_OFFS[i], yaw = heading + off;
      const st = G.paint.regionStats(a.pos.x + Math.sin(yaw) * ds, a.pos.y, a.pos.z + Math.cos(yaw) * ds, 1.3, a.team, _stats);
      if (!st.n) continue;
      const v = 1 - st.own - Math.abs(off) * 0.03;
      if (v > bn) { bn = v; bo = off; found = true; }
    }
    this.pyOff = found ? bo : 0;
    this.needPaint = found && bn > 0.15 - 0.03 * Math.abs(bo);
    const yaw = heading + this.pyOff, px = a.pos.x + Math.sin(yaw) * ds, pz = a.pos.z + Math.cos(yaw) * ds;
    const gy = G.level.groundHeight(px, pz, a.pos.y + 1.0);
    const dy = (gy === -Infinity ? a.pos.y - 1.1 : gy) - (a.pos.y + 1.1);
    this.pPitch = clamp(Math.atan2(dy, ds), -1.0, 0.3);   // the weapon lobs onto aimPoint itself, so aim straight at the spot
    this.pDist = Math.max(1.5, Math.hypot(ds, dy));
    // a splat bomb for turf: a wide bare patch 8 m ahead, ink to spare, now and then
    // painting with the sub: a bomb or a sprinkler onto unclaimed ground ahead (a burst bomb paints too little to bother)
    if (!this.diff.apex && this._subDef().id !== 'burst' && this.bombCd <= 0 && this.bombPrep <= 0 && a.ink >= 80 && this.tailT <= 0 && Math.random() < 0.12) {
      const far = this._subDef().id === 'sprinkler' ? 6 : 8;
      const bx = a.pos.x + Math.sin(heading) * far, bz = a.pos.z + Math.cos(heading) * far;
      const st = G.paint.regionStats(bx, a.pos.y, bz, 3, a.team, _stats);
      if (st.n > 4 && st.own < 0.3) this._startBomb(bx, a.pos.y, bz);
    }
  }

  // Looking around: every 2–5 s (more often for the curious) a 0.4–0.8 s glance to the side or behind, only while
  // the trigger is idle. An ally's call overrides it once. The head really turns, so the field of view moves with it.
  _lookYaw(dt, yaw, it) {
    if (this.alertT > 0) { this.alertT -= dt; it.fire = false; return this.alertYaw; }
    if (this.mode !== 'paint') { this.lookT = 0; return yaw; }
    this.lookNext -= dt * (0.4 + 1.2 * this.pers.curious) * (this.diff.look ?? 1);
    if (this.lookNext <= 0) {
      this.lookNext = 2 + Math.random() * 3;
      if (!it.fire) { this.lookT = 0.4 + Math.random() * 0.4; this.lookOff = (Math.random() < 0.5 ? -1 : 1) * (1.3 + Math.random() * 1.6); }
    }
    return this.lookT > 0 && !it.fire ? yaw + this.lookOff : yaw;
  }

  _pathTo(pos, maxUp = 0.8) {
    const nav = G.nav;
    const s = nav.nearest(this.a.pos, 1.2);
    const g = nav.nearest(pos, maxUp);
    this.repath = 0.8 + Math.random() * 0.4;
    if (s < 0 || g < 0) { this.path = null; return false; }
    const p = nav.path(s, g, this.a.team);
    if (!p) { this.path = null; return false; }
    this.path = p; this.pi = Math.min(1, p.length - 1); this.goal = g; this.bestD = Infinity; this.noProg = 0;
    return true;
  }

  // Where to paint next. Opening 12 s: each slot takes its own lane out of the spawn (centre / left / right / around the
  // base). After that: bare ground and the enemy's ink score high, and the closer to the front line (where both colours
  // meet) the better as the match wears on; the last 30 s go to painting over the enemy's turf.
  _pickPaintGoal() {
    const a = this.a, nav = G.nav, apex = !!this.diff.apex, p = this.pers, m = G.match;
    let best = -1, bs = -Infinity;
    const enemyPad = G.level.spawnPads[1 - a.team];
    const ownPad = G.level.spawnPads[a.team];
    const total = ownPad.distanceTo(enemyPad);
    const elapsed = m ? m.duration - m.time : 99, frac = m ? clamp(elapsed / m.duration, 0, 1) : 0.5;
    const early = elapsed < 12 && !apex;
    const enemyW = apex ? 2.5 : m && m.time < 30 ? 2.0 : 1.25;
    let lx = 0, lz = 0;
    if (early) {
      const ax = (enemyPad.x - ownPad.x) / total, az = (enemyPad.z - ownPad.z) / total, ln = LANES[a.slot % LANES.length];
      lx = ownPad.x + ax * total * ln[0] - az * ln[1]; lz = ownPad.z + az * total * ln[0] + ax * ln[1];
    }
    for (let i = 0; i < 16; i++) {
      const id = nav.validIds[(Math.random() * nav.validIds.length) | 0];
      const n = nav.nodes[id];
      if (n.zone >= 0) continue;
      const d = Math.hypot(n.x - a.pos.x, n.z - a.pos.z);
      if (d > 34) continue;
      const st = G.paint.regionStats(n.x, n.y, n.z, 3.5, a.team, _stats);
      if (!st.n) continue;
      let score;
      if (early) score = (st.empty + st.enemy) * 5 - Math.hypot(n.x - lx, n.z - lz) * 0.5 - d * 0.05 + Math.random() * 2;
      else {
        const progress = 1 - Math.hypot(n.x - enemyPad.x, n.z - enemyPad.z) / total; // 0 at own base → 1 at enemy base
        score = (st.empty * (apex ? 1 : 0.8 + 0.5 * p.painter) + st.enemy * enemyW) * 12 - d * 0.18 + clamp(progress, 0, 0.8) * 4 + Math.random() * 2.5;
        if (!apex) {
          // the front: both colours within 5 m of the spot
          const fr = G.paint.regionStats(n.x, n.y, n.z, 5, a.team, _stats);
          if (fr.own >= 0.2 && fr.enemy >= 0.2) score += (0.5 + 3 * frac) * (0.6 + 0.8 * p.aggro);
        }
      }
      for (const o of G.actors) if (o !== a && o.team === a.team && o.bot && o.bot.goal >= 0) { const g = nav.nodes[o.bot.goal]; if (Math.hypot(g.x - n.x, g.z - n.z) < 7) score -= 4; }
      if (score > bs) { bs = score; best = id; }
    }
    this.goalTimer = 4 + Math.random() * 3;
    if (best < 0) return;
    const n = nav.nodes[best];
    this._pathTo(_v3.set(n.x, n.y, n.z), 0.3);
  }

  _pickRefill() {
    const a = this.a;
    // search nearby for own ink
    let bestP = null, bd = Infinity;
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2, r = 1 + Math.random() * 7;
      _v.set(a.pos.x + Math.cos(ang) * r, a.pos.y, a.pos.z + Math.sin(ang) * r);
      const st = G.paint.regionStats(_v.x, _v.y, _v.z, 1.2, a.team, _stats);
      if (st.n && st.own > 0.6 && r < bd) { bd = r; bestP = _v.clone(); }
    }
    if (bestP) this._pathTo(bestP, 0.4);
    else { this.path = null; }
    this.repath = 1.2;
  }

  _pathRemaining() {
    if (!this.path) return 0;
    const n = G.nav.nodes[this.path[this.path.length - 1]];
    return Math.hypot(n.x - this.a.pos.x, n.z - this.a.pos.z);
  }

  // sea underfoot: no ground at all (the same test that splats an actor, actor.js). Solid floor below the waterline is
  // not sea — Kelpline's sunken trench (y -2) and the Skatepark bowl (y -1.6) are walled dry pits, and treating them as
  // water froze every bot that walked in (the edge guard turned each step down)
  _wet(x, z, y) { return G.level.groundHeight(x, z, y + 0.6) === -Infinity; }
  // ground all the way along a straight walk (samples every 0.45 m)
  _dryLine(x0, y0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.45);
    for (let i = 1; i <= n; i++) { const t = i / n; if (this._wet(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, y0)) return false; }
    return true;
  }
  _nearWater(a, r) {
    for (let k = 0; k < 8; k++) { const t = (k / 8) * Math.PI * 2; if (this._wet(a.pos.x + Math.cos(t) * r, a.pos.z + Math.sin(t) * r, a.pos.y)) return true; }
    return false;
  }
  _edgeGuard(a, mv) {
    const m = Math.hypot(mv.x, mv.z); if (m < 1e-4) return;
    const dx = mv.x / m, dz = mv.z / m;
    const look = 0.6 + Math.hypot(a.vel.x, a.vel.z) * 0.17;
    const px = a.pos.x, py = a.pos.y, pz = a.pos.z;
    const bad = (ux, uz) => this._wet(px + ux * 0.45, pz + uz * 0.45, py) || this._wet(px + ux * look, pz + uz * look, py);
    if (!bad(dx, dz)) return;
    for (const ang of [0.8, -0.8, 1.45, -1.45]) {
      const c = Math.cos(ang), s = Math.sin(ang), nx = dx * c + dz * s, nz = -dx * s + dz * c;
      if (!bad(nx, nz)) { mv.set(nx * m, 0, nz * m); return; }
    }
    mv.set(0, 0, 0);
  }

  // body-width line of sight at knee height (centre + both shoulders) so bots never cut corners they can't fit past
  _fatLos(ax, ay, az, bx, by, bz) {
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const px = (-dz / l) * 0.34, pz = (dx / l) * 0.34;
    for (const o of [0, 1, -1]) {
      _v.set(ax + px * o, ay + 0.45, az + pz * o); _v2.set(bx + px * o, by + 0.45, bz + pz * o);
      if (!G.physics.los(_v, _v2)) return false;
    }
    return true;
  }

  _steer(dt) {
    const a = this.a, nav = G.nav, out = this._mv || (this._mv = new THREE.Vector3());
    out.set(0, 0, 0);
    if (!this.path || this.pi >= this.path.length) return out;
    // advance waypoints we've reached (generous vertically when dropping down)
    while (this.pi < this.path.length) {
      const n = nav.nodes[this.path[this.pi]];
      const dx = n.x - a.pos.x, dz = n.z - a.pos.z, dy = n.y - a.pos.y;
      if (dx * dx + dz * dz < 0.6 * 0.6 && dy < 0.9 && dy > -1.8) { this.pi++; this.bestD = Infinity; this.noProg = 0; }
      else break;
    }
    if (this.pi >= this.path.length) return out;
    const cur = nav.nodes[this.path[this.pi]];
    const hd = Math.hypot(cur.x - a.pos.x, cur.z - a.pos.z);
    // waypoint is above us and we can't get there from here (slipped off a ledge, got pushed): replan now
    if (a.grounded && cur.y - a.pos.y > 0.9 && hd < 1.2 && nav.edgeType(this.path[Math.max(0, this.pi - 1)], this.path[this.pi]) !== 'jump') {
      this.path = null; this.repath = 0; this.goalTimer = 0;
      return out;
    }
    // look ahead: aim at the furthest waypoint we can walk to in a straight line on this level (re-chosen every
    // ~0.1 s or when the waypoint advances — the probes are the costly part, the heading still updates every frame)
    let ti = this.pi;
    this._laT = (this._laT ?? 0) - dt;
    if (this._laT > 0 && this._laPi === this.pi && this._laPath === this.path && this._laTi < this.path.length) ti = this._laTi;
    else {
      for (let k = this.pi + 1; k < Math.min(this.path.length, this.pi + 7); k++) {
        const n = nav.nodes[this.path[k]];
        if (Math.abs(n.y - a.pos.y) > 0.4) break;
        if (nav.edgeType(this.path[k - 1], this.path[k]) !== 'walk') break;
        if (!this._fatLos(a.pos.x, a.pos.y, a.pos.z, n.x, n.y, n.z)) break;
        if (!this._dryLine(a.pos.x, a.pos.y, a.pos.z, n.x, n.z)) break;   // never cut a corner across water
        ti = k;
      }
      this._laT = 0.1; this._laPi = this.pi; this._laPath = this.path; this._laTi = ti;
    }
    const n = nav.nodes[this.path[ti]];
    out.set(n.x - a.pos.x, 0, n.z - a.pos.z);
    const l = out.length();
    // nobody walks the exact middle of the road: drift up to 0.4 m to one side, a new side every second or so (fades
    // out on approach so the waypoints still get hit). Not in a fight, not for the level-5 bot.
    if (l > 0.001 && !this.diff.apex && (this.mode === 'paint' || this.mode === 'hunt')) {
      this.latT -= dt;
      if (this.latT <= 0) { this.latT = 1.2 + Math.random() * 1.5; this.latOff = (Math.random() < 0.5 ? -1 : 1) * Math.random() * 0.4; }
      this.latCur += (this.latOff - this.latCur) * (1 - Math.exp(-2 * dt));
      const s = this.latCur * Math.min(1, l / 3) / l;
      out.set(out.x + out.z * s, 0, out.z - out.x * s);
    }
    const l1 = out.length();
    if (l1 > 0.001) out.multiplyScalar(1 / l1);
    // jump edges
    if (this.pi > 0) {
      const et = nav.edgeType(this.path[this.pi - 1], this.path[this.pi]);
      if (et === 'jump' && cur.y - a.pos.y > 0.4 && hd < 1.6) this._needJump = true;
    }
    // separation from teammates (only sideways relative to travel, so it never stalls forward progress)
    for (const o of G.actors) {
      if (o === a || !o.alive) continue;
      const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.4 * 1.4 && d2 > 1e-4) {
        const d = Math.sqrt(d2), k = (1.4 - d) * 0.7;
        const side = (dx * -out.z + dz * out.x) >= 0 ? 1 : -1;
        const ox = out.x, oz = out.z;
        out.x = ox - oz * side * k; out.z = oz + ox * side * k;
      }
    }
    const l2 = out.length();
    if (l2 > 1) out.multiplyScalar(1 / l2);
    // progress tracking toward the current waypoint (used by the stuck recovery)
    if (hd < this.bestD - 0.2) { this.bestD = hd; this.noProg = 0; } else this.noProg += dt;
    return out;
  }

}

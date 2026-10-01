// Touch controls (phones / tablets, landscape). Pointer Events with any number of fingers:
//   · left side  — floating move stick: wherever the thumb lands becomes the stick's centre
//   · right side — drag to look (raw deltas, scaled by settings.touchSensitivity)
//   · buttons    — fire, squid form (hold, or toggle via settings), jump, bomb (hold to aim, release to throw), special,
//                  map (hold; tap a pin to Super Jump), pause. Every button but map / pause also aims: drag while holding
//                  it (jump / squid / special / slide only after a small dead zone, so a shaky thumb does not turn the camera)
//                  · slide (dualies only): fire + dodge-roll in one press; direction = stick, else a quick sideways swipe
//                  on the button, else camera-right
// Mirrored for left-handed play (settings.touchLeftHanded); size / opacity from settings.touchScale / touchOpacity.
// State is read by PlayerController each frame (move, lookDx/lookDy, held.*) and cleared by Input.endFrame().
import { G, VIEW } from './ctx.js';
import { tr, N_ } from '../i18n/index.js';
import { GLYPHS, SQUID, SUB_ICONS, weaponIcon, specialIcon } from '../ui/ui-icons.js';

export const TOUCH_CAPABLE = typeof navigator !== 'undefined' && typeof window !== 'undefined'
  && ((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window);
// phones and tablets: touch is the primary input (a touch-screen laptop with a mouse/trackpad is not)
export const TOUCH_PRIMARY = TOUCH_CAPABLE && typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

const JUMP_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 10 L50 32 H39 V52 H25 V32 H14 Z" fill="currentColor" stroke="#15121c" stroke-width="4" stroke-linejoin="round"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="16" y="12" width="11" height="40" rx="4" fill="currentColor"/><rect x="37" y="12" width="11" height="40" rx="4" fill="currentColor"/></svg>';
const BUTTONS = [
  // id, label (translated at build), which HUD state lights it up
  { id: 'fire', label: N_('Shoot') },
  { id: 'sub', label: N_('Bomb') },
  { id: 'squid', label: N_('Squid') },
  { id: 'jump', label: N_('Jump') },
  { id: 'special', label: N_('Special') },
  { id: 'slide', label: N_('Slide') },
  { id: 'map', label: N_('Map') },
];
const SLIDE_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M6 32 L24 16 V26 H40 V16 L58 32 L40 48 V38 H24 V48 Z" fill="currentColor" stroke="#15121c" stroke-width="4" stroke-linejoin="round"/></svg>';
// buttons whose drag only aims after the finger has travelled this far (px): a press is not a swipe
const LOOK_DEADZONE = { jump: 8, squid: 8, special: 8, slide: 14 };
const SLIDE_WAIT = 0.12;        // s a slide press waits for a sideways swipe when the stick is neutral
const SLIDE_SWIPE = 12;         // px of sideways travel that picks the slide direction
const STICK_R = 0.075;          // stick travel radius as a fraction of the viewport height (≈ 29 px on a 390 px phone)

export class TouchControls {
  constructor(root, input) {
    this.input = input;
    this.move = { x: 0, y: 0 };
    this.lookDx = 0; this.lookDy = 0;
    this.held = { fire: false, sub: false, squid: false, jump: false, special: false, map: false, slide: false };
    this.slideReq = null;        // { x, y } stick-space direction for one dodge roll; taken by PlayerController.takeSlide()
    this._slidePend = null;      // { t, dx } a slide press still waiting for a swipe direction
    this.squidLatched = false;
    this.active = false;
    this.onPause = null;
    this._ptr = new Map();       // pointerId → { role, id?, x, y, ox, oy }
    this._build(root);
    this.applySettings(G.settings || {});
  }

  _build(root) {
    const el = (this.el = document.createElement('div'));
    el.className = 'iw-touch';
    el.setAttribute('aria-hidden', 'true');
    const zone = (cls) => { const z = document.createElement('div'); z.className = 'iw-touch__zone ' + cls; el.appendChild(z); return z; };
    this.zoneMove = zone('iw-touch__zone--move');
    this.zoneLook = zone('iw-touch__zone--look');
    this.stick = document.createElement('div');
    this.stick.className = 'iw-tstick';
    this.stick.innerHTML = '<i class="iw-tstick__base"></i><i class="iw-tstick__knob"></i>';
    this.knob = this.stick.lastChild;
    el.appendChild(this.stick);
    this.btns = {};
    for (const b of BUTTONS) {
      const n = document.createElement('div');
      n.className = `iw-tbtn iw-tbtn--${b.id}`;
      n.dataset.b = b.id;
      n.innerHTML = `<span class="iw-tbtn__icon"></span><span class="iw-tbtn__label"></span>`;
      n._label = b.label;
      el.appendChild(n);
      this.btns[b.id] = n;
    }
    this.btns.squid.querySelector('.iw-tbtn__icon').innerHTML = SQUID;
    this.btns.jump.querySelector('.iw-tbtn__icon').innerHTML = JUMP_ICON;
    this.btns.slide.querySelector('.iw-tbtn__icon').innerHTML = SLIDE_ICON;
    this.btns.slide.classList.add('is-hidden');
    this.btns.sub.querySelector('.iw-tbtn__icon').innerHTML = SUB_ICONS.bomb;
    this.btns.map.querySelector('.iw-tbtn__icon').innerHTML = GLYPHS.map;
    this.pauseBtn = document.createElement('div');
    this.pauseBtn.className = 'iw-tbtn iw-tbtn--pause';
    this.pauseBtn.dataset.b = 'pause';
    this.pauseBtn.innerHTML = `<span class="iw-tbtn__icon">${PAUSE_ICON}</span>`;
    el.appendChild(this.pauseBtn);
    this.relabel();
    root.appendChild(el);

    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._moveEv(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('lostpointercapture', (e) => this._up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  relabel() {
    for (const n of Object.values(this.btns)) n.querySelector('.iw-tbtn__label').textContent = tr(n._label);
  }

  applySettings(s) {
    this.sens = s.touchSensitivity ?? 1;
    this.toggleSquid = !!s.touchSquidToggle;
    if (!this.toggleSquid) this.squidLatched = false;
    this.el.classList.toggle('is-left', !!s.touchLeftHanded);
    this.el.style.setProperty('--tscale', String(s.touchScale ?? 1));
    this.el.style.setProperty('--topa', String(s.touchOpacity ?? 0.85));
  }

  /** Loadout-dependent icons (weapon on the fire button, the kit's special). */
  setLoadout(weaponKind, specialId) {
    this.btns.fire.querySelector('.iw-tbtn__icon').innerHTML = weaponIcon(weaponKind);
    this.btns.special.querySelector('.iw-tbtn__icon').innerHTML = specialIcon(specialId);
    const dual = weaponKind === 'dualies';
    this.btns.slide.classList.toggle('is-hidden', !dual);
    if (!dual) { this.held.slide = false; this._slidePend = null; this.btns.slide.classList.remove('is-down'); }
  }

  /** The player's team ink tints the fire / squid buttons. */
  setColor(hex) {
    const c = parseInt(String(hex).replace('#', ''), 16);
    if (!Number.isFinite(c)) return;
    this.el.style.setProperty('--a', '#' + c.toString(16).padStart(6, '0'));
    this.el.style.setProperty('--a-rgb', `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}`);
  }

  /** Per-frame HUD mirror: special ready glow, bomb affordable, squid latch state, map open. */
  sync({ specialReady = false, canSub = true, mapOpen = false } = {}) {
    const L = this._l || (this._l = {});
    if (L.sp !== specialReady) { L.sp = specialReady; this.btns.special.classList.toggle('is-ready', specialReady); }
    if (L.sub !== canSub) { L.sub = canSub; this.btns.sub.classList.toggle('is-off', !canSub); }
    const sq = this.held.squid;
    if (L.sq !== sq) { L.sq = sq; this.btns.squid.classList.toggle('is-latched', this.toggleSquid && sq); }
    if (L.map !== mapOpen) { L.map = mapOpen; this.el.classList.toggle('is-map', mapOpen); }
  }

  setActive(on) {
    on = !!on;
    if (on === this.active) return;
    this.active = on;
    this.el.classList.toggle('is-on', on);
    if (!on) this.reset();
  }

  reset() {
    for (const [id, p] of this._ptr) { try { p.cap?.releasePointerCapture(id); } catch { /* gone */ } }
    this._ptr.clear();
    this.move.x = this.move.y = 0;
    this.lookDx = this.lookDy = 0;
    this.slideReq = null; this._slidePend = null;
    for (const k in this.held) this.held[k] = false;
    this.squidLatched = false;
    for (const n of Object.values(this.btns)) n.classList.remove('is-down');
    this.stick.classList.remove('is-on');
  }

  endFrame() { this.lookDx = 0; this.lookDy = 0; }

  // ------------------------------------------------------------------ pointer routing
  _down(e) {
    if (e.pointerType === 'mouse' || !this.active) return;
    e.preventDefault();
    this.input.lastDevice = 'touch';
    const bEl = e.target.closest && e.target.closest('[data-b]');
    const p = { role: 'look', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, id: null };
    if (bEl) {
      p.role = 'btn'; p.id = bEl.dataset.b;
      if (p.id === 'pause') { this.onPause?.(); return; }
      this._press(p.id, true);
    } else if (e.target === this.zoneMove) {
      p.role = 'stick';
      this.stick.style.transform = `translate3d(${p.ox}px,${p.oy}px,0)`;
      this.knob.style.transform = '';
      this.stick.classList.add('is-on');
    }
    // capture on the touched zone / button (the layer itself is pointer-events: none); moves and the release still
    // bubble up to this.el even when the finger slides off
    if (p.id === 'slide') this._slideDown();
    p.cap = bEl || e.target;
    try { p.cap.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this._ptr.set(e.pointerId, p);
  }

  _moveEv(e) {
    const p = this._ptr.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (p.role === 'stick') {
      const r = Math.max(24, VIEW.h * STICK_R * (G.settings?.touchScale ?? 1));
      let sx = (p.x - p.ox) / r, sy = (p.y - p.oy) / r;
      const m = Math.hypot(sx, sy);
      // the stick base follows a thumb that slides past the rim, so reversing direction is instant
      if (m > 1) { p.ox += (sx / m) * (m - 1) * r; p.oy += (sy / m) * (m - 1) * r; sx /= m; sy /= m; this.stick.style.transform = `translate3d(${p.ox}px,${p.oy}px,0)`; }
      this.move.x = sx; this.move.y = -sy;
      this.knob.style.transform = `translate(${(sx * r).toFixed(1)}px,${(sy * r).toFixed(1)}px)`;
    } else if (p.role === 'look') {
      this.lookDx += dx; this.lookDy += dy;
    } else if (p.role === 'btn' && p.id !== 'map') {
      // fire / bomb aim at once; the others wait until the finger has really moved (LOOK_DEADZONE), and the travel
      // before that point is not turned into camera motion
      const dz = LOOK_DEADZONE[p.id];
      let aim = true;
      if (dz && !p.far) { aim = false; if (Math.hypot(p.x - p.ox, p.y - p.oy) >= dz) p.far = true; }
      if (aim) { this.lookDx += dx; this.lookDy += dy; }
      if (p.id === 'slide' && this._slidePend) {
        this._slidePend.dx += dx;
        if (Math.abs(this._slidePend.dx) >= SLIDE_SWIPE) this._slideResolve(this._slidePend.dx > 0 ? 1 : -1, 0);
      }
    }
  }

  _up(e) {
    const p = this._ptr.get(e.pointerId);
    if (!p) return;
    this._ptr.delete(e.pointerId);
    if (p.role === 'stick') { this.move.x = this.move.y = 0; this.stick.classList.remove('is-on'); }
    else if (p.role === 'btn') this._press(p.id, false);
  }

  // slide press: a tilted stick decides the direction now; a neutral stick waits SLIDE_WAIT s for a sideways swipe
  // on the button, then falls back to camera-right (takeSlide() resolves the timeout on the next frame)
  _slideDown() {
    if (Math.hypot(this.move.x, this.move.y) >= 0.3) this._slideResolve(this.move.x, this.move.y);
    else this._slidePend = { t: performance.now(), dx: 0 };
  }
  _slideResolve(x, y) {
    this._slidePend = null;
    this.slideReq = { x, y };
  }
  /** PlayerController, once per frame: the pending slide direction ({ x, y } in stick space) or null. */
  takeSlide() {
    if (this._slidePend && performance.now() - this._slidePend.t >= SLIDE_WAIT * 1000) this._slideResolve(1, 0);
    const r = this.slideReq;
    this.slideReq = null;
    return r;
  }

  _press(id, down) {
    const n = this.btns[id];
    if (n) n.classList.toggle('is-down', down);
    if (id === 'squid' && this.toggleSquid) {
      if (down) this.squidLatched = !this.squidLatched;
      this.held.squid = this.squidLatched;
      return;
    }
    if ((id === 'fire' || id === 'slide') && down && this.squidLatched) { this.squidLatched = false; this.held.squid = false; }
    if (id in this.held) this.held[id] = down;
  }
}

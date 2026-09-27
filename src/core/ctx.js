// Global game context + tiny event bus. Modules read shared systems off G lazily (G.paint, G.physics, ...).
export const G = {
  renderer: null, scene: null, camera: null,
  settings: null, quality: null,
  level: null, paint: null, physics: null, fx: null, env: null,
  audio: null, music: null, hud: null, menus: null, input: null,
  match: null, actors: [], local: null, projectiles: null,
  teamColors: [null, null],      // THREE.Color (linear) per team
  teamHex: ['#ff8a14', '#2f5bff'],
  time: 0,
  mode: 'boot',                  // 'boot' | 'menu' | 'match'
};

const listeners = new Map();
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}
export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of set) fn(payload);
}

// Viewport size in CSS px, refreshed by the resize event (which fires before the frame's rAF callbacks). The frame
// loop reads this instead of window.innerWidth / innerHeight: those force a synchronous layout whenever the HUD has
// written to the DOM earlier in the same frame.
export const VIEW = { w: 0, h: 0 };
if (typeof window !== 'undefined') {
  const upd = () => { VIEW.w = window.innerWidth; VIEW.h = window.innerHeight; };
  upd();
  window.addEventListener('resize', upd);
}

// compileAsync for materials that are drawn into a render target (the composer's HDR buffer, a showcase or bake
// target). three keys every program by the output colour space and tone mapping, and those differ between the canvas
// and any render target — so a plain compileAsync (current target: the canvas) builds variants nothing draws with, and
// the real ones then compile synchronously on the first frame. Only compile()'s synchronous start reads the target.
export function compileForTarget(renderer, scene, camera, target) {
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    return renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera));
  } catch (e) {
    return Promise.reject(e);
  } finally {
    renderer.setRenderTarget(prev);
  }
}

// ---- small math helpers shared by core modules ----
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export function dampAngle(a, b, lambda, dt) { return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt)); }

// Deterministic hash → [0,1)
export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }

// Seeded RNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

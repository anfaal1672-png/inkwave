// Shared tuning + content definitions. Every module reads from here; nothing here imports anything.

export const GAME_TITLE = 'INKWAVE';
export const GAME_SUBTITLE = 'Turf Riot';
export const VERSION = '1.0.0';

// Team ink palettes. Team 0 ("Alpha") is always the local player's team; a palette is picked per match.
export const TEAM_PALETTES = [
  { id: 'tangerine-cobalt', a: '#ff8a14', b: '#2f5bff', names: ['Tangerine', 'Cobalt'] },
  { id: 'bubblegum-mint', a: '#ff3f9e', b: '#18d48c', names: ['Bubblegum', 'Mint'] },
  { id: 'lemon-grape', a: '#f2e312', b: '#8a3cff', names: ['Lemon', 'Grape'] },
  { id: 'aqua-cherry', a: '#10d2e6', b: '#ff4150', names: ['Aqua', 'Cherry'] },
  { id: 'lime-magenta', a: '#a6f01a', b: '#e02cd8', names: ['Lime', 'Magenta'] },
];
// Used instead when settings.colorblind is on (yellow vs blue is safe for all common CVD types).
export const COLORBLIND_PALETTE = { id: 'cb-yellow-blue', a: '#ffd21a', b: '#2a52ff', names: ['Sun', 'Sea'] };

export const TEAM_NAMES = ['Alpha', 'Bravo'];

// ---- Player physics / feel (meters, seconds) ----
export const PLAYER = {
  hp: 100,
  radius: 0.38,
  height: 1.45,          // kid form standing height (feet -> top of head)
  squidHeight: 0.55,
  runSpeed: 6.0,
  squidDrySpeed: 2.9,    // squid hopping on unpainted ground
  swimSpeed: 11.8,       // squid submerged in own ink
  enemyInkSpeed: 1.9,
  climbSpeed: 7.5,
  accelGround: 42,
  accelAir: 14,
  accelSwim: 60,
  jumpVel: 8.4,
  swimJumpVel: 9.4,
  gravity: 25,
  maxFall: 40,
  inkMax: 100,
  inkRefillSwim: 42,     // per second while submerged
  inkRefillKid: 9,       // per second in kid form after idle delay
  inkRefillDelay: 0.9,
  enemyInkDps: 20,       // damage/s while standing in enemy ink ...
  enemyInkDamageCap: 40, // ... never takes you below (hp - cap) from ink alone
  regenDelay: 1.3,
  regenRate: 22,
  regenRateSwim: 60,
  respawnTime: 5.5,
  spawnInvuln: 1.6,
  fallDeathY: -1.45,  // touching the sea (surface y = -1.6) splats you
  waterY: -1.6,

  // ---- handling (see actor.js _horizontal / _integrate). Measured with tools/measure-handling.mjs.
  // ground run: S-curve accel (ease-in over the first ~1.6 m/s, ease-out over the last 28 % of top speed)
  runAccel: 70, runAccelIn: 0.5, runInKnee: 1.6, runOutKnee: 0.28, runOutMin: 0.22,
  runDecel: 58, runDecelMin: 0.4, runDecelKnee: 2.2,   // brake: strong at speed, eases into the stop (no hard corner)
  reverseDecel: 78, reverseAngle: 2.2,                  // > ~126° input change = plant-and-reverse (vector brake-through)
  turnRate: 15, turnRateSlow: 1.5,                      // velocity heading slew (rad/s); faster when slow → carve, never dip
  airAccel: 20, airDecel: 4, airMinSpeed: 4.6,
  squidAccel: 34, squidDecel: 26, squidTurn: 13,        // squid hopping on dry ground (also the swim-exit glide)
  swimAccel: 64, swimAccelIn: 0.75, swimDecel: 42, swimTurn: 11, swimOutKnee: 0.22,   // 90 % speed in 0.18 s, 1.6 m glide to a stop
  squidAirAccel: 14, squidAirDecel: 3,
  enemyInkDecel: 30, enemyInkAccel: 30,                 // wading into enemy ink: a quick but readable bog-down
  // jumping
  jumpBuffer: 0.13,       // a jump pressed this long before touching down still fires on landing
  coyoteTime: 0.12,       // ... and this long after walking off an edge
  fallGravityMul: 1.2,    // snappier descent
  apexGravityMul: 0.82,   // a hair of hang at the top of the arc (|vy| < apexBand)
  apexBand: 1.6,
  hardLandSpeed: 11.5,    // landings faster than this (falls > ~2.3 m) cost a short recovery
  hardLandSlow: 0.72, hardLandTime: 0.16,
  // character controller
  footRadius: 0.24,       // flat footprint for the ground probe (ledge hold / lips)
  stepUp: 0.35,           // curbs/lips a kid walks straight onto (body capsule is lifted by this much)
  stepDown: 0.45,         // ground stick range while grounded (ramps, steps down)
  squidStepUp: 0.24, squidBodyLift: 0.16,
  ledgeAssist: 0.35,      // falling feet this far below a ledge top still land on it (pop-up, visually smoothed)
  // facing (angular spring with a rate cap: smooth ease-in/out turns, never a snap)
  faceOmega: 20, faceMaxRate: 12.5, faceMaxAcc: 170, squidFaceOmega: 26, squidFaceMaxRate: 17, swimFaceMaxRate: 14, squidFaceMaxAcc: 260,
  aimFaceOmega: 36, aimFaceMaxRate: 24, aimFaceMaxAcc: 380,
  // wall climb
  climbAccel: 46, climbSideSpeed: 5.2, climbAttachDot: 0.5, climbDetachDot: -0.45,
  ledgePopClear: 0.42,    // apex this far above the ledge top when popping over it
  ledgePopCarry: 2.5,     // forward speed onto the ledge
  emergeDelay: 0.07,      // squid → kid before the first shot can leave the barrel (the shot is buffered, not lost)
  fireBuffer: 0.16,
};

// ---- Weapons ----
// stats.* are 0..1 display bars for the loadout screen.
export const WEAPONS = {
  shooter: {
    id: 'shooter', name: 'Spritzer', kind: 'shooter', class: 'Shooter', sub: 'bomb',
    blurb: 'Rapid-fire all-rounder. Sprays a steady stream of ink blobs.',
    stats: { range: 0.5, damage: 0.45, rate: 0.85, mobility: 0.7, paint: 0.6 },
    fireInterval: 0.1, damage: 36, inkPerShot: 0.95,
    projSpeed: 34, straightTime: 0.13, range: 12.5,
    spreadGround: 5.5, spreadAir: 11,   // degrees
    impactRadius: 0.85, trailRadius: 0.44, trailEvery: 1.05,
    moveSpeedFiring: 4.6,
    footEvery: 2, footRadius: 0.7,   // a splat at the shooter's own feet every N shots (WeaponRunner._footSplat)
    special: 'slam', specialCost: 190,
  },
  roller: {
    id: 'roller', name: 'Swell Roller', kind: 'roller', class: 'Roller', sub: 'bomb',
    blurb: 'Roll out wide stripes of turf. Flick for a crushing splash.',
    stats: { range: 0.35, damage: 0.95, rate: 0.3, mobility: 0.55, paint: 0.95 },
    rollSpeed: 4.4, rollWidth: 1.9, rollInkPerMeter: 1.1, rollDamage: 140,
    flickInterval: 0.62, flickWindup: 0.22, flickInk: 9, flickDrops: 9,
    flickDamageNear: 125, flickDamageFar: 30, flickSpeed: 17, flickSpreadDeg: 34,
    impactRadius: 1.0,
    moveSpeedFiring: 4.4,
    footEvery: 1, footRadius: 0.8,
    special: 'slam', specialCost: 170,
  },
  charger: {
    id: 'charger', name: 'Glint Charger', kind: 'charger', class: 'Charger', sub: 'bomb',
    blurb: 'Hold to charge, release for a long piercing line. Full charge splats.',
    stats: { range: 1.0, damage: 1.0, rate: 0.25, mobility: 0.35, paint: 0.45 },
    chargeTime: 1.0, rangeMin: 11, rangeMax: 27, damageMin: 40, damageMax: 160,
    inkFull: 18, lineSplatEvery: 1.2, lineRadius: 0.55, impactRadius: 1.2,
    moveSpeedFiring: 1.8,
    footEvery: 1, footRadius: 0.45,   // + 0.35 × charge
    special: 'storm', specialCost: 180,
  },
  blaster: {
    id: 'blaster', name: 'Popper Blaster', kind: 'blaster', class: 'Blaster', sub: 'bomb',
    blurb: 'Slow shots that burst mid-air. Direct hits splat instantly.',
    stats: { range: 0.55, damage: 0.9, rate: 0.3, mobility: 0.6, paint: 0.5 },
    fireInterval: 0.78, directDamage: 125, splashDamageMax: 70, splashDamageMin: 30,
    splashRadius: 2.6, inkPerShot: 9, projSpeed: 23, range: 10.5,
    impactRadius: 1.5, burstRadius: 1.9,
    moveSpeedFiring: 4.0,
    footEvery: 1, footRadius: 0.75,
    special: 'storm', specialCost: 180,
  },
  dualies: {
    id: 'dualies', name: 'Twinfin Dualies', kind: 'dualies', class: 'Dualies', sub: 'bomb',
    blurb: 'Twin pistols, alternating fire. Jump while firing to dodge-roll, then plant and unload.',
    stats: { range: 0.42, damage: 0.4, rate: 0.95, mobility: 0.95, paint: 0.55 },
    fireInterval: 0.083, damage: 30, inkPerShot: 0.85,        // hands alternate: 12 shots/s, 4 hits to splat
    projSpeed: 32, straightTime: 0.11, range: 11,
    spreadGround: 6.5, spreadAir: 12, spreadFirst: 0.5, bloomPerShot: 0.25, spreadLock: 2.2,
    impactRadius: 0.75, trailRadius: 0.38, trailEvery: 1.15,
    moveSpeedFiring: 5.0,
    footEvery: 2, footRadius: 0.6,
    rollInk: 7, rollTime: 0.3, rollDist: 2.8, rolls: 2, lockTime: 0.5, lockInterval: 0.07,   // dodge roll → locked turret
    special: 'slam', specialCost: 180,
  },
  slosher: {
    id: 'slosher', name: 'Tidebucket Slosher', kind: 'slosher', class: 'Slosher', sub: 'bomb',
    blurb: 'Heaves a heavy wave of ink in an arc: over cover, up ledges, a thick stripe where it lands.',
    stats: { range: 0.58, damage: 0.8, rate: 0.4, mobility: 0.6, paint: 0.78 },
    fireInterval: 0.62, windup: 0.13, inkPerShot: 7.5,
    projSpeed: 15, grav: 22, range: 9.5, drops: 8,
    damageHead: 70, damageTail: 34, splashRadius: 1.1, splashDamage: 26,
    impactRadius: 1.05, trailRadius: 0.5, trailEvery: 1.4,
    moveSpeedFiring: 4.2,
    footEvery: 1, footRadius: 0.8,
    special: 'slam', specialCost: 175,
  },
  splatling: {
    id: 'splatling', name: 'Gyre Splatling', kind: 'splatling', class: 'Splatling', sub: 'bomb',
    blurb: 'Hold to spin up, release for a long high-speed stream. The more charge, the longer it lasts.',
    stats: { range: 0.78, damage: 0.55, rate: 1.0, mobility: 0.38, paint: 0.7 },
    chargeTime: 0.85, burstMin: 0.3, burstMax: 1.7, fireInterval: 0.066, damage: 28, inkPerShot: 0.6,
    projSpeed: 40, straightTime: 0.16, range: 15,
    spreadGround: 3.2, spreadAir: 7, spreadFirst: 0.6, bloomPerShot: 0.05,
    impactRadius: 0.8, trailRadius: 0.42, trailEvery: 1.2,
    moveSpeedCharging: 2.4, moveSpeedFiring: 3.4,
    footEvery: 2, footRadius: 0.6,
    special: 'storm', specialCost: 195,
  },
};
// A variant keeps every field of its base weapon (the runner for that kind reads them) and overrides a few.
// skin recolours the shared model of that kind (character-weapons.js getWeaponDef).
const variant = (base, o) => ({ ...WEAPONS[base], ...o, stats: { ...WEAPONS[base].stats, ...(o.stats || {}) } });
Object.assign(WEAPONS, {
  shooter_pro: variant('shooter', {
    id: 'shooter_pro', name: 'Tidal Pro', skin: { body: '#3a3f4a', trim: '#c9a45c' },
    blurb: 'Slower, harder-hitting shooter. Two hits splat, at a longer reach.',
    fireInterval: 0.15, damage: 52, range: 13.5, spreadGround: 7, spreadAir: 12, inkPerShot: 1.3, impactRadius: 0.95,
    stats: { range: 0.6, damage: 0.75, rate: 0.55, mobility: 0.65, paint: 0.55 },
    footRadius: 0.8,   // fires slower (every 0.15 s), so each foot splat is bigger
    special: 'missiles', specialCost: 200,
  }),
  shooter_jr: variant('shooter', {
    id: 'shooter_jr', name: 'Sprinkle Jr.', skin: { body: '#bfe8d8', trim: '#7fb8a8' },
    blurb: 'A light, thrifty sprayer. Weak shots, but it paints fast and moves easily.',
    fireInterval: 0.085, damage: 28, range: 10.5, spreadGround: 11, spreadAir: 14, inkPerShot: 0.55,
    impactRadius: 0.95, trailRadius: 0.5, moveSpeedFiring: 5.0,
    stats: { range: 0.35, damage: 0.35, rate: 0.9, mobility: 0.85, paint: 0.8 },
    special: 'armor', specialCost: 170,
  }),
  roller_brisk: variant('roller', {
    id: 'roller_brisk', name: 'Brisk Roller', skin: { body: '#2f3a4f', trim: '#9fb4d0' },
    blurb: 'A narrow, quick roller. Sprints across the turf and flicks fast.',
    rollSpeed: 5.4, rollWidth: 1.4, rollInkPerMeter: 0.8, rollDamage: 125,
    flickInterval: 0.45, flickWindup: 0.14, flickDamageNear: 100, flickDamageFar: 25, flickSpeed: 15, flickDrops: 7,
    moveSpeedFiring: 5.0,
    stats: { range: 0.3, damage: 0.75, rate: 0.5, mobility: 0.85, paint: 0.8 },
    special: 'bombrush', specialCost: 170,
  }),
  charger_snap: variant('charger', {
    id: 'charger_snap', name: 'Snap Charger', skin: { body: '#e8d9f0', trim: '#8a78a8' },
    blurb: 'Charges fast for a shorter line. Quick to aim, easy on the ink.',
    chargeTime: 0.6, rangeMin: 9, rangeMax: 20, damageMin: 40, damageMax: 140, inkFull: 12, moveSpeedFiring: 2.6,
    stats: { range: 0.75, damage: 0.9, rate: 0.45, mobility: 0.55, paint: 0.4 },
    special: 'missiles', specialCost: 180,
  }),
  blaster_rapid: variant('blaster', {
    id: 'blaster_rapid', name: 'Rapid Blaster', skin: { body: '#f0d7b0', trim: '#a8784c' },
    blurb: 'Fires bursts twice as often, with smaller blasts and a longer reach.',
    fireInterval: 0.5, directDamage: 85, splashDamageMax: 50, splashDamageMin: 25, splashRadius: 2.1,
    inkPerShot: 7, projSpeed: 27, range: 13, burstRadius: 1.6,
    stats: { range: 0.72, damage: 0.65, rate: 0.5, mobility: 0.6, paint: 0.45 },
    special: 'barrier', specialCost: 180,
  }),
  dualies_glide: variant('dualies', {
    id: 'dualies_glide', name: 'Glide Dualies', skin: { body: '#d8e6f2', trim: '#5c7896' },
    blurb: 'Faster pistols with a short, nimble dodge-roll. Four rolls before you run dry.',
    fireInterval: 0.075, damage: 28, range: 10, rolls: 4, rollTime: 0.25, rollDist: 2.4, rollInk: 5, lockTime: 0.35,
    stats: { range: 0.38, damage: 0.38, rate: 1.0, mobility: 1.0, paint: 0.5 },
    special: 'bombrush', specialCost: 180,
  }),
  slosher_tri: variant('slosher', {
    id: 'slosher_tri', name: 'Tri-Slosher', skin: { body: '#e6e0c8', trim: '#7a8a5c' },
    blurb: 'Lobs quicker, shorter waves that leave a thick trail of ink.',
    fireInterval: 0.42, inkPerShot: 6, projSpeed: 13, range: 7.5, damageHead: 62, damageTail: 30, drops: 10, splashRadius: 1.25,
    stats: { range: 0.4, damage: 0.75, rate: 0.6, mobility: 0.7, paint: 0.85 },
    special: 'armor', specialCost: 170,
  }),
  splatling_mini: variant('splatling', {
    id: 'splatling_mini', name: 'Mini Splatling', skin: { body: '#f2c9c9', trim: '#a86060' },
    blurb: 'Spins up fast and moves lightly, but its bursts are short.',
    chargeTime: 0.45, burstMin: 0.25, burstMax: 1.0, range: 12.5, moveSpeedCharging: 3.4, moveSpeedFiring: 4.2,
    stats: { range: 0.6, damage: 0.5, rate: 0.95, mobility: 0.62, paint: 0.6 },
    special: 'barrier', specialCost: 185,
  }),
});
export const WEAPON_ORDER = [
  'shooter', 'shooter_pro', 'shooter_jr', 'dualies', 'dualies_glide', 'splatling', 'splatling_mini', 'roller',
  'roller_brisk', 'slosher', 'slosher_tri', 'charger', 'charger_snap', 'blaster', 'blaster_rapid',
];

export const SUB = {
  bomb: {
    id: 'bomb', name: 'Splat Bomb', inkCost: 70, throwSpeed: 13.5, fuse: 0.95,
    radius: 3.1, damageMax: 180, damageMin: 35, paintRadius: 2.7,
  },
};

export const SPECIALS = {
  slam: { id: 'slam', name: 'Tidal Slam', blurb: 'Leap up and slam down in a huge ink shockwave.', rise: 0.55, hang: 0.25, radius: 5.2, killRadius: 3.2, damageMax: 180, damageMin: 55 },
  storm: { id: 'storm', name: 'Ink Tempest', blurb: 'Hurl a rain cloud that soaks the turf below.', duration: 6.5, radius: 3.4, dps: 34, throwSpeed: 16, driftSpeed: 1.1 },
  armor: { id: 'armor', name: 'Ink Armor', blurb: 'Wrap the whole team in a shell that soaks up damage for a few seconds.', absorb: 30, duration: 6 },
  missiles: { id: 'missiles', name: 'Missile Salvo', blurb: 'Lock onto up to four enemies and rain missiles on them, even behind walls.', range: 40, count: 4, gap: 0.12, flight: 1.4, apex: 8, lead: 0.9, radius: 2.3, paintRadius: 1.8, damageMax: 90, damageMin: 30 },
  bombrush: { id: 'bombrush', name: 'Bomb Rush', blurb: 'Throw splat bombs nonstop for a few seconds, free of ink.', duration: 5, interval: 0.3 },
  barrier: { id: 'barrier', name: 'Bubble Barrier', blurb: 'Raise a dome that stops enemy shots, bombs and charger beams.', radius: 3.2, hp: 400, duration: 7 },
};

// ---- Match ----
export const MATCH = {
  durations: [90, 180],     // seconds
  defaultDuration: 180,
  finalCountdown: 10,
  teamSize: 4,
  pointsPerM2: 1.0,          // turf points per square metre newly inked
};

export const DIFFICULTY = {
  // aimOmega / aimTurn: bot aim spring stiffness (rad/s) and turn-rate cap (rad/s) — see bots.js
  // fov: half-angle (rad) of what the bot sees around its aim · look: how often it glances around · memory: seconds it
  // keeps a lost enemy in mind · team: how readily it calls out enemies to nearby allies and piles onto their targets
  easy:   { id: 'easy',   name: 'Chill',  reaction: 0.55, aimError: 0.11, fireDiscipline: 0.55, awareness: 16, aimOmega: 9,  aimTurn: 7,  fov: 1.05, look: 0.6, memory: 2,   team: 0.3 },
  normal: { id: 'normal', name: 'Fresh',  reaction: 0.32, aimError: 0.06, fireDiscipline: 0.8,  awareness: 21, aimOmega: 13, aimTurn: 10, fov: 1.31, look: 1,   memory: 2.5, team: 0.65 },
  hard:   { id: 'hard',   name: 'Fierce', reaction: 0.17, aimError: 0.03, fireDiscipline: 0.95, awareness: 26, aimOmega: 18, aimTurn: 14, fov: 1.48, look: 1.2, memory: 3.5, team: 1 },
};

// Autoplay (cheat menu): the bot that plays your own character. 1–3 mirror the enemy bot levels; 4–5 go past them.
// apex: the level-5 brain (autoplay.js) — exact fire solutions from aimbot.js, projectile dodging, full enemy knowledge.
export const AUTOPLAY = [
  { id: 1, name: 'Beginner', reaction: 0.55, aimError: 0.11,  fireDiscipline: 0.55, awareness: 16, aimOmega: 9,  aimTurn: 7,  fov: 1.05, look: 0.6, memory: 2,   team: 0.3 },
  { id: 2, name: 'Regular',  reaction: 0.32, aimError: 0.06,  fireDiscipline: 0.8,  awareness: 21, aimOmega: 13, aimTurn: 10, fov: 1.31, look: 1,   memory: 2.5, team: 0.65 },
  { id: 3, name: 'Expert',   reaction: 0.17, aimError: 0.03,  fireDiscipline: 0.95, awareness: 26, aimOmega: 18, aimTurn: 14, fov: 1.48, look: 1.2, memory: 3.5, team: 1 },
  { id: 4, name: 'Master',   reaction: 0.08, aimError: 0.012, fireDiscipline: 1,    awareness: 34, aimOmega: 30, aimTurn: 24, fov: 1.66, look: 1.3, memory: 4,   team: 1 },
  { id: 5, name: 'Legend',   reaction: 0,    aimError: 0,     fireDiscipline: 1,    awareness: 99, aimOmega: 60, aimTurn: 60, fov: Math.PI, look: 0, memory: 9, team: 1, apex: true },
];

// Every stage can be played by day or at dusk: `times` maps the time of day to an environment theme (`theme` is the
// stage's day look, kept for older callers). Pick with mapTheme(map, time).
export const TIMES = ['day', 'dusk'];
export const mapTheme = (map, time = 'day') => (map && map.times && map.times[time]) || (map && map.theme) || 'day';
export const MAPS = [
  { id: 'tidewater', name: 'Tidewater Plaza', blurb: 'A sun-bleached harbor plaza on the edge of the sea.', theme: 'day', times: { day: 'day', dusk: 'sunset' } },
  { id: 'kelpline', name: 'Kelpline Terminal', blurb: 'Container yard with grate catwalks, a sunken trench and a steel gantry deck.', theme: 'day', times: { day: 'day', dusk: 'sunset' } },
  { id: 'halyard', name: 'Halyard Marina', blurb: 'Floating docks, a tug on blocks and a car ferry moored across the middle. Mind the water.', theme: 'golden', times: { day: 'golden', dusk: 'sunset' } },
];

export const BOT_NAMES = [
  'Squiddo', 'Blotch', 'Marlo', 'Inky Vee', 'Pip', 'Coral', 'Riptide', 'Nori', 'Suki', 'Zest',
  'Kelp', 'Drip', 'Tako', 'Sprinkle', 'Bubbles', 'Moxie', 'Juno', 'Wasabi', 'Fizz', 'Loop',
];

// ---- Progression ----
export const PROGRESSION = {
  xpForLevel: (lvl) => 800 + lvl * 350,
  xpWin: 1200, xpLose: 500, xpPerTurfPoint: 1.0, xpPerSplat: 40,
};

// ---- Settings defaults (persisted in localStorage 'inkwave.settings') ----
export const DEFAULT_SETTINGS = {
  lang: 'ja',               // UI language: 'ja' | 'en' (src/i18n)
  sensitivity: 1.0,         // mouse multiplier 0.2..3
  padSensitivity: 1.0,
  invertY: false,
  fov: 82,                  // horizontal FOV at 16:9, 65..100
  quality: 'high',          // 'saver' | 'low' | 'medium' | 'high' | 'ultra'
  shadows: true,
  bloom: true,
  cameraShake: 1.0,         // 0..1
  showFps: false,
  fpsCap: 0,                // frame rate limit: 0 (the display's rate) | 60 | 30 — phones start on 30 (cooler, longer battery)
  master: 0.8, music: 0.6, sfx: 0.85,
  colorblind: false,
  minimap: true,
  matchLength: 180,
  difficulty: 'normal',
  rumble: 1.0,              // gamepad vibration 0..1 (only while the pad is the last-used device)
  aimAssist: 1.0,           // gamepad aim assist 0..1
  aimAssistMouse: false,    // optional aim assist for mouse
  // touch screens (src/core/touch.js)
  touchSensitivity: 1.0,    // swipe-to-look multiplier 0.2..3
  aimAssistTouch: 0.8,      // aim assist while playing by touch 0..1
  touchSquidToggle: false,  // squid button: hold (false) or tap to toggle (true)
  touchLeftHanded: false,   // mirror the layout
  touchScale: 1.0,          // on-screen button / stick size 0.75..1.35
  touchOpacity: 0.85,       // on-screen button opacity 0.3..1
};

// Quality presets consumed by the renderer + fx. bake = resolution scale of the one-off sky bakes at boot (cloud dome,
// far-scenery reflection cube; default 1): soft content, and on a phone GPU the full-size bakes cost most of a second.
// pixelRatioPhone: the cap on phones and tablets instead (3× screens: 0.75 CSS px per pixel was a quarter of the panel's
// resolution — blurry — and phones run at 30 fps by default, which pays for the sharper image).
// lite: the ink surface skips the swim-wake and ripple loops (per-pixel loops over every inked pixel; eye candy).
// saver (power saver, the phone default): draws straight to the canvas (direct: no HDR target, grade or output pass),
// plain: MeshPhysical extras off (core/saver.js), calm: looping CSS animations and backdrop blur off, reverb off.
export const QUALITY = {
  // pixelRatio = cap on devicePixelRatio (Retina screens render at up to this density)
  saver:  { pixelRatio: 0.75, pixelRatioPhone: 1.0, shadowSize: 512, msaa: 0, bloom: false, ao: false, paintAtlas: 2048, particles: 0.25, bake: 0.5, lite: true, direct: true, plain: true, calm: true },
  low:    { pixelRatio: 0.75, pixelRatioPhone: 1.0, shadowSize: 1024, msaa: 0, bloom: false, ao: false, paintAtlas: 2048, particles: 0.4, bake: 0.5, lite: true },
  medium: { pixelRatio: 1.0,  pixelRatioPhone: 1.3, shadowSize: 2048, msaa: 2, bloom: true,  ao: false, paintAtlas: 2048, particles: 0.7 },
  high:   { pixelRatio: 1.5,  shadowSize: 4096, msaa: 4, bloom: true,  ao: true,  paintAtlas: 4096, particles: 1.0 },
  ultra:  { pixelRatio: 2.0,  shadowSize: 4096, msaa: 4, bloom: true,  ao: true,  paintAtlas: 4096, particles: 1.0 },
};

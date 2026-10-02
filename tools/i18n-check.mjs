// Translation coverage: every UI string key the code can show, checked against src/i18n/ja.js.
// usage: node tools/i18n-check.mjs [--keys]   (--keys prints every key found; exit 1 when a key has no Japanese entry)
// Keys come from
//   · tr('…') / N_('…') literals anywhere in src/
//   · strings the menu building blocks translate themselves (menus.js: _btn/_header/_hint/_prompts/_openModal
//     labels, credits sections, the how-to rules and control rows)
//   · display fields of the data tables (config.js, game/character-style.js, ui/menu-art.js awards/ranks)
// Placeholders must survive translation: a Japanese entry has to use exactly the {names} of its key.
// For text that slips past all of this, tools/i18n-audit.mjs looks at the rendered screens.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const keys = new Map();   // key → first place it was seen
// identifiers the menu patterns also catch (class names, screen ids, pad glyph names) are not text
const IGNORE = new Set(['results', 'pause', 'skin', 'credits', 'blaster', 'dim', 'three.js', 'LB', 'RB', 'OS', 'B', 'p']);
const add = (k, where) => { if (k && (/[A-Za-z]/.test(k.replace(/\{\w+\}/g, '')) || /\{\w+\}/.test(k)) && !IGNORE.has(k) && !keys.has(k)) keys.set(k, where); };
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');

const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk(SRC);

const LIT = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
for (const f of files) {
  if (f.includes(join('src', 'i18n'))) continue;
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length + 1);
  const at = (i) => `${rel}:${src.slice(0, i).split('\n').length}`;
  for (const m of src.matchAll(new RegExp(String.raw`\b(?:tr|N_)\(\s*(?:${LIT})`, 'g'))) add(unq(m[1] ?? m[2]), at(m.index));
  if (rel.endsWith('menus.js')) {
    const pats = [
      String.raw`\blabel: (?:${LIT})`, String.raw`\bsub: (?:${LIT})`, String.raw`\btitle: (?:${LIT})`,
      String.raw`_header\((?:${LIT})`, String.raw`_hint\([^)]*?, (?:${LIT})\)`,
      String.raw`\], (?:'[A-Za-z]+'|null), (?:${LIT})\]`,           // _prompts rows: [keys, pad, 'Label']
      String.raw`, '(?:[A-Za-z]+)', (?:${LIT})\]`,                    // _prompts rows: ['Enter', 'A', 'Label']
      String.raw`, null, (?:${LIT})\]`,                               // _prompts rows: ['R', null, 'Label']
      String.raw`\bhelp: (?:${LIT})`,
      String.raw`\bsec\((?:${LIT})`,
      String.raw`^\s+\['(?:turf|swim|enemy|climb)', (?:${LIT}), (?:${LIT})\]`,
      String.raw`^\s+\[(?:${LIT}), (?:null|(?:${LIT})), K\(`,
    ];
    for (const p of pats) for (const m of src.matchAll(new RegExp(p, 'gm'))) for (const g of m.slice(1)) if (g != null) add(unq(g), at(m.index));
    // credits section lines: sec('Title', 'line', 'line', …)
    for (const m of src.matchAll(/\bsec\(([^\n]*)\),?$/gm)) for (const l of m[1].matchAll(new RegExp(LIT, 'g'))) add(unq(l[1] ?? l[2]), at(m.index));
  }
}

// data tables
const cfg = await import(pathToFileURL(join(SRC, 'config.js')).href);
const look = await import(pathToFileURL(join(SRC, 'game', 'character-style.js')).href);
add(cfg.GAME_SUBTITLE, 'config GAME_SUBTITLE');
for (const w of Object.values(cfg.WEAPONS)) { add(w.name, 'WEAPONS'); add(w.class, 'WEAPONS'); add(w.blurb, 'WEAPONS'); }
for (const s of Object.values(cfg.SUB)) { add(s.name, 'SUB'); add(s.blurb, 'SUB'); }
for (const s of Object.values(cfg.SPECIALS)) { add(s.name, 'SPECIALS'); add(s.blurb, 'SPECIALS'); }
for (const m of cfg.MAPS) { add(m.name, 'MAPS'); add(m.blurb, 'MAPS'); }
for (const d of Object.values(cfg.DIFFICULTY)) add(d.name, 'DIFFICULTY');
for (const n of cfg.TEAM_NAMES) add(n, 'TEAM_NAMES');
for (const p of [...cfg.TEAM_PALETTES, cfg.COLORBLIND_PALETTE]) for (const n of p.names) add(n, 'palettes');
for (const k of ['SKIN_NAMES', 'OUTFIT_NAMES', 'IRIS_NAMES', 'HAIR_STYLE_NAMES', 'HAT_NAMES', 'BROW_NAMES']) for (const n of look[k] || []) add(n, 'character-style ' + k);
for (const p of look.PRESETS || []) { add(p.name, 'PRESETS'); add(p.blurb, 'PRESETS'); }

const { LANGS } = await import(pathToFileURL(join(SRC, 'i18n', 'index.js')).href);
for (const [, name] of LANGS) add(name, 'LANGS');
const { JA } = await import(pathToFileURL(join(SRC, 'i18n', 'ja.js')).href);
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const missing = [...keys].filter(([k]) => JA[k] === undefined);
const badPh = [...keys].filter(([k]) => JA[k] !== undefined && ph(k) !== ph(JA[k]));
const unused = Object.keys(JA).filter((k) => !keys.has(k));

if (process.argv.includes('--keys')) for (const [k, w] of keys) console.log(`${w}\t${JSON.stringify(k)}`);
console.log(`keys: ${keys.size} · translated: ${keys.size - missing.length} · missing: ${missing.length} · placeholder mismatch: ${badPh.length} · unused ja entries: ${unused.length}`);
for (const [k, w] of missing) console.log(`  missing  ${JSON.stringify(k)}  (${w})`);
for (const [k, w] of badPh) console.log(`  {..}     ${JSON.stringify(k)} → ${JSON.stringify(JA[k])}  (${w})`);
for (const k of unused) console.log(`  unused   ${JSON.stringify(k)}`);
process.exit(missing.length || badPh.length ? 1 : 0);

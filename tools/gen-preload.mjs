// Writes <link rel="modulepreload"> tags for every module the boot needs into index.html, so the browser fetches the
// whole graph in parallel instead of discovering it one import level at a time (each level is a network round trip —
// on a phone that is most of the module-loading time).
// usage: node tools/gen-preload.mjs          rewrite the block between the markers in index.html
//        node tools/gen-preload.mjs --check  exit 1 if the block is stale (part of npm run check)
// The graph starts at src/main.js and follows static imports plus the dynamic imports the boot awaits (the
// `loadModule(...)` / `await import(...)` calls in main.js). three / three/addons resolve through the import map.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const START = '<!-- modulepreload:start (tools/gen-preload.mjs) -->', END = '<!-- modulepreload:end -->';
const html = readFileSync(INDEX, 'utf8');
const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;

function resolveSpec(spec, from) {
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  if (map[spec]) return resolve(ROOT, map[spec]);
  for (const k of Object.keys(map)) if (k.endsWith('/') && spec.startsWith(k)) return resolve(ROOT, map[k] + spec.slice(k.length));
  return null;
}
const seen = new Set(), order = [];
function visit(file, dynamicToo) {
  if (seen.has(file) || !existsSync(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/^\s*import\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|^\s*export\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2] || m[3]);
  // main.js: the boot's awaited dynamic imports belong to the critical path too (dev/stubs.js is the error fallback)
  if (dynamicToo) for (const m of src.matchAll(/(?:loadModule|import)\(\s*['"](\.[^'"]+)['"]/g)) if (!m[1].includes('/dev/')) specs.push(m[1]);
  for (const s of specs) { const f = resolveSpec(s, file); if (f) visit(f, false); }
  order.push(file);
}
visit(join(ROOT, 'src', 'main.js'), true);
// dynamic imports inside the modules main.js loads dynamically (menus → diorama etc.) are plain static imports there
const block = [START, ...order.map((f) => `<link rel="modulepreload" href="./${relative(ROOT, f).split('\\').join('/')}">`), END].join('\n');
const re = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}`);
const next = re.test(html) ? html.replace(re, block) : html.replace('<script type="module" src="./src/main.js"></script>', `${block}\n<script type="module" src="./src/main.js"></script>`);
if (process.argv.includes('--check')) {
  if (next !== html) { console.error('index.html modulepreload list is stale — run: node tools/gen-preload.mjs'); process.exit(1); }
  console.log(`modulepreload ok (${order.length} modules)`);
} else {
  writeFileSync(INDEX, next);
  console.log(`index.html: ${order.length} modules preloaded`);
}

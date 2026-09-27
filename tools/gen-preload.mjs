// Writes <link rel="modulepreload"> tags into index.html for the modules the loading screen needs, so the browser
// fetches that graph in parallel instead of discovering it one import level at a time (each level is a network round
// trip — on a phone that is most of the module-loading time).
// usage: node tools/gen-preload.mjs          rewrite the block between the markers in index.html
//        node tools/gen-preload.mjs --check  exit 1 if the block is stale (part of npm run check)
// Only what stands between the first byte and the loading screen is preloaded: src/main.js with its static imports
// plus the UI modules main.js imports to draw the loading screen (src/ui/*). The rest of the boot's dynamic imports
// start fetching from main.js once that screen is up — preloading them too made them compete with the loading
// screen for bandwidth and delayed its first paint on slow connections. three / three/addons use the import map.
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
  // main.js: the loading-screen UI it imports dynamically (menus / HUD / diorama) is on the critical path too
  if (dynamicToo) for (const m of src.matchAll(/import\(\s*['"](\.\/ui\/[^'"]+)['"]/g)) specs.push(m[1]);
  for (const s of specs) { const f = resolveSpec(s, file); if (f) visit(f, false); }
  order.push(file);
}
visit(join(ROOT, 'src', 'main.js'), true);
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

// Production build → dist/ (the dev tree stays unbundled; npm start serves it as-is).
// usage: node tools/build.mjs            (npm run build)
//
//   js      src/main.js bundled with esbuild: tree-shaken three.js, minified, split at every dynamic import(), content
//           hashes in the file names → dist/js/app/. (Two levels deep on purpose: menus.js and props.js resolve
//           '../../assets/…' against import.meta.url, exactly as they do from src/ui and src/world.)
//   assets  copied; the baked lightmaps become WebP (tools/lightmaps-webp.py)
//   css     styles/ui.css with its @imports inlined and minified → dist/styles/ui-<hash>.css (url()s to the fonts stay
//           relative, dist/assets mirrors assets/)
//   html    index.html without the import map / dev modulepreload list; preloads the entry chunk and everything the
//           loading screen needs (its static imports + the UI chunks), registers the service worker
//   sw.js   cache-first for the hashed bundles and assets, network-first for the page; a new build gets a new cache
//           (the old one is dropped on activate), so the second visit starts from the cache — and offline
//   _headers  Cloudflare Pages: immutable for hashed bundles, a day for assets, revalidate the page and sw.js
// Prints raw / gzip / brotli sizes of the result.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const KEEP = new Set(['.vercel', 'vercel.json']);
const rel = (p) => relative(DIST, p).split('\\').join('/');

// ---- clean (keep deploy-tool link files)
mkdirSync(DIST, { recursive: true });
for (const n of readdirSync(DIST)) if (!KEEP.has(n)) rmSync(join(DIST, n), { recursive: true, force: true });

// ---- js: three / three/addons (the dev import map's job): the npm package when installed (byte-identical to
// vendor/three), else the vendored copy. Neither tree-shakes much — the game uses most of the WebGL renderer, and its
// GLSL chunks are the bulk (measured: resolving three's src/ modules instead came out 7 KB larger).
const THREE_DIR = existsSync(join(ROOT, 'node_modules/three/package.json')) ? join(ROOT, 'node_modules/three') : null;
const threeAlias = {
  name: 'three-vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: join(THREE_DIR || join(ROOT, 'vendor/three'), 'build/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: join(THREE_DIR ? join(THREE_DIR, 'examples/jsm') : join(ROOT, 'vendor/three/jsm'), a.path.slice('three/addons/'.length)) }));
  },
};
const js = await esbuild.build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true, splitting: true, format: 'esm', minify: true, treeShaking: true,
  target: ['chrome100', 'edge100', 'firefox100', 'safari15.4'],
  outdir: join(DIST, 'js/app'), entryNames: '[name]-[hash]', chunkNames: 'c-[hash]',
  sourcemap: 'linked', legalComments: 'linked', metafile: true, logLevel: 'warning',
  plugins: [threeAlias],
});

// ---- css
const css = await esbuild.build({
  entryPoints: [join(ROOT, 'styles/ui.css')],
  bundle: true, minify: true, outdir: join(DIST, 'styles'), entryNames: '[name]-[hash]',
  external: ['*.woff2', '*.webp', '*.png', '*.svg'], metafile: true, logLevel: 'warning',
});

// ---- assets (stage art, fonts, lightmaps) as-is, except the lightmaps: lossless PNG → lossy WebP (~5× smaller)
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
const lm = spawnSync('python3', [join(ROOT, 'tools/lightmaps-webp.py'), join(DIST, 'assets/lightmaps')], { stdio: 'inherit' });
if (lm.status !== 0) console.warn('lightmaps: WebP conversion failed (needs python3 + pillow) — shipping the PNGs');

// ---- outputs from the metafiles
const outputs = js.metafile.outputs;
const entryOut = Object.keys(outputs).find((o) => outputs[o].entryPoint === 'src/main.js');
const cssOut = Object.keys(css.metafile.outputs).find((o) => o.endsWith('.css'));
const url = (o) => rel(join(ROOT, o));
// chunks on the path to the loading screen: the entry's static imports (transitively) + the UI modules' chunks
const critical = new Set();
const addStatic = (o) => { if (critical.has(o)) return; critical.add(o); for (const im of outputs[o].imports) if (im.kind === 'import-statement') addStatic(im.path); };
addStatic(entryOut);
for (const o of Object.keys(outputs)) {
  const ep = outputs[o].entryPoint || '';
  const inputs = Object.keys(outputs[o].inputs || {});
  if (o.endsWith('.js') && (/^src\/ui\/(menus|hud|diorama)\.js$/.test(ep) || inputs.some((i) => /^src\/ui\/(menus|hud|diorama)\.js$/.test(i)))) addStatic(o);
}
critical.delete(entryOut);

// ---- html
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace(/<!-- modulepreload:start[\s\S]*?<!-- modulepreload:end -->\n?/, '');
html = html.replace('href="styles/ui.css"', `href="${url(cssOut)}"`);
const preload = [...critical].map((o) => `<link rel="modulepreload" href="./${url(o)}">`).join('\n');
const swReg = `<script>if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));</script>`;
html = html.replace('<script type="module" src="./src/main.js"></script>', `${preload}\n<script type="module" src="./${url(entryOut)}"></script>\n${swReg}`);
if (html.includes('src/main.js') || html.includes('importmap')) throw new Error('index.html rewrite failed');
writeFileSync(join(DIST, 'index.html'), html);

// ---- service worker: precache the page, the loading-screen path and the Latin fonts; everything else on first use
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(DIST);
const shipped = files.filter((f) => !/\.(map|LEGAL\.txt)$/.test(f) && !KEEP.has(basename(f)));
const version = createHash('sha256').update(shipped.map((f) => rel(f) + ':' + createHash('sha1').update(readFileSync(f)).digest('hex')).join('\n')).digest('hex').slice(0, 12);
const precache = ['./', `./${url(entryOut)}`, ...[...critical].map((o) => `./${url(o)}`), `./${url(cssOut)}`,
  // the Latin fonts; the Japanese subsets are cached on first use (an English-only player never downloads them)
  ...shipped.filter((f) => /assets\/fonts\/.*\.woff2$/.test(f) && !/-jp\.woff2$/.test(f)).map((f) => `./${rel(f)}`)];
writeFileSync(join(DIST, 'sw.js'), `// INKWAVE service worker (generated by tools/build.mjs — build ${version})
const CACHE = 'inkwave-${version}';
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('inkwave-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  // the page: network first (a new build shows up at once), cached copy when offline
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(CACHE).then((k) => k.put('./', c)); return res; }).catch(() => caches.match('./')));
    return;
  }
  // bundles are content-hashed and assets belong to this build: cache first, fill the cache on first use
  e.respondWith(caches.open(CACHE).then((c) => c.match(r, { ignoreSearch: false }).then((hit) => hit || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }))));
});
`);

// ---- Cloudflare Pages headers
writeFileSync(join(DIST, '_headers'), `/js/app/*
  Cache-Control: public, max-age=31536000, immutable
/styles/*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=86400
/sw.js
  Cache-Control: no-cache
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
`);

// ---- report
const kb = (n) => (n / 1024).toFixed(1).padStart(8);
const size = (f) => { const b = readFileSync(f); return [b.length, gzipSync(b, { level: 9 }).length, brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: 11 } }).length]; };
const groups = { 'js (all chunks)': (f) => f.endsWith('.js') && f.includes('/js/app/'), 'js (entry + loading path)': (f) => [entryOut, ...critical].some((o) => join(ROOT, o) === f),
  css: (f) => f.endsWith('.css'), fonts: (f) => f.endsWith('.woff2'), 'stage art': (f) => f.includes('/assets/stages/'), lightmaps: (f) => f.includes('/assets/lightmaps/') };
console.log(`dist ready (build ${version}) — ${Object.keys(outputs).filter((o) => o.endsWith('.js')).length} js chunks, ${critical.size + 1} on the loading path`);
console.log('                                   raw KB  gzip KB  brotli KB');
for (const [name, test] of Object.entries(groups)) {
  const t = shipped.filter(test).map(size).reduce((a, s) => a.map((v, i) => v + s[i]), [0, 0, 0]);
  console.log(`${name.padEnd(28)}${kb(t[0])}${kb(t[1])}${kb(t[2])}`);
}

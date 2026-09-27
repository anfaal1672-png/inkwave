# Contributing to INKWAVE

Thanks for your interest! INKWAVE is a plain ES-module three.js project with no build step, so getting started takes a minute.

## Running locally

```bash
git clone https://github.com/jaydendavisnc/inkwave.git
cd inkwave
npm install          # only needed for the headless tools (puppeteer-core)
npm start            # serves http://localhost:8490 (and your LAN address)
```

Open the URL in Chrome, Edge or Firefox. Everything reloads on refresh; there is no bundler.

## Before opening a pull request

```bash
npm run check        # node --check on every module
npm run smoke        # boots the game headlessly and plays 8 s on autopilot (needs Google Chrome installed)
npm run smoke:mobile # the same in landscape-phone emulation (touch, 3× DPR, 4× CPU throttle, Fast 4G)
npm run test:touch   # touch-only play-through: title → match (every on-screen control) → results
```

The headless tools find Chrome/Chromium per platform (`tools/browser.mjs`); set `CHROME_PATH` to use another binary. The smoke runs start the dev server themselves when nothing is listening on :8490. On Linux without a GPU, WebGL runs in software (SwiftShader), so the smoke uses the low preset there and takes a few minutes.

For load-time and frame-rate work, measure before and after with:

```bash
npm run measure -- --profile desktop --runs 3            # or --profile mobile, --cache warm, --settings '{"quality":"low"}'
npm run bench                                             # main-thread ms per frame (mobile emulation, low) + where it goes
node tools/profile-boot.mjs --profile mobile --shaders    # boot CPU profile + every shader program's compile time
```

`npm run measure` prints download size (raw and brotli), the boot timeline per loading stage, and fps / 1 % low / draw calls over 10 s of live play as JSON. Baseline numbers live in [docs/PERF_BASELINE.md](docs/PERF_BASELINE.md). Frame rates under software WebGL are only comparable with each other, never with real hardware.

`npm run bench` runs the whole per-frame update (match, bots, physics, paint, effects, HUD, minimap) at a fixed 30 fps step with drawing skipped (`--render` includes it) and profiles it: software WebGL cannot tell you a frame rate, but this CPU budget is comparable.

## Production build

```bash
npm run build        # → dist/: bundled + minified JS split per dynamic import, hashed file names, service worker
npm run smoke:dist   # the smoke runs against dist/ (served on :8492)
```

Development never needs the build: `npm start` serves the source tree as-is. `tools/build.mjs` bundles with esbuild, turns the baked lightmaps into WebP (`tools/lightmaps-webp.py`, needs Pillow), writes `sw.js` (second visits and offline play come from the cache) and a Cloudflare Pages `_headers` file. After new stage shots, `python3 tools/stage-variants.py` regenerates the 1280-px stage-select renders; after new modules on the boot path, `node tools/gen-preload.mjs` refreshes the dev preload list (`npm run check` flags it when stale).

Keep pull requests focused. If you change gameplay tuning, say what you measured and how (see `tools/measure-handling.mjs` and `tools/film.py` for the deterministic capture helpers).

## UI text and translations

The UI is Japanese by default, with English selectable under Settings → Gameplay → Language. Write UI strings in English and wrap them in `tr()` from `src/i18n/index.js` (or `N_()` where a data table defines them), then add the Japanese to `src/i18n/ja.js`. English strings are the keys, and anything untranslated falls back to English.

```bash
node tools/i18n-check.mjs                  # every key has a Japanese entry with the same {placeholders}
node tools/i18n-audit.mjs --shots out/ja   # renders every screen + HUD state, flags leftover English, saves screenshots
python3 tools/subset-fonts.py              # after adding new kanji: rebuild the Japanese font subsets
```

## Project map

| Path | What lives there |
|---|---|
| `src/core` | renderer + post chain, input, event bus |
| `src/game` | actors, weapons, bots, camera rig, character rig + animation, match flow |
| `src/world` | stage layouts, level geometry, ink painting, textures, environment, props |
| `src/fx` | particles, screen effects, event → effect wiring |
| `src/ui` | menus, HUD, map diorama, icons |
| `src/audio` | procedural sound effects and music |
| `docs` | event contract, module contracts, character rig reference |
| `tools` | dev server, labs, headless capture and measurement scripts, release |

## Code style

Match the surrounding code: 2-space indent, single quotes, no semicolon-free style, comments that explain *why*. No per-frame allocations in hot paths. New stages must keep both halves identical (the layout is mirrored by a 180° rotation).

## Reporting bugs

Open an issue with your browser + GPU, the stage, and steps to reproduce. A screenshot or short clip helps a lot.

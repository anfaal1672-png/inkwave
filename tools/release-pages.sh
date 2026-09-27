#!/bin/sh
# Build dist/ and publish it to Cloudflare Pages (project "inkwave"). Needs a one-time `npx wrangler login`.
# usage: tools/release-pages.sh
set -e
cd "$(dirname "$0")/.."
node tools/build.mjs
STAGE=$(mktemp -d /private/tmp/inkwave-pages.XXXXXX)
# Pages serves everything in the folder: leave out the Vercel link files
rsync -a --exclude '.vercel' --exclude 'vercel.json' dist/ "$STAGE/"
# cache rules come from dist/_headers (tools/build.mjs): hashed bundles immutable, the page and sw.js revalidated
# run from the staging folder so no repo-level wrangler config gets picked up
cd "$STAGE"
npx --yes wrangler@4 pages project create inkwave --production-branch main --force 2>&1 | tail -2 || true
npx --yes wrangler@4 pages deploy . --force --project-name inkwave --branch main --commit-dirty=true

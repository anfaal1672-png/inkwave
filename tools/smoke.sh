#!/bin/sh
# Boot the game, play 8 s on autopilot, report state + any console errors. Exit 1 on errors.
# usage: tools/smoke.sh [desktop|mobile] [dist]   (mobile = landscape phone emulation, see tools/browser.mjs)
# Starts the dev server on :8490 for the run if nothing is listening there yet; with `dist`, serves the production
# build (npm run build) on :8492 instead.
# On Linux the browser renders WebGL in software (SwiftShader, tools/browser.mjs), which is far too slow for the high
# preset to reach live play in time: there the run uses the low preset at 960×540 unless SMOKE_SETTINGS says otherwise.
cd "$(dirname "$0")/.."
PROFILE=${1:-desktop}
PORT=${SMOKE_PORT:-8490}   # SMOKE_PORT: test a server that serves another checkout
DIR=
[ "$2" = dist ] && { PORT=8492; DIR="--dir dist"; [ -f dist/index.html ] || { echo "no dist/ — run npm run build"; exit 1; }; }
SERVER_PID=
SIZE=
TIMEOUT=180000
if [ "$(uname)" = Linux ]; then
  TIMEOUT=900000
  SMOKE_SETTINGS=${SMOKE_SETTINGS:-'{"quality":"low","fovMode":"h"}'}
  [ "$PROFILE" = desktop ] && SIZE="--w 960 --h 540"
fi
if ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  python3 tools/serve.py $PORT $DIR >/dev/null 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null' EXIT
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$PORT/index.html" && break; sleep 0.5; done
fi
OUT=$(node tools/play.mjs "http://localhost:$PORT/?autostart=60&autopilot" '[{"until":"window.__inkwave && __inkwave.match && __inkwave.match.state===\"playing\" && __inkwave.match.local"},{"wait":8000},{"eval":"JSON.stringify({state:__inkwave.match.state,t:+__inkwave.match.time.toFixed(1),boot:__inkwave.bootMs,fps:__inkwave.fps,perf:__inkwave.perf,turf:__inkwave.match.actors.map(a=>Math.round(a.stats.turf))})","log":"smoke"}]' --profile "$PROFILE" --timeout $TIMEOUT $SIZE ${SMOKE_SETTINGS:+--settings "$SMOKE_SETTINGS"} 2>&1)
echo "$OUT" | grep -v "Failed to fetch\|404\|preload"
echo "$OUT" | grep -qiE "\[error\]|pageerror|until timeout|eval error" && { echo "SMOKE FAIL ($PROFILE${2:+ $2})"; exit 1; }
echo "$OUT" | grep -q "smoke ->" || { echo "SMOKE FAIL ($PROFILE${2:+ $2}, no result)"; exit 1; }
echo "SMOKE OK ($PROFILE${2:+ $2})"

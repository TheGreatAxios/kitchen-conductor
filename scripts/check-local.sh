#!/usr/bin/env bash
# Proves the three-command path: deps installed, .env from the example, npm run dev answers.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -d node_modules ]]; then
  echo "run npm i first"
  exit 1
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
npx tsx scripts/build-sim.ts
npx tsx --env-file=.env apps/server/src/local.ts &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
health=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if health="$(curl -sf "http://127.0.0.1:${KC_PORT:-8787}/healthz")"; then
    break
  fi
  sleep 0.4
done
printf '%s\n' "$health" | grep -q '"bedrock":"stub"'
curl -sf -o /dev/null "http://127.0.0.1:${KC_PORT:-8787}/"
curl -sf -o /dev/null "http://127.0.0.1:${KC_PORT:-8787}/voiceover"
echo "local ok"

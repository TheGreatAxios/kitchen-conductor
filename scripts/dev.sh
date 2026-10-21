#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
npx tsx scripts/build-sim.ts
exec npx tsx --env-file=.env apps/server/src/local.ts

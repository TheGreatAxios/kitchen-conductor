#!/usr/bin/env bash
# Print matches for committed-looking secrets. Silent and exit 0 when clean.
set -euo pipefail
cd "$(dirname "$0")/.."
hits="$(grep -RInE \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude=secret-scan.sh \
  --exclude='*.png' \
  'AKIA[0-9A-Z]{16}|aws_secret_access_key|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY' \
  . || true)"
if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits"
  exit 1
fi

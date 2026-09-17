#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm --filter @enso/phone build
rm -rf packages/relay-go/frontend
cp -R packages/phone/dist packages/relay-go/frontend

#!/usr/bin/env bash
# Serve the Origin site with both explorers mounted.
set -euo pipefail

PORT="${PORT:-8792}"
CAUSAL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$(dirname "$CAUSAL")"

echo "Origin homepage:  http://127.0.0.1:${PORT}/"
echo "Causal explorer:  http://127.0.0.1:${PORT}/causal/"
echo "Pathway explorer: http://127.0.0.1:${PORT}/interp/"
cd "$SITE"
exec python3 -m http.server "$PORT" --bind 127.0.0.1

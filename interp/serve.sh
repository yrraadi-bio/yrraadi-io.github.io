#!/usr/bin/env bash
# Serve the Origin site with the explorer mounted at /interp/.
set -euo pipefail

PORT="${PORT:-8791}"
INTERP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$(dirname "$INTERP")"

echo "Origin homepage:  http://127.0.0.1:${PORT}/"
echo "Pathway explorer: http://127.0.0.1:${PORT}/interp/"
cd "$SITE"
exec python3 -m http.server "$PORT" --bind 127.0.0.1

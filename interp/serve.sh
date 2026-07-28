#!/usr/bin/env bash
# Serve the Origin site with the explorer mounted at /interp/.
set -euo pipefail

PORT="${PORT:-8791}"
INTERP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$(dirname "$INTERP")"

if [[ ! -f "$INTERP/data/index.json" ]]; then
  echo "missing $INTERP/data/index.json - run build_site_data.py first" >&2
  exit 1
fi

echo "Origin homepage: http://127.0.0.1:${PORT}/"
echo "KEGG explorer:   http://127.0.0.1:${PORT}/interp/"
cd "$SITE"
exec python3 -m http.server "$PORT" --bind 127.0.0.1

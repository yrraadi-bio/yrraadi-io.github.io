#!/bin/bash
# Bake the cell sprite atlas.
#   ./bake.sh <name> <tile> [extra query] [png|webp]
#
# png goes through --screenshot, where --default-background-color=00000000 is
# what keeps the page transparent; without it the atlas comes out matted onto
# white. webp is encoded by the page itself and lifted out of --dump-dom,
# because there is no webp encoder installed but Chrome is one.
set -u
NAME="${1:-cells}"
TILE="${2:-256}"
EXTRA="${3:-}"
FMT="${4:-png}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CELL="$(cd "$(dirname "$0")" && pwd)"
PORT=8777
OUT="$CELL/out"
mkdir -p "$OUT"
rm -f "$OUT/$NAME.$FMT" "$OUT/$NAME.dom"

if ! curl -s -o /dev/null "http://localhost:$PORT/_dev/_cell/atlas.html"; then
    echo "no server on :$PORT" >&2
    exit 1
fi

URL="http://localhost:$PORT/_dev/_cell/atlas.html?tile=$TILE"
[ -n "$EXTRA" ] && URL="$URL&$EXTRA"
[ "$FMT" = webp ] && URL="$URL&enc=webp"

# window must be at least the atlas or the screenshot clips it
COLS=5
ROWS=6
case "$EXTRA" in *pals=*) ROWS=$(echo "$EXTRA" | sed -n 's/.*pals=\([^&]*\).*/\1/p' | awk -F, '{print NF}');; esac
W=$((COLS * TILE))
H=$((ROWS * TILE))

PROF="$CELL/.prof"
rm -rf "$PROF"; mkdir -p "$PROF"

COMMON=(--headless --no-sandbox --hide-scrollbars --disable-updater
    --user-data-dir="$PROF"
    --window-size="$W,$H" --force-device-scale-factor=1
    --default-background-color=00000000
    --enable-unsafe-swiftshader --use-angle=swiftshader
    --run-all-compositor-stages-before-draw
    --virtual-time-budget=600000)

wait_for() {
    # Chrome writes its output and then refuses to exit, so the file is polled
    # for and the process killed once it has stopped growing.
    local file="$1" pid="$2" last=-1 stable=0 i=0
    while [ $i -lt 900 ]; do
        sleep 1; i=$((i + 1))
        if [ -s "$file" ]; then
            local sz
            sz=$(stat -f%z "$file")
            if [ "$sz" -eq "$last" ]; then
                stable=$((stable + 1))
                [ $stable -ge 2 ] && break
            else
                stable=0
            fi
            last=$sz
        fi
    done
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
}

if [ "$FMT" = webp ]; then
    "$CHROME" "${COMMON[@]}" --dump-dom "$URL" >"$OUT/$NAME.dom" 2>"$OUT/$NAME.log" &
    wait_for "$OUT/$NAME.dom" $!
    python3 - "$OUT/$NAME.dom" "$OUT/$NAME.webp" <<'PY'
import base64, re, sys
dom = open(sys.argv[1], encoding='utf-8', errors='replace').read()
m = re.search(r'<script id="out"[^>]*>([A-Za-z0-9+/=]*)</script>', dom)
if not m or not m.group(1):
    sys.exit('no encoded payload in DOM')
open(sys.argv[2], 'wb').write(base64.b64decode(m.group(1)))
PY
    rm -f "$OUT/$NAME.dom"
else
    "$CHROME" "${COMMON[@]}" --screenshot="$OUT/$NAME.png" "$URL" >"$OUT/$NAME.log" 2>&1 &
    wait_for "$OUT/$NAME.png" $!
fi

rm -rf "$PROF"

if [ -f "$OUT/$NAME.$FMT" ]; then
    echo "$OUT/$NAME.$FMT  ${W}x${H}  $(stat -f%z "$OUT/$NAME.$FMT") bytes"
else
    echo "FAILED" >&2
    tail -20 "$OUT/$NAME.log" >&2
    exit 1
fi

#!/bin/bash
# Render the cell scene headlessly.
#   ./render.sh <name> [width] [height] [dpr] [extra query]
# Chrome writes the screenshot and then refuses to exit, so the file is polled
# for and the process killed once it has stopped growing.
set -u
NAME="${1:-cell}"
W="${2:-900}"
H="${3:-900}"
DPR="${4:-2}"
EXTRA="${5:-}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CELL="$(cd "$(dirname "$0")" && pwd)"
PORT=8777
OUT="$CELL/out"
mkdir -p "$OUT"
rm -f "$OUT/$NAME.png"

if ! curl -s -o /dev/null "http://localhost:$PORT/_dev/_cell/index.html"; then
    echo "no server on :$PORT" >&2
    exit 1
fi

URL="http://localhost:$PORT/_dev/_cell/index.html?w=$W&h=$H&dpr=$DPR"
[ -n "$EXTRA" ] && URL="$URL&$EXTRA"

PROF="$CELL/.prof"
rm -rf "$PROF"; mkdir -p "$PROF"

"$CHROME" --headless --no-sandbox --hide-scrollbars --disable-updater \
    --user-data-dir="$PROF" \
    --window-size="$W,$H" --force-device-scale-factor=1 \
    --enable-unsafe-swiftshader --use-angle=swiftshader \
    --run-all-compositor-stages-before-draw \
    --virtual-time-budget=600000 \
    --screenshot="$OUT/$NAME.png" "$URL" >"$OUT/$NAME.log" 2>&1 &
PID=$!

# wait for the png to appear and settle
LAST=-1; STABLE=0; I=0
while [ $I -lt 900 ]; do
    sleep 1; I=$((I + 1))
    if [ -f "$OUT/$NAME.png" ]; then
        SZ=$(stat -f%z "$OUT/$NAME.png")
        if [ "$SZ" -eq "$LAST" ] && [ "$SZ" -gt 0 ]; then
            STABLE=$((STABLE + 1))
            [ $STABLE -ge 2 ] && break
        else
            STABLE=0
        fi
        LAST=$SZ
    fi
done

kill -9 $PID 2>/dev/null
wait $PID 2>/dev/null
rm -rf "$PROF"

if [ -f "$OUT/$NAME.png" ]; then
    echo "$OUT/$NAME.png  ${I}s  $(stat -f%z "$OUT/$NAME.png") bytes"
else
    echo "FAILED after ${I}s" >&2
    tail -20 "$OUT/$NAME.log" >&2
    exit 1
fi

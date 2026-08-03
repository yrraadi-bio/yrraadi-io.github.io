#!/bin/bash
# Headless capture of a stage at a given scroll fraction.
#   ./_shot.sh <name> <fraction 0-1> [extra chrome flags] [stage id] [width] [offset px] [query]
#
# A throwaway profile each time, because the default one caches the atlas and
# will happily hand back the sprites from a bake ago. Chrome then writes the
# screenshot and refuses to exit, so the file is polled for and the process
# killed once it has stopped growing.
#
# The scroll position is eased toward, and how hard depends on how fast the page
# is being scrolled, so a snapshot taken mid-ease lands short of the fraction
# asked for. --force-prefers-reduced-motion drops the easing entirely and pins
# progress to the scroll position, which is the only way to capture a late beat.
set -u
NAME="$1"
FRAC="$2"
EXTRA="${3:-}"
STAGE="${4:-stage}"
# headless lays out at its own width and crops, so a narrow viewport has to be
# asked for on the frame as well as on --window-size. Asking for one without the
# other leaves the frame narrow inside a wide window and fills the remainder with
# the probe's own background, which reads in the shot as a slab of navy down the
# side of the page that the page never drew.
WIDE="${5:-}"
WINW="${WIDE:-1440}"
WINH=$([ -n "$WIDE" ] && echo 932 || echo 900)
# anything between two stages is reached by scrolling past the end of one of them
# rather than by a fraction of either
OFF="${6:-0}"
# appended to the probe's query, for the debug readouts
QS="${7:-}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="/tmp/nshots"
mkdir -p "$OUT"
rm -f "$OUT/$NAME.png"

PROF=$(mktemp -d)
"$CHROME" --headless --disable-gpu --hide-scrollbars \
    --user-data-dir="$PROF" --no-first-run --disable-updater \
    --force-prefers-reduced-motion \
    --window-size=$WINW,$WINH --force-device-scale-factor=2 \
    --virtual-time-budget=240000 --run-all-compositor-stages-before-draw $EXTRA \
    --screenshot="$OUT/$NAME.png" \
    "http://localhost:8777/_dev/_probe.html?f=$FRAC&s=$STAGE&w=$WIDE&o=$OFF&$QS" >/dev/null 2>&1 &
PID=$!

LAST=-1; STABLE=0; I=0
while [ $I -lt 120 ]; do
    sleep 1; I=$((I + 1))
    if [ -s "$OUT/$NAME.png" ]; then
        SZ=$(stat -f%z "$OUT/$NAME.png")
        if [ "$SZ" -eq "$LAST" ]; then
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

sips -Z 1200 "$OUT/$NAME.png" --out "$OUT/$NAME-s.png" >/dev/null 2>&1
echo "$OUT/$NAME-s.png"

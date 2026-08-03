#!/usr/bin/env bash
#
# Assemble dist/, the exact set of files that goes to Cloudflare.
#
# The repo root could be handed to Wrangler directly, with .assetsignore naming
# what to withhold, but nothing local can be made to print the resulting file list:
# the count Wrangler reports is a raw directory walk taken before the ignore file is
# applied, and it counts directories too. Since the repo root holds .git, an
# exclusion that cannot be checked is not one worth relying on, so the excluding
# happens here where the result is a directory we can read.
#
# Withholding rather than listing: a new blog post ships without touching this file,
# and only the named paths stay behind.

set -euo pipefail

cd "$(dirname "$0")/.."

OUT=dist

rm -rf "$OUT"
mkdir -p "$OUT"

# Hardlinks, so a 276 MB site costs no second copy on disk.
rsync -a --link-dest="$PWD" \
    --exclude='/.git' \
    --exclude='/.gitignore' \
    --exclude='/_dev' \
    --exclude='/dist' \
    --exclude='/node_modules' \
    --exclude='/.wrangler' \
    --exclude='/wrangler.jsonc' \
    --exclude='.DS_Store' \
    --exclude='/CNAME' \
    --exclude='/.nojekyll' \
    --exclude='/White.png' \
    --exclude='/YC Logo Expanded — Orange.png' \
    --exclude='/sec-all.png' \
    --exclude='/sec-all-s.png' \
    --exclude='/yc_backed.png' \
    ./ "$OUT/"

echo "dist/ built: $(find "$OUT" -type f | wc -l) files, $(du -sh --apparent-size "$OUT" | cut -f1)"

# Anything that should not have shipped is a bug in the excludes above, so say so
# here rather than after it is public.
for path in .git .gitignore _dev .wrangler CNAME .nojekyll wrangler.jsonc; do
    if [ -e "$OUT/$path" ]; then
        echo "ERROR: $path reached dist/" >&2
        exit 1
    fi
done

if [ ! -f "$OUT/_headers" ] || [ ! -f "$OUT/index.html" ]; then
    echo "ERROR: dist/ is missing _headers or index.html" >&2
    exit 1
fi

echo "checks passed"

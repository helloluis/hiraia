#!/usr/bin/env bash
# Download a batch output file from a signed blob URL, RESUMING if a partial exists.
#
# The OpenAI files API cannot serve these (~6 GB each): /files/content ignores Range and times
# out trying to stream the whole thing, which is the documented 504. The browser signed URL is
# the only working source, and it expires in a few hours — so this resumes byte-exactly rather
# than restarting, and extracts images as soon as the bytes are on disk.
#
#   ./fetch-batch.sh <batch_id> '<signed-url>'
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BID="${1:?usage: fetch-batch.sh <batch_id> '<url>'}"
URL="${2:?missing signed url}"
OUT="$HERE/$BID.jsonl"
[ -f "$OUT" ] && echo "resuming from $(du -h "$OUT" | cut -f1)" || echo "fresh download"
# -C - resumes at the current byte offset; a half-written final line is completed correctly.
curl -sS -L -C - --retry 5 --retry-delay 5 --speed-limit 1024 --speed-time 120 \
     -o "$OUT" -w 'http %{http_code}  %{size_download} bytes  %{time_total}s\n' "$URL"
echo "extracting..."
python3 "$HERE/extract.py" "$OUT"
# Straight from the raw 1024px PNGs to the bundle format — 512px indexed-grayscale PNG, the
# same treatment the rest of the card art gets. Deliberately NOT via WebP: that would be a
# second lossy step and would have to be redone, and the point of this directory is that a
# file appearing in it IS a wired illustration.
( cd "$HERE/../../../packages/images" && node to-card-png.mjs --in "$HERE/raw" )
echo "re-generating the image map..."
node "$HERE/../../../packages/mobile/scripts/gen-image-map.mjs"
echo
echo "Now re-run the pool so the new art is picked up:"
echo "  python3 rag/pipeline/wire-app-pool.py"

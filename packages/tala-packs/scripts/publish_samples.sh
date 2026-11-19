#!/bin/sh
# Publish sample pack files for review through the existing report relay (unlisted HTTPS links, 7-day expiry).
# Usage: scripts/publish_samples.sh <out.tsv> <packId> [<packId> ...]
set -eu
out="$1"; shift
here="$(cd "$(dirname "$0")/.." && pwd)"
: > "$out"
for id in "$@"; do
  for lang in en fil; do
    dir="$here/build/artifacts/$id/$lang"
    [ -f "$dir/manifest.json" ] || { echo "skip $id $lang (not built)" >&2; continue; }
    for f in "$dir"/*-slides.pptx "$dir"/*-teacher-guide.pdf "$dir"/*-lesson-plans.pdf; do
      [ -f "$f" ] || continue
      url="$(report-relay publish --download --ttl 168h "$f")"
      printf '%s\t%s\t%s\t%s\n' "$id" "$lang" "$(basename "$f")" "$url" >> "$out"
    done
  done
done
cat "$out"

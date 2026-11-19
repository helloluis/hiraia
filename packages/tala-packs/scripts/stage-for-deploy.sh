#!/bin/sh
# Stage exactly the teaching-pack files the Tala server serves, for /var/lib/tala/packs on the host
# (see packages/tala-server/deploy/README.md, "Teaching packs data").
#   scripts/stage-for-deploy.sh <out.tgz>
# Includes every built language version in library/ (pack.json, review.json) with its artifacts (manifest.json, the
# files it lists, slide thumbnails). Model critique logs, full-size previews and HTML sources stay behind.
set -eu
out="$1"
here="$(cd "$(dirname "$0")/.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp "$here/library/index.json" "$stage/index.json"
cd "$here/library"
for review in science-bow-2026/*/*/review.json; do
  dir="$(dirname "$review")"; id="$(basename "$(dirname "$dir")")"; lang="$(basename "$dir")"
  [ -f "$dir/pack.json" ] || continue
  mkdir -p "$stage/$dir" "$stage/artifacts/$id/$lang/previews"
  cp "$dir/pack.json" "$dir/review.json" "$stage/$dir/"
  art="$here/build/artifacts/$id/$lang"
  [ -f "$art/manifest.json" ] || { echo "no build for $id $lang" >&2; exit 1; }
  cp "$art/manifest.json" "$stage/artifacts/$id/$lang/"
  for name in $(python3 -c 'import json,sys; print(" ".join(f["name"] for f in json.load(open(sys.argv[1]))["files"]))' "$art/manifest.json"); do
    cp "$art/$name" "$stage/artifacts/$id/$lang/"
  done
  cp "$art"/previews/thumb-*.webp "$stage/artifacts/$id/$lang/previews/"
done
(cd "$stage" && find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS)
tar -czf "$out" -C "$stage" .
echo "$out: $(tar -tzf "$out" | grep -c -v '/$') files, $(du -h "$out" | cut -f1)"

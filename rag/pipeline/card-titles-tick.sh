#!/usr/bin/env bash
# card-titles tick: normalize mangled names, reclaim stale claims, dedupe, report
cd "$(dirname "$0")" || exit 1
SH=card-titles-shards; WK=card-titles-work; OUT=card-titles-out
mkdir -p "$WK" "$OUT" 2>/dev/null

# normalize any name that isn't the canonical shard-NNNN(.claim) shape
for d in "$SH" "$WK"; do
  for f in "$d"/*; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    case "$b" in
      shard-[0-9][0-9][0-9][0-9].json|shard-[0-9][0-9][0-9][0-9].run-[0-9]*-[0-9]*.claim) ;;
      shard-[0-9][0-9][0-9][0-9]*)
        base=$(echo "$b" | grep -oE '^shard-[0-9]{4}')
        if [ -f "$OUT/$base.json" ]; then rm -f "$f"; echo "drop-mangled:$b"
        else mv "$f" "$SH/$base.json" 2>/dev/null; echo "renamed:$b -> $base"; fi ;;
    esac
  done
done

# stale claims: done if output exists, else return to pool
find "$WK" -name '*.claim' -mmin +10 2>/dev/null | while read -r c; do
  base=$(basename "$c" | grep -oE '^shard-[0-9]{4}')
  if [ -f "$OUT/$base.json" ]; then rm -f "$c"
  else mv "$c" "$SH/$base.json" 2>/dev/null && echo "reclaimed:$base"; fi
done

# a shard whose output exists must not sit in the pool
for f in "$SH"/shard-*.json; do
  [ -f "$f" ] || continue
  base=$(basename "$f" .json)
  [ -f "$OUT/$base.json" ] && rm -f "$f" && echo "dedup:$base"
done

left=$(ls "$SH"/shard-*.json 2>/dev/null | wc -l | tr -d ' ')
done_n=$(ls "$OUT"/shard-*.json 2>/dev/null | wc -l | tr -d ' ')
busy=$(ls "$WK"/*.claim 2>/dev/null | wc -l | tr -d ' ')
echo "todo:$left done:$done_n busy:$busy total:$((left + done_n + busy))"

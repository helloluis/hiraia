#!/usr/bin/env bash
# card-titles claim: atomically take ONE canonical shard (round-2 names: r2-NNNN).
cd "$(dirname "$0")" || exit 1
SH=card-titles-shards; WK=card-titles-work
mkdir -p "$WK" 2>/dev/null
s=$(ls "$SH"/shard-[0-9][0-9][0-9][0-9].json "$SH"/r2-[0-9][0-9][0-9][0-9].json "$SH"/r3-[0-9][0-9][0-9][0-9].json 2>/dev/null | sort | head -1)
[ -z "$s" ] && { echo none; exit 0; }
n=$(basename "$s" .json)
run="run-$$-$(date +%s)"
if mv "$s" "$WK/$n.$run.claim" 2>/dev/null; then echo "$n"; else echo none; fi

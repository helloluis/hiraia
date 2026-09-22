#!/usr/bin/env python3
"""Decode OpenAI batch output jsonl into 1024px PNGs. Skips existing. Streams line by line."""
import base64
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / 'raw'


def extract(path):
    RAW.mkdir(parents=True, exist_ok=True)
    ok = skip = bad = declined = 0
    truncated = False
    with path.open('rb') as fh:
        for line in fh:
            if not line.endswith(b'\n'):
                truncated = True
                break
            try:
                rec = json.loads(line)
            except Exception:
                bad += 1
                continue
            cid = rec.get('custom_id') or 'unknown'
            dest = RAW / f'{cid}.png'
            resp = rec.get('response') or {}
            body = resp.get('body') if resp.get('status_code') == 200 else None
            data = (body or {}).get('data') if isinstance(body, dict) else None
            b64 = data[0].get('b64_json') if data else None
            if not b64:
                declined += 1
                continue
            if dest.exists():
                skip += 1
                ok += 1
                continue
            dest.write_bytes(base64.b64decode(b64))
            ok += 1
            if ok % 500 == 0:
                print(f'  ...{ok:,} extracted from {path.name}', flush=True)
    print(f'{path.name}: {ok:,} ok | {skip:,} already on disk | {declined} declined | {bad} bad'
          f'{" | TRUNCATED" if truncated else ""}', flush=True)
    return ok, declined, truncated


def main():
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        raise SystemExit('usage: extract_batch.py <batch_output.jsonl> ...')
    for path in paths:
        extract(path)


if __name__ == '__main__':
    main()

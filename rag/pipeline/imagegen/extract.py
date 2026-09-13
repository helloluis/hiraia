#!/usr/bin/env python3
"""Decode a batch output .jsonl into PNGs, tolerating a truncated final line.

A download that ran out of time leaves the last record half-written; every line before it is
still perfectly good, so this stops at the first incomplete line instead of discarding the
file. Re-running after a resume picks up the rest.
"""
import json, base64, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
os.makedirs(RAW, exist_ok=True)


def main(path):
    ok = bad = 0
    truncated = False
    with open(path, 'rb') as f:
        for line in f:
            if not line.endswith(b'\n'):
                truncated = True
                break
            try:
                j = json.loads(line)
                b64 = j['response']['body']['data'][0]['b64_json']
            except Exception:
                bad += 1
                continue
            p = os.path.join(RAW, f"{j['custom_id']}.png")
            if not os.path.exists(p):
                with open(p, 'wb') as out:
                    out.write(base64.b64decode(b64))
            ok += 1
    print(f'  {os.path.basename(path)}: {ok:,} records | {bad} unusable | '
          f'{"TRUNCATED - resume to get the rest" if truncated else "complete"}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'batch1.jsonl'))

#!/usr/bin/env python3
"""Extract the art-QA new-art batch output into packages/images/cards-png/.

Reads the batch output JSONL (custom_id = qa-<card_id>), decodes each b64_png,
writes <custom_id>.png. Skips already-extracted. Reports failures/declines.

  python3 rag/pipeline/art-qa-newart-extract.py <path-to-output.jsonl>
"""
import os, sys, json, base64

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                       'packages/images/cards-png')

def main(src):
    os.makedirs(OUT_DIR, exist_ok=True)
    ok = skip = fail = 0
    with open(src) as f:
        for l in f:
            if not l.strip():
                continue
            r = json.loads(l)
            cid = r.get('custom_id')
            if not cid:
                continue
            dest = os.path.join(OUT_DIR, f'{cid}.png')
            if os.path.exists(dest) and os.path.getsize(dest) > 0:
                skip += 1
                continue
            resp = r.get('response') or {}
            if resp.get('status_code') != 200:
                fail += 1
                continue
            data = (resp.get('body') or {}).get('data') or []
            if not data or not data[0].get('b64_json'):
                fail += 1
                continue
            with open(dest, 'wb') as w:
                w.write(base64.b64decode(data[0]['b64_json']))
            ok += 1
    print(f'extracted {ok} | skipped {skip} | failed/declined {fail}')

if __name__ == '__main__':
    main(sys.argv[1])

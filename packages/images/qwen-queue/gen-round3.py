#!/usr/bin/env python3
"""Round-3 regeneration: the handful of illustrations that failed the round-2 review.

The 2,612-image round-2 run went through the Batch API (cheap, overnight). Round 3 is ~36
images, so batching buys nothing and costs a day of latency — this hits the synchronous
endpoint with a small worker pool instead. Prompt construction (strip_style + STYLE) and the
request body are imported/copied verbatim from batch-submit-all.py so round-3 images are
indistinguishable from the 2,612 they join.

  set -a; source ./.env.local; set +a
  WORKLIST=packages/images/review/round3-prompts.jsonl \
    python3 packages/images/qwen-queue/gen-round3.py

Env: OPENAI_API_KEY (required), WORKLIST, OUT (default out-round3), WORKERS (default 8),
     OPENAI_MODEL/QUALITY/SIZE (default gpt-image-2 / low / 1024x1024). Resumable: skips ids
     already on disk.
"""
import os, sys, json, base64, importlib.util, urllib.request, urllib.error, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['OPENAI_API_KEY']

# reuse the round-2 prompt construction verbatim — never re-implement it here
_spec = importlib.util.spec_from_file_location('bsa', os.path.join(HERE, 'batch-submit-all.py'))
_bsa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bsa)
strip_style, STYLE = _bsa.strip_style, _bsa.STYLE

WORKLIST = os.environ.get('WORKLIST', os.path.join(HERE, '..', 'review', 'round3-prompts.jsonl'))
OUT = os.environ.get('OUT', os.path.join(HERE, 'out-round3'))
MANIFEST = os.path.join(OUT, 'manifest.jsonl')
MODEL = os.environ.get('OPENAI_MODEL', 'gpt-image-2')
QUALITY = os.environ.get('OPENAI_QUALITY', 'low')
SIZE = os.environ.get('OPENAI_SIZE', '1024x1024')
WORKERS = int(os.environ.get('WORKERS', '8'))
URL = 'https://api.openai.com/v1/images/generations'
os.makedirs(OUT, exist_ok=True)


def gen(row):
    """Generate one image. Returns (id, ok, detail)."""
    img_id = row['id']
    dst = os.path.join(OUT, img_id + '.png')
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return (img_id, True, 'skip (already on disk)')
    body = {'model': MODEL, 'prompt': strip_style(row['prompt']) + STYLE, 'size': SIZE,
            'quality': QUALITY, 'n': 1, 'background': 'opaque', 'output_format': 'png'}
    data = json.dumps(body).encode()
    hdr = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    for attempt in range(6):
        try:
            req = urllib.request.Request(URL, data=data, headers=hdr, method='POST')
            resp = json.load(urllib.request.urlopen(req, timeout=300))
            raw = base64.b64decode(resp['data'][0]['b64_json'])
            with open(dst, 'wb') as fh:
                fh.write(raw)
            return (img_id, True, f'{len(raw)//1024}KB')
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')[:200]
            # moderation refusals are terminal — retrying burns quota for the same answer
            if e.code == 400 and 'moderation' in detail.lower():
                return (img_id, False, f'MODERATION: {detail}')
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(min(60, 2 ** (attempt + 1)))
                continue
            return (img_id, False, f'HTTP {e.code}: {detail}')
        except Exception as e:  # noqa: BLE001 — network flakiness, retry then give up
            if attempt < 5:
                time.sleep(min(60, 2 ** (attempt + 1)))
                continue
            return (img_id, False, f'{type(e).__name__}: {e}')
    return (img_id, False, 'exhausted retries')


def main():
    rows = [json.loads(l) for l in open(WORKLIST) if l.strip()]
    print(f'round3: {len(rows)} prompts -> {OUT} ({MODEL} {SIZE} q{QUALITY}, {WORKERS} workers)', flush=True)
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex, open(MANIFEST, 'a') as mf:
        for i, (img_id, good, detail) in enumerate(ex.map(gen, rows), 1):
            if good:
                ok += 1
            else:
                fail += 1
            print(f'  [{i}/{len(rows)}] {"ok  " if good else "FAIL"} {img_id}: {detail}', flush=True)
            mf.write(json.dumps({'id': img_id, 'ok': good, 'detail': detail}) + '\n')
    print(f'\nDONE: {ok} ok, {fail} failed -> {OUT}')
    if fail:
        print('  rerun the same command to retry the failures (existing files are skipped)')
        sys.exit(1)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Full-run image generation via the OpenAI Batch API (gpt-image-2 low) — 50% cheaper than
sync and immune to the per-minute rate limit. Three modes:

  set -a; source ./.env.local; set +a
  MODE=build  python3 packages/images/qwen-queue/gen-images-batch.py   # write the request JSONL
  MODE=submit python3 packages/images/qwen-queue/gen-images-batch.py   # upload + create batch
  MODE=fetch  python3 packages/images/qwen-queue/gen-images-batch.py   # poll, download, save, log

build : reads WORKLIST, skips ids already in out-final/, writes batch-requests.jsonl.
submit: uploads that file (purpose=batch), creates a batch on /v1/images/generations, saves the
        batch id to batch-id.txt.
fetch : polls the batch to completion, saves each image by custom_id into out-final/, writes any
        MODERATION-declined ids to moderation-declined.txt (for a Qwen fallback pass), and logs
        per-image token usage + cost to manifest-batch.jsonl.

Env: OPENAI_API_KEY, WORKLIST (default worklist.jsonl), MODE, OPENAI_MODEL/QUALITY/SIZE, LIMIT
     (build cap; 0 = all).
"""
import os, sys, json, time, base64, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['OPENAI_API_KEY']
WORKLIST = os.environ.get('WORKLIST', os.path.join(HERE, 'worklist.jsonl'))
OUT = os.path.join(HERE, 'out-final'); os.makedirs(OUT, exist_ok=True)
REQ_FILE = os.path.join(HERE, 'batch-requests.jsonl')
ID_FILE = os.path.join(HERE, 'batch-id.txt')
MANIFEST = os.path.join(HERE, 'manifest-batch.jsonl')
DECLINED = os.path.join(HERE, 'moderation-declined.txt')
MODE = os.environ.get('MODE', 'build')
MODEL = os.environ.get('OPENAI_MODEL', 'gpt-image-2')
QUALITY = os.environ.get('OPENAI_QUALITY', 'low')
SIZE = os.environ.get('OPENAI_SIZE', '1024x1024')
LIMIT = int(os.environ.get('LIMIT', '0'))
API = 'https://api.openai.com/v1'
P_TEXT_IN, P_IMG_IN, P_IMG_OUT = 5.0/1e6, 8.0/1e6, 30.0/1e6  # batch = 50% of these

import re as _re
_MARKERS = ['black-and-white hand-drawn line art', 'black and white hand-drawn line art',
            'hand-drawn line art', 'hand drawn line art', 'a simple illustration', 'simple illustration of']
def strip_style(p):
    p = p.strip(); low = p.lower(); cut = len(p)
    for m in _MARKERS:
        i = low.find(m)
        if i >= 0: cut = min(cut, i)
    s = p[:cut].strip().rstrip(',.').strip()
    return _re.sub(r'^(a )?simple illustration (of|showing) ', '', s, flags=_re.I).strip() or p

STYLE = ('. Black and white pen-and-ink drawing, hand-inked with a brush pen, confident varied '
         'line weight and light cross-hatching for shading, bold and expressive with slightly '
         'imperfect organic linework, in the style of a vintage scientific encyclopedia engraving, '
         'black ink on a plain white background, a single subject centered with generous empty '
         'white space around it, no scenery.')

def _req(url, data=None, method=None, headers=None, raw=False, to_file=None, tries=6):
    """HTTP with retry on transient errors (429/5xx/timeout) so a gateway blip can't kill a
    multi-hour run. `to_file` streams the (potentially multi-GB) response body to disk instead
    of loading it into memory — used for batch output files."""
    h = {'Authorization': f'Bearer {KEY}'}
    if headers: h.update(headers)
    for attempt in range(tries):
        try:
            r = urllib.request.Request(url, data=data, method=method, headers=h)
            resp = urllib.request.urlopen(r, timeout=300)
            if to_file:
                with open(to_file, 'wb') as f:
                    while True:
                        chunk = resp.read(1 << 20)
                        if not chunk: break
                        f.write(chunk)
                return to_file
            return resp.read() if raw else json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                ra = e.headers.get('Retry-After')
                time.sleep(float(ra) if ra else min(60, 2 ** (attempt + 1))); continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < tries - 1:
                time.sleep(min(60, 2 ** (attempt + 1))); continue
            raise

def build():
    rows = [json.loads(l) for l in open(WORKLIST) if l.strip()]
    todo = [r for r in rows if not os.path.exists(os.path.join(OUT, f"{r['id']}.png"))]
    if LIMIT: todo = todo[:LIMIT]
    with open(REQ_FILE, 'w') as f:
        for r in todo:
            f.write(json.dumps({
                'custom_id': r['id'], 'method': 'POST', 'url': '/v1/images/generations',
                'body': {'model': MODEL, 'prompt': strip_style(r['prompt']) + STYLE, 'size': SIZE,
                         'quality': QUALITY, 'n': 1, 'background': 'opaque', 'output_format': 'png'},
            }, ensure_ascii=False) + '\n')
    print(f'build: {len(todo)} requests -> {REQ_FILE} ({os.path.getsize(REQ_FILE)/1e6:.1f} MB)')
    print(f'  (skipped {len(rows)-len(todo)} already in out-final/)')
    if len(todo) > 50000:
        print('  WARNING: >50,000 requests — split into multiple batch files.')

def submit():
    import mimetypes
    # multipart upload of the request file (purpose=batch)
    boundary = '----hiraiabatch'
    with open(REQ_FILE, 'rb') as f: content = f.read()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="batch-requests.jsonl"\r\n'
            f'Content-Type: application/json\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    up = _req(f'{API}/files', data=body, method='POST',
              headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    fid = up['id']; print(f'uploaded file: {fid}')
    batch = _req(f'{API}/batches', data=json.dumps({
        'input_file_id': fid, 'endpoint': '/v1/images/generations', 'completion_window': '24h'}).encode(),
        method='POST', headers={'Content-Type': 'application/json'})
    open(ID_FILE, 'w').write(batch['id'])
    print(f'batch created: {batch["id"]}  status={batch["status"]}')
    print(f'  → run  MODE=fetch  to poll + download')

def fetch():
    bid = open(ID_FILE).read().strip()
    while True:
        b = _req(f'{API}/batches/{bid}'); st = b['status']
        print(f'  status={st} {b["request_counts"]}', flush=True)
        if st in ('completed', 'failed', 'expired', 'cancelled'): break
        time.sleep(60)
    if st == 'failed':
        print(f'  batch failed: {json.dumps(b.get("errors"))[:300]}'); return
    man = open(MANIFEST, 'a')
    saved, declined, out = _download_batch(bid, man)  # hardened: streams to disk, retries 504s
    print(f'\nfetch: saved {saved} images | {declined} declined (ids -> {DECLINED}) | '
          f'batch cost ${round(out*P_IMG_OUT*0.5, 2)}')

def _upload_and_create(path):
    boundary = '----hiraiabatch'
    with open(path, 'rb') as f: content = f.read()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="req.jsonl"\r\n'
            f'Content-Type: application/json\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    fid = _req(f'{API}/files', data=body, method='POST',
               headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})['id']
    return _req(f'{API}/batches', data=json.dumps({
        'input_file_id': fid, 'endpoint': '/v1/images/generations', 'completion_window': '24h'}).encode(),
        method='POST', headers={'Content-Type': 'application/json'})['id']

def _download_batch(bid, man):
    b = _req(f'{API}/batches/{bid}'); saved = declined = out = 0
    if b.get('output_file_id'):
        tmp = os.path.join(HERE, f'.out-{bid}.jsonl')
        _req(f'{API}/files/{b["output_file_id"]}/content', to_file=tmp)  # stream ~GBs to disk
        with open(tmp) as fh:
            for line in fh:  # parse line-by-line — never hold the whole file in memory
                line = line.strip()
                if not line: continue
                o = json.loads(line); cid = o['custom_id']; resp = o.get('response') or {}
                if resp.get('status_code') == 200 and resp.get('body', {}).get('data'):
                    u = resp['body'].get('usage', {})
                    raw = base64.b64decode(resp['body']['data'][0]['b64_json'])
                    open(os.path.join(OUT, f'{cid}.png'), 'wb').write(raw)
                    ti = u.get('input_tokens_details', {}).get('text_tokens', u.get('input_tokens', 0)); ot = u.get('output_tokens', 0)
                    out += ot; saved += 1
                    man.write(json.dumps({'id': cid, 'provider': 'openai-batch', 'quality': QUALITY,
                        'in_text_tokens': ti, 'out_tokens': ot, 'cost_usd': round((ti*P_TEXT_IN+ot*P_IMG_OUT)*0.5, 6),
                        'bytes': len(raw), 'status': 'ok'}, ensure_ascii=False) + '\n')
        os.remove(tmp)
    if b.get('error_file_id'):
        with open(DECLINED, 'a') as dfh:
            for line in _req(f'{API}/files/{b["error_file_id"]}/content', raw=True).decode().strip().splitlines():
                o = json.loads(line); cid = o.get('custom_id', '?'); err = json.dumps(o.get('response') or o.get('error') or {})[:200]
                declined += 1; dfh.write(cid + '\n')
                man.write(json.dumps({'id': cid, 'provider': 'openai-batch', 'status': 'declined',
                    'moderation': 'safety' in err.lower(), 'error': err}, ensure_ascii=False) + '\n')
    man.flush()
    return saved, declined, out

def run():
    """Auto-chunked sequential batches, sized to fit under the org's 1M enqueued-token cap. Each
    chunk: build → submit → (shrink+resubmit if token_limit) → poll to completion → download.
    Resumable: saved images are skipped, so re-running continues where it left off."""
    chunk = int(os.environ.get('CHUNK', '3000')); MIN = 800
    man = open(MANIFEST, 'a'); tot_saved = tot_decl = tot_out = 0; ci = 0
    while True:
        rows = [json.loads(l) for l in open(WORKLIST) if l.strip()]
        todo = [r for r in rows if not os.path.exists(os.path.join(OUT, f"{r['id']}.png"))]
        if not todo:
            print('run: all images generated. done.', flush=True); break
        ci += 1
        take = todo[:chunk]
        with open(REQ_FILE, 'w') as f:
            for r in take:
                f.write(json.dumps({'custom_id': r['id'], 'method': 'POST', 'url': '/v1/images/generations',
                    'body': {'model': MODEL, 'prompt': strip_style(r['prompt']) + STYLE, 'size': SIZE,
                             'quality': QUALITY, 'n': 1, 'background': 'opaque', 'output_format': 'png'}}, ensure_ascii=False) + '\n')
        bid = _upload_and_create(REQ_FILE)
        print(f'[chunk {ci}] submitted {len(take)} (remaining {len(todo)}) → {bid}', flush=True)
        # poll; shrink+resubmit if it fails validation on the token cap
        while True:
            b = _req(f'{API}/batches/{bid}'); st = b['status']
            if st == 'failed':
                errs = json.dumps(b.get('errors') or {})
                if 'token_limit' in errs and chunk > MIN:
                    chunk = max(MIN, chunk // 2)
                    print(f'  token cap hit → shrink chunk to {chunk}, resubmitting', flush=True)
                    take = todo[:chunk]
                    with open(REQ_FILE, 'w') as f:
                        for r in take:
                            f.write(json.dumps({'custom_id': r['id'], 'method': 'POST', 'url': '/v1/images/generations',
                                'body': {'model': MODEL, 'prompt': strip_style(r['prompt']) + STYLE, 'size': SIZE,
                                         'quality': QUALITY, 'n': 1, 'background': 'opaque', 'output_format': 'png'}}, ensure_ascii=False) + '\n')
                    bid = _upload_and_create(REQ_FILE); print(f'  resubmitted → {bid}', flush=True); continue
                print(f'  chunk failed: {errs[:200]}', flush=True); break
            if st in ('completed', 'expired', 'cancelled'):
                s, d, o = _download_batch(bid, man); tot_saved += s; tot_decl += d; tot_out += o
                print(f'  [chunk {ci}] {st}: +{s} saved, +{d} declined | running total {tot_saved} saved, {tot_decl} declined', flush=True)
                break
            time.sleep(60)
    cost = round(tot_out * P_IMG_OUT * 0.5, 2)
    print(f'\n{"="*60}\nRUN DONE: {tot_saved} saved, {tot_decl} declined | ~${cost:.2f} (batch) | declined ids → {DECLINED}', flush=True)

if __name__ == '__main__':
    {'build': build, 'submit': submit, 'fetch': fetch, 'run': run}[MODE]()

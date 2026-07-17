#!/usr/bin/env python3
"""Submit-ONLY batch orchestrator: generate all remaining illustrations via the OpenAI Batch
API (gpt-image-2 low, ~50% cheaper), overnight, WITHOUT downloading. The API can't serve the
large batch output files (504), but the browser signed-blob URLs work — so we generate here and
download tomorrow via those URLs (see fetch-batch-urls.py).

Chunks are sized to fit the org's ~1M enqueued-token cap (auto-shrinks on token_limit). Submitted
ids are tracked so chunks never overlap. Each completed batch is recorded to
batches-to-download.json = [{batch_id, output_file_id, filename, n}] for tomorrow.

  set -a; source ./.env.local; set +a
  CHUNK=7000 python3 packages/images/qwen-queue/batch-submit-all.py
"""
import os, json, time, urllib.request, urllib.error, re

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['OPENAI_API_KEY']
WORKLIST = os.environ.get('WORKLIST', os.path.join(HERE, 'worklist.jsonl'))
OUT = os.path.join(HERE, 'out-final')
REQ = os.path.join(HERE, '.batch-req.jsonl')
SUBMITTED = os.path.join(HERE, 'submitted-ids.txt')
BATCHES = os.path.join(HERE, 'batches-to-download.json')
MODEL = os.environ.get('OPENAI_MODEL', 'gpt-image-2')
QUALITY = os.environ.get('OPENAI_QUALITY', 'low')
SIZE = os.environ.get('OPENAI_SIZE', '1024x1024')
CHUNK0 = int(os.environ.get('CHUNK', '7000'))
API = 'https://api.openai.com/v1'

_MARK = ['black-and-white hand-drawn line art', 'black and white hand-drawn line art',
         'hand-drawn line art', 'hand drawn line art', 'a simple illustration', 'simple illustration of']
def strip_style(p):
    p = p.strip(); low = p.lower(); cut = len(p)
    for m in _MARK:
        i = low.find(m)
        if i >= 0: cut = min(cut, i)
    s = p[:cut].strip().rstrip(',.').strip()
    return re.sub(r'^(a )?simple illustration (of|showing) ', '', s, flags=re.I).strip() or p
STYLE = ('. Black and white pen-and-ink drawing, hand-inked with a brush pen, confident varied '
         'line weight and light cross-hatching for shading, bold and expressive with slightly '
         'imperfect organic linework, in the style of a vintage scientific encyclopedia engraving, '
         'black ink on a plain white background, a single subject centered with generous empty '
         'white space around it, no scenery.')

def _req(url, data=None, method=None, headers=None, tries=6):
    h = {'Authorization': f'Bearer {KEY}'}
    if headers: h.update(headers)
    for a in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=h), timeout=180))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and a < tries - 1:
                time.sleep(min(60, 2 ** (a + 1))); continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if a < tries - 1: time.sleep(min(60, 2 ** (a + 1))); continue
            raise

def write_req(items):
    with open(REQ, 'w') as f:
        for r in items:
            f.write(json.dumps({'custom_id': r['id'], 'method': 'POST', 'url': '/v1/images/generations',
                'body': {'model': MODEL, 'prompt': strip_style(r['prompt']) + STYLE, 'size': SIZE,
                         'quality': QUALITY, 'n': 1, 'background': 'opaque', 'output_format': 'png'}}, ensure_ascii=False) + '\n')

def upload_and_create():
    b = '----hiraiabatch'
    with open(REQ, 'rb') as f: content = f.read()
    body = (f'--{b}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="r.jsonl"\r\n'
            f'Content-Type: application/json\r\n\r\n').encode() + content + f'\r\n--{b}--\r\n'.encode()
    fid = _req(f'{API}/files', data=body, method='POST', headers={'Content-Type': f'multipart/form-data; boundary={b}'})['id']
    return _req(f'{API}/batches', data=json.dumps({'input_file_id': fid, 'endpoint': '/v1/images/generations', 'completion_window': '24h'}).encode(),
                method='POST', headers={'Content-Type': 'application/json'})['id']

def main():
    submitted = set(open(SUBMITTED).read().split()) if os.path.exists(SUBMITTED) else set()
    batches = json.load(open(BATCHES)) if os.path.exists(BATCHES) else []
    chunk = CHUNK0
    while True:
        rows = [json.loads(l) for l in open(WORKLIST) if l.strip()]
        todo = [r for r in rows if r['id'] not in submitted and not os.path.exists(os.path.join(OUT, f"{r['id']}.png"))]
        if not todo:
            break
        take = todo[:chunk]
        write_req(take)
        bid = upload_and_create()
        print(f'[batch {len(batches)+1}] submitted {len(take)} (remaining {len(todo)}) → {bid}', flush=True)
        # poll; shrink+resubmit on token cap; wait for completion (NO download)
        while True:
            b = _req(f'{API}/batches/{bid}'); st = b['status']
            if st == 'failed':
                errs = json.dumps(b.get('errors') or {})
                if 'token_limit' in errs and chunk > 1000:
                    chunk = max(1000, chunk // 2)
                    print(f'  token cap → shrink to {chunk}, resubmit', flush=True)
                    take = todo[:chunk]; write_req(take); bid = upload_and_create()
                    print(f'  resubmitted → {bid}', flush=True); continue
                print(f'  FAILED: {errs[:200]}', flush=True); return
            if st in ('completed', 'expired', 'cancelled'):
                ids = [r['id'] for r in take]
                submitted |= set(ids)
                open(SUBMITTED, 'a').write('\n'.join(ids) + '\n')
                rec = {'batch_id': bid, 'output_file_id': b.get('output_file_id'),
                       'filename': f'{bid}_output.jsonl', 'n': b['request_counts'].get('completed', 0),
                       'failed': b['request_counts'].get('failed', 0), 'status': st}
                batches.append(rec); json.dump(batches, open(BATCHES, 'w'), indent=2)
                print(f'  [batch {len(batches)}] {st}: {rec["n"]} ok, {rec["failed"]} declined | output_file {rec["output_file_id"]}', flush=True)
                break
            time.sleep(60)
    print(f'\n{"="*64}\nALL BATCHES SUBMITTED + COMPLETED: {len(batches)} batches')
    print(f'Tomorrow: for each, grab the signed URL from platform Storage and download.')
    for r in batches:
        print(f'  {r["filename"]}  ({r["n"]} images, file id {r["output_file_id"]})')
    print(f'\nrecord: {BATCHES}')

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Submit the 2,892 art-QA replacement prompts to the OpenAI Batch API — one batch.

The queue runs gpt-image-2 on a deferred schedule; we do NOT download here
(the output file will be ~5 GB — it needs the browser signed-blob URL path,
see rag/pipeline/imagegen/README.md). This script only submits and records.

Style handling: newart-prompts.jsonl prompts already end with the fw-gen
boilerplate. The prior image runs found that boilerplate insufficient — baked-
in text was 87% of audit flags — so this uses the SAME hardened STYLE string
as batch-submit-all.py's 2026-08 review fix (positive-phrased text suppression,
brush-pen vintage-encyclopedia register), stripping the old boilerplate first.

  set -a; source <main>/.env.local; set +a
  python3 rag/pipeline/art-qa-newart-submit.py
"""
import os, json, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['OPENAI_API_KEY']
PROMPTS = os.path.join(HERE, 'art-qa', 'newart-prompts.jsonl')
REQ = os.path.join(HERE, 'art-qa', '.newart-batch-req.jsonl')
RECORD = os.path.join(HERE, 'art-qa', 'newart-batch-record.json')
MODEL = os.environ.get('OPENAI_MODEL', 'gpt-image-2')
QUALITY = os.environ.get('OPENAI_QUALITY', 'low')
SIZE = os.environ.get('OPENAI_SIZE', '1024x1024')
API = 'https://api.openai.com/v1'

_MARK = ['hand-drawn line art, black and white, clean single-weight ink outlines',
         'hand-drawn line art', 'black-and-white hand-drawn line art']

def strip_style(p):
    """Remove the fw-gen boilerplate so the hardened STYLE is appended exactly once."""
    low = p.lower()
    cut = len(p)
    for m in _MARK:
        i = low.find(m)
        if i >= 0:
            cut = min(cut, i)
    return p[:cut].strip().rstrip(',.').strip()

STYLE = ('. Black and white pen-and-ink drawing, hand-inked with a brush pen, confident varied '
         'line weight and light cross-hatching for shading, bold and expressive with slightly '
         'imperfect organic linework, in the style of a vintage scientific encyclopedia engraving, '
         'black ink on a plain white background, a single subject centered with generous empty '
         'white space around it, no scenery, absolutely no text, words, letters, numbers, labels, '
         'captions, signatures or watermarks anywhere in the image.')

def _req(url, data=None, method=None, headers=None, tries=6):
    h = {'Authorization': f'Bearer {KEY}'}
    if headers:
        h.update(headers)
    for a in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, data=data, method=method, headers=h), timeout=180))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and a < tries - 1:
                import time; time.sleep(min(60, 2 ** (a + 1))); continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if a < tries - 1:
                import time; time.sleep(min(60, 2 ** (a + 1))); continue
            raise

def main():
    rows = [json.loads(l) for l in open(PROMPTS) if l.strip()]
    print(f'{len(rows)} prompts | model={MODEL} quality={QUALITY} size={SIZE}', flush=True)

    with open(REQ, 'w') as f:
        for r in rows:
            prompt = strip_style(r['prompt']) + STYLE
            f.write(json.dumps({
                'custom_id': r['new_slug'],
                'method': 'POST', 'url': '/v1/images/generations',
                'body': {'model': MODEL, 'prompt': prompt, 'size': SIZE,
                         'quality': QUALITY, 'n': 1, 'background': 'opaque',
                         'output_format': 'png'}}, ensure_ascii=False) + '\n')

    # upload the JSONL as a batch file
    b = '----hiraiabatch'
    with open(REQ, 'rb') as f:
        content = f.read()
    body = (f'--{b}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n'
            f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="newart.jsonl"\r\n'
            f'Content-Type: application/json\r\n\r\n').encode() + content + f'\r\n--{b}--\r\n'.encode()
    fid = _req(f'{API}/files', data=body, method='POST',
               headers={'Content-Type': f'multipart/form-data; boundary={b}'})['id']
    print(f'input file: {fid}', flush=True)

    bid = _req(f'{API}/batches',
               data=json.dumps({'input_file_id': fid,
                                'endpoint': '/v1/images/generations',
                                'completion_window': '24h'}).encode(),
               method='POST', headers={'Content-Type': 'application/json'})['id']
    print(f'BATCH SUBMITTED: {bid} ({len(rows)} requests, 24h window)', flush=True)

    json.dump({'batch_id': bid, 'input_file_id': fid, 'n_requests': len(rows),
               'model': MODEL, 'quality': QUALITY, 'size': SIZE,
               'prompts_file': PROMPTS,
               'note': 'download via platform.openai.com Storage signed URL when completed; '
                       'extract into packages/images/cards-png/<new_slug>.png (qa-<card_id>), '
                       'then wire with a pool slug-swap + gen-image-map + wire-app-pool'},
              open(RECORD, 'w'), indent=2)
    print(f'record: {RECORD}', flush=True)

if __name__ == '__main__':
    main()

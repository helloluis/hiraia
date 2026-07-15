#!/usr/bin/env python3
"""Image-generation harness: outsource factoid illustration prompts to Alibaba Cloud Model
Studio (DashScope) Qwen-Image, download each result, and store it named by factoid id.

Async DashScope flow per prompt: submit task (X-DashScope-Async) -> poll the task until
SUCCEEDED -> download the result URL. Rate-limited to ~1 submit/sec (API courtesy). Resumable:
any prompt whose out/<id>.png already exists is skipped, so re-running continues where it left
off. QA happens in a SEPARATE step — this harness only sends, downloads, names, and logs.

  set -a; source ./.env.local; set +a
  # spot check a small worklist:
  WORKLIST=packages/images/qwen-queue/sample.jsonl python3 packages/images/qwen-queue/gen-images.py
  # full run (resumes):
  LIMIT=0 python3 packages/images/qwen-queue/gen-images.py

Env:
  ALIBABACLOUD_API_KEY   (required)
  WORKLIST   jsonl of {id, prompt, ...} (default qwen-queue/worklist.jsonl)
  LIMIT      max prompts this run (default 12; 0 = all)
  IMG_MODEL  DashScope model (default qwen-image)
  IMG_SIZE   square size WxH (default 1328*1328 for Qwen-Image; 1024*1024 also common)
  DASHSCOPE_BASE  API base (default intl; override to https://dashscope.aliyuncs.com for CN)
  RATE_S     seconds between submits (default 1.0)
"""
import os, sys, json, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['ALIBABACLOUD_API_KEY']
WORKLIST = os.environ.get('WORKLIST', os.path.join(HERE, 'worklist.jsonl'))
OUT = os.path.join(HERE, 'out')
MANIFEST = os.path.join(HERE, 'manifest.jsonl')
LIMIT = int(os.environ.get('LIMIT', '12'))
MODEL = os.environ.get('IMG_MODEL', 'qwen-image')
SIZE = os.environ.get('IMG_SIZE', '1328*1328')
BASE = os.environ.get('DASHSCOPE_BASE', 'https://dashscope-intl.aliyuncs.com')
RATE_S = float(os.environ.get('RATE_S', '1.0'))
os.makedirs(OUT, exist_ok=True)

import re as _re

# The factoid prompts end with a verbose "hand-drawn line art / coloring-book" style clause that
# makes Qwen render a PHOTO OF A PAPER DRAWING (paper, tape, frames, black backdrops). We STRIP
# that clause, keep only the subject description, and drive the look ourselves with a tight
# "flat vector icon" style — which reliably yields an isolated subject with no frame/paper.
_STYLE_MARKERS = [
    'black-and-white hand-drawn line art', 'black and white hand-drawn line art',
    'hand-drawn line art', 'hand drawn line art', 'a simple illustration', 'simple illustration of',
]
def strip_style(prompt):
    p = prompt.strip()
    low = p.lower()
    cut = len(p)
    for m in _STYLE_MARKERS:
        i = low.find(m)
        if i >= 0:
            cut = min(cut, i)
    subj = p[:cut].strip().rstrip(',.').strip()
    # drop a leading "A simple illustration of/showing" lead-in if that's all that's left
    subj = _re.sub(r'^(a )?simple illustration (of|showing) ', '', subj, flags=_re.I).strip()
    return subj or p

# Positive style ONLY describes what we want (no negations — diffusion models render negated
# words like "no tape"). The "vintage scientific encyclopedia engraving" framing is the key that
# makes Qwen-Image render the subject isolated on plain white by default (like an old encyclopedia
# plate) instead of adding paper/frames/tape/sticker/black backdrops — and it gives the hand-drawn
# pen-and-ink cross-hatch look (not vector).
CLEAN_STYLE = ('. Black and white pen-and-ink drawing, hand-inked with a brush pen, confident varied '
               'line weight and light cross-hatching for shading, bold and expressive with slightly '
               'imperfect organic linework, in the style of a vintage scientific encyclopedia '
               'engraving, black ink on plain white, generous empty white space around it.')
# Everything we DON'T want goes here (this is where "no paper/frame/tape/color" belongs).
NEG = ('color, colored, colorful, saturated, vibrant, rainbow, yellow, cream, beige, sepia, tinted, '
       'watercolor, painting, photograph, realistic photo, 3d render, gradient, grey background, '
       'gray background, dark background, black background, vignette, drop shadow, shadow, border, '
       'frame, rectangle, box, card, sticker, die cut, cutout, white outline, panel, app icon, '
       'page edge, margin, paper, paper sheet, torn paper, tape, masking tape, polaroid, sketchbook, '
       'notebook, canvas, canvas texture, photo of a drawing, scene, desk, table, mockup, '
       'perfect clean vector, crisp vector lines')

SUBMIT_URL = f'{BASE}/api/v1/services/aigc/text2image/image-synthesis'
def task_url(tid): return f'{BASE}/api/v1/tasks/{tid}'

def _req(url, data=None, method=None, extra_headers=None):
    headers = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    if extra_headers: headers.update(extra_headers)
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

def submit(prompt):
    payload = {
        'model': MODEL,
        'input': {'prompt': strip_style(prompt) + CLEAN_STYLE, 'negative_prompt': NEG},
        # prompt_extend=false is critical: DashScope's default LLM prompt-rewriter injects
        # scenes (paper, tape, desks, frames) that override our "isolated on white" intent.
        'parameters': {'size': SIZE, 'n': 1, 'prompt_extend': False, 'watermark': False},
    }
    r = _req(SUBMIT_URL, payload, method='POST', extra_headers={'X-DashScope-Async': 'enable'})
    return r['output']['task_id']

def poll(tid, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = _req(task_url(tid))
        st = r['output'].get('task_status')
        if st == 'SUCCEEDED':
            res = r['output'].get('results', [])
            url = res[0].get('url') if res else None
            if not url:
                raise RuntimeError(f'SUCCEEDED but no url: {json.dumps(r)[:300]}')
            return url
        if st in ('FAILED', 'CANCELED', 'UNKNOWN'):
            raise RuntimeError(f'task {st}: {json.dumps(r.get("output"))[:300]}')
        time.sleep(2)
    raise TimeoutError(f'task {tid} did not finish in {timeout}s')

def download(url, path):
    req = urllib.request.Request(url, headers={'User-Agent': 'hiraia-image-harness'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    with open(path, 'wb') as f:
        f.write(data)
    return len(data)

def main():
    rows = [json.loads(l) for l in open(WORKLIST) if l.strip()]
    todo = [r for r in rows if not os.path.exists(os.path.join(OUT, f"{r['id']}.png"))]
    if LIMIT:
        todo = todo[:LIMIT]
    print(f'harness: {len(rows)} in worklist | {len(todo)} to generate this run '
          f'(model={MODEL}, size={SIZE}, base={BASE})', flush=True)
    ok = fail = 0
    man = open(MANIFEST, 'a')
    for i, r in enumerate(todo, 1):
        fid, prompt = r['id'], r['prompt']
        path = os.path.join(OUT, f'{fid}.png')
        t0 = time.time()
        try:
            tid = submit(prompt)
            url = poll(tid)
            n = download(url, path)
            ok += 1
            man.write(json.dumps({'id': fid, 'factId': r.get('factId'), 'topic': r.get('topic'),
                                  'domain': r.get('domain'), 'file': f'{fid}.png',
                                  'task_id': tid, 'bytes': n}, ensure_ascii=False) + '\n')
            man.flush()
            print(f'  [{i}/{len(todo)}] OK {fid}  {n//1024}KB  {time.time()-t0:.1f}s  · {r.get("topic","")[:48]}', flush=True)
        except urllib.error.HTTPError as e:
            fail += 1
            print(f'  [{i}/{len(todo)}] HTTP {e.code} {fid}: {e.read().decode()[:200]}', flush=True)
        except Exception as e:
            fail += 1
            print(f'  [{i}/{len(todo)}] FAIL {fid}: {type(e).__name__}: {str(e)[:200]}', flush=True)
        time.sleep(RATE_S)  # ~1 submit/sec courtesy rate limit
    print(f'\nDONE: {ok} generated, {fail} failed -> {OUT}', flush=True)

if __name__ == '__main__':
    main()

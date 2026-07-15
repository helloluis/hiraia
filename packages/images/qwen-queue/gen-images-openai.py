#!/usr/bin/env python3
"""Alternate image-generation harness using OpenAI's GPT-Image model. Same worklist / resume /
naming / manifest as gen-images.py, but hits OpenAI instead of Qwen — and requests a
TRANSPARENT background, which sidesteps the whole white-background/frame battle: the model
returns the isolated subject on alpha, and we composite it onto clean white ourselves.

  set -a; source ./.env.local; set +a
  WORKLIST=packages/images/qwen-queue/sample.jsonl python3 packages/images/qwen-queue/gen-images-openai.py

Env:
  OPENAI_API_KEY   (required)
  WORKLIST   jsonl of {id, prompt, ...} (default qwen-queue/worklist.jsonl)
  LIMIT      max prompts this run (default 12; 0 = all)
  IMG_MODEL  OpenAI image model (default gpt-image-1; set gpt-image-2 to try the newer one)
  IMG_SIZE   1024x1024 | 1536x1024 | 1024x1536 | auto  (default 1024x1024, square)
  IMG_QUALITY  low | medium | high | auto  (default medium — high is ~4x the cost)
  IMG_BG     transparent | opaque | auto  (default transparent)
  KEEP_ALPHA 1 to keep the transparent PNG as-is; default composites onto white
  RATE_S     seconds between requests (default 1.0)
"""
import os, sys, json, time, base64, io, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['OPENAI_API_KEY']
WORKLIST = os.environ.get('WORKLIST', os.path.join(HERE, 'worklist.jsonl'))
OUT = os.path.join(HERE, 'out-openai')
MANIFEST = os.path.join(HERE, 'manifest-openai.jsonl')
LIMIT = int(os.environ.get('LIMIT', '12'))
MODEL = os.environ.get('IMG_MODEL', 'gpt-image-1')
SIZE = os.environ.get('IMG_SIZE', '1024x1024')
QUALITY = os.environ.get('IMG_QUALITY', 'medium')
BG = os.environ.get('IMG_BG', 'transparent')
KEEP_ALPHA = os.environ.get('KEEP_ALPHA', '') == '1'
RATE_S = float(os.environ.get('RATE_S', '1.0'))
URL = 'https://api.openai.com/v1/images/generations'
os.makedirs(OUT, exist_ok=True)

try:
    from PIL import Image
except Exception:
    Image = None

import re as _re
_STYLE_MARKERS = [
    'black-and-white hand-drawn line art', 'black and white hand-drawn line art',
    'hand-drawn line art', 'hand drawn line art', 'a simple illustration', 'simple illustration of',
]
def strip_style(prompt):
    p = prompt.strip(); low = p.lower(); cut = len(p)
    for m in _STYLE_MARKERS:
        i = low.find(m)
        if i >= 0: cut = min(cut, i)
    subj = p[:cut].strip().rstrip(',.').strip()
    subj = _re.sub(r'^(a )?simple illustration (of|showing) ', '', subj, flags=_re.I).strip()
    return subj or p

# Same hand-drawn pen-and-ink engraving look. With a transparent background (gpt-image-1) no
# frame/paper can appear at all; with an opaque background (gpt-image-2 has no transparency) we
# lean on the "engraving on plain white" framing that reliably renders isolated-on-white.
_INK = ('. Black and white pen-and-ink drawing, hand-inked with a brush pen, confident varied '
        'line weight and light cross-hatching for shading, bold and expressive with slightly '
        'imperfect organic linework, in the style of a vintage scientific encyclopedia engraving, ')
STYLE_TRANSPARENT = _INK + 'a single subject centered and isolated on a fully transparent background, no scenery.'
STYLE_WHITE = _INK + 'black ink on a plain white background, a single subject centered with generous empty white space around it, no scenery.'

def gen(prompt):
    style = STYLE_TRANSPARENT if BG == 'transparent' else STYLE_WHITE
    payload = {'model': MODEL, 'prompt': strip_style(prompt) + style, 'size': SIZE,
               'quality': QUALITY, 'n': 1, 'background': BG, 'output_format': 'png'}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(URL, data=body, method='POST',
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    return base64.b64decode(r['data'][0]['b64_json'])

def save(raw, path):
    if Image is None or KEEP_ALPHA:
        with open(path, 'wb') as f: f.write(raw)
        return len(raw)
    img = Image.open(io.BytesIO(raw))
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img = img.convert('RGBA')
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
    else:
        img = img.convert('RGB')
    img.save(path)
    return os.path.getsize(path)

def main():
    rows = [json.loads(l) for l in open(WORKLIST) if l.strip()]
    todo = [r for r in rows if not os.path.exists(os.path.join(OUT, f"{r['id']}.png"))]
    if LIMIT: todo = todo[:LIMIT]
    print(f'openai harness: {len(rows)} in worklist | {len(todo)} to generate '
          f'(model={MODEL}, size={SIZE}, quality={QUALITY}, bg={BG})', flush=True)
    ok = fail = 0
    man = open(MANIFEST, 'a')
    for i, r in enumerate(todo, 1):
        fid = r['id']; path = os.path.join(OUT, f'{fid}.png'); t0 = time.time()
        try:
            raw = gen(r['prompt']); n = save(raw, path); ok += 1
            man.write(json.dumps({'id': fid, 'factId': r.get('factId'), 'topic': r.get('topic'),
                                  'domain': r.get('domain'), 'file': f'{fid}.png', 'bytes': n},
                                 ensure_ascii=False) + '\n'); man.flush()
            print(f'  [{i}/{len(todo)}] OK {fid}  {n//1024}KB  {time.time()-t0:.1f}s  · {r.get("topic","")[:46]}', flush=True)
        except urllib.error.HTTPError as e:
            fail += 1; print(f'  [{i}/{len(todo)}] HTTP {e.code} {fid}: {e.read().decode()[:300]}', flush=True)
        except Exception as e:
            fail += 1; print(f'  [{i}/{len(todo)}] FAIL {fid}: {type(e).__name__}: {str(e)[:200]}', flush=True)
        time.sleep(RATE_S)
    print(f'\nDONE: {ok} generated, {fail} failed -> {OUT}', flush=True)

if __name__ == '__main__':
    main()

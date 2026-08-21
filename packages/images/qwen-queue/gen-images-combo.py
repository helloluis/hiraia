#!/usr/bin/env python3
"""Concurrent image-generation harness: OpenAI gpt-image-2 (low) as primary, Qwen-Image as the
fallback whenever OpenAI's safety system declines a prompt (common on legitimate human-body /
biology facts). Fires up to 1 NEW request per second (courtesy rate limit) while many stay
in-flight concurrently, so throughput ≈ 1/sec rather than serial. Resumable. Logs full per-image
token usage + cost to a manifest so the end-to-end spend is known exactly.

  set -a; source ./.env.local; set +a
  LIMIT=100 python3 packages/images/qwen-queue/gen-images-combo.py

Env:
  OPENAI_API_KEY, ALIBABACLOUD_API_KEY   (required)
  WORKLIST   default qwen-queue/worklist.jsonl
  LIMIT      max images this run (default 100; 0 = all)
  OPENAI_MODEL   default gpt-image-2
  OPENAI_QUALITY default low
  RATE_S     seconds between new submits (default 1.0)
  MAX_WORKERS default 40
  QWEN_MODEL default qwen-image ; QWEN_SIZE default 1328*1328
  QWEN_COST_PER_IMG  flat $ logged for a Qwen fallback image (DashScope bills per image, not
                     per token); default 0.02 — adjust to the real DashScope rate.
"""
import os, sys, json, time, base64, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
OAI_KEY = os.environ['OPENAI_API_KEY']
ALI_KEY = os.environ['ALIBABACLOUD_API_KEY']
WORKLIST = os.environ.get('WORKLIST', os.path.join(HERE, 'worklist.jsonl'))
OUT = os.path.join(HERE, 'out-final')
MANIFEST = os.path.join(HERE, 'manifest-final.jsonl')
LIMIT = int(os.environ.get('LIMIT', '100'))
OAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-image-2')
OAI_QUALITY = os.environ.get('OPENAI_QUALITY', 'low')
OAI_SIZE = os.environ.get('OPENAI_SIZE', '1024x1024')
# This account's gpt-image tier sustains ~6 images/min; submitting faster just floods it into
# 429s (concurrency can't beat a per-minute cap). 10s/submit = 6/min is the proven-clean pace.
# Because each image takes ~21s, only ~2-3 are ever in flight, so a small worker pool is plenty.
RATE_S = float(os.environ.get('RATE_S', '10.0'))
MAX_WORKERS = int(os.environ.get('MAX_WORKERS', '8'))
QWEN_MODEL = os.environ.get('QWEN_MODEL', 'qwen-image')
QWEN_SIZE = os.environ.get('QWEN_SIZE', '1328*1328')
QWEN_COST = float(os.environ.get('QWEN_COST_PER_IMG', '0.02'))
os.makedirs(OUT, exist_ok=True)

# OpenAI gpt-image-2 token pricing ($ / token)
P_TEXT_IN = 5.0 / 1e6
P_IMG_IN = 8.0 / 1e6
P_IMG_OUT = 30.0 / 1e6

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
# 2026-08 review fix: gpt-image has no negative_prompt, so text suppression must ride the
# positive prompt — appended for the OpenAI call only (Qwen gets it via QWEN_NEG instead,
# since negations in a diffusion positive prompt backfire).
TEXT_FREE = (', absolutely no text, words, letters, numbers, labels, captions, signatures or '
             'watermarks anywhere in the image')
# 2026-08 review fix: added the text family — baked-in words/labels were 87% of audit flags.
QWEN_NEG = ('text, words, letters, numbers, typography, writing, alphabet, characters, label, labels, '
            'caption, captions, title, signature, watermark, logo, brand name, '
            'color, colored, colorful, yellow, sepia, tinted, watercolor, painting, photograph, '
            '3d render, gradient, grey background, dark background, black background, vignette, shadow, '
            'border, frame, box, card, sticker, paper, tape, sketchbook, notebook, scene, mockup, vector')

class Moderation(Exception): pass

# ---- OpenAI ----
def openai_gen(prompt):
    payload = {'model': OAI_MODEL, 'prompt': strip_style(prompt) + STYLE + TEXT_FREE, 'size': OAI_SIZE,
               'quality': OAI_QUALITY, 'n': 1, 'background': 'opaque', 'output_format': 'png'}
    body = json.dumps(payload).encode()
    for attempt in range(6):
        req = urllib.request.Request('https://api.openai.com/v1/images/generations', data=body,
            method='POST', headers={'Authorization': f'Bearer {OAI_KEY}', 'Content-Type': 'application/json'})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=300))
            return base64.b64decode(r['data'][0]['b64_json']), r.get('usage', {})
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            if e.code == 400 and 'safety' in txt.lower():
                raise Moderation(txt)
            if e.code in (429, 500, 502, 503) and attempt < 5:
                ra = e.headers.get('Retry-After')
                time.sleep(float(ra) if ra else min(60, 2 ** (attempt + 1))); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5: time.sleep(min(60, 2 ** (attempt + 1))); continue
            raise

def openai_cost(u):
    d_in = u.get('input_tokens_details', {})
    txt = d_in.get('text_tokens', u.get('input_tokens', 0))
    img_in = d_in.get('image_tokens', 0)
    out = u.get('output_tokens', 0)
    return round(txt * P_TEXT_IN + img_in * P_IMG_IN + out * P_IMG_OUT, 6), txt, img_in, out

# ---- Qwen (DashScope async) fallback ----
def qwen_gen(prompt):
    base = 'https://dashscope-intl.aliyuncs.com'
    payload = {'model': QWEN_MODEL, 'input': {'prompt': strip_style(prompt) + STYLE, 'negative_prompt': QWEN_NEG},
               'parameters': {'size': QWEN_SIZE, 'n': 1, 'prompt_extend': False, 'watermark': False}}
    req = urllib.request.Request(f'{base}/api/v1/services/aigc/text2image/image-synthesis',
        data=json.dumps(payload).encode(), method='POST',
        headers={'Authorization': f'Bearer {ALI_KEY}', 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable'})
    tid = json.load(urllib.request.urlopen(req, timeout=120))['output']['task_id']
    t0 = time.time()
    while time.time() - t0 < 180:
        r = urllib.request.Request(f'{base}/api/v1/tasks/{tid}', headers={'Authorization': f'Bearer {ALI_KEY}'})
        o = json.load(urllib.request.urlopen(r, timeout=120))['output']
        st = o.get('task_status')
        if st == 'SUCCEEDED':
            url = o['results'][0]['url']
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'h'}), timeout=120).read()
        if st in ('FAILED', 'CANCELED', 'UNKNOWN'): raise RuntimeError(str(o))
        time.sleep(2)
    raise TimeoutError('qwen task timeout')

def process(item):
    fid = item['id']; path = os.path.join(OUT, f'{fid}.png'); t0 = time.time()
    rec = {'id': fid, 'factId': item.get('factId'), 'topic': item.get('topic'), 'domain': item.get('domain')}
    try:
        raw, usage = openai_gen(item['prompt'])
        with open(path, 'wb') as f: f.write(raw)
        cost, txt, img_in, out = openai_cost(usage)
        rec.update(provider='openai', model=OAI_MODEL, quality=OAI_QUALITY, status='ok',
                   in_text_tokens=txt, in_image_tokens=img_in, out_tokens=out, cost_usd=cost,
                   bytes=len(raw), seconds=round(time.time() - t0, 1))
        return rec
    except Moderation:
        try:
            raw = qwen_gen(item['prompt'])
            with open(path, 'wb') as f: f.write(raw)
            rec.update(provider='qwen', model=QWEN_MODEL, quality='na', status='ok-fallback',
                       in_text_tokens=0, in_image_tokens=0, out_tokens=0, cost_usd=QWEN_COST,
                       bytes=len(raw), seconds=round(time.time() - t0, 1), note='openai_moderation_declined')
            return rec
        except Exception as e:
            rec.update(provider='qwen', status='failed', cost_usd=0, error=f'{type(e).__name__}: {str(e)[:150]}')
            return rec
    except Exception as e:
        rec.update(provider='openai', status='failed', cost_usd=0, error=f'{type(e).__name__}: {str(e)[:150]}')
        return rec

def main():
    rows = [json.loads(l) for l in open(WORKLIST) if l.strip()]
    todo = [r for r in rows if not os.path.exists(os.path.join(OUT, f"{r['id']}.png"))]
    if LIMIT: todo = todo[:LIMIT]
    print(f'combo harness: {len(todo)} to generate (OpenAI {OAI_MODEL}/{OAI_QUALITY} primary, Qwen fallback, '
          f'{RATE_S}s/submit, {MAX_WORKERS} workers)', flush=True)
    man = open(MANIFEST, 'a')
    totals = {'openai': 0, 'qwen': 0, 'failed': 0, 'cost': 0.0, 'out_tok': 0}
    lock = threading.Lock()
    t_start = time.time()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = []
        last = 0.0
        for item in todo:
            wait = RATE_S - (time.time() - last)
            if wait > 0: time.sleep(wait)
            last = time.time()
            futures.append(ex.submit(process, item))
        done = 0
        for fut in as_completed(futures):
            rec = fut.result(); done += 1
            with lock:
                man.write(json.dumps(rec, ensure_ascii=False) + '\n'); man.flush()
            st = rec.get('status')
            if st == 'ok': totals['openai'] += 1
            elif st == 'ok-fallback': totals['qwen'] += 1
            else: totals['failed'] += 1
            totals['cost'] += rec.get('cost_usd', 0) or 0
            totals['out_tok'] += rec.get('out_tokens', 0) or 0
            tag = {'ok': 'OAI', 'ok-fallback': 'QWEN↩', 'failed': 'FAIL'}.get(st, st)
            print(f"  [{done}/{len(todo)}] {tag:6} {rec['id']} ${rec.get('cost_usd',0):.4f} "
                  f"{rec.get('seconds','?')}s · {(rec.get('topic') or '')[:42]}", flush=True)
    n = totals['openai'] + totals['qwen'] + totals['failed']
    ok = totals['openai'] + totals['qwen']
    avg = totals['cost'] / max(ok, 1)
    print(f"\n{'='*66}\nDONE in {(time.time()-t_start)/60:.1f} min | {ok} ok "
          f"({totals['openai']} OpenAI + {totals['qwen']} Qwen-fallback), {totals['failed']} failed")
    print(f"total cost: ${totals['cost']:.4f} | avg ${avg:.4f}/img | {totals['out_tok']:,} OpenAI out-tokens")
    print(f"projected full 18,816-image run at this avg: ~${avg*18816:,.0f}")

if __name__ == '__main__':
    main()

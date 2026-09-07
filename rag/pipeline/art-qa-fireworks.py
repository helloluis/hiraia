#!/usr/bin/env python3
"""Art-QA Fireworks runner — DeepSeek V4 Flash Vision Exp, the paid fast lane.

Same job as art-qa-kimi.py (identical verdicts.jsonl format, same claims.json
dedupe via the dispatcher's next-kimi pull), but on Fireworks serverless where
concurrency is purchased, not window-rationed: no pacer, just retries.

Cost model (docs.fireworks.ai/serverless/pricing, verified 2026-09-07):
  $0.22/M input, $0.66/M output. ~1.6k in + ~80 out per call ≈ $0.0004/pair
  → 13k pairs ≈ $5. Track actual token usage from API responses and report it.

  FIREWORKS_API_KEY=... python3 rag/pipeline/art-qa-fireworks.py          # all pending
  FIREWORKS_API_KEY=... LIMIT=1000 python3 rag/pipeline/art-qa-fireworks.py  # pilot
Env: MODEL, URL, CONC(24), LIMIT
"""
import os, sys, json, time, base64, threading, urllib.request, urllib.error, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('URL', 'https://api.fireworks.ai/inference/v1/chat/completions')
MODEL = os.environ.get('MODEL', 'accounts/fireworks/models/deepseek-v4-flash-vision-exp')
KEY = os.environ['FIREWORKS_API_KEY']
CONC = int(os.environ.get('CONC', '24'))
LIMIT = int(os.environ.get('LIMIT', '0')) or None
VERDICTS = os.path.join(HERE, 'art-qa', 'verdicts.jsonl')

lock = threading.Lock()
stats = {'match': 0, 'partial': 0, 'mismatch': 0, 'errors': 0, 'in_tok': 0, 'out_tok': 0}
t0 = time.time()

def call(img_b64, prompt, retries=5):
    body = json.dumps({
        'model': MODEL,
        'max_tokens': 300,
        'temperature': 0.2,
        # DeepSeek V4 Flash Vision is a reasoning model by default (~300 reasoning tok/call,
        # 15x the answer cost). 'none' returns the answer directly in content (verified).
        'reasoning_effort': 'none',
        'messages': [{'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{img_b64}'}},
            {'type': 'text', 'text': prompt},
        ]}],
    }).encode()
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(URL, data=body, headers={
            'Content-Type': 'application/json', 'Authorization': f'Bearer {KEY}'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.loads(r.read())
            msg = d['choices'][0]['message']
            content = (msg.get('content') or msg.get('reasoning_content') or '').strip()
            usage = d.get('usage') or {}
            if content:
                return content, int(usage.get('prompt_tokens') or 0), int(usage.get('completion_tokens') or 0)
            last = RuntimeError('empty content')
        except urllib.error.HTTPError as e:
            body_txt = e.read().decode()[:200]
            last = RuntimeError(f'HTTP {e.code}: {body_txt}')
            if e.code in (429, 500, 503):
                time.sleep(2 ** attempt * 2)
            elif e.code == 400:
                raise last  # bad request won't fix itself
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(f'fireworks call failed after {retries} retries: {last}')

def parse_verdict(text):
    import re
    # The model answers "match/partial/mismatch. <sentence>". Extract the verdict from the
    # FIRST standalone occurrence (the answer), not keywords anywhere (reasoning preambles
    # mention all three words). Check mismatch BEFORE match so the longer word wins.
    m = re.search(r'\b(mismatch|partial|match)\b', text.lower())
    v = m.group(1) if m else 'match'
    return v, text.replace('\n', ' ').strip()[:220]

def judge(p):
    img = base64.b64encode(open(p['img'], 'rb').read()).decode()
    prompt = (
        "You are auditing illustrations for a Filipino grade-school science app. "
        f"The card is titled '{p['title_en'] or p['topic']}' (topic: {p['topic']}; categories: {', '.join(p['cats'])}). "
        "Look at the image and judge: does it DEPICT what the card is ABOUT? "
        "match = clearly the card's subject; partial = related/adjacent (e.g. depicts the remedy "
        "or a sub-part, not the subject itself); mismatch = depicts something else entirely. "
        "Answer with one word (match/partial/mismatch), then one short sentence why."
    )
    text, tin, tout = call(img, prompt)
    v, note = parse_verdict(text)
    row = {'pair_id': p['pair_id'], 'slug': p['slug'], 'card_id': p['card_id'],
           'verdict': v, 'note': note, 'source': 'fireworks'}
    with lock:
        stats[v] += 1
        stats['in_tok'] += tin
        stats['out_tok'] += tout
        with open(VERDICTS, 'a') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')

def main():
    out = subprocess.run([sys.executable, os.path.join(HERE, 'art-qa-dispatch.py'),
                          'next-kimi', str(LIMIT if LIMIT else 20000)],
                         capture_output=True, text=True).stdout
    work = [json.loads(l) for l in out.splitlines() if l.strip()]
    if LIMIT:
        work = work[:LIMIT]
    print(f"{len(work)} pairs | model={MODEL} conc={CONC}", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = {ex.submit(judge, p): p for p in work}
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                with lock:
                    stats['errors'] += 1
                print(f"  err {futs[fut]['pair_id']}: {str(e)[:120]}", flush=True)
            done += 1
            if done % 100 == 0:
                el = (time.time() - t0) / 60
                cost = stats['in_tok'] / 1e6 * 0.22 + stats['out_tok'] / 1e6 * 0.66
                print(f"  {done}/{len(work)} | {stats['match']}m/{stats['partial']}p/{stats['mismatch']}x/{stats['errors']}e "
                      f"| {el:.1f}min | ${cost:.2f}", flush=True)
    el = (time.time() - t0) / 60
    cost = stats['in_tok'] / 1e6 * 0.22 + stats['out_tok'] / 1e6 * 0.66
    print(f"DONE. {stats} | {el:.1f}min | ${cost:.2f} "
          f"| rate {done/el:.0f}/min | extrapolated 13k: ${cost/max(done,1)*13000:.0f}", flush=True)

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Adjudicate qwen-flagged facts with a DIFFERENT model family (gpt-oss-120b) for
decorrelation. Facts were written by Claude, flagged by qwen; gpt-oss independently
re-judges and proposes a correction. We trust a correction only when both models agree
the fact is wrong. Local review (Opus) + web checks happen on top of this. Fireworks.

  set -a; source ./.env.local; set +a
  FW_LIMIT=20 python3 rag/pipeline/fw-adjudicate.py
  python3 rag/pipeline/fw-adjudicate.py
"""
import os, json, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, 'flagged-facts-review.jsonl')
OUTF = os.path.join(HERE, 'flagged-facts-adjudicated.jsonl')
MODEL = 'accounts/fireworks/models/gpt-oss-120b'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
BATCH = int(os.environ.get('FW_BATCH', '8'))
CONC = int(os.environ.get('FW_CONC', '4'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))

HEAD = '''You are an expert science fact-checker reviewing facts for a Filipino grade-5 tutor. Another reviewer flagged each fact below. INDEPENDENTLY decide the truth — do not just defer to the reviewer; they are sometimes wrong.

For EACH item output: judgment = "wrong" (factually incorrect), "misleading" (true-ish but oversimplified in a way that teaches something false), or "fine" (acceptable for grade 5, the flag was unnecessary). If wrong or misleading, write a corrected one-sentence fact (same style, grade-5, keep what was right). For specific numbers/dates/thresholds, only mark "wrong" if you are confident; else "uncertain". note = brief why.

Output ONLY a JSON array, one per item IN ORDER:
{"factId":"..","judgment":"wrong|misleading|fine|uncertain","corrected":"<corrected fact or empty>","note":".."}
ITEMS:
'''

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'n': 0, 'batches': 0, 'failed': 0}
_results = []

def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'reasoning_effort': 'high', 'temperature': 0.1, 'max_tokens': 6000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=240))
        m = r['choices'][0]['message']; u = r.get('usage', {})
        return (m.get('content') or '', m.get('reasoning_content') or '', u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 5:
            ra = e.headers.get('Retry-After'); time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 5:
            time.sleep(min(90, 2 ** (attempt + 1))); return call(prompt, attempt + 1)
        raise

def arr_from(c, rc):
    for s in (c, rc):
        s = (s or '').strip(); a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try: return json.loads(s[a:b + 1])
            except Exception: pass
    return None

def do_batch(items):
    payload = [{'factId': r['factId'], 'fact': r['fact'], 'flagged_as': r['verdict'], 'reviewer_reason': r['reason']} for r in items]
    try:
        c, rc, pin, pout = call(HEAD + json.dumps(payload, ensure_ascii=False))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  FAIL: {type(e).__name__}', flush=True); return
    arr = arr_from(c, rc) or []
    by = {r['factId']: r for r in items}
    out = []
    for o in arr:
        if isinstance(o, dict) and o.get('factId') in by:
            src = by[o['factId']]
            out.append({'factId': o['factId'], 'domain': src['domain'], 'qwen_verdict': src['verdict'],
                        'qwen_reason': src['reason'], 'gptoss_judgment': o.get('judgment', 'uncertain'),
                        'corrected': (o.get('corrected') or '').strip(), 'note': o.get('note', ''), 'original': src['fact']})
    with _lock:
        _results.extend(out); _stats['in'] += pin; _stats['out'] += pout; _stats['n'] += len(out); _stats['batches'] += 1

def main():
    items = [json.loads(l) for l in open(INP)]
    if LIMIT: items = items[:LIMIT]
    batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
    print(f'adjudicating {len(items)} flagged facts in {len(batches)} batches via {MODEL.split("/")[-1]} (decorrelated from qwen)', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_batch, b) for b in batches]): pass
    with open(OUTF, 'w') as f:
        for r in _results:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    from collections import Counter
    # cross-tab: where qwen said wrong and gpt-oss agrees vs disagrees
    agree_wrong = sum(1 for r in _results if r['qwen_verdict'] == 'wrong' and r['gptoss_judgment'] in ('wrong', 'misleading'))
    false_flag = sum(1 for r in _results if r['gptoss_judgment'] == 'fine')
    cost = _stats['in'] / 1e6 * 0.15 + _stats['out'] / 1e6 * 0.60
    print(f"\nDONE in {(time.time()-t0)/60:.1f} min | adjudicated {_stats['n']} | failed {_stats['failed']}")
    print('gpt-oss judgments:', dict(Counter(r['gptoss_judgment'] for r in _results)))
    print(f"qwen-wrong that gpt-oss ALSO calls wrong/misleading: {agree_wrong} | gpt-oss says FINE (likely false flags): {false_flag}")
    print(f"est cost ~${cost:.2f} | wrote {OUTF}")

if __name__ == '__main__':
    main()

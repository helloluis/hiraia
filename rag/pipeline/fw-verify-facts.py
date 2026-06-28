#!/usr/bin/env python3
"""Fact-check science facts via Fireworks (qwen3.7-plus). Decorrelated: the facts were
written by Claude; qwen judges them. Flags wrong / misleading-oversimplified facts for
human review. Resumable, thread-pooled w/ backoff. Uses Fireworks credits, not Claude.

  set -a; source ./.env.local; set +a
  FW_LIMIT=30 python3 rag/pipeline/fw-verify-facts.py
  python3 rag/pipeline/fw-verify-facts.py
"""
import os, json, glob, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, os.environ.get('FW_INPUT', 'facts-to-verify.jsonl'))
OUT = os.path.join(HERE, os.environ.get('FW_OUT', 'fact-verdicts'))
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/qwen3p7-plus')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
BATCH = int(os.environ.get('FW_BATCH', '15'))
CONC = int(os.environ.get('FW_CONC', '6'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
os.makedirs(OUT, exist_ok=True)

HEAD = '''You are a careful science fact-checker. For EACH fact below, judge whether it is factually CORRECT and appropriate for a grade-5 (10-year-old) science context. Reason first, then output ONLY the final JSON array.

verdict: "ok" = true and accurate; "suspect" = oversimplified to the point of being misleading, ambiguous, or you are genuinely unsure; "wrong" = factually incorrect. reason = short (<=12 words); for suspect/wrong, say what's off.

FINAL ANSWER = a JSON array, one object per fact IN ORDER:
[{"id":"<fact id>","verdict":"ok","reason":".."}]
FACTS:
'''

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'judged': 0, 'ok': 0, 'suspect': 0, 'wrong': 0, 'batches': 0, 'failed': 0}

def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'temperature': 0.1, 'max_tokens': 16000,
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

def arr_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip(); a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try: return json.loads(s[a:b + 1])
            except Exception: pass
    return None

def do_batch(facts):
    fid0 = facts[0]['id']
    payload = [{'id': f['id'], 'domain': f['domain'], 'en': f['en']} for f in facts]
    try:
        c, rc, pin, pout = call(HEAD + json.dumps(payload, ensure_ascii=False))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  FAIL {fid0}: {type(e).__name__}', flush=True); return
    arr = arr_from(c, rc) or []
    valid_ids = {f['id'] for f in facts}
    rows = [{'id': o['id'], 'verdict': o.get('verdict', 'ok'), 'reason': o.get('reason', '')[:140]}
            for o in arr if isinstance(o, dict) and o.get('id') in valid_ids and o.get('verdict') in ('ok', 'suspect', 'wrong')]
    with open(os.path.join(OUT, f'verd-{fid0}.jsonl'), 'w') as f:
        for o in rows:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout; _stats['judged'] += len(rows); _stats['batches'] += 1
        for o in rows: _stats[o['verdict']] += 1
        if _stats['batches'] % 25 == 0:
            print(f"  ...{_stats['batches']} batches | judged {_stats['judged']} | ok {_stats['ok']} suspect {_stats['suspect']} wrong {_stats['wrong']} | {_stats['out']//1000}k out", flush=True)

def main():
    facts = [json.loads(l) for l in open(INP)]
    done = {os.path.basename(fn)[5:-6] for fn in glob.glob(os.path.join(OUT, 'verd-*.jsonl'))}
    remaining = [f for f in facts if f['id'] not in done]
    if LIMIT: remaining = remaining[:LIMIT]
    batches = [remaining[i:i + BATCH] for i in range(0, len(remaining), BATCH)]
    print(f'facts {len(facts)} | already-batched {len(done)} | verifying {len(remaining)} in {len(batches)} batches (size {BATCH}, conc {CONC}) via qwen3.7-plus', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_batch, b) for b in batches]): pass
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.88
    j = _stats['judged'] or 1
    print(f"\nDONE in {(time.time()-t0)/60:.1f} min | judged {_stats['judged']} | ok {_stats['ok']} ({_stats['ok']/j:.1%}) suspect {_stats['suspect']} wrong {_stats['wrong']} | failed {_stats['failed']}")
    print(f"tokens in/out {_stats['in']:,}/{_stats['out']:,} | est cost ~${cost:.2f}")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Label feed cards with the MATATAG competencies they serve (multi-label, up to 3, best first)
via Fireworks qwen3.7-plus. Why Fireworks: bulk (17k cards), pay-per-use, resumable, no Claude
context sees the Tagalog/Bisaya body-vocabulary rows (AUP). Validated against Claude seed labels
(rag/bank/competency-seed-labels.json) before a full run.

  set -a; source ./.env.local; set +a
  FW_LIMIT=150 python3 rag/pipeline/fw-label-competencies.py      # validation slice
  python3 rag/pipeline/fw-label-competencies.py                   # full feed pool (resumable)
Env: FW_INPUT (JSON array of {id, domain, fact_en}; default = the whole card pool), FW_OUT dir,
FW_BATCH (15), FW_CONC (6), FW_LIMIT, FW_LIST (competency files glob).
"""
import os, json, glob, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.environ.get('FW_OUT', 'competency-labels'); OUT = OUT if os.path.isabs(OUT) else os.path.join(HERE, OUT); os.makedirs(OUT, exist_ok=True)  # relative = under rag/pipeline/
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/qwen3p7-plus')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'; KEY = os.environ['FIREWORKS_API_KEY']
BATCH = int(os.environ.get('FW_BATCH', '15')); CONC = int(os.environ.get('FW_CONC', '6')); LIMIT = int(os.environ.get('FW_LIMIT', '0'))
PRICE_IN, PRICE_OUT = float(os.environ.get('FW_PRICE_IN', '0.22')), float(os.environ.get('FW_PRICE_OUT', '0.88'))  # $/M tokens, ASSUMED — check the Fireworks bill
lines, codes = [], set()
for f in sorted(glob.glob(os.environ.get('FW_LIST', f'{ROOT}/rag/sources/curriculum-guides/matatag-*-competencies.json'))):
    for q in json.load(open(f))['quarters']:
        for c in q['competencies']:
            lines.append(f"{c['code']} [G{q['grade']} Q{q['quarter']} {q['domain']}]: {c['text']}"); codes.add(c['code'])
HEAD = ('You are tagging science fact cards for Filipino grade-school students with the DepEd MATATAG science competencies they serve. '
        'Judge what each fact TEACHES a child who reads it, not the words it uses (a cat retracting its claws teaches animal body parts and their use, G3-L-4 — not "ways to make objects move" because it says pull/push). '
        'Prefer competencies that name the concept explicitly, in whatever grade or domain (the domain field is a hint, not a constraint). '
        'Do NOT default to catch-alls (G3-L-6 basic needs, G3-M-1 natural events, G3-L-3 characteristics of living things, G3-M-4 process skills) unless the fact is specifically about that idea. '
        'A spiral curriculum revisits ideas across grades: list EVERY competency the fact genuinely serves, up to 3, best first. '
        'Use ["off"] only when no competency fits (non-science content, or content beyond Grade 10). confidence 1-3 for the first code (3 = names this concept, 2 = reasonable fit, 1 = forced).\n'
        'Reason briefly, then output ONLY the final JSON array, one object per card IN ORDER:\n[{"id":"<card id>","codes":["G5-M-2","G3-M-5"],"confidence":3}]\n\nCOMPETENCIES:\n' + '\n'.join(lines) + '\n\nCARDS:\n')
_lock = threading.Lock(); _stats = {'in': 0, 'out': 0, 'labeled': 0, 'off': 0, 'batches': 0, 'failed': 0}
def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'temperature': 0.1, 'max_tokens': 16000, 'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300)); m = r['choices'][0]['message']; u = r.get('usage', {})
        return (m.get('content') or '', m.get('reasoning_content') or '', u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 5:
            ra = e.headers.get('Retry-After'); time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1))); return call(prompt, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 5: time.sleep(min(90, 2 ** (attempt + 1))); return call(prompt, attempt + 1)
        raise
def arr_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip(); a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try: return json.loads(s[a:b + 1])
            except Exception: pass
    return None
def do_batch(cards):
    cid0 = cards[0]['id']
    try: c, rc, pin, pout = call(HEAD + json.dumps([{'id': x['id'], 'domain': x['domain'], 'fact': x['fact_en']} for x in cards], ensure_ascii=False))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  FAIL {cid0}: {type(e).__name__}', flush=True); return
    valid = {x['id'] for x in cards}; rows = []
    for o in (arr_from(c, rc) or []):
        if not isinstance(o, dict) or o.get('id') not in valid: continue
        cs = [k for k in (o.get('codes') or []) if k == 'off' or k in codes][:3]
        if not cs: continue
        if 'off' in cs and len(cs) > 1: cs = [k for k in cs if k != 'off']
        rows.append({'id': o['id'], 'codes': cs, 'confidence': int(o.get('confidence', 2) or 2)})
    with open(os.path.join(OUT, f'lab-{cid0}.jsonl'), 'w') as f:
        for o in rows: f.write(json.dumps(o, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout; _stats['labeled'] += len(rows); _stats['off'] += sum(1 for o in rows if o['codes'] == ['off']); _stats['batches'] += 1
        if _stats['batches'] % 25 == 0: print(f"  ...{_stats['batches']} batches | labeled {_stats['labeled']} | off {_stats['off']} | {_stats['in']//1000}k in {_stats['out']//1000}k out", flush=True)
def main():
    if os.environ.get('FW_INPUT'): cards = json.load(open(os.environ['FW_INPUT']))
    else: cards = [{'id': c['id'], 'domain': c['domain'], 'fact_en': c['fact']['en']} for c in json.load(open(f'{ROOT}/rag/pipeline/cardsPool.app.json'))['cards']]
    done = set()
    for fn in glob.glob(os.path.join(OUT, 'lab-*.jsonl')):
        for l in open(fn): done.add(json.loads(l)['id'])
    remaining = [x for x in cards if x['id'] not in done]
    if LIMIT: remaining = remaining[:LIMIT]
    batches = [remaining[i:i + BATCH] for i in range(0, len(remaining), BATCH)]
    print(f'cards {len(cards)} | already labeled {len(done)} | labeling {len(remaining)} in {len(batches)} batches (size {BATCH}, conc {CONC}) | {len(lines)} competencies | prompt head ~{len(HEAD)//4000}k tokens', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_batch, b) for b in batches]): pass
    cost = _stats['in'] / 1e6 * PRICE_IN + _stats['out'] / 1e6 * PRICE_OUT
    print(f"done in {time.time()-t0:.0f}s | batches {_stats['batches']} failed {_stats['failed']} | labeled {_stats['labeled']} off {_stats['off']} | tokens in {_stats['in']} out {_stats['out']} | est. cost ${cost:.2f} (at ${PRICE_IN}/${PRICE_OUT} per M, ASSUMED) → ${cost/max(_stats['labeled'],1)*1000:.2f} per 1,000 cards", flush=True)
if __name__ == '__main__': main()

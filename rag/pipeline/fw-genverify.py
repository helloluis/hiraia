#!/usr/bin/env python3
"""Generate + adversarially verify grade-5 MCQs from facts via Fireworks (qwen3.7-plus).

Reasoning model: Fireworks puts the chain-of-thought in `reasoning_content` and the clean
JSON in `content` (just needs enough max_tokens). The reasoning HELPS gen (distractor
calibration) + verify (catching accidentally-true distractors). Bypasses the Claude cap.

Resumable: skips a fact-batch whose kept-*.jsonl already exists. Thread-pooled w/ backoff.

  set -a; source ./.env.local; set +a
  FW_LIMIT=30 python3 rag/pipeline/fw-genverify.py     # validation slice
  python3 rag/pipeline/fw-genverify.py                 # full batch E
"""
import os, json, glob, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
FACTS = os.path.join(HERE, 'quiz-batchE-facts.jsonl')
OUT = os.path.join(HERE, 'quiz-batchE')
MODEL = 'accounts/fireworks/models/qwen3p7-plus'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
GEN_BATCH = int(os.environ.get('FW_BATCH', '10'))
CONC = int(os.environ.get('FW_CONC', '6'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
os.makedirs(OUT, exist_ok=True)

TOPICS = ['Animals','Insects & Spiders','Sea Creatures & Fish','Birds','Plants','The Human Body','Health & Safety','Food & Nutrition','Life Cycles & Growth','Dinosaurs & Fossils','Space & Astronomy','Weather & Sky','Rocks, Volcanoes & Earthquakes','Water & the Water Cycle','Earth & Seasons','Magnets','Forces & Motion','Simple Machines & Tools','Energy & Electricity','Light & Sound','States of Matter','Materials & Things','Changes in Matter','Air & Gases','Recycling & the Environment','Philippine Places','Festivals & Landmarks','World Geography','Philippine Heroes & History','Flag, Anthem & Symbols','Government & Nation','Filipino Culture']

GEN_HEAD = '''You write ONE grade-5 multiple-choice quiz question per fact for a Filipino science tutor. Reason first, then output ONLY the final JSON array.

For EACH fact: a clear single-sentence English question answerable from the fact (do NOT reference "the fact"); EXACTLY 4 options where one is correct and the other three are PLAUSIBLE, same-category, grade-5-level distractors that are NEVER accidentally true (tap a real misconception, not another true statement); answer = 0-based index of the correct option; a one-sentence explanation; difficulty 0 (easy) / 1 / 2 (hard); factId and domain copied from the fact; quizTopic = the single best fit from this list: %s.

FINAL ANSWER = a JSON array, one object per fact IN ORDER, each exactly:
{"factId":"..","domain":"..","quizTopic":"..","q":"..","options":["a","b","c","d"],"answer":0,"explanation":"..","difficulty":1}
FACTS:
''' % json.dumps(TOPICS)

VER_HEAD = '''You are an ADVERSARIAL verifier of grade-5 MCQs. The worst error is a wrong answer marked correct; the most common cause is a DISTRACTOR THAT IS ALSO TRUE. For EACH question: ignore the marked answer, independently decide which option(s) are defensibly correct, then KEEP only if EXACTLY ONE is correct AND it equals the "answer" index AND it is sound grade-5 science AND the question is unambiguous AND the 3 distractors are plausible-but-clearly-wrong. REJECT otherwise. When in doubt, REJECT.

Reason first, then output ONLY the final JSON array, one verdict per question IN ORDER:
{"factId":"..","keep":true,"reason":".."}   (reason short, e.g. "ok" / "distractor-also-true" / "wrong-key" / "ambiguous" / "multi-correct")
QUESTIONS:
'''

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'gen': 0, 'kept': 0, 'batches': 0, 'failed': 0}

def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'temperature': 0.3, 'max_tokens': 20000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300))
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
        s = (c or '').strip()
        a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try: return json.loads(s[a:b + 1])
            except Exception: pass
    return None

def valid_q(o):
    return (isinstance(o, dict) and o.get('factId') and o.get('q') and isinstance(o.get('options'), list)
            and len(o['options']) == 4 and isinstance(o.get('answer'), int) and 0 <= o['answer'] <= 3
            and o.get('explanation') and o.get('quizTopic') in TOPICS and o.get('difficulty') in (0, 1, 2))

def do_batch(facts):
    fid0 = facts[0]['id']
    payload = [{'id': f['id'], 'domain': f['domain'], 'en': f['en']} for f in facts]
    try:
        c, rc, pin, pout = call(GEN_HEAD + json.dumps(payload, ensure_ascii=False))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  gen FAIL {fid0}: {type(e).__name__}', flush=True); return
    gen = [o for o in (arr_from(c, rc) or []) if valid_q(o)]
    if not gen:
        with _lock: _stats['failed'] += 1
        return
    try:
        c2, rc2, pin2, pout2 = call(VER_HEAD + json.dumps(gen, ensure_ascii=False))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  ver FAIL {fid0}: {type(e).__name__}', flush=True); return
    verds = arr_from(c2, rc2) or []
    keepset = {v.get('factId') for v in verds if isinstance(v, dict) and v.get('keep') is True}
    kept = [o for o in gen if o['factId'] in keepset]
    with open(os.path.join(OUT, f'kept-{fid0}.jsonl'), 'w') as f:
        for o in kept:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin + pin2; _stats['out'] += pout + pout2
        _stats['gen'] += len(gen); _stats['kept'] += len(kept); _stats['batches'] += 1
        if _stats['batches'] % 15 == 0:
            print(f'  ...{_stats["batches"]} batches | gen {_stats["gen"]}, kept {_stats["kept"]} | {_stats["out"]//1000}k out tok', flush=True)

def main():
    facts = [json.loads(l) for l in open(FACTS)]
    done = set()
    for fn in glob.glob(os.path.join(OUT, 'kept-*.jsonl')):
        done.add(os.path.basename(fn)[5:-6])  # factId in filename
    remaining = [f for f in facts if f['id'] not in done]
    if LIMIT: remaining = remaining[:LIMIT]
    batches = [remaining[i:i + GEN_BATCH] for i in range(0, len(remaining), GEN_BATCH)]
    print(f'facts {len(facts)} | already-batched {len(done)} | generating {len(remaining)} in {len(batches)} batches '
          f'(size {GEN_BATCH}, conc {CONC}) via {MODEL.split("/")[-1]}', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_batch, b) for b in batches]
        for _ in as_completed(futs): pass
    dt = time.time() - t0
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.88  # rough qwen-plus rate
    kr = _stats['kept'] / _stats['gen'] if _stats['gen'] else 0
    print(f'\nDONE in {dt/60:.1f} min | generated {_stats["gen"]} | kept {_stats["kept"]} ({kr:.1%}) | failed batches {_stats["failed"]}')
    print(f'tokens in/out: {_stats["in"]:,}/{_stats["out"]:,} | est cost ~${cost:.2f}')

if __name__ == '__main__':
    main()

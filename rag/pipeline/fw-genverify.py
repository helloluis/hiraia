#!/usr/bin/env python3
"""Generate + adversarially verify MCQs from facts via Fireworks (qwen3.7-plus), pitched at
each fact's own grade band (grades from the fact row or rag/bank/science-facts.jsonl; grade 5 if unknown).

Reasoning model: Fireworks puts the chain-of-thought in `reasoning_content` and the clean
JSON in `content` (just needs enough max_tokens). The reasoning HELPS gen (distractor
calibration) + verify (catching accidentally-true distractors). Bypasses the Claude cap.

Resumable: every processed fact is recorded in OUT/verdicts-*.jsonl (kept / rejected +
reason); a re-run skips those and re-batches only never-answered facts (failed calls,
items the generator dropped). Thread-pooled w/ backoff. Each run appends its token
ledger to OUT/ledger.jsonl (also on Ctrl-C, flagged partial).

  set -a; source ./.env.local; set +a
  FW_DRY=1 python3 rag/pipeline/fw-genverify.py        # plan only (done / remaining), no calls
  FW_LIMIT=30 python3 rag/pipeline/fw-genverify.py     # validation slice
  python3 rag/pipeline/fw-genverify.py                 # full batch E
  FW_FACTS=rag/pipeline/quiz-lane-facts.json FW_OUT=rag/pipeline/quiz-lane/gen \
      python3 rag/pipeline/fw-genverify.py             # another lane (.json array or .jsonl)
"""
import os, json, glob, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
FACTS = os.path.abspath(os.environ['FW_FACTS']) if os.environ.get('FW_FACTS') else os.path.join(HERE, 'quiz-batchE-facts.jsonl')
OUT = os.path.abspath(os.environ['FW_OUT']) if os.environ.get('FW_OUT') else os.path.join(HERE, 'quiz-batchE')
MODEL = 'accounts/fireworks/models/qwen3p7-plus'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
GEN_BATCH = int(os.environ.get('FW_BATCH', '10'))
CONC = int(os.environ.get('FW_CONC', '6'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
DRY = bool(os.environ.get('FW_DRY'))  # print the plan and exit without calling Fireworks
GRADES_SRC = os.path.join(HERE, '..', 'bank', 'science-facts.jsonl')  # grade band per fact id when the lane rows carry none
os.makedirs(OUT, exist_ok=True)

TOPICS = ['Animals','Insects & Spiders','Sea Creatures & Fish','Birds','Plants','The Human Body','Health & Safety','Food & Nutrition','Life Cycles & Growth','Dinosaurs & Fossils','Space & Astronomy','Weather & Sky','Rocks, Volcanoes & Earthquakes','Water & the Water Cycle','Earth & Seasons','Magnets','Forces & Motion','Simple Machines & Tools','Energy & Electricity','Light & Sound','States of Matter','Materials & Things','Changes in Matter','Air & Gases','Recycling & the Environment','Philippine Places','Festivals & Landmarks','World Geography','Philippine Heroes & History','Flag, Anthem & Symbols','Government & Nation','Filipino Culture']

GEN_HEAD = '''You write ONE multiple-choice quiz question per fact for a Filipino science tutor (Philippine K-12). Each fact carries "grades" = the grade levels it is taught at; pitch the question, its vocabulary and its distractors at THAT grade band (grade 5 if grades are missing) — never simplify away or skip a fact for being above grade 5 when its grades say so. Reason first, then output ONLY the final JSON array.

For EACH fact: a clear single-sentence English question answerable from the fact (do NOT reference "the fact"); EXACTLY 4 options where one is correct and the other three are PLAUSIBLE, same-category, grade-band-level distractors that are NEVER accidentally true (tap a real misconception, not another true statement); answer = 0-based index of the correct option; a one-sentence explanation; difficulty 0 (easy) / 1 / 2 (hard); factId and domain copied from the fact; quizTopic = the single best fit from this list: %s.

FINAL ANSWER = a JSON array, one object per fact IN ORDER, each exactly:
{"factId":"..","domain":"..","quizTopic":"..","q":"..","options":["a","b","c","d"],"answer":0,"explanation":"..","difficulty":1}
FACTS:
''' % json.dumps(TOPICS)

VER_HEAD = '''You are an ADVERSARIAL verifier of school-science MCQs (Philippine K-12). Each question carries "grades" = the grade band it is meant for; judge it against THAT band (a grade-8 item against grade 8, not grade 5 — being above grade 5 is NOT a reason to reject). The worst error is a wrong answer marked correct; the most common cause is a DISTRACTOR THAT IS ALSO TRUE. For EACH question: ignore the marked answer, independently decide which option(s) are defensibly correct, then KEEP only if EXACTLY ONE is correct AND it equals the "answer" index AND it is sound science at its grade band AND the question is unambiguous AND the 3 distractors are plausible-but-clearly-wrong. REJECT otherwise. When in doubt, REJECT.

Reason first, then output ONLY the final JSON array, one verdict per question IN ORDER:
{"factId":"..","keep":true,"reason":".."}   (reason short, e.g. "ok" / "distractor-also-true" / "wrong-key" / "ambiguous" / "multi-correct")
QUESTIONS:
'''

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'gen': 0, 'kept': 0, 'batches': 0, 'failed': 0, 'rejected': 0, 'dropped': 0}

def load_facts(path):
    with open(path) as f:
        facts = json.load(f) if path.endswith('.json') else [json.loads(l) for l in f if l.strip()]
    if any(not f.get('grades') for f in facts) and os.path.exists(GRADES_SRC):  # lane rows carry only id/domain/en
        ids = {f['id'] for f in facts}
        grades = {}
        for l in open(GRADES_SRC):
            if l.strip():
                r = json.loads(l)
                if r['id'] in ids and r.get('grades'): grades[r['id']] = r['grades']
        for f in facts:
            f.setdefault('grades', grades.get(f['id']) or [5])
    return facts

def done_factids():
    """Facts already answered. Dirs with verdicts-*.jsonl: kept|rejected rows (not-generated and
    failed batches are retried). Legacy dirs without verdicts: kept-*.jsonl rows plus the batch's
    first factId in the filename (the only record those runs left of a batch)."""
    done = set()
    verdict_files = glob.glob(os.path.join(OUT, 'verdicts-*.jsonl'))
    for fn in verdict_files:
        for l in open(fn):
            if l.strip():
                v = json.loads(l)
                if v.get('status') in ('kept', 'rejected'): done.add(v['factId'])
    for fn in glob.glob(os.path.join(OUT, 'kept-*.jsonl')):
        if not verdict_files: done.add(os.path.basename(fn)[5:-6])  # legacy only: with verdicts, a dropped first fact must be retried
        for l in open(fn):
            if l.strip(): done.add(json.loads(l)['factId'])
    return done

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
    grades = {f['id']: f.get('grades') or [5] for f in facts}
    payload = [{'id': f['id'], 'domain': f['domain'], 'grades': grades[f['id']], 'en': f['en']} for f in facts]
    try:
        c, rc, pin, pout = call(GEN_HEAD + json.dumps(payload, ensure_ascii=False))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  gen FAIL {fid0}: {type(e).__name__}', flush=True); return
    batch_ids = {f['id'] for f in facts}
    gen = [o for o in (arr_from(c, rc) or []) if valid_q(o) and o['factId'] in batch_ids]  # drop mangled/hallucinated ids
    if not gen:
        with _lock: _stats['failed'] += 1
        return
    try:
        c2, rc2, pin2, pout2 = call(VER_HEAD + json.dumps([{**o, 'grades': grades[o['factId']]} for o in gen], ensure_ascii=False))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  ver FAIL {fid0}: {type(e).__name__}', flush=True); return
    verds = arr_from(c2, rc2) or []
    if not verds:  # verifier output unparseable -> treat as a failed batch (retry on re-run), not as 'all rejected'
        with _lock: _stats['failed'] += 1
        print(f'  ver PARSE-FAIL {fid0}', flush=True); return
    keepset = {v.get('factId') for v in verds if isinstance(v, dict) and v.get('keep') is True}
    reasons = {v.get('factId'): str(v.get('reason', ''))[:80] for v in verds if isinstance(v, dict)}
    kept = [o for o in gen if o['factId'] in keepset]
    genset = {o['factId'] for o in gen}
    # append (not overwrite): a re-run only ever re-batches never-answered facts, so an
    # existing file of the same name belongs to a different, earlier batch
    with open(os.path.join(OUT, f'kept-{fid0}.jsonl'), 'a') as f:
        for o in kept:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    with open(os.path.join(OUT, f'verdicts-{fid0}.jsonl'), 'a') as f:
        for fact in facts:
            fid = fact['id']
            status = 'kept' if fid in keepset else ('rejected' if fid in genset else 'not-generated')
            f.write(json.dumps({'factId': fid, 'domain': fact.get('domain'), 'status': status,
                                'reason': reasons.get(fid, '') if status == 'rejected' else ''}) + '\n')
    with _lock:
        _stats['in'] += pin + pin2; _stats['out'] += pout + pout2
        _stats['gen'] += len(gen); _stats['kept'] += len(kept); _stats['batches'] += 1
        _stats['rejected'] += len(gen) - len(kept); _stats['dropped'] += len(facts) - len(gen)
        if _stats['batches'] % 15 == 0:
            print(f'  ...{_stats["batches"]} batches | gen {_stats["gen"]}, kept {_stats["kept"]} | {_stats["out"]//1000}k out tok', flush=True)
            with open(os.path.join(OUT, 'progress.json'), 'w') as f:  # live snapshot so a killed run keeps its token counts
                json.dump({'when': time.strftime('%Y-%m-%dT%H:%M:%S'), **_stats}, f)

def main():
    facts = load_facts(FACTS)
    done = done_factids()
    remaining = [f for f in facts if f['id'] not in done]
    if LIMIT: remaining = remaining[:LIMIT]
    batches = [remaining[i:i + GEN_BATCH] for i in range(0, len(remaining), GEN_BATCH)]
    print(f'facts {len(facts)} | already-batched {len(done)} | generating {len(remaining)} in {len(batches)} batches '
          f'(size {GEN_BATCH}, conc {CONC}) via {MODEL.split("/")[-1]}', flush=True)
    if DRY: return
    t0 = time.time()
    partial = False
    try:
        with ThreadPoolExecutor(max_workers=CONC) as ex:
            futs = [ex.submit(do_batch, b) for b in batches]
            for _ in as_completed(futs): pass
    except KeyboardInterrupt:  # still ledger what was spent (the run's only cost record)
        partial = True
        print('\ninterrupted — ledgering the batches finished so far', flush=True)
    dt = time.time() - t0
    cost = _stats['in'] / 1e6 * 0.40 + _stats['out'] / 1e6 * 1.60  # qwen3.7-plus Standard tier (docs.fireworks.ai/serverless/pricing, 2026-08-28)
    kr = _stats['kept'] / _stats['gen'] if _stats['gen'] else 0
    print(f'\nDONE in {dt/60:.1f} min | generated {_stats["gen"]} | kept {_stats["kept"]} ({kr:.1%}) | '
          f'rejected {_stats["rejected"]} | dropped-by-gen {_stats["dropped"]} | failed batches {_stats["failed"]}')
    print(f'tokens in/out: {_stats["in"]:,}/{_stats["out"]:,} | est cost ~${cost:.2f}')
    with open(os.path.join(OUT, 'ledger.jsonl'), 'a') as f:
        f.write(json.dumps({'when': time.strftime('%Y-%m-%dT%H:%M:%S'), 'model': MODEL.split('/')[-1], 'facts_attempted': len(remaining),
                            'batches': _stats['batches'], 'failed': _stats['failed'], 'gen': _stats['gen'], 'kept': _stats['kept'],
                            'rejected': _stats['rejected'], 'dropped': _stats['dropped'], 'tok_in': _stats['in'], 'tok_out': _stats['out'],
                            'est_cost_usd': round(cost, 4), 'rate_in_per_M': 0.40, 'rate_out_per_M': 1.60, 'minutes': round(dt / 60, 1),
                            **({'partial': True} if partial else {})}) + '\n')

if __name__ == '__main__':
    main()

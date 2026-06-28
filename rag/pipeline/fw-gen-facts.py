#!/usr/bin/env python3
"""Generate candidate grade-5 science facts via Fireworks (qwen3.7-plus), weighted to
thin domains, with rotating "angles" to force diversity. Output = candidate facts;
dedup-vs-existing (LaBSE) + verify + translate happen in later steps.

  set -a; source ./.env.local; set +a
  FW_LIMIT=4 python3 rag/pipeline/fw-gen-facts.py     # validation: 4 calls
  python3 rag/pipeline/fw-gen-facts.py                # full targets
"""
import os, json, glob, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fact-candidates')
MODEL = 'accounts/fireworks/models/qwen3p7-plus'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
CONC = int(os.environ.get('FW_CONC', '6'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
PER_CALL = 12
os.makedirs(OUT, exist_ok=True)

# target NEW facts per domain (oversample ~1.6x to survive dedup+verify) -> ~10k kept
TARGETS = {'PH_GEOGRAPHY': 2500, 'PH_CIVICS': 2500, 'EARTH_SPACE': 1500,
           'FORCE_MOTION_ENERGY': 1500, 'MATTER': 1500, 'LIVING_THINGS': 500}
OVERSAMPLE = 1.6

ANGLES = [
    'Philippine-specific examples (places, plants, animals, people, everyday Filipino life)',
    'how something works — a clear cause-and-effect process',
    'a surprising or "wow" fact that is still true and grade-5 appropriate',
    'comparisons and concrete numbers (sizes, distances, counts, records)',
    'a common misconception, stated as the CORRECT fact',
    'practical / safety / health angle a 10-year-old can use',
    'something observable in nature or the local environment',
    'a specific named example (a species, landmark, hero, invention, place)',
]
DOMAIN_HINT = {
    'PH_GEOGRAPHY': 'Philippine geography: regions, provinces, islands, mountains, volcanoes, rivers, lakes, seas, climate, natural resources, biodiversity, landmarks, national parks',
    'PH_CIVICS': 'Philippine civics & culture: heroes, history, independence, branches of government, rights and duties, national symbols, festivals, indigenous peoples, languages, values, Filipino scientists and artists',
    'EARTH_SPACE': 'earth & space science: weather, climate, soil, rocks and minerals, the water cycle, the solar system, stars, the moon, natural hazards',
    'FORCE_MOTION_ENERGY': 'force, motion & energy: simple machines, friction, gravity, magnets, electricity, light, sound, heat, forms of energy',
    'MATTER': 'matter: properties, states (solid/liquid/gas), physical and chemical changes, mixtures and solutions, common materials',
    'LIVING_THINGS': 'living things: plants, animals, the human body, life cycles, ecosystems, adaptations, health',
}

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'cands': 0, 'calls': 0, 'failed': 0}

def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'temperature': 0.7, 'max_tokens': 16000,
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

def prompt_for(domain, angle):
    return f'''Write {PER_CALL} DISTINCT, SPECIFIC, factually-correct science facts for a Filipino grade-5 (10-year-old) tutor's knowledge bank. Domain: {DOMAIN_HINT[domain]}.
This batch's angle: {angle}.
Rules: each fact is ONE clear English sentence (<=30 words), specific and verifiable (not vague/generic), grade-5 appropriate, and DIFFERENT from the others. Prefer concrete named examples. No duplicates, no opinions.
Reason first, then output ONLY the final JSON array, each object:
{{"topic":"short label","en":"the one-sentence fact","grades":[5]}}'''

def do_call(domain, idx):
    angle = ANGLES[idx % len(ANGLES)]
    try:
        c, rc, pin, pout = call(prompt_for(domain, angle))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  FAIL {domain}#{idx}: {type(e).__name__}', flush=True); return
    arr = arr_from(c, rc) or []
    rows = [{'domain': domain, 'topic': str(o.get('topic', ''))[:80], 'en': str(o.get('en', '')).strip(),
             'grades': o.get('grades', [5]) if isinstance(o.get('grades'), list) else [5]}
            for o in arr if isinstance(o, dict) and o.get('en') and len(str(o['en'])) > 15]
    with open(os.path.join(OUT, f'cand-{domain}-{idx}.jsonl'), 'w') as f:
        for o in rows:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout; _stats['cands'] += len(rows); _stats['calls'] += 1
        if _stats['calls'] % 20 == 0:
            print(f"  ...{_stats['calls']} calls | {_stats['cands']} candidates | {_stats['out']//1000}k out", flush=True)

def main():
    done = {os.path.basename(fn)[5:-6] for fn in glob.glob(os.path.join(OUT, 'cand-*.jsonl'))}  # "{domain}-{idx}"
    work = []
    for domain, target in TARGETS.items():
        ncalls = int((target * OVERSAMPLE) / PER_CALL) + 1
        for idx in range(ncalls):
            if f'{domain}-{idx}' not in done:
                work.append((domain, idx))
    if LIMIT: work = work[:LIMIT]
    print(f'generating: {len(work)} calls × {PER_CALL} (conc {CONC}) via qwen3.7-plus', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_call, d, i) for d, i in work]): pass
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.88
    print(f"\nDONE in {(time.time()-t0)/60:.1f} min | {_stats['cands']} candidates from {_stats['calls']} calls | failed {_stats['failed']}")
    print(f"tokens in/out {_stats['in']:,}/{_stats['out']:,} | est cost ~${cost:.2f}")

if __name__ == '__main__':
    main()

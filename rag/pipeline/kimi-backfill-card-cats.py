#!/usr/bin/env python3
"""Backfill 1-2 taxonomy cats on the ~19.5k uncategorized ffct cards (CARD-CATS-BACKFILL-SPEC).

Kimi edition: same job the spec routes to Fireworks, but on the kimi.ai/code subscription
(kimi-for-coding = K2.7). The subscription's constraint is a RATE WINDOW — roughly 300-1200
requests per rolling 5 hours — which previous runs hit as mid-run timeouts/empty responses.
This driver treats the window as a first-class budget:

  * a request LEDGER on disk (ledger.json): every API call is appended with its timestamp,
    so the rolling-window count survives restarts and multiple processes
  * before each call: if the last-5h count is within SAFETY_MARGIN of WINDOW_MAX, the
    driver SLEEPS until the oldest call in the window ages out — pacing, not failure
  * empty/5xx/timeout responses retry with backoff as before; a shard that exhausts
    retries leaves nothing written (zero-byte = unfinished) and is picked up on the next run

Resume is by CARD ID, not shard index (the pool can be re-ordered between runs).

  KIMI_API_KEY=... python3 kimi-backfill-card-cats.py            # first pass
  KIMI_API_KEY=... GAP=1 python3 kimi-backfill-card-cats.py      # gap-fill until 0 missing
  KIMI_API_KEY=... LIMIT=200 python3 kimi-backfill-card-cats.py  # dry-run slice
Env: MODEL, URL, PER_CALL(20), CONC(4), WINDOW_MAX(900), WINDOW_HOURS(5), SAFETY_MARGIN(50)
"""
import os, json, time, threading, glob, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
TAX = os.path.join(ROOT, 'rag/pipeline/card-taxonomy.json')
OUT = os.path.join(HERE, 'card-cats')
LEDGER = os.path.join(OUT, 'ledger.json')
URL = os.environ.get('URL', 'https://api.kimi.com/coding/v1/chat/completions')
MODEL = os.environ.get('MODEL', 'kimi-for-coding')
KEY = os.environ['KIMI_API_KEY']
PER_CALL = int(os.environ.get('PER_CALL', '20'))
CONC = int(os.environ.get('CONC', '4'))
WINDOW_HOURS = float(os.environ.get('WINDOW_HOURS', '5'))
WINDOW_MAX = int(os.environ.get('WINDOW_MAX', '900'))       # conservative end of the 300-1200 band
SAFETY_MARGIN = int(os.environ.get('SAFETY_MARGIN', '50'))
LIMIT = int(os.environ.get('LIMIT', '0')) or None

valid_ids = {l['id'] for l in json.load(open(TAX))['leaves']}

# ---------------- the rate-window ledger ----------------
ledger_lock = threading.Lock()

def _load_ledger():
    try:
        return json.load(open(LEDGER))
    except Exception:
        return []

def _window(ts, now=None):
    """Timestamps inside the rolling window, oldest first."""
    now = now if now is not None else time.time()
    horizon = now - WINDOW_HOURS * 3600
    return [t for t in ts if t > horizon]

def reserve_slot():
    """Block until a call fits the window; append its timestamp. Thread-safe."""
    while True:
        with ledger_lock:
            now = time.time()
            ts = _window(_load_ledger(), now)
            if len(ts) < WINDOW_MAX - SAFETY_MARGIN:
                ts.append(now)
                # compact: keep only the current window + write atomically-ish
                tmp = LEDGER + '.tmp'
                with open(tmp, 'w') as f:
                    json.dump(ts, f)
                os.replace(tmp, LEDGER)
                return
            # window full: sleep until the OLDEST entry ages out (plus a slack minute)
            wait = (ts[0] + WINDOW_HOURS * 3600) - now + 60
        print(f"  [window] rate window near limit ({WINDOW_MAX - SAFETY_MARGIN}); sleeping {wait/60:.0f}m", flush=True)
        time.sleep(min(wait, 900))  # re-check at least every 15 min

# ---------------- the API call ----------------
def call(prompt, max_tokens=8000, retries=6):
    body = json.dumps({
        'model': MODEL,
        'temperature': 1,  # kimi.ai/code only allows temperature=1 (validated: 400 otherwise)
        'max_tokens': max_tokens,
        'messages': [{'role': 'user', 'content': prompt}],
    }).encode()
    last = None
    for attempt in range(retries):
        reserve_slot()
        req = urllib.request.Request(URL, data=body, headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {KEY}',
        })
        try:
            # 90s, not 300: a stalled read must fail fast so the retry/backoff can take over —
            # long socket timeouts let threads park indefinitely (three hangs observed at ~600 cards)
            with urllib.request.urlopen(req, timeout=90) as r:
                text = json.loads(r.read())['choices'][0]['message']['content'].strip()
                if text:
                    return text
                last = RuntimeError('empty response (rate window?)')
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 ** attempt * 5)
    raise RuntimeError(f'Kimi call failed after {retries} retries: {last}')

def extract_json(text):
    if text.startswith('```'):
        text = text.split('\n', 1)[1] if '\n' in text else text
        text = text.rsplit('```', 1)[0]
    start = text.find('{')
    end = text.rfind('}')
    return json.loads(text[start:end + 1])

# ---------------- the prompt (spec §3: cats only, English inputs only) ----------------
LADDER = '\n'.join(
    f"{l['id']}  ({l.get('label_en','')})" for l in json.load(open(TAX))['leaves']
)

def prompt_for(cards):
    lines = []
    for i, c in enumerate(cards):
        fact_en = (c.get('fact') or {}).get('en') or ''
        lines.append(f"[{i}] topic: {c['topic']}")
        if fact_en:
            lines.append(f"    fact: {fact_en[:160]}")
    return (
        'You are categorizing science cards for a Filipino grade-school deck. Assign each card '
        '1 or 2 categories from this fixed ladder of 108 (id  (label)):\n\n' + LADDER + '\n\n'
        'Rules: choose the MOST SPECIFIC leaf that fits; add a second id only when the card '
        'genuinely straddles two (a bird beak adaptation -> birds + animal-adaptations). '
        'Never invent an id — use exactly the ids above. NEVER return empty cats: if unsure, '
        'pick the closest BROADER leaf from the ladder (a physics card you cannot place -> '
        'forces or energy; an unclear animal -> the closest animal leaf). Every card gets 1-2 ids.\n\n'
        'Reason briefly, then output ONLY JSON: {"out":[{"i":0,"cats":["..."]}]} '
        'with one entry per input card, in order.\n\nCARDS:\n' + '\n'.join(lines)
    )

# ---------------- shard IO (resume by card id, not index) ----------------
def done_ids():
    done = set()
    for f in glob.glob(os.path.join(OUT, 'cats-*.jsonl')):
        if os.path.getsize(f) == 0:
            os.remove(f)  # zero-byte = unfinished, retried
            continue
        for line in open(f):
            if line.strip():
                try:
                    done.add(json.loads(line)['id'])
                except Exception:
                    pass
    return done

def next_shard_idx():
    n = 0
    while os.path.exists(os.path.join(OUT, f'cats-{n:05d}.jsonl')):
        n += 1
    return n

invalid_written = 0

def process(cards):
    global invalid_written
    raw = call(prompt_for(cards))
    out = extract_json(raw).get('out', [])
    rows = []
    for r in out:
        i = r.get('i')
        if not isinstance(i, int) or not (0 <= i < len(cards)):
            continue
        cats = [c for c in (r.get('cats') or []) if c in valid_ids]
        cats = list(dict.fromkeys(cats))[:2]  # dedupe, cap at 2
        if not cats:
            invalid_written += 1
            continue
        rows.append({'id': cards[i]['id'], 'cats': cats})
    return rows

def main():
    os.makedirs(OUT, exist_ok=True)
    pool = json.load(open(POOL))
    todo = [c for c in pool['cards'] if not c.get('cats')]
    if os.environ.get('GAP') == '1':
        already = done_ids()
        todo = [c for c in todo if c['id'] not in already]
    if LIMIT:
        step = max(1, len(todo) // LIMIT)
        todo = todo[::step][:LIMIT]
    done = done_ids()
    todo = [c for c in todo if c['id'] not in done]
    print(f'{len(todo)} cards to categorize | model={MODEL} conc={CONC} window={WINDOW_MAX}/{WINDOW_HOURS}h', flush=True)
    if not todo:
        print('nothing to do'); return

    lock = threading.Lock()
    completed = [0]
    batches = [todo[i:i + PER_CALL] for i in range(0, len(todo), PER_CALL)]
    t0 = time.time()

    def run(batch):
        rows = process(batch)
        idx = next_shard_idx()
        with open(os.path.join(OUT, f'cats-{idx:05d}.jsonl'), 'w') as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')
        with lock:
            completed[0] += len(batch)
            n = completed[0]
            if n % 200 < PER_CALL:
                rate = n / max(time.time() - t0, 1) * 60
                print(f'  {n}/{len(todo)} cards | {rate:.0f}/min | invalid-so-far {invalid_written}', flush=True)

    errors = 0
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(run, b) for b in batches]
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                errors += 1
                print(f'  batch failed: {e}', flush=True)
    print(f'DONE. {completed[0]} cards written | {errors} batch failures | invalid {invalid_written}')
    print(f'shards in {OUT} — gap-fill with GAP=1 until it reports 0')

if __name__ == '__main__':
    main()

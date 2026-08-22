#!/usr/bin/env python3
"""STAGE 2 of the card-title/taxonomy pass: give every card a SHORT display TITLE and assign it
to leaves of the controlled taxonomy.

Why titles exist: the card's index band currently prints the raw `topic`, which truncates
mid-word on most cards ("EELS SPAWN ONCE IN THE D...", "EAR HAS OUTER MIDDLE IN..." — topic
median is 33 chars and the band fits ~27). The topic also just restates the body text sitting
directly beneath it, so the widest, heaviest type in the design was carrying zero information.
A title ("Eels & Eggs") is a LABEL, not a summary.

Why categories come from the same pass: next-card navigation should go UP the stack ("other
marine animals") rather than sideways by keyword. Assignment must draw on a CONTROLLED
vocabulary — card-taxonomy.json, derived by fw-derive-card-taxonomy.py — because 16,948
independent label inventions would yield thousands of near-synonyms and "other <category>"
could never group anything.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-gen-card-titles.py                 # all 16,948
  FW_LIMIT=200 python3 rag/pipeline/fw-gen-card-titles.py    # a pilot slice

Env: FW_MODEL, FW_CONC, FW_PER_CALL, FW_LIMIT, FW_GEN_TPM.
Resumable: finished shards are skipped, and a ZERO-BYTE shard counts as unfinished (a failed
call leaves one behind, and existence-only resume would skip it forever).
"""
import os, json, glob, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'packages/mobile/src/generated/cardsPool.generated.json')
TAX = os.path.join(HERE, 'card-taxonomy.json')
OUT = os.path.join(HERE, 'card-titles')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']

# deepseek-v4-flash beat qwen3p7-plus head-to-head on this exact task: qwen spent its whole
# token budget on reasoning and returned nothing parseable. Both reason, hence max_tokens.
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-flash-0731')
CONC = int(os.environ.get('FW_CONC', '24'))
PER_CALL = int(os.environ.get('FW_PER_CALL', '40'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))

# Fireworks rate limits by TOKENS PER MINUTE, not requests. Of the three ceilings, only
# Generated TPM binds us: the prompts are tiny (~60 tok/card) so at full tilt we use ~40k of
# the 5.4M uncached-prompt allowance, while OUTPUT is ~150-250 tok/card because the model
# reasons before answering. Ramping straight into the ceiling earns 429s and the adaptive
# limit then SHRINKS, so we pace below it deliberately rather than sprinting and backing off.
GEN_TPM = int(os.environ.get('FW_GEN_TPM', '190000'))  # ~88% of the 216k default ceiling
MAX_TOKENS = 16000

os.makedirs(OUT, exist_ok=True)
TITLE_MAX = 20  # characters; measured against the index band, which fits ~27 at 10.5px caps


class TokenBudget:
    """Sliding-window limiter over OBSERVED completion tokens.

    Pre-declaring a per-call estimate would be guesswork — reasoning length varies 3x between
    batches. Instead every worker charges the budget with what its call actually returned, and
    the next worker waits until the trailing 60s window has room. Self-correcting: a batch that
    reasons heavily slows the fleet automatically, without a hand-tuned concurrency number.
    """

    def __init__(self, tpm):
        self.tpm = tpm
        self.events = collections.deque()  # (timestamp, tokens)
        self.lock = threading.Lock()

    def _trim(self, now):
        while self.events and now - self.events[0][0] > 60:
            self.events.popleft()

    def acquire(self):
        while True:
            with self.lock:
                now = time.time()
                self._trim(now)
                used = sum(t for _, t in self.events)
                if used < self.tpm:
                    return
                wait = 60 - (now - self.events[0][0]) + 0.5
            time.sleep(max(0.5, wait))

    def charge(self, tokens):
        with self.lock:
            self.events.append((time.time(), tokens))


BUDGET = TokenBudget(GEN_TPM)
_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'cards': 0, 'calls': 0, 'failed': 0, 'retries': 0, 'badcat': 0, 'long': 0}


def call(prompt, attempt=0):
    BUDGET.acquire()
    body = json.dumps({'model': MODEL, 'temperature': 0.3, 'max_tokens': MAX_TOKENS,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=600))
        m = r['choices'][0]['message']
        u = r.get('usage', {})
        BUDGET.charge(u.get('completion_tokens', 0))
        return (m.get('content') or '', m.get('reasoning_content') or '',
                u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        # A 429 means we misjudged the window; honour Retry-After and let the budget catch up.
        # 412 belongs here: it looks like a client precondition error but is TRANSIENT on
        # this endpoint — a batch that 412s repeatedly succeeds unchanged moments later. It
        # was originally absent, so 27 batches (~875 cards) died on first contact without a
        # single retry, and the clustering fooled me into diagnosing a rate limit. It is not
        # one: they failed at 22k gen-tok/min, a ninth of the ceiling.
        if e.code in (412, 429, 500, 502, 503, 529) and attempt < 6:
            ra = e.headers.get('Retry-After')
            time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise


def obj_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip()
        a, b = s.find('{'), s.rfind('}')
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except Exception:
                pass
    return None


def prompt_for(batch, leaves):
    cards = '\n'.join(json.dumps({'i': i, 'topic': c['topic'], 'fact': c['fact']['en'][:160]},
                                 ensure_ascii=False) for i, c in enumerate(batch))
    cats = ', '.join(leaves)
    return f'''You are labelling science flash cards for Filipino children (about 10 years old).

For EACH card give:
1. A TITLE — the card's name, printed in a narrow band above the picture.
   * It MUST NAME THE SUBJECT. A child scanning the band has to know what the card is about.
     "Eels & Eggs" is right. "One Deep Goodbye" is WRONG — it never says eel.
   * Be INFORMATIVE, not poetic. No wordplay, no riddles, no mood pieces.
   * Do NOT restate the fact — the fact is printed directly below the title. Name the thing,
     do not summarise the sentence.
   * MAXIMUM {TITLE_MAX} characters including spaces. Shorter is better. 2-3 words.
   * Give it in English, Tagalog and Cebuano. Keep proper nouns and scientific names as-is.
2. CATS — 1 or 2 category ids, chosen ONLY from this fixed list. Never invent one:
{cats}

CARDS
{cards}

Reason briefly, then output ONLY JSON, one entry per card, same order:
{{"out":[{{"i":0,"title_en":"...","title_tl":"...","title_bis":"...","cats":["..."]}}]}}'''


def do_call(batch, idx, leaves, valid, tries=3):
    arr, pin, pout = [], 0, 0
    for a in range(tries):
        try:
            c, rc, pin, pout = call(prompt_for(batch, leaves))
        except Exception as e:
            with _lock:
                _stats['failed'] += 1
            # Log the HTTP code: a burst of these at the end of a long run is the adaptive
            # rate limit SHRINKING, not random flakiness, and 429 vs 5xx is the difference
            # between "slow down" and "retry later". Without the code the sweep is guesswork.
            code = getattr(e, 'code', '')
            print(f'  FAIL #{idx}: {type(e).__name__} {code}', flush=True)
            return
        got = obj_from(c, rc) or {}
        arr = got.get('out') or []
        if len(arr) >= len(batch) * 0.8:
            break
        # A short parse is retryable, not a silent zero: the model reasons at length and
        # intermittently truncates its JSON. Re-running the same batch usually parses.
        with _lock:
            _stats['retries'] += 1
        print(f'  #{idx} short parse ({len(arr)}/{len(batch)}) — retry {a + 1}/{tries}', flush=True)
        time.sleep(2 ** a)

    by_i = {o.get('i'): o for o in arr if isinstance(o, dict)}
    rows, bad, long_ = [], 0, 0
    for i, card in enumerate(batch):
        o = by_i.get(i) or {}
        t_en = (o.get('title_en') or '').strip()
        if not t_en:
            continue
        cats = [x for x in (o.get('cats') or []) if x in valid]
        bad += len([x for x in (o.get('cats') or []) if x not in valid])
        if len(t_en) > TITLE_MAX:
            long_ += 1
        rows.append({'id': card['id'], 'title_en': t_en[:TITLE_MAX].strip(),
                     'title_tl': (o.get('title_tl') or t_en).strip()[:TITLE_MAX].strip(),
                     'title_bis': (o.get('title_bis') or t_en).strip()[:TITLE_MAX].strip(),
                     'cats': cats})
    with open(os.path.join(OUT, f'titles-{idx}.jsonl'), 'w') as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout; _stats['cards'] += len(rows)
        _stats['calls'] += 1; _stats['badcat'] += bad; _stats['long'] += long_
        if _stats['calls'] % 25 == 0:
            el = (time.time() - _T0) / 60
            print(f"  ...{_stats['calls']} calls | {_stats['cards']} cards | "
                  f"{_stats['out'] / max(el, .01):,.0f} gen-tok/min | {el:.1f} min", flush=True)


_T0 = time.time()


def main():
    cards = json.load(open(POOL))['cards']
    leaves = [o['id'] for o in json.load(open(TAX))['leaves']]
    valid = set(leaves)
    if LIMIT:
        # stratify the pilot across domains so it is representative, not the head of the file
        by = collections.defaultdict(list)
        for c in cards:
            by[c['domain']].append(c)
        picked = []
        for dom, cs in sorted(by.items()):
            picked += cs[:max(1, round(LIMIT * len(cs) / len(cards)))]
        cards = picked
    if os.environ.get('FW_MISSING') == '1':
        # Gap-fill by CARD ID, not by shard index. Index-based resume assumes the pool has not
        # changed between runs; it did (16,948 -> 16,993 when illustrations were re-matched),
        # so shard N no longer covers the same cards and some gaps can never be reached.
        have = set()
        for f in glob.glob(os.path.join(OUT, 'titles-*.jsonl')):
            for line in open(f):
                if line.strip():
                    have.add(json.loads(line)['id'])
        cards = [c for c in cards if c['id'] not in have]
        print(f'MISSING mode: {len(cards)} untitled cards')
        batches = [cards[i:i + PER_CALL] for i in range(0, len(cards), PER_CALL)]
        # write into a distinct namespace so these never collide with the positional shards
        work = [(b, f'gap{i}') for i, b in enumerate(batches)]
    else:
        batches = [cards[i:i + PER_CALL] for i in range(0, len(cards), PER_CALL)]
        done = {os.path.basename(p) for p in glob.glob(os.path.join(OUT, 'titles-*.jsonl'))
                if os.path.getsize(p) > 0}
        work = [(b, i) for i, b in enumerate(batches) if f'titles-{i}.jsonl' not in done]
    print(f'{len(cards)} cards -> {len(batches)} batches ({PER_CALL}/call), {len(work)} to run')
    print(f'model {MODEL.split("/")[-1]} | conc {CONC} | gen budget {GEN_TPM:,} tok/min')
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_call, b, i, leaves, valid) for b, i in work]):
            pass
    el = (time.time() - _T0) / 60
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.88
    print(f"\nDONE in {el:.1f} min | {_stats['cards']} cards titled | calls {_stats['calls']} "
          f"| failed {_stats['failed']} | parse-retries {_stats['retries']}")
    print(f"  rejected out-of-vocabulary cats: {_stats['badcat']} | titles over {TITLE_MAX} chars: {_stats['long']}")
    print(f"  tokens in/out {_stats['in']:,}/{_stats['out']:,} "
          f"| avg gen {_stats['out'] / max(el, .01):,.0f} tok/min | est cost ~${cost:.2f}")


if __name__ == '__main__':
    main()

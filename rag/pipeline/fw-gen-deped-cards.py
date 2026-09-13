#!/usr/bin/env python3
"""STAGE C — write the card bank from the DepEd modules themselves.

Each call takes ONE module plus everything the earlier stages recovered about it (its real
topic, its curriculum coordinates, the concepts it teaches, the taxonomy shelf it sits on) and
returns that module's share of the bank, already in the app's card shape.

Grounding is the whole point of the rebuild. The previous bank was written from topic strings,
so it produced cards that referred to "the third law" without ever saying whose third law —
text that reads fluently and teaches nothing. Here the module text is in front of the model
and the rules below make self-containment a hard requirement rather than a style note.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-gen-deped-cards.py
  FW_LIMIT=6 python3 rag/pipeline/fw-gen-deped-cards.py          # small slice
  FW_THINKING=1 FW_LIMIT=6 python3 rag/pipeline/fw-gen-deped-cards.py   # A/B the reasoning

Writes one shard per module to deped-cards/<drive_id>.json, so the run resumes after any
interruption and a re-run costs nothing for work already done.

Env: FW_MODEL, FW_CONC, FW_LIMIT, FW_GEN_TPM, FW_CHARS, FW_THINKING.
"""
import os, json, glob, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
MODULES = os.path.join(HERE, 'deped-modules.jsonl')
PROFILES = os.path.join(HERE, 'module-profiles')
TAXONOMY = os.path.join(HERE, 'deped-taxonomy.json')
OUT = os.path.join(HERE, os.environ.get('FW_OUT', 'deped-cards'))
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']

MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '16'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
GEN_TPM = int(os.environ.get('FW_GEN_TPM', '170000'))
CHARS = int(os.environ.get('FW_CHARS', '26000'))
# Reasoning is billed as output at 2.5x the input rate and measured 81% of Stage A's spend,
# while changing its answers very little. Off by default; set FW_THINKING=1 to compare.
THINKING = os.environ.get('FW_THINKING') == '1'
MAX_TOKENS = 30000 if THINKING else 12000

os.makedirs(OUT, exist_ok=True)


class TokenBudget:
    def __init__(self, tpm):
        self.tpm, self.events, self.lock = tpm, collections.deque(), threading.Lock()

    def acquire(self):
        while True:
            with self.lock:
                now = time.time()
                while self.events and now - self.events[0][0] > 60:
                    self.events.popleft()
                if sum(t for _, t in self.events) < self.tpm:
                    return
                wait = 60 - (now - self.events[0][0]) + 0.5
            time.sleep(max(0.5, wait))

    def charge(self, n):
        with self.lock:
            self.events.append((time.time(), n))


BUDGET = TokenBudget(GEN_TPM)
_lock = threading.Lock()
_stats = collections.Counter()


class Fatal(Exception):
    """A sustained account stop; retrying cannot clear it."""


_fatal = threading.Event()


class Suspension:
    """Distinguishes a passing endpoint flap from a real account stop (see fw-profile-modules)."""

    def __init__(self, min_events=12, quiet_seconds=150):
        self.min_events, self.quiet_seconds = min_events, quiet_seconds
        self.events, self.last_ok, self.lock = 0, time.time(), threading.Lock()

    def ok(self):
        with self.lock:
            self.last_ok, self.events = time.time(), 0

    def hit(self, body):
        with self.lock:
            self.events += 1
            if (self.events >= self.min_events
                    and time.time() - self.last_ok > self.quiet_seconds
                    and not _fatal.is_set()):
                _fatal.set()
                print(f'\n  ACCOUNT STOPPED — aborting.\n  {body.strip()[:260]}\n', flush=True)
            return _fatal.is_set()


SUSPENSION = Suspension()


def call(prompt, attempt=0):
    if _fatal.is_set():
        raise Fatal('aborted')
    BUDGET.acquire()
    payload = {'model': MODEL, 'temperature': 0.3, 'max_tokens': MAX_TOKENS,
               'messages': [{'role': 'user', 'content': prompt}]}
    if not THINKING:
        payload['chat_template_kwargs'] = {'thinking': False}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=900))
        m, u = r['choices'][0]['message'], r.get('usage', {})
        SUSPENSION.ok()
        BUDGET.charge(u.get('completion_tokens', 0))
        return (m.get('content') or '', m.get('reasoning_content') or '',
                u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode(errors='replace')
        except Exception:
            pass
        if 'suspended' in body.lower() or 'spending limit' in body.lower():
            if SUSPENSION.hit(body):
                raise Fatal(body[:300])
            time.sleep(min(120, 8 * (attempt + 1)))
            if attempt < 12:
                return call(prompt, attempt + 1)
            raise
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


def obj_from(*cands):
    for c in cands:
        s = (c or '').strip()
        a, b = s.find('{'), s.rfind('}')
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except Exception:
                pass
    return None


def prompt_for(m, prof, leaf):
    n = max(3, min(40, prof['fact_capacity'] or 12))
    qa = max(1, round(n * 0.4))
    shelf = leaf['label_en'] if leaf else prof['topic']
    concepts = '\n'.join(f'  - {c}' for c in prof['key_concepts'])
    return f"""You are writing science cards for Filipino schoolchildren, from the Department of
Education module below. Every card must be something THIS module actually teaches.

THE MODULE
  grade: {m['grade']}   quarter: {m.get('quarter') or 'unstated'}
  topic: {prof['topic']}
  strand: {prof['strand']}
  shelf it belongs to: {shelf}
  competency: {m.get('competency') or 'none printed'}
  what it teaches:
{concepts}

Write {n} cards. Return STRICT JSON only:
{{"cards": [{{"topic": "...", "format": "qa" | "statement",
  "fact": {{"en": "...", "tl": "...", "bis": "..."}},
  "title": {{"en": "...", "tl": "...", "bis": "..."}},
  "terms": ["..."], "illustration": "..."}}]}}

TWO CARD FORMATS — write about {qa} of the {n} as "qa", the rest as "statement".

  "qa" — a question the child would actually wonder, then a blank line, then the answer.
  Put BOTH in the one fact string, separated by a blank line, in every language:
     en:  "Why don't oil and water mix?\n\nTheir tiny molecules don't stick to each
           other! So they separate, and the lighter oil floats on top."
     tl:  "Bakit hindi naghahalo ang langis at tubig?\n\nHindi magkadikit ang maliliit
           nilang molecule! Kaya naghihiwalay sila, at lumulutang ang mas magaan na langis."
  The question must be one a 10-year-old would really ask, and it often works best when it
  targets a misconception ("Do heavier coconuts fall faster?"). The answer may use one "!".
  Do NOT ask a question the card then fails to answer, and do not quiz the reader.

  "statement" — one sentence, about 20-30 words, stating a single concrete fact. Plain and
  warm. It may end in "!" when genuinely surprising, but not routinely.

Pick which format each card gets by what suits the fact: use "qa" when there is a real
question or misconception behind it, "statement" when the fact is simply worth knowing.

GLOSS EVERY TECHNICAL TERM — the rule that matters most.
  A card is read ALONE, with no lesson around it and nothing before it. If a card names a
  technical term, THE SAME CARD must say what it means, in the same breath.
    BAD:  "In an elastic collision, total kinetic energy remains constant."
    GOOD: "In an elastic collision, objects bounce apart without losing motion energy, so
           the total kinetic energy - the energy of movement - stays the same."
    BAD:  "A negative slope indicates the object's displacement is decreasing."
    GOOD: "When the line slopes downward, the object is heading back to where it started."
  Never write "the third law", "this process", "these organisms", "the experiment" or "the
  activity" without saying what they are. Never define a word using another word you have not
  explained ("a solvent dissolves a solute" teaches nothing).
  Prefer the concrete mechanism over the abstract label: say what actually happens.

LANGUAGE — all three are read by real children.
- tl: Tagalog, the primary language. Write it as a Filipino teacher would SPEAK it in class —
  not formal textbook Filipino, and not a word-by-word translation of the English.

  There are TWO kinds of English word and they are handled OPPOSITELY:

  (a) TECHNICAL / SCIENCE terms — KEEP THE ENGLISH. This is real classroom Taglish and it is
      correct: "microscope", "kinetic energy", "food chain", "litmus paper", "crystal
      lattice", "acceleration". Do NOT reach for a formal coinage nobody says ("mikroskopyo").
  (b) EVERYDAY words a Filipino child already knows in their own language — USE THE FILIPINO
      WORD. Never leave these in English:
        mountain -> bundok     lake -> lawa       waterfall -> talon    river -> ilog
        sea -> dagat           water -> tubig     soil/land -> lupa     leaf -> dahon
        stone -> bato          salt -> asin       iron -> bakal         copper -> tanso
        blood -> dugo          bone -> buto       heart -> puso         fish -> isda
      "Ang mountain ang pinakamataas na anyong lupa" is WRONG — no teacher says that.
      Write "Ang bundok ang pinakamataas na anyong lupa."

  The test: would a teacher say this English word out loud to a class? If yes (microscope),
  keep it. If they would obviously use the Filipino word (bundok), use it.
  Also avoid stiff calqued grammar and invented Taglish verbs: "minultiplika", never
  "pagmumultiply"; "ginagamit bilang", never "ginagamit na".
- en: English.
- bis: Cebuano/Bisaya. Real Cebuano grammar ("ug" not "at", "kini" not "ito", "dili" not
  "hindi"), and the SAME two-way rule: keep English science terms, but use the Cebuano
  everyday word — bukid, lanaw, busay, suba, dagat, tubig, yuta, bato, puthaw, dugo, isda.

TITLE — informative, naming the card's subject so a reader scanning a list knows what is
inside. 2-4 words, Title Case. Never a teaser, never a full sentence, never an abbreviation
that hides the subject.
  The tl and bis titles must be WRITTEN IN THOSE LANGUAGES, not the English title copied over.
  Technical terms stay English inside them ("Pormula ng Kinetic Energy"), but everyday words
  follow the same rule as the body: "Talon ng Tubig", never "Waterfall". If your tl title is
  identical to your en title, you have almost certainly failed to translate it.

TERMS — 4-9 short keywords a child or teacher would actually type to reach this card, mixing
English, Tagalog and Cebuano forms.

ILLUSTRATION — ONE sentence describing the single picture that would best help a child
understand THIS card. Concrete subject and what it is doing; no style instructions, no text or
labels in the image, no multi-panel scenes.

MODULE TEXT
{m['text'][:CHARS]}"""


_T0 = time.time()


def do_one(m, prof, leaf, tries=3):
    mid = m['drive_id']
    dst = os.path.join(OUT, f'{mid}.json')
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    got = None
    for a in range(tries):
        try:
            c, rc, pin, pout = call(prompt_for(m, prof, leaf))
        except Fatal:
            return
        except Exception as e:
            with _lock:
                _stats['failed'] += 1
            print(f'  FAIL {mid}: {type(e).__name__} {getattr(e, "code", "")}', flush=True)
            return
        got = obj_from(c, rc)
        if got and got.get('cards'):
            break
        with _lock:
            _stats['retries'] += 1
        time.sleep(2 ** a)
    if not got or not got.get('cards'):
        with _lock:
            _stats['failed'] += 1
        return

    cards = []
    for cd in got['cards']:
        f, t = cd.get('fact') or {}, cd.get('title') or {}
        if not (f.get('en') and f.get('tl')):
            continue
        cards.append({
            'topic': str(cd.get('topic') or prof['topic'])[:80],
            'format': 'qa' if str(cd.get('format') or '').lower() == 'qa' else 'statement',
            'domain': prof['strand'],
            'fact': {k: str(f.get(k) or '').strip() for k in ('en', 'tl', 'bis')},
            'title': {k: str(t.get(k) or '').strip()[:48] for k in ('en', 'tl', 'bis')},
            'terms': [str(x).strip().lower()[:40] for x in (cd.get('terms') or [])][:9],
            'illustration': str(cd.get('illustration') or '').strip()[:300],
            'cats': [leaf['id']] if leaf else [],
            'grade': m['grade'],
            'quarter': m.get('quarter'),
            'competency': m.get('competency'),
            'drive_id': mid,
        })
    if not cards:
        with _lock:
            _stats['failed'] += 1
        return
    with open(dst, 'w') as fh:
        json.dump({'drive_id': mid, 'cards': cards}, fh, ensure_ascii=False)
    with _lock:
        _stats['ok'] += 1
        _stats['cards'] += len(cards)
        _stats['in'] += pin
        _stats['out'] += pout
        if _stats['ok'] % 25 == 0:
            el = (time.time() - _T0) / 60
            cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
            print(f"  ...{_stats['ok']} modules | {_stats['cards']:,} cards | "
                  f"{_stats['out']/max(el,.01):,.0f} gen-tok/min | ${cost:.2f} | {el:.1f} min",
                  flush=True)


def main():
    mods = {json.loads(l)['drive_id']: json.loads(l) for l in open(MODULES)}
    profs = {}
    for f in glob.glob(os.path.join(PROFILES, '*.json')):
        mid = os.path.basename(f)[:-5]
        if mid in mods:
            profs[mid] = json.load(open(f))
    leaf_of = {}
    for lf in json.load(open(TAXONOMY))['leaves']:
        for mid in lf['modules']:
            leaf_of[mid] = lf

    work = [(mods[mid], p, leaf_of.get(mid)) for mid, p in profs.items() if p.get('strand')]
    work.sort(key=lambda w: (w[0]['grade'], w[0]['drive_id']))
    if LIMIT:
        step = max(1, len(work) // LIMIT)
        work = work[::step][:LIMIT]
    todo = [w for w in work
            if not (os.path.exists(os.path.join(OUT, f"{w[0]['drive_id']}.json"))
                    and os.path.getsize(os.path.join(OUT, f"{w[0]['drive_id']}.json")) > 0)]
    planned = sum(max(3, min(40, w[1]['fact_capacity'] or 12)) for w in todo)
    print(f'{len(work)} modules | {len(todo)} to generate | ~{planned:,} cards planned')
    print(f'  {MODEL.split("/")[-1]} | thinking={"ON" if THINKING else "OFF"} | conc {CONC}')

    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_one, *w) for w in todo]):
            pass

    el = (time.time() - _T0) / 60
    cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
    if _fatal.is_set():
        print(f'\nABORTED after {el:.1f} min. Completed modules are kept; re-run to continue.')
        raise SystemExit(2)
    print(f"\nDONE in {el:.1f} min | modules ok {_stats['ok']} failed {_stats['failed']} "
          f"retries {_stats['retries']}")
    print(f"  {_stats['cards']:,} cards | tokens {_stats['in']:,} in / {_stats['out']:,} out | ${cost:.2f}")
    if _stats['ok']:
        print(f"  per module: {_stats['cards']/_stats['ok']:.1f} cards, "
              f"${cost/_stats['ok']:.4f}  ->  full run ~${cost/_stats['ok']*len(work):.2f}")


if __name__ == '__main__':
    main()

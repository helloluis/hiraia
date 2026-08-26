#!/usr/bin/env python3
"""QUIZ v2 — rewrite + extend the card-feed quiz as SHORT, VARIED, 3-option questions.

Why v2 exists, measured against the shipped bank (10,121 interject questions):

  TOO WORDY   Tagalog options run p50 60 / p95 104 / max 207 chars, and 82% of questions
              carry at least one option over 40. After answering, a card must show four
              options plus a 138-char explanation — p95 564 chars total. QuestionPage has
              no ScrollView on purpose (a scroll view fights the feed's page-turn pan), so
              the overflow simply pushes the continue button off the bottom of the card.

  GAMEABLE    The correct answer is the LONGEST option 49.7% of the time (25% would be
              unbiased). A kid who ignores the question and taps the longest option scores
              about twice chance. This is baked in by the old prompt: a distractor is made
              "plausible but never accidentally true" by trimming it to something crisp and
              wrong, while the correct option carries the full qualified truth. Dropping a
              distractor cannot fix it — in 45.2% of items the correct answer is strictly
              longer than all three — so the only lever is rewriting.

  MONOTONOUS  Every item is the same shape: a "why/how" stem with four sentence-length
              options. A kid meets one of these every 4-5 pages, so sameness turns the
              interject into something to dread. v2 assigns a QUESTION TYPE per item.

  UNCOVERED   The card pool grew to 29,737 cards over 28,973 facts in the DepEd rebuild,
              but the quiz bank predates it: 18,812 pool facts (65%) have no question at
              all, so the feed re-uses the same small set.

TERM RECALL is the headline type and deliberately the heaviest. A card highlights a term
(`emphasis`, present on 99% of pool cards); two or three pages later the quiz asks the kid
to name it back, against confusable siblings — "what allows heat to flow through a wire?"
-> conduction / convection / condensation. That is how grade-school quizzing actually
works, it reinforces the exact thing the card taught, and its options are naturally SHORT
and naturally length-matched, which fixes wordiness and the length tell at the same time.

TWO MODELS, split by what each is for:
  deepseek-v4-flash-0731  writing/shortening, reasoning OFF — mechanical, high volume
  deepseek-v4-pro-0813    adversarial verification, reasoning ON — this is where reasoning
                          earns its cost, catching the accidentally-true distractor that
                          the old bank's reject log is full of ("Distractor D is also
                          defensibly true", "Open question allows >1 correct").

  set -a; source ./.env.local; set +a
  FW_LIMIT=24 python3 rag/pipeline/fw-quiz-v2.py     # validation slice — do this first
  python3 rag/pipeline/fw-quiz-v2.py                 # full run (resumable)

Env: FW_BATCH, FW_CONC, FW_LIMIT, FW_SCOPE (pool|new|rewrite), FW_GEN_TPM.
Resumable per shard; a zero-byte shard counts as unfinished.
"""
import os, json, time, hashlib, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
POOL = os.path.join(ROOT, 'packages/mobile/src/generated/cardsPool.generated.json')
QUIZ = os.path.join(ROOT, 'rag/bank/quiz-bank.jsonl')
OUT = os.path.join(HERE, 'quiz-v2')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']

GEN_MODEL = os.environ.get('FW_GEN_MODEL', 'accounts/fireworks/models/deepseek-v4-flash-0731')
VER_MODEL = os.environ.get('FW_VER_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
BATCH = int(os.environ.get('FW_BATCH', '8'))
CONC = int(os.environ.get('FW_CONC', '8'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
SCOPE = os.environ.get('FW_SCOPE', 'pool')          # pool | new | rewrite | missing
GEN_TPM = int(os.environ.get('FW_GEN_TPM', '400000'))
# A prepared worklist (one item_for() record per line) lets this run somewhere that does not
# have — and does not need — the 31MB card pool and 45MB quiz bank. Same records, same order,
# so batches hash to the same shard names and a run can be MOVED between machines mid-flight.
WORKLIST = os.environ.get('FW_WORKLIST', '')
MAX_TOKENS = 16000

# Fireworks list price, $/M tokens (in, out). Not exposed by the API — keep these current by
# hand. Output dominates every total here, so the OUT figures are the ones that matter:
# verification reasoning alone was 84% of the first slice's spend.
RATE = {
    'flash': (0.22, 0.66),
    'pro': (1.60, 4.00),
}

os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- length budget
# Chosen from the measured failure: the card must show 3 options + an explanation with no
# scroll. At these caps a worst-case Tagalog card carries 3x42 + 100 = 226 chars against
# the current p95 of 564, which fits the existing type tiers with room to spare.
# Tagalog and Bisaya run ~17-25% longer than English for the same meaning, so one shared
# cap silently penalises them: measured, every over-cap drop in the 120-item calibration was
# a tl option at 25-34 chars whose English twin fitted comfortably. Cap each language on its
# own scale instead of making the translator hit an English budget.
CAPS = {           # language -> (cap for term/number/order/which-example, cap for the rest)
    'en': (28, 42),
    'tl': (30, 52),
    'bis': (30, 52),
}
# Third time this shape of bug appeared, so: caps are per-language, always. A single 75
# rejected 1,110 stems, 746 of them tl/bis — whose rejects sit at p50 80 against English's
# 66, because the same question simply takes more characters to ask. Kept stems ran p95 61
# (en) and 69 (tl/bis), so these ceilings sit above what the model naturally writes and
# only bite the genuinely rambling ones.
Q_CAP = {'en': 85, 'tl': 95, 'bis': 95}
MAX_Q = Q_CAP['en']   # kept for prompt text
EXPL_CAP = {'en': 135, 'tl': 155, 'bis': 155}   # same reason as CAPS: tl/bis run longer
MAX_EXPL = EXPL_CAP['en']                       # kept for the prompt text
TELL_ABS = 2          # ...by more than this many characters, AND
TELL_REL = 1.25       # ...by more than this ratio. BOTH must be exceeded to fail.

# The bias we are killing is DIRECTIONAL and STATISTICAL: in the old bank the correct answer
# was the longest option 49.7% of the time, so "tap the longest" scored twice chance. The
# first fix here was a symmetric parity ratio (longest <= 1.35x shortest) and it was the
# wrong instrument — it rejected 70% of a validation slice, including every `term` question,
# for option sets that are perfectly fair. Uneven options are not the problem; the CORRECT
# one reliably sticking out is. So the gate now only fires when the correct answer is the
# longest AND clears the runner-up by more than TELL_SLACK characters. Options may otherwise
# be any lengths within the caps, and the run reports the corpus-wide rate so the thing we
# actually care about is measured rather than assumed.
#
# Calibrating this took three slices and both single-dimension rules failed, in opposite
# directions. A 6-character allowance waved through nearly everything (measured tell rate
# 50-56%, no better than the bank being replaced) because mean option length here is 12-14
# characters. Tightening to 1 character then rejected pairs like 20-vs-18 and 25-vs-22,
# which no child could exploit. Length only tells you something RELATIVE to how long the
# options are, so the gate needs both dimensions and fails only when BOTH are exceeded:
#   12 vs 5   -> +7 and 2.4x  -> fail, a real tell
#   25 vs 22  -> +3 but 1.14x -> pass, nobody can see that
# Violations still go to the repair pass before being dropped.

# ---------------------------------------------------------------- question types
# Weights are the variety budget. `term` is heaviest because it is the type that reinforces
# what the card just taught, but it is deliberately not a majority — a kid meets an
# interject every 4-5 pages and would notice one shape repeating.
TYPES = [
    ('term', 30, 'Name the thing. The STEM describes the phenomenon/structure in plain '
                 'everyday words; the OPTIONS are the term itself plus two confusable '
                 'sibling terms from the same family (conduction / convection / '
                 'condensation). Options are bare terms — no articles, no definitions, no '
                 'explanatory clause. NEVER invert this: do not put the term in the stem '
                 'and definitions in the options ("What does endemic mean?" is WRONG — ask '
                 '"What do we call an animal found in only one place?" instead). A term '
                 'that Filipino teachers say in English stays in English in all three '
                 'languages; that is correct, not a missing translation.'),
    ('why', 14, 'Cause. "Why does X happen?" Options are short causal phrases.'),
    ('what-does', 12, 'Function. "What does X do?" / "What is X for?" Options are short '
                      'verb phrases.'),
    ('what-if', 10, 'Consequence. "What happens if/when X?" Options are short outcomes.'),
    ('which-example', 10, 'Instance. "Which of these is a(n) X?" Options are three '
                          'same-category nouns, exactly one of which fits.'),
    ('number', 8, 'Value. Ask for a quantity, temperature, count, or date from the fact. '
                  'Options are the value plus two plausible near-miss values, same unit '
                  'and same format.'),
    ('odd-one-out', 8, 'Exclusion. "Which one does NOT belong / is NOT true of X?" Options '
                       'are three short same-category items.'),
    ('order', 8, 'Sequence. "What comes right after X?" for a staged process. Options are '
                 'three stage names from that process.'),
]
SHORT_TYPES = {'term', 'number', 'order', 'which-example'}
_W = [t for t, w, _ in TYPES for _ in range(w)]
TYPE_DESC = {t: d for t, _, d in TYPES}


def numeric_emphasis(em):
    """True if the highlighted term is a value — those want `number`, not `term`."""
    for lang in ('en', 'tl', 'bis'):
        for s in (em or {}).get(lang, []) or []:
            if any(ch.isdigit() for ch in str(s)):
                return True
    return False


def has_number(card):
    """Any digit anywhere in the fact text, in any language."""
    for v in (card.get('fact') or {}).values():
        if any(ch.isdigit() for ch in str(v)):
            return True
    return numeric_emphasis(card.get('emphasis'))


# `number` is the one type we can cheaply prove impossible: a fact with no digit in it
# cannot be asked for a value. Assigning it anyway would just force a fallback and quietly
# eat the variety budget — measured, that was ~1,600 facts. So drop it from the weighted
# pool for those, rather than letting the model paper over it.
_W_NONUM = [t for t, w, _ in TYPES if t != 'number' for _ in range(w)]


def assign_type(fact_id, card):
    """Deterministic so the run is reproducible and resumable — the same fact always gets
    the same type, and the distribution over the corpus matches the weights above."""
    h = int(hashlib.md5(fact_id.encode()).hexdigest()[:8], 16)
    if not has_number(card):
        return _W_NONUM[h % len(_W_NONUM)]
    if numeric_emphasis(card.get('emphasis')) and h % 100 < 55:
        return 'number'
    return _W[h % len(_W)]


# ---------------------------------------------------------------- rate limiting
class TokenBudget:
    """Sliding-window limiter over OBSERVED completion tokens."""

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
_stats = {'gin': 0, 'gout': 0, 'vin': 0, 'vout': 0, 'rin': 0, 'rout': 0,
          'gen': 0, 'kept': 0, 'healed': 0, 'batches': 0, 'failed': 0}
_types = collections.Counter()
_reasons = collections.Counter()
_fatal = threading.Event()


class Fatal(Exception):
    """A sustained account-level stop; retrying cannot fix it."""


class Suspension:
    """Tells a passing flap apart from a real account stop (see fw-profile-modules.py)."""

    def __init__(self, min_events=12, quiet_seconds=150):
        self.min_events, self.quiet_seconds = min_events, quiet_seconds
        self.events, self.last_ok, self.lock = 0, time.time(), threading.Lock()

    def ok(self):
        with self.lock:
            self.last_ok, self.events = time.time(), 0

    def hit(self, body):
        with self.lock:
            self.events += 1
            starved = time.time() - self.last_ok > self.quiet_seconds
            if self.events >= self.min_events and starved and not _fatal.is_set():
                _fatal.set()
                print(f'\n  ACCOUNT STOPPED — nothing has succeeded in {self.quiet_seconds}s '
                      f'across {self.events} suspensions. Aborting.\n  {body.strip()[:240]}\n',
                      flush=True)
            return _fatal.is_set()


SUSPENSION = Suspension()


def call(model, prompt, thinking, attempt=0):
    if _fatal.is_set():
        raise Fatal('run aborted')
    BUDGET.acquire()
    payload = {'model': model, 'temperature': 0.3, 'max_tokens': MAX_TOKENS,
               'messages': [{'role': 'user', 'content': prompt}]}
    if not thinking:
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
                return call(model, prompt, thinking, attempt + 1)
            raise
        if e.code in (412, 429, 500, 502, 503, 529) and attempt < 6:
            ra = e.headers.get('Retry-After')
            time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
            return call(model, prompt, thinking, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(model, prompt, thinking, attempt + 1)
        raise


def arr_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip()
        a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except Exception:
                pass
    return None


# ---------------------------------------------------------------- prompts
GEN_HEAD = f'''You write ONE short multiple-choice quiz question per item for a Filipino
grade-school science app (target grade 5). The question interrupts a card feed the kid is
reading, so it must be FAST to read and answer on a phone. Output ONLY a JSON array.

HARD RULES — a question that breaks any of these is useless:
1. EXACTLY 3 options. One correct, two wrong. Never 4.
2. LENGTH, per language. Options for type term/number/order/which-example: <= {CAPS['en'][0]}
   characters in en, <= {CAPS['tl'][0]} in tl and bis. All other types: <= {CAPS['en'][1]} in
   en, <= {CAPS['tl'][1]} in tl and bis. Question stem <= {Q_CAP['en']} characters in en, <= {Q_CAP['tl']} in tl and bis.
   Explanation <= {EXPL_CAP['en']} characters in en, <= {EXPL_CAP['tl']} in tl and bis.
   These are per-language caps — Tagalog and Bisaya
   run ~17% longer than English, so write them short in ALL THREE languages, do not
   translate an English option that only just fits.
3. NO LENGTH TELL — this one is load-bearing. The CORRECT option must never be the
   conspicuously longest one. In the previous bank it was the longest 49.7% of the time and
   a kid could score twice chance by tapping the longest without reading. Aim for the
   correct answer to be about the same length as the distractors, or shorter. Options do
   NOT all have to match each other — uneven distractors are fine — it is specifically the
   correct one sticking out that must not happen.
4. Options must be MUTUALLY EXCLUSIVE and exactly one defensibly correct. A distractor
   that is also true is the worst possible error. Distractors tap a real misconception or
   a confusable sibling — never a joke, never an absurdity, never "all of the above".
5. Do not reference "the card", "the fact", or "the text". The question must stand alone.
6. All three languages: en, tl (Tagalog), bis (Cebuano/Bisaya). Keep proper nouns, numbers
   and units IDENTICAL across languages. Never leave a language blank or English-only.
   Science terms that Filipino teachers say in English STAY in English (photosynthesis,
   conduction, microscope); everyday words go in the local language.

QUESTION TYPE. Each item names a `type` — write that type. Type meanings:
{chr(10).join(f'  {t:14s} {d}' for t, _, d in TYPES)}

If the fact genuinely cannot support its assigned type, use the nearest type that fits and
say which in `type_used`. Do not force a bad question to satisfy the label.

The `emphasis` field is the term the card highlighted for this kid. For type=term it IS
the correct answer — ask the kid to name it back, and build the two distractors from the
same family so the choice is a real discrimination, not a giveaway.

FINAL ANSWER = a JSON array, one object per item IN ORDER, each exactly:
{{"factId":"..","type_used":"..","q":{{"en":"..","tl":"..","bis":".."}},
  "options":[{{"en":"..","tl":"..","bis":".."}},{{...}},{{...}}],"answer":0,
  "explanation":{{"en":"..","tl":"..","bis":".."}},"difficulty":1}}
`answer` is the 0-based index of the correct option. difficulty 0 easy / 1 / 2 hard.

ITEMS:
'''

VER_HEAD = f'''You are an ADVERSARIAL verifier of grade-5 science quiz questions for a
Filipino kids' app. Reason carefully, then output ONLY a JSON array.

The worst error is a wrong answer marked correct, and its most common cause is A DISTRACTOR
THAT IS ALSO TRUE. For EACH question, ignore the marked answer and independently decide
which options are defensibly correct. KEEP only if ALL of:
  - EXACTLY ONE option is correct AND its index equals `answer`
  - the question is unambiguous and answerable without seeing any card
  - the other two options are plausible-but-clearly-wrong, not jokes or absurdities
  - it is sound, grade-appropriate science
  - tl and bis say the SAME thing as en, with identical numbers/units/proper nouns, and
    neither is blank.
    IMPORTANT — a TECHNICAL SCIENCE TERM that is identical in en/tl/bis is CORRECT, not a
    translation failure. Filipino teachers and textbooks say photosynthesis, conduction,
    pollination, zooxanthellae, microscope in English, and a term-recall question's options
    are usually exactly these. Only reject for language when an EVERYDAY word was left in
    English (mountain instead of bundok, water instead of tubig) or when a whole stem or
    explanation is untranslated English prose.
Do NOT check option/stem/explanation LENGTH, option COUNT, or the length tell. Those are
enforced deterministically in code before you ever see the item, and re-checking them here
only burns reasoning on something already guaranteed. Judge MEANING only.
REJECT otherwise. When in doubt, REJECT — a dropped question costs nothing, a wrong one
teaches a child something false.

FINAL ANSWER = a JSON array, one object per question IN ORDER:
{{"factId":"..","keep":true,"reason":"ok"}}
reason is short and specific when keep is false, e.g. "distractor-also-true: B",
"length-tell: correct is longest", "bis-blank", "over-cap: opt2 61 chars".

QUESTIONS:
'''


REPAIR_HEAD = f"""These quiz questions are CORRECT in meaning but broke a mechanical rule.
Fix ONLY what the `violation` says, changing as little else as possible. Keep the same
correct answer, the same meaning, and the same language in all three of en/tl/bis.

  over-cap      an option/stem/explanation is too long -> cut words, keep the meaning
  length-tell   the correct option out-lengths the others. Prefer LENGTHENING A DISTRACTOR
                to match — a distractor is already wrong, so adding a word or two costs
                nothing, whereas squeezing the correct option risks distorting the science.
                Shorten the correct one only when it is genuinely padded. Either way the
                correct option must end up NO LONGER than the longest distractor. Do not
                make a distractor absurd or obviously filler — it must still read as a
                real, plausible answer a child might pick.
  <lang>-blank  a language is missing -> write it properly, never copy the English
  not-3-options exactly three options, one correct

Caps per language — term/number/order/which-example: en <= {CAPS['en'][0]}, tl/bis <=
{CAPS['tl'][0]}. Other types: en <= {CAPS['en'][1]}, tl/bis <= {CAPS['tl'][1]}.
Stem <= {Q_CAP['en']} en / {Q_CAP['tl']} tl+bis; explanation <= {EXPL_CAP['en']} en / {EXPL_CAP['tl']} tl+bis.

Output ONLY a JSON array of the repaired objects, same schema, same order.

ITEMS:
"""


def item_for(c, existing):
    """What the generator sees. The FACT is the source of truth; an existing question is
    passed only as raw material for the rewrite path (its answer/explanation are usually
    sound, it is the phrasing and length that are wrong)."""
    it = {
        'factId': c['factId'],
        'type': assign_type(c['factId'], c),
        'domain': c.get('domain'),
        'topic': c.get('topic'),
        'emphasis': c.get('emphasis') or {},
        'fact': c['fact'],
    }
    if existing:
        it['previous'] = {
            'q': existing.get('q'),
            'correct': (existing.get('options') or [{}])[existing.get('answer', 0)],
            'explanation': existing.get('explanation'),
        }
    return it


def over_cap(rec):
    """Deterministic pre-check — never spend a Pro verify call on something a regex can
    already prove broken."""
    t = rec.get('type_used') or 'why'
    opts = rec.get('options') or []
    if len(opts) != 3:
        return f'not-3-options ({len(opts)})'
    if not isinstance(rec.get('answer'), int) or not 0 <= rec['answer'] <= 2:
        return 'bad-answer-index'
    for lang in ('en', 'tl', 'bis'):
        vals = [(o.get(lang) or '') for o in opts]
        if not all(vals):
            return f'{lang}-blank-option'
        cap = CAPS[lang][0] if t in SHORT_TYPES else CAPS[lang][1]
        if max(len(v) for v in vals) > cap:
            return f'over-cap {lang} {max(len(v) for v in vals)}>{cap}'
        cl = len(opts[rec['answer']].get(lang) or '') if isinstance(rec.get('answer'), int) \
            and 0 <= rec['answer'] < len(opts) else 0
        others = [len(o.get(lang) or '') for i, o in enumerate(opts) if i != rec.get('answer')]
        if others:
            top = max(others)
            if cl - top > TELL_ABS and top and cl > top * TELL_REL:
                return f'length-tell {lang} {cl}>{top}'
        if len((rec.get('q') or {}).get(lang) or '') > Q_CAP[lang]:
            return f'stem-long {lang}'
        if len((rec.get('explanation') or {}).get(lang) or '') > EXPL_CAP[lang]:
            return f'expl-long {lang}'
    return None


def shard_id(items):
    """Name a shard by WHAT IS IN IT, not by its position in the worklist.

    Positional names (batch-00007) only resume correctly when the worklist is identical.
    A coverage sweep re-runs a DIFFERENT, shorter list, so batch 7 of the sweep is not
    batch 7 of the first run — positional names would collide and the sweep would skip
    work it had never done. Hashing the factIds makes a shard's name follow its content,
    so sweeps and re-runs compose safely."""
    key = '|'.join(sorted(i['factId'] for i in items))
    return hashlib.md5(key.encode()).hexdigest()[:12]


def do_batch(idx, items):
    idx = shard_id(items)
    dst = os.path.join(OUT, f'batch-{idx}.jsonl')
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    try:
        payload = '\n'.join(json.dumps(i, ensure_ascii=False) for i in items)
        c, rc, gin, gout = call(GEN_MODEL, GEN_HEAD + payload, thinking=False)
    except Fatal:
        return
    except Exception as e:
        with _lock:
            _stats['failed'] += 1
        print(f'  GEN FAIL batch {idx}: {type(e).__name__} {getattr(e, "code", "")}', flush=True)
        return
    gen = arr_from(c, rc)
    if not isinstance(gen, list) or not gen:
        with _lock:
            _stats['failed'] += 1
        return

    # cheap structural gate first — a Pro call is ~5x the price of a Flash call
    staged, drops = [], []
    asked = {i['factId'] for i in items}
    returned = set()
    for r in gen:
        if not isinstance(r, dict) or not r.get('factId'):
            drops.append({'factId': None, 'stage': 'precheck', 'reason': 'malformed-record'})
            continue
        returned.add(r['factId'])
        why = over_cap(r)
        if why:
            drops.append({'factId': r['factId'], 'stage': 'precheck', 'reason': why,
                          'type_used': r.get('type_used'), 'record': r})
            continue
        staged.append(r)
    for missing in asked - returned:
        drops.append({'factId': missing, 'stage': 'precheck', 'reason': 'not-returned'})

    # One cheap repair round before giving up. These records are usually sound science that
    # merely ran long, and Flash output is ~1/10th the price of a Pro verification — so
    # discarding them and re-generating from scratch is the expensive option. Anything still
    # broken after this is dropped for real.
    rin = rout = 0
    broken = [d for d in drops if d['stage'] == 'precheck' and d.get('record')]
    if broken:
        try:
            rpay = '\n'.join(json.dumps({**d['record'], 'violation': d['reason']},
                                        ensure_ascii=False) for d in broken)
            rc_, rrc, rin, rout = call(GEN_MODEL, REPAIR_HEAD + rpay, thinking=False)
            fixed = arr_from(rc_, rrc) or []
            with open(os.path.join(OUT, f'repair-{idx}.json'), 'w') as dbg:
                json.dump({'sent': [{'factId': d.get('factId'), 'violation': d['reason']}
                                    for d in broken],
                           'returned': fixed,
                           'raw_head': (rc_ or rrc or '')[:1200]}, dbg,
                          ensure_ascii=False, indent=1)
            healed = set()
            for r in fixed:
                if not isinstance(r, dict) or not r.get('factId'):
                    continue
                if over_cap(r) is None:
                    staged.append(r)
                    healed.add(r['factId'])
            if healed:
                drops = [d for d in drops if d.get('factId') not in healed]
                with _lock:
                    _stats['healed'] += len(healed)
        except Fatal:
            return
        except Exception as e:
            # Do NOT swallow silently. A bare `except: pass` here hid a formatting bug for
            # an entire calibration run: the API call was paid for, the block then threw
            # before healing anything, and the only symptom was `healed 0` — which reads as
            # "the model could not fix them" rather than "this code is broken".
            print(f'  REPAIR FAIL {idx}: {type(e).__name__}: {e}', flush=True)

    kept = []
    vin = vout = 0
    if staged:
        try:
            vpay = '\n'.join(json.dumps(r, ensure_ascii=False) for r in staged)
            vc, vrc, vin, vout = call(VER_MODEL, VER_HEAD + vpay, thinking=True)
            verdicts = arr_from(vc, vrc) or []
            ok = {v.get('factId') for v in verdicts
                  if isinstance(v, dict) and v.get('keep') is True}
            why = {v.get('factId'): v.get('reason', '?') for v in verdicts
                   if isinstance(v, dict) and v.get('keep') is not True}
            kept = [r for r in staged if r['factId'] in ok]
            for r in staged:
                if r['factId'] not in ok:
                    drops.append({'factId': r['factId'], 'stage': 'verify',
                                  'reason': why.get(r['factId'], 'no-verdict'),
                                  'type_used': r.get('type_used'), 'record': r})
        except Fatal:
            return
        except Exception as e:
            with _lock:
                _stats['failed'] += 1
            print(f'  VER FAIL batch {idx}: {type(e).__name__}', flush=True)
            return

    with open(dst, 'w') as fh:
        for r in kept:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    with open(os.path.join(OUT, f'rejects-{idx}.jsonl'), 'w') as fh:
        for d in drops:
            fh.write(json.dumps(d, ensure_ascii=False) + '\n')
    with _lock:
        _stats['gin'] += gin; _stats['gout'] += gout
        _stats['vin'] += vin; _stats['vout'] += vout
        _stats['rin'] += rin; _stats['rout'] += rout
        _stats['gen'] += len(gen); _stats['kept'] += len(kept)
        _stats['batches'] += 1
        for r in kept:
            _types[r.get('type_used', '?')] += 1
        for d in drops:
            key = str(d['reason']).split(':')[0].strip()[:34]
            _reasons[f"{d['stage']}/{key}"] += 1
        if _stats['batches'] % 20 == 0:
            el = (time.time() - _T0) / 60
            print(f"  ...{_stats['batches']} batches | gen {_stats['gen']} kept {_stats['kept']}"
                  f" | {el:.1f} min", flush=True)


_T0 = time.time()


def dump_worklist(work, path):
    with open(path, 'w') as fh:
        for it in work:
            fh.write(json.dumps(it, ensure_ascii=False) + '\n')
    print(f'wrote worklist: {path} ({len(work):,} items, '
          f'{os.path.getsize(path) / 1e6:.1f} MB)')


def main():
    if WORKLIST:
        work = [json.loads(l) for l in open(WORKLIST) if l.strip()]
        print(f'worklist: {len(work):,} items from {WORKLIST}')
        run(work)
        return
    pool = json.load(open(POOL))['cards']
    existing = {}
    for l in open(QUIZ):
        l = l.strip()
        if l:
            r = json.loads(l)
            if r.get('factId'):
                existing.setdefault(r['factId'], r)

    # `missing` is the coverage sweep: whatever this pipeline has NOT yet produced a kept
    # question for. Items are dropped for good reasons (a distractor that was also true, a
    # bad translation), but a dropped item still leaves its fact without a quiz — and the
    # feed then recycles the covered ones. Re-running plain `pool` would skip every finished
    # shard and never revisit them, so coverage needs its own scope.
    done = set()
    if SCOPE == 'missing':
        for fn in os.listdir(OUT):
            if fn.startswith('batch-'):
                for l in open(os.path.join(OUT, fn)):
                    if l.strip():
                        done.add(json.loads(l).get('factId'))

    seen, work = set(), []
    for c in pool:
        fid = c['factId']
        if fid in seen:
            continue
        seen.add(fid)
        has = fid in existing
        if SCOPE == 'new' and has:
            continue
        if SCOPE == 'rewrite' and not has:
            continue
        if SCOPE == 'missing' and fid in done:
            continue
        work.append(item_for(c, existing.get(fid)))
    if SCOPE == 'missing':
        print(f'coverage sweep: {len(done):,} facts already have a v2 question')

    if LIMIT:
        # spread the slice across types AND across the rewrite/new split so the validation
        # sample exercises every prompt path, not just the first alphabetical domain
        by = collections.defaultdict(list)
        for it in work:
            by[it['type']].append(it)
        work = [x for t in sorted(by) for x in by[t][:max(1, LIMIT // len(by))]][:LIMIT]

    if os.environ.get('FW_DUMP_WORKLIST'):
        dump_worklist(work, os.environ['FW_DUMP_WORKLIST'])
        return
    run(work)


def run(work):
    batches = [work[i:i + BATCH] for i in range(0, len(work), BATCH)]
    # Resume must ask the SAME question the writer answers: shard names are content-
    # addressed, so this has to hash the batch too. It previously checked positional names
    # (batch-00007) while do_batch wrote hashes — so every batch looked undone and a resume
    # would have silently re-generated everything already paid for.
    def done(b):
        # Existence, not size. A ZERO-BYTE shard is a batch that ran and kept nothing —
        # its API cost is already spent, and re-running the identical 8 items on every
        # resume would just pay it again for the same likely outcome. Those facts are not
        # abandoned: FW_SCOPE=missing rebuilds a fresh worklist of everything still lacking
        # a question and re-batches it, which also gives them different batch company.
        return os.path.exists(os.path.join(OUT, f'batch-{shard_id(b)}.jsonl'))

    todo = [(i, b) for i, b in enumerate(batches) if not done(b)]
    print(f'{len(work):,} items in {len(batches):,} batches '
          f'(size {BATCH}, conc {CONC}); {len(todo):,} to do')
    print(f'  gen    {GEN_MODEL.split("/")[-1]}  thinking=OFF')
    print(f'  verify {VER_MODEL.split("/")[-1]}  thinking=ON')
    print(f'  assigned types: {dict(collections.Counter(i["type"] for i in work).most_common())}\n')


    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_batch, i, b) for i, b in todo]):
            pass

    el = (time.time() - _T0) / 60
    # Fireworks list price at time of writing; the run prints tokens too so the real
    # per-item cost can be recomputed if the rate moves.
    fi, fo = RATE['flash']
    pi, po = RATE['pro']
    gen_cost = (_stats['gin'] + _stats['rin']) / 1e6 * fi + (_stats['gout'] + _stats['rout']) / 1e6 * fo
    ver_cost = _stats['vin'] / 1e6 * pi + _stats['vout'] / 1e6 * po
    cost = gen_cost + ver_cost
    kr = _stats['kept'] / _stats['gen'] if _stats['gen'] else 0
    if _fatal.is_set():
        print(f'\nABORTED after {el:.1f} min — finished shards are kept; re-run to resume.')
        raise SystemExit(2)
    print(f'\nDONE in {el:.1f} min | generated {_stats["gen"]:,} | kept {_stats["kept"]:,} '
          f'({kr:.1%}) | failed batches {_stats["failed"]}')
    print(f'  gen    tokens in/out {_stats["gin"]:,}/{_stats["gout"]:,}')
    print(f'  repair tokens in/out {_stats["rin"]:,}/{_stats["rout"]:,}  '
          f'(healed {_stats["healed"]:,})')
    print(f'  verify tokens in/out {_stats["vin"]:,}/{_stats["vout"]:,}')
    print(f'  cost split: flash ${gen_cost:.2f} + pro ${ver_cost:.2f} '
          f'({ver_cost / cost * 100:.0f}% verification)' if cost else '')
    print(f'  est cost ~${cost:.2f}' +
          (f'  ->  ${cost / max(_stats["kept"], 1) * 28973:,.0f} for all 28,973 pool facts'
           if _stats['kept'] else ''))
    print(f'  type mix kept: {dict(_types.most_common())}')

    # The tell is a property of the CORPUS, not of any one item — so measure it on the
    # output rather than trusting the per-item gate. 33% is unbiased for 3 options; the old
    # 4-option bank sat at 49.7% against a 25% baseline.
    rows = []
    for fn in os.listdir(OUT):
        if fn.startswith('batch-'):
            for l in open(os.path.join(OUT, fn)):
                if l.strip():
                    rows.append(json.loads(l))
    if rows:
        # Count STRICTLY longest, not >=. A tie for longest is what parity looks like and
        # nothing a child can act on; counting ties reported 49% where the exploitable rate
        # was 11% and nearly sent us tuning a problem that was already solved.
        for lang in ('en', 'tl', 'bis'):
            strict = expl = 0
            for r in rows:
                L = [len(o.get(lang) or '') for o in r['options']]
                c, others = L[r['answer']], [x for i, x in enumerate(L) if i != r['answer']]
                if c > max(others):
                    strict += 1
                if c - max(others) >= 3:
                    expl += 1
            opt = [len(o.get(lang) or '') for r in rows for o in r['options']]
            print(f'  {lang}: correct strictly longest {strict / len(rows) * 100:5.1f}% '
                  f'(unbiased 33.3%) | exploitable >=3ch {expl / len(rows) * 100:5.1f}% '
                  f'(old bank 40.0%) | opt len mean {sum(opt) / len(opt):.0f} max {max(opt)}')
    if _reasons:
        print('  why items were dropped:')
        for k, v in _reasons.most_common(14):
            print(f'    {v:5,}  {k}')


if __name__ == '__main__':
    main()

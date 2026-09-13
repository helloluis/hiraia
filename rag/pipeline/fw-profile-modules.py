#!/usr/bin/env python3
"""STAGE A — read every DepEd science module once and record what it teaches.

Why this exists rather than a regex: the module covers do not carry their topic. 49% of
extracted titles are boilerplate ("Learning Activity", "Lesson Exemplar", "Agham 3"), and no
in-text marker has usable coverage — the best, a "Topic:" line, appears in 22% of modules.
Only 18% carry a DepEd competency code, so the strand is missing for 868 of 1,062 modules.

One cheap pass over each module therefore earns three things at once:
  topic          what the module actually teaches, in the curriculum's own words
  strand         one of Hiraia's four MATATAG domains, filling the 82% the codes miss
  key_concepts   the teachable ideas, which become the input to taxonomy derivation
  fact_capacity  how many DISTINCT facts this module could honestly ground — so generation
                 can be allocated by what the source actually supports instead of dividing
                 30,000 evenly and padding thin modules with restatements

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-profile-modules.py
  FW_LIMIT=8 python3 rag/pipeline/fw-profile-modules.py     # benchmark slice

Env: FW_MODEL, FW_CONC, FW_LIMIT, FW_GEN_TPM, FW_CHARS.
Resumable per module id; a zero-byte shard counts as unfinished.
"""
import os, json, glob, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
MODULES = os.path.join(HERE, 'deped-modules.jsonl')
OUT = os.path.join(HERE, 'module-profiles')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']

MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '8'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
GEN_TPM = int(os.environ.get('FW_GEN_TPM', '150000'))
# Modules run to 585k chars. The teaching content is front-loaded (cover, objectives, lesson,
# then exercises/answer keys), so a generous head is enough to characterise the module and
# keeps prompt cost bounded — this stage only needs to know WHAT it teaches, not every detail.
CHARS = int(os.environ.get('FW_CHARS', '14000'))
MAX_TOKENS = 8000

STRANDS = ['LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'MATTER', 'EARTH_SPACE']
os.makedirs(OUT, exist_ok=True)


class TokenBudget:
    """Sliding-window limiter over OBSERVED completion tokens (see fw-gen-card-titles.py)."""

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
_stats = {'in': 0, 'out': 0, 'ok': 0, 'failed': 0, 'retries': 0}


class Fatal(Exception):
    """A sustained account-level stop. Retrying cannot fix it, so the run gives up at once."""


_fatal = threading.Event()


class Suspension:
    """Tells a passing flap apart from a real account stop.

    Both arrive as the same 412 "Account ... is suspended". But the two need opposite
    handling: a spending cap must abort the run immediately (retrying 6x per worker across
    hundreds of threads just wastes minutes and hides the real message), while a flap must be
    ridden out (when the cap was lifted the endpoint took ~3 minutes to settle, serving 2/6
    probes one moment and 6/6 the next — aborting there would throw away a live run).

    The signal that separates them is simply whether anything is getting through: a flap has
    recent successes between the failures, a real stop has none.
    """

    def __init__(self, min_events=12, quiet_seconds=150):
        self.min_events, self.quiet_seconds = min_events, quiet_seconds
        self.events, self.last_ok, self.lock = 0, time.time(), threading.Lock()

    def ok(self):
        with self.lock:
            self.last_ok, self.events = time.time(), 0

    def hit(self, body):
        """Record a suspension; True if it looks sustained rather than transient."""
        with self.lock:
            self.events += 1
            starved = time.time() - self.last_ok > self.quiet_seconds
            if self.events >= self.min_events and starved and not _fatal.is_set():
                _fatal.set()
                print(f'\n  ACCOUNT STOPPED — no request has succeeded in '
                      f'{self.quiet_seconds}s across {self.events} suspensions. Aborting.'
                      f'\n  {body.strip()[:260]}\n', flush=True)
            return _fatal.is_set()


SUSPENSION = Suspension()


def call(prompt, attempt=0):
    if _fatal.is_set():
        raise Fatal('run aborted')
    BUDGET.acquire()
    body = json.dumps({'model': MODEL, 'temperature': 0.2, 'max_tokens': MAX_TOKENS,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=600))
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
        # An account stop (suspension / spending cap) also arrives as 412, and no amount of
        # retrying clears it. Left undetected it burns 6 attempts on every worker and reads as
        # a mysterious stall: a whole benchmark once failed this way for 4 minutes before the
        # real message — "Account ... is suspended" — was ever surfaced. Stop the run instead.
        if 'suspended' in body.lower() or 'spending limit' in body.lower():
            if SUSPENSION.hit(body):
                raise Fatal(body[:300])
            # a flap: back off hard, then keep trying
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


def prompt_for(m):
    return f'''This is a Philippine DepEd science learning module. Read it and describe what it teaches.

KNOWN FROM THE CURRICULUM (do not contradict these):
  grade: {m['grade']}
  quarter: {m.get('quarter') or 'unstated'}
  competency code: {m.get('competency') or 'none printed'}
  curriculum: {'MATATAG (current)' if m['matatag'] else 'K-10 (earlier edition)'}

Return STRICT JSON only:
{{"topic": "...", "strand": "...", "key_concepts": ["..."], "fact_capacity": 0}}

  topic          What this module teaches, 2-8 words, in English. The SUBJECT, not the
                 document type — never "Learning Activity" or "Lesson Exemplar".
  strand         Exactly one of: {', '.join(STRANDS)}
  key_concepts   5-12 specific teachable ideas actually present in this module, each a short
                 phrase. These must be things the module TEACHES, not section headings and
                 not activity instructions.
  fact_capacity  Your honest estimate of how many DISTINCT, non-overlapping factual statements
                 a {m['grade']}th-grade science card deck could draw from this module. Count
                 only real content. A worksheet of practice questions with little exposition
                 might be 3; a full lesson with diagrams and worked examples might be 40. Do
                 not inflate — a low number here is useful information, not a failure.

MODULE TEXT
{m['text'][:CHARS]}'''


def do_one(m, tries=3):
    mid = m['drive_id']
    dst = os.path.join(OUT, f'{mid}.json')
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    got = None
    for a in range(tries):
        try:
            c, rc, pin, pout = call(prompt_for(m))
        except Fatal:
            return
        except Exception as e:
            with _lock:
                _stats['failed'] += 1
            print(f'  FAIL {mid}: {type(e).__name__} {getattr(e, "code", "")}', flush=True)
            return
        got = obj_from(c, rc)
        if got and got.get('topic') and got.get('strand') in STRANDS:
            break
        with _lock:
            _stats['retries'] += 1
        time.sleep(2 ** a)
    if not got:
        with _lock:
            _stats['failed'] += 1
        return
    rec = {
        'drive_id': mid, 'grade': m['grade'], 'quarter': m.get('quarter'),
        'matatag': m['matatag'], 'competency': m.get('competency'),
        'source_page': m.get('source_page'), 'chars': m['chars'],
        'topic': str(got.get('topic', ''))[:90],
        'strand': got.get('strand') if got.get('strand') in STRANDS else (m.get('strand') or None),
        'key_concepts': [str(x)[:90] for x in (got.get('key_concepts') or [])][:12],
        'fact_capacity': int(got.get('fact_capacity') or 0),
    }
    with open(dst, 'w') as fh:
        json.dump(rec, fh, ensure_ascii=False)
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout; _stats['ok'] += 1
        if _stats['ok'] % 50 == 0:
            el = (time.time() - _T0) / 60
            print(f"  ...{_stats['ok']} modules | {_stats['out']/max(el,.01):,.0f} gen-tok/min | {el:.1f} min", flush=True)


_T0 = time.time()


def main():
    mods = [json.loads(l) for l in open(MODULES)]
    if LIMIT:
        # spread the benchmark across grades so the estimate is not one grade's worth of text
        by = collections.defaultdict(list)
        for m in mods:
            by[m['grade']].append(m)
        mods = [m for g in sorted(by) for m in by[g][:max(1, LIMIT // 8)]][:LIMIT]
    todo = [m for m in mods
            if not (os.path.exists(os.path.join(OUT, f"{m['drive_id']}.json"))
                    and os.path.getsize(os.path.join(OUT, f"{m['drive_id']}.json")) > 0)]
    print(f'{len(mods)} modules, {len(todo)} to profile | {MODEL.split("/")[-1]} | conc {CONC}')
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_one, m) for m in todo]):
            pass
    el = (time.time() - _T0) / 60
    if _fatal.is_set():
        print(f'\nABORTED after {el:.1f} min — nothing further attempted. Fix the account, then'
              f'\nre-run: completed modules are kept and only the rest are retried.')
        raise SystemExit(2)
    print(f"\nDONE in {el:.1f} min | ok {_stats['ok']} | failed {_stats['failed']} | retries {_stats['retries']}")
    print(f"  tokens in/out {_stats['in']:,}/{_stats['out']:,}")
    if _stats['ok']:
        print(f"  per module: {_stats['in']//_stats['ok']:,} in / {_stats['out']//_stats['ok']:,} out")


if __name__ == '__main__':
    main()

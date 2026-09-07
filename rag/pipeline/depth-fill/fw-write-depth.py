#!/opt/homebrew/bin/python3
"""Depth-fill writer — DeepSeek v4 Flash writes English candidate facts per MATATAG brief (BRIEF.md §2, §5, §7).

For every brief in briefs.json the prompt carries: the LC text, the quarter's Content title
(competency-content-map.json), the grade/register rules (BRIEF §5 + GENERATION-BRIEF.md), the three register
examples, `existing_facts_en` as an explicit DO-NOT-RESTATE list, card_form guidance for method cells (§2), and
the body-stream routing rule (human reproduction / genitalia → out/depth-body.jsonl).

Writes EXACTLY `target` candidates per code (rows already present in out/depth-candidates.jsonl + out/depth-body.jsonl
count — Lane B imports included — so the Flash quota is target − present). Resumable per code: a code whose count
already equals its target is skipped; a partial code is topped up. Body-stream sentences are never printed.

  set -a; . /Users/luis/Code/hiraia/.env.local; set +a
  FW_LIMIT=2 FW_CODES=G5-F-2,G7-E-2 /opt/homebrew/bin/python3 rag/pipeline/depth-fill/fw-write-depth.py   # dry run
  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/fw-write-depth.py                                        # everything

Env: FW_MODEL (writer; gpt-oss refused), FW_CONC (codes in flight, 6), FW_PER_CALL (facts per call, 20), FW_MAX_TOKENS (32000),
FW_LIMIT (max codes this run), FW_CODES (comma list of codes to restrict to), FW_THINKING (1 = DeepSeek thinking on, default 1),
FW_PRICE_IN / FW_PRICE_OUT (USD per M tokens for the ledger estimate; tokens are the authoritative record).
Ledger: out/write-ledger.json (tokens in/out per model, calls, per-code counts, rejects by reason).
"""
import collections, datetime, json, math, os, re, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(HERE, 'out')
BRIEFS = os.path.join(HERE, 'briefs.json')
CONTENT_MAP = os.path.join(ROOT, 'rag', 'sources', 'curriculum-guides', 'competency-content-map.json')
MAIN = os.path.join(OUT, 'depth-candidates.jsonl')
BODY = os.path.join(OUT, 'depth-body.jsonl')
LEDGER = os.path.join(OUT, 'write-ledger.json')
FW_URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-flash-0731')
CONC = int(os.environ.get('FW_CONC', '6'))
PER_CALL = int(os.environ.get('FW_PER_CALL', '20'))
MAX_TOKENS = int(os.environ.get('FW_MAX_TOKENS', '32000'))    # thinking on a 25-fact method cell ran past 16k → truncated, no array
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
CODES = {c.strip().upper() for c in os.environ.get('FW_CODES', '').split(',') if c.strip()}
THINKING = os.environ.get('FW_THINKING', '1') == '1'
PRICE_IN = float(os.environ.get('FW_PRICE_IN', '0.14'))      # tools/curriculum-tag-audit/fw_audit.py's Flash list prices
PRICE_OUT = float(os.environ.get('FW_PRICE_OUT', '0.28'))
MAX_ROUNDS_EXTRA = 3                                          # rounds beyond ceil(target / PER_CALL) before a code is left short
EN_WORDS = (15, 35)
MIN_TERMS = 6
DOMAINS = ('MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE')
STOP = {'that', 'this', 'with', 'from', 'they', 'their', 'them', 'when', 'what', 'which', 'because', 'about', 'into',
        'than', 'more', 'most', 'some', 'other', 'these', 'such', 'have', 'also', 'even', 'very', 'only', 'same',
        'there', 'where', 'while', 'been', 'were', 'does', 'each', 'both', 'much', 'many', 'like', 'just', 'still'}
# backstop for the model's own `body` flag (BRIEF §7): human reproduction / genitalia / puberty → body stream
BODY_RE = re.compile(r'\b(genital|penis|vagina|vulva|testic|testes|scrotum|ovar(y|ies)|uterus|womb|menstru|puberty|semen|'
                     r'sperm|erection|ejaculat|intercourse|pregnan|fertili[sz]ation of (a|the) (human|woman)|reproductive (organ|system))', re.I)

if 'gpt-oss' in MODEL:
    sys.exit('refusing: gpt-oss may not write in depth-fill (BRIEF §3)')

_lock = threading.Lock()
_ledger = None


def log(msg=''):
    print(msg, flush=True)


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]


def norm_text(s):
    return re.sub(r'\s+', ' ', str(s)).strip().strip('"“”').strip()


def en_key(en):
    return re.sub(r'[^a-z0-9 ]', '', en.lower())


def en_terms(topic, en):
    seen, out = set(), []
    for w in re.findall(r'[A-Za-z]{4,}', topic + ' ' + en):
        wl = w.lower()
        if wl not in STOP and wl not in seen:
            seen.add(wl); out.append(wl)
    return out[:10]


def merge_terms(*lists, cap=24):
    seen, out = set(), []
    for lst in lists:
        for t in lst or []:
            t = norm_text(t)
            if not t or len(t.split()) > 4 or t.lower() in seen:
                continue
            seen.add(t.lower()); out.append(t)
    return out[:cap]


# ───────────────────────────── ledger ─────────────────────────────

def load_ledger():
    if os.path.exists(LEDGER):
        return json.load(open(LEDGER))
    return dict(scheme='depth-fill writer ledger: tokens per model (authoritative), USD estimate at FW_PRICE_IN/OUT, per-code counts',
                models={}, per_code={}, rejects={}, runs=[])


def save_ledger():
    tmp = LEDGER + '.tmp'
    json.dump(_ledger, open(tmp, 'w'), indent=1)
    os.replace(tmp, LEDGER)


def book(model, tin, tout, ok=True):
    m = _ledger['models'].setdefault(model, dict(calls=0, failed=0, tokens_in=0, tokens_out=0, est_usd=0.0))
    m['calls'] += 1
    if not ok:
        m['failed'] += 1
    m['tokens_in'] += tin; m['tokens_out'] += tout
    m['est_usd'] = round(m['tokens_in'] / 1e6 * PRICE_IN + m['tokens_out'] / 1e6 * PRICE_OUT, 4)
    save_ledger()


# ───────────────────────────── Fireworks ─────────────────────────────

def call(prompt, attempt=0):
    body = {'model': MODEL, 'temperature': 0.6, 'max_tokens': MAX_TOKENS,
            'messages': [{'role': 'user', 'content': prompt}]}
    if 'deepseek' in MODEL:
        body['chat_template_kwargs'] = {'thinking': THINKING}
    req = urllib.request.Request(FW_URL, data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {os.environ["FIREWORKS_API_KEY"]}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=900))
        ch = r['choices'][0]; m = ch['message']; u = r.get('usage', {})
        return (m.get('content') or ''), (m.get('reasoning_content') or ''), u.get('prompt_tokens', 0), u.get('completion_tokens', 0), ch.get('finish_reason')
    except urllib.error.HTTPError as e:
        if e.code in (412, 429, 500, 502, 503, 529) and attempt < 6:
            ra = e.headers.get('Retry-After'); time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise


def arr_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip(); a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except ValueError:
                pass
    return None


# ───────────────────────────── prompt ─────────────────────────────

EXAMPLES = '''REGISTER EXAMPLES (match this bar)
1. Content cell G9-M-4 (valence electrons from position on the periodic table) — serves the competency's idea, not just its nouns:
{"topic":"oxygen valence electrons","en":"Oxygen sits in group 16 of the periodic table, so an oxygen atom has six valence electrons in its outer shell.","terms":["oxygen","valence","group 16","periodic table","electron","oksiheno","elektron"],"source":"periodic table group number = valence electrons for main-group elements","card_form":"fact","confidence":3,"body":false}
2. Process cell G5-F-2 (plan a fair test of friction on different surfaces) — a METHOD fact, how a class actually does it, not "go do the activity":
{"topic":"fair test of friction","en":"A fair test of friction keeps the same toy car and the same ramp, and only changes the surface under the wheels.","terms":["fair test","friction","toy car","ramp","surface","patas na pagsubok","kuskos","salog"],"source":"fair-test design: one variable changed, the rest held constant","card_form":"method","confidence":3,"body":false}
3. Debate cell G10-L-9 (implications of biotechnology) — the CONTENT of the debate, not "hold a debate":
{"topic":"Golden Rice and vitamin A","en":"Golden Rice is a genetically modified rice whose grains make beta-carotene, which the body turns into vitamin A, so it was designed to fight vitamin A deficiency.","terms":["Golden Rice","GMO","beta-carotene","vitamin A","genetically modified","bigas","bitamina A","humay"],"source":"encyclopedia-stable; Golden Rice / IRRI","card_form":"fact","confidence":3,"body":false}
'''

RULES = '''RULES
- One idea, ONE English sentence, 15–35 words. Aim a year younger than the grade label: plain words, concrete, no jargon without a hint of what it means.
- Consensus science only. No invented numbers, names, dates, or mechanisms. Rounded published values with "about". If unsure, leave that fact out and write a different one.
- Serve THIS competency's idea (the "why" and "how"), not merely its nouns. Cover different sub-ideas so the set teaches the whole competency: definitions, causes, examples, comparisons, common-misconception-stated-correctly, real-world and Philippine cases (PAGASA, PHIVOLCS, Mayon, Taal, palay, bakawan, jeepney) where natural — but facts about the world, not only the Philippines.
- Safe: no frightening framing, no dangerous experiments, no medical advice.
- Every fact must be DIFFERENT from every other fact you write and from every fact in the DO-NOT-RESTATE lists below (not a paraphrase, not the same claim with new words).
- "terms": 6–10 lowercase search words or short phrases a Filipino kid would type — the English science terms PLUS Tagalog and Bisaya content words (nouns/verbs) for the same ideas. Proper nouns keep their capitals.
- "source": a short grounding note (framework strand, "encyclopedia-stable", the named agency or textbook fact) — not a URL.
- "card_form": "fact" for a content fact; "method" for how scientists or a class actually do / measure / test the thing.
- "confidence": 3 = certain and encyclopedia-stable; 2 = correct but simplified or a rounded value. Never include anything you would rate 1.
- "body": true ONLY if the fact is about human reproduction, reproductive organs / genitalia, puberty body changes, or sexual health (it is routed to a restricted stream). Digestion, DNA, classification, GMO crops, animal or plant reproduction stay false.
'''

FORM_GUIDE = {
    'method': '''CELL FORM: this is a process / method cell (fact_able is low). Do NOT write "go do the activity", "students should", "try this", or a question.
Write METHOD facts — how scientists or a class actually do the thing: what is kept the same and what is changed in a fair test, what is measured and with which instrument, in what order the steps go, why a step matters, what a good record or graph of it looks like, what a result would mean. Each one is still a declarative, verifiable sentence about how the method works.''',
    'fact': '''CELL FORM: this is a content cell. Write encyclopedia facts that explain the competency's idea: what it is, why it happens, a concrete example, a comparison, a number kids can picture. If the LC says "use a diagram / model / flow chart", that is only presentation — write the science content the diagram would show (the steps, parts, and relationships).''',
    'quiz': '''CELL FORM: this is a lookup-style content cell (it may later be quizzed). Write short encyclopedia facts that state the lookup clearly and explain WHY it is so (the rule behind it), plus concrete examples and contrasts, so a kid could answer a quiz on it from the cards.''',
}


def form_of(brief):
    f = (brief.get('card_form') or 'fact').lower()
    if f in ('method', 'activity prompt', 'did-you-know about a method'):
        return 'method'
    if f == 'quiz':
        return 'quiz'
    return 'fact'


def prompt_for(brief, content_title, n, avoid_existing, avoid_written):
    form = form_of(brief)
    g = brief['grade']
    lines = [
        'You write encyclopedia facts for Hiraia, an offline science tutor for Filipino grade-school kids (DepEd MATATAG Science). '
        'Each fact becomes one illustrated card in a feed; the whole set for a competency should let a kid learn that competency from the cards.',
        '',
        'TARGET COMPETENCY',
        f"code: {brief['code']} | Grade {g}, Quarter {brief['quarter']} | domain: {brief['domain']}",
        f'quarter content title: "{content_title}"' if content_title else 'quarter content title: (not mapped)',
        f'learning competency: "{brief["competency"]}"',
        f"cell kind: {brief.get('kind', 'content')} (fact_able {brief.get('fact_able')}) | expected card_form: {'method' if form == 'method' else 'fact'}",
        '',
        FORM_GUIDE[form],
        '',
        RULES,
        EXAMPLES,
    ]
    if avoid_existing:
        lines += ['EXISTING CARDS FOR THIS COMPETENCY — DO NOT RESTATE ANY OF THESE (they are already in the feed):']
        lines += [f'- {t}' for t in avoid_existing]
        lines += ['']
    if avoid_written:
        lines += ['ALREADY WRITTEN FOR THIS COMPETENCY — DO NOT RESTATE THESE EITHER:']
        lines += [f'- {t}' for t in avoid_written]
        lines += ['']
    lines += [
        f'TASK: write exactly {n} NEW facts for this competency, each a different sub-idea, following every rule above.',
        'Output ONLY a JSON array of exactly ' + str(n) + ' objects, no prose before or after:',
        '[{"topic":"3-6 word English label","en":"one sentence, 15-35 words","terms":["..."],"source":"...","card_form":"fact","confidence":3,"body":false}]',
    ]
    return '\n'.join(lines)


# ───────────────────────────── validation ─────────────────────────────

def validate(o, brief, seen_keys):
    """→ (row | None, reason). Never prints text."""
    if not isinstance(o, dict):
        return None, 'not-object'
    en = norm_text(o.get('en') or '')
    nw = len(en.split())
    if not en:
        return None, 'en-missing'
    if not (EN_WORDS[0] <= nw <= EN_WORDS[1]):
        return None, f'en-words'
    if en.count('. ') >= 1 and not re.search(r'\b(e\.g|i\.e|vs|approx|Dr|St|Mt)\. ', en):
        return None, 'en-multi-sentence'
    if en[-1] not in '.!':
        en += '.'
    if re.match(r'^(students?|pupils?|learners?|you|let us|try|plan|conduct|make|measure|observe|record)\b', en, re.I) and form_of(brief) == 'method':
        return None, 'activity-prompt-voice'
    key = en_key(en)
    if key in seen_keys:
        return None, 'restates-existing'
    topic = norm_text(o.get('topic') or '')
    if not topic:
        return None, 'topic-missing'
    if len(topic.split()) > 15:
        topic = ' '.join(topic.split()[:12])
    try:
        conf = int(float(o.get('confidence')))
    except (TypeError, ValueError):
        return None, 'confidence-missing'
    if conf not in (2, 3):
        return None, 'confidence<2'
    terms = merge_terms([t for t in (o.get('terms') or []) if isinstance(t, str)])
    if len(terms) < MIN_TERMS:                          # ingest adds the English content-word floor at emit; here it is only a fallback
        terms = merge_terms(terms, en_terms(topic, en))
    if len(terms) < MIN_TERMS:
        return None, 'terms<6'
    cf = norm_text(o.get('card_form') or '').lower()
    if cf not in ('fact', 'method'):
        cf = 'method' if form_of(brief) == 'method' else 'fact'
    body = bool(o.get('body')) or bool(BODY_RE.search(en)) or bool(BODY_RE.search(topic))
    source = norm_text(o.get('source') or '')[:160] or 'encyclopedia-stable'
    return dict(brief_code=brief['code'], domain=brief['domain'], topic=topic, grades=[brief['grade']], en=en, tl='', bis='',
                terms=terms, source=source, card_form=cf, confidence=conf, _body=body), ''


# ───────────────────────────── per-code driver ─────────────────────────────

class State:
    """Counts + next tmp_id ordinal per code, read once from both streams, then advanced under the lock."""

    def __init__(self):
        self.count = collections.Counter()
        self.max_ord = collections.Counter()
        self.keys = collections.defaultdict(set)         # code → en keys already present (both streams)
        self.written_en = collections.defaultdict(list)  # code → MAIN-stream en already present (for the prompt; body text never leaves disk)
        self.body_count = collections.Counter()
        for path, is_body in ((MAIN, False), (BODY, True)):
            for r in read_jsonl(path):
                code = r.get('brief_code')
                self.count[code] += 1
                m = re.match(rf'^depth-{re.escape(code)}-(\d+)$', r.get('tmp_id', ''))
                if m:
                    self.max_ord[code] = max(self.max_ord[code], int(m.group(1)))
                self.keys[code].add(en_key(r.get('en', '')))
                if is_body:
                    self.body_count[code] += 1
                else:
                    self.written_en[code].append(r['en'])

    def append(self, code, rows):
        """rows carry _body; assign tmp_ids and append to the right stream. Caller holds no lock; we take it."""
        with _lock:
            fm = open(MAIN, 'a', encoding='utf-8'); fb = open(BODY, 'a', encoding='utf-8')
            try:
                for r in rows:
                    self.max_ord[code] += 1
                    r['tmp_id'] = f"depth-{code}-{self.max_ord[code]:03d}"
                    body = r.pop('_body')
                    out = dict(tmp_id=r['tmp_id'], **{k: v for k, v in r.items() if k != 'tmp_id'})
                    (fb if body else fm).write(json.dumps(out, ensure_ascii=False) + '\n')
                    self.count[code] += 1
                    self.keys[code].add(en_key(r['en']))
                    if body:
                        self.body_count[code] += 1
                    else:
                        self.written_en[code].append(r['en'])
            finally:
                fm.close(); fb.close()


def do_code(brief, content_title, state):
    code = brief['code']
    target = brief['target']
    rej = collections.Counter()
    rounds = 0
    max_rounds = math.ceil(target / PER_CALL) + MAX_ROUNDS_EXTRA
    calls = 0
    while state.count[code] < target and rounds < max_rounds:
        rounds += 1
        need = target - state.count[code]
        n = min(need, PER_CALL)
        with _lock:
            written = list(state.written_en[code])
            keys = set(state.keys[code]) | {en_key(t) for t in brief.get('existing_facts_en') or []}
        prompt = prompt_for(brief, content_title, n, brief.get('existing_facts_en') or [], written)
        try:
            c, rc, tin, tout, fin = call(prompt)
        except Exception as e:
            with _lock:
                book(MODEL, 0, 0, ok=False)
            log(f'  FAIL {code} round {rounds}: {type(e).__name__}')
            continue
        calls += 1
        with _lock:
            book(MODEL, tin, tout)
        arr = arr_from(c, rc)
        if not isinstance(arr, list):
            rej['truncated' if fin == 'length' else 'no-json-array'] += 1
            log(f'  {code} round {rounds}: no JSON array in the reply (finish_reason={fin}, completion tokens {tout:,})')
            continue
        good, batch_keys = [], set()
        for o in arr:
            row, why = validate(o, brief, keys | batch_keys)
            if row is None:
                rej[why] += 1; continue
            batch_keys.add(en_key(row['en']))
            good.append(row)
            if len(good) >= need:
                break                                     # never exceed target
        state.append(code, good)
        log(f'  {code} round {rounds}: +{len(good)} (asked {n}, got {len(arr)}) → {state.count[code]}/{target}'
            + (f' [body {state.body_count[code]}]' if state.body_count[code] else '')
            + (f' | rejected {dict(rej)}' if rej else ''))
    with _lock:
        _ledger['per_code'][code] = dict(target=target, have=state.count[code], body=state.body_count[code], calls=calls, rounds=rounds,
                                         short=max(0, target - state.count[code]), when=datetime.datetime.now().isoformat(timespec='seconds'))
        for k, v in rej.items():
            _ledger['rejects'][k] = _ledger['rejects'].get(k, 0) + v
        save_ledger()
    return code, state.count[code], target


def main():
    global _ledger
    if not os.environ.get('FIREWORKS_API_KEY'):
        sys.exit('FIREWORKS_API_KEY missing — set -a; . /Users/luis/Code/hiraia/.env.local; set +a')
    os.makedirs(OUT, exist_ok=True)
    for p in (MAIN, BODY):
        if not os.path.exists(p):
            open(p, 'a').close()
    briefs = json.load(open(BRIEFS))['briefs']
    cmap = json.load(open(CONTENT_MAP))['map']
    _ledger = load_ledger()
    state = State()
    todo = [b for b in briefs if b['target'] > state.count[b['code']] and (not CODES or b['code'] in CODES)]
    done = [b for b in briefs if b['target'] <= state.count[b['code']]]
    over = [(b['code'], state.count[b['code']], b['target']) for b in briefs if state.count[b['code']] > b['target']]
    if LIMIT:
        todo = todo[:LIMIT]
    remaining = sum(b['target'] - state.count[b['code']] for b in todo)
    log(f'depth-fill writer | {MODEL} | thinking={THINKING} | briefs {len(briefs)} | complete {len(done)} | this run {len(todo)} codes, '
        f'{remaining} facts to write (per call {PER_CALL}, conc {CONC})')
    if over:
        log(f'  over target (Lane B imports exceed target; nothing written for these): {over}')
    t0 = time.time()
    _ledger['runs'].append(dict(started=datetime.datetime.now().isoformat(timespec='seconds'), model=MODEL, codes=[b['code'] for b in todo],
                                limit=LIMIT, per_call=PER_CALL, thinking=THINKING))
    save_ledger()
    results = []
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_code, b, (cmap.get(b['code']) or {}).get('title', ''), state) for b in todo]
        for f in as_completed(futs):
            results.append(f.result())
    short = [(c, h, t) for c, h, t in results if h < t]
    m = _ledger['models'].get(MODEL, {})
    _ledger['runs'][-1].update(finished=datetime.datetime.now().isoformat(timespec='seconds'), seconds=round(time.time() - t0),
                               short=short, tokens_in_total=m.get('tokens_in'), tokens_out_total=m.get('tokens_out'))
    save_ledger()
    total_main = len(read_jsonl(MAIN)); total_body = len(read_jsonl(BODY))
    log(f'\nDONE in {(time.time() - t0) / 60:.1f} min | codes this run {len(results)} | short of target: {short if short else "none"}')
    log(f'ledger {MODEL}: calls {m.get("calls")} (failed {m.get("failed")}) | tokens in/out {m.get("tokens_in", 0):,}/{m.get("tokens_out", 0):,} '
        f'| est ${m.get("est_usd", 0):.4f} at ${PRICE_IN}/${PRICE_OUT} per M → {os.path.relpath(LEDGER, ROOT)}')
    log(f'candidates on disk: main {total_main} | body {total_body} (ids/counts only)')


if __name__ == '__main__':
    main()

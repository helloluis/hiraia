#!/usr/bin/env python3
"""Editorial pass over the whole card deck: emphasis, concision, and question balance.

Three jobs, all of which the generator could not do well because they need the finished card
in front of you rather than a module:

  emphasis   The one or two words the card is actually ABOUT, returned as EXACT substrings of
             the text so the renderer can find and set them differently. Exactness is the
             whole contract: anything that is not found verbatim is dropped rather than
             fuzzy-matched, because a near-match would emphasise the wrong span.
  concise    A tighter rewrite where one exists WITHOUT losing meaning. Not a summary and not
             a style edit — if the card is already tight the model must say so, and most will.
  question   On a two-part card the question must be SHORTER than its answer. It is a hook,
             not the payload; a question carrying all the information leaves the answer as an
             anticlimax. 58 of 2,485 cards break this outright and another 142 come close,
             nearly all computational word problems where the setup holds the data.

Also flags `poster`: cards that would be STRONGER as pure typography than with a picture.
Definitions, laws, formulas and numbers often are — that judgement decides which cards get
the poster layout by choice rather than by missing art.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-editorial-pass.py
  FW_LIMIT=60 python3 rag/pipeline/fw-editorial-pass.py    # calibration slice

Writes rag/pipeline/editorial.json, keyed by card id; re-runs skip what is already decided.

Env: FW_MODEL, FW_CONC, FW_BATCH, FW_LIMIT, POOL.
"""
import os, json, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(os.path.dirname(ROOT), 'hiraia-card-ui')
POOL = os.environ.get('POOL', os.path.join(UI, 'packages/mobile/src/generated/cardsPool.generated.json'))
OUT = os.path.join(HERE, 'editorial.json')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '6'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
LANGS = ('tl', 'en', 'bis')
SEP = '\n\n'

_lock = threading.Lock()
_stats = collections.Counter()
_T0 = time.time()


def call(prompt, attempt=0):
    payload = {'model': MODEL, 'temperature': 0.2, 'max_tokens': 8000,
               'chat_template_kwargs': {'thinking': False},
               'messages': [{'role': 'user', 'content': prompt}]}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=600))
        u = r.get('usage', {})
        with _lock:
            _stats['in'] += u.get('prompt_tokens', 0)
            _stats['out'] += u.get('completion_tokens', 0)
        return r['choices'][0]['message'].get('content') or ''
    except urllib.error.HTTPError as e:
        if e.code in (412, 429, 500, 502, 503, 529) and attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise


def obj_from(s):
    a, b = s.find('{'), s.rfind('}')
    if a >= 0 and b > a:
        try:
            return json.loads(s[a:b + 1])
        except Exception:
            return None
    return None


def prompt_for(batch):
    blocks = []
    for n, c in enumerate(batch, 1):
        f = c['fact']
        qa = SEP in f['tl']
        blocks.append(
            f'  CARD {n}   grade {c.get("grade","?")}   {"TWO-PART (question + answer)" if qa else "STATEMENT"}\n'
            f'   tl  {f["tl"]}\n   en  {f["en"]}\n   bis {f.get("bis","")}')
    return f'''You are the editor of a deck of science cards for Filipino schoolchildren (~10 years
old). Each card is read ALONE. For each card below do three things.

Return STRICT JSON only:
{{"cards": [{{"card": 1,
   "emphasis": {{"tl": ["..."], "en": ["..."], "bis": ["..."]}},
   "concise": {{"tl": "...", "en": "...", "bis": "..."}} | null,
   "poster": true | false}}]}}

1. EMPHASIS — the one or two words this card is ABOUT: the term being taught, or the number
   that is the point. Not a verb, not a whole clause, not a phrase a reader already knows.
   Give 1 or 2 per language, usually 1.
   - Each string MUST appear EXACTLY in that language's text, character for character,
     including any accents and hyphens. Copy it out of the text; do not retype it.
   - Pick the same idea in all three languages ("kinetic energy" / "kinetic energy" /
     "kinetic energy"), not a different word in each.
   - If nothing genuinely stands out, use an empty list for that language. That is a normal
     answer and is better than emphasising something ordinary.

2. CONCISE — rewrite ONLY if the card can be said in meaningfully fewer words WITHOUT losing
   any meaning, any number, or any glossed term. Return null when it is already tight, which
   will be the common answer. This is not summarising and not restyling: keep every fact,
   keep the glosses that explain technical words, keep the warmth. Rewrite all three
   languages together or return null. Remove padding of this kind:
     "ay isang proseso kung saan ang" -> "ay ang"
     "It is important to note that X" -> "X"
     doubled clauses that restate the subject, and empty intensifiers.

{f"""3. QUESTION LENGTH (two-part cards only) — the question must end up SHORTER than its
   answer. It is a hook, not the payload. If the question is as long as or longer than the
   answer, put a shortened question in `concise` (keeping the blank line between the two
   halves). Keep any numbers a reader needs to answer it, but cut narrative setup:
     "Isang estudyanteng naglalakad sa 2 m/s ay tumakbo nang mabilis papuntang 7 m/s sa loob
      ng 4 segundo. Ano ang acceleration niya?"
     -> "Mula 2 m/s hanggang 7 m/s sa 4 segundo — ano ang acceleration?"
   If shortening the question would drop information the answer needs, leave it and return
   null."""}

4. POSTER — true if this card would be STRONGER set as pure typography than paired with a
   picture. Definitions, named laws, formulas, and single striking numbers usually are:
   there is nothing to draw, and big type carries them better than a literal illustration.
   A card about a specific animal, plant, place, organ or physical scene is false — those
   genuinely want a picture. Judge the card, not the availability of art.

CARDS
{chr(10).join(blocks)}'''


def do_batch(batch):
    try:
        got = obj_from(call(prompt_for(batch)))
    except Exception as e:
        with _lock:
            _stats['failed'] += len(batch)
        print(f'  FAIL: {type(e).__name__}', flush=True)
        return {}
    by = {}
    for r in (got or {}).get('cards') or []:
        try:
            n = int(r['card'])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= n <= len(batch):
            continue
        c = batch[n - 1]
        # EMPHASIS: keep only spans that are exactly present. A near-match would style the
        # wrong characters, which is worse than no emphasis at all.
        emph = {}
        for lang in LANGS:
            text = c['fact'].get(lang) or ''
            keep = []
            for s in ((r.get('emphasis') or {}).get(lang) or [])[:2]:
                s = str(s).strip()
                if s and s in text and len(s) < len(text) * 0.5:
                    keep.append(s)
                elif s:
                    with _lock:
                        _stats['emphasis_rejected'] += 1
            emph[lang] = keep
        con = r.get('concise')
        if isinstance(con, dict) and con.get('tl') and con.get('en'):
            # a "concise" rewrite that grew is not concise
            if len(con['tl']) >= len(c['fact']['tl']):
                with _lock:
                    _stats['concise_rejected_longer'] += 1
                con = None
            elif (SEP in c['fact']['tl']) and SEP not in (con.get('tl') or ''):
                with _lock:
                    _stats['concise_rejected_shape'] += 1
                con = None
        else:
            con = None
        by[c['id']] = {'emphasis': emph, 'concise': con, 'poster': bool(r.get('poster'))}
    with _lock:
        _stats['done'] += len(batch)
        _stats['emphasised'] += sum(1 for v in by.values() if v['emphasis'].get('tl'))
        _stats['rewritten'] += sum(1 for v in by.values() if v['concise'])
        _stats['poster'] += sum(1 for v in by.values() if v['poster'])
        if _stats['done'] % 1200 < BATCH:
            el = (time.time() - _T0) / 60
            cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
            print(f"  ...{_stats['done']:,} cards | emph {_stats['emphasised']:,} | "
                  f"tightened {_stats['rewritten']:,} | poster {_stats['poster']:,} | "
                  f"${cost:.2f} | {el:.1f} min", flush=True)
    return by


def main():
    # The whole deck. The original 16,989 were never edited this way either — they were
    # written a card at a time, so nothing ever looked across them for padding, for a
    # question that outweighs its answer (61 of theirs do), or for the term worth setting
    # differently. Their prose won the blind comparison; that is a reason to leave the VOICE
    # alone, not a reason to skip the pass.
    want = os.environ.get('SOURCE', 'all')
    cards = [c for c in json.load(open(POOL))['cards']
             if want == 'all' or c.get('source', 'original') == want]
    done = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [c for c in cards if c['id'] not in done]
    if LIMIT:
        step = max(1, len(todo) // LIMIT)
        todo = todo[::step][:LIMIT]
    print(f'{len(cards):,} cards in scope ({want}) | {len(done):,} already edited | {len(todo):,} to do')
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    print(f'  {len(batches):,} batches of {BATCH} | conc {CONC}')

    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_batch, b) for b in batches]
        for n, f in enumerate(as_completed(futs), 1):
            done.update(f.result())
            if n % 120 == 0:
                json.dump(done, open(OUT, 'w'), ensure_ascii=False)
    json.dump(done, open(OUT, 'w'), ensure_ascii=False)

    cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
    n = max(len(done), 1)
    print(f"\nDONE in {(time.time()-_T0)/60:.1f} min | ${cost:.2f} | failed {_stats['failed']}")
    print(f"  {len(done):,} cards edited")
    print(f"  with emphasis        {sum(1 for v in done.values() if v['emphasis'].get('tl')):,}")
    print(f"  tightened            {sum(1 for v in done.values() if v['concise']):,}")
    print(f"  better as a poster   {sum(1 for v in done.values() if v['poster']):,}")
    print(f"  emphasis spans dropped for not matching exactly: {_stats['emphasis_rejected']:,}")
    print(f"  rewrites rejected (longer / wrong shape): "
          f"{_stats['concise_rejected_longer']:,} / {_stats['concise_rejected_shape']:,}")


if __name__ == '__main__':
    main()

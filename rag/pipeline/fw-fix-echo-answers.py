#!/usr/bin/env python3
"""Rewrite answers that repeat their own question back.

1,034 two-part cards (10.4%) open the answer by restating the question almost word for word:

  Q: Bakit hindi basta makakalipat ang tandikan sa ibang isla?
  A: Hindi basta-basta makakalipat ang tandikan sa ibang isla—nasanay na ito sa ...

The reader has just read that clause. Spending the answer's opening on it wastes the part of
the card that was supposed to pay off, and on a poster card it wastes the largest type on the
page. Some echo is natural — an answer often picks up a word or two from its question — so
this only touches answers that repeat 75% or more of the question's content words, and it
changes ONLY the answer.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-fix-echo-answers.py

Merges into editorial.json as a `concise` rewrite, so it flows through wire-app-pool.py with
everything else and is re-validated against the emphasis spans there.

Env: FW_MODEL, FW_CONC, FW_BATCH.
"""
import os, json, re, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(os.path.dirname(ROOT), 'hiraia-card-ui')
POOL = os.path.join(UI, 'rag/pipeline/cardsPool.app.json')
IDS = os.path.join(HERE, 'echo-answer-ids.json')
ED = os.path.join(HERE, 'editorial.json')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '6'))
SEP = '\n\n'
LANGS = ('tl', 'en', 'bis')
_lock = threading.Lock()
_stats = collections.Counter()
_T0 = time.time()


def halves(t):
    return t.split(SEP, 1) if SEP in t else (t, '')


def overlap(q, a):
    qw = [w for w in re.findall(r'\w+', q.lower()) if len(w) > 3]
    if len(qw) < 4:
        return 0.0
    aw = set(re.findall(r'\w+', a.lower()))
    return sum(1 for w in qw if w in aw) / len(qw)


def call(prompt, attempt=0):
    payload = {'model': MODEL, 'temperature': 0.3, 'max_tokens': 8000,
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
        rows = []
        for lang in LANGS:
            q, a = halves(c['fact'].get(lang) or '')
            rows.append(f'   {lang} Q: {q}\n   {lang} A: {a}')
        blocks.append(f'  CARD {n}\n' + '\n'.join(rows))
    return f'''Each answer below opens by repeating its own question back. Rewrite the ANSWERS so they
do not.

The child has just read the question. An answer that restates it spends its best line saying
nothing new — and on these cards the answer is set in the largest type on the page, so the
waste is the most visible thing there.

Return STRICT JSON only:
{{"cards": [{{"card": 1, "a": {{"tl": "...", "en": "...", "bis": "..."}}}}]}}

RULES
- Return ONLY the answer for each language. The question is NOT changing — do not return it,
  and do not include the blank line.
- Keep EVERY fact, number, name and glossed term that is in the answer now. This removes
  repetition, not content. If the answer explains a technical word, keep that explanation.
- Go straight to the substance. Where the answer now begins by echoing the question, start
  instead with the thing the reader came for:
    Q: Bakit hindi basta makakalipat ang tandikan sa ibang isla?
    A: Hindi basta-basta makakalipat ang tandikan sa ibang isla—nasanay na ito sa
       natatanging gubat ng isla nito.
    -> Nasanay na ito sa natatanging gubat ng isla nito, kaya hirap itong mabuhay sa iba.
- Naming the subject once is FINE and often necessary — "Ang paniki!" answering "Anong mammal
  ang nakakalipad?" is good writing. What must go is repeating the question's whole clause.
- Keep the warmth and the voice. An answer may still open with "Oo!", "Hindi!" or the name of
  the thing, and may keep one "!".
- Keep the length similar or shorter. Never longer.
- Language: Tagalog as a teacher speaks it; real Cebuano for bis ("ug", "kini", "dili");
  keep English science terms rather than inventing formal translations.

CARDS
{chr(10).join(blocks)}'''


def do_batch(batch):
    try:
        got = obj_from(call(prompt_for(batch)))
    except Exception as e:
        with _lock:
            _stats['failed'] += len(batch)
        print(f'  FAIL {type(e).__name__}', flush=True)
        return {}
    out = {}
    for r in (got or {}).get('cards') or []:
        try:
            n = int(r['card'])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= n <= len(batch):
            continue
        c = batch[n - 1]
        ans = r.get('a') or {}
        rebuilt, ok = {}, True
        for lang in LANGS:
            q, olda = halves(c['fact'].get(lang) or '')
            new = str(ans.get(lang) or '').strip()
            if not new or not q:
                ok = False
                break
            # must actually reduce the echo, and must not balloon
            if lang == 'tl':
                if overlap(q, new) >= overlap(q, olda) - 0.1:
                    ok = False
                    break
                if len(new) > len(olda) * 1.1:
                    ok = False
                    break
            rebuilt[lang] = q + SEP + new
        if not ok:
            with _lock:
                _stats['rejected'] += 1
            continue
        out[c['id']] = rebuilt
        with _lock:
            _stats['fixed'] += 1
    with _lock:
        _stats['done'] += len(batch)
        if _stats['done'] % 300 < BATCH:
            cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
            print(f"  ...{_stats['done']:,} | fixed {_stats['fixed']:,} | "
                  f"rejected {_stats['rejected']:,} | ${cost:.2f}", flush=True)
    return out


def main():
    ids = set(json.load(open(IDS)))
    pool = {c['id']: c for c in json.load(open(POOL))['cards']}
    cards = [pool[i] for i in ids if i in pool]
    print(f'{len(cards):,} cards whose answer echoes its question')
    batches = [cards[i:i + BATCH] for i in range(0, len(cards), BATCH)]
    merged = {}
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for f in as_completed([ex.submit(do_batch, b) for b in batches]):
            merged.update(f.result())

    ed = json.load(open(ED)) if os.path.exists(ED) else {}
    for cid, fact in merged.items():
        rec = ed.setdefault(cid, {'emphasis': {}, 'concise': None, 'poster': False})
        rec['concise'] = fact
    json.dump(ed, open(ED, 'w'), ensure_ascii=False)

    cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
    print(f"\nDONE in {(time.time()-_T0)/60:.1f} min | ${cost:.2f}")
    print(f"  de-echoed {_stats['fixed']:,} | rejected {_stats['rejected']:,} | failed {_stats['failed']}")
    print(f'  merged into {os.path.basename(ED)}')


if __name__ == '__main__':
    main()

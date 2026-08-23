#!/usr/bin/env python3
"""Second pass on the 159 two-part cards whose QUESTION outweighs its answer.

The editorial pass fixed only 13 of these. It was given an escape clause — leave the question
alone if shortening would drop something the answer needs — and leaned on it. Read back, the
misses are plainly fixable:

  "Bakit ang langis ng niyog ay isang popular na sangkap sa paggawa ng natural na sabon sa
   Pilipinas?"  (98 chars, against a 62-char answer)

so this pass removes the escape clause and does one job on one narrow set, where a firm
instruction cannot do collateral damage.

A question is a HOOK. It earns its place by making the reader want the answer; when it is
longer than the answer it has already done the teaching and the payoff reads as an
afterthought. Cutting it is not lossy — the information belongs on the answer side.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-tighten-questions.py

Merges into editorial.json, overwriting `concise` only for these ids.

Env: FW_MODEL, FW_CONC, FW_BATCH.
"""
import os, json, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(os.path.dirname(ROOT), 'hiraia-card-ui')
POOL = os.path.join(UI, 'packages/mobile/src/generated/cardsPool.generated.json')
IDS = os.path.join(HERE, 'long-question-ids.json')
ED = os.path.join(HERE, 'editorial.json')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '12'))
BATCH = int(os.environ.get('FW_BATCH', '5'))
SEP = '\n\n'
LANGS = ('tl', 'en', 'bis')
_lock = threading.Lock()
_stats = collections.Counter()


def halves(t):
    return t.split(SEP, 1) if SEP in t else (t, '')


def call(prompt, attempt=0):
    payload = {'model': MODEL, 'temperature': 0.3, 'max_tokens': 6000,
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
            rows.append(f'   {lang} Q ({len(q)}): {q}\n   {lang} A ({len(a)}): {a}')
        blocks.append(f'  CARD {n}\n' + '\n'.join(rows))
    return f'''These science cards for Filipino children have a QUESTION that is too long — as long as
or longer than the answer it sets up. Shorten every question.

A question is a HOOK. It makes a child want the answer; it is not where the teaching goes.
When it outweighs the answer it has already given the lesson away and the answer reads as an
afterthought.

Return STRICT JSON only:
{{"cards": [{{"card": 1, "q": {{"tl": "...", "en": "...", "bis": "..."}}}}]}}

RULES
- Return ONLY the shortened question for each language. Do NOT return the answer; it is not
  changing and must not be touched.
- Cut it to roughly HALF its current length, and in every case it must end up clearly
  shorter than its own answer.
- Keep any NUMBER or given value the answer depends on to make sense — a word problem still
  needs its figures. Cut the narrative around them instead:
    "Isang estudyanteng naglalakad sa 2 m/s ay tumakbo nang mabilis papuntang 7 m/s sa loob
     ng 4 segundo. Ano ang acceleration niya?"
    -> "Mula 2 m/s hanggang 7 m/s sa 4 segundo — ano ang acceleration?"
- Cut scene-setting that the answer does not use: place names, "sa Pilipinas", "kapag
  bumibisita", "ay isang popular na sangkap sa paggawa ng".
    "Bakit ang langis ng niyog ay isang popular na sangkap sa paggawa ng natural na sabon sa
     Pilipinas?"  ->  "Bakit magandang sabon ang gawa sa langis ng niyog?"
- Keep it a real question a 10-year-old would ask, ending in "?". Keep the language natural:
  Tagalog as a teacher speaks it, real Cebuano for bis, and keep English science terms
  ("kinetic energy", "carbon dioxide") rather than inventing formal translations.
- Shorten all three languages consistently — the same question, not three different ones.

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
        q = r.get('q') or {}
        rebuilt, ok = {}, True
        for lang in LANGS:
            oldq, a = halves(c['fact'].get(lang) or '')
            new = str(q.get(lang) or '').strip()
            # a "shortened" question that did not shorten is not an answer to the problem
            if not new or len(new) >= len(oldq) or not a:
                ok = False
                break
            rebuilt[lang] = new + SEP + a
        if not ok:
            with _lock:
                _stats['rejected'] += 1
            continue
        out[c['id']] = rebuilt
        with _lock:
            _stats['fixed'] += 1
            _stats['saved'] += len(c['fact']['tl']) - len(rebuilt['tl'])
    return out


def main():
    ids = set(json.load(open(IDS)))
    pool = {c['id']: c for c in json.load(open(POOL))['cards']}
    cards = [pool[i] for i in ids if i in pool]
    print(f'{len(cards)} cards with an over-long question')
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
    print(f"\nshortened {_stats['fixed']}/{len(cards)} | rejected {_stats['rejected']} | "
          f"failed {_stats['failed']} | ${cost:.2f}")
    if _stats['fixed']:
        print(f"  mean saving: {_stats['saved']/_stats['fixed']:.0f} chars per card")
    print(f'  merged into {os.path.basename(ED)}')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""STAGE C2 — fix Tagalog and Cebuano wording errors WITHOUT touching what the card says.

Blind judging put the new bank level with the old one on glossing and accuracy but still
behind on language, and the remaining faults are small and mechanical, not structural:
  Umiakyat      -> umaakyat        (wrong aspect)
  ninguya       -> nginunguya      (misformed verb)
  kumokontra    -> kumukontra      ("objects to" where muscle CONTRACTION was meant)
  mokontrata    -> mokuntra        (Cebuano for "to sign a contract")
  ulang ulap    -> ulap-ulan       (reads as "shrimp cloud")
These are not fixable by adding more rules to the generation prompt — the writer already knows
the rule and slipped. A separate narrow pass that only repairs wording is the cheaper and
safer instrument, because it cannot invent a new fact: the English is fixed and authoritative,
and the model is asked to make the tl/bis say exactly that, in better Filipino.

Cards that are already fine are returned unchanged and cost almost nothing, since the model is
told to emit ONLY the cards it actually repaired.

  set -a; source ./.env.local; set +a
  CARDS_DIR=deped-cards-v3 python3 rag/pipeline/fw-polish-language.py

Rewrites each shard in place, keeping a .prepolish backup of the directory's originals.

Env: FW_MODEL, FW_CONC, FW_BATCH, FW_LIMIT, CARDS_DIR.
"""
import os, json, glob, time, shutil, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
CARDS = os.path.join(HERE, os.environ.get('CARDS_DIR', 'deped-cards-v3'))
BACKUP = CARDS + '.prepolish'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '10'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))

_lock = threading.Lock()
_stats = collections.Counter()
_T0 = time.time()


def call(prompt, attempt=0):
    payload = {'model': MODEL, 'temperature': 0.0, 'max_tokens': 8000,
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
        f, t = c['fact'], c['title']
        blocks.append(
            f'  CARD {n}\n'
            f'   en    {f["en"]}\n'
            f'   tl    {f["tl"]}\n'
            f'   bis   {f.get("bis","")}\n'
            f'   title tl "{t.get("tl","")}"  bis "{t.get("bis","")}"')
    return f'''You are proofreading the Tagalog and Cebuano of science cards for Filipino children.
The English is CORRECT and FINAL. Your job is to make the Tagalog and Cebuano say exactly what
the English says, in language a Filipino teacher would actually use in class.

FIX ONLY THESE:
- Misformed or wrong-aspect verbs: "Umiakyat" -> "umaakyat", "ninguya" -> "nginunguya".
- Words that do not exist, or that mean something else than intended: "kumokontra" and Cebuano
  "mokontrata" for a muscle contracting; "ulang ulap" for rain cloud.
- Stiff calqued grammar that reads as word-by-word English: "ay gumagalaw patungo sa X, na
  lumilikha ng Y" -> natural Tagalog clause order.
- Everyday English words that should be Filipino: mountain->bundok, lake->lawa,
  waterfall->talon, river->ilog, sea->dagat, water->tubig, land/soil->lupa, fish->isda,
  blood->dugo, bone->buto, salt->asin, iron->bakal. (Cebuano: bukid, lanaw, busay, suba,
  dagat, tubig, yuta, isda, dugo, bukog, asin, puthaw.)
- Cebuano that is really Tagalog: "at"->"ug", "ito"->"kini", "hindi"->"dili", "ay"->drop it.
- A tl or bis title that is just the English title copied over.

DO NOT:
- Change any FACT, number, name, or the meaning of the sentence.
- Change the English.
- KEEP technical science terms in English — "microscope", "kinetic energy", "food chain",
  "litmus paper", "acceleration". This is correct classroom Taglish. Do not "translate" them.
- Rewrite for style, add detail, shorten, or make it livelier. This is proofreading only.
- Change the two-part structure: if the text has a question, a blank line, then an answer,
  keep exactly that shape (the blank line is written as \\n\\n).

Return STRICT JSON with ONLY the cards you actually changed. If a card needs no change, leave
it out entirely. If nothing needs changing, return {{"fixed": []}}.

{{"fixed": [{{"card": 1, "tl": "...", "bis": "...", "title_tl": "...", "title_bis": "..."}}]}}

Include all four fields for any card you list, even the ones you did not alter.

{chr(10).join(blocks)}'''


def do_batch(shard, idxs, cards):
    batch = [cards[i] for i in idxs]
    try:
        got = obj_from(call(prompt_for(batch)))
    except Exception as e:
        with _lock:
            _stats['failed'] += len(batch)
        print(f'  FAIL {shard}: {type(e).__name__}', flush=True)
        return []
    out = []
    for fx in (got or {}).get('fixed') or []:
        try:
            k = int(fx['card'])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= k <= len(idxs):
            continue
        c = cards[idxs[k - 1]]
        # a proofreader that drops the question half has rewritten, not proofread
        if '\n\n' in c['fact']['en']:
            if '\n\n' not in (fx.get('tl') or '') or '\n\n' not in (fx.get('bis') or ''):
                with _lock:
                    _stats['rejected_shape'] += 1
                continue
        # The model echoes every card back, changed or not; only count a real edit, so the
        # reported rate means something and an unchanged card is never rewritten in place.
        changed = any((fx.get(src) or '').strip() and (fx.get(src) or '').strip() != cur.strip()
                      for src, cur in (('tl', c['fact']['tl']),
                                       ('bis', c['fact'].get('bis') or ''),
                                       ('title_tl', c['title'].get('tl') or ''),
                                       ('title_bis', c['title'].get('bis') or '')))
        if not changed:
            continue
        out.append((idxs[k - 1], fx))
    with _lock:
        _stats['cards'] += len(batch)
        _stats['fixed'] += len(out)
        if _stats['cards'] % 2000 < BATCH:
            el = (time.time() - _T0) / 60
            cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
            print(f"  ...{_stats['cards']:,} cards | fixed {_stats['fixed']:,} "
                  f"({_stats['fixed']/max(_stats['cards'],1)*100:.0f}%) | ${cost:.2f} | {el:.1f} min",
                  flush=True)
    return out


def main():
    shards = sorted(glob.glob(os.path.join(CARDS, '*.json')))
    if LIMIT:
        shards = shards[:LIMIT]
    if not os.path.exists(BACKUP):
        shutil.copytree(CARDS, BACKUP)
        print(f'  backed up originals -> {os.path.basename(BACKUP)}')
    print(f'{len(shards)} shards | {MODEL.split("/")[-1]} | batch {BATCH} | conc {CONC}')

    jobs = []
    data = {}
    for sp in shards:
        j = json.load(open(sp))
        data[sp] = j
        cards = j['cards']
        for i in range(0, len(cards), BATCH):
            jobs.append((sp, list(range(i, min(i + BATCH, len(cards))))))

    edits = collections.defaultdict(list)
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = {ex.submit(do_batch, os.path.basename(sp), idxs, data[sp]['cards']): sp
                for sp, idxs in jobs}
        for f in as_completed(futs):
            sp = futs[f]
            for idx, fx in f.result():
                edits[sp].append((idx, fx))

    for sp, lst in edits.items():
        cards = data[sp]['cards']
        for idx, fx in lst:
            c = cards[idx]
            for src, dst in (('tl', ('fact', 'tl')), ('bis', ('fact', 'bis')),
                             ('title_tl', ('title', 'tl')), ('title_bis', ('title', 'bis'))):
                v = (fx.get(src) or '').strip()
                if v:
                    c[dst[0]][dst[1]] = v
        with open(sp, 'w') as fh:
            json.dump(data[sp], fh, ensure_ascii=False)

    cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
    print(f"\nDONE in {(time.time()-_T0)/60:.1f} min | ${cost:.2f}")
    print(f"  {_stats['cards']:,} cards checked | {_stats['fixed']:,} repaired "
          f"({_stats['fixed']/max(_stats['cards'],1)*100:.0f}%) | failed {_stats['failed']}")
    print(f"  rejected for dropping the Q&A shape: {_stats['rejected_shape']}")
    print(f"  originals kept in {os.path.basename(BACKUP)}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Find card titles that were cut off mid-word or mid-phrase, in any language.

This is a GENERATION bug, not a translation one -- the pipeline appears to have applied a
length cap somewhere -- which is why it shows up in Tagalog as well as Cebuano and why the
LLM sweep almost entirely missed it (it reads as terse rather than wrong).

Signature A, mid-word: the title's last token never appears as a standalone word anywhere in
any card's BODY text or terms (so it is not a real word), and the same card contains a longer
word that starts with it. "Pagligid nga Frictio" + "friction" in the body -> truncated.

Signature B, dangling particle: the title ends on a preposition or linker that cannot end a
headline, so the head noun was dropped. "... para sa Proteksyon sa".

Two traps this deliberately avoids:
  - `N` and `Na` are the chemical symbols for nitrogen and sodium, and "Nitrogen Symbol N" is
    a correct title. Only a LOWERCASE trailing `n` is treated as a cut-off `ng`.
  - `na` is an ordinary Tagalog/Cebuano word ("Fossil sa Wala Na", "Level 3: Duol na").
  - The last token must not be required to be UNIQUE: a systematic truncation repeats across
    sibling cards ("Mantis Shrim" appears on several), and a uniqueness test hides exactly the
    worst cases.

  python3 truncated_titles.py [out.json]
"""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')

TOK = re.compile(r"[A-Za-zÀ-ÿ]+(?:[-'][A-Za-zÀ-ÿ]+)*")
# true prepositions/linkers that cannot end a headline
PARTICLES = {'sa', 'ug', 'nga', 'og', 'para', 'gikan', 'kang', 'aron',
             'ng', 'mula', 'at', 'nang', 'ni'}


def body_vocabulary(cards):
    """Every word used in a card BODY or terms list -- i.e. known to be a real word."""
    vocab = collections.Counter()
    for c in cards:
        for s in (c.get('fact') or {}).values():
            for w in TOK.findall(s or ''):
                vocab[w.lower()] += 1
        for t in (c.get('terms') or []):
            for w in TOK.findall(t):
                vocab[w.lower()] += 1
    return vocab


def detect(cards):
    vocab = body_vocabulary(cards)
    out = collections.defaultdict(list)
    for c in cards:
        titles, facts = c.get('title') or {}, c.get('fact') or {}
        # title.en matters: the full word is usually in the ENGLISH TITLE ("Rolling Friction"
        # for a bis title cut to "Frictio"), not in the prose body.
        ctx = ' '.join([v or '' for v in facts.values()] +
                       [v or '' for v in titles.values()] +
                       [' '.join(c.get('terms') or [])])
        for lang in ('en', 'tl', 'bis'):
            s = (titles.get(lang) or '').strip()
            if not s or len(s.split()) < 2:
                continue
            last = s.split()[-1].strip('.,:;')
            if last in ('n',) or last.lower() in PARTICLES:
                out[lang].append({'id': c['id'], 'title': s, 'kind': 'dangling-particle'})
                continue
            if len(last) < 5 or vocab[last.lower()]:
                continue                       # a real word somewhere in a body
            m = re.search(r'\b%s[a-zA-Z]{1,4}\b' % re.escape(last), ctx, re.I)
            if m and m.group(0).lower() != last.lower():
                out[lang].append({'id': c['id'], 'title': s, 'kind': 'mid-word',
                                  'truncated': last, 'full_word': m.group(0)})
    return dict(out)


if __name__ == '__main__':
    res = detect(json.load(open(POOL, encoding='utf-8'))['cards'])
    total = 0
    for lang in ('en', 'tl', 'bis'):
        rows = res.get(lang, [])
        total += len(rows)
        mw = [r for r in rows if r['kind'] == 'mid-word']
        print('== %-3s  %d mid-word + %d dangling = %d'
              % (lang, len(mw), len(rows) - len(mw), len(rows)))
        for r in rows:
            print('      %-12s %-48s %s' % (r['id'], r['title'], r.get('full_word') or '[head noun missing]'))
    print('\nTOTAL %d truncated titles' % total)
    if len(sys.argv) > 1:
        json.dump(res, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)

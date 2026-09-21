#!/usr/bin/env python3
"""Triage blind-answer mismatches into the three things they can actually mean.

The blind-answer sweep shows a judge only the Tagalog and compares its pick to the answer key.
A mismatch is objective, but it is NOT automatically a translation defect. Inspecting the first
two showed three distinct causes, and only one of them is ours to fix:

  A  TRANSLATION BROKE THE ITEM
     The Tagalog no longer supports the key, and the card disagrees with ITSELF: the keyed
     option does not match the item's own explanation as rendered in Tagalog. This is the
     class the audit exists to find.

  B  SOURCE-FACT DISPUTE
     The item is internally consistent in both languages -- question, keyed option and
     explanation all agree -- but the fact may be wrong. quiz-04091 asks the colour of the
     LIVE wire in Philippine wiring and keys "brown or red" (the IEC convention) while the
     judge chose "blue or black" (the US/NEC-style convention common in Philippine practice).
     A safety item aimed at grades 5-7, and not a language problem at all.

  C  JUDGE ERROR
     Also internally consistent, and the item is right. quiz-01496 asks what many white tagak
     mean in Filipino CULTURE; the topic, explanation and key all say clean water, and the
     judge answered from general knowledge that egrets precede storms. Nothing is wrong here.

B and C look identical from the key alone. The discriminator that separates A from both is
free and needs no model: **does the keyed option agree with the item's own explanation?**

  python3 triage_mismatches.py <analysis.json>
"""
import json
import re
import sys
import collections

BANK = 'rag/bank/quiz-bank.jsonl'
STOP = set(('ang ng sa na at ay mga ito nito ang isang para kung dahil upang nang ni si ka '
            'mo ito iyon yan the a an of and or in on to for is are it its this that with').split())


def words(s):
    return {w for w in re.findall(r"[A-Za-zÀ-ÿ]+", (s or '').lower())
            if len(w) > 3 and w not in STOP}


def overlap(a, b):
    """Jaccard-ish: how much of the option's vocabulary the explanation repeats."""
    A, B = words(a), words(b)
    return len(A & B) / max(1, len(A))


def main(path):
    picks = {x['id']: x for x in json.load(open(path, encoding='utf-8'))['mismatch']}
    rows = {}
    for line in open(BANK, encoding='utf-8'):
        r = json.loads(line)
        if r['id'] in picks:
            rows[r['id']] = r

    out = collections.defaultdict(list)
    for cid, r in rows.items():
        key, pick = r['answer'], picks[cid]['pick']
        expl = (r.get('explanation') or {}).get('tl', '')
        opts = r.get('options') or []
        k_sup = overlap(opts[key].get('tl'), expl) if key < len(opts) else 0.0
        p_sup = overlap(opts[pick].get('tl'), expl) if pick < len(opts) else 0.0
        rec = {'id': cid, 'key': key, 'pick': pick,
               'key_support': round(k_sup, 2), 'pick_support': round(p_sup, 2),
               'q_tl': (r.get('q') or {}).get('tl', ''),
               'key_tl': opts[key].get('tl') if key < len(opts) else '',
               'pick_tl': opts[pick].get('tl') if pick < len(opts) else '',
               'expl_tl': expl}
        # The explanation is the item's own statement of what it means. If it backs the
        # judge's pick over the key, the ITEM disagrees with itself in Tagalog -- class A.
        if p_sup > k_sup + 0.15:
            out['A-translation-broke-item'].append(rec)
        elif k_sup >= 0.3:
            out['BC-item-internally-consistent'].append(rec)
        else:
            out['needs-reading'].append(rec)

    for k in ('A-translation-broke-item', 'BC-item-internally-consistent', 'needs-reading'):
        v = out.get(k, [])
        print('%-32s %4d' % (k, len(v)))
    json.dump(dict(out), open('tools/quiz-language-audit/runs/2026-09-21-tl/mismatch-triage.json', 'w'),
              ensure_ascii=False, indent=1)
    for rec in out.get('A-translation-broke-item', [])[:10]:
        print('\n  %s  key=%d(support %.2f) pick=%d(support %.2f)'
              % (rec['id'], rec['key'], rec['key_support'], rec['pick'], rec['pick_support']))
        print('     KEY  %s' % rec['key_tl'][:90])
        print('     PICK %s' % rec['pick_tl'][:90])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1
         else 'tools/quiz-language-audit/runs/2026-09-21-tl/sweep-partial-analysis.json')

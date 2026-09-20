#!/usr/bin/env python3
"""Apply the REVIEWED question-lead fixes to the card pool, with an emphasis guard.

Two sources, both already adjudicated:

  t1     the 16 counting-question rewrites the 3-model panel called BROKEN unanimously
         (that panel scores precision 1.00 on the 59-item gold set). Token-level:
         "Ilang X ang Y?" -> "Ilan ang X ng Y?"
  gawang the 23 material-sense "gawa ng" errors, found deterministically and confirmed
         against each card's OWN English ("made of/from"). Frame fix:
         "[...] ano ang gawa ng X?" -> "[...] sa ano gawa ang X?"
         `gawa ng X` means made BY X; the material sense is `gawa sa X` / `Sa ano gawa ang X?`.

THE EMPHASIS GUARD is the point of this file. packages/mobile/src/data/cards.ts:91 --
"[a span] that is not present verbatim is simply not emphasised". Spans are matched by exact
substring at render time, so an edit that moves a span does not error, it SILENTLY drops the
card's bolding. 17.3% of question leads (3,326 of 19,279) carry a span inside the lead.

So: for EVERY language's emphasis list, any span present verbatim in the old lead must still
be present verbatim in the new one. If not, the card is HELD, not written. No repair
heuristic -- a span that moved is a signal the rewrite did something unintended.

Nothing here rebuilds cards.db. The pool is re-serialised byte-identically to how it is
stored, so this is a 1-line diff; review through the JSON report this writes.

  python3 apply_fixes.py --run <dir> [--dry-run]
"""
import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
POOL = ROOT / 'rag/pipeline/cardsPool.app.json'

# "[prefix] ano [talaga] ang gawa ng X?" -> "[prefix] sa ano [talaga] gawa ang X?"
# Particles between `ano` and `ang` vary: bare, `talaga`, `ba`, `ba talaga`. Capture the run
# verbatim and replay it, rather than enumerating combinations.
GAWA = re.compile(r'\b(a|A)no((?:\s+(?:ba|talaga))*)\s+ang\s+gawa\s+ng\s+')


def lead_of(text):
    return (text or '').split('\n')[0].strip()


def rewrite_gawa(lead):
    def sub(m):
        head = 'Sa ano' if m.group(1) == 'A' else 'sa ano'
        return head + (m.group(2) or '') + ' gawa ang '
    out = GAWA.sub(sub, lead, count=1)
    return out if out != lead else None


def emphasis_broken(card, old_lead, new_lead):
    """Every span verbatim in the old lead must be verbatim in the new one."""
    broken = []
    for lang, spans in (card.get('emphasis') or {}).items():
        for s in spans or []:
            if s and s in old_lead and s not in new_lead:
                broken.append(lang + ':' + repr(s))
    return broken


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    run = pathlib.Path(a.run)

    edits = {}
    votes = {}
    for line in (run / 'verdicts-t1.jsonl').read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get('verdict'):
            votes.setdefault(r['id'], {'v': [], 'before': r.get('before'), 'after': r.get('after')})
            votes[r['id']]['v'].append(r['verdict'])
    for cid, d in votes.items():
        if len(d['v']) == 3 and all(x == 'BROKEN' for x in d['v']):
            edits[cid] = ('t1', d['before'], d['after'])

    # Hand-authored repairs for splits where the mechanical transform is wrong. Kept in a
    # separate file so provenance is never confused with panel output -- these are not
    # native-verified and a reviewer must be able to tell them apart.
    mr = run / 'manual-rewrites.json'
    if mr.exists():
        for r in json.loads(mr.read_text(encoding='utf-8'))['items']:
            edits[r['id']] = ('manual', r['before'], r['after'])

    for r in json.loads((run / 'enum-gawa-ng.json').read_text(encoding='utf-8'))['items']:
        new = rewrite_gawa(r['tl'])
        if new:
            edits[r['id']] = ('gawang', r['tl'], new)

    doc = json.loads(POOL.read_text(encoding='utf-8'))
    index = {c['id']: c for c in doc['cards']}
    applied, held, already = [], [], []

    for cid, (src, before, after) in sorted(edits.items()):
        c = index.get(cid)
        if not c:
            held.append({'id': cid, 'src': src, 'reason': 'card not found'})
            continue
        cur = c['fact'].get('tl') or ''
        if lead_of(cur) == after:
            # Already at the target -- a previous run applied it. Idempotent, not a problem.
            already.append(cid)
            continue
        if lead_of(cur) != before:
            held.append({'id': cid, 'src': src, 'reason': 'lead drifted since adjudication',
                         'expected': before, 'found': lead_of(cur)})
            continue
        broken = emphasis_broken(c, before, after)
        if broken:
            held.append({'id': cid, 'src': src, 'reason': 'would silently drop emphasis',
                         'spans': broken, 'before': before, 'after': after})
            continue
        if not a.dry_run:
            c['fact']['tl'] = cur.replace(before, after, 1)
        applied.append({'id': cid, 'src': src, 'before': before, 'after': after})

    if not a.dry_run:
        POOL.write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')

    report = {'applied': len(applied), 'held': len(held), 'already_applied': len(already),
              'by_source': {s: sum(1 for x in applied if x['src'] == s) for s in ('t1', 'gawang', 'manual')},
              'applied_items': applied, 'held_items': held}
    (run / 'applied-fixes.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('  ' + ('DRY RUN -- ' if a.dry_run else '') + 'applied ' + str(len(applied)) +
          ' (t1 ' + str(report['by_source']['t1']) + ', gawa-ng ' +
          str(report['by_source']['gawang']) + ', manual ' +
          str(report['by_source']['manual']) + '), already-applied ' + str(len(already)) +
          ', held ' + str(len(held)))
    for h in held:
        print('    HELD ' + h['id'] + ' [' + h['src'] + ']: ' + h['reason'])
    return 0


if __name__ == '__main__':
    sys.exit(main())

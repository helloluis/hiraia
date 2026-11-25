#!/usr/bin/env python3
"""Withdraw named language editions from the live Science pack library, leaving everything else byte-identical.

    withdraw-editions.py --base <live library> --withdraw <withdraw.json> --out <empty dir>
                         [--library-version YYYY-MM-DD]

base      the library exactly as it is served now (index.json, science-bow-2026/, artifacts/, SHA256SUMS)
withdraw  {"decidedBy": "...", "decidedOn": "YYYY-MM-DD", "question": "...", "answer": "...",
           "withdraw": [{"packId": "sci26-...", "language": "fil", "reason": "..."}, ...]}
out       the new library: base without the named editions

What "withdrawn" means here: the edition's folders are not in the library, and the index lists that language of
the week as not built (the same entry a language that was never built has), so the site neither shows nor serves
it. The other language of the week is untouched. Teachers' private copies do not depend on the library.

Rules, each checked and fatal when broken:
- Only an edition that is live (viewable) can be withdrawn, and the week must keep its other language.
- Every file outside the withdrawn editions' folders is byte-identical to base.
- A week's own label becomes the best label of what is left; no label of a remaining edition changes; nothing is
  approved here.
- The record written beside the index (WITHDRAWAL-RECORD.json) names every removed file with its checksum, so the
  edition can be put back exactly from the previous library or a backup.
Only the Python standard library. Nothing in the inputs is executed.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

LIB = 'science-bow-2026'
RANK = {'approved': 4, 'draft': 3, 'needs_work': 2, 'failed': 1, 'not_built': 0}
COUNT_KEY = {'approved': 'approved', 'draft': 'draft', 'needs_work': 'needsWork', 'failed': 'failed', 'not_built': 'notBuilt'}
BUILT = ('approved', 'draft', 'needs_work')
RECORD = 'WITHDRAWAL-RECORD.json'


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fail(message):
    print('WITHDRAWAL FAILED: ' + message, file=sys.stderr)
    sys.exit(1)


def read_sums(root):
    sums = {}
    with open(os.path.join(root, 'SHA256SUMS')) as f:
        for line in f:
            line = line.rstrip('\n')
            if not line:
                continue
            digest, _, name = line.partition('  ')
            name = name.lstrip('*')
            name = name[2:] if name.startswith('./') else name
            path = os.path.join(root, name)
            if os.path.islink(path) or not os.path.isfile(path):
                fail('listed file is missing or not a regular file: ' + name)
            if sha(path) != digest:
                fail('file does not match SHA256SUMS: ' + name)
            sums[name] = digest
    return sums


def load(path):
    with open(path, 'rb') as f:
        return json.loads(f.read())


def not_built(language):
    return {'language': language, 'status': 'not_built', 'title': None, 'viewable': False, 'files': [], 'slideCount': None, 'illustratedSlides': None, 'review': None}


def main():
    ap = argparse.ArgumentParser()
    for name in ('base', 'withdraw', 'out'):
        ap.add_argument('--' + name, required=True)
    ap.add_argument('--library-version', default=None)
    a = ap.parse_args()
    base, out = os.path.abspath(a.base), os.path.abspath(a.out)
    if os.path.exists(out) and os.listdir(out):
        fail('the output folder must be empty: ' + out)
    order = load(a.withdraw)
    wanted = order.get('withdraw') or []
    if not wanted:
        fail('nothing to withdraw')
    for key in ('decidedBy', 'decidedOn'):
        if not order.get(key):
            fail('the order must say who decided it and when (' + key + ')')

    base_sums = read_sums(base)
    index = load(os.path.join(base, 'index.json'))
    entries = {p['packId']: p for p in index['packs']}

    def best(entry):
        return max((v['status'] for v in entry['variants'].values()), key=RANK.get)

    for e in index['packs']:
        if e['status'] != best(e):
            fail('the live index does not follow "best status of the two languages": ' + e['packId'])
    # The entry a never-built language has in this index must be the one written below.
    samples = [v for e in index['packs'] for v in e['variants'].values() if v['status'] == 'not_built']
    if samples and any(set(v) != set(not_built('en')) for v in samples[:50]):
        fail('this index describes a language that is not built differently from what this tool writes')

    seen, prefixes, removed, record = set(), [], {}, []
    for w in wanted:
        pack_id, lang, reason = w.get('packId'), w.get('language'), (w.get('reason') or '').strip()
        if (pack_id, lang) in seen:
            fail('named twice: %s %s' % (pack_id, lang))
        seen.add((pack_id, lang))
        if pack_id not in entries or lang not in ('en', 'fil') or not reason:
            fail('each item needs a week of this library, a language and a reason: %r' % (w,))
        entry = entries[pack_id]
        live = entry['variants'][lang]
        if live['status'] not in BUILT or not live.get('viewable'):
            fail('%s %s is not live, so it cannot be withdrawn' % (pack_id, lang))
        others = [v for k, v in entry['variants'].items() if k != lang and not (pack_id, k) in {(x.get('packId'), x.get('language')) for x in wanted}]
        if not any(v['status'] in BUILT for v in others):
            fail('%s would be left without any edition' % pack_id)
        mine = tuple('%s/%s/%s/' % (top, pack_id, lang) for top in (LIB, 'artifacts'))
        files = {rel: digest for rel, digest in base_sums.items() if rel.startswith(mine)}
        if not files:
            fail('%s %s has no files in the library' % (pack_id, lang))
        prefixes.extend(mine)
        removed.update(files)
        content = os.path.join(base, LIB, pack_id, lang, 'pack.json')
        record.append({
            'packId': pack_id, 'language': lang, 'reason': reason, 'statusBefore': live['status'], 'titleBefore': live.get('title'),
            'contentSha256': sha(content) if os.path.isfile(content) else None, 'weekStatusBefore': entry['status'],
            'files': [{'path': rel, 'sha256': files[rel]} for rel in sorted(files)],
        })
    prefixes = tuple(prefixes)

    out_sums = {}
    for rel, digest in base_sums.items():
        if rel.startswith(prefixes) or rel in ('index.json', RECORD):
            continue
        dest = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(os.path.join(base, rel), dest)
        out_sums[rel] = digest

    new_index = json.loads(json.dumps(index))
    changed_weeks = []
    for e in new_index['packs']:
        for lang in list(e['variants']):
            if (e['packId'], lang) in seen:
                e['variants'][lang] = not_built(lang)
        if any((e['packId'], lang) in seen for lang in e['variants']):
            before = entries[e['packId']]['status']
            e['status'] = best(e)
            e['viewable'] = any(v.get('viewable') for v in e['variants'].values())
            changed_weeks.append({'packId': e['packId'], 'weekStatusBefore': before, 'weekStatusAfter': e['status']})
    counts = {'targets': 0, 'approved': 0, 'draft': 0, 'needsWork': 0, 'failed': 0, 'notBuilt': 0}
    for e in new_index['packs']:
        for v in e['variants'].values():
            counts['targets'] += 1
            counts[COUNT_KEY[v['status']]] += 1
    new_index['counts'] = counts
    if a.library_version:
        new_index['libraryVersion'] = a.library_version
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump(new_index, f, indent=1)
    out_sums['index.json'] = sha(os.path.join(out, 'index.json'))

    earlier = load(os.path.join(base, RECORD)) if os.path.isfile(os.path.join(base, RECORD)) else None
    stage = {
        'schema': 'tala-science-withdrawal/1',
        'decidedBy': order['decidedBy'], 'decidedOn': order['decidedOn'], 'question': order.get('question'), 'answer': order.get('answer'),
        'baseSha256SumsSha256': sha(os.path.join(base, 'SHA256SUMS')),
        'countsBefore': index['counts'], 'countsAfter': counts,
        'withdrawn': record, 'weeks': changed_weeks, 'filesRemoved': len(removed),
        'earlierWithdrawals': earlier,
    }
    with open(os.path.join(out, RECORD), 'w') as f:
        json.dump(stage, f, indent=1, ensure_ascii=False)
    out_sums[RECORD] = sha(os.path.join(out, RECORD))
    with open(os.path.join(out, 'SHA256SUMS'), 'w') as f:
        f.write(''.join('%s  %s\n' % (out_sums[rel], rel) for rel in sorted(out_sums)))

    # Prove the promise.
    on_disk = set()
    for d, _, names in os.walk(out):
        for n in names:
            on_disk.add(os.path.relpath(os.path.join(d, n), out))
    if on_disk != set(out_sums) | {'SHA256SUMS'}:
        fail('the output holds files the checksum list does not name')
    kept = [rel for rel in out_sums if rel not in ('index.json', RECORD)]
    if any(base_sums.get(rel) != out_sums[rel] for rel in kept):
        fail('a file outside the withdrawn editions differs from the live library')
    if set(base_sums) - set(removed) - {'index.json', RECORD} != set(kept):
        fail('files other than the withdrawn editions are missing from the output')
    if any(rel.startswith(prefixes) for rel in on_disk):
        fail('a withdrawn edition still has files in the output')
    for e_old, e_new in zip(index['packs'], new_index['packs']):
        for lang, v in e_new['variants'].items():
            if (e_new['packId'], lang) not in seen and v != e_old['variants'][lang]:
                fail('an edition that was not named changed in the index: %s %s' % (e_new['packId'], lang))
    if counts['approved'] != index['counts']['approved']:
        fail('the number of approved editions changed')
    print('withdrawal: %d editions removed (%d files); %d files kept; counts %s -> %s; weeks whose own label changed: %s' % (
        len(record), len(removed), len(kept), index['counts'], counts,
        ', '.join('%s %s->%s' % (w['packId'], w['weekStatusBefore'], w['weekStatusAfter']) for w in changed_weeks if w['weekStatusBefore'] != w['weekStatusAfter']) or 'none'))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Overlay revised Filipino editions onto the live Science pack library, for the packs that may be released.

    overlay-filipino.py --base <live library> --source <revised library> --holds <holds.json> --out <empty dir>
                        [--source-sha256 <hex of the delivered archive>] [--library-version YYYY-MM-DD]

base    the library exactly as it is served now (index.json, science-bow-2026/, artifacts/, SHA256SUMS)
source  the Filipino owner's revised library in the same layout (a superset: it may hold weeks that are not live)
holds   {"holds": {"<reason>": ["sci26-...", ...], ...}}: packs whose Filipino edition is NOT taken from source
out     the new library: base, with the Filipino edition of every other pack that source has replaced or added

Rules, each checked and fatal when broken:
- English is never touched. Every file outside the replaced `<pack>/fil` folders is byte-identical to base.
- A held pack keeps exactly what is live (or stays absent when it is not live). Nothing is withdrawn here.
- A replaced edition keeps its live label (draft stays draft, needs_work stays needs_work). An added edition
  (Filipino not live before) arrives with the label the source gives it. Nothing is ever approved here.
- A taken edition must be whole: pack.json, review.json and the build manifest name the same content hash, every
  built file matches its manifest, and it has one preview per slide.
- A taken edition must pair with the live English of its week: same day count, same slide ids, same number of
  assessment items.
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


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fail(message):
    print('OVERLAY FAILED: ' + message, file=sys.stderr)
    sys.exit(1)


def read_sums(root):
    """SHA256SUMS of a library as {relative path: hash}, after checking every listed file."""
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
                fail('%s: listed file is missing or not a regular file: %s' % (root, name))
            if sha(path) != digest:
                fail('%s: file does not match SHA256SUMS: %s' % (root, name))
            sums[name] = digest
    return sums


def load(path):
    with open(path, 'rb') as f:
        return json.loads(f.read())


def edition(root, pack_id, lang):
    """A language version's parts, checked for wholeness. Returns (pack, review, manifest, content hash)."""
    lib = os.path.join(root, LIB, pack_id, lang)
    art = os.path.join(root, 'artifacts', pack_id, lang)
    content = sha(os.path.join(lib, 'pack.json'))
    pack, review, manifest = load(os.path.join(lib, 'pack.json')), load(os.path.join(lib, 'review.json')), load(os.path.join(art, 'manifest.json'))
    where = '%s %s in %s' % (pack_id, lang, root)
    if not (review['contentSha256'] == manifest['contentSha256'] == content):
        fail(where + ': pack, review and build manifest do not name the same content')
    if (pack['packId'], pack['language'], review['packId'], review['language']) != (pack_id, lang, pack_id, lang):
        fail(where + ': the files identify themselves differently')
    for f in manifest['files']:
        p = os.path.join(art, f['name'])
        if not os.path.isfile(p) or os.path.getsize(p) != f['bytes'] or sha(p) != f['sha256']:
            fail(where + ': built file does not match its manifest: ' + f['name'])
    previews = [n for n in os.listdir(os.path.join(art, 'previews')) if n.startswith('thumb-')]
    if len(previews) != manifest['previews'] or len(previews) != len(pack['slides']):
        fail(where + ': previews, manifest and slides disagree on the number of slides')
    return pack, review, manifest, content


def main():
    ap = argparse.ArgumentParser()
    for name in ('base', 'source', 'holds', 'out'):
        ap.add_argument('--' + name, required=True)
    ap.add_argument('--source-sha256', default=None)
    ap.add_argument('--library-version', default=None)
    a = ap.parse_args()
    base, source, out = (os.path.abspath(p) for p in (a.base, a.source, a.out))
    if os.path.exists(out) and os.listdir(out):
        fail('the output folder must be empty: ' + out)
    hold_groups = load(a.holds)['holds']
    held = {}
    for reason, ids in hold_groups.items():
        for pack_id in ids:
            if pack_id in held:
                fail('held twice: ' + pack_id)
            held[pack_id] = reason

    base_sums, source_sums = read_sums(base), read_sums(source)
    base_index, source_index = load(os.path.join(base, 'index.json')), load(os.path.join(source, 'index.json'))
    base_entries = {p['packId']: p for p in base_index['packs']}
    source_entries = {p['packId']: p for p in source_index['packs']}
    if list(base_entries) != list(source_entries):
        fail('base and source do not list the same weeks in the same order')
    for pack_id in held:
        if pack_id not in base_entries:
            fail('held pack is not a week of this library: ' + pack_id)

    def best(entry):
        return max((v['status'] for v in entry['variants'].values()), key=RANK.get)

    # The rule used below for a merged week must already describe the live index.
    for e in base_index['packs']:
        if e['status'] != best(e):
            fail('the live index does not follow "best status of the two languages": ' + e['packId'])

    taken, kept_held, record = [], [], []
    for pack_id, src in source_entries.items():
        new = src['variants']['fil']
        live = base_entries[pack_id]['variants']['fil']
        if new['status'] not in BUILT:
            if live['status'] in BUILT:
                fail(pack_id + ': Filipino is live but the source has none')
            continue
        if pack_id in held:
            kept_held.append({'packId': pack_id, 'reason': held[pack_id], 'liveStatus': live['status']})
            continue
        pack, review, manifest, content = edition(source, pack_id, 'fil')
        if review['publication'] != 'draft' or review['teacherReview'] is not None or review['expertReview'] is not None:
            fail(pack_id + ' fil: the source review record is not an unreviewed draft')
        if live['status'] in BUILT and new['status'] != live['status']:
            fail('%s fil: label would change from %s to %s' % (pack_id, live['status'], new['status']))
        english = base_entries[pack_id]['variants']['en']
        if english['status'] not in BUILT:
            fail(pack_id + ': no live English edition to pair with')
        en_pack, _, _, _ = edition(base, pack_id, 'en')
        shape = lambda p: (len(p['days']), [s['id'] for s in p['slides']], len(p['assessment']))
        if shape(pack) != shape(en_pack):
            fail(pack_id + ': the revised Filipino does not pair with the live English (days, slide ids or assessment items differ)')
        was = None
        if live['status'] in BUILT:
            was = edition(base, pack_id, 'fil')[3]
        taken.append(pack_id)
        record.append({'packId': pack_id, 'status': new['status'], 'added': was is None, 'liveContentSha256': was, 'newContentSha256': content, 'files': len(manifest['files']), 'slides': len(pack['slides'])})
    for pack_id in held:
        if pack_id not in {k['packId'] for k in kept_held}:
            fail('held pack has no Filipino edition in the source: ' + pack_id)

    # Build: base as it is, then the taken Filipino folders from the source.
    replaced_prefixes = tuple('%s/%s/fil/' % (top, pack_id) for pack_id in taken for top in (LIB, 'artifacts'))
    out_sums = {}
    for rel, digest in base_sums.items():
        if rel.startswith(replaced_prefixes) or rel == 'index.json':
            continue
        dest = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(os.path.join(base, rel), dest)
        out_sums[rel] = digest
    for rel, digest in source_sums.items():
        if not rel.startswith(replaced_prefixes):
            continue
        dest = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(os.path.join(source, rel), dest)
        out_sums[rel] = digest

    index = json.loads(json.dumps(base_index))
    for e in index['packs']:
        if e['packId'] in taken:
            e['variants']['fil'] = source_entries[e['packId']]['variants']['fil']
            e['status'] = best(e)
        e['viewable'] = any(v.get('viewable') for v in e['variants'].values())
    counts = {'targets': 0, 'approved': 0, 'draft': 0, 'needsWork': 0, 'failed': 0, 'notBuilt': 0}
    for e in index['packs']:
        for v in e['variants'].values():
            counts['targets'] += 1
            counts[COUNT_KEY[v['status']]] += 1
    index['counts'] = counts
    if a.library_version:
        index['libraryVersion'] = a.library_version
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
    out_sums['index.json'] = sha(os.path.join(out, 'index.json'))

    stage = {
        'schema': 'tala-science-filipino-overlay/1',
        'baseSha256SumsSha256': sha(os.path.join(base, 'SHA256SUMS')),
        'sourceArchiveSha256': a.source_sha256,
        'sourceSha256SumsSha256': sha(os.path.join(source, 'SHA256SUMS')),
        'countsBefore': base_index['counts'],
        'countsAfter': counts,
        'taken': record,
        'held': kept_held,
        'englishTouched': 0,
    }
    with open(os.path.join(out, 'OVERLAY-RECORD.json'), 'w') as f:
        json.dump(stage, f, indent=1, ensure_ascii=False)
    out_sums['OVERLAY-RECORD.json'] = sha(os.path.join(out, 'OVERLAY-RECORD.json'))
    with open(os.path.join(out, 'SHA256SUMS'), 'w') as f:
        f.write(''.join('%s  %s\n' % (out_sums[rel], rel) for rel in sorted(out_sums)))

    # Prove the promise: outside the taken Filipino folders, the index and the record, nothing differs from base.
    on_disk = set()
    for d, _, names in os.walk(out):
        for n in names:
            on_disk.add(os.path.relpath(os.path.join(d, n), out))
    if on_disk != set(out_sums) | {'SHA256SUMS'}:
        fail('the output holds files the checksum list does not name')
    untouched = [rel for rel in out_sums if not rel.startswith(replaced_prefixes) and rel not in ('index.json', 'OVERLAY-RECORD.json')]
    if any(base_sums.get(rel) != out_sums[rel] for rel in untouched):
        fail('a file outside the taken Filipino folders differs from the live library')
    dropped = [rel for rel in base_sums if rel not in out_sums and not rel.startswith(replaced_prefixes)]
    if dropped:
        fail('files of the live library are missing from the output: ' + ', '.join(dropped[:3]))
    added = sum(1 for r in record if r['added'])
    print('overlay: %d Filipino editions taken (%d replace a live edition, %d added), %d held; %d files; counts %s -> %s' % (
        len(taken), len(taken) - added, added, len(kept_held), len(out_sums) + 1, base_index['counts'], counts))


if __name__ == '__main__':
    main()

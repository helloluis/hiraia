#!/bin/sh
# Stage exactly the teaching-pack files the Tala server serves, for /var/lib/tala/packs on the host
# (see packages/tala-server/deploy/README.md, "Teaching packs data").
#   scripts/stage-for-deploy.sh <out.tgz>
# A consistent snapshot, safe while a batch is running: a language version is included only when its build manifest
# matches its review record (same content hash, every file present with its recorded hash); anything mid-build is
# left out and shown as not built in the staged index (counts recomputed). Model critique logs, full-size previews
# and HTML sources stay behind.
set -eu
out="$1"
here="$(cd "$(dirname "$0")/.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
python3 - "$here" "$stage" <<'PY'
import hashlib, json, os, shutil, sys
here, stage = sys.argv[1], sys.argv[2]
lib = os.path.join(here, 'library')
art = os.path.join(here, 'build', 'artifacts')
index = json.load(open(os.path.join(lib, 'index.json')))
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
included, skipped = [], []
for entry in index['packs']:
    for lang, v in entry['variants'].items():
        if v['status'] in ('not_built', 'failed'):
            continue
        d = os.path.join(lib, 'science-bow-2026', entry['packId'], lang)
        a = os.path.join(art, entry['packId'], lang)
        ok = os.path.isfile(os.path.join(d, 'pack.json')) and os.path.isfile(os.path.join(a, 'manifest.json'))
        if ok:
            review = json.load(open(os.path.join(d, 'review.json')))
            man = json.load(open(os.path.join(a, 'manifest.json')))
            ok = (review['contentSha256'] == sha(os.path.join(d, 'pack.json')) == man['contentSha256']
                  and all(os.path.isfile(os.path.join(a, f['name'])) and sha(os.path.join(a, f['name'])) == f['sha256'] for f in man['files']))
        if not ok:
            skipped.append(f"{entry['packId']} {lang}")
            entry['variants'][lang] = {**v, 'status': 'not_built', 'viewable': False, 'files': [], 'title': None, 'slideCount': None, 'illustratedSlides': None, 'review': None}
            continue
        sd = os.path.join(stage, 'science-bow-2026', entry['packId'], lang)
        sa = os.path.join(stage, 'artifacts', entry['packId'], lang)
        os.makedirs(sd, exist_ok=True); os.makedirs(os.path.join(sa, 'previews'), exist_ok=True)
        for f in ('pack.json', 'review.json'):
            shutil.copy2(os.path.join(d, f), sd)
        shutil.copy2(os.path.join(a, 'manifest.json'), sa)
        for f in man['files']:
            shutil.copy2(os.path.join(a, f['name']), sa)
        for f in sorted(os.listdir(os.path.join(a, 'previews'))):
            if f.startswith('thumb-') and f.endswith('.webp'):
                shutil.copy2(os.path.join(a, 'previews', f), os.path.join(sa, 'previews'))
        included.append(f"{entry['packId']} {lang}")
    entry['viewable'] = any(x.get('viewable') for x in entry['variants'].values())
counts = {'targets': 0, 'approved': 0, 'draft': 0, 'needsWork': 0, 'failed': 0, 'notBuilt': 0}
key = {'approved': 'approved', 'draft': 'draft', 'needs_work': 'needsWork', 'failed': 'failed', 'not_built': 'notBuilt'}
for entry in index['packs']:
    for v in entry['variants'].values():
        counts['targets'] += 1
        counts[key[v['status']]] += 1
index['counts'] = counts
json.dump(index, open(os.path.join(stage, 'index.json'), 'w'), indent=1)
print(f"included {len(included)} language versions; left out (mid-build): {', '.join(skipped) or 'none'}; counts {counts}")
PY
(cd "$stage" && find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS)
tar -czf "$out" -C "$stage" .
echo "$out: $(tar -tzf "$out" | grep -c -v '/$') files, $(du -h "$out" | cut -f1)"

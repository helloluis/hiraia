#!/usr/bin/env python3
"""Build verified HIRAIMG1 packs without regrouping already distributed images."""
from collections import defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'rag/pipeline/art-shards'
OUT = ROOT / 'packages/mobile/build/image-packs'
LAYOUT = ROOT / 'rag/pipeline/image-pack-layout.json'


def extend_layout(layout, rows, cells):
    """Keep member order and IDs; put only previously unassigned images in new packs."""
    if layout.get('format') != 1:
        raise ValueError('Invalid image pack layout')
    packs, seen, ids = [], set(), set()
    for pack in layout['packs']:
        if pack['id'] in ids or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]*', pack['id']):
            raise ValueError('Invalid/duplicate pack ID')
        ids.add(pack['id'])
        if not 0 < len(pack['slugs']) <= 600:
            raise ValueError('Invalid pack membership count')
        for slug in pack['slugs']:
            if slug in seen or slug not in rows:
                raise ValueError(f'Pack member is duplicated or no longer downloadable: {slug}')
            seen.add(slug)
        packs.append(pack)
    groups = defaultdict(list)
    for slug in sorted(rows.keys() - seen):
        groups[cells[slug]].append(slug)
    for cell, slugs in sorted(groups.items()):
        number = 1
        for offset in range(0, len(slugs), 600):
            while f'{cell}-{number:02d}' in ids:
                number += 1
            pack_id = f'{cell}-{number:02d}'
            ids.add(pack_id)
            packs.append({'id': pack_id, 'cell': cell, 'slugs': slugs[offset:offset + 600]})
    return {**layout, 'packs': packs}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = json.loads((SOURCE / 'index.json').read_text())
    rows = {}
    for shard in index['shards']:
        for row in json.loads((SOURCE / shard['file']).read_text())['images']:
            if row['slug'] in rows:
                raise ValueError('Duplicate source image: ' + row['slug'])
            rows[row['slug']] = row
    assert len(rows) == index['tail']['images']
    generated = ROOT / 'packages/mobile/src/generated'
    bundled = {r[0] for r in json.loads((generated / 'bundledArt.generated.json').read_text())['images']}
    if bundled & rows.keys():
        raise ValueError('Regenerate image maps before packaging: bundled and downloadable overlap')
    tags = json.loads((generated / 'curriculumTags.generated.json').read_text())
    spec = importlib.util.spec_from_file_location('image_audit', Path(__file__).with_name('audit-image-packs.py'))
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    grades = defaultdict(set)
    available = bundled | rows.keys()
    for card in json.loads((generated / 'cardsIndex.generated.json').read_text())['cards']:
        slug = card['slug']
        if slug not in available and re.search(r'-g\d+$', slug):
            slug = re.sub(r'-g\d+$', '', slug).lower()
        grades[slug].update(audit.card_grades(card, tags))
    cells = {slug: 'common' if len(grades[slug]) != 1 else f'g{next(iter(grades[slug]))}-all' for slug in rows}
    layout = extend_layout(json.loads(LAYOUT.read_text()), rows, cells)
    manifest = {'format': 1, 'packs': []}
    for pack in layout['packs']:
        entries, blobs = [], []
        for slug in pack['slugs']:
            row = rows[slug]
            assert all(c.isalnum() or c in '_-' for c in slug), slug
            source = (ROOT / 'packages/images' / row['file']).resolve()
            assert source.is_relative_to((ROOT / 'packages/images').resolve())
            blob = source.read_bytes()
            assert len(blob) == row['bytes'] and hashlib.md5(blob).hexdigest() == row['md5'], str(source)
            assert blob.startswith(b'\x89PNG\r\n\x1a\n'), str(source)
            entries.append({'slug': slug, 'bytes': len(blob), 'md5': row['md5']})
            blobs.append(blob)
        header = json.dumps({'images': entries}, separators=(',', ':'), ensure_ascii=True).encode()
        data = b'HIRAIMG1' + struct.pack('<I', len(header)) + header + b''.join(blobs)
        digest = hashlib.md5(data).hexdigest()
        filename = pack['id'] + '-' + digest + '.hpak'
        (OUT / filename).write_bytes(data)
        manifest['packs'].append({
            'id': pack['id'], 'cell': pack['cell'], 'filename': filename, 'bytes': len(data),
            'unpackedBytes': sum(e['bytes'] for e in entries), 'md5': digest,
            'sha256': hashlib.sha256(data).hexdigest(), 'images': len(entries),
        })
    manifest['version'] = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:16]
    text = json.dumps(manifest, indent=2) + '\n'
    (OUT / 'manifest.json').write_text(text)
    # Validate all files and every grade before changing the app's pinned inventory.
    subprocess.run([sys.executable, str(Path(__file__).with_name('audit-image-packs.py')),
                    '--manifest', str(OUT / 'manifest.json'), '--check'], check=True)
    LAYOUT.write_text(json.dumps(layout, indent=1) + '\n')
    (generated / 'imagePacks.generated.json').write_text(text)
    print(json.dumps({'packs': len(manifest['packs']), 'images': len(rows),
                      'bytes': sum(p['bytes'] for p in manifest['packs']), 'version': manifest['version']}))


if __name__ == '__main__':
    main()

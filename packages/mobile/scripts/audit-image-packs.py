#!/usr/bin/env python3
"""Offline, exhaustive image delivery audit. No model or network calls.

Run before and after package-art.py. --check exits nonzero for missing images,
incorrect grade placement, incomplete corpus delivery, or stale/corrupt packs.
Empty card slugs intentionally render as text and do not require an illustration.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[3]
GRADES = set(range(3, 11))


def card_grades(card, tags):
    grades = set()
    match = re.search(r'-g(\d+)$', card['factId'])
    if match:
        suffix = match[1]
        grades.update([int(suffix)] if int(suffix) <= 10 else map(int, suffix))
    tag = tags.get(card['id'])
    if tag:
        grades.add(tag[1])
        if len(tag) > 4:
            grades.update(cell[0] for cell in tag[4])
    return grades & GRADES


def audit(root, manifest_path, packs_dir):
    def load(relative):
        return json.loads((root / relative).read_text())

    generated = 'packages/mobile/src/generated/'
    cards = load(generated + 'cardsIndex.generated.json')['cards']
    tags = load(generated + 'curriculumTags.generated.json')
    bundled = {row[0] for row in load(generated + 'bundledArt.generated.json')['images']}
    shard_root = root / 'rag/pipeline/art-shards'
    shard_index = json.loads((shard_root / 'index.json').read_text())
    canonical = {}
    for shard in shard_index['shards']:
        for row in json.loads((shard_root / shard['file']).read_text())['images']:
            if row['slug'] in canonical or row['slug'] in bundled:
                raise ValueError('Duplicate corpus image: ' + row['slug'])
            canonical[row['slug']] = row
    if len(canonical) != shard_index['tail']['images']:
        raise ValueError('Shard inventory count does not match tail count')

    manifest = json.loads(manifest_path.read_text())
    owners = {}
    pack_ids = set()
    for pack in manifest['packs']:
        name = pack['filename']
        if Path(name).name != name or pack['id'] in pack_ids:
            raise ValueError('Invalid/duplicate pack identity: ' + name)
        pack_ids.add(pack['id'])
        data = (packs_dir / name).read_bytes()
        if (len(data) != pack['bytes'] or hashlib.sha256(data).hexdigest() != pack['sha256']
                or hashlib.md5(data).hexdigest() != pack['md5']):
            raise ValueError('Pack checksum/size mismatch: ' + name)
        if data[:8] != b'HIRAIMG1' or len(data) < 12:
            raise ValueError('Invalid pack header: ' + name)
        size = struct.unpack('<I', data[8:12])[0]
        if not 2 <= size <= 300000:
            raise ValueError('Invalid header length: ' + name)
        rows = json.loads(data[12:12 + size])['images']
        if len(rows) != pack['images']:
            raise ValueError('Image count mismatch: ' + name)
        offset = 12 + size
        for row in rows:
            slug = row['slug']
            if slug in owners:
                raise ValueError('Image delivered more than once: ' + slug)
            source = canonical.get(slug)
            if (source is None and slug not in bundled) or (source is not None and
                    any(row[k] != source[k] for k in ('bytes', 'md5'))):
                raise ValueError('Image differs from source inventory: ' + slug)
            image = data[offset:offset + row['bytes']]
            if not image.startswith(b'\x89PNG\r\n\x1a\n') or hashlib.md5(image).hexdigest() != row['md5']:
                raise ValueError('Image payload corrupted: ' + slug)
            offset += row['bytes']
            owners[slug] = pack
        if offset != len(data) or sum(row['bytes'] for row in rows) != pack['unpackedBytes']:
            raise ValueError('Payload size mismatch: ' + name)

    wanted = defaultdict(set)
    examples = defaultdict(list)
    text_only = 0
    for card in cards:
        slug = card['slug']
        if not slug:
            text_only += 1
            continue
        # Match the runtime's bundled grade-suffix fallback.
        fallback = re.sub(r'-g\d+$', '', slug).lower()
        if re.search(r'-g\d+$', slug) and slug not in bundled and fallback in bundled:
            slug = fallback
        for grade in card_grades(card, tags):
            wanted[grade].add(slug)
        examples[slug].append(card['factId'])

    report = {'manifest_version': manifest['version'], 'cards': len(cards),
              'text_only_cards': text_only, 'bundled_images': len(bundled),
              'pack_images': len(owners), 'packs': len(manifest['packs']),
              'pack_bytes': sum(p['bytes'] for p in manifest['packs']),
              'bundled_images_duplicated_in_packs': sorted(bundled & owners.keys()),
              'corpus_images_missing_from_delivery': sorted(set(canonical) - owners.keys()),
              'grades': []}
    for grade in sorted(GRADES):
        packs = [p for p in manifest['packs'] if p['cell'] == 'common' or p['cell'].startswith(f'g{grade}-')]
        selected = {p['id'] for p in packs}
        missing = sorted(s for s in wanted[grade] if s not in bundled and
                         (s not in owners or owners[s]['id'] not in selected))
        report['grades'].append({'grade': grade, 'required_images': len(wanted[grade]),
                                'packs': len(packs), 'download_bytes': sum(p['bytes'] for p in packs),
                                'missing_images': [
                                    {'slug': s, 'pack': owners[s]['id'] if s in owners else None,
                                     'example_card': examples[s][0]} for s in missing]})
    report['ok'] = not report['bundled_images_duplicated_in_packs'] and not report['corpus_images_missing_from_delivery'] and not any(
        g['missing_images'] for g in report['grades'])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'packages/mobile/src/generated/imagePacks.generated.json')
    parser.add_argument('--packs-dir', type=Path, default=ROOT / 'packages/mobile/build/image-packs')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        result = audit(ROOT, args.manifest, args.packs_dir)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f'Image delivery audit failed: {error}\n')
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(f"{result['bundled_images']} bundled + {result['pack_images']} downloadable images; {result['packs']} packs")
    for row in result['grades']:
        print(f"Grade {row['grade']}: {len(row['missing_images'])} missing / {row['required_images']} required; "
              f"{row['download_bytes'] / 1e6:.1f} MB")
    print(f"Corpus images absent from delivery: {len(result['corpus_images_missing_from_delivery'])}")
    print(f"Bundled images redundantly downloaded: {len(result['bundled_images_duplicated_in_packs'])}")
    if args.check and not result['ok']:
        parser.exit(1, 'Image coverage is incomplete; inspect --report output.\n')


if __name__ == '__main__':
    main()

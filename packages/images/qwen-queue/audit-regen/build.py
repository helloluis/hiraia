#!/usr/bin/env python3
"""Build gpt-image-2 batch request files from Qwen visual reject/uncertain prompts."""
import json
import re
from pathlib import Path

ROOT = Path('/Users/luis/Code/hiraia')
HERE = Path(__file__).resolve().parent
OUT_AUDIT = ROOT / 'tools/image-audit/runs/2026-09-21'
MODEL = 'gpt-image-2'
QUALITY = 'low'
SIZE = '1024x1024'

_MARKERS = [
    'black-and-white hand-drawn line art',
    'black and white hand-drawn line art',
    'black-and-white hand-drawn line illustration',
    'hand-drawn line art',
    'hand drawn line art',
    'hand-drawn line illustration',
    'a simple illustration',
    'simple illustration of',
    'as if sketched by a clever child',
]
STYLE = (
    '. Black and white pen-and-ink drawing, hand-inked with a brush pen, confident varied '
    'line weight and light cross-hatching for shading, bold and expressive with slightly '
    'imperfect organic linework, in the style of a vintage scientific encyclopedia engraving, '
    'black ink on a plain white background, a single subject centered with generous empty '
    'white space around it, no scenery, absolutely no text, words, letters, numbers, labels, '
    'captions, signatures or watermarks anywhere in the image.'
)


def strip_style(p):
    p = p.strip()
    low = p.lower()
    cut = len(p)
    for m in _MARKERS:
        i = low.find(m)
        if i >= 0:
            cut = min(cut, i)
    s = p[:cut].strip().rstrip(',.').strip()
    s = re.sub(r'^(a )?simple illustration (of|showing) ', '', s, flags=re.I).strip()
    return s or p


def add(index, key, src, prompt):
    if key and prompt and key not in index:
        index[key] = (src, prompt.strip())


def load_prompts():
    index = {}
    for line in (ROOT / 'packages/images/qwen-queue/worklist.jsonl').open():
        row = json.loads(line)
        add(index, row['id'], 'qwen-worklist', row.get('prompt'))
    for path in (ROOT / 'packages/images/gemini-queue/prompts').glob('*.json'):
        data = json.loads(path.read_text())
        for img in data.get('images') or []:
            add(index, img.get('id'), f'gemini/{path.name}', img.get('prompt'))
            if img.get('output_png'):
                add(index, Path(img['output_png']).stem, f'gemini/{path.name}', img.get('prompt'))
    extras = [
        ROOT / 'packages/images/qwen-queue/missing-worklist.jsonl',
        ROOT / 'packages/images/review/round3-prompts.jsonl',
        ROOT / 'packages/images/review/asset-fix-prompts.jsonl',
        ROOT / 'packages/images/review/qwen-fallback-worklist.jsonl',
        ROOT / 'rag/pipeline/imagegen/worklist.jsonl',
    ]
    for path in extras:
        if not path.exists():
            continue
        for line in path.open():
            if not line.strip():
                continue
            row = json.loads(line)
            add(index, row.get('id'), str(path.relative_to(ROOT)), row.get('prompt'))
    return index


def batch_line(item):
    return {
        'custom_id': item['id'],
        'method': 'POST',
        'url': '/v1/images/generations',
        'body': {
            'model': MODEL,
            'prompt': strip_style(item['prompt']) + STYLE,
            'size': SIZE,
            'quality': QUALITY,
            'n': 1,
            'background': 'opaque',
            'output_format': 'png',
        },
    }


def main():
    prompts = load_prompts()
    review = json.loads((OUT_AUDIT / 'review-queue.json').read_text())
    items, skipped, seen = [], [], set()
    for row in review:
        if row.get('visual') not in ('reject', 'uncertain'):
            continue
        slug = (row.get('slugs') or [Path(row['image']).stem])[0]
        stem = Path(row['image']).stem
        key = slug if slug in prompts else (stem if stem in prompts else None)
        if key in seen:
            continue
        if not key:
            skipped.append({'id': slug, 'image': row['image'], 'visual': row['visual']})
            continue
        seen.add(key)
        src, prompt = prompts[key]
        items.append({
            'id': key,
            'image': row['image'],
            'visual': row['visual'],
            'source': src,
            'kind': 'card' if 'cards-png' in row['image'] else 'asset',
            'prompt': prompt,
        })
    items.sort(key=lambda x: x['id'])
    mid = (len(items) + 1) // 2
    jobs = [items[:mid], items[mid:]]
    HERE.mkdir(parents=True, exist_ok=True)
    with (HERE / 'worklist.jsonl').open('w') as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
    with (HERE / 'skipped-no-prompt.jsonl').open('w') as f:
        for row in skipped:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    sizes = []
    for i, job in enumerate(jobs, 1):
        path = HERE / f'batch-requests-{i}.jsonl'
        with path.open('w') as f:
            for item in job:
                f.write(json.dumps(batch_line(item), ensure_ascii=False) + '\n')
        sizes.append((path.name, len(job), path.stat().st_size))
        with (HERE / f'job-{i}-ids.txt').open('w') as f:
            f.write('\n'.join(item['id'] for item in job) + '\n')
    summary = {
        'model': MODEL,
        'quality': QUALITY,
        'size': SIZE,
        'reject_uncertain_images': sum(
            1 for r in review if r.get('visual') in ('reject', 'uncertain')),
        'queued': len(items),
        'skipped_no_prompt': len(skipped),
        'jobs': [{'file': n, 'n': c, 'bytes': b} for n, c, b in sizes],
        'visual_mix': {
            'reject': sum(1 for x in items if x['visual'] == 'reject'),
            'uncertain': sum(1 for x in items if x['visual'] == 'uncertain'),
        },
    }
    (HERE / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()

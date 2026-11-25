"""What an established office suite does to a deck when it only opens and saves it (no edits at all).

    python pptx-roundtrip-lo.py <corpus-dir> <corpus-report.json> <out.json> --soffice PATH [--jobs N]

LibreOffice is the engine inside Collabora Online, so "open, then save as .pptx" in LibreOffice is the round trip
an embedded Collabora editor performs on every save. For each corpus file the engine in this repository took, this
measures, for that round trip with NO edit made:
  - how many of the file's parts come back byte-identical, how many are rewritten, dropped or new;
  - how many slides look different afterwards (the original and the round-tripped file both drawn by the same
    LibreOffice, so differences are the round trip's, not the renderer's).
It is the baseline the patch-in-place approach is compared against (which, with no edit, changes no part).
"""
import argparse
import concurrent.futures as futures
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('corpus')
ap.add_argument('report')
ap.add_argument('out')
ap.add_argument('--soffice', required=True)
ap.add_argument('--jobs', type=int, default=6)
ap.add_argument('--width', type=int, default=640)
args = ap.parse_args()

WORK = Path(tempfile.mkdtemp(prefix='tala-lo-roundtrip-'))
UNSHARE = '/usr/bin/unshare' if os.path.exists('/usr/bin/unshare') else None


def office(worker, out, src, target):
    profile = WORK / f'profile{worker}'
    cmd = [args.soffice, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard',
           f'-env:UserInstallation=file://{profile}', '--convert-to', target, '--outdir', str(out), str(src)]
    if UNSHARE:
        cmd = [UNSHARE, '--map-root-user', '--net'] + cmd
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(WORK / f'home{worker}'), 'LANG': 'C.UTF-8', 'SAL_USE_VCLPLUGIN': 'svp'}
    os.makedirs(env['HOME'], exist_ok=True)
    for _ in range(2):
        r = subprocess.run(cmd, env=env, cwd=out, capture_output=True, timeout=300)
        if r.returncode != 81:
            break
    return r.returncode


def pages(worker, pptx):
    out = WORK / f'draw{worker}-{time.monotonic_ns()}'
    out.mkdir(parents=True)
    src = out / 'deck.pptx'
    shutil.copyfile(pptx, src)
    office(worker, out, src, 'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}')
    pdf = out / 'deck.pdf'
    if not pdf.exists():
        shutil.rmtree(out, ignore_errors=True)
        raise RuntimeError('no pdf')
    subprocess.run(['pdftoppm', '-png', '-scale-to-x', str(args.width), '-scale-to-y', '-1', str(pdf), str(out / 'p')], check=True, timeout=300, capture_output=True)
    files = sorted(out.glob('p-*.png'), key=lambda p: int(p.stem.split('-')[-1]))
    arrays = [np.asarray(Image.open(p).convert('RGB'), dtype=np.int16) for p in files]
    shutil.rmtree(out, ignore_errors=True)
    return arrays


def parts(path):
    with zipfile.ZipFile(path) as z:
        return {i.filename: z.read(i.filename) for i in z.infolist() if not i.filename.endswith('/')}


def kind(name):
    """What a part is, from where it lives in the package: 'ppt/slides', 'ppt/media', 'customXml', 'docProps'…"""
    bits = name.split('/')
    if bits[0] == 'ppt' and len(bits) > 2:
        return 'ppt/' + bits[1] + ('/_rels' if '_rels' in bits else '')
    if bits[0] == 'ppt':
        return 'ppt/' + bits[1].split('.')[0]
    return bits[0] if len(bits) > 1 else name


def check(item, worker):
    file = item['file']
    res = {'file': file, 'slides': item.get('slides')}
    src = Path(args.corpus) / file
    out = WORK / f'rt{worker}-{time.monotonic_ns()}'
    out.mkdir(parents=True)
    work = out / 'in.pptx'
    shutil.copyfile(src, work)
    (out / 'saved').mkdir()
    try:
        office(worker, out / 'saved', work, 'pptx:Impress MS PowerPoint 2007 XML')
        saved = out / 'saved' / 'in.pptx'
        if not saved.exists():
            res['error'] = 'LibreOffice wrote no file'
            return res
        a, b = parts(src), parts(saved)
        same = sum(1 for n in a if n in b and a[n] == b[n])
        res['parts'] = {'before': len(a), 'after': len(b), 'identical': same, 'rewritten': sum(1 for n in a if n in b and a[n] != b[n]),
                        'dropped': sum(1 for n in a if n not in b), 'new': sum(1 for n in b if n not in a)}
        res['bytes'] = {'before': src.stat().st_size, 'after': saved.stat().st_size}
        res['kinds'] = {}
        for n in a:
            k = res['kinds'].setdefault(kind(n), {'before': 0, 'identical': 0, 'rewritten': 0, 'dropped': 0})
            k['before'] += 1
            k['identical' if n in b and a[n] == b[n] else 'rewritten' if n in b else 'dropped'] += 1
        before, after = pages(worker, src), pages(worker, saved)
        res['pages'] = {'before': len(before), 'after': len(after)}
        if len(before) == len(after):
            changed = []
            for i, (x, y) in enumerate(zip(before, after)):
                if x.shape != y.shape:
                    changed.append({'slide': i + 1, 'pixels': 1.0})
                    continue
                d = np.abs(x - y).max(axis=2) > 8
                if d.any():
                    changed.append({'slide': i + 1, 'pixels': round(float(d.mean()), 5)})
            res['slides_changed'] = len(changed)
            res['slides_changed_over_1pct'] = sum(1 for c in changed if c['pixels'] > 0.01)
            res['worst'] = sorted(changed, key=lambda c: -c['pixels'])[:3]
    except Exception as e:  # noqa: BLE001
        res['error'] = f'{type(e).__name__}: {str(e)[:160]}'
    finally:
        shutil.rmtree(out, ignore_errors=True)
    return res


def main():
    report = json.load(open(args.report, encoding='utf-8'))
    items = [r for r in report['results'] if r.get('taken')]
    slots = queue.Queue()
    for i in range(args.jobs):
        slots.put(i)

    def run(item):
        slot = slots.get()
        try:
            return check(item, slot)
        finally:
            slots.put(slot)

    results = []
    started = time.time()
    with futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for r in pool.map(run, items):
            results.append(r)
            print(f'{len(results)}/{len(items)} {r["file"]}', file=sys.stderr, flush=True)
    ok = [r for r in results if 'parts' in r]
    drawn = [r for r in ok if 'slides_changed' in r]
    total = lambda key: sum(r['parts'][key] for r in ok)  # noqa: E731
    kinds = {}
    for r in ok:
        for name, counts in r.get('kinds', {}).items():
            k = kinds.setdefault(name, {'before': 0, 'identical': 0, 'rewritten': 0, 'dropped': 0})
            for key in k:
                k[key] += counts[key]
    kinds = dict(sorted(kinds.items(), key=lambda kv: -kv[1]['before']))
    summary = {
        'files': len(results),
        'round_tripped': len(ok),
        'failed': [r['file'] for r in results if 'parts' not in r],
        'parts_before': total('before'),
        'parts_identical_after': total('identical'),
        'parts_rewritten': total('rewritten'),
        'parts_dropped': total('dropped'),
        'parts_new': total('new'),
        'files_with_every_part_identical': sum(1 for r in ok if r['parts']['identical'] == r['parts']['before'] == r['parts']['after']),
        'kinds': kinds,
        'files_page_count_changed': sum(1 for r in ok if 'pages' in r and r['pages']['before'] != r['pages']['after']),
        'slides_compared': sum(r['pages']['before'] for r in drawn),
        'slides_changed': sum(r['slides_changed'] for r in drawn),
        'slides_changed_over_1pct': sum(r['slides_changed_over_1pct'] for r in drawn),
        'files_with_a_changed_slide': sum(1 for r in drawn if r['slides_changed'] > 0),
        'seconds': round(time.time() - started),
    }
    json.dump({'summary': summary, 'results': results}, open(args.out, 'w', encoding='utf-8'), indent=1)
    print(json.dumps(summary, indent=1))
    shutil.rmtree(WORK, ignore_errors=True)


main()

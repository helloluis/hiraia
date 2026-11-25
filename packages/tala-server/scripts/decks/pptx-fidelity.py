"""Independent check of edited decks against the files they were made from (run after pptx-corpus.ts --out).

    python pptx-fidelity.py <corpus-dir> <variants-dir> <corpus-report.json> <out.json> [--soffice PATH] [--jobs N] [--only NAME]

Two outside readers judge what the engine wrote, on every corpus file it took:

1. python-pptx opens every variant and walks every slide, shape, paragraph and notes page (a strict OOXML reader:
   a dangling relationship or a missing part fails here).
2. LibreOffice draws the uploaded file and every variant, page by page, and the pictures are compared:
     noop          every slide identical to the upload's
     text          every slide but the edited one identical; the edited slide differs, and where it differs is
                   measured against the box of the text that was changed
     notes         every slide identical (notes are not on the slide)
     reversed      slide i is the upload's slide n-1-i
     copied        the copy is identical to the slide it was copied from; the rest keep their pictures
     removed-last  the first n-1 slides are the upload's first n-1

Nothing is installed system-wide; LibreOffice runs with a private profile per worker and no network.
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
from pathlib import Path

import numpy as np
from PIL import Image
from pptx import Presentation

ap = argparse.ArgumentParser()
ap.add_argument('corpus')
ap.add_argument('variants')
ap.add_argument('report')
ap.add_argument('out')
ap.add_argument('--soffice', default=os.environ.get('TALA_DECKS_PREVIEW_SOFFICE', 'soffice'))
ap.add_argument('--jobs', type=int, default=6)
ap.add_argument('--only', default=None)
ap.add_argument('--width', type=int, default=640)
ap.add_argument('--keep', default=None, help='folder to keep the drawn pages of files named with --only')
args = ap.parse_args()

VARIANTS = ['noop', 'text', 'notes', 'reversed', 'copied', 'removed-last', 'combined']
WORK = Path(tempfile.mkdtemp(prefix='tala-fidelity-'))
UNSHARE = '/usr/bin/unshare' if os.path.exists('/usr/bin/unshare') else None


def draw(pptx: Path, worker: int) -> list:
    """The pages of a deck as arrays (H, W, 3), or raise."""
    out = WORK / f'w{worker}' / f'{time.monotonic_ns()}'
    out.mkdir(parents=True)
    profile = WORK / f'profile{worker}'
    src = out / 'deck.pptx'
    shutil.copyfile(pptx, src)
    cmd = [args.soffice, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard',
           f'-env:UserInstallation=file://{profile}', '--convert-to',
           'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}', '--outdir', str(out), str(src)]
    if UNSHARE:
        cmd = [UNSHARE, '--map-root-user', '--net'] + cmd
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(WORK / f'home{worker}'), 'LANG': 'C.UTF-8', 'SAL_USE_VCLPLUGIN': 'svp'}
    os.makedirs(env['HOME'], exist_ok=True)
    for attempt in range(2):
        r = subprocess.run(cmd, env=env, cwd=out, capture_output=True, timeout=240)
        if r.returncode != 81:  # 81 = "profile set up, start me again"
            break
    pdf = out / 'deck.pdf'
    if not pdf.exists():
        raise RuntimeError(f'no pdf (exit {r.returncode})')
    subprocess.run(['pdftoppm', '-png', '-scale-to-x', str(args.width), '-scale-to-y', '-1', str(pdf), str(out / 'p')], check=True, timeout=240, capture_output=True)
    pages = sorted(out.glob('p-*.png'), key=lambda p: int(p.stem.split('-')[-1]))
    arrays = [np.asarray(Image.open(p).convert('RGB'), dtype=np.int16) for p in pages]
    if args.keep and args.only:
        keep = Path(args.keep) / pptx.stem
        keep.mkdir(parents=True, exist_ok=True)
        for i, p in enumerate(pages):
            shutil.copyfile(p, keep / f'slide-{i + 1:03d}.png')
    shutil.rmtree(out, ignore_errors=True)
    return arrays


def differ(a, b):
    """None when two pages are the same picture; else what fraction of pixels differ and the box they lie in."""
    if a.shape != b.shape:
        return {'pixels': 1.0, 'box': None, 'shape': [list(a.shape), list(b.shape)]}
    d = np.abs(a - b).max(axis=2) > 8  # ignore antialiasing dust
    if not d.any():
        return None
    ys, xs = np.where(d)
    h, w = d.shape
    box = {'x': xs.min() / w, 'y': ys.min() / h, 'w': (xs.max() - xs.min() + 1) / w, 'h': (ys.max() - ys.min() + 1) / h}
    return {'pixels': round(float(d.mean()), 5), 'box': {k: round(float(v), 4) for k, v in box.items()}}


def inside(inner, outer, margin=0.04):
    if not inner or not outer:
        return None
    return bool(inner['x'] >= outer['x'] - margin and inner['y'] >= outer['y'] - margin
                and inner['x'] + inner['w'] <= outer['x'] + outer['w'] + margin and inner['y'] + inner['h'] <= outer['y'] + outer['h'] + margin)


def read_strict(path: Path):
    """python-pptx walks the whole file; returns (slides, words) or raises."""
    prs = Presentation(str(path))
    words = 0
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    words += len(''.join(r.text for r in para.runs))
            if getattr(shape, 'has_table', False) and shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        words += len(cell.text_frame.text)
        if slide.has_notes_slide:
            words += len(slide.notes_slide.notes_text_frame.text if slide.notes_slide.notes_text_frame is not None else '')
        _ = slide.slide_layout.name
    return len(prs.slides), words


def check(item, worker):
    file = item['file']
    stem = Path(file).stem
    res = {'file': file, 'slides': item.get('slides'), 'variants': {}}
    variants = {v: Path(args.variants) / f'{stem}.{v}.pptx' for v in VARIANTS}
    variants = {v: p for v, p in variants.items() if p.exists()}
    # 1. A second reader opens everything.
    try:
        res['upload_reads'] = list(read_strict(Path(args.corpus) / file))
    except Exception as e:  # the upload itself may be something python-pptx cannot read
        res['upload_reads'] = f'{type(e).__name__}: {str(e)[:120]}'
    for v, p in variants.items():
        entry = res['variants'].setdefault(v, {})
        try:
            entry['reads'] = list(read_strict(p))
        except Exception as e:
            entry['reads'] = f'{type(e).__name__}: {str(e)[:160]}'
    # 2. Pictures.
    try:
        base = draw(Path(args.corpus) / file, worker)
    except Exception as e:
        res['upload_draws'] = f'{type(e).__name__}: {str(e)[:120]}'
        return res
    res['upload_draws'] = len(base)
    n = len(base)
    for v, p in variants.items():
        entry = res['variants'][v]
        if v == 'combined':
            continue  # read by both readers; its pictures are covered by the single-change variants
        try:
            pages = draw(p, worker)
        except Exception as e:
            entry['draws'] = f'{type(e).__name__}: {str(e)[:120]}'
            continue
        entry['draws'] = len(pages)
        if v in ('noop', 'notes'):
            expect = list(range(n))
        elif v == 'reversed':
            expect = list(range(n - 1, -1, -1))
        elif v == 'removed-last':
            expect = list(range(n - 1))
        elif v == 'copied':
            at = (item.get('copy') or {}).get('at', 0)
            expect = list(range(at + 1)) + [at] + list(range(at + 1, n))
        else:
            expect = list(range(n))
        if len(pages) != len(expect):
            entry['pages_expected'] = len(expect)
            continue
        edited = (item.get('textEdit') or {}).get('slide') if v == 'text' else None
        same = 0
        other = []
        for i, src in enumerate(expect):
            d = differ(pages[i], base[src])
            if v == 'text' and edited == i + 1:
                box = (item.get('textEdit') or {}).get('box')
                entry['edited_slide'] = {'slide': edited, 'changed': d is not None, 'pixels': d['pixels'] if d else 0.0, 'where': d['box'] if d else None, 'text_box': box,
                                         'within_text_box': inside(d['box'], box) if d else None}
                continue
            if d is None:
                same += 1
            else:
                other.append({'slide': i + 1, **d})
        entry['unchanged_slides_identical'] = same
        entry['unchanged_slides'] = len(expect) - (1 if edited else 0)
        if other:
            entry['unexpected_differences'] = other[:8]
    return res


def main():
    report = json.load(open(args.report, encoding='utf-8'))
    items = [r for r in report['results'] if r.get('taken') and (not args.only or args.only in r['file'])]
    results = []
    started = time.time()
    # A LibreOffice profile can be used by one process at a time: each running job borrows a slot (and its profile).
    slots = queue.Queue()
    for i in range(args.jobs):
        slots.put(i)

    def run(item):
        slot = slots.get()
        try:
            return check(item, slot)
        finally:
            slots.put(slot)

    with futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        jobs = {pool.submit(run, item): item for item in items}
        for f in futures.as_completed(jobs):
            try:
                results.append(f.result())
            except Exception as e:
                results.append({'file': jobs[f]['file'], 'error': f'{type(e).__name__}: {str(e)[:200]}'})
            print(f'{len(results)}/{len(items)} {results[-1]["file"]}', file=sys.stderr, flush=True)
    results.sort(key=lambda r: r['file'])

    def tally(variant, pred):
        tried = [r['variants'][variant] for r in results if variant in r.get('variants', {})]
        return {'tried': len(tried), 'ok': sum(1 for e in tried if pred(e))}

    reads = {v: tally(v, lambda e: isinstance(e.get('reads'), list)) for v in VARIANTS}
    pictures = {v: tally(v, lambda e: isinstance(e.get('draws'), int) and e.get('unchanged_slides_identical') == e.get('unchanged_slides') and 'pages_expected' not in e)
                for v in VARIANTS if v != 'combined'}
    edited = [r['variants']['text']['edited_slide'] for r in results if 'edited_slide' in r.get('variants', {}).get('text', {})]
    summary = {
        'files': len(results),
        'upload_read_by_python_pptx': sum(1 for r in results if isinstance(r.get('upload_reads'), list)),
        'upload_drawn_by_libreoffice': sum(1 for r in results if isinstance(r.get('upload_draws'), int)),
        'variant_read_by_python_pptx': reads,
        'variant_pictures_as_expected': pictures,
        'edited_slides': {'drawn': len(edited), 'visibly_changed': sum(1 for e in edited if e['changed']),
                          'change_within_text_box': sum(1 for e in edited if e['within_text_box'] is True),
                          'change_outside_text_box': sum(1 for e in edited if e['within_text_box'] is False),
                          'no_box_to_compare': sum(1 for e in edited if e['changed'] and e['within_text_box'] is None)},
        'seconds': round(time.time() - started),
    }
    json.dump({'summary': summary, 'results': results}, open(args.out, 'w', encoding='utf-8'), indent=1)
    print(json.dumps(summary, indent=1))
    shutil.rmtree(WORK, ignore_errors=True)


main()

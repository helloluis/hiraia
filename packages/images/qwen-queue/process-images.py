#!/usr/bin/env python3
"""Post-process generated illustrations for app bundling: grayscale (they're B&W engravings
stored as RGB), resize to a square target, and compress. Raw 1024x1024 RGB PNGs are ~1.4MB
each (~26GB for the full set) — unshippable; grayscale WebP@512 is ~42KB (~815MB). Resumable:
skips outputs that already exist. Runs safely while generation is still going (processes
whatever is on disk).

  FMT=webp SIZE=512 Q=80 python3 packages/images/qwen-queue/process-images.py

Env: SRC (default out-final), DST (default out-processed), FMT webp|png, SIZE (default 512),
     Q webp quality (default 80).
"""
import os, glob, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('SRC', os.path.join(HERE, 'out-final'))
DST = os.environ.get('DST', os.path.join(HERE, 'out-processed'))
FMT = os.environ.get('FMT', 'webp').lower()
SIZE = int(os.environ.get('SIZE', '512'))
Q = int(os.environ.get('Q', '80'))
os.makedirs(DST, exist_ok=True)
EXT = 'webp' if FMT == 'webp' else 'png'

def process(src, dst):
    im = Image.open(src).convert('L').resize((SIZE, SIZE), Image.LANCZOS)
    if FMT == 'webp':
        im.save(dst, 'WEBP', quality=Q, method=6)
    else:
        im.save(dst, 'PNG', optimize=True)

def main():
    srcs = sorted(glob.glob(os.path.join(SRC, '*.png')))
    todo = [p for p in srcs if not os.path.exists(os.path.join(DST, os.path.basename(p)[:-4] + '.' + EXT))]
    print(f'process: {len(srcs)} source PNGs, {len(todo)} to process -> {DST} ({FMT} {SIZE}px q{Q})', flush=True)
    done = err = tot = 0
    for i, p in enumerate(todo, 1):
        dst = os.path.join(DST, os.path.basename(p)[:-4] + '.' + EXT)
        try:
            process(p, dst); done += 1; tot += os.path.getsize(dst)
        except Exception as e:
            err += 1; print(f'  FAIL {os.path.basename(p)}: {e}', flush=True)
        if i % 1000 == 0:
            print(f'  ...{i}/{len(todo)} ({tot//10**6}MB so far)', flush=True)
    n = len([x for x in os.listdir(DST) if x.endswith(EXT)])
    allsz = sum(os.path.getsize(os.path.join(DST, x)) for x in os.listdir(DST) if x.endswith(EXT))
    print(f'\nDONE: +{done} processed, {err} failed | {n} total in {DST}')
    print(f'  aggregate: {allsz/10**6:.0f} MB ({allsz/max(n,1)/1024:.0f} KB avg) | projected full 18,700: ~{allsz/max(n,1)*18700/10**6:.0f} MB')

if __name__ == '__main__':
    main()

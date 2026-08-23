#!/usr/bin/env python3
"""Downsample the batch PNGs to the bundle format: 512x512 grayscale-toned WebP.

The generator returns 1024x1024 PNGs at ~1.3 MB each. The APK ships 512x512 WebP averaging
32 KB — a 40x saving that the phone screen cannot tell apart, and the whole reason the image
library fits in an offline app at all. Matching the existing files exactly (size, mode, and
naming by card id) keeps one loader path for old and new illustrations alike.

  python3 rag/pipeline/imagegen/to-webp.py
"""
import os, glob, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'raw')
DST = os.path.join(HERE, 'webp')
SIZE = (512, 512)
QUALITY = 82

os.makedirs(DST, exist_ok=True)


def main():
    src = sorted(glob.glob(os.path.join(SRC, '*.png')))
    done = skipped = 0
    for p in src:
        cid = os.path.basename(p)[:-4]
        out = os.path.join(DST, f'{cid}.webp')
        if os.path.exists(out):
            skipped += 1
            continue
        try:
            im = Image.open(p)
            # The art is black ink on white; flattening to L and back to RGB keeps the file
            # small and matches the existing bank, which is toned rather than truly colour.
            im = im.convert('L').resize(SIZE, Image.LANCZOS).convert('RGB')
            im.save(out, 'WEBP', quality=QUALITY, method=6)
            done += 1
        except Exception as e:
            print(f'  FAIL {cid}: {type(e).__name__} {e}', file=sys.stderr)
        if done and done % 400 == 0:
            print(f'  ...{done:,} converted', flush=True)
    outs = glob.glob(os.path.join(DST, '*.webp'))
    tot = sum(os.path.getsize(f) for f in outs)
    print(f'{done:,} converted ({skipped:,} already done)')
    if outs:
        print(f'  {len(outs):,} webp, mean {tot/len(outs)/1024:.0f} KB, total {tot/1e6:.0f} MB')


if __name__ == '__main__':
    main()

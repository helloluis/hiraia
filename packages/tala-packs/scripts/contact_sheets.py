#!/usr/bin/env python3
"""Tile a pack's rendered slide previews into labelled contact sheets for visual QA and evidence.

  ~/.venvs/tala-pptx/bin/python scripts/contact_sheets.py build/artifacts/<id>/<lang> <outdir> [per_sheet=16]
"""
import glob, os, sys
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
per = int(sys.argv[3]) if len(sys.argv) > 3 else 16
os.makedirs(out, exist_ok=True)
files = sorted(glob.glob(os.path.join(src, 'previews', 'slide-*.png')))
if not files:
    sys.exit('no slide previews')
tag = os.path.basename(os.path.dirname(src.rstrip('/'))) + '-' + os.path.basename(src.rstrip('/'))
cols, w = 4, 640
sheets = []
for k in range(0, len(files), per):
    chunk = files[k:k + per]
    ims = []
    for f in chunk:
        im = Image.open(f).convert('RGB')
        im = im.resize((w, int(im.height * w / im.width)))
        ims.append(im)
    h = ims[0].height
    rows = (len(ims) + cols - 1) // cols
    pad, lab = 10, 26
    sheet = Image.new('RGB', (cols * w + (cols + 1) * pad, rows * (h + lab) + (rows + 1) * pad), '#7d7d7d')
    d = ImageDraw.Draw(sheet)
    for i, im in enumerate(ims):
        x = pad + (i % cols) * (w + pad)
        y = pad + (i // cols) * (h + lab + pad)
        d.text((x + 4, y + 4), f'slide {k + i + 1}', fill='white')
        sheet.paste(im, (x, y + lab))
    name = os.path.join(out, f'{tag}-slides-{k // per + 1:02d}.png')
    sheet.save(name, optimize=True)
    sheets.append(name)
print('\n'.join(sheets))

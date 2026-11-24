"""Lay the reader's text-block boxes over the pictures of the slides, to check by eye that they sit on the words.

    python pptx-boxes.py <dir written by render-deck.ts for one deck> [<slide number>...]

Reads slide-NNN.jpg and boxes.json from the directory and writes boxes-NNN.png beside them: editable blocks in teal,
read-only ones in orange, each with its id. A block with no box (no geometry anywhere up its layout chain) is listed
on stdout.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

folder = Path(sys.argv[1])
only = {int(n) for n in sys.argv[2:]}
for slide in json.load(open(folder / 'boxes.json', encoding='utf-8')):
    n = slide['slide']
    if only and n not in only:
        continue
    picture = folder / f'slide-{n:03d}.jpg'
    if not picture.exists():
        continue
    im = Image.open(picture).convert('RGB')
    w, h = im.size
    d = ImageDraw.Draw(im)
    for b in slide['blocks']:
        box = b['box']
        if not box:
            print(f'slide {n}: {b["id"]} ({b["role"]}) has no box: {b["words"]!r}')
            continue
        colour = (0, 128, 128) if b['editable'] else (220, 120, 0)
        x0, y0 = box['x'] * w, box['y'] * h
        x1, y1 = (box['x'] + box['w']) * w, (box['y'] + box['h']) * h
        d.rectangle([x0, y0, max(x1, x0 + 2), max(y1, y0 + 2)], outline=colour, width=3)
        d.text((x0 + 4, y0 + 2), b['id'], fill=colour)
    im.save(folder / f'boxes-{n:03d}.png')
    print(f'slide {n}: {len(slide["blocks"])} blocks -> boxes-{n:03d}.png')

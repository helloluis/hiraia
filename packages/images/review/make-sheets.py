#!/usr/bin/env python3
"""
Build labeled contact sheets for the illustration review.

Each sheet is a 4x4 grid of 512px tiles with a caption strip under each tile
carrying the image id (ffct-NNNNN or the slug), so reviewing agents can read
ids straight off the sheet. Emits sheets + a manifest mapping sheet -> tiles.

Usage (from the repo root of the illu-rework worktree):
    python3 packages/images/review/make-sheets.py webp   # the 18,816 per-fact set
    python3 packages/images/review/make-sheets.py png    # the 4,228 shipped slug set
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

COLS = ROWS = 4
TILE = 512
CAPTION = 56  # caption strip height under each tile
CELL = TILE + CAPTION
SHEET_W = COLS * TILE
SHEET_H = ROWS * CELL
FONT = ImageFont.load_default(size=36)

ROOT = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.dirname(ROOT)  # packages/images/
OUT_SHEETS = os.path.join(ROOT, 'sheets')
OUT_MANIFESTS = os.path.join(ROOT, 'manifests')


def webp_entries():
    # worklist.jsonl is untracked pipeline state; a copy lives next to this script.
    wl = os.path.join(ROOT, 'worklist.jsonl')
    out = []
    with open(wl) as fh:
        for line in fh:
            d = json.loads(line)
            path = os.path.join(IMAGES, 'factoid-webp', d['id'] + '.webp')
            if os.path.exists(path):
                out.append({'id': d['id'], 'topic': d.get('topic', ''), 'path': path})
    out.sort(key=lambda e: e['id'])
    return out


def png_entries():
    base = os.path.join(IMAGES, 'assets-png')
    out = []
    for subject in sorted(os.listdir(base)):
        sdir = os.path.join(base, subject)
        if not os.path.isdir(sdir):
            continue
        for f in sorted(os.listdir(sdir)):
            if f.endswith('.png'):
                out.append({
                    'id': f[:-4],
                    'topic': f'{subject}: ' + f[:-4].replace('-', ' '),
                    'path': os.path.join(sdir, f),
                })
    return out


def build(entries, set_name):
    sheets_dir = os.path.join(OUT_SHEETS, set_name)
    os.makedirs(sheets_dir, exist_ok=True)
    os.makedirs(OUT_MANIFESTS, exist_ok=True)
    per_sheet = COLS * ROWS
    manifest = []
    for si in range(0, len(entries), per_sheet):
        chunk = entries[si:si + per_sheet]
        name = f'{set_name}-{si // per_sheet:04d}.png'
        sheet = Image.new('RGB', (SHEET_W, SHEET_H), 'white')
        draw = ImageDraw.Draw(sheet)
        tiles = []
        for ti, e in enumerate(chunk):
            r, c = divmod(ti, COLS)
            x, y = c * TILE, r * CELL
            try:
                img = Image.open(e['path']).convert('RGB').resize((TILE, TILE))
                sheet.paste(img, (x, y))
            except Exception as ex:  # unreadable file — leave blank, note it
                draw.text((x + 8, y + 8), f'LOAD ERROR: {ex}', fill='red')
            draw.rectangle([x, y, x + TILE - 1, y + CELL - 1], outline='#999999')
            draw.text((x + 8, y + TILE + 10), e['id'], fill='#333333', font=FONT)
            tiles.append({'pos': ti, 'row': r, 'col': c, 'id': e['id'], 'topic': e['topic']})
        out_path = os.path.join(sheets_dir, name)
        sheet.save(out_path, optimize=True)
        manifest.append({'sheet': out_path, 'tiles': tiles})
        if si % (per_sheet * 50) == 0:
            print(f'  {name} ({si}/{len(entries)})')
    mf = os.path.join(OUT_MANIFESTS, f'{set_name}-sheets.json')
    with open(mf, 'w') as fh:
        json.dump(manifest, fh)
    print(f'{set_name}: {len(entries)} images -> {len(manifest)} sheets; manifest {mf}')


def regen_entries():
    # the regenerated set: prompts from the regen worklist, images = processed 512px webps
    wl = os.path.join(ROOT, 'regen-worklist.jsonl')
    imgdir = os.path.join(ROOT, 'regen-webp')
    out = []
    with open(wl) as fh:
        for line in fh:
            d = json.loads(line)
            path = os.path.join(imgdir, d['id'] + '.webp')
            if os.path.exists(path):
                out.append({'id': d['id'], 'topic': d.get('prompt', '')[:80], 'path': path})
    out.sort(key=lambda e: e['id'])
    return out


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'webp'
    if which == 'webp':
        build(webp_entries(), 'webp')
    elif which == 'regen':
        build(regen_entries(), 'regen')
    else:
        build(png_entries(), 'png')

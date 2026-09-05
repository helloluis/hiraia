#!/usr/bin/env python3
"""Bake the Hiraia "hi" mark (the app-icon glyphs) into src/generated/hiMark.generated.ts.

Source of the vector data: /tmp/hi-mark/build_mark.py (Luis's one-off that pulls the Alfa Slab
One glyph outlines for "hi" with fontTools, lays them out on a baseline, adds the peach
triangle and centres the block in a 1000x1000 box at the icon's proportions). Its JSON
output (/tmp/hi-mark/hi-mark.json) is the input here; the .py and .json are NOT shipped.

What this script does on top of that:
  * applies the group transform (translate + uniform scale) to the raw coordinates, and
  * stretches the block 1.24x VERTICALLY about its own centre — the icon's word box is
    368x350 px of 1024 against 1014x778 raw glyph units, i.e. the icon squashes the letters
    wider-than-tall by that factor, so the title mark has to as well to match it;
  * emits every path already in the 1000-box so the SVG needs NO <G transform>. That matters
    for the outline trace: dash lengths and stroke width live in user units, so a non-uniform
    group scale would make the pen's dashes and the stroke itself thicker one way than the
    other. Baked coordinates keep both uniform.
  * measures each path's length by flattening it (quadratic Beziers sampled 48x, lines exact)
    so strokeDasharray/strokeDashoffset can be set at build time — no getTotalLength at
    runtime, no per-frame JS;
  * emits ONE entry PER CONTOUR (the "i" is two: dot, then stem). Android draws the dash
    through Skia's DashPathEffect, which restarts the dash phase at every contour, so a
    two-contour path with one dasharray would draw both contours at once and then stall
    while the pen "finished" a length neither contour has. One contour per entry keeps the
    head/tail dash-offset identity exact and the pen strictly sequential.

Run:  python3 scripts/gen-hi-mark.py     (from packages/mobile; needs /tmp/hi-mark/hi-mark.json)
"""
import json
import math
import os
import re
import sys

SRC = '/tmp/hi-mark/hi-mark.json'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'generated', 'hiMark.generated.ts')
BOX = 1000
STRETCH_Y = 1.24  # icon word box 350/1024 tall vs raw 778 units, against 368/1024 wide vs 1014
QUAD_SAMPLES = 48

if not os.path.exists(SRC):
    sys.exit(f'missing {SRC} — run /tmp/hi-mark/build_mark.py first')

data = json.load(open(SRC))
m = re.match(r'translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)', data['transform'])
tx, ty, s = (float(v) for v in m.groups())

def bake(x, y):
    X = tx + s * x
    Y = ty + s * y
    # the block is centred on BOX/2 by construction (see build_mark.py), so stretch about it
    Y = BOX / 2 + (Y - BOX / 2) * STRETCH_Y
    return X, Y

TOKEN = re.compile(r'[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e[-+]?\d+)?')

def parse(d):
    """Absolute-command SVG path → list of contours, each (cmds, length) in baked coordinates.

    A contour starts at every M; lengths are measured per contour (see the header on why).
    """
    toks = TOKEN.findall(d)
    i = 0
    cx = cy = 0.0
    sx = sy = 0.0
    contours = []
    out = []
    length = 0.0

    def num():
        nonlocal i
        v = float(toks[i]); i += 1
        return v

    def seg_len(pts):
        return sum(math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) for k in range(len(pts) - 1))

    def close_contour():
        nonlocal out, length
        if out:
            contours.append((out, length))
        out, length = [], 0.0

    while i < len(toks):
        c = toks[i]; i += 1
        if c == 'M':
            close_contour()
            cx, cy = num(), num(); sx, sy = cx, cy
            out.append(('M', [bake(cx, cy)]))
            # implicit lineto after M
            while i < len(toks) and not toks[i].isalpha():
                nx, ny = num(), num()
                out.append(('L', [bake(nx, ny)])); length += seg_len([bake(cx, cy), bake(nx, ny)])
                cx, cy = nx, ny
        elif c in 'LHV':
            while i < len(toks) and not toks[i].isalpha():
                if c == 'L':
                    nx, ny = num(), num()
                elif c == 'H':
                    nx, ny = num(), cy
                else:
                    nx, ny = cx, num()
                out.append(('L', [bake(nx, ny)])); length += seg_len([bake(cx, cy), bake(nx, ny)])
                cx, cy = nx, ny
        elif c == 'Q':
            while i < len(toks) and not toks[i].isalpha():
                qx, qy, nx, ny = num(), num(), num(), num()
                p0, p1, p2 = bake(cx, cy), bake(qx, qy), bake(nx, ny)
                pts = []
                for k in range(QUAD_SAMPLES + 1):
                    t = k / QUAD_SAMPLES
                    pts.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                                (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
                length += seg_len(pts)
                out.append(('Q', [p1, p2]))
                cx, cy = nx, ny
        elif c == 'C':
            while i < len(toks) and not toks[i].isalpha():
                ax, ay, bx, by, nx, ny = (num() for _ in range(6))
                p0, p1, p2, p3 = bake(cx, cy), bake(ax, ay), bake(bx, by), bake(nx, ny)
                pts = []
                for k in range(QUAD_SAMPLES + 1):
                    t = k / QUAD_SAMPLES; u = 1 - t
                    pts.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                                u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
                length += seg_len(pts)
                out.append(('C', [p1, p2, p3]))
                cx, cy = nx, ny
        elif c == 'Z':
            length += seg_len([bake(cx, cy), bake(sx, sy)])
            out.append(('Z', []))
            cx, cy = sx, sy
        else:
            sys.exit(f'unsupported path command {c!r} (relative commands are not needed by the mark)')
    close_contour()
    return contours

def fmt(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')

def to_d(cmds):
    parts = []
    for c, pts in cmds:
        parts.append(c + ' '.join(f'{fmt(x)} {fmt(y)}' for x, y in pts))
    return ''.join(parts)

# Contour names per glyph, in the order the font emits them (the i's dot comes first).
CONTOUR_NAMES = {'i': ['i-dot', 'i-stem']}

paths = []
for key, colour in (('h', 'stock'), ('i', 'stock'), ('tri', 'peach')):
    contours = parse(data[key])
    names = CONTOUR_NAMES.get(key, [key])
    if len(names) != len(contours):
        sys.exit(f'{key}: expected {len(names)} contour(s), got {len(contours)} — update CONTOUR_NAMES')
    for name, (cmds, length) in zip(names, contours):
        paths.append({'id': name, 'colour': colour, 'd': to_d(cmds), 'length': round(length, 1)})

total = round(sum(p['length'] for p in paths), 1)
id_union = ' | '.join(f"'{p['id']}'" for p in paths)

lines = [
    '// AUTO-GENERATED by scripts/gen-hi-mark.py — do not edit.',
    '// Vector source: /tmp/hi-mark/build_mark.py (Alfa Slab One "hi" outlines + the peach',
    '// triangle, centred in a 1000-box at the app icon\'s proportions), baked here with the',
    f'// icon\'s {STRETCH_Y}x vertical stretch and measured by flattening (see the script header).',
    '/* eslint-disable */',
    '',
    '/** Side of the square box every path below is drawn in (the SVG viewBox). */',
    f'export const HI_MARK_BOX = {BOX};',
    '',
    'export interface HiMarkPath {',
    f'  id: {id_union};',
    "  /** Palette entry the path is printed in (card.stock / card.peach). */",
    "  colour: 'stock' | 'peach';",
    '  /** Absolute SVG path data in HI_MARK_BOX units — ONE contour, no transform needed. */',
    '  d: string;',
    '  /** Outline length in the same units (strokeDasharray = this to hide the whole path). */',
    '  length: number;',
    '}',
    '',
    '/** The outlines in pen order, one contour each: h, the i\'s dot, its stem, the triangle. */',
    'export const HI_MARK_PATHS: readonly HiMarkPath[] = [',
]
for p in paths:
    lines.append(f"  {{ id: '{p['id']}', colour: '{p['colour']}', d: '{p['d']}', length: {p['length']} }},")
lines += [
    '] as const;',
    '',
    '/** Sum of the outline lengths — how far the pen travels to draw the whole mark once. */',
    f'export const HI_MARK_TOTAL_LENGTH = {total};',
    '',
]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w').write('\n'.join(lines))
for p in paths:
    print(f"{p['id']}: length {p['length']}  d-chars {len(p['d'])}")
print('total', total, '->', os.path.relpath(OUT))

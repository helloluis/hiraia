"""Renders Hiraia Setup's wallpaper: the website's card-stock cream (--stock, #F4EAD5) with a faint
Philippines map and a faint 2-degree graticule, in the site's ink green. No logo, so nothing on it
reads as part of the interface, and Hiraia's dark icon stands out on the cream.

The map is Natural Earth's 1:10m admin-0 Philippines (public domain), saved here as phl.json.

  /tmp/deckenv/bin/python packages/provisioner/wallpaper/render.py   # needs Pillow
  cp packages/provisioner/wallpaper/out/map-graticule-1080x2400.png \
     packages/provisioner/android/app/src/main/assets/hiraia-wallpaper.png

Changing the image means raising DeviceSetup.WALLPAPER_VERSION, or phones keep the old one.
"""
import json, math
from pathlib import Path
HERE = Path(__file__).resolve().parent
(HERE / 'out').mkdir(exist_ok=True)
from PIL import Image, ImageDraw, ImageFont
CREAM = (0xF4, 0xEA, 0xD5)
INK = (0x1C, 0x3B, 0x2E)
geom = json.load(open(HERE / 'phl.json'))
polys = geom['coordinates']
LAT0 = 12.9
def project(lon, lat): return lon * math.cos(math.radians(LAT0)), -lat
pts = [project(*p) for poly in polys for ring in poly for p in ring]
minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)

def render(W, H, fill_alpha, line_alpha, graticule, path, ss=4):
    w, h = W * ss, H * ss
    scale = min(0.90 * w / (maxx - minx), 0.76 * h / (maxy - miny))
    ox = (w - (maxx - minx) * scale) / 2 - minx * scale
    oy = 0.52 * h - (maxy - miny) * scale / 2 - miny * scale
    base = Image.new('RGBA', (w, h), CREAM + (255,))
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if graticule:  # faint parallels and meridians, like an old school map
        for lon in range(114, 130, 2):
            x = project(lon, 0)[0] * scale + ox
            d.line([(x, 0), (x, h)], fill=INK + (int(255 * 0.035),), width=max(1, ss))
        for lat in range(2, 24, 2):
            y = project(0, lat)[1] * scale + oy
            d.line([(0, y), (w, y)], fill=INK + (int(255 * 0.035),), width=max(1, ss))
    for poly in polys:
        outer = [(project(*p)[0] * scale + ox, project(*p)[1] * scale + oy) for p in poly[0]]
        if len(outer) > 2:
            d.polygon(outer, fill=INK + (int(255 * fill_alpha),))
    for poly in polys:
        for ring in poly:
            line = [(project(*p)[0] * scale + ox, project(*p)[1] * scale + oy) for p in ring]
            if len(line) > 2:
                d.line(line + [line[0]], fill=INK + (int(255 * line_alpha),), width=int(1.6 * ss), joint='curve')
    out = Image.alpha_composite(base, layer).convert('RGB').resize((W, H), Image.LANCZOS)
    out.save(path, optimize=True)
    return out

variants = {'plain': (0.075, 0.16, False), 'graticule': (0.075, 0.16, True)}
for name, (fa, la, grat) in variants.items():
    for W, H in ((720, 1600), (1080, 2400)):
        render(W, H, fa, la, grat, HERE / 'out' / f'map-{name}-{W}x{H}.png')
print('rendered')

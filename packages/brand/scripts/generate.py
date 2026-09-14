"""Generate outlined brand masters. Requires fonttools[woff] (no system font dependency)."""
from pathlib import Path
import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

root = Path(__file__).resolve().parents[1]
font = TTFont(root / 'fonts/Fraunces.woff2')
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upem = font['head'].unitsPerEm
def outline(text):
    pen = SVGPathPen(glyphs)
    bounds = BoundsPen(glyphs)
    x = 0
    for char in text:
        glyph = glyphs[cmap[ord(char)]]
        transform = (100 / upem, 0, 0, -100 / upem, x, 80)
        glyph.draw(TransformPen(pen, transform))
        glyph.draw(TransformPen(bounds, transform))
        x += glyph.width * 100 / upem - 2.7
    return pen.getCommands(), bounds.bounds

layers = ['M5 4Q12 2 20 11Q28 2 35 4', 'M10 14Q15 14 20 21Q25 14 30 14', 'M15 25Q18 26 20 30Q22 26 25 25']
word, bounds = outline('hiraia')
hi, hb = outline('hi')
gx = bounds[2] + .5
width = round(gx + 34, 3)
data = dict(wordPath=word, width=width, height=82, glyphX=gx, layers=layers)
(root / 'brand.generated.json').write_text(json.dumps(data, indent=2) + '\n')
def svg(body, box='0 0 1024 1024'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}">{body}</svg>'
def glyph(color='#BD8928'):
    return f'<g fill="none" stroke="{color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">' + ''.join(f'<path d="{p}"/>' for p in layers) + f'</g><circle cx="20" cy="37" r="2" fill="{color}"/>'
out = root / 'assets'
out.mkdir(exist_ok=True)
for name, ink, gold in [('wordmark', '#1C3B2E', '#BD8928'), ('wordmark-reversed', '#F5ECD6', '#BD8928'), ('wordmark-mono', '#1C3B2E', '#1C3B2E')]:
    body = f'<path d="{word}" fill="{ink}"/><g transform="translate({gx} 0) scale(.85)">{glyph(gold)}</g>'
    (out / f'{name}.svg').write_text(svg(body, f'0 0 {width} 82'))
(out / 'glyph.svg').write_text(svg(glyph(), '0 0 40 40'))
(out / 'favicon.svg').write_text(svg('<rect width="1024" height="1024" rx="280" fill="#1C3B2E"/><g transform="translate(192 192) scale(16)">'+glyph('#F5ECD6')+'</g>'))
# Keep the foreground within Android's central safe circle, including its bottom curve.
scale = 430 / (hb[2] - hb[0])
tx = 512 - (hb[0] + hb[2]) / 2 * scale
ty = 620 - hb[3] * scale
foreground = f'<path d="{hi}" transform="translate({tx} {ty}) scale({scale})" fill="#F5ECD6"/><path d="M340 704Q422 686 512 766Q602 686 684 704" fill="none" stroke="#E9B949" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>'
(out / 'app-icon.svg').write_text(svg('<path fill="#1C3B2E" d="M0 0h1024v1024H0z"/>'+foreground))
(out / 'adaptive-icon.svg').write_text(svg(foreground))
# Native splash starts with the seed at the same position as the JS animation.
(out / 'splash.svg').write_text(svg('<circle cx="512" cy="784" r="32" fill="#E9B949"/>'))
print('Generated brand SVG masters and geometry')

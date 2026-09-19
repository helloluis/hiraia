"""Generate Tala's vector brand masters from the shared Fraunces display face."""

from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[1]
# The shared display TTF carries capitals (including the launcher `TA`) and Filipino text;
# Hiraia's tiny WOFF logo subset intentionally does not.
font = TTFont(root / "fonts" / "Fraunces-SemiBold.ttf")
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upem = font["head"].unitsPerEm


def outline(text: str):
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


def svg(body: str, box: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}">{body}</svg>'


def partial_glyph(color: str = "#E9B949") -> str:
    return (
        f'<path d="M10 14Q15 14 20 21Q25 14 30 14" fill="none" stroke="{color}" '
        'stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
    )


assets = root / "assets"
assets.mkdir(exist_ok=True)

word, word_bounds = outline("tala")
word_width = round(word_bounds[2] - word_bounds[0], 3)
assets.joinpath("wordmark.svg").write_text(
    svg(
        f'<path d="{word}" fill="#087A78"/>'
        f'<g transform="translate({word_width + 4} 24) scale(1.55)">{partial_glyph()}</g>',
        f"0 0 {word_width + 54} 92",
    )
)
assets.joinpath("glyph-partial.svg").write_text(svg(partial_glyph(), "0 0 40 40"))

ta, bounds = outline("TA")
scale = 470 / (bounds[2] - bounds[0])
tx = 512 - (bounds[0] + bounds[2]) / 2 * scale
ty = 590 - bounds[3] * scale
foreground = (
    f'<path d="{ta}" transform="translate({tx} {ty}) scale({scale})" fill="#F5ECD6"/>'
    '<path d="M322 708Q416 692 512 782Q608 692 702 708" fill="none" '
    'stroke="#E9B949" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>'
)
assets.joinpath("app-icon.svg").write_text(
    svg('<path fill="#087A78" d="M0 0h1024v1024H0z"/>' + foreground, "0 0 1024 1024")
)
assets.joinpath("adaptive-icon.svg").write_text(svg(foreground, "0 0 1024 1024"))
assets.joinpath("brand.generated.json").write_text(
    '{\n  "font": "Fraunces SemiBold",\n  "teal": "#087A78",\n  "cream": "#F5ECD6",\n  "gold": "#E9B949"\n}\n'
)
print("Generated Tala brand SVG masters")

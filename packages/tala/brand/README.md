# Tala brand assets

Tala is Hiraia's classroom monitoring companion. It uses the same Fraunces SemiBold
display face and the Hiraia gold, with a more teal application color so a teacher can
tell the two apps apart at a glance.

- **Teal:** `#087A78`
- **Deep ink:** `#173F3D`
- **Cream:** `#F5ECD6`
- **Family gold:** `#E9B949`

`assets/app-icon.svg` is the teal launcher mark: `TA` above a single, partial Hiraia
glyph. `assets/wordmark.svg` and `assets/glyph-partial.svg` are reusable vector masters.
The dashboard keeps the complete Hiraia glyph to make the family relationship explicit.

Run `python brand/scripts/generate.py` with `fonttools` installed, then
`node brand/scripts/rasterize.mjs` to refresh the Android launcher density resources.

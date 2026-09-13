# Hiraia brand assets

Approved direction: lowercase Fraunces SemiBold with a raised book / Wi-Fi / growing-plant glyph. The glyph retains its seed dot. Outlined typography avoids runtime font downloads and keeps web and native spacing identical.

- `assets/wordmark.svg`: forest lettering, gold glyph, transparent background.
- `assets/wordmark-reversed.svg`: cream lettering for forest backgrounds.
- `assets/wordmark-mono.svg`: single-colour artwork.
- `assets/glyph.svg`: full three-layer glyph and dot.
- `assets/favicon.svg`: cream glyph on a forest squircle.
- `assets/app-icon.svg`: cream Fraunces `hi`, one yellow page curve, forest background.
- `assets/adaptive-icon.svg`: transparent foreground within Android's central safe circle.
- `assets/splash.svg`: yellow seed, aligned with the native growing-glyph animation.
- PNG exports accompany the masters. Original AI/PSD files are historical artwork.

Palette: forest `#1C3B2E`, cream `#F5ECD6`, wordmark gold `#BD8928`, icon/animation yellow `#E9B949`.

## Regeneration

From repository root, run `python packages/brand/scripts/generate.py` with `fonttools` and `brotli` installed, then `node packages/brand/scripts/rasterize.mjs` (uses the repository's Sharp dependency). The included Fraunces subset and OFL license make the outlines reproducible. Geometry is generated in `brand.generated.json`; consumer copies live beside each Wordmark component. Run `node packages/brand/scripts/sync.mjs /path/to/web-checkout /path/to/mobile-checkout` to refresh those copies and consumer image assets.

For an existing Android project, run `node packages/brand/scripts/android-resources.mjs /path/to/app-checkout`. A fresh Expo prebuild uses the PNG assets referenced by `app.json`. This changes only brand resources; illustration packaging, cloud storage, model downloads, and content packs are unaffected.

Loading: 2.4-second UI-thread cycle; seed remains visible, lower/middle/upper curves expand from it in sequence, hold, and fade together. The app exits when content is ready without imposing an animation delay. Reduced motion shows the completed glyph and retains the existing fade exit.

## Display typography

UI titles, display numbers, banners, and answer-key chips that previously used Alfa Slab One now use the full static Fraunces SemiBold font. Body copy retains its existing face. Native registers `FrauncesSemiBold` behind the existing `fonts.slab` token; web's `font-slab` utility maps to Fraunces at weight 600.

`fonts/Fraunces-SemiBold.ttf` and `fonts/fraunces-semibold.woff2` contain the complete 624-character font map (including Filipino accents, punctuation, numerals, degree and superscript characters), separate from the tiny logo-only subset. They are self-hosted/bundled and require no runtime Google Fonts request. Reproduce them with `scripts/prepare-display-font.py` from the Google Fonts Fraunces variable source (`ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf`), pinned to opsz=9, wght=600, SOFT=0, WONK=1.

At 28px, five sampled English/Tagalog titles measured 9–11% narrower than Alfa Slab One. This is a sample comparison, not a promise that every string wraps onto fewer lines.

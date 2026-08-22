# Portability review — three question-card visual directions

What this is: a technique-by-technique audit of `riso.html`, `midcentury.html` and
`specimen.html` against the React Native stack this app actually ships on, so the visual
choice can be made with the real implementation bill in front of us.

**The target stack (checked, not assumed).** `packages/mobile/package.json` →
React Native **0.81.5**, Expo **54**, React 19.1, `newArchEnabled=true`,
`minSdkVersion=29`. No `react-native-svg`, no `@shopify/react-native-skia`, no
`expo-image` in the tree today. Device floor is the Redmi (SD685 / **Adreno 610**,
720p, CPU-only inference).

That version matters, and it is good news: on RN 0.81 + New Architecture,
`mixBlendMode`, `isolation`, `boxShadow` (including `inset` and negative spread),
`filter`, `transformOrigin`, `aspectRatio` and `gap` are **all supported view style
props**. Android `mixBlendMode` maps to `android.graphics.BlendMode`, which needs
API 29 — and our floor is exactly 29, so it is available on every device we ship to.

So for these three mockups almost nothing is *impossible*. The real axis is **GPU cost on
an Adreno 610 during a scrolling / page-curling feed**, plus how many one-time asset
pipeline runs each direction forces over the ~18.8k-image bank. Every "hard" below is a
performance or pipeline cost, not a capability gap.

Legend for **RN native?**
`YES` = a plain style prop, no library, no workaround ·
`YES*` = supported on 0.81 + New Arch but with a real perf or fidelity caveat ·
`NO` = not expressible; needs a workaround.

Effort is rough implementation days for one competent RN dev, on top of building the
screen itself.

---

## 1 · Risograph print shop (`riso.html`)

| Technique | Where it is used | RN native? | Workaround / cost |
|---|---|---|---|
| **Stacked duotone blend: `isolation:isolate` box + 2 × `<img mix-blend-mode:lighten>` + box `mix-blend-mode:multiply` onto the bed** | `.ink`, `.ink img` — every illustration, every card | YES* | Supported, but this is **4 blend layers and 2 image decodes per card**. Each blend forces an offscreen buffer on Android; with 2–3 cards mounted plus a curl animation that is 8–12 offscreen composites a frame on an Adreno 610. **Do not ship it live.** Bake the blue plate into all ~18.8k WebPs offline (one pipeline run, zero device cost) and keep at most the coral ghost as a live layer — or drop the ghost. **Effort: 1 d pipeline + 0.5 d RN.** |
| Halftone screen — `repeating radial-gradient` + `mix-blend-mode:multiply` (`.screen`) | over every illustration | NO | RN has no CSS gradients. Export one small tiled PNG, `<ImageBackground resizeMode="repeat">` + `mixBlendMode:'multiply'`, or bake it into the same offline pass. **0.5 d.** |
| Paper grain — inline **SVG `feTurbulence`** data-URI, `multiply` @ 50% (`.grain`) | full-page paper texture | NO | No SVG filters in RN and no `react-native-svg` in the tree. One tiled noise PNG, repeated. Pure polish; the direction survives losing it. **0.5 d.** |
| Perforated tear rule — `repeating-linear-gradient` (`.fork-perf`) | the fork page only | NO | A row of ~40 small `View`s, or a 1×5px tiled PNG. Trivial either way. **0.25 d.** |
| Hard offset shadows, 10 of them, all **zero-blur** (`4px 4px 0 var(--ink-blue)` etc.) | chips, plate, quiz options, cat stamp | YES | `boxShadow: '4px 4px 0 #2B3A87'` works on 0.81. This is the one shadow style Android renders *exactly* right, because zero blur means no elevation approximation. If you ever downgrade RN, it degrades to a duplicated absolutely-positioned `View` — identical result, one extra node. **0.25 d.** |
| `transform: rotate` ×16 + `transform-origin` ×2 (the hand-inked Y, the tilted chips) | fork page | YES | `transform:[{rotate:'-1.3deg'}]`, `transformOrigin` since RN 0.74. **Free.** |
| Dashed borders ×3 (Q/A divider, tear line) | short card, fork | YES* | `borderStyle:'dashed'` exists but Android renders dash length/phase differently from iOS and ignores it under some radii. Android-only product, so low risk; swap for a row of `View`s if it looks wrong. **0.25 d.** |
| Full-bleed bands inside a padded sheet (green SANGANDAAN band, mustard quiz header) | fork + quiz | YES | Negative horizontal margins work in RN, but the clean port is to move the padding off the sheet and onto each non-bleeding row. Restructuring, not a blocker. **0.5 d.** |
| Fonts: **Fraunces** (variable, WONK/SOFT), **Bricolage Grotesque**, **Courier Prime** | everywhere | YES | All three are SIL OFL 1.1 — **no licensing issue, redistributable in an APK**. No variable-font runtime needed: the WONK/SOFT instance is baked at export. 3 families ≈ 5–6 static TTFs ≈ 350–450 KB. Register with `expo-font`. **0.5 d.** |
| Crop marks, double rules, letter tabs, page numbers | chrome on every card | YES | Plain `View` + `borderWidth`. **Free.** |

**Nothing here uses CSS grid, pseudo-elements as structure, `backdrop-filter`, or `clip-path`.**

**Riso total risk:** one genuinely expensive idea (the live duotone) that has a clean,
already-identified offline escape hatch — but the escape hatch **locks the artwork**. A
baked blue-and-coral plate cannot be reused if you later switch direction, or re-skinned
for a dark mode, without a fresh 18.8k-image run.

---

## 2 · Mid-century classroom card (`midcentury.html`)

| Technique | Where it is used | RN native? | Workaround / cost |
|---|---|---|---|
| `mix-blend-mode: multiply` on the engraving so it prints on **cream, not white** | `.plate img` — one layer, one image, per card | YES* | The only blend in the whole file. Even so, the right answer is the shared offline pass: `convert x.png -fuzz 6% -transparent white` over the bank, after which a plain `<Image>` composites on cream for **free**. Third option, and this is why `#FFFFFF` is deliberately in the palette: keep the plate white. It still reads as a mounted print; it just looks pasted-on rather than printed. **1 d pipeline, or 0 d if you accept white.** |
| Card / deck drop shadows — 4 × `box-shadow: 0 Npx 0` (zero blur) | board, deck, card | YES | `boxShadow` on 0.81; zero-blur again, so Android is exact. **Free.** |
| The chunky ledge under every button | next ticket, fork chips | YES | Deliberately **not** a shadow — it is a dark parent `View` with 4–5 px of bottom padding and a slightly larger radius. Ports byte-for-byte and needs no shadow support at all. This is the single best-engineered detail in any of the three files. **Free.** |
| Fanned fork branch cards — `transform: rotate` + `transform-origin: 50% 16px` (pivot at the binder ring) | fork card | YES | `transformOrigin` since RN 0.74; we are on 0.81. Two absolutely-positioned `View`s. **0.25 d.** |
| Punched holes + brass binder rings | every card | YES | `borderRadius: 50%` on `View`s (6 uses). **Free.** |
| `text-overflow: ellipsis` ×4 (topic band, choice words) | index band, chips | YES | `numberOfLines={1} ellipsizeMode="tail"`. Note "lunar eclipse" is already near the limit at 10.5 px / 0.15 em, so longer topic labels **truncate rather than wrap** — a content constraint to accept deliberately. **Free.** |
| Adaptive type ramp — 4 steps off `string.length` (18/16.5 → 16.5 → 15 → 14 px) | factoid body | YES | Pure JS on the string. **No `onLayout` measurement pass, no extra frame.** This is a meaningful runtime advantage over direction 3. **Free.** |
| Fonts: **Alfa Slab One**, **Zilla Slab** 500/700, **Chivo** 900 | headings / body / micro-labels | YES | All SIL OFL 1.1 — **clean to bundle**. Ship only the weights used (Chivo 900 alone, not the family): ≈ 6 files, ≈ 400 KB. **0.5 d.** |
| Gradients, SVG, filters, CSS grid, `backdrop-filter`, pseudo-element structure | — | — | **Zero occurrences in the file.** Verified by grep, not by claim. |

**Mid-century total risk:** essentially one decision (knock out the white, or don't).
Everything else is `View` + `borderWidth` + `borderRadius` + `backgroundColor` +
absolute positioning.

---

## 3 · Natural-history specimen plate (`specimen.html`)

| Technique | Where it is used | RN native? | Workaround / cost |
|---|---|---|---|
| Sepia wash — one solid-colour `View` with `mix-blend-mode:multiply` over the image, inside `isolation:isolate` | `.tintlayer`, every plate | YES* | The **cheapest possible blend usage**: a flat colour over one image, one layer, no extra decode. Cheaper on-device than riso's stack by a wide margin. And the mockup ships its own OFF state — the `SEPIA TINT: ON / OFF` toggle *is* the no-blend fallback, and the design still reads. **0.25 d, and it is optional.** |
| **12 × `box-shadow`, and most are soft, multi-layer, negative-spread** — e.g. `0 26px 44px -16px`, `0 18px 34px -14px` | card lift, fork card, tabs, quiz band | YES* | RN 0.81 accepts the `boxShadow` string including negative spread, so it will *render* — but soft blurred shadows are the second-most expensive thing on an Adreno 610 after blends, and multi-layer soft shadows on a card that is being page-curled is exactly the wrong place to spend GPU. Budget a pass to flatten these to one cheap shadow (or an `elevation`) and accept the fidelity loss. **1 d.** |
| **6 × `inset` box-shadow** used as hairlines (`inset 0 0 0 1px …`) | tabs, cartouche, quiz slugs, mount | YES* | Supported on 0.81, but every one of these is a 1 px inset hairline that a plain `borderWidth: 1` reproduces for free and faster. Straight substitution. **0.5 d.** |
| Paper speckle — 2 tiled `radial-gradient`s @ 3.5–5 % alpha; app field — 2 more large `radial-gradient`s | card stock, background | NO | No gradients in RN. Speckle → a 24×24 px tiled PNG (<1 KB) as `ImageBackground`, or drop it (it is at 4 % alpha). The **app-field vignette** is the larger one and would need a full-screen 9-slice or gradient PNG. **0.5 d.** |
| **`aspectRatio:1` + `maxHeight:'100%'` + `maxWidth:'100%'` on the mount** | the mechanism that absorbs a 43-char *and* a 247-char factoid in **one** layout | YES* | `aspectRatio` is long-supported, but **`aspectRatio` combined with a percentage `maxHeight` inside a flexing parent is the single thing in these three files I would not trust until it is on a device.** Yoga resolves percentage max-constraints against a parent that is itself flexing, and it does not always match web. If it misbehaves the safe port is `onLayout` on the mount slot then sizing the square from the smaller edge — which costs an extra layout pass **per card** in a fast feed. Compare: direction 2 solves the same problem with a 4-step `string.length` ramp and no measurement at all. **0.5 d if it works, 1.5 d if it doesn't.** |
| `filter: brightness(1.12)` on tab hover | tabs | YES | Mockup-only polish; RN uses `activeOpacity` or a pressed-state colour. **Free.** |
| `transform: rotate` ×4 (ghost sheets, corner ticks at 45°) | fork card, all cards | YES | Two absolutely-positioned `View`s behind the card. **Free.** |
| Cartouche, rules, corner ticks, pips, fleuron, gilt edge | everywhere | YES | Plain `View` + `borderWidth` / `borderRadius` / `rotate(45deg)`. **Free.** |
| Fonts: **Fraunces**, **Alegreya Sans SC**, **Bodoni Moda** | body / furniture / numerals | YES | All SIL OFL 1.1 — **clean**. Bundle static Fraunces Regular/SemiBold/Bold + Italic and drop `font-variation-settings`; Bodoni is numerals-only so one weight. ≈ 5–6 files. **0.5 d.** |
| CSS grid, pseudo-element structure, `backdrop-filter`, SVG | — | — | **Zero occurrences.** Verified by grep. |

**One measured layout defect** (found during verification, not fixed — it is a design
decision, not a broken file): on the fork card the two decorative `.ghost` sheets extend
**13.7 px left, 11.1 px right and 9.5 px below** the 320×640 device frame. The card
itself is clean (`scrollHeight == clientHeight == 638` on all four). On a real 320-wide
screen those ghosts get clipped by the screen edge. One-line fix: inset the ghosts and
reduce the rotation, exactly as direction 2 already does for its fanned cards
(inset 10 px at ±2.3°).

---

## Shared costs (do not let these decide the choice)

- **All three** need the white knocked out of the greyscale artwork, and for all three the
  cheapest answer is the *same* one-time offline pass over the ~18.8k-image bank. Budget
  it once, ~1 day, whichever direction wins.
- **All three** use exactly three Google families, **all SIL OFL 1.1** — no licensing risk
  in any direction, ~400 KB of TTF in the APK either way.
- **None** of the three uses CSS grid, `backdrop-filter`, `clip-path`, `react-native-svg`,
  or pseudo-elements carrying structure. Every one of these files was clearly authored
  with the RN port in mind, and that is worth saying.
- Adding Skia is **not required by any of them** on RN 0.81. It would only come up if we
  ever downgrade, or want blends the platform blend modes cannot express.

## Cross-direction inconsistencies to settle before implementation

- Quiz option letters: riso and mid-century use **A / B / C / D**; specimen uses
  **A / B / K / D** — the Filipino *abakada* sequence. This looks deliberate and is
  arguably the better call for a Filipino product, but it must be one rule across the app,
  not a per-direction accident.
- Card-frame nouns differ: *pahina* (riso) / *kard* (mid-century) / *plato* (specimen).
  That is a copy decision that travels with the direction; picking a look picks a noun.

---

## Recommendation

**Cheapest to ship faithfully: mid-century classroom card, by a clear margin — and it is
not close.** It is the only one of the three whose entire visual identity is expressible in
`View` + `backgroundColor` + `borderWidth` + `borderRadius` + absolute positioning, with
*one* blend mode in the whole file and *zero* gradients, filters or SVG. Its two most
distinctive gestures — the chunky ledge under every button and the fanned fork cards — are
already engineered as RN primitives rather than CSS effects, and its adaptive type ramp
runs off `string.length` with no measurement pass, which is the difference between a feed
that scrolls at 60 fps on an Adreno 610 and one that hitches on every card mount. Realistic
delta over a plain unstyled implementation: **~2–3 days**, most of it the shared white-knockout
pipeline you owe anyway. **Specimen plate is a close second** at ~3–4 days: its blend usage
is the cheapest of the three and comes with a designed OFF state, but you will pay for the
twelve soft multi-layer shadows and you carry one genuine unknown — the
`aspectRatio` + percentage-`maxHeight` mount, the mechanism the whole
one-layout-fits-all-lengths claim rests on, which must be validated on a real Redmi before
it is trusted. **Risograph loses the most in translation, and loses the thing it is named
after.** Its memorable idea *is* the mis-registered duotone, and the only sane way to ship
that on this hardware is to bake it into the image bank offline — at which point the
artwork is permanently coral-and-federal-blue, the live coral ghost is the first thing cut
on a low-end device, and the paper grain and halftone screen (its other two texture
signatures) both degrade to tiled PNGs. Ship riso and you are committing the 18.8k-image
bank to one palette forever and accepting that the low-end device sees the flattest version
of the most texture-dependent design. That is a strategy decision, not an implementation
detail, and it should be made with eyes open rather than discovered in week three.

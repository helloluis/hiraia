# Hiraia Asset Style Spec

The single source of truth for authoring the pre-built SVG asset library. Every asset — whether hand-drawn, agent-generated, or edited in Illustrator — must follow this so that hundreds of independently-authored pieces stay **visually consistent** and **freely combinable** into scenes.

Companion docs: [`ASSET-INVENTORY.md`](./ASSET-INVENTORY.md) (what to build), [`HYBRID-APPROACH.md`](./HYBRID-APPROACH.md) (how the LLM uses them).

---

## 0. The one mental model

> **Assets are clean, label-free, flat clip-art. Character is added at render time.**

- Author **clean geometry** — no hand-jitter, no baked shake.
- The **hand-drawn "wobble" is a render-time effect** (`renderScene` applies a scene-level SVG displacement filter to everything, assets included). Do **not** try to bake the sketchy look into an asset.
- Author **no descriptive labels** — the scene/LLM supplies names. (See §3.)

This is what lets one carabao asset appear crisp in a catalog, sketchy in a diagram, and labeled "Kalabaw" or "Carabao" or "Water buffalo" depending on the scene — without re-authoring.

---

## 1. Files & layout

```
assets/<subject>/<id>.svg     # the artwork
assets/<subject>/<id>.json    # metadata (REQUIRED — loader skips an svg with no json)
```

- **subject** ∈ `biology` · `chemistry` · `physics` · `earth-science` · `general`
- **id** — kebab-case, matches the filename and the inventory (`rice-palay`, `figure-stick-male`, `magnet-bar`).
- One concept per file. Composites/scenes are assembled at render time, not stored.

## 2. SVG output rules

- **Inline presentation attributes only.** `fill="…"` / `stroke="…"` directly on each element. **No `<style>` blocks, no CSS classes.** Class names are global once assets are embedded in a scene, so two assets sharing `.cls-1` will bleed colors into each other. (This is the #1 cause of "it looked fine alone but broke in a scene.")
- **No editor cruft.** Strip `<?xml>` editor metadata, `Generator:` comments, Adobe/Inkscape private namespaces, empty `<defs>`, redundant wrapper `<g>` layers.
- **`viewBox="0 0 W H"` is required** — the loader parses it. `width`/`height` are optional (the loader strips the outer `<svg>` anyway).
- **Don't add `<svg>` wrappers, scripts, external refs, or `<image>`** (no raster embeds). Vector shapes/paths only.
- **Get there automatically:** export from Illustrator with **Styling → Presentation Attributes** (+ Convert to Outlines, Object IDs → Minimal, Decimal 2, Responsive on, *Export As* not *Save As*), then run **`pnpm --filter @hiraia/images normalize`** (or the QC **normalize all** button) — SVGO enforces all of the above.

## 3. Labels — the composition rule

> **Strip name/title/descriptive captions. Keep only symbols/values intrinsic to the diagram's meaning.**

**Remove** (the scene supplies these as overlays):
- Asset name/title captions — "Leaf", "Animal Cell", "Kalabaw", "SUN".
- Internal part labels — "nucleus", "mitochondria", organ names, "stamen".

**Keep** (the diagram is meaningless without them):
- Chemical symbols & formulas — `C`, `O`, `H`, `H₂O`, `CO₂`.
- Magnet poles `N`/`S`; polarity `+`/`−`.
- Scale & axis numbers (thermometer, graphs); allele letters (`T`/`t`); periodic-table symbols.

Rule of thumb: if it names *what the thing is*, remove it; if it's a value/symbol that *is part of the thing*, keep it. Kept text must fit **inside** the viewBox (watch overflow — e.g. a "100" sticking past the edge).

## 4. Visual style

Flat, friendly, educational clip-art with clear dark outlines — readable down to ~120px thumbnails.

- **Outlines:** every shape has a stroke. Dark, not pure black — slate `#1f2937` (or a darker shade of the fill's hue, e.g. leaf `#2e7d32`, soil-brown `#5d4632`).
- **Stroke width:** ~`2`–`2.5` units per ~100 viewBox units. Scale proportionally for larger/smaller canvases. Use `stroke-linejoin="round"` / `stroke-linecap="round"` for the friendly look.
- **Fills:** flat, single colors (no gradients, no filters in the asset). Slightly muted/saturated educational tones.
- **Palette** (reuse these; keep the library tight):
  | role | hex |
  |------|-----|
  | outline (default) | `#1f2937` |
  | sun / warm | `#fbbf24` / outline `#b45309` |
  | plant green | `#7cb342` / outline `#2e7d32` |
  | water / sky blue | `#4fc3f7` / outline `#37536b` |
  | warm red | `#e53935` / outline `#7f1d1d` |
  | electric blue | `#1565c0` |
  | earth brown | `#8d6e4f` / outline `#5d4632` |
  | neutral grey | `#7d8389` / outline `#3f4348` |
  | skin (figures) | `#ffe0b2` |
- **Canvas/sizing:** content fills the viewBox with a small margin (~5–10%). Typical single-object viewBox ~`100–150` units on the long side. Keep the natural aspect ratio (don't pad to a square unnecessarily).
- **No drop shadows, no 3D, no photoreal.** Front/side "textbook" view.

## 5. Metadata (`<id>.json`)

```json
{
  "id": "rice-palay",
  "name": "Rice plant (Palay)",
  "description": "Rice plant with drooping grain head; producer in food chains",
  "subject": "biology",
  "grades": ["K-3", "4-6"],
  "tags": ["plant", "crop", "rice", "producer", "philippines"],
  "curriculum": ["S3LT-IIe-f-8"],
  "source": "hiraia",
  "license": "CC-BY-4.0",
  "viewBox": [100, 140]
}
```

- **description / tags** drive retrieval — write them for *search*, in the words a teacher/LLM would use (include Filipino terms where relevant). No name caption in the art, but the `name` lives here.
- **grades** ∈ `K-3` `4-6` `7-9` `10-12`. **curriculum** = DepEd competency codes where known.
- **viewBox** `[W, H]` must match the SVG's viewBox.
- **source** `hiraia`; **license** `CC-BY-4.0` (or `CC0`) — keep consistent.

## 6. Authoring checklist

- [ ] Clean geometry, no baked jitter/shake, no shadows/gradients.
- [ ] Inline `fill`/`stroke` attributes; **no `<style>`/classes**, no editor cruft.
- [ ] `viewBox="0 0 W H"` present and matches the JSON.
- [ ] **No descriptive labels**; only intrinsic symbols kept, and they fit inside the viewBox.
- [ ] Outline on every shape; palette + stroke weight per §4.
- [ ] `<id>.json` present and complete; viewBox matches.
- [ ] Ran `normalize`; viewed in `pnpm qc` and it reads correctly at thumbnail size **and** with the render-time wobble.

## 7. The QC loop

1. `pnpm --filter @hiraia/images qc` → http://localhost:5173 — every asset rendered through `renderScene` (real wobble), grouped by subject, flags missing/broken metadata.
2. Spot a weak one → **open in Illustrator** (one click) or copy its path.
3. Edit by hand → save (Export As SVG, Presentation Attributes).
4. **normalize all** (button) → page auto-reloads → eyeball the result.

## 8. Render-time reference (for context — not something assets encode)

- Hand-drawn wobble: scene-level `feTurbulence` + `feDisplacementMap`. Intensity = `style.roughness` (default **4**); noise frequency `baseFrequency=0.035`. Text is lifted to a crisp layer; geometry renders clean (`roughness:0`) and the filter does the shaking.
- Scene supplies labels as `text` overlays and connects assets with drawn `arrow`/`line` primitives; missing concepts fall back to drawn primitives/`figure:*` templates.

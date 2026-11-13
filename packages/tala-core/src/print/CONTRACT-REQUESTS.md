# Print integration requests

- Add `colors.printInk = '#000000'` to shared tokens. BRAND-6 requires black; existing tokens have only forest ink. `print/index.ts` temporarily defines a local monochrome adapter. Switch it to the shared token when available.
- `print.planPdf` uses `z.coerce.boolean()`: query `images=false` becomes **true**. Replace with an explicit `'true' | 'false'` string transform/boolean union. Current V1 SectionContent has no images, so rendering is text-only for either value and no remote images are fetched.
- Core exports `renderPlanHtml`, `renderPlanText`, `printPageSize`, bundled Fraunces font and glyph through `@hiraia/tala-core/print`. Font data is ~100 KB of source; no runtime dependency. HTML embeds the title font, uses the shared system body stack and lets the platform printer embed system-font subsets. Server fallback embeds Fraunces for all text. Platform PDF/font coverage checks remain necessary on actual Android/web print services.

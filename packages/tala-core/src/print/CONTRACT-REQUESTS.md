# Print requests — addressed

`3c9978d27` added `colors.printInk` and explicit `QueryBool`; rendering now uses the
shared black token, and `images=false` reaches the server as false.

Core exports `renderPlanHtml`, `renderPlanText`, `printPageSize`, bundled Fraunces
font and glyph through `@hiraia/tala-core/print`. Font data is ~100 KB of source;
no runtime dependency. HTML embeds the title font, uses the shared system body
stack and lets the platform printer embed system-font subsets. Server fallback
embeds Fraunces for all text. Actual Android/web print services still need
font-coverage and school-printer acceptance checks.

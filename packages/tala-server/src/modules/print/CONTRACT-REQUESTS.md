# Server print requests — addressed

`3c9978d27` preserves route path literals and fixes boolean query parsing. The
handler now uses typed `input.params.planId` without a narrowing adapter.

Dependencies appended to server only: `pdf-lib@^1.17.1`, `@pdf-lib/fontkit@^1.1.1`.
The server PDF is a paginated, font-embedded **plain-text fallback** from
`renderPlanText`, not a second HTML engine. The device HTML renderer owns the full
DLP/DLL/multigrade table layout. No image fields exist in V1 SectionContent; both
images flags produce text-only PDFs, with no network or image loading.

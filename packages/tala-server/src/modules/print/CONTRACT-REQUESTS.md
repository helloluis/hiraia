# Server print requests

`ParamsOf<'print.planPdf'>` currently has no `planId` property because route path
literals are widened by the route factory. The handler temporarily narrows the
params locally and validates with `Id.parse`. Preserve literal route paths in the
API route factory so every server module gets typed path parameters.

Dependencies appended to server only: `pdf-lib@^1.17.1`, `@pdf-lib/fontkit@^1.1.1`.
The server PDF is a paginated, font-embedded **plain-text fallback** from
`renderPlanText`, not a second HTML engine. The device HTML renderer owns the full
DLP/DLL/multigrade table layout. No image fields exist in V1 SectionContent; both
images flags currently produce text-only PDFs, with no network or image loading.

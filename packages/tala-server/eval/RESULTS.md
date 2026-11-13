Worker C live generation follow-up — 2026-11-13 (UTC)

Qwen now has valid end-to-end results for all nine fixtures (the original eight plus Grade 2 + Grade 4 Filipino). Every latest accepted result passed on its first attempt without repair. Requests used the real authenticated generation.create/get routes, persistent job runner, shared gateway, compact schema/converter, structural validators and kernel response validation. The curriculum service supplies explicit fixture objectives, never production data. No secret values or lesson text were logged.

The final matrix combines the latest full nine-case sweep with the final three-case smoke run after constraining objective-reference enums. It is NOT a claim that one final sweep passed all nine at once: the full sweep passed eight, the typed-objective case then passed independently, and the final smoke confirmed English/Filipino two-grade and typed-objective cases. sourceRun in live-results.json preserves that provenance. No previously accepted reference is invalidated by the enum constraint: the converter already rejected unknown refs.

| Case | Schema | One teacher | All groups active | Competencies in objectives + assessment | Time + transitions | Declared materials | Input/output tokens | Latency s | Retry / repair |
|---|---|---|---|---|---|---|---|---|---|
| g2-g4-en | pass | pass | pass | pass | pass | pass | 2066/683 | 4.76 | no / no |
| g2-g4-fil | pass | pass | pass | pass | pass | pass | 2076/983 | 7.25 | no / no |
| three-group-fil | pass | pass | pass | pass | pass | pass | 2054/1453 | 8.08 | no / no |
| four-group-en | pass | pass | pass | pass | pass | pass | 2093/1454 | 8.15 | no / no |
| no-electricity-fil | pass | pass | pass | pass | pass | pass | 1995/854 | 5.04 | no / no |
| short-period-en | pass | pass | pass | pass | pass | pass | 1985/711 | 4.43 | no / no |
| custom-objectives-fil | pass | pass | pass | pass | pass | pass | 1672/773 | 5.04 | no / no |
| single-dlp-en | pass | pass | pass | pass | pass | pass | 1593/576 | 3.72 | no / no |
| weekly-dll-fil | pass | pass | pass | pass | pass | pass | 1460/590 | 3.74 | no / no |

Diagnostics and cause

- Follow-up live calls: 37 total; all returned HTTP 200, finish_reason=stop. No authentication, region/model, rate-limit, transport, provider-envelope or timeout failures occurred in these instrumented calls. Direct Singapore endpoint: https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions; model qwen-flash; enable_thinking=false; response_format=json_object. No aggregator.
- The original four attempts were not instrumented enough to reconstruct the exact cause of attempts 1–2. Their HTTP status, finish reason and error object were discarded. We cannot truthfully infer those historical errors now. Current endpoint/model/parameters are proven by successful calls. Instrumentation now classifies provider HTTP/envelope errors separately from completion JSON/schema/rule failures without logging response bodies.
- Development probes reproduced missing per-group fields and minute sums that counted transitions outside block durations. The first compact schema defaulted absent fields, hiding the exact shape problem. Per-template discriminated schemas now require relevant fields, and worked examples match the single-grade, weekly or multi-grade format.
- Server-owned timing/focus slots remove model arithmetic from the trusted path. IDs, RichText and authoritative objective text are expanded locally; the model provides activity strings and exact target refs. Every supplied ref is still required by validators in objectives and assessment; missing/unknown refs are refused, not fabricated or repaired.
- The final typed-objective defect was an invented curriculum ref instead of custom-1. Target fields now enumerate the exact allowed refs, and prompts explicitly forbid copying example refs. It passed first try afterward.
- Truncation was not reproduced in these compact calls. maxOutputTokens is budgeted at 4096 for section, 8192 for single/two-grade and 12288 for weekly/three/four-grade requests. finish_reason=length is classified before JSON parsing and triggers the ordinary one retry with tighter wording; a fake test proves the behavior. V1 prompts remain unchanged.

Usage and cost

Metered follow-up usage: 67,901 input and 32,258 output tokens. Conservative list-price estimate: USD 0.01629825; actual billed amount was not available. Singapore rates (input below 256K) were verified as USD .05 / million input, .4 / million output at https://www.alibabacloud.com/help/en/model-studio/qwen-flash. Caching, free quota or discounts can reduce actual cost. All unsuccessful development attempts are included in live-attempts.jsonl. The four historical attempts are outside this follow-up count and their unknown cost is not presented as zero.

Limits and remaining review

- DeepSeek: DEEPSEEK_API_KEY unavailable in the authorized source; no live calls made. The same compact schema, conversion, retry, finish-reason classification and rule checks run on both provider paths against fakes. A DeepSeek live release gate remains pending.
- Deterministic scheduling guarantees structural timing and one focus group; it does not prove activity text is age-appropriate, truly doable unaided, factually accurate or feasible in each slot. Fixed schedules use a simple rotation, not adaptive competency pairing. Three/four-group prompts explicitly acknowledge short focus time. Teacher quality review remains required before publication.
- Materials scoring verifies declared resource names against the class profile; equipment implicitly mentioned in prose still needs teacher review. No semantic content-alignment claim is made.
- Three latest fixture plans are saved in samples/ for teacher review: g2-g4-en, three-group-fil, weekly-dll-fil. No deployment/publication has occurred.

Final offline verification after merging the real record store

- `corepack pnpm --filter @hiraia/tala-server type-check` — pass.
- `corepack pnpm --filter @hiraia/tala-server test` — 99/99 pass.
- `corepack pnpm --filter @hiraia/tala-core type-check` — pass.
- `corepack pnpm --filter @hiraia/tala-core test` — 74/74 pass.
- `corepack pnpm --filter @hiraia/tala-server exec tsx eval/runner.ts` — 18/18 fake-provider cases pass through real authenticated jobs and gateway conversion.
- Explicit strict TypeScript check of eval/runner.ts — pass.
- Real RecordStore section test proves source context is read and existing sections remain untouched.
- Real account.delete integration test proves job/quota/usage deletion and anonymous budget retention. In-flight/queued cancellation prevents reintroducing deleted user rows. The compatibility hook mirror is documented in CONTRACT-REQUESTS.md because the current kernel still reads the extension location.

DeepSeek live verification — 2026-11-13 (latest status)

DeepSeek passed the entire fixed nine-case set in ONE clean sweep, run `2026-11-13T13:54:01.261Z`. All results were attributed to deepseek / deepseek-flash with fellBack=false. No retries, repairs, provider fallback, prompt edits or targeted DeepSeek reruns were needed. The existing v2 prompt files are unchanged. Three DeepSeek plans are saved next to Qwen samples with the -deepseek suffix.

Model and pricing verification

- [DeepSeek official pricing](https://api-docs.deepseek.com/quick_start/pricing/) identifies deepseek-flash as DeepSeek-V4.1-Flash-1017; the mapping from Luis's “DeepSeek v4.1 Flash” is correct. The [official update](https://api-docs.deepseek.com/news/news261017/) also identifies this model name as the current Flash entry point.
- The verified peak, uncached rates are USD .30 / million input tokens and 1.20 / million output tokens. The runner received these through TALA_LLM_PRIMARY_INPUT_USD_PER_MILLION and TALA_LLM_PRIMARY_OUTPUT_USD_PER_MILLION, then ProviderConfig.pricing. This is a conservative peak/uncached upper estimate, not a guessed placeholder. Off-peak rates are half, and cache hits are cheaper. No invoice or credit balance was accessed.
- [Official thinking-mode documentation](https://api-docs.deepseek.com/guides/thinking_mode/) says thinking defaults to enabled. The DeepSeek adapter now explicitly sends thinking={type:disabled} with JSON-object output; Qwen's existing enable_thinking=false is unchanged. No v3 prompt was necessary.
- Direct endpoint only: https://api.deepseek.com/chat/completions. Provider-selected sweeps disable the other provider rather than silently using it. Credentials are inherited at runtime by sourcing the orchestrator's designated ignored .env file; the runner no longer reads any credential file or searches other locations.

Single-sweep pass matrix

Time includes exact total minutes, valid transition bounds and weekly day count/duration. Competency coverage means presence in both objectives and assessment. Materials checks declared resource names; activity prose still needs teacher review.

| Case | Schema | One teacher focus | Every group active | Competencies | Time | Materials | Input/output tokens | Latency s | Estimated USD | Retry / repair |
|---|---|---|---|---|---|---|---|---|---|---|
| g2-g4-en | pass | pass | pass | pass | pass | pass | 2235/540 | 3.640 | $0.0013185 | no / no |
| g2-g4-fil | pass | pass | pass | pass | pass | pass | 2245/789 | 5.247 | $0.0016203 | no / no |
| three-group-fil | pass | pass | pass | pass | pass | pass | 2322/1074 | 5.838 | $0.0019854 | no / no |
| four-group-en | pass | pass | pass | pass | pass | pass | 2379/1046 | 5.338 | $0.0019689 | no / no |
| no-electricity-fil | pass | pass | pass | pass | pass | pass | 2245/769 | 4.836 | $0.0015963 | no / no |
| short-period-en | pass | pass | pass | pass | pass | pass | 2235/475 | 2.923 | $0.0012405 | no / no |
| custom-objectives-fil | pass | pass | pass | pass | pass | pass | 1822/705 | 4.531 | $0.0013926 | no / no |
| single-dlp-en | pass | pass | pass | pass | pass | pass | 1817/411 | 2.627 | $0.0010383 | no / no |
| weekly-dll-fil | pass | pass | pass | pass | pass | pass | 1670/438 | 3.321 | $0.0010266 | no / no |

Sweep totals: 18,970 input tokens, 6,247 output tokens; peak/uncached estimate $0.0131874. All nine HTTP responses were 200 with finish_reason=stop. Exact diagnostics and rule outcomes are in deepseek-attempts.jsonl and deepseek-results.json.

Provider-chain proof

1. Primary success: one live DeepSeek completion, single-dlp-en; servedBy=deepseek, fellBack=false, valid structured lesson. 1817/456 tokens, 3.039s, estimated $0.0010923.
2. Forced primary failure: the runtime model ID was temporarily replaced with a deliberately nonexistent model, never a different key. DeepSeek returned HTTP 400 / invalid_request_error. The same request succeeded through one live Qwen completion, servedBy=qwen, fellBack=true. 1668/625 tokens, 4.247s, metered-token estimate $0.0003334. The conservative ledger reservation for the rejected primary attempt is retained separately as budgetLedgerUsd, not represented as actual billed cost.
3. Both unavailable: controlled 503 providers, no live calls. The actual gateway returned typed providers_unavailable; the job preserved its input and buildPrefilledDraft produced 8 editable sections. This checks the failure-to-manual path without taking real providers offline.

The chain assertions and metadata are in chain-proof.json; reproduce with eval/chain.ts. An additional live Filipino Grade 2 + Grade 4 Qwen regression passed first try with no repair, showing the DeepSeek-specific parameter change did not break Qwen. See qwen-results.json.

Call budget and security

This follow-up dispatched 11 DeepSeek requests (9 sweep, 1 successful chain proof, 1 deliberately rejected bad-model request) and 2 Qwen requests (1 fallback proof, 1 multi-grade regression), within the 40/5 limits. Known-response metered-token estimate across successful calls: $0.01505930, using conservative DeepSeek peak/uncached prices and Qwen's documented Singapore rates. Actual charged cost may be lower; the bad-model response supplied no usage. Runtime dispatch guards prevent exceeding per-process evaluation limits before outbound calls.

Only the designated .env was sourced into process environments. No secret file was copied or committed. Saved artifacts and source changes were scanned in memory against the loaded credential values, without printing or writing them. The three fictional DeepSeek plans are explicit review samples, not logs. No production data, deployment, publication or push occurred.

Final checks for this follow-up: both package type-checks pass; server 213/213 tests pass; core 231/231 tests pass; offline end-to-end fixtures 18/18 pass; strict standalone TypeScript checks for eval/runner.ts and eval/chain.ts pass. Dispatch guards, DeepSeek/Qwen parameter separation and disabled-provider credential isolation are covered by fakes. Changed source/artifacts scanned against both loaded credential values: zero matches. All three DeepSeek samples also contain no internal competency IDs in section content. No prompt file changes or added dependencies.

Remaining gates: teacher review of scientific accuracy, language, feasibility and age-appropriate independent work. Structural success does not establish content alignment. This entry supersedes the historical “DeepSeek unavailable” gate below; the historical Qwen run and its failures remain as provenance.

---

Historical Qwen verification (earlier the same day)

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

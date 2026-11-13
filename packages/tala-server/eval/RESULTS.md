Worker C verification — 2026-11-13 (UTC)

Offline: 8 fixed cases × both fake provider labels = 16 schema/rule passes. Weekly time-budget score is unscored (null), since weekgrid has prose rather than structured minutes. Fake lesson content is a validator fixture, not a teacher-quality score.

Live: only the authorized Hiraia `.env.local` was consulted; no secrets displayed or saved. DeepSeek skipped: DEEPSEEK_API_KEY unavailable. Alibaba credential available; TALA_LLM_FALLBACK_MODEL initially unset. Explicit trial model: qwen-flash, direct Singapore DashScope API. Four tiny attempts total (maximum 4000 output tokens each):

1. Provider attempt failed before a usable result; original reporting did not classify the failure.
2. Provider attempt failed before a usable result; no HTTP status was available.
3. JSON result received: 1070 input tokens, 1318 output tokens; failed SectionContent schema. Prompt lacked the full JSON Schema. Actual monetary cost not available; no account pricing configured.
4. After adding the full JSON Schema guidance, the final attempt failed JSON parsing. No request/response body was logged or persisted.

An uncredentialed endpoint probe separately received HTTP 400, confirming reachability. No further paid probes were made. Neither provider has passed the full live release gate, and no teacher quality review has occurred. Production cloud calls fail closed until input/output pricing is configured, so unknown costs cannot bypass the monthly cap.

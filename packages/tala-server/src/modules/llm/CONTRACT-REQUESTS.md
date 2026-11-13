Worker C status after the live-generation follow-up (2026-11-13)

Resolved:
- ProviderConfig.pricing is now the sole gateway pricing source. Worker A's loader owns PRIMARY/FALLBACK/LOCAL environment rate adapters; no provider-price environment reads remain in the gateway.
- Weekly days now carry minutes; generation validates exact day count, unique weekdays and the per-session budget.
- Both modules are registered on tala-v1.
- Both modules implement onAccountDeleted. User jobs, quotas, usage and cache are removed; active/queued requests are cancelled. Only month-level anonymous spending survives so deleting an account cannot reset the budget ceiling.

Compatibility adapter still needed on the current merged kernel:
- kernel/server.ts registers only kernelExtension(module).onAccountDeleted. Both modules expose the direct contract hook AND mirror it under kernel.onAccountDeleted. Once Worker A reads the direct hook with extension fallback, the mirror can be removed. Do not invoke both locations twice.

Deferred by the orchestrator, not blockers for this slice:
- No resume route: clients retain the original GenerationInput queue and offer buildPrefilledDraft.
- No community snapshot service: copy an artifact to an owned plan, then adapt.
- Budget reconciliation tooling: timeout/network-uncertain reservations remain conservative until a later reconciliation feature.

Release gates outside this implementation:
- DeepSeek live comparison requires an authorized key; unavailable here, covered by fakes only.
- Teacher quality review of saved fixture samples is still required. Structural success is not scientific or pedagogical alignment validation.

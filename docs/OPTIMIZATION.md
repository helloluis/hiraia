# Hiraia — Optimization & Engagement Plan

> Opened 2026-06-14. The core architecture is **locked** (intent-distillation + RAG, see the
> README "Strategy" section). From here the work is making the tutor **faster and more
> engaging** — not changing the approach. Some items still involve retraining the adapter for
> *style/behavior*, but never the strategy.

Each item below has: **why**, the **levers**, the **files**, and a **definition of done** so we
measure rather than guess. Priority order is by kid-felt impact.

---

## P0 — Response speed / TTFT

**Why.** The single biggest experience problem. On-device today: ~41s prefill (time-to-first-token)
+ ~3 tok/s decode. The new `<think>` reasoning trace adds decode tokens *before* the answer, so it
also adds latency — but it's now shown as a live "thinking" stream, turning dead wait into feedback.

**Levers (cheapest first):**
1. **Verify the KV-cache actually hits on-device.** The static system prompt should be cached and
   only the new user turn re-prefill (grounding is already in the user turn for this reason). If the
   cache isn't hitting, the full ~1500-token prompt re-prefills every turn — that's most of the 41s.
   Confirm via QVAC/logcat before anything else.
2. **Shorten the `<think>` trace.** It drives intent-extraction but costs decode time. Try training
   the next adapter on terser reasoning (1 sentence, not 3) and measure the quality/latency tradeoff.
3. **Context trim.** Only keep what's needed in-window (compaction already helps); revisit `ctxSize`.
4. **Decode tricks / quant.** Speculative decode, lighter quant — only after 1–3.

**Files.** `packages/mobile/src/engine/LocalEngine.ts` (QVAC chat, KV-cache key), `packages/shared/
src/prompts/system.ts` (static system prompt), `packages/mobile/src/store/chatStore.ts` (compaction).

**Definition of done.** A repeatable on-device TTFT measurement, and a measured reduction (target:
first visible token in the single-digit seconds on a warm cache).

---

## P1 — Conversation history (scrollable past chats)

**Why.** Kids should be able to return to old exchanges. "New chat" already works; chats already
persist in SQLite (`convId`, `addMessage`). The sidebar "Mga Usapan" is still a placeholder.

**Lever.** Build the list UI: load conversations, show a title/preview + date, tap to reopen.
**Files.** `packages/mobile/src/app/(tabs)/sidebar.tsx`, `chatStore.ts` (load-by-convId), `db/repo`.
**Done.** Tap any past chat from the sidebar and it reopens with its full thread.

## P1 — Dated page-break dividers in the thread

**Why.** Makes long threads scannable. Kid scrolls and sees where days break.

**Lever.** Group messages by day; insert a **centered, underlined** divider ("June 14, 2026")
between days.
**Files.** `packages/mobile/src/components/ChatThread.tsx`.
**Done.** Day dividers render between date groups; styled centered + underlined.

## P1 — More engaging voice (emojis + colored bold/italics)

**Why.** Warmth and visual liveliness keep a child engaged.

**Levers.** (a) **RichText** currently renders **bold** only — add *italic* and apply color to
bold/italic. (b) Encourage more emojis/markdown. NOTE train/serve parity: the model's style was
trained with the current system prompt and the prompt is in the KV-cache hash — a serve-time-only
prompt change is a mismatch, so the durable fix is to **bias the next adapter's training style**;
a prompt nudge can be validated but is secondary.
**Files.** `packages/mobile/src/components/RichText.tsx`, `packages/shared/src/prompts/system.ts`,
`finetuning/distill/` (next adapter style data).
**Done.** Replies render colored bold + italics; the tutor reliably uses a few fitting emojis.

## P1 — Answer-ending quality (no persona leak / no backwards Socratic)

**Why.** Observed (English, "Tell me about gravity"): a clean body followed by a broken trailer —
*"You are a helpful tutor, right? 🌍 Can you explain how gravity works?"* Two failures: (1) **persona
leakage** (echoing the system-prompt identity back out), (2) a **backwards follow-up** that asks the
kid to re-explain their own question. Worse in **English**, which has no dedicated adapter (routes
through the Tagalog LoRA), so endings wobble more.

**Lever.** Training-side (next adapter): teach endings that close with a *real* guiding question or a
warm closer, and **never** echo the persona or ask the learner to re-explain. Consider strengthening
the English slice of the distill data. Avoid a display-side regex strip (brittle, the trap we left
behind). A system-prompt nudge can be A/B-tested but is secondary (train/serve parity + KV-cache hash).
**Files.** `finetuning/distill/` (next adapter data), `packages/shared/src/prompts/system.ts`.
**Done.** Replies end cleanly; no persona-echo or backwards questions across a TL+EN probe set.

## P1 — Visual integration + eager illustrations

**Why.** Pictures should feel part of the bubble, and the tutor should offer them readily.

**Status.** Image-tag pipeline **confirmed working** (Mars → image). Two threads:
1. **Integration (STAGED, pending rebuild):** `ImageSlot.tsx` — green frame removed, `mixBlendMode:
   'multiply'` so the illustration melts into the bubble, faint dashed outline as the tap hint.
2. **Eagerness:** the model emits `[image:]` only sometimes (restraint was trained in deliberately).
   Bias the next adapter toward offering illustrations whenever one helps. Unmatched offers are safe
   (tag stripped if no bundled image ≥ 0.7 cosine).
**Files.** `packages/mobile/src/components/ImageSlot.tsx`, `LocalEngine.ts` (`resolveImageTag`,
`IMAGE_TAG_FLOOR`), `finetuning/distill/` + `packages/shared/src/prompts/system.ts`.
**Done.** Images read as part of the bubble; the tutor proactively illustrates common topics.

---

## P2 — Version stamping (STAGED, pending rebuild)

**Why.** Confirm on-device which model/build is actually running ("from now on, stamp each ship").

**Status.** `config/version.ts` adapter bumped `v6 → v7 · intent + grounded`; English label
corrected. TODO: add an explicit app-build/version line to the sidebar "Bersyon" block + bump
`app.json` version/versionCode per ship.
**Files.** `packages/mobile/src/config/version.ts`, `app/(tabs)/sidebar.tsx`, `packages/mobile/app.json`.

---

## Cross-cutting: keep the gate green

Any model/prompt change must re-pass `finetuning/eval/harness/run-harness.sh` (device-equivalent)
before an APK build. Style/behavior changes that touch the adapter also warrant a capability-benchmark
A/B. The shipped adapter is `finetuning/adapters/distill-sailor-3b-v2a`.

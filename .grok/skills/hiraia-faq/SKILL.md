---
name: hiraia-faq
description: Keep the public Hiraia FAQ in lockstep with shipped product. Use when adding a user-facing feature, changing download/device/curriculum facts, editing Landing or AppDownload, or when the user mentions FAQ, /faq, Coming soon, APK release, or "update the questions page."
---

# Update the Hiraia FAQ with the feature

The public FAQ is `packages/web/src/data/faq.ts`. `/faq` and the future on-page assistant both read it. Do not leave landing copy and FAQ answers disagreeing.

## Same change as the feature

If the visitor can see it, the FAQ ships in the same commit:

1. Read `FAQ_SHIPPED` and the matching `FAQ_ITEMS` in `packages/web/src/data/faq.ts`.
2. Prepend a `FAQ_SHIPPED` line (newest first) with `date`, one-sentence `title`, and `faqIds` of items you added or rewrote.
3. Add or rewrite those items. Keep the landing voice: concrete, no invented Play Store / iOS / DepEd endorsement.
4. Numbers and flags come from `@/config/download` (`DOWNLOAD.released`, `apk.url`, `version`, `minAndroid`, `minRamGB`) and `@/config/grades`. Interpolate. Do not type a fresh "Android 12" or "Coming soon" that can rot.

`APK_LIVE` (`DOWNLOAD.released && !!DOWNLOAD.apk.url`) already switches the download answers. Flip `DOWNLOAD.released` / `apk.sha256` in `packages/web/src/config/download.ts` — do not also hardcode Coming soon in the FAQ.

## What belongs in the FAQ

Visitor questions about using the tutor, phones, MATATAG content, or troubleshooting. Not training-run notes, eval scores, or VPS deploy trivia.

## Check

After editing, `FAQ_SHIPPED[0]` should describe the thing you just shipped, and `/faq` should show that copy without "Coming soon" unless `DOWNLOAD.released` is actually false.

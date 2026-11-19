# Learner-facing wording in teaching packs — Hiraia's existing rules, applied

Luis (2026-11-19): "Let's make sure the Filipino is basic enough for grade school kids to read it. Of course, Taglish
is allowed because we don't want to force every word to be in the vernacular. We should roughly follow the Hiraia
app's verbiage rules with the slides too."

These are **not new rules**. Each comes from a file that already governs the Hiraia student app's text (main
checkout, commit `6c0354e6d`); this page only says how the pack pipeline applies it. Version: `verbiage/1`.

## Sources

| # | Rule in the Hiraia app | Source |
|---|---|---|
| S1 | "Natural, simple, kid-friendly for a 10-year-old. Keep accurate science terms; English science words (oxygen, gravity, photosynthesis) are fine where Filipinos use them AS A SINGLE WORD. Proper nouns stay in English." Use the existing Tagalog fact text "as the terminology anchor so wording matches what the tutor teaches." | `rag/pipeline/fw-translate.py` (prompt, line 41) |
| S2 | "Translate unit words … but keep numerals and unit symbols (cm², °C). Translate English common names; keep Latin binomials or formulas in parentheses." | `rag/pipeline/fw-translate.py` (line 52) |
| S3 | Short cards in a "lively, warm, kid-friendly" voice, "about 15–30 words"; "keep scientific/English key terms as-is where the source does." | `rag/pipeline/fw-gen-factoids.py` (lines 79–81) |
| S4 | A card's displayed text is at most **48 words** (compression target 46). | `rag/pipeline/fw-compress-factoids.py` (lines 4, 34); `packages/mobile/scripts/card-harness.mts` (line 126, `long-factoid` above 48 words) |
| S5 | A topic title printed for a child is at most **6 words**, with no colon or semicolon. | `packages/mobile/scripts/card-harness.mts` (lines 463–479) |
| S6 | On a two-part card the question is a hook and is **shorter than its answer**. | `rag/pipeline/fw-editorial-pass.py` (docstring) |
| S7 | Naturalness: "Natural, warm, conversational, grade-appropriate; scientific terms kept in English only where that's the accepted usage." Scores 0 for "heavy English drift" or text "so stiff/translated it reads like a textbook dump". | `finetuning/eval/capability/rubric.md` (naturalness, lines 58–64) |
| S8 | Factual accuracy ranks above fluency: "never reward beautiful Tagalog/Bisaya that is factually wrong." | `finetuning/eval/capability/rubric.md` (line 13); `CLAUDE.md` |

## How the packs apply them

Two registers, by reader:

- **Learner-facing** (everything on a slide; the questions and choices learners answer): S1–S7 apply in full.
  Taglish is the normal register: Filipino sentence structure with the English science word where Philippine
  classrooms use it (S1, S7). No forced vernacular coinages; no stiff, translated-sounding sentences.
- **Teacher-facing** (speaker notes, lesson-plan steps, teacher guide): plain and complete. The same Taglish and
  terminology rules (S1, S2, S7), longer explanations allowed, every technical term explained (PRD §4.3.2 SIMPLE-6).

Measured on every slide of every pack, in both languages (`src/verbiage.ts`):

| Check | Limit | Basis | Level |
|---|---|---|---|
| Words shown on one slide (title + lines + choices) | ≤ 48 | S4 | fail above 60, warn above 48 |
| Slide title | ≤ 8 words, no semicolon | S5 (a slide title is a little longer than a topic chip) | warn |
| Average sentence length, learner text | ≤ 14 words (Grades 3–6), ≤ 18 (Grades 7–10) | S1, S3 | warn above; fail above 20 / 25 |
| Longest learner sentence | ≤ 22 words (Grades 3–6), ≤ 28 (Grades 7–10) | S1, S3 | warn |
| Check question vs its reveal | question no longer than the answer explanation (when both have text) | S6 | warn |
| Filipino edition: English *sentences* (English function words such as "the", "is", "of" over 15% of learner words) | ≤ 15% | S7 "heavy English drift" — single English science words are fine (S1) | warn above 15%, fail above 30% |
| English edition: Filipino function words in learner text | ≤ 3% | S7 (wrong-language drift) | warn |
| Numerals and unit symbols kept | `°C`, `cm`, `%` are not spelled out on slides | S2 | warn |

Results are written to each language's review record (`review.json` → `verbiage`) with the metrics, so the
human reviewer sees them. They are heuristics: a pass does not prove a child can read the slide, and a Filipino
speaker's review is still required before a Filipino pack is marked Ready.

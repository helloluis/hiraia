# Brand pronunciation lexicon

`brand-lexicon.json` is the one source of truth for how Hiraia's voices say Hiraia's own
names: Hiraia, Hiraia.org, Tala, Luis Buenaventura, QVAC, Tether, Qwen, DeepSeek, Claude and
ChatGPT. It changes **speech only**. Displayed text is never rewritten, and the voice model
weights are not touched.

| Part | What it does | Used by |
|---|---|---|
| `speech_text_rewrites` | `hiraia.org` URLs → the single token `Hiraia-dot-org` (scheme dropped, subdomain dots spoken as "dot"). Case-insensitive; Python `re` and JavaScript share the syntax, with no backreferences. Runs before text normalisation. | all runtimes |
| `dictionary_entries` (`en-PH`) | English-voice phonemes; longest form first; case-insensitive. `Hiraia's` has its own form because the frontend skips a dictionary hit that is followed by `'s`. | English voice |
| `tagalog_overrides` | Filipino-voice phonemes per word (lower-case key, so any capitalisation). `hiraia-dot-org` is its own entry, so the standalone words *dot* (Lewis dot structure, 32 Science card texts) and *org* keep their usual pronunciation. *Tether* is per word: the Filipino voice also says the astronaut "tether" (2 Science card texts) the accepted Filipino-English way. | Filipino voice |

**Approval.** Luis Buenaventura specified *Hiraia* = Hee-RA-ya and *QVAC* = CUE-vak on
2026-11-24. He then accepted the full proposed set after a local A/B listening page
("Those sound correct to me"). That does not record that every clip was heard.

**Consumers (each must stay in step with this file):**
- hiraia.org voice demo: `deploy/voice-demo/server.py` pins the file's SHA-256 (`BRAND_LEXICON_SHA256`)
  and layers it over the frozen Expanded Mini bundle's dictionary. `install.sh` ships it to
  `/opt/hiraia-voice-demo/brand-lexicon.json`, and `/api/voice/health` reports the version and hash.
- Main Hiraia APK (v0.5 voice frontend): see the `packages/mobile/src/voice/v05` integration on the APK release line.
- Reader APK: vendors a byte-identical copy; its test pins this hash.

**Changing it:** edit the JSON, then update `BRAND_LEXICON_SHA256` and the consumers' pins.
Run the voice-demo tests with the bundle
(`VOICE_DEMO_BUNDLE=… build/voice-bench/venv/bin/python -B -m unittest deploy/voice-demo/test_server.py`)
and the app frontend goldens. Status values follow the strictest runtime (website Python:
`draft|source_checked|native_reviewed`). Tagalog overrides need `annotation_scope` and `source`.
Never trust an LLM's ear for Filipino: owner listening decides.

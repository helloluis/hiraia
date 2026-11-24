# Hiraia voice demo (hiraia.org/api/voice/)

Public text-to-speech behind the "Type your own sentence" box in the homepage's Hiraia Voices
section. It runs the frozen **Expanded Mini 1.0.0-preview.1** voices (`voice-models/expanded-mini/`),
the same bundle the section's sample clips were rendered with. Not the app's MMS voices.

- `POST /api/voice/synthesize` `{"text": "...", "voice": "fil" | "en"}` → `audio/mpeg` (64 kb/s mono,
  22.05 kHz) with `X-Audio-Seconds`; errors are JSON `{error, message}` with a visitor-facing message.
- `GET /api/voice/health` → voices, model hashes, uptime.

Mixed Tagalog-English goes through whichever voice the visitor picks (the Filipino voice routes
English words through its English pronunciation path). No language guessing.

## Brand-name pronunciation

Hiraia's own names (Hiraia, Hiraia.org, Tala, Luis Buenaventura, QVAC, Tether, Qwen, DeepSeek,
Claude, ChatGPT) are spoken from the shared speech-only lexicon
[`pronunciation/brand-lexicon.json`](../../pronunciation/README.md). `server.py` verifies the frozen
bundle first, then layers the lexicon on top. The lexicon is pinned by `BRAND_LEXICON_SHA256`, and a
mismatch refuses to start. `hiraia.org` URLs are spoken as "Hiraia dot org" after the 500-character
cap, through a single `Hiraia-dot-org` token, so the word *dot* elsewhere is unaffected. `GET /api/voice/health` → `pronunciation.{brand_lexicon, sha256}` identifies the deployed lexicon.
The model weights are unchanged.

## Limits

| Layer | Limit |
|---|---|
| Text | 500 characters (code points, after NFC); digits rejected with a "spell it out" hint |
| Body | 8 KB at nginx, 4 KB in the service; JSON only; `Origin` must be hiraia.org if sent |
| Rate | nginx 10/min per client (burst 5); service 6/min and 40/hour per client, 60/min overall |
| Concurrency | one synthesis at a time, at most 4 waiting (12 s), else 503 |
| Time | 25 s per request deadline, checked between sentence chunks (≤ 220 chars each); nginx 40 s |
| Memory/CPU | systemd `MemoryHigh=800M`, `MemoryMax=1G`, no swap, `CPUQuota=200%` (2 of 4 cores) |

Logs (journald) carry status, voice, character count, chunk count, audio seconds, latency and a
keyed client hash whose random key is replaced every UTC day. Never the text or the address.

## Deploy, test, roll back

```bash
python3 -B -m unittest deploy/voice-demo/test_server.py               # no models needed
VOICE_DEMO_BUNDLE=$PWD/voice-models/expanded-mini/1.0.0-preview.1/bundle \
  build/voice-bench/venv/bin/python -B -m unittest deploy/voice-demo/test_server.py   # + frontend fuzz
deploy/voice-demo/install.sh            # origin root@10.77.0.20; VOICE_RELEASE=... if weights live elsewhere
```

The installer keeps the previous install at `/opt/hiraia-voice-demo.prev` and backs the nginx site
up to `sites-available/hiraia.org.bak-voice-demo-<stamp>`. Uninstall steps are in `install.sh`.

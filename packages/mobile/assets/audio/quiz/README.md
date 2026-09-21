# Quiz sparkle cues

Ten approved variants, each exactly 1 second, mono PCM16 WAV at 44.1 kHz.
Bundled locally; no streaming or additional download is needed in the APK.

Sources are dedicated to CC0 1.0 by their creators. See `sources.json` for the
individual source pages, download URLs, source hashes, trim start times, and
output hashes. The first three are SFXMint's AI-generated Healing Spell Sparkle
01–03. The remaining sources are by SkySpeira, nomiqbomi, and opticaillusions on
Freesound. Freesound inputs are the publicly available HQ MP3 previews, not the
login-only original WAV downloads.

Edits: select a one-second passage, remove leading silence, apply 3 ms fade-in and 80 ms fade-out, then match all clips to -22 LUFS
using BS.1770 K-weighted integrated loudness (400 ms blocks). Gain adjustments
only: no compression, EQ, or pitch/speed changes. Each output is checked after
PCM16 quantization, including a 4x-oversampled peak estimate below -3 dBTP.
Measured per-clip loudness is recorded in `sources.json`.
Glossy and Jewel Glitter each contribute two different passages. No pitch or
speed changes. Total audio payload: 882,440 bytes.

To reproduce on macOS, install the development-only requirements in
`packages/mobile/scripts/quiz-audio-requirements.txt`. Download the manifest URLs
into a directory using each
source ID plus its URL extension, then run:

    python3 packages/mobile/scripts/build-quiz-sparkles.py --sources /path/to/originals

The script verifies the original hashes and makes no network calls.

To verify the bundled clips without downloading or rebuilding:

    python3 packages/mobile/scripts/build-quiz-sparkles.py --check

Meter implementation: https://github.com/csteinmetz1/pyloudnorm

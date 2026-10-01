# Hiraia 0.4.29 — browse all twelve exam questions

The exam now shows approximately 3.5 question cards across a wide window. All twelve
questions are available immediately and can be answered in any order. Keyboard,
trackpad, touch and the top arrows browse without submitting. Each answer saves before
it appears selected; restarting preserves both the questions and the choices already
made. Correctness and explanations appear after the final answer.

The shared layout ships in Android and ChromeOS 0.4.29 (code 29), and Windows
0.4.29-preview.1 (x64). Smaller windows, large text and screen-reader mode use a linear
list of all twelve questions. Wide cards scroll vertically when their content needs
more height. The website screenshot is an unmodified capture from the packaged Windows
executable at 1350 × 811 pixels.

All three packages were built from `2b136d65b0011fef1291126985ba19d607184254` in
[the successful three-edition CI run](https://github.com/helloluis/hiraia/actions/runs/36822529599).
The website release commit preserves the intervening reference-archive documentation.

## Release files

| Edition | Bytes | SHA-256 |
| --- | ---: | --- |
| [Android](https://assets.hiraia.org/models/hiraia-v0p4p29.apk) | 438,750,057 | `c0ae3fe4415c04692a654ac8956bed19bee01a9335b47bc68428b9c86b2524da` |
| [ChromeOS](https://assets.hiraia.org/models/hiraia-v0p4p29-chromeos.apk) | 523,557,412 | `a9f9a4e93969860cc3d8d3a5081ab0e7309cf2e91dfe753bc7153c5269dac8d3` |
| [Windows preview](https://assets.hiraia.org/models/hiraia-windows-v0.4.29-preview.1-x64.zip) | 674,673,359 | `a5c3ea2ffa15ac85636ce8263cdc4d09cb2f3d525b20c8d849831d7021cfcabf` |

Both APKs retain release certificate SHA-256
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Windows remains an unsigned portable ZIP, with a checksum sidecar beside the download.

| APK | ABIs | OTA runtime |
| --- | --- | --- |
| Android | arm64-v8a | `eba0931f048b9bdc51982e6093d2902503b16ede` |
| ChromeOS | arm64-v8a, x86_64 | `b1f72e6dc44911246763ea9862629d89eadb8935` |

The APKs share JavaScript bundle SHA-256
`4cb0cbd290136feaa76a3e5ec75524996ca4d40ed2e282b3d6823bf74629c52c`.
Asset catalog revision 7 is pinned to code 29 and image baseline `14d7c42699fd80bd`;
the app's catalog parser accepts all 42 packs.

## Validation

- Formal model gate: 45/45 cases, 185 samples passed. The prior Jupiter count-only
  answer was incorrectly rejected for omitting optional moon names. The assertion
  correction and positive/negative controls are recorded in
  [the implementation record](EXAM-CAROUSEL-20261001.md).
- Shared exam tests: 84 passed. Desktop host/storage: eight passed. Adaptive reader
  and review: 26 passed. Combined release manifests: three passed. Both TypeScript
  targets passed.
- The packaged Windows executable measured 3.50013 visible cards. Real UI tests
  browsed all twelve questions, reached all 36 options with Tab and at 200% zoom,
  checked a 900 × 600 window and screen-reader reading order, answered in a
  nonsequential order, restarted after three answers, and verified the exact 8/12
  result and saved history. Arrowing from an answer transfers focus to the next
  question shell, preventing Enter from activating an offscreen answer.
- The same relocated Windows ZIP passed QVAC CPU generation and 768-dimensional
  embeddings, ordinary card quizzes, persistence, and offline English and Tagalog
  voice synthesis. [Packaged Windows evidence](validation/0.4.29/windows.json).
- Both signed APKs passed the complete offline exam in the dedicated API 34 emulator:
  Android at 720 × 1600, ChromeOS at 1366 × 768 with three full cards and half a fourth.
  Checks covered 200% native text, arbitrary answer order, restart after three answers,
  an exact 8/12 result, all twelve explanations and visible saved history.
  [APK evidence](validation/0.4.29/apk-exams.json).
- Native test-driver corrections handled Android's fullscreen tutorial, isolated each
  database snapshot directory, and scrolled partially clipped cards into view. These
  corrected the observed driver failures without changing app code or test assertions.
- All versioned downloads, both APK legacy aliases and the Windows checksum sidecar
  passed R2 read-back verification and public HEAD checks on 1 October 2026. The local
  production website passed browser checks at 1440, 768, 390 and 320 pixels, including
  full screenshot aspect ratio, download metadata, checksums and absence of page overflow.

The production website build completed with type checking, but still emits the existing
typed-ESLint parser configuration error. This release does not claim a clean lint run.

## Compatibility and remaining validation

Existing sequential saved exams remain valid. Older executables cannot read a new
exam whose answers have been saved in nonsequential order; continue that exam using
0.4.29 or newer.

The exam retains its Assessment preview label and review status: 710 authored questions,
705 compiled, five held. This release changes presentation and answer ordering; it does
not claim new teacher or language approval. The compiled bank input hash remains
`ec09f5c0e2740fc74d01b9129211b6670ebfe91e7714016e4362e671bb4e301d`.

ChromeOS remains Preview: physical Chromebook ARC testing is still pending. Windows
native validation ran on Windows Server 2022 x64; consumer Windows 10 device testing
remains pending. Windows ARM and Windows Tala classroom sync remain outside this preview.

One nonblocking native-emulator observation remains: the forward arrow can appear
enabled at the end of the row. All twelve questions and backward navigation were
accessible in the completed exam; an extra forward press did not change any answer.

# Twelve independent question cards

The Windows exam now presents all twelve questions from the start, using the reader's
adaptive 3.5 / 2.5 / 1.5-card widths. The shared presentation also applies to wide
ChromeOS and Android windows. Small windows, enlarged text that leaves less than
840dp, and screen-reader mode use a linear list of the entire exam. Horizontal scroll,
the top arrows and keyboard arrows browse without submitting. Each wide card has its
own vertical scroller for long questions, diagrams and answers.

Each answer is still committed once before it appears saved; questions can now be
answered in any order. Selected choices remain visible without revealing correctness.
The final answer atomically saves the result and opens the existing explanation review.
The question order and shuffled options remain frozen. Scoring and saved-history
validation join answers by item ID instead of array position. The answer array keeps
chronological order for clock validation. Duplicate IDs, unknown items, invalid options,
backwards timestamps and duplicate completion are still rejected. Existing sequential
saves remain valid; older executables cannot read newly nonsequential sessions.

Local validation before packaging: 84 exam tests, eight desktop host/storage tests,
three combined-manifest tests, both TypeScript targets, and the actual desktop renderer
flow passed. The renderer measured 3.50006 visible cards. It exercised all 36 choices
at 200% zoom, a 900 × 600 window, screen-reader linear order, horizontal trackpad and
keyboard navigation, nonsequential answers, restart after three answers, an expected
8/12 score and saved history. A focus handler initially moved a partially visible card
between pointer-down and pointer-up; removing that programmatic move fixed dropped
clicks. The test now requires every single real click to produce its durable answer.
Keyboard arrows also move focus to the newly browsed question shell, so Enter cannot
accidentally submit a choice on the previous, now hidden card. The regression test
reproduced that stale-focus defect before the fix. Tab reaches all 36 options in the
actual app, keeps each focused option in view, and stays inside the exam modal.

Windows release evidence must include carousel, out-of-order and screen-reader checks.
The Windows runner sets a real 1920 × 1080 desktop before creating the test window;
its default 1024px screen previously clamped screenshots. The pipeline also retains
failed model-gate logs and JSON so a failure is inspectable without the runner checkout.

## Existing model-gate false rejection

The previous automatic run [36815520298](https://github.com/helloluis/hiraia/actions/runs/36815520298)
failed on `grounded-jupiter-moons`. Sample 4/5 answered the count query with
“Ang Jupiter ay may mahigit 90 na kilalang buwan.” The old assertion demanded optional
Galilean moon names. The retrieved bank gives the same >90 count; NASA's
[Jupiter facts](https://science.nasa.gov/jupiter/jupiter-facts/) listed 115 recognized
moons when checked on 1 October 2026, so the lower-bound statement is also still true.
The assertion now requires Jupiter and the grounded >90 count and rejects negation.
Controls accept the captured short/long answers and reject four-only, exactly-90,
wrong-planet, negated-count and name-only answers. No model, prompt, temperature,
sample count or curriculum content changed. The full gate remains required for release.

The full gate passed 45/45 cases and 185 samples on the final app source. The packaged
Windows executable and both signed APK exam flows passed. Final native and published
artifact evidence is recorded in [the 0.4.29 release](RELEASE-0.4.29.md).

# Hiraia

[![Built with QVAC](https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-green-dark.svg)](https://github.com/tetherto/qvac)

**Free, offline-first science learning for Filipino students.** Hiraia is an Android app
with illustrated learning cards, quizzes, and on-device search in **Filipino (Tagalog),
English, and Cebuano**. Its teacher companion, **Hiraia Tala**, collects classroom activity
from nearby student phones without requiring internet access.

The built-in card library works without downloading or running a language model.
Semantic search and optional AI-generated cards add capabilities as the phone's downloads
and available memory allow.

**[Website and downloads](https://hiraia.org) · [Whitepaper](docs/whitepaper/HIRAIA-WHITEPAPER.pdf) · [Licensing](LICENSE.md)**

> Factual accuracy comes before fluency. Hiraia grounds generated cards in a science fact
> bank and audits its educational content; model output and audited content can still contain
> errors. The goal is a useful learning companion, not a replacement for a teacher.

## Current releases

Release records as of **28 September 2026**:

| App | Version | Download | Release notes |
| --- | --- | --- | --- |
| Hiraia — student | **0.4.26** | [Android APK](https://assets.hiraia.org/models/hiraia-v0p4p26.apk), approximately 417 MiB | [0.4.26](docs/RELEASE-0.4.26.md) |
| Hiraia Tala — teacher | **0.4.4** | [Android APK](https://assets.hiraia.org/models/tala-v0p4p4.apk), approximately 15 MiB | [0.4.24 / Tala 0.4.4](docs/RELEASE-0.4.24-TALA-0.4.4.md) |

Both apps target **Android 10 or later**. Install Hiraia and Tala on **separate phones**:
Nearby activity transfer does not work between the two apps on one device. APKs are
provided directly rather than through Google Play; release notes include their integrity
hashes and signing information.

The maintained download records are [student download configuration](packages/web/src/config/download.ts)
and [Tala download configuration](packages/web/src/config/tala-download.json).
The latest student release's connectivity recovery was checked on an emulator; its release
notes distinguish those checks from testing on physical phones.

## The student experience

- **Read, then practice.** Scroll vertically through illustrated science cards and quizzes.
  Scroll back to revisit a card. Correct answers have confetti and varied sound effects.
- **Follow a curriculum.** Grade-based science sequences cover **Grades 3–10**. Lessons keep
  related concepts together while varying card selections between runs. A **Balik-Aral**
  recap highlights key concepts and offers another pass or progression to the next topic.
- **Explore a question.** Search the card library with keywords immediately. Once LaBSE is
  ready, semantic retrieval helps match meaning across languages. Existing cards and
  fact-bank content provide a useful experience even without the generative model.
- **Choose a language.** Card and quiz text is available in Filipino, English, and Cebuano.
  Bundled on-device read-aloud voices currently support **Filipino and English**.
- **Share a phone.** Student profiles keep their own grade, progress, and classroom enrollment.
- **Manage downloads.** Settings shows app and Hiraiapedia versions, download readiness,
  and pause/resume controls for AI files and illustrations.

The current generated index contains **49,156 cards** and **25,751 quiz-linked facts**.
**Hiraiapedia v1.5** contains **53,022 science facts** for grounding and retrieval. These are
separate inventories: the fact-bank size is not the number of cards a student sees.

## What works offline, and what downloads

The APK includes the card/quiz database, the fact bank and keyword index, a core illustration
library, and the Filipino/English read-aloud voices. Additional art and AI files download
separately and remain available locally after installation.

| Component | Delivery and purpose |
| --- | --- |
| Cards, quizzes, keyword search, core art, read-aloud | Bundled; the ordinary learning feed does not wait for an LLM. |
| LaBSE model and fact-bank vectors | Approximately **506 MB** downloaded for semantic retrieval; prioritized before generation. |
| Hiraia-2B generative model | An additional **1.27 GB** download on eligible phones; generates grounded cards locally. |
| Additional illustrations | Grade-relevant and common image packs download automatically; Settings can pause or resume them. |

**4 GB-class phones can use the card library and, with sufficient available memory, LaBSE
search.** The optional generative model targets **6 GB-class or larger phones** and still
requires enough free RAM and storage. Android's reported memory, low-memory status, and
current pressure determine eligibility; a marketing RAM number is not a guarantee.

In 0.4.26, eligible search downloads begin from launch and retry with backoff. Interrupted
transfers resume when connectivity returns. Downloads can use **mobile data**, so use Wi-Fi
for setup or pause transfers in Settings. Once the needed files are present, learning,
retrieval, voice playback, and eligible local generation do not require a cloud model.

Compatible model and illustration updates download automatically while the app is active,
respecting pause controls. A **new APK requires user action**. Compatible signed JavaScript
updates are checked on Wi-Fi and applied at a later launch; native changes still need an APK.
See [app and asset updates](docs/APP-AND-ASSET-UPDATES.md).

## Hiraia Tala: classroom monitoring

A teacher creates or selects a class in Tala and displays its QR code. Each student profile
joins that class by scanning the code in Hiraia. While the apps are open and monitoring is
active, Tala advertises locally and student phones initiate Nearby connections to sync
activity. Bluetooth/Wi-Fi permissions and the relevant radios must be available.

Paired student phones retry automatically while foregrounded, generally every **10–15
minutes**, backing off to **30 minutes** after repeated misses. Classroom collection does
not require an internet connection. Tala stores activity locally, shows each student's
recent learning activity, and supports class spreadsheet exports. It can relay queued
activity to the Hiraia service when online.

Enrollment is **per student profile**, not phone-wide. Class changes, leaving a class, and
teacher-device recovery are handled separately from the student's normal learning flow.
See [Tala](packages/tala/) and [activity relay and recovery](docs/TALA-ACTIVITY-RECOVERY.md).

## Local inference and data sharing

**On-device inference does not mean that no data ever leaves the phone.** Hiraia downloads
assets and checks for updates. Usage reporting is enabled by default and can be disabled
in Settings; it queues structured activity, quiz results, versions, and download diagnostics
for upload when connected. Joining a Tala class shares that student's name and activity
with the paired teacher. Submitted issue reports may also include user-selected media.

Ordinary service telemetry excludes student names and question/answer text; classroom names
and learner names have a different, local teacher-sharing purpose. The website's interactive
demo uses server-side inference and is separate from the Android app's local model execution.
See the [telemetry implementation and operations guide](tools/pilot-telemetry/README.md).

## Architecture

| Layer | Current implementation |
| --- | --- |
| Student app | Expo / React Native, with SQLite-backed content and profile state. |
| Teacher app | Native Kotlin Android app with Google Nearby Connections and local SQLite storage. |
| On-device inference | **QVAC SDK** and its llama.cpp generation/embedding backends; keyword retrieval remains available without model weights. |
| Generative model | **Hiraia-2B**, a continued-pretraining and full-parameter SFT fork of **Qwen3.5-2B**, quantized as `hiraia-sft-2b-v2.Q4_K_M.gguf`. The current model uses **no separate LoRA adapters**. |
| Retrieval | LaBSE semantic embeddings combined with lexical retrieval over Hiraiapedia. |
| Read-aloud | Fine-tuned MMS-derived ONNX voices, executed through ONNX Runtime. |
| Website and delivery | Next.js website and APIs, VPS services, and Cloudflare R2 asset delivery. |

Sailor2, the older language adapters, and their benchmark results remain in the repository
as development history. They do not describe the current shipping model. The
[whitepaper](docs/whitepaper/HIRAIA-WHITEPAPER.md) covers the training approach in more detail.

## Working on the project

The active development checkout uses **`hiraia-unified`**; **`main`** is the publication and
deployment branch. Read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) before changing the
project, and check the working tree: parallel work may be present.

For web development, use Node.js 22.17+ and the repository's pinned pnpm 9.15.9:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @hiraia/web dev
```

Android development also needs JDK 17, the Android SDK, and the local content/model artifacts
specified in the **[student build guide](packages/mobile/BUILD.md)**. A fresh clone alone
is not a ready-to-sign release environment.

- Run `finetuning/eval/harness/run-harness.sh` and require a green result **before an APK
  build or on-device test**. It exercises the current card writer and retrieval path.
- Rebuild `cards.db` after changing its content inputs; it is gitignored and is not regenerated
  just by checking out a commit. The same build updates Tala's append-only card catalog.
- Use `packages/mobile/scripts/build-apk.sh` for the student build and
  `packages/mobile/scripts/sign-apk.sh` for the distributable APK. Do not distribute the
  intermediate Gradle `app-release.apk` signed with the Android debug key.
- Follow the build guide for prebuild/version changes, Tala's distinct pilot signing identity,
  release ordering, asset publication, and signed OTA updates. The telemetry collector is
  deployed separately from the web app.

The [capability benchmark](finetuning/eval/capability/README.md) is a separate instrument for
comparing model behavior. Historical evaluation scores should not be presented as guarantees
for a different model or release.

## Repository map

| Path | Purpose |
| --- | --- |
| [`packages/mobile/`](packages/mobile/) | Student Android app, search, voice, profiles, updates, and teacher sync. |
| [`packages/tala/`](packages/tala/) | Teacher app, class enrollment, roster, and local activity collection. |
| [`packages/web/`](packages/web/) | Public website, web demo, downloads, and API routes. |
| [`packages/shared/`](packages/shared/) | Shared types, prompts, retrieval, and engine interfaces. |
| [`packages/images/`](packages/images/) | Illustration sources, generated assets, and image tooling. |
| [`rag/`](rag/) | Fact and quiz banks, card assembly, curriculum preparation, and database builder. |
| [`finetuning/`](finetuning/) | CPT/SFT training, voice work, evaluation, and historical experiments. |
| [`tools/`](tools/) | Language/image audits, pilot telemetry, and operational tools. |
| [`deploy/`](deploy/) | VPS deployment, release asset publishing, and OTA tooling. |
| [`docs/`](docs/) | Release records, architecture notes, curriculum audits, and licensing inventory. |

## About and licensing

“Hiraia” plays on **hiraya** — hope, imagination, or the fruit of one's dreams — with **AI**
in the middle. The project began in the
[QVAC Hackathon](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i/detail) and is developed
by **Luis Buenaventura** for science learning in Philippine schools.

Hiraia uses scoped licenses, not one blanket repository license. Designated original
educational content is **CC BY-NC 4.0**, with commercial permission reserved to
**Luis Buenaventura**. Existing Apache/MIT code, previously licensed assets, and third-party
components retain their own terms. See [LICENSE.md](LICENSE.md) for exact coverage and
exclusions.

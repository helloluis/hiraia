# Licensing inventory — Hiraia / Tala

Date: 28 September 2026 (Asia/Manila). See [method and limits](README.md).

**Follow-up:** Luis confirmed sole personal ownership of original work and no other human
contributors. [Final terms](TERMS.md) and [effective coverage](coverage.json) now record a
scoped grant for his rights in three content-bank snapshots. The findings below preserve
the original inventory; that ownership confirmation does not resolve third-party sources
or withdraw earlier grants. No current code is newly designated as noncommercial.

## Decision

A single repository-wide CC BY-NC notice would be inaccurate. Preserve existing grants;
apply a new noncommercial grant only to explicitly identified rights Hiraia controls.
Use separate scopes for educational content, software, model artifacts, and branding.

The user's objective is commercial permission by conscious choice. This is achievable for
eligible original contributions, not for every upstream component, previously licensed
version, scientific fact, or AI-generated output. Access to source and free downloads are
also different from an open-source license: a commercial-use ban is not OSI open source.
See [OSI definition](https://opensource.org/osd).

## Existing grants that must be preserved

| Local evidence | Finding | Effect on proposed terms |
| --- | --- | --- |
| [Root README](../../README.md), License section | Says license is TBD, likely Apache 2.0 | Inconsistent with more definite notices below; not evidence of a clean rights slate. |
| [CONTRIBUTING](../../CONTRIBUTING.md), License section | Contributors agree their contributions are Apache 2.0 | Broad historical scope needs review before claiming any existing code is exclusively NC. An Apache contribution is not a copyright assignment. |
| [Web README](../../packages/web/README.md), License section | Apache 2.0 | Preserve commercial rights in versions covered by that notice. |
| [RAG README](../../rag/README.md) and [package metadata](../../rag/package.json) | Scripts / package Apache 2.0 | Do not relabel existing scripts as exclusively NC. |
| [Finetuning README](../../finetuning/README.md) and [package metadata](../../finetuning/package.json) | Training scripts / package Apache 2.0 | Same distinction; code license does not clear the training corpus. |
| [Image library design](../../packages/images/HYBRID-APPROACH.md), License section | Asset library and metadata schema MIT; individual assets separately licensed | Preserve MIT scope and inspect each asset record. |
| [428 image metadata records](inventory/image-license-records.json) | Every enumerated top-level license field is `CC-BY-4.0` | Preserve those asset grants; commercial reuse is allowed subject to their terms. Do not infer they cover all later PNGs. |
| [Asset inventory](../../packages/images/ASSET-INVENTORY.md) and [style spec](../../packages/images/STYLE-SPEC.md) | Broader CC0/CC BY design statements | Potentially inconsistent scope; investigate historical releases rather than treating these statements as proof that all artwork is exclusively owned/unlicensed. |

The relevant early history includes `7d0b3c05d` and `c75236cb5` (27 May 2026) and
`41bd9b0f2` (3 June 2026). They are evidence pointers, not a completed publication-history
audit. No tracked root LICENSE file was found in this checkout. That does not erase
license grants in READMEs, package metadata, individual files, or earlier distributions.

Apache's copyright grant is irrevocable subject to its terms; CC grants also cannot simply
be recalled from compliant recipients. New terms must distinguish rights in new material
from rights in existing copies. [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0),
[CC guidance](https://creativecommons.org/faq/#what-if-i-change-my-mind-about-using-a-cc-license).

## Component inventory

| Component | Evidence / current finding | Disposition |
| --- | --- | --- |
| Student, Tala, website, shared code, tools | Mixed existing Apache/MIT statements and unspecified modules | Historical grant review first. Retain upstream licenses. Future eligible original code can use separate NC software terms; cannot make old permissive copies exclusive. |
| Cards | 49,156 records in `rag/pipeline/cardsPool.app.json`; all have `source`, none a top-level license field | Candidate for a scoped content license only after rights/provenance mapping. A generator/source label is not clearance. |
| Quizzes | 32,718 in `rag/bank/quiz-bank.jsonl`; all have `factId` and `reviewed`, no top-level source/license | Trace through facts and generation records. Model review establishes neither ownership nor permission. |
| Hiraiapedia fact bank | 53,022 in `rag/bank/science-facts.jsonl`; `source` and `generator` present, no top-level license | Separate facts from protected expression and compilation rights. Cannot reserve scientific facts themselves. |
| Current Hiraia LLM | `packages/mobile/src/config/model.ts`: `hiraia-sft-2b-v2.Q4_K_M.gguf`, MD5 `fe2d0ab2ad856f2a42c5add5872c4234`; CPT results identify `Qwen/Qwen3.5-2B-Base` | Upstream model card is Apache 2.0. A license for Hiraia's additions needs artifact and corpus provenance; cannot erase upstream permissions. |
| Retrieval model | Same config: `labse.Q4_K_M.gguf`, MD5 `2667f69edfbcb68acf617187fe817fae` | Upstream sentence-transformers LaBSE is Apache 2.0. Confirm exact conversion/revision and notices for the distributed GGUF. |
| Retired Sailor2 models / adapters | Historical files and docs remain; current mobile config explicitly retires them | Separate historical inventory if redistributed. Do not mistake them for the active LLM. |
| Bundled Tagalog / English voices | `src/voice/engine.ts` imports two MMS-derived ONNX models. `docs/TTS.md` records fine-tunes. Voice metadata contains hashes, not license/creator fields | Meta MMS is CC BY-NC 4.0. Preserve attribution, upstream license, and modification notices. Hiraia cannot independently grant commercial rights to Meta's weights. |
| Synthetic voice training audio | Docs describe VoxCPM2-generated English audio cloned from a Tagalog reference | Model code/weight license alone does not establish ownership or consent for reference speech or generated recordings. Preserve generation/provider/reference provenance. |
| Planned OmniVoice / other voice experiments | NC model references in voice-v2 planning | Planning evidence only; not identified as current bundled runtime voices. Inventory separately before shipment. |
| New generated card illustrations / image packs | Large PNG collections; early SVG metadata covers only 428 items | Need per-batch provider/model/date/terms, source-image rights, and final-output mapping. AI generation/payment does not alone prove exclusive copyright. Exclude unresolved assets from a new ownership claim. |
| Quiz sound effects | 10 files; all output SHA-256 values match `assets/audio/quiz/sources.json`; source records say CC0 1.0 | Keep CC0 provenance. Trimming/normalization does not remove original CC0 freedoms. No NC claim over source sounds. |
| Fonts | 43 tracked font binaries; nine app/web font families checked upstream | Eight checked families use OFL 1.1; Permanent Marker is Apache 2.0. Preserve those licenses. Exact binary revisions and design-only fonts still need mapping. |
| Dev Diary photos | `website-launch.jpg` is a BitPinas graphic; two Calapacuan photos uploaded by user | Upload/publication is not ownership evidence. Photographer/publisher permission and appropriate image-use permissions need confirmation before public relicensing. |
| Hiraia / Tala names, glyphs, logos | Branding assets and font-derived lettering | Keep trademark permission separate. Do not claim exclusive rights to the underlying typeface. Verify original artwork ownership and prior grants. |
| Student / teacher telemetry and records | Runtime data, not an educational content grant | Explicitly excluded from public licensing. Do not publish personal information as part of this exercise. |

Machine evidence: [content counts/hashes](inventory/content-files.json),
[font files](inventory/font-files.json), [font upstream checks](inventory/font-upstream-checks.json),
[audio hash checks](inventory/audio-files.json), [local evidence hashes](inventory/evidence-files.json).

Model sources checked:
[Qwen3.5-2B-Base](https://huggingface.co/Qwen/Qwen3.5-2B-Base),
[LaBSE](https://huggingface.co/sentence-transformers/LaBSE),
[MMS Tagalog](https://huggingface.co/facebook/mms-tts-tgl),
[MMS English](https://huggingface.co/facebook/mms-tts-eng).
These current upstream declarations corroborate the stated license families; they do not
complete a hash-to-upstream-revision chain for each Hiraia artifact.

## Dependencies and release notices

The installed pnpm inventory contains **1,196 package-name entries / 1,341 name-version
entries in 20 reported license groups**. See [full export](inventory/pnpm-licenses.json).

- QVAC SDK/plugins and `react-native-bare-kit` report Apache 2.0;
  `onnxruntime-react-native` reports MIT. This does not license downloaded model weights.
- Four platform-specific Sharp/libvips entries include LGPL-3.0-or-later; five Lightning CSS
  entries report MPL-2.0. Determine actual distribution and associated source/notice duties;
  their presence does not by itself mean the whole app must adopt those licenses.
- Two `Unknown` entries are local modules: `hiraia-managed-config` and `hiraia-tala`.
  They need explicit project scope, not a guessed third-party license.
- Native Gradle declarations include Google Play Services Nearby, Play Services Base,
  AndroidX, and ZXing. pnpm does not inventory their native transitive dependencies.
  Google SDK terms must be checked separately; do not call the whole native bundle Apache.
- Only three tracked font OFL notice files were found, under `packages/fonts/`. The other
  font families need exact notices and packaging checks. This is a notice-coverage gap,
  not proof of infringement or proof that notices are absent from every shipped binary.

Do not describe this dependency metadata export as full release compliance. Python training
dependencies, native APK contents, and remote runtime libraries remain outside its scope.

## Corpus and educational source constraints

Local notes describe DepEd/LRMDS modules; Wikimedia; mixed OPUS sources; Bloom books;
Common Crawl-derived datasets; and a Cebuano textbook. Dataset-level labels do not establish
the rights to every underlying page, book, image, or recording.

- DepEd notes already acknowledge third-party material inside modules. Philippine IP Code
  section 176 distinguishes government works, approval for exploitation for profit, and
  third-party copyrights. “Free for education” is not an unrestricted grant from Hiraia.
  Sections 175–176: [Republic Act 8293](https://lawphil.net/statutes/repacts/ra1997/ra_8293_1997.html).
- Bunye & Yap textbook notes disagree on NC-SA license version (3.0 Philippines versus
  4.0). Verify the actual source edition. Do not silently choose the more convenient label.
- Wikimedia/Bloom/OPUS material requires per-source license and attribution checks; some
  sources include ShareAlike or NonCommercial conditions.
- Separate redistribution of a raw training corpus from legal analysis of a trained model.
  This inventory does not assert that every training-data license automatically transfers
  to model weights, nor that training automatically removes source restrictions.
- Quality audits and synthetic-generation provenance are useful evidence, but do not replace
  the source permissions and provider terms applicable at the time of generation.

## Terms recommendation and remaining decisions

Use **CC BY-NC 4.0 for specifically cleared original educational content**; retain the
ability to negotiate a separate commercial license to those rights. It permits adaptations
but does not require publication of every adaptation. It does not create control over facts
or material for which Hiraia has no enforceable rights.

Preserve existing permissive code grants. Use a software-specific NC license only for
separately identified eligible new contributions, if restricting that new code remains the
goal. CC itself discourages using its licenses for software. A broad historical Apache
contribution notice makes a blanket switch especially inappropriate.

The stock PolyForm Noncommercial 1.0.0 is not an exact match for the stated objective:
its organization clause expressly permits educational institutions and specified public
organizations regardless of funding. The proposed custom software section avoids an
automatic organization-type exception. It needs legal review before use, not a claim of
standard-license compatibility. [Official PolyForm text](https://raw.githubusercontent.com/polyformproject/polyform-licenses/1.0.0/PolyForm-Noncommercial-1.0.0.md).

The original inventory found two misleading shortcuts:
`docs/TTS.md` treated nonprofit status as establishing noncommercial use, and said
Apache “imposes nothing.” Neither is a sound licensing rule. CC evaluates the use, not just
the organization's status; Apache includes notice and other obligations. The pre-change
hash is preserved as inventory evidence. The explanation was subsequently corrected during
finalization; this correction is not a change to either upstream license.

**Ownership question resolved after this inventory:** [Luis's confirmation](OWNERSHIP.md)
identifies him personally as the sole original-work owner, with no other human contributors.
The [final terms](TERMS.md) and [coverage manifest](coverage.json) supersede the earlier drafts.
The new grant covers only his rights in the identified content snapshots; source permissions,
historical grants, and unprotected material remain separate. The root README and contribution
guide now state that scope, and the misleading TTS licensing shortcuts were corrected.

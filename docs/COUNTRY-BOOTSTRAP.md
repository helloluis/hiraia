# Hiraia country bootstrap

Last updated: **1 October 2026**, Asia/Manila. Maintainer: the Hiraia team member leading the current country work. This is the working recipe for taking Hiraia into another educational setting. Update it when evidence changes the process; keep each country's detailed findings and source inventories in their own records.

Start with **the educational landscape and learners, then the competency map**. Those determine the language, content, assessment, model and delivery work. A language translation alone does not make an edition suitable for another country. Factual accuracy remains more important than fluency.

## Current country records

| Country | Evidence and artifacts | Current boundary |
| --- | --- | --- |
| Philippines | [Grades 3–10 curriculum audit](GRADES3-10-CURRICULUM-SUMMARY.md), [elementary baseline](../rag/sources/curriculum-guides/matatag-elementary-competencies.json), [secondary baseline](../rag/sources/curriculum-guides/matatag-jhs-competencies.json), app lesson manifests, public `/competencies` page | Existing science materials are mapped to 324 learning competencies in the repository's baseline. Representation in lessons is not evidence of learner mastery or government endorsement. Check current generated data rather than copying historical lesson counts. |
| Peru | [Country and Quechua research](PERU-QUECHUA-PRELIMINARY-RESEARCH-20260930.md), [primary science map](PERU-SCIENCE-COMPETENCY-MAP.md), [machine-readable targets](../rag/sources/curriculum-guides/peru/cneb-primary-science.json), [school-material catalogue](../tools/quechua-school-corpus/index.html) | Preliminary research and curriculum targets. Content reuse candidates still need review. Region, Quechua variety, school partner, teaching-language profile and native reviewers are not selected. No Peruvian edition or validated Quechua tutor is available. |

The public competencies page describes the existing Philippine edition. Keep proposed country targets separate from coverage available to learners.

## Keep the recipe current

For every country research, acquisition, mapping or pilot task:

1. Read this recipe and that country's latest record before starting. Record the jurisdiction, curriculum edition, grades, community, language variety and learning-language profile; mark unknowns explicitly.
2. Add new evidence to the country record with the source URL, edition or observation date, and practical consequence. Update the source inventory when an original is acquired or changes.
3. If the finding changes a reusable rule, update the relevant step here **in the same task** and add a dated entry to the learning log below. A country-specific observation is not automatically a rule for every country.
4. Update the competency map and regenerate its consumers when targets or content mappings change. Review source and generated diffs together; do not maintain an independent public list by hand.
5. Preserve superseded source files and identify their replacements. Record the evidence that overturned a claim rather than silently changing its historical measurement.

Recheck the curriculum edition and classroom language policy before committing to a pilot, and again when authorities publish changes. Recheck storage prices when purchasing or changing archive services. This is a maintenance procedure for future work, not a scheduled background process.

## Step 1 Understand the learners and education system

Produce a country dossier that answers the following. Use ministry publications, official statistics and local educators; attach dates to time-sensitive claims.

| Question | Required output |
| --- | --- |
| Who sets expectations and who implements them? | Ministry equivalent to DepEd, curriculum authority, regional and local education offices, relevant bilingual-education unit, and prospective school partner. |
| Which children are we serving? | Grades and approximate ages, region, enrolment where available, rural or urban context, disability and access needs relevant to the pilot. Keep population, ethnicity, childhood language, current proficiency and school enrolment as separate measures. |
| How is school organized? | Stages, grade or cycle standards, subjects, school calendar, local planning discretion, multigrade settings and teacher workflows. |
| Which language helps a child learn science? | Language of instruction, strongest language, literacy in each language, language learned as a second language, named variety and accepted orthography. Ask about actual classroom practice as well as policy. |
| Can Hiraia work in the setting? | Representative phones, free storage and RAM, charging, connectivity and data cost, shared phones, read-aloud needs, and teacher collection/export requirements. Measure these with the partner rather than assuming Philippine conditions. |

**Peru lesson:** MINEDU is the national authority; DEIB, regional DRE/GRE offices and local UGEL offices matter for EIB implementation. The national science curriculum applies across language settings. MINEDU distinguishes strengthening an indigenous first language with Spanish as a second language, and revitalizing an indigenous heritage language where Spanish is dominant. Quechua heritage alone does not identify a child's best learning language. [MINEDU service model](https://www.gob.pe/39448-educacion-intercultural-bilingue-modelo-de-servicio-educativo-intercultural).

The existing demographic research separately records a 2017 childhood-language count and a 2025 ethnic-identification result. Neither is the number of Quechua-speaking primary pupils. A market or deployment estimate needs school-level enrolment and language information; it cannot be obtained by multiplying an ethnic percentage by the total population.

**Ready for the next step:** national expectations and the limits of the audience evidence are documented. Mapping may proceed while a school partnership is being arranged; language-specific production needs a defined learner group and reviewers.

## Step 2 Preserve the reference evidence

Acquire official curriculum frameworks, subject programmes, assessment guidance, teacher guides, approved textbooks, language references and bilingual materials. Separate a curriculum requirement from an example in a workbook and from a local teacher's recommendation.

Use the [private R2 reference archive](REFERENCE-ARCHIVE.md). Keep small inventories, provenance and collection tools in Git; store original PDFs and other large files in the private archive, with a local working copy. Record at least:

- Stable source ID, issuing organization, title, jurisdiction, subject, grades, language and variety; retain uncertain catalogue labels as uncertain.
- Edition shown inside the document, catalogue publication date, retrieval timestamp, original and mirror URLs, original filename, byte count and SHA-256.
- Access and reuse terms, with separate decisions for internal reference, redistribution and training. Public download access is not proof of permission for all three.
- Extraction tool and version, text or OCR status, page locators, and each derivative's parent source/hash. Preserve original bytes and unmodified extraction before normalization.
- Archive location and verification state. A planned object key is not a verified uploaded copy.

**Peru lessons:** a current ministry listing links a March 2017 curriculum edition; the listing date does not create a new curriculum. The school collection has 628 distinct PDF hashes from 376 candidate catalogue entries, including split workbooks and editions. These are not 628 distinct books. Some titles came from a mirror and remain provisional. Sixteen PDFs need OCR; a successful download does not establish usable text. See the [collection audit](../tools/quechua-school-corpus/audit.json).

**Image preservation lesson:** retain the original generation bytes before any resizing, grayscale conversion, palette reduction or format change. Archive prompts, source/reference images, provider response metadata and source-to-derivative mappings with hashes. Inspect file signatures: some JPEG originals have no extension or are named `.png`. Recover embedded provider payloads when the standalone original is missing, and retain every distinct byte version. A same-name high-resolution image is only a candidate for the same revision until provenance establishes the link. Never call an upscaled derivative an original. Provider storage is temporary: archive successful outputs promptly and retain provider batch/task/output-file IDs with acquisition hashes. OpenAI currently documents automatic deletion of Batch output files after 30 days; local batch IDs alone do not guarantee recoverable remote bytes. [Batch output retention](https://developers.openai.com/api/docs/guides/batch).

**Archive completion:** require a private, additive snapshot, a trusted manifest/receipt digest, full remote-byte hash verification and an independent restore into an empty destination. Keep source copies until verification succeeds. The R2 archive has separate retention-protected object/snapshot prefixes; its upload credentials cannot edit retention configuration. Keep large data outside Git and commit tooling plus the small verification record.

**Recovery scope:** when work has moved between checkouts, inventory retired worktrees, backups, nested build checkouts, Git history and embedded provider responses within the owner's authorized search boundary. Deduplicate by bytes while preserving each source path and revision. Label branding assets, vector masters and historical derivatives separately from original-resolution science illustrations. Record which archive containers were fully listed and which were only sampled; a bounded inspection cannot establish exhaustive absence. Preserve a pinned copy of the restore tooling with the archive.

**Ready for mapping:** every source used for a target has a retrievable original or a documented access gap, edition information and a page locator. Work does not depend solely on a browser URL or a file in `/tmp`.

## Step 3 Build the competency map

Preserve the authority's hierarchy. A broad competency, a component skill, an end-of-cycle standard and a grade performance statement are different units. Keep source-language wording available alongside any editorial summary or translation. Retain official identifiers; label Hiraia-assigned identifiers as editorial and keep them stable.

For every grade expectation, record the curriculum source and printed/PDF page, parent competency and cycle, grade, source order, complete statement and relevant examples. Record factual defects separately; curriculum authority does not make every example scientifically correct.

For every proposed content match, record the exact target ID and lesson/objective/card/quiz IDs, the matched concept **and action**, the source evidence, adaptation needed, reviewer and status. A card about plants does not by itself cover conducting an investigation into plant growth.

Use these review states in country planning; translate them explicitly if a tool uses different field names:

| State | Meaning |
| --- | --- |
| Unreviewed | No defensible content match has been evaluated. |
| Candidate | Named existing material may help; its suitability is not verified. |
| Partial | Reviewed material teaches part of the expectation; remaining requirements are named. |
| Missing | Review found no suitable material for the required scope or learner level. |
| Mapped | Reviewed instruction and practice address the stated scope, with remaining hands-on or teacher assessment requirements identified. |

Keep **release availability** and **learner evidence** separate from these content states. Material can be mapped but not shipped. A lesson can be available without evidence that a particular learner can perform the skill. Investigation and design tasks may require observations, constructed work or teacher judgment beyond an in-app question.

**Peru lesson:** primary science has 3 broad competencies, 11 capacities, 9 end-of-cycle standards and 103 grade performance statements across Grades 1–6. MINEDU presents these `desempeños` as illustrations of observable development, not 103 separate competencies or a prescribed lesson count. The Philippine baseline has 324 learning-competency entries across Grades 3–10. Comparing 3 with 324 would compare different levels of the hierarchy. Peru introduces some cell and particle explanations in Grade 5; existing Philippine Grade 7 material is a reuse candidate, not an age-appropriate lesson by default. Grades 1–2 need their own learning design.

An example in Peru's Grade 6 programme incorrectly generalizes that bacteria require a host. Keep the exact source and a correction flag in the research map, and teach the corrected science. Do not silently alter a quotation or copy the error into a lesson.

**Ready for content planning:** all in-scope grade expectations are enumerated, identifiers and source references validate, and gaps have explicit owners or remain explicitly unassigned. Do not publish a coverage percentage until its denominator, review rule and evidence are defined.

## Step 4 Adapt instruction and assessment

Prioritize a coherent pilot slice by the target curriculum, rather than translating the whole library first. For each selected expectation, adapt explanations, prerequisites, examples, illustrations, practical activities and assessment together. Review species, seasons, hazards, units, household materials and local terminology with teachers from the selected community.

Preserve the scientific target while allowing locally relevant observations and questions. Distinguish cultural accounts, observations and explanations supported by evidence. Consult educators about respectful treatment of community knowledge; do not generate cultural claims from stereotypes.

Specify the reading and oral-language level. Hiraia's Philippine Grade 5 reading target is not automatically suitable for Peruvian Grades 1–2. Where readers are beginning, test oral instructions, short text and adult-supported activities with actual users. Spanish-dominant heritage learners and Quechua-dominant learners may need different language presentation even when they share the same science target.

Build assessments that test the expectation's action. Explanations need reasons and evidence; investigations need planning and observations; technological solutions need design, testing and revision. Record what the app measures and what remains for a teacher or practical task.

**Ready for a pilot pack:** reviewed materials and assessments cover the selected targets, missing practical components are visible, and age/language/context choices have a named local reviewer. A translated card inventory alone does not pass this step.

## Step 5 Establish language and model feasibility

Keep reference collection, training authorization, corpus quality and model capability as separate decisions. For continued pretraining (CPT), measure the usable data after language/variety classification, rights review, deduplication and removal of held-out evaluation material. Keep human-written and synthetic material separately identifiable.

Report bytes, documents, pages, words and model tokens with their methods; do not add counts from overlapping corpora or compare different tokenizers as though they were the same unit. Inspect mixed-language pages, repeated editions, boilerplate, translations and OCR failures. Preserve diacritics, case, mathematical symbols and decimals unless a documented transformation requires a change.

Frontier-model output is a candidate for review, not evidence of native fluency. Before using a model as a synthetic teacher, run a fixed, locally reviewed evaluation covering the selected variety, scientific correctness, reading level, terminology and translation fidelity. Review scientific and language errors separately. Freeze the accepted teacher/model/prompt versions with the generated data and check for copied reference or evaluation text.

Evaluate the deployed model and retrieval system, not only the teacher. Record the checkpoint, tokenizer, quantization, retrieval corpus and device. Measure science accuracy, grounded answers, language quality, latency, memory and failure behavior. CPT, supervised fine-tuning, retrieval and authored offline material solve different problems; choose the training work only after measuring the actual gap.

**Philippine lessons:** model intuition repeatedly misclassified valid Tagalog/Cebuano forms. Frequency is not grammatical authority, and a machine-translated corpus can repeat the same defect. Use dictionaries and qualified speakers; record dialect decisions. Test audit tools with known defects and clean controls, and report precision and recall separately. Fix recurring defects in generators as well as generated files. See [language defects](TRANSLATION-LEXICON-DEFECTS.md) and the [Cebuano audit method](../tools/cebuano-language-audit/PLAN.md).

**Peru boundary:** the 4.57 million raw words extracted from school PDFs include several languages, front matter and repeated material. They are neither clean Quechua words nor model tokens. The collection has no training-approved sources yet. The existence of synthetic Quechua output does not establish a classroom-ready Quechua tutor.

**Ready for device integration:** the selected pack/model passes a declared evaluation with native and science review; unresolved failures are recorded. Keep held-out material out of all training stages.

## Step 6 Package and pilot the country edition

Treat country/curriculum, grade, language, language variety, teaching-language role and release version as separate dimensions. A shared language can serve several countries; one country can require several language profiles. Coordinate with the internationalization work rather than duplicating its configuration or forking the app for each country.

Check the complete offline experience on representative devices: install, storage, first use without AI downloads, content navigation, retrieval, optional generation, voice where supported, shared profiles, updates, interruption/resume and teacher collection. Keep unsupported features explicit. Make the archive independent of the learner download channel; research PDFs do not belong in the APK by default.

Agree on the pilot's selected targets, learners, duration, observation method, success criteria and stop criteria with the partner before evaluating results. Include teacher workload and comprehension, not only engagement or quiz volume. Document local consent/data requirements and what leaves the phone based on the implemented flows; offline inference does not imply zero data transfer.

Follow the existing [build and release guide](../packages/mobile/BUILD.md), regression gate and signing/update rules for any app release. Validate source-to-bundle freshness, stable content IDs, country-specific assets, teacher compatibility and recovery. Publish only claims supported by the shipped edition.

**Ready to expand:** the pilot evidence supports the selected use, failures have been triaged, an owner can maintain curriculum and language quality, and delivery/support costs are known. Expansion to another region or variety reopens the affected steps; success in one community does not validate all Quechua learners.

## Country dossier template

Create one country record and link its larger artifacts rather than copying them into this recipe:

```text
Country and jurisdiction:
Record date and owner:
Pilot region, school partner and contact status:
Grades, ages and learner inclusion criteria:
Ministry, curriculum authority and local implementation offices:
Curriculum title, actual edition and evidence of applicability:
Language variety, orthography, learner language profile and teaching roles:
Demographic/enrolment measures with dates and denominators:
Devices, connectivity, teacher workflow and constraints:
Reference inventory and verified archive locations:
Competency map and validation command:
Existing-content candidates, reviewed coverage and gaps:
Pilot pack and assessment requirements:
Language reviewers, science reviewers and outstanding questions:
Corpus provenance, authorization, usable scale and held-out data:
Model/device evaluation results and artifact versions:
Pilot measures, findings and next decision:
Changes to the shared recipe, with dated evidence:
```

## Learning log

| Date | Evidence | Change to the recipe |
| --- | --- | --- |
| 1 October 2026 | Philippine curriculum audits and language-audit findings | Make exact lesson mappings, scientific correctness, native review and audit controls prerequisites for coverage and quality claims. Preserve generator fixes and content IDs through delivery. |
| 1 October 2026 | Peru education and language-policy research | Begin with school language profiles and local partners. Treat national science targets and instructional language as related but separate choices. |
| 1 October 2026 | Peru curriculum extraction and grade comparison | Preserve hierarchy and source edition; compare individual expectations across countries. Review scientific examples even in official documents. |
| 1 October 2026 | Quechua school-material acquisition | Archive original bytes and provenance early. Count distinct files, works, words and usable training data separately; record mirrors, OCR gaps and unresolved permissions. |
| 1 October 2026 | Original-image recovery and private R2 archive implementation | Preserve originals before manual conversion, including extensionless and mislabeled files. Recover embedded response images without re-encoding; separate generation inputs, original variants and shipping derivatives. Confirm retention and restore behavior against the live service. |
| 1 October 2026 | Expanded search of four months of worktrees and backups under `~/Code` | Search historical locations and provider payloads within the authorized boundary. Exact-byte matches establish duplicates; same names do not establish source revisions. Preserve auxiliary artwork and restore tooling, and document incomplete container inspections and unresolved source gaps. |

Add later findings here when they change a step. Keep failed assumptions visible enough that the next country team does not repeat them.

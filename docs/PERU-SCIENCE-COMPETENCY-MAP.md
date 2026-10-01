# Peru primary science competency map

Last reviewed: **1 October 2026**. Status: **national source map complete; Peru content alignment and local educator review pending**.

The target is MINEDU’s **Ciencia y Tecnología** area for **Grades 1–6**. The source is the **March 2017 edition** of the *Programa curricular de Educación Primaria*, still linked from MINEDU’s current publication catalogue. The catalogue’s 2025 date and the PDF file’s 2026 processing date are not new curriculum editions. [Official publication](https://www.gob.pe/institucion/minedu/informes-publicaciones/6790803-programa-curricular-de-educacion-primaria), [official PDF](https://cdn.www.gob.pe/uploads/document/file/10209521/6790803-programa-curricular-de-educacion-primaria.pdf?v=1782418171).

This is a national science target map. Choosing a Spanish- or Quechua-led learning path, a Quechua variety, community examples and EIB teaching practices comes next. The map does not certify that existing Hiraia lessons cover Peru’s expectations.

## Files and source

- [Machine-readable map](../rag/sources/curriculum-guides/peru/cneb-primary-science.json): official Spanish names, all primary cycle standards, all grade performance statements, separate illustrative source examples, editorial English labels, page locators and source issues.
- [PH reuse candidates](../rag/sources/curriculum-guides/peru/reuse-candidates.json): explicit links to existing Philippine competency statements and lesson authoring units, with the adaptation still required.
- [Validator](../rag/sources/curriculum-guides/peru/validate.py) and [source extractor](../rag/sources/curriculum-guides/peru/extract_source.py).
- Local source: `finetuning/reference-materials/peru-curriculum/minedu-primary-2017-34009689b6e3.pdf` — **20,473,784 bytes**, SHA-256 `34009689b6e3fe2194ec61c1675af13407528ae5e0f34f4d484007efd9e832f7`. The PDF is intentionally outside Git; its catalogue record and digest belong in the reference archive.

The science section is **printed pp. 271–301**, equivalent to **PDF pages 273–303**. Page numbers in the JSON are one-based and retain both forms. A source link can append `#page=293` to open printed p. 291.

## What is being counted

| Level | Count | Meaning |
|---|---:|---|
| National science competencies | **3** | Long-running abilities developed throughout primary school |
| Capacities | **11** | Components combined when exercising those competencies |
| Primary cycle standards | **9** | Three competencies × three end-of-cycle standards |
| Grade performance bullets | **103** | The observable grade-specific *desempeños* listed in the source |

The **103 bullets are not 103 separate national competencies**, nor a prescribed number of lessons. MINEDU introduces grade performances as examples of development toward a standard. A single performance can require several activities and several forms of evidence.

The three competencies are:

1. **Investigate using scientific methods** — ask questions; plan; collect and record data; analyze evidence; evaluate and communicate. Five capacities, **30** grade performance bullets. Definition on printed p. 273; grade tables on pp. 277, 279–281.
2. **Explain the physical world using scientific knowledge** — understand and apply knowledge of living things, matter, energy, biodiversity, Earth and the universe; evaluate the implications of science and technology. Two capacities, **50** grade performance bullets. Definition on p. 283; grade tables on pp. 286–289 and 291.
3. **Design and build technological solutions** — choose a solution; design it; implement and validate it; evaluate and communicate its operation and impacts. Four capacities, **23** grade performance bullets. Definition on p. 293; grade tables on pp. 296–301.

English labels in the map are editorial summaries, not official translations. The Spanish statements and source locators remain the reference.

## Progression to aim for

Cycles III, IV and V finish at **Grades 2, 4 and 6**. Their national progression levels are **3, 4 and 5** respectively: a standard’s level number is not a school grade.

| Cycle | Inquiry progression | Explanation progression | Technology progression |
|---|---|---|---|
| III: Grades 1–2 | Explore, ask, predict, observe and compare; communicate with pictures, speech or early writing | Explain observed relationships among materials, living things and the environment; discuss everyday technology | Identify a problem, draw a solution, build, test and improve it |
| IV: Grades 3–4 | Investigate causes, collect qualitative/quantitative data, compare with scientific information and communicate conclusions | Explain systems, forces, changes, energy, habitats and climatic patterns with documented evidence | Explain possible causes, specify parts and steps, use scientific/local knowledge, test requirements and improve |
| V: Grades 5–6 | Investigate variables, test causal hypotheses, control relevant conditions and evaluate methods | Connect visible properties to microscopic structure, reproduction to diversity, and landscape change to Earth’s dynamics; defend evidence-based views | Specify structure and resources, check construction, correct errors, evaluate performance and infer impacts |

These are orientation summaries. The JSON contains the complete Spanish cycle standards from printed pp. **275, 285 and 295**.

| Grade | Inquiry / explanation / technology bullets | Notable explanation targets |
|---|---:|---|
| 1 | 5 / 7 / 4 = **16** | Living things’ needs; classifying materials; daily energy use; soil; water and air; changing conditions; useful technology |
| 2 | 5 / 9 / 4 = **18** | Body parts/functions; parent–offspring similarities; light/heat changes; models of living relationships; day/night; Earth materials and soil |
| 3 | 5 / 8 / 4 = **17** | Plant/animal organs; species comparison; physical properties; forces; climate comparisons; habitats and interactions |
| 4 | 5 / 10 / 4 = **19** | Organ/system models; reproduction; reversible/irreversible changes; forces and energy; ecological roles; adaptations and climate zones |
| 5 | 5 / 7 / 3 = **15** | Plant/animal cells; reproduction; particle model of matter; ecosystems; changing Earth; scientific and technological progress |
| 6 | 5 / 9 / 4 = **18** | Unicellular/multicellular life; variation; molecular motion and matter changes; biodiversity/stability; Earth dynamics; evidence-based social/environmental argument |

**Grade 5 technology really has three bullets in this edition.** Printed p. 301 continues its design and construction bullets; testing also appears in the construction example. All four capacities and the cycle standard still apply. We have not invented a fourth grade bullet to make the table symmetrical.

The section does not prescribe a Philippine-style four-quarter subject order. Store national target, grade, cycle and locally chosen lesson sequence separately.

## Reuse from the Philippines

The preliminary crosswalk contains **36 candidate groups**, touching **80 performance targets** across inquiry and explanation. These are adaptation leads, not coverage percentages. Every target still has `coverage_status: not_assessed`; no Peru alignment is approved.

Candidate selection compared the Spanish expectations with the repository’s PH competency wording and lesson authoring units. It did **not** rely on matching keywords or certify the contents of generated card pools.

Several large sequence differences are already concrete:

| Peru target | Existing PH candidate | Required work |
|---|---|---|
| Grade 2 models of living relationships; source example uses a food chain | Grade 4 `g4:food-chains` | Design a Grade 2 model/explanation activity; the Peru target is broader than this example |
| Grade 5 animal/plant cells | Grade 7 `g7:plant-animal-cells` | Re-sequence, simplify language and representations, and include the required basic functions |
| Grade 5 particles; Grade 6 states and molecular motion | Grade 7 particle lessons | Build a primary-level sequence and check model limitations |
| Grade 6 biodiversity and ecosystem stability | Grade 9 `g9:l-5` | Use simple local ecosystem evidence and an age-appropriate explanation |
| Grade 6 rearrangement of matter’s components | Grade 6 changes plus Grade 9/10 chemistry | Develop a simple accurate explanation without importing an entire secondary chemistry sequence |

Three gaps affect the deployment plan:

- **Grades 1–2 need a learning path.** The inspected PH authoring baseline starts at Grade 3. Related facts do not supply early literacy design, oral/picture responses, observation tasks or teacher support for young learners. The Grade 5 default reading level is not an adequate assumption for these grades.
- **All 23 technology performances need explicit task design.** Existing circuits, machines and useful-material lessons offer ingredients. They have not been shown to satisfy Peru’s full sequence of identifying a problem, specifying, constructing, testing, adjusting and explaining effects.
- **Inquiry needs evidence of doing.** A card, answer or quiz score cannot establish that a learner planned an investigation, collected measurements or evaluated their method. Grade 6 also explicitly mentions mode and direct proportion when organizing data.

## Source accuracy and validation

The Grade 6 cell-function example on printed p. **291** incorrectly generalizes that bacteria require a host. Many bacteria are free-living. The JSON preserves the original example separately, flags `PE-SOURCE-BACTERIA-001`, and keeps it out of the performance statement. The valid cell-function target can be taught with a corrected example. [Microbiology Society](https://microbiologysociety.org/why-microbiology-matters/what-is-microbiology/what-are-bacteria.html).

All source examples remain **unreviewed research evidence**. Some represent hypothetical student answers. Do not index this map’s `source_example_es` into the science grounding bank, tutor or CPT corpus as verified content. Other illustrations and simplifications still need a science review.

Validation on 1 October 2026 passed:

- Unique editorial IDs; the 3-competency/11-capacity/9-standard hierarchy; the complete grade/count matrix; cycle/grade relationships; page offsets; and source-issue links.
- Exact comparison of all **103 performance bullets** and **9 cycle standards** against a fresh, column-aware extraction of the SHA-256-pinned official PDF.
- A separate count of bullet markers in the full-page layout extraction: **30 inquiry, 50 explanation, 23 technology**. The Grade 5 technology continuation was also checked in a rendered PDF page.
- All referenced PH lesson/unit IDs and pinned baseline file digests.

To repeat:

```sh
python3 rag/sources/curriculum-guides/peru/validate.py \
  --source-pdf finetuning/reference-materials/peru-curriculum/minedu-primary-2017-34009689b6e3.pdf
```

Without `--source-pdf`, the validator checks structure and crosswalk references only. Neither mode certifies pedagogical coverage, translation quality or scientific correctness of every source example.

Next: have a Peruvian primary/EIB educator review the targets and sequencing; select a deployment community and learner language profile; audit candidate lessons against the complete demand of each performance; author missing tasks and assessment evidence; then approve individual target-to-content links. Update the [country bootstrap guide](COUNTRY-BOOTSTRAP.md) as these steps produce evidence.

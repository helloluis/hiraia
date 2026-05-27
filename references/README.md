# References

Raw reference materials for the Hiraia Science tutor. These files are **gitignored** — they are not checked into the repository.

## Directory Structure

- `curriculum/` — DepEd curriculum guides (PDFs)
  - MATATAG Science CG (Grade 4 & 7)
  - K-12 Science CG (Grade 3–10)
  - MATATAG Science CG 2023 (revised)
- `modules/` — DepEd Self-Learning Modules (SLMs) from the LRMDS portal
  - Science modules for Grades 3–10

## Sources

| Source | URL |
|---|---|
| MATATAG Curriculum Portal | https://www.deped.gov.ph/matatagcurriculumk147/ |
| K-12 Science CG (2016, revised) | https://www.deped.gov.ph/wp-content/uploads/2019/01/Science-CG_with-tagged-sci-equipment_revised.pdf |
| MATATAG Science CG (Grade 4 & 7) | https://www.deped.gov.ph/wp-content/uploads/MATATAG-Science-CG-Grade-4-and-7.pdf |
| MATATAG Science CG 2023 | https://www.academ-e.ph/wp-content/uploads/2023/09/Science-CG-2023.pdf |
| DepEd LRMDS Portal | https://lrmds.deped.gov.ph/k_to_12 |

## Usage

These files feed into:
1. **RAG pipeline** — chunked and embedded as the tutor's knowledge base (`rag/sources/`)
2. **Curriculum mapping** — parsed into structured JSON for grade/topic routing (`packages/shared/curriculum/`)
3. **LoRA dataset generation** — content used to synthesize tutoring dialogues for fine-tuning (`finetuning/datasets/`)

## License

DepEd materials are free for educational and non-commercial use. Always cite the Department of Education, Philippines.

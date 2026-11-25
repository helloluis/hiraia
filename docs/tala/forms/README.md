# Public school-forms catalogue (`/forms`)

`tala.hiraia.org/forms` lists free, **unofficial** fillable PDF copies of DepEd School Forms (SF1–SF10, their
Kindergarten and Senior High School versions) and the ALS forms AF1–AF5. It is open to signed-out visitors.

- **Static only.** `packages/tala-web/src/app/forms/page.tsx` renders `catalogue.ts`; every file is a static asset
  under `packages/tala-web/public/forms/` (PDFs, WebP page previews, a ZIP of the PDFs, `SHA256SUMS.txt`). The page's
  own code calls no API, stores nothing and has no upload or submit path; the root layout's shared providers still run
  on it as on every page (one `GET /api/v1/config`, cached in IndexedDB; no cookie). The PDFs contain no JavaScript,
  links, submit/launch actions or embedded files.
- **Provenance.** Each PDF is built from DepEd's own blank file (LIS Support Page, DepEd's 2014 workbook), or
  rebuilt from the sample printed in DO 8, s. 2015 (SF9). The page and every printed page say these are unofficial
  drafting copies that never replace the LIS-generated forms (DO 11, s. 2018).
- **Labels.** Each form carries its version label and a status: latest DepEd blank, older version still in use, may
  be out of date (LIS has a newer in-system version), rebuilt from sample, historical 2014 layout, or superseded.
- **Unresolved.** The current LIS-generated SF1–SF6 (elementary and junior high) and an official MATATAG-era SF9
  could not be verified and are not included.
- **Updating.** `catalogue.ts` is generated together with the files (sizes and SHA-256 must match). Replace the
  files and the catalogue in one commit, and keep `public/forms` at or under 25 MB.

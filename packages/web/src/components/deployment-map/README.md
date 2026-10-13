# Hiraia Archipelago

The homepage renders the map directly after Downloads and before the Dev Diary
through `Landing`'s `afterDownload` slot. Local review routes remain available at
`/preview/deployments` (map alone) and `/preview/homepage` (the same homepage)
while running Next in development. Both preview routes return 404 in production.

## Design and interaction

All map geometry is SVG, drawn in a shallow oblique projection, using the site's
`#F4EAD5` stock and `#4D4740` graphite. No raster basemap, API key, external tiles,
WebGL or new runtime dependency is needed. Provincial paths are compiled locally.
Mouse drag, wheel zoom, touch drag/pinch, keyboard arrows, +/−, Home, map views,
and accessible marker/directory buttons are supported. Camera
transforms apply to geometry; banners and point markers remain upright and legible.
The nearby Manila pin heads are separated while their feet retain their locations.
On narrow screens, banners appear on selection and all pilots have directory buttons.

The title is **A Hiraia Archipelago**, without a trailing full stop. The overview
filter is **Pilots + Downloads**. “Direct Downloads” replaces the regional
Visayas preset: it frames the whole Philippines, highlights all collected download
areas equally, and hides pilot banners while that view is active. Panning, zooming,
and crossing the mobile breakpoint preserve the selected layer. The overview
shows both layers; the pilot view shows the formal deployments. Download markers,
labels, tooltips and details convey presence and place names without quantities.
The compact note identifies approximate areas derived from clicks and the snapshot
date. Detailed measurement/reconciliation stays in this audit record. Decorative
captions and the totals strip have been removed.

The section has no outer frame, toolbar/footer dividers, boxed zoom controls or
mobile directory separators. Active pilot ribbons use a paper fill and light
shadow; the planned ribbon retains its fine dashed outline as a status cue.
Viewport-space SVG alpha masks fade the geography, background grid, labels and
download dots into the section's beige. The fade widens smoothly with the zoom
level; banners, compass and controls remain crisp and interactive. Masks use
instance-specific IDs and adapt to the mobile viewport without external assets.

## Evidence and unresolved data

- Owner-supplied on 12 October 2026: Calapacuan **36** phones, Better World **40**,
  Daanghari **50 planned** for Wednesday (14 October). Counts remain on individual
  pilot banners. Status is explicit; crossing a date never automatically activates
  a pilot.
- Banners and details identify the phones as **donated**, with launch dates next
  to “Pilot Site.” Calapacuan uses **23 September 2026**, as subsequently supplied
  by the owner, with the Dev Diary entry corrected to match (previously 25
  September). Better World uses the diary's **29 September 2026** date.
  Daanghari says **planned 14 October 2026** and **50 mobile phones to be donated**;
  the scheduled donation is not represented as completed.
- The existing `DevDiary.tsx` establishes Calapacuan Elementary School, Subic,
  Zambales, and **Better World Smokey Mountain**, Manila. This is not the separate
  Better World Tondo center. Better World's pin is an approximate area marker,
  identified as such in its detail panel; an exact venue coordinate remains to
  be confirmed before a high-resolution publication.
- Calapacuan school coordinates: [DepEd Region III school listing](https://region3.deped.gov.ph/wp-content/uploads/2020/02/RM-064-s.-2020-Addendum-to-Regional-Memorandum-No.-021-s.-2020.pdf).
- Daanghari school identity: [SDO Navotas](https://depednavotas.ph/schools/).
  Coordinates: [OpenStreetMap way 139821290](https://www.openstreetmap.org/way/139821290)
  via [Mapcarta](https://mapcarta.com/W139821290). OSM contributors / ODbL.
- Download markers now use the **actual admin database**, `/var/lib/hiraia/hiraia.db`,
  selected by the running admin service's `HIRAIA_DB_PATH`. The initial inspection
  of `/root/hiraia/data/hiraia.db` hit an older checkout database. That earlier
  finding does **not** describe the active dashboard. No production data or
  endpoint was changed.
- `downloads.snapshot.json` is a read-only aggregate of `apk_download_hits`,
  retrieved **12 October 2026 at 04:40 UTC**. Reporting window: **5 September–12
  October 2026**, with the last day partial. There are **506 Philippine download
  clicks** (546 across all countries): **193 placed**, **149 without a city**,
  **164 with unresolved city labels**. No IP addresses, IP hashes, device IDs,
  sessions or student activity are included. The measure is a homepage download
  button click, deduplicated by IP hash per UTC day; it does not establish a
  completed download, installation, unique learner or phone. The historical
  endpoint name does not make every click an Android-only completed transfer.
- `download-places.json` records reviewed city-label assignments and the GeoNames
  IDs used to check them. Matching populated-place names and aliases must agree
  on a province area. Ambiguous labels remain unplaced, even for likely matches:
  **Consolacion, Oton, Talisay City, Taytay, Poblacion**, and others. Talisay City
  has an explicit hold because the exact alias in this gazetteer misses the
  second city. Muntinlupa and three other Metro Manila labels have documented
  corrections to stale/missing gazetteer administrative codes. Uniqueness in a
  gazetteer is evidence, not a guarantee of the source GeoIP location.
- Place-name evidence: [GeoNames Philippine gazetteer](https://download.geonames.org/export/dump/PH.zip),
  **CC BY 4.0**, retrieved 12 October 2026; source digests are recorded in the
  mapping file. City-level [GeoNames records](https://www.geonames.org/) can be
  opened using the recorded ID. Independently administered cities are grouped
  into **geographic province areas**, not asserted to be legally subordinate to
  a province. Metro Manila is one area. Anchors are representative interiors of
  province polygons, not individual download/device coordinates. GeoIP indicates
  an approximate network location, which can differ from the downloader's location.
- The seven resolved Visayas areas total **27** clicks: Cebu **10**, Iloilo **7**,
  Negros Occidental **4**, Bohol **3**, Aklan **1**, Capiz **1**, Southern Leyte **1**.
  These are partial placed counts, not exhaustive provincial totals; unresolved
  rows may belong to these areas too. Selecting an area shows the exact source
  city labels. Counts remain in the source audit records but are hidden in the map.
  No example markers remain.
- `build-download-map.py` compiles only explicit reviewed assignments, holds new
  names, validates source counts, and reconciles mapped + missing + unresolved
  to the Philippine total. `downloads.generated.json` is a **dated snapshot**,
  not a live dashboard feed; its date is displayed beneath the map. The initial
  publication uses the reviewed 12 October dataset. When refreshing the snapshot,
  review new labels before publishing. A future server-side feed must preserve these metric
  and provenance distinctions; never query admin secrets from the client.

## Geometry attribution and regeneration

[geoBoundaries PHL ADM2](https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM2/),
NAMRIA / PSA / OCHA Philippines, **2020** boundary snapshot, **CC BY 3.0 IGO**.
These historical province-level units are for an illustrative overview, not a
current legal boundary reference. Attribution is in the expandable “Map sources”
control beneath the map.
Source URL, SHA-256, license and modifications are embedded in
`philippines.generated.json`; use the immutable URL recorded there.

```sh
python3 packages/web/scripts/build-deployment-map.py /path/to/geoBoundaries-PHL-ADM2_simplified.geojson
python3 packages/web/scripts/build-download-map.py
pnpm --filter @hiraia/web exec tsc --noEmit
pnpm --filter @hiraia/web exec next dev --hostname 127.0.0.1 --port 3105
```

Review screenshots and browser-check evidence are under the gitignored
`build/deployment-map-preview/` directory. Homepage activation was authorized
on 13 October 2026, following the integrated preview review.

## Preview validation (12 October 2026)

TypeScript check passed. Aggregation checks reconcile the source and reject
duplicated cities, negative counts and mismatched totals; new/unresolved labels
remain unplaced. Browser review covers desktop/mobile rendering, selection and
source city labels, map views, mouse/touch dragging, wheel/pinch zoom,
keyboard controls and planned-pilot details. Screenshots use `hiraia-archipelago-*`
filenames under the review directory.

The integrated homepage review includes desktop/mobile full-page and context
screenshots (`hiraia-homepage-*`), banner text bounds, per-site donation/date copy,
section order, and confirmation that the regular homepage still omits the map.

Visual refinement on 13 October 2026: borderless section and controls, lighter
pilot ribbons, zoom-dependent viewport fading, “Pilots + Downloads,” and no
title full stop. TypeScript and desktop/mobile browser checks passed, including
progressive fading/reset, dragging with masks active, banner text bounds and
320px layout. Updated captures: `hiraia-floating-*`; browser evidence:
`build/deployment-map-preview/floating-browser-checks.json`.

## Production validation (13 October 2026)

Enabled on the homepage after Downloads. The optimized Next.js build, standalone
TypeScript check, competency verification (322/322), and platform download guards
passed. Next's lint step reports the existing root ESLint configuration problem:
`@typescript-eslint/await-thenable` requires type information, but `parserOptions`
does not supply it. The build completes; this is not a clean lint result.

Browser checks against `next start` passed for desktop, 390px and 320px layouts,
section order, all 39 download areas, donation/date banners, selection, filter
isolation, mouse/touch dragging, wheel/pinch zoom, keyboard controls, zoom-edge
fading, source attribution and absence of browser errors. Both preview routes
return HTTP 404. The 0.4.41 platform download configuration is retained unchanged.
Evidence: `production-browser-checks.json`, `production-interaction-checks.json`
and `hiraia-production-*` screenshots in the local review directory.

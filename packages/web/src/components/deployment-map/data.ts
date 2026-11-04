import collected from './downloads.generated.json';

export type Pilot = {
  id: string; name: string; place: string;
  /** Shorter place line for the 268 px banner; the detail panel shows `place` in full. */
  bannerPlace?: string;
  /** Owner-supplied handset count; null until the owner confirms a number. */
  phones: number | null;
  /** Learner population: DepEd's published figure, or the owner's approximate one ("~2,000",
   *  no school year or link) where no published count exists; null when neither exists. `label`
   *  is never more precise than its basis. */
  learners: {label: string; schoolYear?: string; source?: string} | null;
  status: 'active' | 'planned'; donation: 'donated' | 'planned' | 'unconfirmed';
  date: string; coordinates: readonly [number, number];
  locationPrecision: 'school' | 'area';
};

// Learner counts: DepEd "Enrollment in SY 2024-2025" machine-ready file (Learner Information
// System), the sum of every grade/sex column in each school's row — Calapacuan 107006, Daanghari
// (Navotas) 136865, Cornelio Lintawagin MES 110522, Siay NHS 303864. Not Daanghari ES Taguig
// (136884). Checked 4 November 2026. Better World Smokey Mountain is an NGO centre outside
// DepEd's data with no published enrolment count; its "~2,000" is the owner's figure
// (4 November 2026).
const DEPED_ENROLLMENT = 'https://www.deped.gov.ph/machine-ready-files/';

// Phone counts were supplied by the project owner on 12 October 2026.
// Calapacuan and DaangHari launch dates follow the owner's updates and Dev Diary.
// Never promote a planned pilot solely because its scheduled date has elapsed.
export const pilots: Pilot[] = [
  {id: 'calapacuan', name: 'Calapacuan', place: 'Elementary School · Subic, Zambales', phones: 36,
    learners: {label: '1,603', schoolYear: 'SY 2024–25', source: DEPED_ENROLLMENT},
    status: 'active', donation: 'donated', date: '2026-09-23', coordinates: [120.241415, 14.862449], locationPrecision: 'school'},
  {id: 'better-world', name: 'Better World', place: 'Smokey Mountain · Manila', phones: 40,
    learners: {label: '~2,000'},
    status: 'active', donation: 'donated', date: '2026-09-29', coordinates: [120.96, 14.637], locationPrecision: 'area'},
  {id: 'daanghari', name: 'DaangHari', place: 'Elementary School · Navotas', phones: 50,
    learners: {label: '1,387', schoolYear: 'SY 2024–25', source: DEPED_ENROLLMENT},
    status: 'active', donation: 'donated', date: '2026-10-14', coordinates: [120.94069, 14.66582], locationPrecision: 'school'},
  // Launch date from the owner's photo (EXIF DateTimeOriginal 2026-10-26 13:27, camera clock);
  // the owner announced it the same day. Handset count 36 from the owner's correction of
  // 28 October 2026. Coordinates: OpenStreetMap way 784367611 (Barangay Paitan, Naujan,
  // Oriental Mindoro), ODbL.
  {id: 'cornelio-lintawagin', name: 'Cornelio Lintawagin', place: 'Memorial Elementary School · Naujan, Oriental Mindoro',
    bannerPlace: 'Memorial ES · Naujan, Oriental Mindoro', phones: 36,
    learners: {label: '421', schoolYear: 'SY 2024–25', source: DEPED_ENROLLMENT},
    status: 'active', donation: 'donated', date: '2026-10-26', coordinates: [121.0848435, 13.2675032], locationPrecision: 'school'},
  // Fifth pilot: the owner gave its start as 12 November 2026 and 15 donated phones
  // (4 November 2026). It stays planned until the owner confirms the launch. Coordinates: OpenStreetMap way 907084881
  // (Barangay Bataan, Siay, Zamboanga Sibugay), ODbL.
  {id: 'siay', name: 'Siay', place: 'National High School · Siay, Zamboanga Sibugay',
    bannerPlace: 'National HS · Siay, Zamboanga Sibugay', phones: 15,
    learners: {label: '1,818', schoolYear: 'SY 2024–25', source: DEPED_ENROLLMENT},
    status: 'planned', donation: 'donated', date: '2026-11-12',
    coordinates: [122.8653351, 7.7049179], locationPrecision: 'school'},
];

export type DownloadLocation = {
  id: string; province: string; coordinates: readonly [number, number];
  count: number; boundaries: string[]; cities: {city: string; clicks: number}[];
};
// A dated read-only export from the same database used by the admin dashboard.
// Clicks are deduplicated per IP hash / UTC day; these are not installations.
export const downloadSnapshot = {...collected, locations: collected.locations.map(d => ({
  ...d, coordinates: [d.coordinates[0]!, d.coordinates[1]!] as const,
}))};

// Keep in sync with scripts/build-deployment-map.py's oblique projection.
export function project([lon, lat]: readonly [number, number]) {
  const x=(lon-116)*Math.cos(13*Math.PI/180)*65, y=(21.4-lat)*65;
  return {x:280+x+y*.23,y:24+y*.76-x*.14};
}

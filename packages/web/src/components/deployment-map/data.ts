import collected from './downloads.generated.json';

export type Pilot = {
  id: string; name: string; place: string;
  /** Shorter place line for the 268 px banner; the detail panel shows `place` in full. */
  bannerPlace?: string;
  /** Owner-supplied handset count; null until the owner confirms a number. */
  phones: number | null;
  status: 'active' | 'planned'; donation: 'donated' | 'planned' | 'unconfirmed';
  date: string; coordinates: readonly [number, number];
  locationPrecision: 'school' | 'area';
};

// Phone counts were supplied by the project owner on 12 October 2026.
// Calapacuan and DaangHari launch dates follow the owner's updates and Dev Diary.
// Never promote a planned pilot solely because its scheduled date has elapsed.
export const pilots: Pilot[] = [
  {id: 'calapacuan', name: 'Calapacuan', place: 'Elementary School · Subic, Zambales', phones: 36,
    status: 'active', donation: 'donated', date: '2026-09-23', coordinates: [120.241415, 14.862449], locationPrecision: 'school'},
  {id: 'better-world', name: 'Better World', place: 'Smokey Mountain · Manila', phones: 40,
    status: 'active', donation: 'donated', date: '2026-09-29', coordinates: [120.96, 14.637], locationPrecision: 'area'},
  {id: 'daanghari', name: 'DaangHari', place: 'Elementary School · Navotas', phones: 50,
    status: 'active', donation: 'donated', date: '2026-10-14', coordinates: [120.94069, 14.66582], locationPrecision: 'school'},
  // Launch date from the owner's photo (EXIF DateTimeOriginal 2026-10-26 13:27, camera clock);
  // the owner announced it the same day. Handset count and donation remain unconfirmed, so
  // the banner shows no number. Coordinates: OpenStreetMap way 784367611 (Barangay Paitan,
  // Naujan, Oriental Mindoro), ODbL.
  {id: 'cornelio-lintawagin', name: 'Cornelio Lintawagin', place: 'Memorial Elementary School · Naujan, Oriental Mindoro',
    bannerPlace: 'Memorial ES · Naujan, Oriental Mindoro', phones: null,
    status: 'active', donation: 'unconfirmed', date: '2026-10-26', coordinates: [121.0848435, 13.2675032], locationPrecision: 'school'},
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

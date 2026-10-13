import collected from './downloads.generated.json';

export type Pilot = {
  id: string; name: string; place: string; phones: number;
  status: 'active' | 'planned'; date: string; coordinates: readonly [number, number];
  locationPrecision: 'school' | 'area';
};

// Phone counts and status supplied by the project owner, 12 October 2026.
// Calapacuan launch date updated to the owner's requested 23 September 2026.
// Better World's launch date follows DevDiary.tsx; Daanghari is still scheduled.
// Never promote a planned pilot solely because its scheduled date has elapsed.
export const pilots: Pilot[] = [
  {id: 'calapacuan', name: 'Calapacuan', place: 'Elementary School · Subic, Zambales', phones: 36,
    status: 'active', date: '2026-09-23', coordinates: [120.241415, 14.862449], locationPrecision: 'school'},
  {id: 'better-world', name: 'Better World', place: 'Smokey Mountain · Manila', phones: 40,
    status: 'active', date: '2026-09-29', coordinates: [120.96, 14.637], locationPrecision: 'area'},
  {id: 'daanghari', name: 'Daanghari', place: 'Elementary School · Navotas', phones: 50,
    status: 'planned', date: '2026-10-14', coordinates: [120.94069, 14.66582], locationPrecision: 'school'},
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

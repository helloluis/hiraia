#!/usr/bin/env python3
"""Compile the read-only admin snapshot using reviewed, explicit area assignments.

New or ambiguous city labels remain unplaced. Never infer placements by popularity,
split one source row across areas, or substitute web sessions for download clicks.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'src/components/deployment-map'


def compile_snapshot(snapshot, geography):
    if snapshot['country'] != 'PH':
        raise ValueError('Only Philippine aggregates are supported')
    missing, unresolved, seen, groups = 0, [], set(), {}
    for row in snapshot['cities']:
        city, count = row['city'], row['clicks']
        if city in seen or type(count) is not int or count < 0:
            raise ValueError('Duplicate city or invalid count')
        seen.add(city)
        if city is None or not city.strip():
            missing += count
        elif city not in geography['places'] or city in geography['holds']:
            unresolved.append({'city': city, 'clicks': count})
        else:
            area = geography['places'][city]['area']
            groups.setdefault(area, []).append({'city': city, 'clicks': count})
    locations = []
    for area, cities in groups.items():
        meta = geography['areas'][area]
        locations.append({
            'id': area.lower().replace(' ', '-'), 'province': area,
            'coordinates': meta['coordinates'], 'boundaries': meta['boundaries'],
            'count': sum(c['clicks'] for c in cities),
            'cities': sorted(cities, key=lambda c: (-c['clicks'], c['city'])),
        })
    mapped = sum(d['count'] for d in locations)
    unplaced = sum(c['clicks'] for c in unresolved)
    if mapped + unplaced + missing != snapshot['totalClicks']:
        raise ValueError('Source total does not reconcile')
    return {
        'retrievedAt': snapshot['retrievedAt'], 'period': snapshot['period'],
        'metric': snapshot['metric'], 'totalClicks': snapshot['totalClicks'],
        'mappedClicks': mapped, 'missingCityClicks': missing,
        'unresolvedCityClicks': unplaced, 'unresolvedCities': unresolved,
        'locations': sorted(locations, key=lambda d: (-d['count'], d['province'])),
    }


if __name__ == '__main__':
    result = compile_snapshot(json.loads((ROOT / 'downloads.snapshot.json').read_text()),
                              json.loads((ROOT / 'download-places.json').read_text()))
    (ROOT / 'downloads.generated.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f"{result['mappedClicks']} mapped + {result['missingCityClicks']} missing city + "
          f"{result['unresolvedCityClicks']} unresolved = {result['totalClicks']} Philippine clicks")

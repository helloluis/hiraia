#!/usr/bin/env python3
"""Compile the pinned geoBoundaries province geometry into lightweight SVG paths.
Usage: python3 packages/web/scripts/build-deployment-map.py <downloaded-geojson>
Source + license are retained in the generated file. No runtime map/tile service.
"""
import hashlib,json,math,sys
from pathlib import Path
source=Path(sys.argv[1]); raw=source.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='fa77b9f17db2e419acaae714a935f7812be4409e2983675d34020e8426a3e189'
data=json.loads(raw)
def project(lon,lat):
    # Equirectangular at 13° N, then a shallow oblique atlas perspective.
    x=(lon-116)*math.cos(math.radians(13))*65
    y=(21.4-lat)*65
    return [round(280+x+y*.23,2),round(24+y*.76-x*.14,2)]
def simplify(points,epsilon=.16):
    if len(points)<=2:return points
    a,b=points[0],points[-1];dx=b[0]-a[0];dy=b[1]-a[1];length=dx*dx+dy*dy
    best,index=0,0
    for i,p in enumerate(points[1:-1],1):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
        dist=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
        if dist>best:best,index=dist,i
    if best>epsilon*epsilon:return simplify(points[:index+1],epsilon)[:-1]+simplify(points[index:],epsilon)
    return [a,b]
features=[]
for f in data['features']:
    g=f['geometry']; polygons=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    rings=[]
    for poly in polygons:
        for ring in poly:
            pts=simplify([project(*p[:2]) for p in ring])
            if len(pts)<4:continue
            rings.append('M'+'L'.join(f'{x:g},{y:g}' for x,y in pts[:-1])+'Z')
    features.append({'name':f['properties']['shapeName'],'path':''.join(rings)})
out={'source':{'title':'geoBoundaries PHL ADM2 (NAMRIA / PSA / OCHA Philippines)','url':'https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM2/','geometryUrl':'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/41af8f1/releaseData/gbOpen/PHL/ADM2/geoBoundaries-PHL-ADM2_simplified.geojson','year':2020,'license':'CC BY 3.0 IGO','licenseUrl':'https://creativecommons.org/licenses/by/3.0/igo/','sha256':hashlib.sha256(raw).hexdigest(),'modifications':'Simplified to 0.16 projected pixels and rendered in an oblique projection; historical province boundaries, not a current legal boundary reference.'},'features':features}
p=Path(__file__).resolve().parents[1]/'src/components/deployment-map/philippines.generated.json'
p.write_text(json.dumps(out,separators=(',',':'),ensure_ascii=False)+'\n')
print(f'{len(features)} province geometries; {p.stat().st_size:,} bytes')
for name,point in [('Calapacuan',(120.241415,14.862449)),('Better World',(120.96,14.637)),('Daanghari',(120.94069,14.66582)),('Cebu',(123.8,10.5))]:print(name,project(*point))

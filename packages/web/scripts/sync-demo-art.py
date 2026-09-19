"""Use current native artwork for the demo's selected cards, without re-encoding images.
Usage: python sync-demo-art.py /path/to/native-checkout
"""
import json,re,shutil,sys
from pathlib import Path
web=Path(__file__).resolve().parents[1]
mobile=Path(sys.argv[1])/'packages/mobile'
source=mobile/'src/generated/imageMap.ts'
paths=dict(re.findall(r'"([^"]+)": require\("([^"]+)"\)',source.read_text()))
slugs={c['slug'] for p in (web/'src/data').glob('demo-q1-*.json') for c in json.loads(p.read_text())['cards'] if c.get('slug')}
written=[]
for slug in sorted(slugs):
 key=slug if slug in paths else re.sub(r'-g\d+$','',slug)
 if key not in paths:continue
 src=source.parent/paths[key];dst=web/'public/demo/cards'/f'{slug}.png'
 if not dst.exists() or src.read_bytes()!=dst.read_bytes():shutil.copyfile(src,dst)
 written.append(slug)
known={p.stem for p in (web/'public/demo/cards').glob('*.png')}
(web/'src/data/demo-art-slugs.json').write_text(json.dumps(sorted(known),separators=(',',':'))+'\n')
print('Synced',len(written),'current native illustrations; no transcoding')

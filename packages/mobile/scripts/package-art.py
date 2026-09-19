#!/usr/bin/env python3
"""Build deterministic HIRAIMG1 image packs from the existing grade/quarter shards."""
import hashlib,json,struct,re,subprocess,sys
from collections import defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'rag/pipeline/art-shards'
OUT=ROOT/'packages/mobile/build/image-packs'
OUT.mkdir(parents=True,exist_ok=True)
index=json.loads((SOURCE/'index.json').read_text())
# Shared illustrations belong to common; single-grade illustrations to that grade.
# Use the card inventory's authored grade suffix, rather than a primary curriculum tag.
grades=defaultdict(set)
tags=json.loads((ROOT/'packages/mobile/src/generated/curriculumTags.generated.json').read_text())
for card in json.loads((ROOT/'packages/mobile/src/generated/cardsIndex.generated.json').read_text())['cards']:
 match=re.search(r'-g(\d+)$',card['factId'])
 if match:
  suffix=match[1]
  grades[card['slug']].update([int(suffix)] if int(suffix)<=10 else [int(x) for x in suffix])
 tag=tags.get(card['id'])
 if tag:
  grades[card['slug']].add(tag[1])
  if len(tag)>4: grades[card['slug']].update(cell[0] for cell in tag[4])
groups=defaultdict(list)
for shard in index['shards']:
 for row in json.loads((SOURCE/shard['file']).read_text())['images']:
  used=grades[row['slug']]
  cell='common' if len(used)!=1 else f'g{next(iter(used))}-all'
  groups[cell].append(row)
shards=[]
for cell,rows in sorted(groups.items()):
 rows.sort(key=lambda row:row['slug'])
 for offset in range(0,len(rows),600):
  shards.append({'id':f'{cell}-{offset//600+1:02d}','cell':cell,'images':rows[offset:offset+600]})
manifest={'format':1,'packs':[]}
seen=set()
for shard in shards:
 rows=shard['images']
 entries=[];blobs=[]
 for row in rows:
  slug=row['slug']
  assert slug not in seen and all((c.isalnum() or c in '_-') for c in slug),slug
  seen.add(slug)
  source=(ROOT/'packages/images'/row['file']).resolve()
  assert source.is_relative_to((ROOT/'packages/images').resolve())
  blob=source.read_bytes()
  assert len(blob)==row['bytes'] and hashlib.md5(blob).hexdigest()==row['md5'],str(source)
  assert blob.startswith(b'\x89PNG\r\n\x1a\n'),str(source)
  entries.append({'slug':slug,'bytes':len(blob),'md5':row['md5']});blobs.append(blob)
 header=json.dumps({'images':entries},separators=(',',':'),ensure_ascii=True).encode()
 data=b'HIRAIMG1'+struct.pack('<I',len(header))+header+b''.join(blobs)
 digest=hashlib.md5(data).hexdigest()
 filename=shard['id']+'-'+digest+'.hpak'
 (OUT/filename).write_bytes(data)
 manifest['packs'].append({'id':shard['id'],'cell':shard['cell'],'filename':filename,'bytes':len(data),'unpackedBytes':sum(x['bytes'] for x in entries),'md5':digest,'sha256':hashlib.sha256(data).hexdigest(),'images':len(entries)})
assert len(seen)==index['tail']['images']
manifest['version']=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()[:16]
text=json.dumps(manifest,indent=2)+'\n'
(OUT/'manifest.json').write_text(text)
# Validate the complete corpus and all grade selections before changing app references.
subprocess.run([sys.executable, str(ROOT/'packages/mobile/scripts/audit-image-packs.py'),
 '--manifest', str(OUT/'manifest.json'), '--check'], check=True)
(ROOT/'packages/mobile/src/generated/imagePacks.generated.json').write_text(text)
print(json.dumps({'packs':len(manifest['packs']),'images':len(seen),'bytes':sum(x['bytes'] for x in manifest['packs']),'version':manifest['version']}))

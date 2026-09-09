import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { headerLength, parseEntries, prioritize, requiredPacks } from '../src/images/format';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'src/generated/imagePacks.generated.json'),'utf8'));
test('all release packs round-trip every image and contain no duplicate slugs',()=>{
 const seen=new Set();let n=0;
 for(const pack of manifest.packs){
  const b=fs.readFileSync(path.join(root,'build/image-packs',pack.filename));
  assert.equal(b.length,pack.bytes);assert.equal(crypto.createHash('md5').update(b).digest('hex'),pack.md5);
  assert.equal(crypto.createHash('sha256').update(b).digest('hex'),pack.sha256);
  const length=headerLength(b.subarray(0,12));const rows=parseEntries(b.subarray(12,12+length),pack);let offset=12+length;
  for(const row of rows){assert(!seen.has(row.slug));seen.add(row.slug);const bytes=b.subarray(offset,offset+row.bytes);
   assert.equal(crypto.createHash('md5').update(bytes).digest('hex'),row.md5);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');offset+=row.bytes;n++;
  }
  assert.equal(offset,b.length);
 }
 assert.equal(n,17844);assert.ok(manifest.packs.length>0);
});
test('malformed headers, unsafe paths and duplicate entries are rejected',()=>{
 assert.throws(()=>headerLength(Buffer.alloc(12)));
 const prefix=Buffer.concat([Buffer.from('HIRAIMG1'),Buffer.from([255,255,255,127])]);assert.throws(()=>headerLength(prefix));
 const row={slug:'safe',bytes:8,md5:'a'.repeat(32)};
 const validate=(rows:any[])=>{const b=Buffer.from(JSON.stringify({images:rows}).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));return parseEntries(b,{...manifest.packs[0],images:rows.length,unpackedBytes:rows.length*8,bytes:12+b.length+rows.length*8});};
 assert.throws(()=>validate([{...row,slug:'../outside'}]));assert.throws(()=>validate([row,row]));
 assert.throws(()=>validate([{...row,bytes:2**40}]));assert.throws(()=>validate([{...row,md5:'bad'}]));
 assert.equal(validate([{...row,slug:'cariñosa'}])[0]!.slug,'cariñosa');
});
test('student grade precedes common packs and all other grades',()=>{
 const out=prioritize(manifest.packs,5);const own=out.filter(p=>p.cell.startsWith('g5-'));
 assert.deepEqual(out.slice(0,own.length),own);assert.equal(out[own.length]!.cell,'common');
 assert.equal(new Set(out.map(p=>p.filename)).size,manifest.packs.length);
});

test('automatic selection covers every grade image and excludes other single-grade packs',()=>{
 const bySlug=new Map<string,string>();
 for(const pack of manifest.packs){
  const bytes=fs.readFileSync(path.join(root,'build/image-packs',pack.filename));
  const size=headerLength(bytes.subarray(0,12));
  for(const row of parseEntries(bytes.subarray(12,12+size),pack)) bySlug.set(row.slug,pack.id);
 }
 const tags=JSON.parse(fs.readFileSync(path.join(root,'src/generated/curriculumTags.generated.json'),'utf8'));
 const cards=JSON.parse(fs.readFileSync(path.join(root,'src/generated/cardsIndex.generated.json'),'utf8')).cards;
 assert.ok(requiredPacks(manifest.packs,null).every(p=>p.cell==='common'));
 for(let grade=3;grade<=10;grade++){
  const packs=requiredPacks(manifest.packs,grade);
  const ids=new Set(packs.map(p=>p.id));
  assert.ok(packs.every(p=>p.cell==='common'||p.cell.startsWith(`g${grade}-`)));
  for(const card of cards){
   const suffix=card.factId.match(/-g(\d+)$/)?.[1];
   const authored=suffix && (Number(suffix)<=10 ? Number(suffix)===grade : suffix.includes(String(grade)));
   const tag=tags[card.id];
   const tagged=tag && (tag[1]===grade || tag[4]?.some((cell:number[])=>cell[0]===grade));
   if((!authored&&!tagged)||!bySlug.has(card.slug))continue;
   assert.ok(ids.has(bySlug.get(card.slug)!),`${card.factId}: missing ${card.slug}`);
  }
 }
});

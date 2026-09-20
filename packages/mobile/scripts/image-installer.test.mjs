import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';import { createRequire } from 'node:module';import { build } from 'esbuild';
const require=createRequire(import.meta.url);const mobile=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const full=JSON.parse(fs.readFileSync(path.join(mobile,'src/generated/imagePacks.generated.json')));
const packs=full.packs.filter(p=>p.cell==='common').slice(0,2);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await wait(10);}throw Error('timeout');}
test('installer recovers failed writes, relaunches offline, repairs missing files, and resumes after backgrounding',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hiraia-image-test-'));const prefs=new Map();let seq=0, transfers=0, fail=true, writes=0, corrupt=false;const sources=new Map();
 const listeners=new Set();const app={currentState:'active',addEventListener:(_,f)=>{listeners.add(f);return {remove:()=>listeners.delete(f)}}};
 const emit=s=>{app.currentState=s;for(const f of listeners)f(s)};
 const location=(...parts)=>path.join(...parts.map(p=>(typeof p==='string'?p:p.uri).replace('file://','')));
 class Directory{constructor(...a){this.path=location(...a)}get uri(){return 'file://'+this.path}get exists(){return fs.existsSync(this.path)}create(){fs.mkdirSync(this.path,{recursive:true})}delete(){fs.rmSync(this.path,{recursive:true,force:true})}move(d){fs.renameSync(this.path,d.path);this.path=d.path}}
 class File{constructor(...a){this.path=location(...a)}get uri(){return 'file://'+this.path}get exists(){return fs.existsSync(this.path)}get size(){return fs.statSync(this.path).size}create(){fs.writeFileSync(this.path,'')}write(b){if(fail && this.path.endsWith('.png') && ++writes===2)throw Error('disk full');fs.writeFileSync(this.path,b)}delete(){fs.unlinkSync(this.path)}async text(){return fs.readFileSync(this.path,'utf8')}open(){const fd=fs.openSync(this.path,'r');let offset=0;return {readBytes(n){const b=Buffer.alloc(n);const read=fs.readSync(fd,b,0,n,offset);offset+=read;return b.subarray(0,read)},close(){fs.closeSync(fd)}}}}
 const registry=new Map();
 globalThis.__imageTest={fs:{Directory,File,Paths:{document:'file://'+dir,availableDiskSpace:1e9}},legacy:{getInfoAsync:async uri=>({exists:true,md5:crypto.createHash('md5').update(fs.readFileSync(uri.replace('file://',''))).digest('hex')})},app,
  storage:{getItem:async k=>prefs.get(k)??null,setItem:async(k,v)=>{prefs.set(k,v)}},manifest:{...full,packs},
  presence:{hydrateDownloadedArt:rows=>{registry.clear();for(const [k,v] of rows)registry.set(k,v)},markArtDownloadedMany:rows=>{for(const [k,v] of rows)registry.set(k,v)}},
  engine:{getState:()=>({grade:3,bootstrapped:true,onboardingActive:false}),subscribe:()=>()=>{}},download:async(spec,progress,signal)=>{
   transfers++;await wait(30);if(signal.aborted)throw Error('cancelled');
   const dest=path.join(dir,'models',spec.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(sources.get(spec.filename)??path.join(mobile,'build/image-packs',spec.filename),dest);if(corrupt){const fd=fs.openSync(dest,'r+');fs.writeSync(fd,Buffer.from([0]),0,1,12);fs.closeSync(fd)}progress(100);return dest;
  }};
 const mocks={'expo-application':'export const nativeBuildVersion="16"', 'expo-file-system':'export const {Directory,File,Paths}=globalThis.__imageTest.fs',
  'expo-file-system/legacy':'export const {getInfoAsync}=globalThis.__imageTest.legacy',
  'react-native':'export const AppState=globalThis.__imageTest.app',
  '@react-native-async-storage/async-storage':'export default globalThis.__imageTest.storage',
  '../generated/imagePacks.generated.json':'export default globalThis.__imageTest.manifest',
  '../engine/modelDownload':'export const ensureRemoteAsset=globalThis.__imageTest.download',
  '../data/artPresence':'export const {hydrateDownloadedArt,markArtDownloadedMany}=globalThis.__imageTest.presence',
  '../store/engineStore':'export const useEngineStore=globalThis.__imageTest.engine'};
 async function load(){const out=path.join(dir,'test-'+seq+++'.cjs');await build({entryPoints:[path.join(mobile,'src/images/installer.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',plugins:[{name:'native-test',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}))}}]});return require(out)}
 let stop=()=>{};
 try{
  let x=await load();await x.initializeImages();assert.equal(transfers,0);stop=x.startImageDownloads();await until(()=>x.imageDownloadStatus().error);
  assert.equal(x.imageDownloadStatus().completed,0);assert.equal(registry.size,0);assert(!fs.existsSync(path.join(dir,'image-packs',packs[0].md5,'installed.json')));
  await x.setImageDownloadsEnabled(false);stop();fail=false;
  fs.mkdirSync(path.join(dir,'image-packs',packs[0].md5+'.staging'),{recursive:true});
  fs.writeFileSync(path.join(dir,'image-packs',packs[0].md5+'.staging','0.png'),'partial');
  corrupt=true;x=await load();await x.initializeImages();assert(!fs.existsSync(path.join(dir,'image-packs',packs[0].md5+'.staging')));
  stop=x.startImageDownloads();await x.setImageDownloadsEnabled(true);await until(()=>x.imageDownloadStatus().error);
  assert.equal(x.imageDownloadStatus().completed,0);assert.equal(registry.size,0);assert(!fs.existsSync(path.join(dir,'models',packs[0].filename)));
  await x.setImageDownloadsEnabled(false);stop();corrupt=false;
  x=await load();await x.initializeImages();stop=x.startImageDownloads();await x.setImageDownloadsEnabled(true);await until(()=>x.imageDownloadStatus().phase==='complete');assert.equal(registry.size,packs.reduce((n,p)=>n+p.images,0));stop();
  const before=transfers;x=await load();registry.clear();await x.initializeImages();assert.equal(x.imageDownloadStatus().completed,2);assert.equal(transfers,before);assert(registry.size>0);
  fs.unlinkSync(path.join(dir,'image-packs',packs[0].md5,'0.png'));x=await load();await x.initializeImages();assert.equal(x.imageDownloadStatus().completed,1);assert.equal(registry.size,packs[1].images);
  stop=x.startImageDownloads();await until(()=>transfers===before+1);emit('background');await until(()=>x.imageDownloadStatus().phase==='paused');emit('active');await until(()=>x.imageDownloadStatus().phase==='complete');assert.equal(x.imageDownloadStatus().completed,2);assert.equal(transfers,before+2);stop();
  // Publish a replacement with the same slugs and changed bytes. An interrupted update
  // must continue serving the prior pack, even after a cold/offline relaunch.
  const bytes=fs.readFileSync(path.join(mobile,'build/image-packs',packs[0].filename));bytes[bytes.length-1]^=1;
  const hash=crypto.createHash('md5').update(bytes).digest('hex');
  const replacement={...packs[0],md5:hash,filename:packs[0].id+'-'+hash+'.hpak'};
  const source=path.join(dir,replacement.filename);fs.writeFileSync(source,bytes);sources.set(replacement.filename,source);
  const catalog={format:1,revision:2,minAppVersionCode:16,maxAppVersionCode:16,imageBaseline:full.version,models:[],imagePacks:[replacement]};
  const oldRegistry=new Map(registry);fail=true;writes=0;
  stop=x.startImageDownloads();await x.acceptImageUpdates(catalog);await until(()=>x.imageDownloadStatus().error);
  assert.deepEqual(registry,oldRegistry);await x.setImageDownloadsEnabled(false);stop();
  x=await load();await x.initializeImages();assert.deepEqual(registry,oldRegistry);
  fail=false;stop=x.startImageDownloads();await x.setImageDownloadsEnabled(true);await until(()=>x.imageDownloadStatus().phase==='complete');stop();
  const newRegistry=new Map(registry);assert.notDeepEqual(newRegistry,oldRegistry);assert.equal(newRegistry.size,oldRegistry.size);
  const finalTransfers=transfers;x=await load();await x.initializeImages();assert.deepEqual(registry,newRegistry);assert.equal(transfers,finalTransfers);
 }finally{stop();delete globalThis.__imageTest;fs.rmSync(dir,{recursive:true,force:true})}
});

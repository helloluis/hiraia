import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';import { createRequire } from 'node:module';import { build } from 'esbuild';
const require=createRequire(import.meta.url);const mobile=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const full=JSON.parse(fs.readFileSync(path.join(mobile,'src/generated/imagePacks.generated.json')));
const packs=full.packs.filter(p=>p.cell==='common').slice(0,2);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await wait(10);}throw Error('timeout');}
// Shared native doubles. Each test installs its own globalThis.__imageTest before loading a fresh bundle.
const location=(...parts)=>path.join(...parts.map(p=>(typeof p==='string'?p:p.uri).replace('file://','')));
class Directory{constructor(...a){this.path=location(...a)}get uri(){return 'file://'+this.path}get exists(){return fs.existsSync(this.path)}create(){fs.mkdirSync(this.path,{recursive:true})}delete(){fs.rmSync(this.path,{recursive:true,force:true})}move(d){fs.renameSync(this.path,d.path);this.path=d.path}}
class File{constructor(...a){this.path=location(...a)}get uri(){return 'file://'+this.path}get exists(){return fs.existsSync(this.path)}get size(){return fs.statSync(this.path).size}create(){fs.writeFileSync(this.path,'')}write(b){globalThis.__imageTest.beforeWrite?.(this.path);fs.writeFileSync(this.path,b)}delete(){fs.unlinkSync(this.path)}async text(){return fs.readFileSync(this.path,'utf8')}open(){const fd=fs.openSync(this.path,'r');let offset=0;return {readBytes(n){const b=Buffer.alloc(n);const read=fs.readSync(fd,b,0,n,offset);offset+=read;return b.subarray(0,read)},close(){fs.closeSync(fd)}}}}
const md5Of=uri=>crypto.createHash('md5').update(fs.readFileSync(uri.replace('file://',''))).digest('hex');
const mocks={'expo-application':'export const nativeBuildVersion="16"', 'expo-file-system':'export const {Directory,File,Paths}=globalThis.__imageTest.fs',
 'expo-file-system/legacy':'export const {getInfoAsync}=globalThis.__imageTest.legacy',
 'react-native':'export const AppState=globalThis.__imageTest.app',
 '@react-native-async-storage/async-storage':'export default globalThis.__imageTest.storage',
 '../generated/imagePacks.generated.json':'export default globalThis.__imageTest.manifest',
 '../engine/modelDownload':'export const ensureRemoteAsset=globalThis.__imageTest.download',
 '../data/artPresence':'export const {hydrateDownloadedArt,markArtDownloadedMany}=globalThis.__imageTest.presence',
 '../net/connectivity':'export const subscribeInternetRestored=f=>globalThis.__imageTest.net.subscribe(f)',
 '../store/engineStore':'export const useEngineStore=globalThis.__imageTest.engine'};
let seq=0;
async function bundle(dir){const out=path.join(dir,'test-'+seq+++'.cjs');await build({entryPoints:[path.join(mobile,'src/images/installer.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',plugins:[{name:'native-test',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}))}}]});return require(out)}
function appState(){const listeners=new Set();const app={currentState:'active',addEventListener:(_,f)=>{listeners.add(f);return {remove:()=>listeners.delete(f)}}};return {app,emit:s=>{app.currentState=s;for(const f of listeners)f(s)}}}
function network(){const listeners=new Set();return {listeners,subscribe:f=>{listeners.add(f);return ()=>listeners.delete(f)},restore:()=>{for(const f of listeners)f()}}}
test('installer recovers failed writes, relaunches offline, repairs missing files, and resumes after backgrounding',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hiraia-image-test-'));const prefs=new Map();let transfers=0, fail=true, writes=0, corrupt=false;const sources=new Map();
 const {app,emit}=appState();
 const registry=new Map();
 globalThis.__imageTest={fs:{Directory,File,Paths:{document:'file://'+dir,availableDiskSpace:1e9}},legacy:{getInfoAsync:async uri=>({exists:true,md5:md5Of(uri)})},app,net:network(),
  beforeWrite:p=>{if(fail && p.endsWith('.png') && ++writes===2)throw Error('disk full')},
  storage:{getItem:async k=>prefs.get(k)??null,setItem:async(k,v)=>{prefs.set(k,v)}},manifest:{...full,packs},
  presence:{hydrateDownloadedArt:rows=>{registry.clear();for(const [k,v] of rows)registry.set(k,v)},markArtDownloadedMany:rows=>{for(const [k,v] of rows)registry.set(k,v)}},
  engine:{getState:()=>({grade:3,bootstrapped:true,onboardingActive:false}),subscribe:()=>()=>{}},download:async(spec,progress,signal)=>{
   transfers++;await wait(30);if(signal.aborted)throw Error('cancelled');
   const dest=path.join(dir,'models',spec.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(sources.get(spec.filename)??path.join(mobile,'build/image-packs',spec.filename),dest);if(corrupt){const fd=fs.openSync(dest,'r+');fs.writeSync(fd,Buffer.from([0]),0,1,12);fs.closeSync(fd)}progress(100);return dest;
  }};
 const load=()=>bundle(dir);
 let stop=()=>{};
 try{
  // The first pack's write fails; the second still installs behind it and nothing half-written is promoted.
  let x=await load();await x.initializeImages();assert.equal(transfers,0);stop=x.startImageDownloads();await until(()=>x.imageDownloadStatus().error);
  assert.equal(x.imageDownloadStatus().completed,1);assert.equal(registry.size,packs[1].images);assert(!fs.existsSync(path.join(dir,'image-packs',packs[0].md5,'installed.json')));
  assert(!fs.existsSync(path.join(dir,'image-packs',packs[0].md5+'.staging')));assert(fs.existsSync(path.join(dir,'image-packs',packs[1].md5,'installed.json')));
  await x.setImageDownloadsEnabled(false);stop();fail=false;
  fs.mkdirSync(path.join(dir,'image-packs',packs[0].md5+'.staging'),{recursive:true});
  fs.writeFileSync(path.join(dir,'image-packs',packs[0].md5+'.staging','0.png'),'partial');
  corrupt=true;x=await load();await x.initializeImages();assert(!fs.existsSync(path.join(dir,'image-packs',packs[0].md5+'.staging')));
  stop=x.startImageDownloads();await x.setImageDownloadsEnabled(true);await until(()=>x.imageDownloadStatus().error);
  assert.equal(x.imageDownloadStatus().completed,1);assert.equal(registry.size,packs[1].images);assert(!fs.existsSync(path.join(dir,'models',packs[0].filename)));
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
test('a failing pack rests the pump then steps aside, backs off to 30 min, parks integrity failures, and wakes on a restored network',async()=>{
 const trio=full.packs.filter(p=>p.cell==='common').slice(0,3);const [missing,poisoned,good]=trio;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hiraia-image-test-'));const prefs=new Map();const {app,emit}=appState();const net=network();
 const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout,realNow=Date.now;let clock=0;const timers=new Map();
 const only=()=>{assert.equal(timers.size,1);return [...timers.keys()][0]};
 const fire=()=>{const id=only();clock+=id.ms;const fn=timers.get(id);timers.delete(id);fn()};
 // Transfer outcomes by pack: a 404 exhausts ensureRemoteAsset's attempts; a pinned-MD5 mismatch arrives flagged fatal.
 const outcome=new Map([[missing.filename,'404'],[poisoned.filename,'fatal']]);const transfers=new Map();
 const count=p=>transfers.get(p.filename)??0;
 globalThis.__imageTest={fs:{Directory,File,Paths:{document:'file://'+dir,availableDiskSpace:1e9}},legacy:{getInfoAsync:async uri=>({exists:true,md5:md5Of(uri)})},app,net,
  storage:{getItem:async k=>prefs.get(k)??null,setItem:async(k,v)=>{prefs.set(k,v)}},manifest:{...full,packs:trio},
  presence:{hydrateDownloadedArt:()=>{},markArtDownloadedMany:()=>{}},
  engine:{getState:()=>({grade:3,bootstrapped:true,onboardingActive:false}),subscribe:()=>()=>{}},download:async(spec,progress,signal)=>{
   transfers.set(spec.filename,(transfers.get(spec.filename)??0)+1);
   await wait(5);if(signal.aborted)throw Error('cancelled');
   if(outcome.get(spec.filename)==='404')throw Error(spec.label+': download failed after 5 attempts (HTTP 404)');
   if(outcome.get(spec.filename)==='fatal')throw Object.assign(Error(spec.label+': MD5 mismatch'),{fatal:true});
   const dest=path.join(dir,'models',spec.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(mobile,'build/image-packs',spec.filename),dest);progress(100);return dest;
  }};
 let stop=()=>{};
 try{
  // Both launches are bundled up front so the fake clock below only ever sees the installer's timers.
  let x=await bundle(dir);const relaunch=await bundle(dir);
  // Wake-up timers (>= 1 s) are captured and fired by hand against a shifted clock; yields stay real.
  globalThis.setTimeout=(fn,ms,...a)=>{if(ms<1000)return realSetTimeout(fn,ms,...a);const id={ms};timers.set(id,fn);return id};
  globalThis.clearTimeout=id=>{if(!timers.delete(id))realClearTimeout(id)};Date.now=()=>realNow()+clock;
  await x.initializeImages();stop=x.startImageDownloads();
  // A failed download rests the pump for 60 s instead of moving straight on to the next pack.
  await until(()=>x.imageDownloadStatus().error);assert.equal(x.imageDownloadStatus().phase,'paused');
  assert.deepEqual(trio.map(count),[1,0,0]);let delay=only().ms;assert(delay>55_000 && delay<=60_000,String(delay));
  // After the rest the packs that have not failed go first, so the one behind the failure installs;
  // the 404 pack then fails again (its own ladder is at 120 s) and the parked pack is never retried.
  fire();await until(()=>count(missing)===2 && timers.size===1 && x.imageDownloadStatus().error);
  assert.deepEqual(trio.map(count),[2,1,1]);assert.equal(x.imageDownloadStatus().completed,1);
  assert(fs.existsSync(path.join(dir,'image-packs',good.md5,'installed.json')));
  delay=only().ms;assert(delay>115_000 && delay<=120_000,String(delay));
  // Only the 404 pack is retried on the timer, doubling to a 30 min ceiling.
  for(const expected of [240_000,480_000,960_000,1_800_000,1_800_000]){
   const tries=count(missing);fire();await until(()=>count(missing)===tries+1 && timers.size===1 && x.imageDownloadStatus().error);
   delay=only().ms;assert(delay>expected-5_000 && delay<=expected,`${delay} vs ${expected}`);
  }
  assert.equal(count(poisoned),1);assert.equal(count(good),1);
  // A restored network makes the backed-off pack due at once, without waiting out 30 min; still not the parked one.
  let tries=count(missing);net.restore();await until(()=>count(missing)===tries+1 && timers.size===1 && x.imageDownloadStatus().error);
  assert.equal(count(poisoned),1);
  // Paused downloads and a backgrounded app both ignore the network; foreground then resumes.
  tries=count(missing);await x.setImageDownloadsEnabled(false);assert.equal(timers.size,0);net.restore();await wait(50);assert.equal(count(missing),tries);
  await x.setImageDownloadsEnabled(true);await until(()=>count(missing)===tries+1 && timers.size===1);
  tries=count(missing);emit('background');net.restore();await wait(50);assert.equal(count(missing),tries);
  emit('active');await until(()=>count(missing)===tries+1 && timers.size===1 && x.imageDownloadStatus().error);
  // Once the file is published, the next restore installs it. Only the parked pack remains: no timer at all.
  outcome.delete(missing.filename);net.restore();await until(()=>x.imageDownloadStatus().completed===2 && x.imageDownloadStatus().error);
  assert.equal(timers.size,0);assert.equal(count(poisoned),1);
  // The same catalog re-offered by every manifest check leaves it parked; a changed catalog releases it.
  const catalog=revision=>({format:1,revision,minAppVersionCode:16,maxAppVersionCode:16,imageBaseline:full.version,models:[],imagePacks:[]});
  await x.acceptImageUpdates(catalog(2));await until(()=>count(poisoned)===2 && x.imageDownloadStatus().error);
  await x.acceptImageUpdates(catalog(2));await wait(50);assert.equal(count(poisoned),2);
  await x.acceptImageUpdates(catalog(3));await until(()=>count(poisoned)===3 && x.imageDownloadStatus().error);assert.equal(timers.size,0);
  // A relaunch also gives it a fresh start, and it installs once the content is right.
  stop();assert.equal(net.listeners.size,0);outcome.delete(poisoned.filename);
  x=relaunch;await x.initializeImages();assert.equal(x.imageDownloadStatus().completed,2);
  stop=x.startImageDownloads();await until(()=>x.imageDownloadStatus().phase==='complete');
  assert.equal(x.imageDownloadStatus().completed,3);assert.equal(count(poisoned),4);assert.equal(timers.size,0);
 }finally{stop();globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;Date.now=realNow;delete globalThis.__imageTest;fs.rmSync(dir,{recursive:true,force:true})}
});

test('an outage costs one pack per rest, 60 s doubling to 30 min, and a restored network ends the rest',async()=>{
 const four=full.packs.filter(p=>p.cell==='common').slice(0,4);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hiraia-image-test-'));const prefs=new Map();const {app}=appState();const net=network();
 const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout,realNow=Date.now;let clock=0;const timers=new Map();
 const only=()=>{assert.equal(timers.size,1);return [...timers.keys()][0]};
 const fire=()=>{const id=only();clock+=id.ms;const fn=timers.get(id);timers.delete(id);fn()};
 let offline=true,transfers=0;const tried=[];
 globalThis.__imageTest={fs:{Directory,File,Paths:{document:'file://'+dir,availableDiskSpace:1e9}},legacy:{getInfoAsync:async uri=>({exists:true,md5:md5Of(uri)})},app,net,
  storage:{getItem:async k=>prefs.get(k)??null,setItem:async(k,v)=>{prefs.set(k,v)}},manifest:{...full,packs:four},
  presence:{hydrateDownloadedArt:()=>{},markArtDownloadedMany:()=>{}},
  engine:{getState:()=>({grade:3,bootstrapped:true,onboardingActive:false}),subscribe:()=>()=>{}},download:async(spec,progress,signal)=>{
   transfers++;tried.push(spec.filename);await wait(5);if(signal.aborted)throw Error('cancelled');
   // What ensureRemoteAsset throws once its own attempts are spent with no network.
   if(offline)throw Error(spec.label+': download failed after 5 attempts (Unable to resolve host "assets.hiraia.org")');
   const dest=path.join(dir,'models',spec.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(mobile,'build/image-packs',spec.filename),dest);progress(100);return dest;
  }};
 let stop=()=>{};
 try{
  const x=await bundle(dir);
  globalThis.setTimeout=(fn,ms,...a)=>{if(ms<1000)return realSetTimeout(fn,ms,...a);const id={ms};timers.set(id,fn);return id};
  globalThis.clearTimeout=id=>{if(!timers.delete(id))realClearTimeout(id)};Date.now=()=>realNow()+clock;
  await x.initializeImages();stop=x.startImageDownloads();
  // One failed download, then a rest: not every pack in turn.
  await until(()=>x.imageDownloadStatus().error && timers.size===1);await wait(30);assert.equal(transfers,1);
  let delay=only().ms;assert(delay>55_000 && delay<=60_000,String(delay));
  // Each rest ends in exactly one more attempt, on a pack not yet tried while any remain, and the rest doubles.
  for(const expected of [120_000,240_000,480_000,960_000,1_800_000,1_800_000]){
   const before=transfers;fire();await until(()=>transfers===before+1 && timers.size===1 && x.imageDownloadStatus().error);await wait(30);
   assert.equal(transfers,before+1);delay=only().ms;assert(delay>expected-5_000 && delay<=expected,`${delay} vs ${expected}`);
  }
  assert.deepEqual(tried.slice(0,4),four.map(p=>p.filename));
  // A restored network ends a 30 min rest at once; still offline, the ladder starts again at 60 s.
  let before=transfers;net.restore();await until(()=>transfers===before+1 && timers.size===1 && x.imageDownloadStatus().error);await wait(30);
  assert.equal(transfers,before+1);delay=only().ms;assert(delay>55_000 && delay<=60_000,String(delay));
  // Online, one restore installs every pack in a single run and leaves no timer.
  offline=false;net.restore();await until(()=>x.imageDownloadStatus().phase==='complete');
  assert.equal(x.imageDownloadStatus().completed,4);assert.equal(timers.size,0);
 }finally{stop();globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;Date.now=realNow;delete globalThis.__imageTest;fs.rmSync(dir,{recursive:true,force:true})}
});

test('a pack that installs restarts the rest ladder',async()=>{
 const [first,second,third]=full.packs.filter(p=>p.cell==='common').slice(0,3);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hiraia-image-test-'));const prefs=new Map();const {app}=appState();const net=network();
 const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout,realNow=Date.now;let clock=0;const timers=new Map();
 const only=()=>{assert.equal(timers.size,1);return [...timers.keys()][0]};
 const fire=()=>{const id=only();clock+=id.ms;const fn=timers.get(id);timers.delete(id);fn()};
 // The first and third packs fail their first download only; the second always succeeds.
 const failOnce=new Set([first.filename,third.filename]);const transfers=new Map();const count=p=>transfers.get(p.filename)??0;
 globalThis.__imageTest={fs:{Directory,File,Paths:{document:'file://'+dir,availableDiskSpace:1e9}},legacy:{getInfoAsync:async uri=>({exists:true,md5:md5Of(uri)})},app,net,
  storage:{getItem:async k=>prefs.get(k)??null,setItem:async(k,v)=>{prefs.set(k,v)}},manifest:{...full,packs:[first,second,third]},
  presence:{hydrateDownloadedArt:()=>{},markArtDownloadedMany:()=>{}},
  engine:{getState:()=>({grade:3,bootstrapped:true,onboardingActive:false}),subscribe:()=>()=>{}},download:async(spec,progress,signal)=>{
   transfers.set(spec.filename,(transfers.get(spec.filename)??0)+1);await wait(5);if(signal.aborted)throw Error('cancelled');
   if(failOnce.delete(spec.filename))throw Error(spec.label+': download failed after 5 attempts (connection reset)');
   const dest=path.join(dir,'models',spec.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(mobile,'build/image-packs',spec.filename),dest);progress(100);return dest;
  }};
 let stop=()=>{};
 try{
  const x=await bundle(dir);
  globalThis.setTimeout=(fn,ms,...a)=>{if(ms<1000)return realSetTimeout(fn,ms,...a);const id={ms};timers.set(id,fn);return id};
  globalThis.clearTimeout=id=>{if(!timers.delete(id))realClearTimeout(id)};Date.now=()=>realNow()+clock;
  await x.initializeImages();stop=x.startImageDownloads();
  await until(()=>x.imageDownloadStatus().error && timers.size===1);assert(only().ms<=60_000);
  // The second pack installs, then the third fails: a fresh failure after a success rests 60 s, not 120 s.
  fire();await until(()=>count(third)===1 && timers.size===1 && x.imageDownloadStatus().error);
  assert.equal(x.imageDownloadStatus().completed,1);const delay=only().ms;assert(delay>55_000 && delay<=60_000,String(delay));
  fire();await until(()=>x.imageDownloadStatus().phase==='complete');assert.equal(x.imageDownloadStatus().completed,3);assert.equal(timers.size,0);
 }finally{stop();globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;Date.now=realNow;delete globalThis.__imageTest;fs.rmSync(dir,{recursive:true,force:true})}
});

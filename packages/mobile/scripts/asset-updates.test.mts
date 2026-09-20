import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeImagePacks, newerModel, parseAssetCatalog} from '../src/updates/catalog';
import images from '../src/generated/imagePacks.generated.json';
const model = {id:'base' as const,revision:2,runtime:'hiraia-2b-qwen35-v1' as const,label:'Tutor v3',notes:'Better explanations',filename:'tutor-v3.gguf',url:'https://assets.hiraia.org/models/tutor-v3.gguf',bytes:1274396160,md5:'a'.repeat(32)};
const catalog = () => ({format:1,revision:2,minAppVersionCode:16,maxAppVersionCode:18,imageBaseline:images.version,models:[model],imagePacks:[images.packs[0]]});
test('catalog only admits data compatible with the installed APK and image baseline',()=>{
  assert.ok(parseAssetCatalog(catalog(),16,images.version));
  assert.equal(parseAssetCatalog(catalog(),15,images.version),null);
  assert.equal(parseAssetCatalog(catalog(),19,images.version),null);
  assert.equal(parseAssetCatalog(catalog(),16,'different-bank'),null);
  for(const m of [{...model,url:'http://bad/model'}, {...model,filename:'../model.gguf'}, {...model,md5:'bad'}, {...model,runtime:'new-tokenizer'}, {...model,bytes:NaN}]) {
    assert.equal(parseAssetCatalog({...catalog(),models:[m]},16,images.version),null);
  }
  assert.equal(parseAssetCatalog({...catalog(),imagePacks:[images.packs[0],images.packs[0]]},16,images.version),null);
  const normalized = parseAssetCatalog({...catalog(),models:[{...model,dir:'/wrong/'}]},16,images.version)!;
  assert.equal('dir' in normalized.models[0]!,false);
});
test('unchanged models, rollbacks and mutable-filename offers never trigger downloads',()=>{
  const baseline={filename:'baseline.gguf',md5:'b'.repeat(32)};
  assert.equal(newerModel(model,null,baseline),model);
  assert.equal(newerModel(model,model,baseline),null);
  assert.equal(newerModel({...model,revision:1},model,baseline),null);
  assert.equal(newerModel({...model,filename:baseline.filename},null,baseline),null);
  assert.equal(newerModel({...model,md5:baseline.md5},null,baseline),null);
});
test('sparse image corrections preserve untouched packs and support bundled-image patches',()=>{
  const replacement={...images.packs[0]!,md5:'a'.repeat(32)};
  const patch={...replacement,id:'patch-illustration-1'};
  const merged=mergeImagePacks(images.packs,[replacement,patch]);
  assert.equal(merged.length,images.packs.length+1);
  assert.equal(merged.find(p=>p.id===replacement.id)?.md5,replacement.md5);
  assert.deepEqual(merged.find(p=>p.id===images.packs[1]!.id),images.packs[1]);
});

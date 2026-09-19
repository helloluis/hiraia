from pathlib import Path
import json,hashlib,boto3
from boto3.s3.transfer import TransferConfig
v={}
for l in Path('/opt/hiraia-r2-rollout/upload.env').read_text().splitlines():
 k,_,x=l.partition('=');v[k]=x
s=boto3.client('s3',endpoint_url=v['R2_ENDPOINT'],aws_access_key_id=v['R2_ACCESS_KEY_ID'],aws_secret_access_key=v['R2_SECRET_ACCESS_KEY'],region_name='auto')
assets={'hiraia-sft-2b-v2.Q4_K_M.gguf':(1274396160,'fe2d0ab2ad856f2a42c5add5872c4234'),'labse.Q4_K_M.gguf':(383762048,'2667f69edfbcb68acf617187fe817fae'),'vectors-labse-af171fe8a9f9.i8.bin':(115842816,'4f80d21b0526db1aeadb7033b5aa8998'),'hiraia.apk':(311192945,None)}
manifest=[]
for name,(size,expected) in assets.items():
 p=Path('/var/www/hiraia-models')/name
 md5=hashlib.md5();sha=hashlib.sha256()
 with p.open('rb') as f:
  while chunk:=f.read(8*1024*1024):md5.update(chunk);sha.update(chunk)
 assert p.stat().st_size==size and (not expected or md5.hexdigest()==expected),name
 key='models/'+name
 print('Uploading',name,size,flush=True)
 s.upload_file(str(p),'hiraia-assets',key,ExtraArgs={'ContentType':'application/vnd.android.package-archive' if name.endswith('.apk') else 'application/octet-stream','CacheControl':'public, max-age=300' if name.endswith('.apk') else 'public, max-age=31536000, immutable','Metadata':{'sha256':sha.hexdigest(),'md5':md5.hexdigest()}},Config=TransferConfig(multipart_threshold=16*1024*1024,multipart_chunksize=16*1024*1024,max_concurrency=3))
 remote=s.get_object(Bucket='hiraia-assets',Key=key);check=hashlib.sha256();n=0
 for chunk in remote['Body'].iter_chunks(8*1024*1024):check.update(chunk);n+=len(chunk)
 assert n==size and check.hexdigest()==sha.hexdigest(),name
 manifest.append({'name':name,'bytes':size,'md5':md5.hexdigest(),'sha256':sha.hexdigest()})
 Path('/opt/hiraia-r2-rollout/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print('Verified full R2 SHA-256:',name,flush=True)

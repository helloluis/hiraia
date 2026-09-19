from pathlib import Path
import json,hashlib,boto3,subprocess,sys
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--env-file',required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[3]
p=root/'packages/mobile/build/image-packs';m=json.loads((p/'manifest.json').read_text())
assert m==json.loads((root/'packages/mobile/src/generated/imagePacks.generated.json').read_text()), 'Build and app manifests differ'
subprocess.run([sys.executable,str(root/'packages/mobile/scripts/audit-image-packs.py'),'--check'],check=True)
v={}
for l in Path(args.env_file).read_text().splitlines():
 k,s,x=l.partition('=')
 if s:v[k.strip()]=x.strip().strip('\"').strip("'")
s=boto3.client('s3',endpoint_url=v['R2_ENDPOINT'],aws_access_key_id=v['R2_ACCESS_KEY_ID'],aws_secret_access_key=v['R2_SECRET_ACCESS_KEY'],region_name='auto')
for i,pack in enumerate(m['packs']):
 f=p/pack['filename'];data=f.read_bytes();assert hashlib.sha256(data).hexdigest()==pack['sha256']
 key='models/images/'+pack['filename']
 try:
  s.head_object(Bucket='hiraia-assets',Key=key)
 except s.exceptions.ClientError as error:
  if error.response['ResponseMetadata']['HTTPStatusCode']!=404:raise
  s.put_object(Bucket='hiraia-assets',Key=key,Body=data,IfNoneMatch='*',ContentType='application/octet-stream',CacheControl='public, max-age=31536000, immutable',Metadata={'sha256':pack['sha256'],'md5':pack['md5']})
 obj=s.get_object(Bucket='hiraia-assets',Key=key)['Body'];digest=hashlib.sha256()
 for chunk in obj.iter_chunks(1024*1024):digest.update(chunk)
 assert digest.hexdigest()==pack['sha256']
 print('Uploaded + verified',i+1,'/',len(m['packs']),pack['id'],flush=True)
s.put_object(Bucket='hiraia-assets',Key='models/images/manifest-'+m['version']+'.json',Body=(p/'manifest.json').read_bytes(),ContentType='application/json',CacheControl='public, max-age=31536000, immutable')
print('Published version',m['version'],flush=True)

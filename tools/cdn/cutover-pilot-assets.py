from pathlib import Path
import json,urllib.request as r,hashlib,datetime,subprocess,ipaddress,time
root=Path('/opt/hiraia-r2-rollout');manifest=json.loads((root/'manifest.json').read_text())
assert len(manifest)==4
for item in manifest:
 url='https://assets.hiraia.org/models/'+item['name']
 with r.urlopen(r.Request(url,method='HEAD'),timeout=25) as res:
  assert res.status==200 and int(res.headers['Content-Length'])==item['bytes'],item['name']
 with r.urlopen(r.Request(url,headers={'Range':'bytes=1024-2047'}),timeout=25) as res:
  assert res.status==206 and res.headers['Content-Range']==f"bytes 1024-2047/{item['bytes']}"
  chunk=res.read(1025)
 with (Path('/var/www/hiraia-models')/item['name']).open('rb') as f:
  f.seek(1024);assert chunk==f.read(1024)
 print('Public HTTPS range verified:',item['name'],flush=True)
backup=root/('nginx-before-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir(mode=0o700)
expected={'hiraia.org':'604077f84877c377d37fee0a518212d8115c58841730797b59262de03218c501','hiraia.b11.dev':'01ccecb65761223ed3fdf6890277ebc165aa3aec7d3b87eb00379d12adfdfe1b'}
paths={name:Path('/etc/nginx/sites-enabled')/name for name in expected}
original={name:p.read_bytes() for name,p in paths.items()}
for name,data in original.items():
 assert hashlib.sha256(data).hexdigest()==expected[name],name
 (backup/name).write_bytes(data)
realip=Path('/etc/nginx/conf.d/hiraia-cloudflare-realip.conf');assert not realip.exists()
with r.urlopen('https://api.cloudflare.com/client/v4/ips',timeout=20) as res:
 data=json.load(res)
assert data['success']
nets=[str(ipaddress.ip_network(x)) for x in data['result']['ipv4_cidrs']+data['result']['ipv6_cidrs']]
assert len(nets)>=15
block='\n'.join('    location = /models/'+x['name']+' {\n        add_header Cache-Control "no-store" always;\n        return 307 https://assets.hiraia.org/models/'+x['name']+';\n    }\n' for x in manifest)+'\n'
try:
 for name,p in paths.items():
  s=original[name].decode();assert s.count('    location /models/ {')==1
  p.write_text(s.replace('    location /models/ {',block+'    location /models/ {'))
 realip.write_text('# Trust visitor identity only from official Cloudflare proxy networks.\n'+'\n'.join('set_real_ip_from '+n+';' for n in nets)+'\nreal_ip_header CF-Connecting-IP;\nreal_ip_recursive on;\n')
 subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
 time.sleep(2) # nginx reload acknowledges before new workers accept connections
 for host in ('hiraia.org','hiraia.b11.dev'):
  for item in manifest:
   with r.urlopen(r.Request('https://'+host+'/models/'+item['name'],headers={'Range':'bytes=1024-2047'}),timeout=25) as res:
    assert res.status==206 and res.url.startswith('https://assets.hiraia.org/') and len(res.read(1025))==1024, (host,item['name'],res.status,res.url,res.headers.get('CF-Cache-Status'))
  print('Existing URL redirects + range verified:',host,flush=True)
except BaseException:
 for name,p in paths.items():p.write_bytes(original[name])
 realip.unlink(missing_ok=True)
 subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
 raise
print('Cutover successful; rollback directory:',backup)

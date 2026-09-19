#!/usr/bin/env python3
"""Local preview with visibly labeled synthetic data; never used by production admin."""
import json
import os
from pathlib import Path
import random
import sqlite3
import sys
import tempfile
import time
from http.server import ThreadingHTTPServer
from datetime import timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'deploy/vps-monitor'))
import pilot_dashboard as p
import admin_app
import ga_reporting
import neon_mirror

scratch=tempfile.TemporaryDirectory(prefix='hiraia-dashboard-preview-')
root=Path(scratch.name)
os.environ['HIRAIA_TELEMETRY_DB_PATH']=str(root/'telemetry.db')
os.environ['HIRAIA_DB_PATH']=str(root/'web.db')
now=int(time.time()*1000);rng=random.Random(53)
with sqlite3.connect(root/'telemetry.db') as db:
    db.execute('CREATE TABLE telemetry_events(installation_id TEXT,id TEXT,name TEXT,occurred_at INTEGER,received_at INTEGER,session_id TEXT,props TEXT,PRIMARY KEY(installation_id,id))')
    n=0
    for day in range(180):
        for i in range(rng.randint(2,8)):
            installation=f'preview_install_{rng.randint(1,76):08}'
            session=f'preview_session_{day:05}_{i:06}'
            started=now-day*p.DAY-rng.randint(0,7200)*1000
            profile={'profile_kind':'student','profile_id':f'preview_profile_{rng.randint(1,3):08}', 'grade':rng.choice([4,5,5,5,6,7]),'language':rng.choice(['english','tagalog','tagalog','cebuano']),
                     'app_version':'0.1.0','build':'pilot-20260905','android':rng.choice(['29','30','33','34']),'ram_gb':rng.choice([3,4,6]),'abi':'arm64-v8a'}
            events=[('session_started',{}),('profile_updated',{})]+[('card_viewed',{'source':rng.choice(['curated','curated','generated'])}) for _ in range(rng.randint(5,24))]+[('quiz_graded',{'correct':rng.random()<.73}) for _ in range(rng.randint(1,5))]
            if i==0:events += [('download_started',{'asset':'hiraia-2b.gguf','asset_kind':'model'}),('download_installed',{'asset':'hiraia-2b.gguf','asset_kind':'model','duration_ms':53200})]
            if i==2:events += [('generation_failed',{'error':'runtime','model':'hiraia-2b'})]
            for j,(name,extra) in enumerate(events):
                n+=1;occurred=started+j*5000
                received=occurred+(2*p.DAY if day>2 and i==1 else 3000)
                db.execute('INSERT INTO telemetry_events VALUES(?,?,?,?,?,?,?)',(installation,f'preview_event_{n:012}',name,occurred,received,session,json.dumps({**profile,**extra})))
with sqlite3.connect(root/'web.db') as db:
    db.execute('CREATE TABLE apk_download_hits(day TEXT,ip_hash TEXT,country TEXT,PRIMARY KEY(day,ip_hash))')
    for day in range(180):
        date=time.strftime('%Y-%m-%d',time.gmtime((now-day*p.DAY)/1000))
        for i in range(rng.randint(3,22)):db.execute('INSERT INTO apk_download_hits VALUES(?,?,?)',(date,f'preview_{day}_{i}','PH'))

def website(period='2W'):
    start,end=p.window(period);pts=[];cursor=start
    while cursor<end:
        pts.append({'day':cursor.date().isoformat(),'end':cursor.date().isoformat(),'value':20+cursor.day*3,'segments':{}});cursor+=timedelta(days=1)
    return {'available':True,'range':period,'start':start.date().isoformat(),'end':(end-timedelta(days=1)).date().isoformat(),'total':sum(r['value'] for r in pts),'points':pts,'legend':[],'interval':'day','timezone':'Asia/Manila','updated_at':now,'devices':[{'deviceCategory':'mobile','sessions':864},{'deviceCategory':'desktop','sessions':138},{'deviceCategory':'tablet','sessions':42}],'locations':[{'country':'Philippines','region':'Metro Manila','sessions':420},{'country':'Philippines','region':'Central Visayas','sessions':180},{'country':'Philippines','region':'Davao Region','sessions':142}]}
ga_reporting.report=website
neon_mirror.status=lambda:{'state':'synced','last_success':now}
class Preview(admin_app.Handler):
    def _session_ok(self):return True
    def _csrf(self):return 'synthetic-preview-only'
    def _send(self,code,body,ctype='text/html; charset=utf-8',extra=None):
        if 'text/html' in ctype and isinstance(body,str):body=body.replace('<body>','<body><div style="background:#d8a03a;color:#1c3b2e;text-align:center;font:12px system-ui;padding:7px">LOCAL PREVIEW · SYNTHETIC DATA · NOT PILOT RESULTS</div>',1)
        return super()._send(code,body,ctype,extra)
    def do_POST(self):return self._send(405,'Preview is read-only','text/plain')
    def log_message(self,*args):pass
print('Synthetic dashboard preview: http://127.0.0.1:8138/admin',flush=True)
try:ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('PREVIEW_PORT','8138'))),Preview).serve_forever()
finally:scratch.cleanup()

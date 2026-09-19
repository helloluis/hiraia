#!/usr/bin/env python3
"""Explicit remote smoke test; mirrors a synthetic event, restores it, removes only that event."""
import json,os,sqlite3,sys,tempfile,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'deploy/vps-monitor'))
import neon_mirror as m

def main():
    m.load_env(sys.argv[1])
    url=os.environ['HIRAIA_NEON_DATABASE_URL']
    installation='mirror_smoke_'+uuid.uuid4().hex
    event='mirror_smoke_'+uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='hiraia-neon-verify-') as temp:
        path=Path(temp)/'source.db';restored=Path(temp)/'restored.db'
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE telemetry_events(installation_id TEXT,id TEXT,name TEXT,occurred_at INTEGER,received_at INTEGER,session_id TEXT,props TEXT,PRIMARY KEY(installation_id,id))')
            db.execute('INSERT INTO telemetry_events VALUES(?,?,?,?,?,?,?)',(installation,event,'session_started',1800000000000,1800000000000,'mirror_session_'+uuid.uuid4().hex,json.dumps({'build':'synthetic-mirror-verification'})))
        source=None
        try:
            first=m.run_once(str(path),url)
            second=m.run_once(str(path),url,reconcile=True)
            with sqlite3.connect(path) as db:source=m.meta(db,'source_id')
            with m.remote_connect(url) as remote:
                count=remote.execute('SELECT count(*) FROM hiraia_telemetry.events WHERE installation_id=%s AND id=%s',(installation,event)).fetchone()[0]
                assert count==1
            m.restore(url,str(restored))
            with sqlite3.connect(restored) as db:
                row=db.execute('SELECT props FROM telemetry_events WHERE installation_id=? AND id=?',(installation,event)).fetchone()
                assert json.loads(row[0])['build']=='synthetic-mirror-verification'
            print(json.dumps({'verified':True,'first_copy':first['copied'],'replay_count':count,'restore_verified':True}))
        finally:
            with m.remote_connect(url) as remote:
                remote.execute('DELETE FROM hiraia_telemetry.events WHERE installation_id=%s AND id=%s',(installation,event))
                if source:remote.execute('DELETE FROM hiraia_telemetry.mirror_health WHERE source_id=%s',(source,))
            print('Synthetic verification record removed; no pilot records changed.')
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('Verification failed:',type(e).__name__)
        raise SystemExit(1)

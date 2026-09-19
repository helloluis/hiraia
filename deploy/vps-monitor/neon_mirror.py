#!/usr/bin/env python3
"""Append-only SQLite → Neon mirror. Remote commit always precedes local receipt.

No telemetry payload or connection string is logged. Deletions never propagate.
Periodic reconciliation also repairs a remote database restored to an earlier point.
"""
import argparse
from contextlib import closing
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import ssl
import time
from urllib.parse import urlsplit
import uuid

REMOTE_SCHEMA = '''CREATE SCHEMA IF NOT EXISTS hiraia_telemetry;
CREATE TABLE IF NOT EXISTS hiraia_telemetry.events (
 installation_id text NOT NULL,id text NOT NULL,name text NOT NULL,
 occurred_at bigint NOT NULL,received_at bigint NOT NULL,session_id text NOT NULL,
 props jsonb NOT NULL,PRIMARY KEY(installation_id,id));
CREATE INDEX IF NOT EXISTS hiraia_events_time ON hiraia_telemetry.events(occurred_at);
CREATE INDEX IF NOT EXISTS hiraia_events_session ON hiraia_telemetry.events(installation_id,session_id,occurred_at);
CREATE TABLE IF NOT EXISTS hiraia_telemetry.apk_download_hits (
 day date NOT NULL,ip_hash text NOT NULL,country text,PRIMARY KEY(day,ip_hash));
CREATE TABLE IF NOT EXISTS hiraia_telemetry.mirror_health (
 source_id text PRIMARY KEY,last_success timestamptz NOT NULL DEFAULT now(),copied_events bigint NOT NULL DEFAULT 0);
'''
LOCAL_SCHEMA = '''CREATE TABLE IF NOT EXISTS telemetry_mirror_receipts (
 target TEXT NOT NULL,installation_id TEXT NOT NULL,id TEXT NOT NULL,
 PRIMARY KEY(target,installation_id,id));
CREATE TABLE IF NOT EXISTS telemetry_mirror_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telemetry_mirror_apk_receipts (
 target TEXT NOT NULL,day TEXT NOT NULL,ip_hash TEXT NOT NULL,PRIMARY KEY(target,day,ip_hash));'''
EVENT_INSERT = '''INSERT INTO hiraia_telemetry.events
 (installation_id,id,name,occurred_at,received_at,session_id,props)
 VALUES(%s,%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT(installation_id,id) DO NOTHING'''


def load_env(filename):
    if not filename: return
    for line in Path(filename).read_text().splitlines():
        key,sep,value=line.partition('=')
        if sep and key in ('HIRAIA_NEON_DATABASE_URL','HIRAIA_TELEMETRY_DB_PATH','HIRAIA_DB_PATH'):
            os.environ.setdefault(key,value.strip().strip('"').strip("'"))

def target_id(url):
    u=urlsplit(url)
    if u.scheme not in ('postgres','postgresql') or not u.hostname:
        raise ValueError('invalid_mirror_target')
    return hashlib.sha256(f'{u.hostname}:{u.port or 5432}{u.path}'.encode()).hexdigest()[:24]

def remote_connect(url):
    import psycopg
    # A connection pooler is supported; disable automatic prepared statements.
    return psycopg.connect(url,connect_timeout=10,prepare_threshold=None,
                          sslmode='verify-full',sslrootcert=os.environ.get('HIRAIA_NEON_CA_FILE') or ssl.get_default_verify_paths().cafile or 'system',channel_binding='require')

def meta(db,key,value=None):
    if value is not None:
        db.execute('INSERT INTO telemetry_mirror_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,str(value)))
    row=db.execute('SELECT value FROM telemetry_mirror_meta WHERE key=?',(key,)).fetchone()
    return row[0] if row else None

def prepare(db):
    db.execute('PRAGMA busy_timeout=3000')
    db.executescript(LOCAL_SCHEMA)
    if meta(db,'source_id') is None:
        meta(db,'source_id',str(uuid.uuid4()));db.commit()

def mirror_events(local,remote,target,batch=500,max_batches=10,reconcile=False):
    """Injected connections make commit/retry ordering testable without a network."""
    copied=0
    last_rowid=0
    for _ in range(max_batches):
        if reconcile:
            records=local.execute('''SELECT rowid,installation_id,id,name,occurred_at,received_at,session_id,props
              FROM telemetry_events WHERE rowid>? ORDER BY rowid LIMIT ?''',(last_rowid,batch)).fetchall()
        else:
            records=local.execute('''SELECT e.rowid,e.installation_id,e.id,e.name,e.occurred_at,e.received_at,e.session_id,e.props
              FROM telemetry_events e LEFT JOIN telemetry_mirror_receipts r
              ON r.target=? AND r.installation_id=e.installation_id AND r.id=e.id
              WHERE r.id IS NULL ORDER BY e.rowid LIMIT ?''',(target,batch)).fetchall()
        if not records: break
        with remote.transaction():
            with remote.cursor() as cursor:
                cursor.executemany(EVENT_INSERT,[tuple(r[1:]) for r in records])
        # A crash here causes a harmless retry, never a falsely acknowledged mirror.
        with local:
            local.executemany('INSERT OR IGNORE INTO telemetry_mirror_receipts VALUES(?,?,?)',[(target,r[1],r[2]) for r in records])
        last_rowid=records[-1][0]
        copied+=len(records)
    return copied

def mirror_apk(local,remote,target,webfile):
    if not webfile or not Path(webfile).is_file(): return 0
    with closing(sqlite3.connect(Path(webfile).resolve().as_uri()+'?mode=ro',uri=True,timeout=3)) as web:
        if not web.execute("SELECT 1 FROM sqlite_master WHERE name='apk_download_hits'").fetchone(): return 0
        # The website counter is small and immutable; replaying also repairs remote loss.
        count=0
        cursor=web.execute('SELECT day,ip_hash,country FROM apk_download_hits ORDER BY day,ip_hash')
        while True:
            records=cursor.fetchmany(500)
            if not records: break
            with remote.transaction():
                with remote.cursor() as c:
                    c.executemany('INSERT INTO hiraia_telemetry.apk_download_hits VALUES(%s,%s,%s) ON CONFLICT(day,ip_hash) DO NOTHING',records)
            with local:
                local.executemany('INSERT OR IGNORE INTO telemetry_mirror_apk_receipts VALUES(?,?,?)',[(target,r[0],r[1]) for r in records])
            count+=len(records)
        return count

def pending_apk(local,target,webfile):
    if not webfile or not Path(webfile).is_file(): return 0
    local.execute('ATTACH DATABASE ? AS mirror_web',(Path(webfile).resolve().as_uri()+'?mode=ro',))
    try:
        if not local.execute("SELECT 1 FROM mirror_web.sqlite_master WHERE name='apk_download_hits'").fetchone(): return 0
        return local.execute("""SELECT count(*) FROM mirror_web.apk_download_hits e
          LEFT JOIN telemetry_mirror_apk_receipts r ON r.target=? AND r.day=e.day AND r.ip_hash=e.ip_hash
          WHERE r.ip_hash IS NULL""",(target,)).fetchone()[0]
    finally:
        local.execute('DETACH DATABASE mirror_web')

def run_once(filename,url,webfile=None,reconcile=False):
    if not filename or not Path(filename).is_file(): return {'state':'waiting_for_collector','copied':0}
    target=target_id(url)
    # Two timers or a manual backfill cannot overlap on the same source.
    with open(str(filename)+'.mirror.lock','a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: return {'state':'already_running','copied':0}
        with closing(sqlite3.connect(filename,timeout=3)) as local:
            if not local.execute("SELECT 1 FROM sqlite_master WHERE name='telemetry_events'").fetchone():
                return {'state':'waiting_for_collector','copied':0}
            prepare(local)
            try:
                timestamp=int(time.time()*1000)
                reconcile = reconcile or timestamp-int(meta(local,'reconciled_'+target) or 0)>86400000
                pending=local.execute("""SELECT count(*) FROM telemetry_events e LEFT JOIN telemetry_mirror_receipts r
                  ON r.target=? AND r.installation_id=e.installation_id AND r.id=e.id WHERE r.id IS NULL""",(target,)).fetchone()[0]
                apk_waiting=pending_apk(local,target,webfile)
                with local: meta(local,'last_check',timestamp)
                if not reconcile and not pending and not apk_waiting and not meta(local,'last_error'):
                    return {'state':'up_to_date','copied':0,'apk_records':0}
                with remote_connect(url) as remote:
                    remote.autocommit=True
                    remote.execute(REMOTE_SCHEMA)
                    # Each day replay every retained event: receipts aren't proof that a
                    # remote restore/admin deletion hasn't removed previously copied rows.
                    reconcile = reconcile or int(time.time()*1000)-int(meta(local,'reconciled_'+target) or 0)>86400000
                    n=mirror_events(local,remote,target,max_batches=100000 if reconcile else 10,reconcile=reconcile)
                    apk=mirror_apk(local,remote,target,webfile)
                    remote.execute('''INSERT INTO hiraia_telemetry.mirror_health(source_id,copied_events)
                      VALUES(%s,%s) ON CONFLICT(source_id) DO UPDATE SET last_success=now(),copied_events=hiraia_telemetry.mirror_health.copied_events+excluded.copied_events''',(meta(local,'source_id'),n))
                with local:
                    timestamp=int(time.time()*1000)
                    meta(local,'target',target);meta(local,'last_success',timestamp);meta(local,'last_error','')
                    if reconcile: meta(local,'reconciled_'+target,timestamp)
                return {'state':'copied','copied':n,'apk_records':apk}
            except Exception as error:
                with local: meta(local,'last_error',type(error).__name__)
                raise RuntimeError('mirror_failed_retry_pending') from None

def status(filename=None):
    filename=filename or os.environ.get('HIRAIA_TELEMETRY_DB_PATH','')
    if not filename or not Path(filename).is_file(): return {'state':'unconfigured','message':'waiting for collector'}
    try:
        with closing(sqlite3.connect(Path(filename).resolve().as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='telemetry_mirror_meta'").fetchone():
                return {'state':'unconfigured','message':'not configured'}
            target=meta(db,'target')
            if not target: return {'state':'unconfigured','message':'first copy has not succeeded'}
            pending=db.execute('''SELECT count(*) FROM telemetry_events e LEFT JOIN telemetry_mirror_receipts r
              ON r.target=? AND r.installation_id=e.installation_id AND r.id=e.id WHERE r.id IS NULL''',(target,)).fetchone()[0]
            success=int(meta(db,'last_success') or 0)
            stale=time.time()*1000-int(meta(db,'last_check') or success)>300000
            return {'state':'pending' if pending else 'stale' if stale or meta(db,'last_error') else 'synced',
                    'pending':pending,'last_success':success,'message':'copy worker needs attention' if stale else ''}
    except sqlite3.Error:
        return {'state':'unavailable','message':'status unavailable'}

def restore(url,destination,apk_destination=None):
    """Restore into NEW SQLite files; never overwrite an existing local database."""
    paths=[Path(destination)]+([Path(apk_destination)] if apk_destination else [])
    if any(p.exists() for p in paths): raise ValueError('restore_destination_already_exists')
    if len(set(p.resolve() for p in paths))!=len(paths): raise ValueError('restore_destinations_must_differ')
    created=[]
    try:
        for p in paths: p.parent.mkdir(parents=True,exist_ok=True);p.touch(mode=0o600,exist_ok=False);created.append(p)
        with remote_connect(url) as remote, closing(sqlite3.connect(destination)) as db:
            db.execute('''CREATE TABLE telemetry_events(installation_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,
              occurred_at INTEGER NOT NULL,received_at INTEGER NOT NULL,session_id TEXT NOT NULL,props TEXT NOT NULL,PRIMARY KEY(installation_id,id))''')
            # Repeatable-read snapshot: pagination cannot mix points in time.
            remote.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            after=('','');count=0
            while True:
                records=remote.execute('''SELECT installation_id,id,name,occurred_at,received_at,session_id,props::text
                  FROM hiraia_telemetry.events WHERE (installation_id,id)>(%s,%s) ORDER BY installation_id,id LIMIT 1000''',after).fetchall()
                if not records: break
                db.executemany('INSERT INTO telemetry_events VALUES(?,?,?,?,?,?,?)',records)
                count+=len(records);after=records[-1][:2]
            db.commit()
            if apk_destination:
                with closing(sqlite3.connect(apk_destination)) as web:
                    web.execute('CREATE TABLE apk_download_hits(day TEXT NOT NULL,ip_hash TEXT NOT NULL,country TEXT,PRIMARY KEY(day,ip_hash))')
                    c=remote.execute('SELECT day::text,ip_hash,country FROM hiraia_telemetry.apk_download_hits ORDER BY day,ip_hash')
                    while True:
                        batch=c.fetchmany(1000)
                        if not batch: break
                        web.executemany('INSERT INTO apk_download_hits VALUES(?,?,?)',batch)
                    web.commit()
        return {'restored_events':count}
    except Exception:
        for p in created: p.unlink(missing_ok=True)
        raise

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--env-file');p.add_argument('--db');p.add_argument('--reconcile',action='store_true')
    p.add_argument('--restore-to');p.add_argument('--restore-apk-to')
    args=p.parse_args();load_env(args.env_file)
    url=os.environ.get('HIRAIA_NEON_DATABASE_URL','')
    if not url: p.error('configure HIRAIA_NEON_DATABASE_URL in the private environment file')
    try:
        result=restore(url,args.restore_to,args.restore_apk_to) if args.restore_to else run_once(args.db or os.environ.get('HIRAIA_TELEMETRY_DB_PATH'),url,os.environ.get('HIRAIA_DB_PATH'),args.reconcile)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'state':'failed','error_type':type(error).__name__,'retry':'pending; local data retained'}))
        raise SystemExit(1)

if __name__=='__main__': main()

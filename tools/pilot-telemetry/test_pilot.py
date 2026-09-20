import contextlib
from datetime import datetime,timezone
import importlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from email.message import Message

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'deploy/vps-monitor'))
import pilot_dashboard as p
import admin_app
import neon_mirror as mirror
import ga_reporting

@contextlib.contextmanager
def connection(path):
    db=sqlite3.connect(path)
    try:
        with db: yield db
    finally: db.close()

class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.dbpath=Path(self.temp.name)/'events.db'
        self.webpath=Path(self.temp.name)/'web.db'
        self.env=patch.dict(os.environ,{'HIRAIA_TELEMETRY_DB_PATH':str(self.dbpath),'HIRAIA_DB_PATH':str(self.webpath),'HIRAIA_GA4_PROPERTY_ID':''})
        self.env.start();self.addCleanup(self.env.stop)
        self.now=int(datetime(2026,9,5,12,tzinfo=timezone.utc).timestamp()*1000)
        with connection(self.dbpath) as db:
            db.execute('CREATE TABLE telemetry_events(installation_id TEXT,id TEXT,name TEXT,occurred_at INTEGER,received_at INTEGER,session_id TEXT,props TEXT,PRIMARY KEY(installation_id,id))')
        with connection(self.webpath) as db:
            db.execute('CREATE TABLE apk_download_hits(day TEXT,ip_hash TEXT,country TEXT,PRIMARY KEY(day,ip_hash))')
            db.execute("INSERT INTO apk_download_hits VALUES('2026-09-04','fakehash','PH')")
        self.n=0
    def event(self,name,day=1,props=None,session='session_0000000001',installation='installation_00001'):
        self.n+=1
        with connection(self.dbpath) as db:
            db.execute('INSERT INTO telemetry_events VALUES(?,?,?,?,?,?,?)',(installation,f'event_{self.n:016}',name,self.now-day*p.DAY,self.now,session,json.dumps(props or {})))
    def test_card_chart_stacks_event_grades_without_losing_unknowns(self):
        self.event('card_viewed',props={'grade':5})
        self.event('card_viewed',props={'grade':4})
        self.event('card_viewed',props={'source':'generated','grade':4})
        self.event('card_viewed')
        self.event('profile_updated',props={'grade':6})
        for period in ('2W','1M','3M','1Y'):
            chart=p.series('cards',period,self.now)
            self.assertEqual(chart['legend'],['Grade 4','Grade 5','Unknown grade'])
            self.assertEqual(chart['total'],4)
            segments={}
            for point in chart['points']:
                self.assertEqual(point['value'],sum(point['segments'].values()))
                for k,v in point['segments'].items():segments[k]=segments.get(k,0)+v
            self.assertEqual(segments,{'Grade 4':2,'Grade 5':1,'Unknown grade':1})

    def test_grade_stacks_preserve_unique_identities_and_quiz_totals(self):
        profile={'profile_kind':'student','profile_id':'profile_aaaaaaaaaaaa'}
        self.event('session_started',day=3,props=profile)
        self.event('quiz_graded',day=2,props={**profile,'grade':5,'correct':True})
        self.event('quiz_graded',day=1,props={**profile,'grade':4,'correct':False})
        self.event('quiz_graded',day=1,props={**profile,'grade':4,'correct':True},session='second')
        self.event('quiz_graded',props={'profile_kind':'guest','correct':True},session='guest')
        self.event('card_viewed',props={'profile_kind':'student','profile_id':'profile_bbbbbbbbbbbb'},session='unknown')
        self.event('card_viewed',day=200,props={**profile,'grade':6},session='old',installation='other')
        expected={
          'sessions':{'Grade 5':1,'Grade 4':1,'Unknown grade':2},
          'profiles':{'Grade 5':1,'Unknown grade':1},
          'quizzes':{'Grade 5':1,'Grade 4':2,'Unknown grade':1},
          'correct':{'Grade 5':1,'Grade 4':1,'Unknown grade':1}}
        for metric,counts in expected.items():
            for period in ('2W','1M','3M','1Y'):
                chart=p.series(metric,period,self.now)
                wanted=dict(counts)
                if period=='1Y' and metric in ('sessions','profiles'): wanted['Grade 6']=1
                actual={}
                for point in chart['points']:
                    self.assertEqual(point['value'],sum(point['segments'].values()))
                    for grade,count in point['segments'].items(): actual[grade]=actual.get(grade,0)+count
                self.assertEqual(actual,wanted,(metric,period))
                self.assertEqual(chart['total'],sum(wanted.values()))
                if period=='1Y': self.assertEqual(chart['total'],p.overview(self.now)['totals'][metric])

    def test_unique_profiles_and_aliases_are_stable_and_exclude_guest(self):
        profile = {'profile_kind':'student','profile_id':'profile_aaaaaaaaaaaa'}
        self.event('session_started',props=profile)
        self.event('card_viewed',props=profile,session='session_0000000002')
        self.event('card_viewed',props=profile,installation='installation_00002')
        self.event('card_viewed',props={'profile_kind':'student','profile_id':'profile_bbbbbbbbbbbb'})
        self.event('card_viewed',props={'profile_kind':'guest'})
        self.event('card_viewed')
        self.assertEqual(p.overview(self.now)['totals']['profiles'],3)
        self.assertEqual(p.series('profiles','2W',self.now)['total'],3)
        alias=p.profile_alias('installation_00001',profile['profile_id'])
        self.assertEqual(alias,'Merry-Amber-Quail · 8W9W')
        self.assertEqual(alias,p.profile_alias('installation_00001',profile['profile_id']))
        self.assertNotEqual(alias,p.profile_alias('installation_00002',profile['profile_id']))
        self.assertRegex(alias,r'^[A-Za-z]+-[A-Za-z]+-[A-Za-z]+ · [A-Z2-9]{4}$')
        sessions=p.recent_sessions(now=self.now)['sessions']
        self.assertTrue(any(s['context'].get('profile_label')==alias for s in sessions))
        self.assertNotIn('name',str(sessions))

    def test_lifetime_and_chart_dates_are_independent_of_default_window(self):
        self.event('session_started',200)
        self.event('card_viewed',200)
        self.event('quiz_graded',1,{'correct':True})
        self.event('quiz_graded',1,{'correct':False},installation='installation_00002')
        self.event('download_installed',1,{'asset_kind':'model'})
        self.event('download_installed',1,{'asset_kind':'images'})
        self.event('download_started',1,{'asset_kind':'model'})
        overview=p.overview(self.now)
        self.assertEqual(overview['totals']['cards'],1)
        self.assertEqual(overview['totals']['sessions'],2) # same session id on different devices
        self.assertEqual(overview['totals']['quizzes'],2)
        self.assertEqual(overview['totals']['correct'],1)
        self.assertEqual(overview['totals']['models'],1)
        self.assertEqual(p.series('cards','2W',self.now)['total'],0)
        self.assertEqual(p.series('cards','1Y',self.now)['total'],1)
        self.assertEqual(len(p.series('cards','2W',self.now)['points']),14)
        self.assertEqual(p.series('sessions','2W',self.now)['total'],1)
        self.assertEqual(p.series('apk','2W',self.now)['total'],1)
    def test_persona_uses_latest_known_pair_once_per_session_and_marks_unknowns(self):
        self.event('session_started',3)
        self.event('profile_updated',2,{'grade':4,'language':'english'})
        self.event('profile_updated',1,{'grade':5,'language':'cebuano'})
        for _ in range(5):self.event('card_viewed',1,{'grade':5,'language':'cebuano'})
        self.event('session_started',1,session='session_0000000002')
        report=p.overview(self.now)
        self.assertEqual(report['persona'],{'grade':5,'language':'cebuano','sessions':1})
        self.assertEqual(report['known_persona_sessions'],1)
        chart=p.series('persona','2W',self.now)
        self.assertEqual(chart['total'],2)
        self.assertIn('Unknown persona',chart['legend'])
    def test_missing_telemetry_does_not_hide_apk_or_invent_zero(self):
        self.dbpath.unlink()
        report=p.overview(self.now)
        self.assertFalse(report['available']);self.assertEqual(report['totals']['apk'],1)
        self.assertIsNone(report['totals']['cards'])
        self.assertFalse(p.series('cards','2W',self.now)['available'])
    def test_recent_sessions_and_detail_keep_event_and_receipt_times(self):
        self.event('card_viewed',10,{'source':'generated','grade':6,'language':'tagalog','android':'29'})
        s=p.recent_sessions(now=self.now)['sessions'][0]
        self.assertEqual(s['last_received']-s['last_event'],10*p.DAY)
        self.assertEqual(s['dynamic_cards'],1)
        self.assertEqual(s['context']['grade'],6)
        self.assertEqual(p.session_events(s['installation_id'],s['session_id'])['events'][0]['props']['source'],'generated')
    def test_teacher_and_direct_delivery_labels_do_not_change_activity_counts(self):
        self.event('card_viewed',props={'grade':5})
        with connection(self.dbpath) as db:
            db.execute('CREATE TABLE telemetry_deliveries(installation_id TEXT,event_id TEXT,reporter_app TEXT,reporter_id TEXT,reporter_version TEXT,received_at INTEGER,reconstructed INTEGER)')
            for app,reporter in [('hiraia','installation_00001'),('tala','teacher_0000000001')]:
                db.execute('INSERT INTO telemetry_deliveries VALUES(?,?,?,?,?,?,?)',
                  ('installation_00001','event_0000000000000001',app,reporter,'0.4.1',self.now,0))
        detail=p.session_events('installation_00001','session_0000000001')['events'][0]
        self.assertEqual({d['reporter_app'] for d in detail['deliveries']},{'tala','hiraia'})
        self.assertEqual(p.overview(self.now)['totals']['cards'],1)

    def test_ranges_clamp_leap_and_month_boundaries(self):
        now=int(datetime(2024,3,30,tzinfo=timezone.utc).timestamp()*1000)
        start,end=p.window('1M',now)
        self.assertEqual(start.date().isoformat(),'2024-02-29')
        self.assertEqual(end.date().isoformat(),'2024-03-31')
        with self.assertRaises(ValueError):p.window('forever')
    def test_new_pages_and_apis_require_authentication(self):
        for path in ['/admin','/admin/archive/training','/admin/archive/telemetry','/admin/api/pilot/overview','/admin/api/pilot/series','/admin/api/pilot/sessions','/admin/api/pilot/events','/admin/api/pilot/website','/admin/api/pilot/mirror']:
            h=object.__new__(admin_app.Handler);h.headers=Message();h.path=path;result=[]
            h._send=lambda status,body,*args:result.append(status)
            h.do_GET();self.assertIn(result[0],(302,303,401),path)
    def test_bad_parameters_are_rejected(self):
        for path in ['/admin/api/pilot/series?metric=DROP','/admin/api/pilot/series?metric=cards&range=forever','/admin/api/pilot/events?installation=x&session=y','/admin/api/pilot/sessions?offset=-1','/admin/api/pilot/website?range=forever']:
            h=object.__new__(admin_app.Handler);h.path=path;h._session_ok=lambda:True;result=[]
            h._send=lambda status,body,*args:result.append(status)
            h.do_GET();self.assertEqual(result[0],400,path)
    def test_ga_not_configured_never_fabricates_data(self):
        self.assertEqual(ga_reporting.report()['status'],'not_configured')
    def test_html_escapes_mount_and_csrf(self):
        markup=p.page('/admin','\"><script>alert(1)</script>')
        self.assertNotIn('value=""><script>',markup)
        self.assertIn('&lt;script&gt;',markup)

class FakeRemote:
    def __init__(self):self.records={};self.fail=False
    @contextlib.contextmanager
    def transaction(self):
        self.pending={}
        yield
        if self.fail:raise RuntimeError('network failure before commit')
        self.records.update(self.pending)
    @contextlib.contextmanager
    def cursor(self):yield self
    def executemany(self,sql,records):
        for row in records:self.pending.setdefault(tuple(row[:2]),row)

class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE telemetry_events(installation_id TEXT,id TEXT,name TEXT,occurred_at INTEGER,received_at INTEGER,session_id TEXT,props TEXT,PRIMARY KEY(installation_id,id))')
        self.db.executemany('INSERT INTO telemetry_events VALUES(?,?,?,?,?,?,?)', [('install_0000000001',f'event_{i:016}','card_viewed',100,200,'session_00000001','{}') for i in range(3)])
        self.db.commit();mirror.prepare(self.db);self.remote=FakeRemote()
    def test_remote_failure_keeps_entire_pending_batch(self):
        self.remote.fail=True
        with self.assertRaises(RuntimeError):mirror.mirror_events(self.db,self.remote,'target')
        self.assertEqual(self.db.execute('SELECT count(*) FROM telemetry_mirror_receipts').fetchone()[0],0)
        self.assertEqual(len(self.remote.records),0)
        self.remote.fail=False
        self.assertEqual(mirror.mirror_events(self.db,self.remote,'target'),3)
    def test_lost_local_receipt_retries_remote_without_duplicates(self):
        self.db.execute("CREATE TRIGGER fail_receipt BEFORE INSERT ON telemetry_mirror_receipts BEGIN SELECT RAISE(ABORT,'disk error'); END")
        with self.assertRaises(sqlite3.Error):mirror.mirror_events(self.db,self.remote,'target')
        self.assertEqual(len(self.remote.records),3)
        self.assertEqual(self.db.execute('SELECT count(*) FROM telemetry_mirror_receipts').fetchone()[0],0)
        self.db.execute('DROP TRIGGER fail_receipt')
        mirror.mirror_events(self.db,self.remote,'target')
        self.assertEqual(len(self.remote.records),3)
        self.assertEqual(mirror.mirror_events(self.db,self.remote,'target'),0)
    def test_reconciliation_repairs_remote_loss_and_does_not_propagate_deletion(self):
        mirror.mirror_events(self.db,self.remote,'target')
        self.remote.records.clear()
        mirror.mirror_events(self.db,self.remote,'target',reconcile=True)
        self.assertEqual(len(self.remote.records),3)
        self.db.execute('DELETE FROM telemetry_events');self.db.commit()
        mirror.mirror_events(self.db,self.remote,'target',reconcile=True)
        self.assertEqual(len(self.remote.records),3)
    def test_delivery_provenance_is_mirrored_even_after_event_was_already_copied(self):
        mirror.mirror_events(self.db,self.remote,'target')
        self.db.execute("""CREATE TABLE telemetry_deliveries(installation_id TEXT,event_id TEXT,reporter_app TEXT,
          reporter_id TEXT,reporter_version TEXT,received_at INTEGER,reconstructed INTEGER,
          PRIMARY KEY(installation_id,event_id,reporter_app,reporter_id))""")
        records=[('install_0000000001','event_0000000000000000',app,reporter,'0.4.1',200,0)
                 for app,reporter in [('hiraia','install_0000000001'),('tala','teacher_0000000001')]]
        self.db.executemany('INSERT INTO telemetry_deliveries VALUES(?,?,?,?,?,?,?)',records);self.db.commit()
        class DeliveryRemote(FakeRemote):
            def executemany(self,sql,records):
                for row in records:self.pending.setdefault(tuple(row[:4]),row)
        remote=DeliveryRemote();remote.fail=True
        with self.assertRaises(RuntimeError):mirror.mirror_deliveries(self.db,remote,'target')
        self.assertEqual(mirror.pending_deliveries(self.db,'target'),2)
        remote.fail=False
        self.assertEqual(mirror.mirror_deliveries(self.db,remote,'target',batch=1),2)
        self.assertEqual(mirror.pending_deliveries(self.db,'target'),0)
        self.assertEqual(mirror.mirror_deliveries(self.db,remote,'target'),0)
        self.assertEqual(len(remote.records),2)
        remote.records.clear()
        self.assertEqual(mirror.mirror_deliveries(self.db,remote,'target',reconcile=True),2)
        self.assertEqual(len(remote.records),2)

    def test_restore_includes_delivery_provenance_and_accepts_older_remote_schema(self):
        events=self.db.execute('SELECT * FROM telemetry_events ORDER BY installation_id,id').fetchall()
        delivery=('install_0000000001','event_0000000000000000','tala','teacher_0000000001','0.4.1',200,1)
        class Result:
            def __init__(self, rows):self.rows=rows
            def fetchall(self):return self.rows
            def fetchone(self):return self.rows[0]
        class Source:
            def __init__(self, labeled):self.labeled=labeled
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def execute(self, sql, args=None):
                if sql.startswith('SET TRANSACTION'):return None
                if 'to_regclass' in sql:return Result([('deliveries' if self.labeled else None,)])
                if 'FROM hiraia_telemetry.deliveries' in sql:
                    return Result([delivery] if delivery[:4]>args else [])
                return Result([e for e in events if e[:2]>args])
        for labeled in [False,True]:
            with tempfile.TemporaryDirectory() as folder, patch.object(mirror,'remote_connect',return_value=Source(labeled)):
                target=Path(folder)/'restore.db'
                self.assertEqual(mirror.restore('test',target)['restored_events'],3)
                with connection(target) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM telemetry_deliveries').fetchone()[0],int(labeled))
                    if labeled:self.assertEqual(db.execute('SELECT * FROM telemetry_deliveries').fetchone(),delivery)

    def test_restore_refuses_existing_database(self):
        with tempfile.NamedTemporaryFile() as f:
            with self.assertRaises(ValueError):mirror.restore('unused',f.name)

if __name__=='__main__':unittest.main()

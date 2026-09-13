import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from email.message import Message

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deploy/vps-monitor'))
import pilot_analytics
import admin_app

class PilotReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'telemetry.db'
        self.previous = os.environ.get('HIRAIA_TELEMETRY_DB_PATH')
        os.environ['HIRAIA_TELEMETRY_DB_PATH'] = str(self.path)
        self.addCleanup(self.restore_env)
        self.now = 1800000000000
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE telemetry_events(installation_id TEXT,id TEXT,name TEXT,occurred_at INTEGER,received_at INTEGER,session_id TEXT,props TEXT,PRIMARY KEY(installation_id,id))')
            events = [
                ('first_open', 3, {}), ('session_started', 3, {'app_version':'0.1.0','build':'pilot1','android':'29','ram_gb':3}),
                ('session_started', 2, {}), ('card_viewed', 2, {'source':'curated'}),
                ('quiz_graded', 2, {'correct':True}), ('quiz_graded', 2, {'correct':False}),
                ('download_failed', 2, {'asset':'model.gguf','error':'network'}),
                ('queue_dropped', 2, {'count':5}), ('queue_dropped', 1, {'count':7}),
            ]
            for i, (name, days, props) in enumerate(events):
                db.execute('INSERT INTO telemetry_events VALUES(?,?,?,?,?,?,?)',
                    ('installation_one',str(i),name,self.now-days*86400000,self.now,'session_1',json.dumps(props)))
    def restore_env(self):
        if self.previous is None: os.environ.pop('HIRAIA_TELEMETRY_DB_PATH',None)
        else: os.environ['HIRAIA_TELEMETRY_DB_PATH'] = self.previous
    def test_late_activity_quizzes_and_cumulative_loss(self):
        report = pilot_analytics.report(7, self.now)
        self.assertEqual(report['counts']['quiz_graded'], 2)
        self.assertEqual(report['counts']['correct_answers'], 1)
        self.assertEqual(report['counts']['active_installations'], 1)
        self.assertEqual(report['counts']['returning_installations'], 1)
        self.assertEqual(report['counts']['dropped_events_reported'], 7)
        self.assertEqual(report['failures'][0]['error'],'network')
        self.assertGreater(report['counts']['late_events'],0)
        self.assertEqual(report['last_received'],self.now)
    def test_missing_database_has_honest_empty_state(self):
        self.path.unlink()
        self.assertFalse(pilot_analytics.report()['available'])
    def test_website_geo_and_model_origin_fetches(self):
        web = Path(self.temp.name) / 'hiraia.db'
        previous = os.environ.get('HIRAIA_DB_PATH')
        os.environ['HIRAIA_DB_PATH'] = str(web)
        self.addCleanup(lambda: os.environ.pop('HIRAIA_DB_PATH', None) if previous is None else os.environ.__setitem__('HIRAIA_DB_PATH', previous))
        with sqlite3.connect(web) as db:
            db.execute('CREATE TABLE apk_download_hits(day TEXT, ip_hash TEXT, country TEXT, city TEXT)')
            db.execute('CREATE TABLE web_sessions(day TEXT, ip_hash TEXT, country TEXT, city TEXT)')
            db.execute("INSERT INTO web_sessions VALUES('2027-01-14','a','PH','Quezon City')")
            db.execute("INSERT INTO web_sessions VALUES('2027-01-14','b','PH','Cebu City')")
            db.execute("INSERT INTO web_sessions VALUES('2027-01-14','c','US','')")
            db.execute("INSERT INTO apk_download_hits VALUES('2027-01-14','d','PH','Manila')")
        log = Path(self.temp.name) / 'model-geo.log'
        os.environ['HIRAIA_MODEL_GEO_LOG'] = str(log)
        self.addCleanup(lambda: os.environ.pop('HIRAIA_MODEL_GEO_LOG', None))
        log.write_text('2027-01-14T12:00:00+00:00\tPH\tQuezon City\t200\t100\n2027-01-14T12:01:00+00:00\tPH\tCebu City\t200\t100\n')
        report = pilot_analytics.report(7, self.now)
        self.assertEqual(report['website_clicks'], 1)
        self.assertEqual(report['web_countries'][0]['country'], 'PH')
        self.assertEqual(report['web_countries'][0]['sessions'], 2)
        cities = {(r['country'], r['city']): r['sessions'] for r in report['web_cities']}
        self.assertEqual(cities[('PH', 'Quezon City')], 1)
        self.assertTrue(report['model_geo']['available'])
        self.assertEqual(report['model_geo']['countries'][0]['country'], 'PH')
        self.assertEqual(report['model_geo']['countries'][0]['fetches'], 2)
    def test_admin_telemetry_requires_existing_session(self):
        handler = object.__new__(admin_app.Handler)
        handler.headers = Message()
        handler.path = '/admin/api/telemetry?days=7'
        result = []
        handler._send = lambda status, body, *args: result.append((status, body))
        handler.do_GET()
        self.assertEqual(result[0][0],401)
    def test_authenticated_invalid_period_is_rejected(self):
        handler = object.__new__(admin_app.Handler)
        handler.path = '/admin/api/telemetry?days=99999'
        handler._session_ok = lambda: True
        result=[]
        handler._send=lambda status,body,*args: result.append((status,body))
        handler.do_GET()
        self.assertEqual(result[0][0],400)

if __name__ == '__main__': unittest.main()

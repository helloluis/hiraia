"""Pilot dashboard: authenticated, read-only reports; event-time UTC throughout."""
import calendar
from contextlib import closing
from datetime import datetime, timedelta, timezone
import html
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time

DAY = 86400000
RANGES = ('2W', '1M', '3M', '1Y')
METRICS = ('apk', 'models', 'sessions', 'profiles', 'cards', 'quizzes', 'correct', 'persona')
GRADE_METRICS = ('cards', 'quizzes', 'correct', 'sessions', 'profiles')
# Version 1 vocabulary/order is immutable: aliases must survive dashboard updates.
PROFILE_ADJECTIVES = ('Bright','Calm','Clever','Curious','Gentle','Happy','Kind','Lively','Merry','Patient','Playful','Quiet','Sunny','Thoughtful','Warm','Witty')
PROFILE_COLORS = ('Amber','Blue','Coral','Gold','Green','Indigo','Jade','Lilac','Mint','Olive','Orange','Peach','Purple','Rose','Silver','Teal')
PROFILE_ANIMALS = ('Badger','Bear','Bee','Cat','Crane','Deer','Dolphin','Dove','Duck','Finch','Fox','Gecko','Heron','Koala','Lemur','Lynx','Otter','Owl','Panda','Parrot','Penguin','Puffin','Quail','Rabbit','Robin','Seal','Sparrow','Swan','Tiger','Turtle','Whale','Wren')
def profile_alias(installation, profile):
    digest = hashlib.sha256(('hiraia-profile-v1\0'+installation+'\0'+profile).encode()).digest()
    alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    suffix = ''.join(alphabet[b % len(alphabet)] for b in digest[3:7])
    return f'{PROFILE_ADJECTIVES[digest[0] % len(PROFILE_ADJECTIVES)]}-{PROFILE_COLORS[digest[1] % len(PROFILE_COLORS)]}-{PROFILE_ANIMALS[digest[2] % len(PROFILE_ANIMALS)]} · {suffix}'

PROFILE_SQL = """SELECT installation_id,json_extract(props,'$.profile_id') profile_id,min(occurred_at) started
  FROM telemetry_events WHERE occurred_at BETWEEN 1577836800000 AND ?
  AND json_extract(props,'$.profile_kind')='student'
  AND json_extract(props,'$.profile_id') IS NOT NULL
  GROUP BY installation_id,json_extract(props,'$.profile_id')"""
SESSION_SQL = """SELECT installation_id,session_id,min(occurred_at) started,
  max(occurred_at) last_event,max(received_at) last_received,count(*) events,
  sum(name='card_viewed') cards,
  sum(name='card_viewed' AND json_extract(props,'$.source')='generated') dynamic_cards,
  sum(name='quiz_graded') quizzes,
  sum(name='quiz_graded' AND json_extract(props,'$.correct')=1) correct,
  sum(name='download_started') download_attempts,
  sum(name='download_installed') downloads,
  sum(name IN ('download_failed','model_load_failed','generation_failed')) failures
  FROM telemetry_events WHERE occurred_at BETWEEN 1577836800000 AND ?
  GROUP BY installation_id,session_id"""
# A persona is a PAIR observed together, not an invented join of independently latest fields.
PERSONA_SQL = """SELECT installation_id,session_id,
  json_extract(props,'$.grade') grade,json_extract(props,'$.language') language,
  row_number() OVER(PARTITION BY installation_id,session_id ORDER BY occurred_at DESC,id DESC) rank
  FROM telemetry_events WHERE occurred_at BETWEEN 1577836800000 AND ?
  AND json_extract(props,'$.grade') BETWEEN 3 AND 10
  AND json_extract(props,'$.language') IN ('english','tagalog','cebuano')"""
FILTERS = {
    'models': "name='download_installed' AND json_extract(props,'$.asset_kind')='model'",
    'cards': "name='card_viewed'",
    'quizzes': "name='quiz_graded'",
    'correct': "name='quiz_graded' AND json_extract(props,'$.correct')=1",
}

def now_ms():
    return int(time.time() * 1000)

def window(period, now=None):
    if period not in RANGES:
        raise ValueError('invalid_range')
    now = now_ms() if now is None else now
    end = datetime.fromtimestamp(now / 1000, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    if period == '2W':
        start = end - timedelta(days=14)
    else:
        months = {'1M': 1, '3M': 3, '1Y': 12}[period]
        index = end.year * 12 + end.month - 1 - months
        year, month = divmod(index, 12)
        start = end.replace(year=year, month=month+1, day=min(end.day, calendar.monthrange(year, month+1)[1]))
    return start, end

def connect(env):
    name = os.environ.get(env, '')
    if not name or not Path(name).is_file():
        return None
    db = sqlite3.connect(Path(name).resolve().as_uri() + '?mode=ro', uri=True, timeout=3)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    return db

def rows(db, sql, args=()):
    return [dict(r) for r in db.execute(sql, args)]

def apk_report(start=None, end=None):
    try:
        db = connect('HIRAIA_DB_PATH')
        if db is None:
            return {'available': False, 'total': None, 'daily': []}
        with closing(db):
            total = db.execute('SELECT count(*) FROM apk_download_hits WHERE day<=?', (datetime.now(timezone.utc).date().isoformat(),)).fetchone()[0]
            daily = rows(db, 'SELECT day,count(*) value FROM apk_download_hits WHERE day>=? AND day<? GROUP BY day ORDER BY day', (start or '2020-01-01', end or '9999-12-31'))
            return {'available': True, 'total': total, 'daily': daily}
    except (sqlite3.Error, OSError):
        return {'available': False, 'total': None, 'daily': []}

def overview(now=None):
    now = now_ms() if now is None else now
    apk = apk_report()
    out = dict(available=False, generated_at=now, timezone='UTC', first_event=None, last_received=None,
               totals={k: None for k in METRICS if k != 'persona'}, persona=None,
               known_persona_sessions=0, late_events=0, apk_available=apk['available'])
    out['totals']['apk'] = apk['total']
    db = connect('HIRAIA_TELEMETRY_DB_PATH')
    if db is None:
        return out
    with closing(db):
        upper = now + 300000
        for key, condition in FILTERS.items():
            out['totals'][key] = db.execute(f'SELECT count(*) FROM telemetry_events WHERE occurred_at BETWEEN 1577836800000 AND ? AND {condition}', (upper,)).fetchone()[0]
        out['totals']['sessions'] = db.execute(f'SELECT count(*) FROM ({SESSION_SQL})', (upper,)).fetchone()[0]
        out['totals']['profiles'] = db.execute(f'SELECT count(*) FROM ({PROFILE_SQL})', (upper,)).fetchone()[0]
        personas = rows(db, f'''SELECT grade,language,count(*) sessions FROM ({PERSONA_SQL})
          WHERE rank=1 GROUP BY grade,language ORDER BY sessions DESC,grade,language''', (upper,))
        out['persona'] = personas[0] if personas else None
        out['known_persona_sessions'] = sum(p['sessions'] for p in personas)
        out['first_event'], out['last_received'], out['late_events'] = db.execute('''SELECT min(occurred_at),max(received_at),coalesce(sum(received_at-occurred_at>86400000),0)
          FROM telemetry_events WHERE occurred_at BETWEEN 1577836800000 AND ?''', (upper,)).fetchone()
        out['available'] = True
    return out

def series(metric, period='2W', now=None):
    if metric not in METRICS:
        raise ValueError('invalid_metric')
    now = now_ms() if now is None else now
    start, end = window(period, now)
    start_ms, end_ms = int(start.timestamp()*1000), min(int(end.timestamp()*1000)-1, now+300000)
    out = dict(metric=metric, range=period, start=start.date().isoformat(), end=(end-timedelta(days=1)).date().isoformat(),
               timezone='UTC', available=False, points=[], legend=[], total=0, interval='week' if period=='1Y' else 'day')
    daily = []
    if metric == 'apk':
        source = apk_report(start.date().isoformat(), end.date().isoformat())
        out['available'], daily = source['available'], source['daily']
    else:
        db = connect('HIRAIA_TELEMETRY_DB_PATH')
        if db is None:
            return out
        with closing(db):
            upper = now+300000
            if metric in ('profiles', 'sessions'):
                # One grade per identity, chosen across all history before range filtering.
                identity = "json_extract(props,'$.profile_id')" if metric == 'profiles' else 'session_id'
                eligible = "AND json_extract(props,'$.profile_kind')='student' AND json_extract(props,'$.profile_id') IS NOT NULL" if metric == 'profiles' else ''
                daily = rows(db, f"""WITH ranked AS (
                  SELECT installation_id,{identity} identity,
                    min(occurred_at) OVER (PARTITION BY installation_id,{identity}) started,
                    json_extract(props,'$.grade') grade,
                    row_number() OVER (PARTITION BY installation_id,{identity}
                      ORDER BY CASE WHEN json_extract(props,'$.grade') IN (3,4,5,6,7,8,9,10) THEN 0 ELSE 1 END,
                        occurred_at,id) rank
                  FROM telemetry_events WHERE occurred_at BETWEEN 1577836800000 AND ? {eligible})
                  SELECT date(started/1000,'unixepoch') day,
                    CASE WHEN grade IN (3,4,5,6,7,8,9,10) THEN 'Grade '||CAST(grade AS INTEGER)
                      ELSE 'Unknown grade' END grade_label,count(*) value
                  FROM ranked WHERE rank=1 AND started BETWEEN ? AND ? GROUP BY day,grade_label""", (upper,start_ms,end_ms))
            elif metric in ('cards', 'quizzes', 'correct'):
                daily = rows(db, f"""SELECT date(occurred_at/1000,'unixepoch') day,
                  CASE WHEN json_extract(props,'$.grade') IN (3,4,5,6,7,8,9,10)
                    THEN 'Grade '||CAST(json_extract(props,'$.grade') AS INTEGER)
                    ELSE 'Unknown grade' END grade_label, count(*) value
                  FROM telemetry_events WHERE occurred_at BETWEEN ? AND ? AND {FILTERS[metric]}
                  GROUP BY day,grade_label""", (start_ms,end_ms))
            elif metric == 'persona':
                daily = rows(db, f'''WITH s AS ({SESSION_SQL}), p AS ({PERSONA_SQL})
                  SELECT date(s.started/1000,'unixepoch') day,
                  coalesce('Grade '||p.grade||' · '||p.language,'Unknown persona') persona,count(*) value
                  FROM s LEFT JOIN p ON s.installation_id=p.installation_id AND s.session_id=p.session_id AND p.rank=1
                  WHERE s.started BETWEEN ? AND ? GROUP BY day,persona''', (upper,upper,start_ms,end_ms))
            else:
                daily = rows(db, f"SELECT date(occurred_at/1000,'unixepoch') day,count(*) value FROM telemetry_events WHERE occurred_at BETWEEN ? AND ? AND {FILTERS[metric]} GROUP BY day", (start_ms,end_ms))
            out['available'] = True
    if not out['available']:
        return out
    # Zero-fill known coverage only; an unavailable source never becomes a zero chart.
    step = 7 if period == '1Y' else 1
    points = []
    current = start
    while current < end:
        points.append({'day': current.date().isoformat(), 'end': (min(current+timedelta(days=step),end)-timedelta(days=1)).date().isoformat(), 'value': 0, 'segments': {}})
        current += timedelta(days=step)
    if metric == 'persona':
        totals = {}
        for r in daily: totals[r['persona']] = totals.get(r['persona'],0)+r['value']
        top = sorted(totals, key=lambda k:(-totals[k],k))[:5]
        out['legend'] = top + (['Other personas'] if len(totals)>5 else [])
    if metric in GRADE_METRICS:
        observed = {r['grade_label'] for r in daily}
        out['legend'] = [label for label in [*(f'Grade {g}' for g in range(3,11)), 'Unknown grade'] if label in observed]
    for r in daily:
        day = datetime.strptime(r['day'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
        index = (day-start).days // step
        if not 0 <= index < len(points): continue
        point = points[index]
        point['value'] += r['value']
        if metric in GRADE_METRICS:
            label = r['grade_label']
            point['segments'][label] = point['segments'].get(label,0)+r['value']
        if metric == 'persona':
            label = r['persona'] if r['persona'] in out['legend'] else 'Other personas'
            point['segments'][label] = point['segments'].get(label,0)+r['value']
    out['points'] = points
    out['total'] = sum(p['value'] for p in points)
    return out

def recent_sessions(offset=0, now=None):
    if not 0 <= offset <= 10000: raise ValueError('invalid_offset')
    now = now_ms() if now is None else now
    db = connect('HIRAIA_TELEMETRY_DB_PATH')
    if db is None: return {'available':False,'sessions':[],'has_more':False}
    with closing(db):
        result = rows(db, f'''SELECT * FROM ({SESSION_SQL}) ORDER BY last_received DESC,started DESC,installation_id,session_id LIMIT 51 OFFSET ?''', (now+300000,offset))
        has_more = len(result)>50
        result = result[:50]
        has_deliveries = db.execute("SELECT 1 FROM sqlite_master WHERE name='telemetry_deliveries'").fetchone()
        for session in result:
            ids = (session['installation_id'],session['session_id'],now+300000)
            metadata = rows(db, '''SELECT props FROM telemetry_events WHERE installation_id=? AND session_id=?
              AND occurred_at BETWEEN 1577836800000 AND ? ORDER BY occurred_at DESC,id DESC LIMIT 250''', ids)
            context = {}
            for record in metadata:
                props = json.loads(record['props'])
                if 'profile_label' not in context and props.get('profile_kind') == 'student' and props.get('profile_id'):
                    context['profile_label'] = profile_alias(session['installation_id'],props['profile_id'])
                elif 'profile_label' not in context and props.get('profile_kind') == 'guest':
                    context['profile_label'] = 'Guest (shared)'
                for key in ('app_version','build','hiraiapedia_version','cards_db_version','android','abi','ram_gb','model'):
                    if key in props and key not in context: context[key] = props[key]
                if 'grade' in props and 'language' in props and 'grade' not in context:
                    context.update(grade=props['grade'],language=props['language'])
                if 'language' in props and 'language' not in context: context['language'] = props['language']
            session['context'] = context
            session['reporters'] = rows(db, '''SELECT DISTINCT d.reporter_app,d.reporter_version
              FROM telemetry_deliveries d JOIN telemetry_events e
              ON e.installation_id=d.installation_id AND e.id=d.event_id
              WHERE e.installation_id=? AND e.session_id=?
              ORDER BY d.reporter_app,d.reporter_version''', ids[:2]) if has_deliveries else []
        return {'available':True,'sessions':result,'has_more':has_more}

def session_events(installation, session, offset=0):
    if not all(re.fullmatch(r'[a-zA-Z0-9_-]{16,80}', str(v)) for v in (installation, session)) or not 0 <= offset <= 10000:
        raise ValueError('invalid_session')
    db = connect('HIRAIA_TELEMETRY_DB_PATH')
    if db is None: return {'available':False,'events':[],'has_more':False}
    with closing(db):
        result = rows(db, '''SELECT id,name,occurred_at,received_at,props FROM telemetry_events
          WHERE installation_id=? AND session_id=? ORDER BY occurred_at,id LIMIT 101 OFFSET ?''', (installation,session,offset))
        more = len(result)>100
        has_deliveries = db.execute("SELECT 1 FROM sqlite_master WHERE name='telemetry_deliveries'").fetchone()
        for row in result[:100]:
            row['deliveries'] = rows(db, '''SELECT reporter_app,reporter_id,reporter_version,received_at,reconstructed
              FROM telemetry_deliveries WHERE installation_id=? AND event_id=? ORDER BY received_at''',
              (installation,row['id'])) if has_deliveries else []
            row['props'] = json.loads(row['props'])
            if row['props'].get('profile_kind') == 'student' and row['props'].get('profile_id'):
                row['props']['profile_label'] = profile_alias(installation,row['props']['profile_id'])
        return {'available':True,'events':result[:100],'has_more':more}

def page(mount='/admin', csrf=''):
    template = Path(__file__).with_name('pilot_dashboard.html').read_text()
    return template.replace('__MOUNT_JSON__',json.dumps(mount).replace('<','\\u003c')).replace('__MOUNT__',html.escape(mount,quote=True)).replace('__CSRF__',html.escape(csrf,quote=True))

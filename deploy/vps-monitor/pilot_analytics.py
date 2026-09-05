"""Read-only pilot reporting over the Next.js telemetry database. No external services."""
import html
from contextlib import closing
import json
import os
import sqlite3
import time
from pathlib import Path


def report(days=30, now=None):
    now = int(time.time() * 1000) if now is None else now
    filename = os.environ.get('HIRAIA_TELEMETRY_DB_PATH', '')
    empty = {'available': False, 'days': days, 'counts': {}, 'daily': [], 'builds': [],
             'failures': [], 'installations': [], 'last_received': None}
    if not filename or not Path(filename).is_file():
        return empty
    since = now - days * 86400000
    with closing(sqlite3.connect(Path(filename).resolve().as_uri() + '?mode=ro', uri=True, timeout=3)) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        def rows(sql, args=()):
            return [dict(r) for r in db.execute(sql, args)]
        # Clock anomalies remain stored, but cannot distort the normal activity charts.
        args = (since, now + 300000)
        scope = 'occurred_at BETWEEN ? AND ?'
        counts = {r['name']: r['n'] for r in rows(
            f'SELECT name, count(*) n FROM telemetry_events WHERE {scope} GROUP BY name', args)}
        counts['active_installations'] = db.execute(
            f'SELECT count(DISTINCT installation_id) FROM telemetry_events WHERE {scope} AND name IN (\'session_started\',\'card_viewed\',\'quiz_graded\')', args).fetchone()[0]
        counts['correct_answers'] = db.execute(
            f"SELECT count(*) FROM telemetry_events WHERE {scope} AND name='quiz_graded' AND json_extract(props,'$.correct')=1", args).fetchone()[0]
        counts['returning_installations'] = db.execute(
            f"SELECT count(*) FROM (SELECT installation_id FROM telemetry_events WHERE {scope} AND name='session_started' GROUP BY installation_id HAVING count(DISTINCT date(occurred_at/1000,'unixepoch'))>1)", args).fetchone()[0]
        counts['late_events'] = db.execute(
            f'SELECT count(*) FROM telemetry_events WHERE {scope} AND received_at-occurred_at>86400000', args).fetchone()[0]
        counts['dropped_events_reported'] = db.execute(
            f"SELECT coalesce(sum(n),0) FROM (SELECT max(json_extract(props,'$.count')) n FROM telemetry_events WHERE {scope} AND name='queue_dropped' GROUP BY installation_id)", args).fetchone()[0]
        counts['clock_anomalies'] = db.execute(
            'SELECT count(*) FROM telemetry_events WHERE received_at>=? AND (occurred_at>received_at+300000 OR occurred_at<1577836800000)', (since,)).fetchone()[0]
        daily = rows(f"""SELECT date(occurred_at/1000,'unixepoch') day,
          count(DISTINCT CASE WHEN name='session_started' THEN installation_id END) active,
          sum(name='card_viewed') cards, sum(name='quiz_graded') graded
          FROM telemetry_events WHERE {scope} GROUP BY day ORDER BY day DESC""", args)
        builds = rows(f"""SELECT coalesce(json_extract(props,'$.app_version'),'unknown') version,
          coalesce(json_extract(props,'$.build'),'unknown') build,
          coalesce(json_extract(props,'$.android'),'unknown') android,
          coalesce(json_extract(props,'$.ram_gb'),'unknown') ram_gb,
          count(DISTINCT installation_id) installations
          FROM telemetry_events WHERE {scope} AND name='session_started'
          GROUP BY version,build,android,ram_gb ORDER BY installations DESC LIMIT 100""", args)
        failures = rows(f"""SELECT name, coalesce(json_extract(props,'$.asset'),json_extract(props,'$.model'),'unknown') asset,
          coalesce(json_extract(props,'$.error'),'unknown') error, count(*) n
          FROM telemetry_events WHERE {scope} AND name IN ('download_failed','model_load_failed','generation_failed')
          GROUP BY name,asset,error ORDER BY n DESC LIMIT 100""", args)
        usage = rows(f"""SELECT coalesce(json_extract(props,'$.language'),'unknown') language,
          coalesce(json_extract(props,'$.source'),'unknown') source, count(*) cards
          FROM telemetry_events WHERE {scope} AND name='card_viewed'
          GROUP BY language,source ORDER BY cards DESC""", args)
        downloads = rows(f"""SELECT coalesce(json_extract(props,'$.asset'),'unknown') asset,
          sum(name='download_started') attempts, sum(name='download_resumed') resumes,
          sum(name='download_installed') installed, sum(name='download_failed') failures,
          sum(name='download_cancelled') cancellations,
          round(avg(CASE WHEN name='download_installed' THEN json_extract(props,'$.duration_ms') END)) install_ms
          FROM telemetry_events WHERE {scope} AND name LIKE 'download_%'
          GROUP BY asset ORDER BY attempts DESC LIMIT 100""", args)
        models = rows(f"""SELECT coalesce(json_extract(props,'$.model'),'unknown') model,
          coalesce(json_extract(props,'$.backend'),'unknown') backend, name,
          count(*) events, round(avg(json_extract(props,'$.duration_ms'))) average_ms
          FROM telemetry_events WHERE {scope} AND name IN ('model_ready','model_load_failed','generation_completed','generation_failed')
          GROUP BY model,backend,name ORDER BY events DESC LIMIT 100""", args)
        installations = rows('''SELECT substr(installation_id,1,12) installation,
          min(received_at) first_received, max(received_at) last_received, max(occurred_at) last_event,
          count(*) events FROM telemetry_events GROUP BY installation_id ORDER BY last_received DESC LIMIT 100''')
        last_received = db.execute('SELECT max(received_at) FROM telemetry_events').fetchone()[0]
    web_clicks = None
    webfile = os.environ.get('HIRAIA_DB_PATH', '')
    if webfile and Path(webfile).is_file():
        try:
            with closing(sqlite3.connect(Path(webfile).resolve().as_uri() + '?mode=ro', uri=True)) as db:
                web_clicks = db.execute("SELECT count(*) FROM apk_download_hits WHERE day>=date(?/1000,'unixepoch')", (since,)).fetchone()[0]
        except sqlite3.Error:
            pass
    return dict(available=True, days=days, counts=counts, daily=daily, builds=builds,
                failures=failures, installations=installations, last_received=last_received,
                website_clicks=web_clicks, usage=usage, downloads=downloads, models=models)


def page(mount='/admin'):
    # Render data with textContent, never interpolate untrusted device values as HTML.
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hiraia · Pilot analytics</title><style>
body{font:16px system-ui;background:#f6f4ec;color:#20342c;max-width:1150px;margin:30px auto;padding:0 20px}a{color:inherit}
header{display:flex;gap:20px;align-items:center;flex-wrap:wrap}h1{margin-right:auto}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:12px}
.tile,section{background:white;border:1px solid #ddd9ce;border-radius:12px;padding:18px;margin:14px 0}.value{font-size:30px;font-weight:700}p{line-height:1.5;color:#58635c}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;border-bottom:1px solid #eee;padding:9px}section{overflow:auto}button,select{padding:8px}#status{font-weight:600}
</style><header><h1>Pilot analytics</h1><a href="''' + html.escape(mount, quote=True) + '''">Mission control</a><select id="days" aria-label="Reporting period"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option></select><button id="refresh">Refresh</button></header>
<p>Usage is grouped by event date (UTC). Offline activity arrives when the app reconnects; no recent upload does not mean no usage. Installations can represent shared phones; reinstalls count separately.</p><p id="status" role="status">Loading…</p><div id="tiles" class="tiles"></div>
<section><h2>Daily activity</h2><div id="daily"></div></section><section><h2>All event counts</h2><div id="events"></div></section>
<section><h2>Card language and source</h2><div id="usage"></div></section><section><h2>Download attempts</h2><div id="downloads"></div></section><section><h2>Model runtime</h2><div id="models"></div></section>
<section><h2>App and Android versions</h2><div id="builds"></div></section><section><h2>Failures</h2><div id="failures"></div></section>
<section><h2>Recent installation syncs · all time</h2><div id="installs"></div></section>
<script>
const mount=''' + json.dumps(mount) + ''';
const el=id=>document.getElementById(id);
const date=v=>v?new Date(v).toISOString().replace('T',' ').slice(0,19)+' UTC':'—';
function table(id,rows){const root=el(id);root.replaceChildren();if(!rows.length){root.textContent='No events received for this view yet.';return;}const t=document.createElement('table');const h=t.createTHead().insertRow();Object.keys(rows[0]).forEach(k=>{const c=document.createElement('th');c.textContent=k.replaceAll('_',' ');h.append(c)});const b=t.createTBody();rows.forEach(r=>{const tr=b.insertRow();Object.values(r).forEach(v=>{tr.insertCell().textContent=String(v??'—')})});root.append(t);}
async function load(){el('status').textContent='Loading…';try{const r=await fetch(mount+'/api/telemetry?days='+el('days').value,{cache:'no-store'});if(r.status===401){location.href=mount+'/login';return;}if(!r.ok)throw Error('unavailable');const s=await r.json();if(!s.available){el('status').textContent='Telemetry database is not configured or has not received its first batch.';return;}el('status').textContent='Last upload: '+date(s.last_received)+' · Events arriving over 24h late: '+(s.counts.late_events||0)+' · Clock anomalies: '+(s.counts.clock_anomalies||0)+' · Reported queue drops: '+(s.counts.dropped_events_reported||0);el('tiles').replaceChildren();const cards=[['New installations',s.counts.first_open],['Active installations',s.counts.active_installations],['Returning installations',s.counts.returning_installations],['Cards viewed',s.counts.card_viewed],['Quizzes graded',s.counts.quiz_graded],['Correct answers',s.counts.correct_answers],['Downloads installed',s.counts.download_installed],['Website clicks · IP/day',s.website_clicks??'Unavailable']];cards.forEach(([k,v])=>{const d=document.createElement('div');d.className='tile';const n=document.createElement('div');n.className='value';n.textContent=v??0;const l=document.createElement('div');l.textContent=k;d.append(n,l);el('tiles').append(d)});table('daily',s.daily);table('usage',s.usage);table('downloads',s.downloads);table('models',s.models);table('events',Object.entries(s.counts).map(([event,count])=>({event,count})));table('builds',s.builds);table('failures',s.failures);table('installs',s.installations.map(i=>({...i,first_received:date(i.first_received),last_received:date(i.last_received),last_event:date(i.last_event)})));}catch{el('status').textContent='Analytics temporarily unavailable. Refresh to retry.';}}
el('refresh').onclick=load;el('days').onchange=load;load();
</script></html>'''

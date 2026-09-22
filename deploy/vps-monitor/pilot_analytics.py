"""Read-only pilot reporting over the Next.js telemetry database. No external services."""
import html
from contextlib import closing
import json
import os
import sqlite3
import time
from pathlib import Path


def model_geo(since_ms, now_ms):
    """Origin /models/ full-file GETs, from nginx geo log. No IPs. Range follow-ups are not logged."""
    path = os.environ.get('HIRAIA_MODEL_GEO_LOG', '/var/log/nginx/hiraia-model-geo.log')
    empty = {'available': False, 'countries': [], 'cities': []}
    if not path or not Path(path).is_file():
        return empty
    since = since_ms / 1000
    countries, cities = {}, {}
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            start = max(0, size - 800_000)
            f.seek(start)
            blob = f.read().decode('utf-8', 'replace')
        lines = blob.splitlines()
        if start:
            lines = lines[1:]
        for line in lines:
            parts = line.split('\t')
            if len(parts) < 3:
                continue
            try:
                ts = datetime_from_iso(parts[0])
            except ValueError:
                continue
            if ts < since or ts > now_ms / 1000 + 300:
                continue
            country = (parts[1] or '').strip() or 'unknown'
            city = (parts[2] or '').strip() or 'unknown'
            countries[country] = countries.get(country, 0) + 1
            key = (country, city)
            cities[key] = cities.get(key, 0) + 1
    except OSError:
        return empty
    country_rows = [{'country': k, 'fetches': v} for k, v in sorted(countries.items(), key=lambda x: -x[1])][:100]
    city_rows = [{'country': c, 'city': y, 'fetches': n} for (c, y), n in sorted(cities.items(), key=lambda x: -x[1])][:100]
    return {'available': True, 'countries': country_rows, 'cities': city_rows}


def datetime_from_iso(value):
    from datetime import datetime as dt
    if value.endswith('Z'):
        value = value[:-1] + '+00:00'
    return dt.fromisoformat(value).timestamp()


def report(days=30, now=None):
    now = int(time.time() * 1000) if now is None else now
    filename = os.environ.get('HIRAIA_TELEMETRY_DB_PATH', '')
    empty = {'available': False, 'days': days, 'counts': {}, 'daily': [], 'builds': [],
             'failures': [], 'installations': [], 'last_received': None,
             'web_countries': [], 'web_cities': [], 'model_geo': {'available': False, 'countries': [], 'cities': []}}
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
        counts['unique_cards'] = db.execute(
            f"SELECT count(DISTINCT json_extract(props,'$.card_id')) FROM telemetry_events WHERE {scope} AND name='card_viewed' AND json_extract(props,'$.card_id') IS NOT NULL AND json_extract(props,'$.card_id') != ''", args).fetchone()[0]
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
          sum(name='card_viewed') card_views,
          count(DISTINCT CASE WHEN name='card_viewed' THEN json_extract(props,'$.card_id') END) unique_cards,
          sum(name='quiz_graded') graded
          FROM telemetry_events WHERE {scope} GROUP BY day ORDER BY day DESC""", args)
        builds = rows(f"""SELECT coalesce(json_extract(props,'$.app_version'),'unknown') version,
          coalesce(json_extract(props,'$.build'),'unknown') build,
          coalesce(json_extract(props,'$.hiraiapedia_version'),'unknown') hiraiapedia,
          coalesce(json_extract(props,'$.cards_db_version'),'unknown') cards_db,
          coalesce(json_extract(props,'$.android'),'unknown') android,
          coalesce(json_extract(props,'$.ram_gb'),'unknown') ram_gb,
          count(DISTINCT installation_id) installations
          FROM telemetry_events WHERE {scope} AND name='session_started'
          GROUP BY version,build,hiraiapedia,cards_db,android,ram_gb ORDER BY installations DESC LIMIT 100""", args)
        failures = rows(f"""SELECT name, coalesce(json_extract(props,'$.asset'),json_extract(props,'$.model'),'unknown') asset,
          coalesce(json_extract(props,'$.error'),'unknown') error, count(*) n
          FROM telemetry_events WHERE {scope} AND name IN ('download_failed','model_load_failed','generation_failed')
          GROUP BY name,asset,error ORDER BY n DESC LIMIT 100""", args)
        usage = rows(f"""SELECT coalesce(json_extract(props,'$.language'),'unknown') language,
          coalesce(json_extract(props,'$.source'),'unknown') source,
          count(*) card_views,
          count(DISTINCT json_extract(props,'$.card_id')) unique_cards
          FROM telemetry_events WHERE {scope} AND name='card_viewed'
          GROUP BY language,source ORDER BY card_views DESC""", args)
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
    web_countries, web_cities = [], []
    webfile = os.environ.get('HIRAIA_DB_PATH', '')
    if webfile and Path(webfile).is_file():
        try:
            with closing(sqlite3.connect(Path(webfile).resolve().as_uri() + '?mode=ro', uri=True)) as db:
                db.row_factory = sqlite3.Row
                web_clicks = db.execute("SELECT count(*) FROM apk_download_hits WHERE day>=date(?/1000,'unixepoch')", (since,)).fetchone()[0]
                try:
                    web_countries = [dict(r) for r in db.execute(
                        """SELECT coalesce(nullif(country,''),'unknown') country, count(*) sessions
                           FROM web_sessions WHERE day>=date(?/1000,'unixepoch')
                           GROUP BY 1 ORDER BY sessions DESC LIMIT 100""", (since,))]
                    web_cities = [dict(r) for r in db.execute(
                        """SELECT coalesce(nullif(country,''),'unknown') country,
                                  coalesce(nullif(city,''),'unknown') city, count(*) sessions
                           FROM web_sessions WHERE day>=date(?/1000,'unixepoch')
                           GROUP BY 1,2 ORDER BY sessions DESC LIMIT 100""", (since,))]
                except sqlite3.Error:
                    pass
        except sqlite3.Error:
            pass
    return dict(available=True, days=days, counts=counts, daily=daily, builds=builds,
                failures=failures, installations=installations, last_received=last_received,
                website_clicks=web_clicks, usage=usage, downloads=downloads, models=models,
                web_countries=web_countries, web_cities=web_cities,
                model_geo=model_geo(since, now))


def page(mount='/admin', csrf=''):
    import admin_chrome
    # Render data with textContent, never interpolate untrusted device values as HTML.
    inner = '''<h1>Detailed reports</h1>
<p class="lede">Usage is grouped by event date (UTC). Offline activity arrives when the app reconnects; no recent upload does not mean no usage. Installations can represent shared phones; reinstalls count separately.</p>
<div class="toolbar"><p id="status" class="status" role="status">Loading…</p>
<select id="days" aria-label="Reporting period"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option></select>
<button id="refresh" class="refresh">Refresh</button></div>
<div id="tiles" class="tiles"></div>
<section><h2>Daily activity</h2><div id="daily"></div></section><section><h2>All event counts</h2><div id="events"></div></section>
<section><h2>Card language and source</h2><div id="usage"></div></section><section><h2>Download attempts</h2><div id="downloads"></div></section><section><h2>Model runtime</h2><div id="models"></div></section>
<section><h2>App and Android versions</h2><div id="builds"></div></section><section><h2>Failures</h2><div id="failures"></div></section>
<section><h2>Website sessions · country</h2><p>Public page loads, one hashed IP per UTC day. Country/city come from nginx GeoIP (DB-IP City Lite; Cloudflare country is the fallback).</p><div id="web_countries"></div></section>
<section><h2>Website sessions · city</h2><div id="web_cities"></div></section>
<section><h2>Model origin fetches</h2><p>Full-file GETs of /models/ at the origin (APK and GGUF). Not unique phones: Range follow-ups are skipped, but retries still count. Pears copies and later offline use never appear here. Empty until the geo access log exists. <a href="https://db-ip.com">IP Geolocation by DB-IP</a></p><div id="model_geo"></div></section>
<section><h2>Recent installation syncs · all time</h2><div id="installs"></div></section>
<script>
const mount=''' + json.dumps(mount) + ''';
const el=id=>document.getElementById(id);
const date=v=>v?new Date(v).toISOString().replace('T',' ').slice(0,19)+' UTC':'—';
function table(id,rows){const root=el(id);root.replaceChildren();if(!rows.length){root.textContent='No events received for this view yet.';return;}const t=document.createElement('table');const h=t.createTHead().insertRow();Object.keys(rows[0]).forEach(k=>{const c=document.createElement('th');c.textContent=k.replaceAll('_',' ');h.append(c)});const b=t.createTBody();rows.forEach(r=>{const tr=b.insertRow();Object.values(r).forEach(v=>{tr.insertCell().textContent=String(v??'—')})});root.append(t);}
async function load(){el('status').textContent='Loading…';try{const r=await fetch(mount+'/api/telemetry?days='+el('days').value,{cache:'no-store'});if(r.status===401){location.href=mount+'/login';return;}if(!r.ok)throw Error('unavailable');const s=await r.json();if(!s.available){el('status').textContent='Telemetry database is not configured or has not received its first batch.';return;}el('status').textContent='Last upload: '+date(s.last_received)+' · Events arriving over 24h late: '+(s.counts.late_events||0)+' · Clock anomalies: '+(s.counts.clock_anomalies||0)+' · Reported queue drops: '+(s.counts.dropped_events_reported||0);el('tiles').replaceChildren();const cards=[['New installations',s.counts.first_open],['Active installations',s.counts.active_installations],['Returning installations',s.counts.returning_installations],['Card views',s.counts.card_viewed],['Unique cards',s.counts.unique_cards],['Quizzes graded',s.counts.quiz_graded],['Correct answers',s.counts.correct_answers],['Downloads installed',s.counts.download_installed],['Website clicks · IP/day',s.website_clicks??'Unavailable']];cards.forEach(([k,v])=>{const d=document.createElement('div');d.className='tile';const n=document.createElement('div');n.className='value';n.textContent=v??0;const l=document.createElement('div');l.className='label';l.textContent=k;d.append(n,l);el('tiles').append(d)});table('daily',s.daily);table('usage',s.usage);table('downloads',s.downloads);table('models',s.models);table('events',Object.entries(s.counts).map(([event,count])=>({event,count})));table('builds',s.builds);table('failures',s.failures);table('web_countries',s.web_countries||[]);table('web_cities',s.web_cities||[]);table('model_geo',(s.model_geo&&s.model_geo.available)?(s.model_geo.cities&&s.model_geo.cities.length?s.model_geo.cities:s.model_geo.countries):[]);table('installs',s.installations.map(i=>({...i,first_received:date(i.first_received),last_received:date(i.last_received),last_event:date(i.last_event)})));}catch{el('status').textContent='Analytics temporarily unavailable. Refresh to retry.';}}
el('refresh').onclick=load;el('days').onchange=load;load();
</script>'''
    return admin_chrome.wrap('Detailed reports', 'Pilot analytics', 'telemetry', mount, csrf, inner)

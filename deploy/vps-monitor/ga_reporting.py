"""Optional GA4 read-only reports. No browser credentials; cached outside the checkout."""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
from datetime import timedelta
from pilot_dashboard import window

_lock = threading.Lock()
TTL = 1800

def configured():
    return bool(re.fullmatch(r'[0-9]+',os.environ.get('HIRAIA_GA4_PROPERTY_ID','')))

def report(period='2W'):
    start,end = window(period)
    if not configured():
        return {'available':False,'status':'not_configured','range':period}
    prop = os.environ['HIRAIA_GA4_PROPERTY_ID']
    identity = hashlib.sha256(prop.encode()).hexdigest()[:12]
    root = Path(os.environ.get('HIRAIA_GA_CACHE_DIR','/var/lib/hiraia-monitor/ga-cache'))
    path = root / f'{identity}-{period}.json'
    cached = None
    try:
        cached = json.loads(path.read_text())
        if not isinstance(cached,dict) or 'updated_at' not in cached: cached = None
        if cached and time.time()*1000-cached['updated_at']<TTL*1000:
            return dict(cached,stale=False)
    except (OSError,ValueError,TypeError):
        pass
    if not _lock.acquire(blocking=False):
        return dict(cached,stale=True) if cached else {'available':False,'status':'loading','range':period}
    try:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
        credentials,_ = google.auth.default(scopes=['https://www.googleapis.com/auth/analytics.readonly'])
        date_range = {'startDate':start.date().isoformat(),'endDate':(end-timedelta(days=1)).date().isoformat()}
        dimensions = [[], ['date'], ['deviceCategory'], ['country','region']]
        requests = [{'dateRanges':[date_range], 'metrics':[{'name':'sessions'}],
                     'dimensions':[{'name':k} for k in dims], 'limit':'10000'} for dims in dimensions]
        # The property can also contain app streams: restrict these reports to website events.
        for item in requests:
            item['dimensionFilter'] = {'filter':{'fieldName':'platform','stringFilter':{'matchType':'EXACT','value':'web','caseSensitive':False}}}
        with AuthorizedSession(credentials) as client:
            response = client.post(f'https://analyticsdata.googleapis.com/v1beta/properties/{prop}:batchRunReports',
                                   json={'requests':requests},timeout=15)
            response.raise_for_status()
            data = response.json()['reports']
        def parse(index):
            return [{**{k:v['value'] for k,v in zip(dimensions[index],row.get('dimensionValues',[]))},
                     'sessions':int(row['metricValues'][0]['value'])} for row in data[index].get('rows',[])]
        daily = parse(1)
        by_day = {r['date']:r['sessions'] for r in daily}
        points=[]
        cursor=start
        while cursor<end:
            points.append({'day':cursor.date().isoformat(),'end':cursor.date().isoformat(),'value':by_day.get(cursor.strftime('%Y%m%d'),0),'segments':{}})
            cursor+=timedelta(days=1)
        out = dict(available=True,status='connected',range=period,updated_at=int(time.time()*1000),
                   timezone=data[0].get('metadata',{}).get('timeZone','Property timezone'),
                   total=sum(r['sessions'] for r in parse(0)),points=points,
                   devices=sorted(parse(2),key=lambda r:-r['sessions']),
                   locations=sorted(parse(3),key=lambda r:-r['sessions']),
                   thresholded=any(r.get('metadata',{}).get('subjectToThresholding',False) for r in data),
                   truncated=any(int(r.get('rowCount',0))>10000 for r in data),
                   start=start.date().isoformat(),end=(end-timedelta(days=1)).date().isoformat(),interval='day',legend=[])
        root.mkdir(parents=True,exist_ok=True,mode=0o700)
        tmp=path.with_suffix('.tmp')
        tmp.write_text(json.dumps(out));tmp.chmod(0o600);tmp.replace(path)
        return dict(out,stale=False)
    except Exception:
        # Never return credential paths, provider error bodies, tokens or account details.
        return dict(cached,stale=True,status='refresh_failed') if cached else {'available':False,'status':'unavailable','range':period}
    finally:
        _lock.release()

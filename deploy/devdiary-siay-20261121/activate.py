"""Run on b11-apps while b11-dev's hiraia.lock is held. Usage: activate.py check|execute|rollback
Swaps in the staged Siay Dev Diary build. Changes only DevDiary.tsx, adds one public photo,
and replaces .next (old build kept intact for rollback; old hashed browser assets merged in).
No DB, config, launcher, guard, nginx or dependency changes."""
import datetime, hashlib, importlib.util, json, os, pathlib, shutil, subprocess, sys, time, urllib.request
BASE = pathlib.Path('/root/hiraia/packages/web')
STAGE = pathlib.Path('/var/tmp/hiraia-devdiary-siay-20261121/packages/web')
BACKUP = pathlib.Path('/var/backups/hiraia-publications/devdiary-siay-20261121')
READY = BASE / '.next-devdiary-siay-ready-20261121'
LIVE_BUILD = 'tP_ccIaUbEKyvK7FgFPzz'
DIARY = 'src/components/DevDiary.tsx'; PHOTO = 'public/dev-diary/siay-nhs-phones.jpg'
DIARY_BEFORE = 'fd5c8cb3463ad7b713ea8e7e096f08275e1d547151014e9f3ab00c47148ed6aa'
PHOTO_SHA = '4d32d1a101331f89db7ce853219f80538fe2207e185ba2a973da6a00ade60472'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()

def guard():
    spec = importlib.util.spec_from_file_location('guard', '/usr/local/libexec/hiraia-migration-runtime.py')
    g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
    entry = g.validate_documents('web', g.read_json(g.CONFIG), g.read_json(g.MARKER))
    assert g.digest(g.SCRIPTS['web'])[0] == entry['script_sha256']

def get(path):
    for attempt in range(15):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3005' + path, timeout=5) as r:
                return r.read()
        except Exception:
            if attempt == 14: raise
            time.sleep(1)

def restart():
    subprocess.run(['systemctl', 'restart', 'ovh-hiraia-web.service'], check=True, timeout=45)

def merge_static(source, target):
    for p in source.rglob('*'):
        if not p.is_file(): continue
        q = target / p.relative_to(source)
        if q.exists(): assert sha(p) == sha(q), 'Hashed asset collision: ' + str(q)
        else:
            q.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(p, q)

def rollback():
    guard()
    assert (BACKUP/'activation-started.json').exists()
    if (BACKUP/'previous-next').exists():
        if (BASE/'.next').exists():
            merge_static(BASE/'.next/static', BACKUP/'previous-next/static')
            assert not (BACKUP/'rolled-back-next').exists(), 'Inspect uncertain rollback before retry'
            os.replace(BASE/'.next', BACKUP/'rolled-back-next')
        os.replace(BACKUP/'previous-next', BASE/'.next')
    shutil.copy2(BACKUP/'DevDiary.tsx', BASE/DIARY)
    (BASE/PHOTO).unlink(missing_ok=True)
    restart()
    assert (BASE/'.next/BUILD_ID').read_text().strip() == LIVE_BUILD
    assert json.loads(get('/api/app/manifest')) == json.loads((BACKUP/'manifest-before.json').read_text())
    r = {'status': 'ROLLED_BACK', 'at': now()}
    (BACKUP/'rollback.json').write_text(json.dumps(r, indent=2)); return r

mode = sys.argv[1]
if mode == 'rollback':
    print(json.dumps(rollback())); sys.exit()
guard()
assert not BACKUP.exists(), 'Backup exists: inspect prior/uncertain transaction; do not replay'
assert not READY.exists(), 'Prepared directory exists: inspect before retry'
assert (BASE/'.next/BUILD_ID').read_text().strip() == LIVE_BUILD, 'Live build changed'
assert sha(BASE/DIARY) == DIARY_BEFORE, 'Live DevDiary changed'
assert not (BASE/PHOTO).exists()
assert sha(STAGE/PHOTO) == PHOTO_SHA
staged_id = (STAGE/'.next/BUILD_ID').read_text().strip()
# Every other source/public/config file in the stage must equal live.
for tree in ['src', 'public']:
    for p in (STAGE/tree).rglob('*'):
        rel = p.relative_to(STAGE)
        if p.is_file() and str(rel) not in (DIARY, PHOTO):
            assert sha(p) == sha(BASE/rel), 'Drift: ' + str(rel)
    for p in (BASE/tree).rglob('*'):
        if p.is_file(): assert (STAGE/p.relative_to(BASE)).exists(), 'Missing in stage: ' + str(p)
manifest_before = json.loads(get('/api/app/manifest'))
if mode == 'check':
    print(json.dumps({'status': 'PASS', 'guard': 'PASS', 'liveBuild': LIVE_BUILD, 'stagedBuild': staged_id, 'productionWrites': False}))
    sys.exit()
assert mode == 'execute'
BACKUP.mkdir(parents=True)
(BACKUP/'manifest-before.json').write_text(json.dumps(manifest_before, indent=2))
shutil.copy2(BASE/DIARY, BACKUP/'DevDiary.tsx')
shutil.copytree(STAGE/'.next', READY, ignore=shutil.ignore_patterns('cache'))
merge_static(BASE/'.next/static', READY/'static')
(BACKUP/'activation-started.json').write_text(json.dumps({'at': now(), 'stagedBuild': staged_id}))
try:
    shutil.copy2(STAGE/PHOTO, BASE/PHOTO)
    shutil.copy2(STAGE/DIARY, BASE/DIARY)
    os.replace(BASE/'.next', BACKUP/'previous-next')
    os.replace(READY, BASE/'.next')
    restart()
    assert json.loads(get('/api/app/manifest')) == manifest_before
    home = get('/').decode()
    assert 'siay-nhs-phones.jpg' in home and 'Siay National High School, Zamboanga Sibugay' in home
    assert hashlib.sha256(get('/dev-diary/siay-nhs-phones.jpg')).hexdigest() == PHOTO_SHA
    r = {'status': 'PASS', 'backup': str(BACKUP), 'previousBuild': LIVE_BUILD, 'buildId': staged_id,
         'manifestUnchanged': True, 'oldStaticAssetsRetained': True, 'service': 'ovh-hiraia-web.service', 'at': now()}
    (BACKUP/'activation.json').write_text(json.dumps(r, indent=2)); print(json.dumps(r))
except Exception:
    rollback(); raise

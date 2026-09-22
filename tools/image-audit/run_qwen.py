#!/usr/bin/env python3
"""Explicit, bounded Alibaba Cloud visual-audit runner.

Use audit_images.py prepare first. --limit is REQUIRED and counts finished jobs
(including filed errors), not dollars. A failed POST is retried once into
attempts/<id>/retry/; a second failure is filed as results/<id>.json with status
error (not a visual judgment) so the run can continue. --workers runs concurrent
in-process threads that claim jobs with mkdir; they do not share a global lock.
"""
import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor
import datetime
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import audit_images as audit

DEFAULT_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
LIVE_SECONDS = 240
RETRY_SLEEP = 2
RATE_LIMIT_SLEEP = 15


def credential(path):
    value = os.environ.get('ALIBABACLOUD_API_KEY') or os.environ.get('DASHSCOPE_API_KEY')
    if value:
        return value
    if path.is_file():
        for line in path.read_text().splitlines():
            m = re.match(r'^\s*(?:export\s+)?(?:ALIBABACLOUD_API_KEY|DASHSCOPE_API_KEY)\s*=\s*(.*?)\s*$', line)
            if m:
                value = m[1].strip().strip('\"\'')
                if value:
                    return value
    raise ValueError('No Alibaba Cloud API key found; set ALIBABACLOUD_API_KEY or DASHSCOPE_API_KEY')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused; credentials must not leave the configured endpoint')


def endpoint_ok(value):
    url = urllib.parse.urlparse(value)
    # Only Alibaba Cloud endpoints; never silently reroute a paid request.
    if (url.scheme != 'https' or url.username or url.password or url.query or url.fragment or
            not (url.hostname or '').endswith('.aliyuncs.com') or
            not url.path.endswith('/chat/completions')):
        raise ValueError('Expected an HTTPS Alibaba Cloud /chat/completions endpoint')


def write_once(path, value):
    if not path.exists():
        audit.write_json(path, value)


def age_seconds(path):
    if not path.exists():
        return None
    raw = audit.read_json(path).get('time')
    if not raw:
        return None
    started = datetime.datetime.fromisoformat(raw)
    now = datetime.datetime.now(datetime.timezone.utc)
    if started.tzinfo is None:
        started = started.replace(tzinfo=datetime.timezone.utc)
    return (now - started).total_seconds()


def is_live(folder):
    if not folder.is_dir():
        return False
    if (folder / 'error.json').exists() or (folder / 'response.txt').exists():
        return False
    started = folder / 'started.json'
    if not started.exists():
        return False
    age = age_seconds(started)
    return age is None or age < LIVE_SECONDS


def pending_job(snap, jobs, found, allowed, kind=None, worker_index=0, workers=1, claimed=()):
    gate = snap['calibration_id']
    if gate not in found:
        if worker_index == 0 and gate not in claimed:
            return jobs[gate]
        return None
    audit.ensure_gate(snap, jobs, found, 'corpus')
    for key, j in jobs.items():
        if key in found or key in claimed:
            continue
        if allowed is not None and j['image_sha256'] not in allowed:
            continue
        if kind and j['kind'] != kind:
            continue
        if workers > 1 and (int(key[:8], 16) % workers) != worker_index:
            continue
        return j
    return None


def file_error(out, j, snap, model, tries, last):
    path = out / 'results' / (j['id'] + '.json')
    if path.exists():
        return
    audit.write_json(path, {
        'rubric_sha256': snap['rubric_sha256'],
        'reviewer': model,
        'raw_response': '',
        'verdict': None,
        'error': {
            'tries': tries,
            'http_status': last.get('http_status') if isinstance(last, dict) else None,
            'type': last.get('type') if isinstance(last, dict) else type(last).__name__,
            'note': 'API failed twice; not a visual judgment',
        },
    })


def save_error(folder, error):
    folder.mkdir(parents=True, exist_ok=True)
    code = error.code if isinstance(error, urllib.error.HTTPError) else None
    body = ''
    if isinstance(error, urllib.error.HTTPError):
        try:
            body = error.read()[:2000].decode('utf-8', 'replace')
        except Exception:
            body = ''
    payload = {
        'type': type(error).__name__,
        'http_status': code,
        'billing': 'unknown; do not assume failed requests are free',
        'provider_body_prefix': body[:500],
    }
    path = folder / 'error.json'
    if path.exists():
        path.write_text(json.dumps(payload, indent=2) + '\n')
    else:
        audit.write_json(path, payload)
    return payload


def post_once(opener, key, endpoint, body, dest, timeout=180):
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(endpoint, data=body,
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with opener.open(request, timeout=timeout) as response, dest.open('wb') as raw:
        total = 0
        for line in response:
            total += len(line)
            if total > 4_000_000:
                raise ValueError('Response exceeded 4 MB safety limit')
            raw.write(line)
            raw.flush()
    return dest.read_text()


def post_with_rate_limit(opener, key, endpoint, body, dest, timeout=180):
    delays = 0
    while True:
        try:
            return post_once(opener, key, endpoint, body, dest, timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code not in {429, 502, 503}:
                raise
            try:
                error.read()
            except Exception:
                pass
            delays += 1
            if delays > 20:
                raise
            print(json.dumps({'rate_limit': error.code, 'wait': RATE_LIMIT_SLEEP, 'n': delays}), flush=True)
            time.sleep(RATE_LIMIT_SLEEP)


def retry_delay(error):
    code = error.code if isinstance(error, urllib.error.HTTPError) else None
    if code in {429, 502, 503}:
        return RATE_LIMIT_SLEEP
    return RETRY_SLEEP


def import_saved(j, args, out, snap, found, folder, try_n, replace_error=False):
    path = folder / 'response.txt'
    result_path = out / 'results' / (j['id'] + '.json')
    if result_path.exists():
        existing = audit.read_json(result_path)
        if existing.get('verdict') or not replace_error:
            return 'done'
    if not path.exists():
        return None
    try:
        text = path.read_text()
        verdict = audit.normalize_verdict(j, audit.decode_response(text))
        status = audit.validate(j, verdict)
    except Exception as error:
        save_error(folder, error)
        return None
    result = {'rubric_sha256': snap['rubric_sha256'], 'reviewer': args.model,
              'raw_response': text, 'verdict': verdict}
    if try_n > 1:
        result['try'] = try_n
    if result_path.exists() and replace_error:
        result_path.write_text(json.dumps(result, indent=2) + '\n')
    else:
        try:
            audit.write_json(result_path, result)
        except FileExistsError:
            return 'done'
    found[j['id']] = (status, result)
    print(json.dumps({'job': j['id'], 'kind': j['kind'], 'verdict': status, 'try': try_n}), flush=True)
    return status


def run_one(j, args, out, snap, root, key, opener, found):
    result_path = out / 'results' / (j['id'] + '.json')
    requeue_errors = getattr(args, 'requeue_errors', False)
    if result_path.exists():
        existing = audit.read_json(result_path)
        if existing.get('verdict') or not requeue_errors:
            return 'done'
    blob = audit.verify_image(root, j)
    payload = audit.api_payload(j, (out / 'rubric.md').read_text(), blob, args.model)
    body = json.dumps(payload).encode()
    attempt = out / 'attempts' / j['id']
    retry_dir = attempt / 'retry'
    try:
        attempt.mkdir()
    except FileExistsError:
        pass

    retry2_dir = attempt / 'retry2'
    if requeue_errors:
        rq = attempt / 'requeue'
        imported = import_saved(j, args, out, snap, found, rq, 4, replace_error=True)
        if imported:
            return imported
        if is_live(rq):
            return 'busy'
        rq.mkdir(exist_ok=True)
        write_once(rq / 'request.json', payload)
        if not (rq / 'started.json').exists():
            try:
                audit.write_json(rq / 'started.json', {'model': args.model, 'endpoint': args.endpoint,
                    'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'request_sha256': audit.digest(body), 'try': 4,
                    'billing': 'unknown until provider reconciliation'})
            except FileExistsError:
                if is_live(rq):
                    return 'busy'
        try:
            post_with_rate_limit(opener, key, args.endpoint, body, rq / 'response.txt')
            imported = import_saved(j, args, out, snap, found, rq, 4, replace_error=True)
            if imported:
                return imported
            last = audit.read_json(rq / 'error.json') if (rq / 'error.json').exists() else {
                'type': 'ImportFailed', 'http_status': None}
        except Exception as error:
            last = save_error(rq, error)
        print(json.dumps({'job': j['id'], 'kind': j['kind'], 'verdict': 'error',
                          'requeue': True, 'http_status': last.get('http_status')}), flush=True)
        return 'error'
    imported = import_saved(j, args, out, snap, found, attempt, 1)
    if imported:
        return imported
    imported = import_saved(j, args, out, snap, found, retry_dir, 2)
    if imported:
        return imported
    imported = import_saved(j, args, out, snap, found, retry2_dir, 3)
    if imported:
        return imported

    two_tries_done = (retry_dir / 'error.json').exists() or (
            (retry_dir / 'started.json').exists() and not is_live(retry_dir) and not (retry_dir / 'response.txt').exists())
    if two_tries_done:
        if not (retry_dir / 'error.json').exists():
            save_error(retry_dir, TimeoutError('Retry attempt exceeded timeout'))
        if (retry2_dir / 'error.json').exists() or (
                (retry2_dir / 'started.json').exists() and not is_live(retry2_dir) and not (retry2_dir / 'response.txt').exists()):
            if not (retry2_dir / 'error.json').exists():
                save_error(retry2_dir, TimeoutError('retry2 attempt exceeded timeout'))
            last = audit.read_json(retry2_dir / 'error.json')
            file_error(out, j, snap, args.model, 3, last)
            found[j['id']] = ('error', {'error': last})
            print(json.dumps({'job': j['id'], 'kind': j['kind'], 'verdict': 'error',
                              'http_status': last.get('http_status')}), flush=True)
            return 'error'
        if is_live(retry2_dir):
            return 'busy'
        retry2_dir.mkdir(exist_ok=True)
        write_once(retry2_dir / 'request.json', payload)
        if not (retry2_dir / 'started.json').exists():
            try:
                audit.write_json(retry2_dir / 'started.json', {'model': args.model, 'endpoint': args.endpoint,
                    'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'request_sha256': audit.digest(body), 'try': 3,
                    'billing': 'unknown until provider reconciliation'})
            except FileExistsError:
                if is_live(retry2_dir):
                    return 'busy'
        try:
            post_with_rate_limit(opener, key, args.endpoint, body, retry2_dir / 'response.txt')
            imported = import_saved(j, args, out, snap, found, retry2_dir, 3)
            if imported:
                return imported
            last = audit.read_json(retry2_dir / 'error.json') if (retry2_dir / 'error.json').exists() else {
                'type': 'ImportFailed', 'http_status': None}
        except Exception as error:
            last = save_error(retry2_dir, error)
        file_error(out, j, snap, args.model, 3, last)
        found[j['id']] = ('error', {'error': last})
        print(json.dumps({'job': j['id'], 'kind': j['kind'], 'verdict': 'error',
                          'http_status': last.get('http_status')}), flush=True)
        return 'error'

    if is_live(retry_dir) or (is_live(attempt) and not (attempt / 'error.json').exists()):
        return 'busy'

    if (attempt / 'started.json').exists() and not (attempt / 'response.txt').exists() and not (attempt / 'error.json').exists():
        save_error(attempt, TimeoutError('First attempt exceeded timeout'))

    if not (attempt / 'error.json').exists():
        write_once(attempt / 'request.json', payload)
        started = attempt / 'started.json'
        claimed_first = False
        if not started.exists():
            try:
                audit.write_json(started, {'model': args.model, 'endpoint': args.endpoint,
                    'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'request_sha256': audit.digest(body),
                    'billing': 'unknown until provider reconciliation'})
                claimed_first = True
            except FileExistsError:
                if is_live(attempt):
                    return 'busy'
        if claimed_first:
            try:
                post_with_rate_limit(opener, key, args.endpoint, body, attempt / 'response.txt')
                imported = import_saved(j, args, out, snap, found, attempt, 1)
                if imported:
                    return imported
            except Exception as error:
                save_error(attempt, error)
                print(json.dumps({'job': j['id'], 'kind': j['kind'], 'retry': True,
                                  'http_status': error.code if isinstance(error, urllib.error.HTTPError) else None}),
                      flush=True)
                time.sleep(retry_delay(error))

    if is_live(retry_dir):
        return 'busy'
    retry_dir.mkdir(exist_ok=True)
    write_once(retry_dir / 'request.json', payload)
    retry_started = retry_dir / 'started.json'
    if not retry_started.exists():
        try:
            audit.write_json(retry_started, {'model': args.model, 'endpoint': args.endpoint,
                'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'request_sha256': audit.digest(body), 'try': 2,
                'billing': 'unknown until provider reconciliation'})
        except FileExistsError:
            if is_live(retry_dir):
                return 'busy'
    elif is_live(retry_dir):
        return 'busy'
    try:
        post_with_rate_limit(opener, key, args.endpoint, body, retry_dir / 'response.txt')
        imported = import_saved(j, args, out, snap, found, retry_dir, 2)
        if imported:
            return imported
        last = audit.read_json(retry_dir / 'error.json') if (retry_dir / 'error.json').exists() else {
            'type': 'ImportFailed', 'http_status': None}
        file_error(out, j, snap, args.model, 2, last)
        found[j['id']] = ('error', {'error': last})
        print(json.dumps({'job': j['id'], 'kind': j['kind'], 'verdict': 'error',
                          'http_status': last.get('http_status')}), flush=True)
        return 'error'
    except Exception as error:
        last = save_error(retry_dir, error)
        file_error(out, j, snap, args.model, 2, last)
        found[j['id']] = ('error', {'error': last})
        print(json.dumps({'job': j['id'], 'kind': j['kind'], 'verdict': 'error',
                          'http_status': last.get('http_status')}), flush=True)
        return 'error'


def bind_config(out, snap, args):
    config = {'model': args.model, 'endpoint': args.endpoint, 'jobs_sha256': snap['jobs_sha256']}
    config_path = out / 'api-config.json'
    if config_path.exists():
        if audit.read_json(config_path) != config:
            raise ValueError('Run configuration differs from the saved API configuration')
    else:
        audit.write_json(config_path, config)


def corpus_jobs(snap, jobs, found, allowed, kind, claimed, requeue_errors=False):
    if not requeue_errors:
        audit.ensure_gate(snap, jobs, found, 'corpus')
    queued = deque()
    for key, j in jobs.items():
        if requeue_errors:
            if key not in found or found[key][0] != 'error' or key in claimed:
                continue
        elif key in found or key in claimed or key == snap['calibration_id']:
            continue
        if allowed is not None and j['image_sha256'] not in allowed:
            continue
        if kind and j['kind'] != kind:
            continue
        queued.append(j)
    return queued


def run(args):
    if args.limit < 1:
        raise ValueError('--limit must be positive')
    workers = getattr(args, 'workers', 1) or 1
    if workers < 1:
        raise ValueError('--workers must be positive')
    endpoint_ok(args.endpoint)
    out = args.out.resolve()
    snap, jobs = audit.load(out)
    root = Path(snap['root'])
    # Refuse to launch a snapshot based on superseded card text.
    # Requeue of already-filed snapshot errors still uses jobs.jsonl claims.
    lesson_changed = False
    for relative, key in [('packages/mobile/src/generated/cardsIndex.generated.json', 'cards_index_sha256'),
                          ('packages/mobile/assets/data/cards.db', 'cards_db_sha256')]:
        if audit.digest((root / relative).read_bytes()) != snap[key]:
            lesson_changed = True
            if not getattr(args, 'requeue_errors', False):
                raise ValueError('Lesson inputs changed; prepare a new snapshot before spending')
    if lesson_changed:
        print(json.dumps({'warning': 'lesson_inputs_changed', 'requeue_errors': True}), flush=True)
    allowed = None
    images_file = getattr(args, 'images_file', None)
    if args.slug or images_file:
        inventory = audit.read_json(out / 'inventory.json')
        if args.slug:
            allowed = {i['sha256'] for i in inventory
                       if any(s['slug'] == args.slug for s in i['sources'])}
            if not allowed:
                raise ValueError('Requested slug is absent from this snapshot')
        if images_file:
            wanted = {line.strip() for line in Path(images_file).read_text().splitlines() if line.strip()}
            extra = {i['sha256'] for i in inventory
                     if i['image'] in wanted or Path(i['image']).stem in wanted
                     or any(s['slug'] in wanted for s in i['sources'])}
            allowed = extra if allowed is None else (allowed & extra)
            if not allowed:
                raise ValueError('images-file matched no snapshot images')
    job_id = getattr(args, 'job_id', None)
    kind = getattr(args, 'kind', None)
    if job_id:
        if job_id not in jobs:
            raise ValueError('Unknown job id')
        if allowed is not None and jobs[job_id]['image_sha256'] not in allowed:
            raise ValueError('Requested job is outside --slug')
        if kind and jobs[job_id]['kind'] != kind and jobs[job_id]['kind'] != 'calibration':
            raise ValueError('Requested job is outside --kind')
    key = credential(args.env_file)
    found = audit.results(out, jobs)
    (out / 'attempts').mkdir(exist_ok=True)
    bind_config(out, snap, args)

    claimed = set()
    pick_lock = threading.Lock()
    stop = threading.Event()
    state = {'finished': 0, 'queue': None, 'fatal': None}
    print(json.dumps({'event': 'start', 'workers': workers, 'limit': args.limit,
                      'kind': kind, 'job_id': job_id,
                      'requeue_errors': getattr(args, 'requeue_errors', False)}), flush=True)

    def pick():
        with pick_lock:
            if stop.is_set() or state['finished'] >= args.limit:
                return None
            gate = snap['calibration_id']
            if job_id:
                j = jobs[job_id]
                if j['id'] in found or j['id'] in claimed:
                    return None
                if gate not in found and j['id'] != gate:
                    return 'WAIT'
                if gate in found and j['id'] != gate:
                    try:
                        audit.ensure_gate(snap, jobs, found, 'corpus')
                    except ValueError as error:
                        state['fatal'] = error
                        stop.set()
                        return None
                claimed.add(j['id'])
                state['finished'] += 1
                return j
            if gate not in found:
                if gate in claimed:
                    return 'WAIT'
                claimed.add(gate)
                state['finished'] += 1
                return jobs[gate]
            if state['queue'] is None:
                try:
                    state['queue'] = corpus_jobs(snap, jobs, found, allowed, kind, claimed,
                                                requeue_errors=getattr(args, 'requeue_errors', False))
                except ValueError as error:
                    state['fatal'] = error
                    stop.set()
                    return None
            if not state['queue']:
                return None
            j = state['queue'].popleft()
            claimed.add(j['id'])
            state['finished'] += 1
            return j

    def worker():
        opener = urllib.request.build_opener(NoRedirect())
        while not stop.is_set():
            j = pick()
            if j == 'WAIT':
                time.sleep(0.2)
                continue
            if j is None:
                return
            try:
                status = run_one(j, args, out, snap, root, key, opener, found)
            except Exception as error:
                state['fatal'] = error
                stop.set()
                print(json.dumps({'job': j['id'], 'kind': j['kind'], 'fatal': type(error).__name__}), flush=True)
                return
            if status == 'busy':
                with pick_lock:
                    claimed.discard(j['id'])
                    state['finished'] -= 1
                    if state['queue'] is not None:
                        state['queue'].appendleft(j)
                time.sleep(0.5)
                continue
            if j['kind'] == 'calibration' and status != 'reject':
                stop.set()

    if workers == 1:
        worker()
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(worker) for _ in range(workers)]
            for future in futures:
                future.result()
    audit.report(out, snap, jobs, found)
    if state['fatal'] is not None:
        raise state['fatal']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--limit', type=int, required=True,
                        help='Maximum finished jobs this invocation, including filed errors')
    parser.add_argument('--workers', type=int, default=1,
                        help='Concurrent in-process workers (default 1)')
    parser.add_argument('--kind', choices=['visual', 'alignment'],
                        help='Restrict corpus jobs to this phase; calibration still runs first if needed')
    parser.add_argument('--id', dest='job_id', help='Run or retry only this job id')
    parser.add_argument('--requeue-errors', action='store_true',
                        help='POST leftover error results into attempts/<id>/requeue/')
    parser.add_argument('--slug', help='Optional one-asset pilot, including all its card uses')
    parser.add_argument('--images-file', type=Path,
                        help='Restrict to image paths or slugs listed in this file')
    parser.add_argument('--env-file', type=Path, default=audit.ROOT / '.env.local')
    parser.add_argument('--model', default='qwen3.8-omni-flash')
    parser.add_argument('--endpoint', default=DEFAULT_ENDPOINT)
    try:
        run(parser.parse_args())
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, str(error) + '\n')

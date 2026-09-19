#!/usr/bin/env python3
"""Repair-2 / Audit-4 native batch lifecycle; immutable evidence, no retries.

Commands prepare, run, collect, review-canary, prepare-audit, and status.
Only run/collect hold the writer lock. status writes disjoint snapshots only.
Repair proposals are never installed in source files.
"""
import argparse
import collections
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import time
import types
import urllib.parse
from contextlib import contextmanager

import fresh_batch_contract as C
import gemini_batch_auditor as B
import gemini_rewriter as G
import qwen_rewriter as R
import audit3_option_key_adapter as K
import gemini_audit3_batch_v4 as A4
import gemini_audit3_batch_v5 as A5
import gemini_audit3_batch_v6 as A6

ROOT = Path(__file__).resolve().parent
TERMINAL = {'completed', 'failed', 'expired', 'cancelled'}
REMOTE = TERMINAL | {'validating', 'queued', 'in_progress', 'finalizing', 'cancelling'}
BATCH_SIZE, WINDOW, POLL_SECONDS = 500, 4, 60
STAGE_CAP, PAIR_CAP, COMBINED_CAP = 30., 60., 250.
ENCODING = 'repair2_nullable_object_explicit_enum_v1'
read = lambda p: K.parse_json(Path(p).read_text())
canonical, digest = C.T.canonical, C.T.digest


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def finite(x):
    return type(x) in (int, float) and math.isfinite(x) and x >= 0


def write(path, value, immutable=False):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + str(time.time_ns()) + '.tmp')
    with temporary.open('x') as h:
        json.dump(value, h, ensure_ascii=False, allow_nan=False, indent=2)
        h.write('\n'); h.flush(); os.fsync(h.fileno())
    try:
        if immutable:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def ensure(path, value):
    path = Path(path)
    if path.exists():
        if read(path) != value: raise ValueError('Conflicting immutable artifact: ' + str(path))
    else: write(path, value, True)


@contextmanager
def lock(out):
    out.mkdir(parents=True, exist_ok=True)
    with (out / 'run.lock').open('a') as h:
        fcntl.flock(h, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def emit(out, event, **values):
    line = json.dumps({'time': time.time(), 'event': event, **values}, ensure_ascii=False)
    with (out / 'process.log').open('a') as h: h.write(line + '\n'); h.flush()
    print(line, flush=True)


def dependencies():
    seen, todo, paths = set(), [C, B, G, R, K, A4, A5, A6], {Path(__file__).resolve()}
    while todo:
        m = todo.pop()
        if id(m) in seen: continue
        seen.add(id(m)); p = getattr(m, '__file__', None)
        if not p or not Path(p).resolve().is_relative_to(ROOT): continue
        paths.add(Path(p).resolve())
        todo.extend(x for x in vars(m).values() if isinstance(x, types.ModuleType))
    return {str(p): sha(p) for p in sorted(paths)}


def wire_schema(value):
    if isinstance(value, list): return [wire_schema(x) for x in value]
    if not isinstance(value, dict): return value
    result = {k: wire_schema(v) for k, v in value.items()}
    union = result.get('anyOf')
    if union and len(union) == 2:
        objects = [x for x in union if x.get('type') == 'object']
        nulls = [x for x in union if x == {'type': 'null'}]
        if len(objects) == len(nulls) == 1 and set(result) == {'anyOf'}:
            result = objects[0]; result['type'] = ['object', 'null']
    if 'type' not in result and result.get('enum') and all(isinstance(x, str) for x in result['enum']):
        result['type'] = 'string'
    return result


def payload(item, kind='repair'):
    if kind == 'audit': return A4.payload(item['job'])
    body = G.payload(item, R.PROMPT)
    del body['service_tier']; del body['provider']
    schema = wire_schema(body['response_format']['json_schema']['schema'])
    body['response_format']['json_schema']['schema'] = schema
    message = K.parse_json(body['messages'][1]['content']); message['response_schema'] = schema
    message['quiz']['audit'] = {'checks': copy.deepcopy(item['audit']['diagnosis']['checks'])}
    body['messages'][1]['content'] = canonical(message)
    return body


def reserve(body):
    return ((len(canonical(body).encode()) + 4096) * .375 + 8000 * 1.875) / 1e6


def rows(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        x = K.parse_json(line); key = x['key']
        if key in result or key != x['job']['key']: raise ValueError('Duplicate or inconsistent job key')
        result[key] = x
    return result


def prepare(out, scope):
    scope = scope.resolve(); items = rows(scope)
    if len(items) != 1083: raise ValueError('Repair-2 requires exactly 1,083 frozen flagged jobs')
    evidence = {str(scope): sha(scope)}
    base = scope.parent
    source = read(base / 'repair-scope.json'); evidence[str(base / 'repair-scope.json')] = sha(base / 'repair-scope.json')
    jobs_path = Path(source['jobs']); evidence[str(jobs_path)] = sha(jobs_path)
    if sha(jobs_path) != source['jobs_sha256'] or sha(scope) != source['repair_input_sha256']:
        raise ValueError('Frozen repair scope changed')
    originals = {j['key']: j for j in map(K.parse_json, jobs_path.read_text().splitlines())}
    counts = collections.Counter(); caches = {v: {} for v in ('v4','v5','v6')}
    for key, item in items.items():
        job = item['job']; audit = item['audit']; version = audit['audit_version']
        if originals.get(key) != job or version not in source['audit_runs']: raise ValueError('Repair provenance differs')
        prior = Path(source['audit_runs'][version]); finalpath = prior / 'results' / key / 'final.json'
        final = read(finalpath)
        verified = {'v4': A4, 'v5': A5, 'v6': A6}[version].verify_result(prior, key, originals, caches[version])
        if final != verified: raise ValueError('Audit-3 native receipt no longer verifies')
        if (final['status'] != 'flagged' or final.get('answer_matches') is not True
                or final['diagnosis'] != audit['diagnosis'] or audit['diagnosis']['whole_quiz']['status'] != 'ok'):
            raise ValueError('Repair candidate is not a source-safe verified flag')
        G.flex.audit.validate({'choices': [{'finish_reason': 'stop', 'message': {'content': canonical(audit['diagnosis'])}}]}, job['content'])
        evidence[str(finalpath)] = sha(finalpath)
        origin = read(finalpath.parent / 'batch-origin.json')
        batch_dir = prior / 'batches' / origin['batch']
        for folder, names in ((finalpath.parent, ('request.json','response.json','batch-origin.json','batch-receipt.json','decoded-diagnosis.json','batch-result.json')),
                              (batch_dir, ('request.json','manifest.json','accepted.json','submission-intent.json','terminal.json','billing.json','collected.json'))):
            for name in names:
                p = folder / name
                if p.exists(): evidence[str(p)] = sha(p)
        counts[job['content']['language']] += 1
    integration = jobs_path.parent / 'manifest.json'
    integrated = A4.validate_integration(jobs_path, integration, originals)
    evidence[str(integration)] = sha(integration)
    for path, info in integrated['source_files'].items():
        evidence[path] = info['after_sha256']
    for info in integrated.get('candidate_source_files', []):
        evidence[info['path']] = info['sha256']
    prior_report = Path(source['audit_runs']['v6']) / 'report.json'
    prior = read(prior_report); proc = read(prior_report.parent / 'process.json')
    if proc['status'] != 'finished' or prior['outstanding_batches'] != 0: raise ValueError('Audit-3 must be drained')
    baseline = prior['combined_accounted_usd']
    if not finite(baseline) or baseline + PAIR_CAP > COMBINED_CAP: raise ValueError('Pair budget exceeds combined ceiling')
    evidence[str(prior_report)] = sha(prior_report)
    plan = [{'key': k, 'item_sha256': digest(x), 'body_sha256': digest(payload(x)),
             'schema_sha256': digest(payload(x)['response_format']), 'reserved_usd': reserve(payload(x))} for k, x in items.items()]
    if sum(p['reserved_usd'] for p in plan) > STAGE_CAP: raise ValueError('Conservative repairs exceed $30 stage cap')
    ensure(out / 'plan.json', plan)
    config = {'version': 1, 'stage': 'Repair-2', 'kind': 'repair', 'scope': str(scope), 'scope_sha256': sha(scope),
        'selected': len(items), 'by_language': dict(counts), 'model': C.MODEL, 'canonical_model': C.CANONICAL_MODEL,
        'schema_encoding': ENCODING, 'budget_usd': STAGE_CAP, 'pair_budget_usd': PAIR_CAP,
        'combined_budget_usd': COMBINED_CAP, 'baseline_combined_usd': baseline, 'prior_pair_usd': 0.,
        'plan_sha256': sha(out / 'plan.json'), 'dependencies_sha256': dependencies(), 'evidence_sha256': evidence,
        'prompt_sha256': digest(R.PROMPT), 'batch_size': BATCH_SIZE, 'maximum_outstanding_batches': WINDOW,
        'canary_size': 2, 'poll_seconds': POLL_SECONDS, 'automatic_retries': 0, 'private_answer_sent': False,
        'diagnosis_guided_proposals_only': True, 'total_conservative_reservation_usd': sum(x['reserved_usd'] for x in plan)}
    ensure(out / 'config.json', config)
    ensure(out / 'authorization.json', {'approved': True, 'user_authorization': "Ok let's do it, let's call this run Repair-2, followed by Audit-4. I'm giving you permission to spend up to $60 on this run.",
        'autonomy': 'Run autonomously through Repair-2 collection and the authorized Audit-4 handover.',
        'stage_cap_usd': STAGE_CAP, 'pair_cap_usd': PAIR_CAP, 'combined_cap_usd': COMBINED_CAP,
        'config_sha256': sha(out / 'config.json')})
    return config


def frozen(out):
    config = read(out / 'config.json')
    if (config['dependencies_sha256'] != dependencies() or config['scope_sha256'] != sha(config['scope'])
            or config['plan_sha256'] != sha(out / 'plan.json') or config['budget_usd'] != STAGE_CAP
            or config['pair_budget_usd'] != PAIR_CAP or config['combined_budget_usd'] != COMBINED_CAP):
        raise ValueError('Frozen code, input, plan or budget changed')
    if read(out / 'authorization.json')['config_sha256'] != sha(out / 'config.json'): raise ValueError('Authorization differs')
    for path, expected in config['evidence_sha256'].items():
        if sha(path) != expected: raise ValueError('Frozen provenance changed: ' + path)
    items = rows(config['scope']); plan = read(out / 'plan.json')
    for p in plan:
        item = items[p['key']]; body = payload(item, config['kind'])
        if p['item_sha256'] != digest(item) or p['body_sha256'] != digest(body) or p['reserved_usd'] != reserve(body):
            raise ValueError('Plan no longer matches exact requests')
    return config, items, plan


def batches(out):
    return sorted((out / 'batches').glob('[0-9]' * 6))


def state(d):
    for name in ('terminal.json', 'status.json', 'accepted.json'):
        if (d / name).exists(): return read(d / name)['status']
    return 'unknown'


def validate_remote(raw, envelope, identifier=None):
    if (not isinstance(raw, dict) or not isinstance(raw.get('id'), str) or not raw['id']
            or raw.get('model') not in C.MODELS or raw.get('endpoint') != '/v1/chat/completions'
            or raw.get('status') not in REMOTE or type(raw.get('request_counts', {}).get('total')) is not int
            or raw['request_counts']['total'] != len(envelope['requests']) or (identifier and raw['id'] != identifier)):
        raise ValueError('Native batch identity/route/count mismatch')


def checked_batch(out, d, items, config):
    manifest = read(d / 'manifest.json'); envelope = read(d / 'request.json')
    keys = manifest['keys']
    if (not keys or len(keys) > BATCH_SIZE or len(set(keys)) != len(keys) or any(k not in items for k in keys)
            or manifest['config_sha256'] != sha(out / 'config.json') or manifest['request_sha256'] != sha(d / 'request.json')
            or envelope != {'endpoint': '/v1/chat/completions', 'model': C.MODEL,
                'requests': [{'custom_id': k, 'body': payload(items[k], config['kind'])} for k in keys]}):
        raise ValueError('Native batch request provenance changed')
    C._requests(envelope['requests'])
    if manifest['reserved_usd'] != sum(reserve(row['body']) for row in envelope['requests']): raise ValueError('Reservation changed')
    intent = read(d / 'submission-intent.json')
    if intent['request_sha256'] != manifest['request_sha256']: raise ValueError('Intent changed')
    return manifest, envelope


def bill(d, envelope):
    accepted = read(d / 'accepted.json'); terminal = read(d / 'terminal.json')
    validate_remote(accepted, envelope); validate_remote(terminal, envelope, accepted['id'])
    checked = C.validate_batch(terminal, envelope['requests'])
    value = {'batch_id': accepted['id'], 'terminal_sha256': sha(d / 'terminal.json'),
             'received_cost_usd': checked['received_cost_usd'], 'usage': checked['usage']}
    if value['received_cost_usd'] > read(d / 'manifest.json')['reserved_usd'] + 1e-6: raise ValueError('Batch bill exceeds reservation')
    return checked, value


def derive(out, d, item, row, checked, config):
    key = row['custom_id']; record = checked['results'][key]; response = record.get('response') or {}
    raw, code = response.get('body'), response.get('status_code')
    files = {'batch-result.json': record, 'request.json': row['body']}; fatal = False
    origin = {'stage': config['stage'], 'key': key, 'batch_id': read(d / 'accepted.json')['id'], 'batch': d.name,
        'config_sha256': sha(out / 'config.json'), 'item_sha256': digest(item), 'request_sha256': sha(d / 'request.json'),
        'accepted_sha256': sha(d / 'accepted.json'), 'terminal_sha256': sha(d / 'terminal.json'),
        'response_sha256': digest(raw), 'schema_encoding': config['schema_encoding']}
    files['batch-origin.json'] = origin
    files['batch-receipt.json'] = {'kind': 'allocation_of_actual_batch_charge', 'origin_sha256': digest(origin),
        'batch_id': origin['batch_id'], 'key': key, 'terminal_sha256': origin['terminal_sha256'],
        'batch_received_cost_usd': checked['received_cost_usd'], 'allocated_received_cost_usd': checked['allocations'][key]['received_cost_usd'],
        'allocation_method': C.ALLOCATION_METHOD, 'received_usage': checked['allocations'][key]['received_usage']}
    if isinstance(raw, dict): files['response.json'] = raw
    try:
        if code != 200 or record.get('error') or not isinstance(raw, dict): raise ValueError('Native request transport failure')
        if config['kind'] == 'repair':
            final = G.validate(raw, item)
        else:
            final = K.validate_wire_response(raw, item['job']['content'])
        files['final.json'] = final
    except (ValueError, KeyError, TypeError, IndexError) as error:
        fatal = code in (401,402,403,404,429) or str((record.get('error') or {}).get('code')) in ('401','402','403','404','429')
        files['error.json'] = {'kind': 'transport' if code != 200 or record.get('error') else 'invalid_output',
            'error': str(error), 'http_status': code, 'provider_detail': record.get('error'), 'fatal': fatal, 'automatic_retry': False}
    return files, fatal


def collect_terminal(out, d, items, config):
    _, envelope = checked_batch(out, d, items, config)
    checked, value = bill(d, envelope); ensure(d / 'billing.json', value)
    counts = collections.Counter(); fatal = False
    for row in envelope['requests']:
        key = row['custom_id']; files, bad = derive(out, d, items[key], row, checked, config); fatal |= bad
        for name in ('final.json', 'error.json', 'response.json'):
            if name not in files and (out / 'results' / key / name).exists(): raise ValueError('Conflicting result outcome')
        for name, content in files.items(): ensure(out / 'results' / key / name, content)
        counts[files.get('final.json', {}).get('status', 'errors')] += 1
    ensure(d / 'collected.json', {'requests': len(envelope['requests']), 'counts': dict(counts), 'terminal_sha256': value['terminal_sha256']})
    emit(out, 'cloud_collected', batch=d.name, counts=dict(counts), cost_usd=value['received_cost_usd'])
    if d.name == '000001':
        if counts['errors'] or (config['kind']=='repair' and not counts['proposal']): raise ValueError('Canary failed; bulk gate remains closed')
        ensure(out / 'canary-passed.json', {'batch': d.name, 'keys': [r['custom_id'] for r in envelope['requests']],
            'config_sha256': sha(out / 'config.json'), 'terminal_sha256': value['terminal_sha256']})
    if fatal or counts['errors'] >= 10: raise ValueError('Fatal/substantial per-item failures; stop admission')


def block(out, error):
    ensure(out / 'BLOCKED.json', read(out / 'BLOCKED.json') if (out / 'BLOCKED.json').exists() else
           {'time': time.time(), 'reason': str(error), 'automatic_resume': False})


def snapshot(out, config, items, verify=False):
    seen = set(); batch_rows = []; received = unknown = active = 0.; counts = collections.Counter()
    cached = {}; events = []
    for d in batches(out):
        manifest, envelope = checked_batch(out, d, items, config); keys = manifest['keys']
        if seen.intersection(keys): raise ValueError('Repeated key across batches')
        seen.update(keys)
        accepted = read(d / 'accepted.json') if (d / 'accepted.json').exists() else None
        if accepted: validate_remote(accepted, envelope)
        current = state(d)
        if (d / 'billing.json').exists():
            checked, expected = bill(d, envelope)
            if read(d / 'billing.json') != expected: raise ValueError('Billing receipt changed')
            received += expected['received_cost_usd']; cached[d.name] = checked
        elif accepted and current not in TERMINAL: active += manifest['reserved_usd']
        else: unknown += manifest['reserved_usd']
        batch_rows.append({'batch': d.name, 'id': accepted['id'] if accepted else None, 'status': current,
            'requests': len(keys), 'request_counts': read(d / 'status.json').get('request_counts') if (d/'status.json').exists() else None,
            'collected': (d/'collected.json').exists(), 'poll_age_seconds': time.time()-read(d/'poll.json').get('last_poll_at',read(d/'poll.json')['accepted_at']) if (d/'poll.json').exists() else None})
        for row in envelope['requests']:
            key = row['custom_id']; local = out/'results'/key
            final = read(local/'final.json') if (local/'final.json').exists() else None
            err = read(local/'error.json') if (local/'error.json').exists() else None
            if verify and (final or err):
                expected, _ = derive(out,d,items[key],row,cached[d.name],config)
                for name,x in expected.items():
                    if read(local/name)!=x: raise ValueError('Result provenance changed: '+key+'/'+name)
            if final: counts[final['status']]+=1
            elif err: counts['errors']+=1
            events.append((d.name,key,bool(err))) if final or err else None
    for local in (out/'results').glob('*'):
        if local.name not in seen and any(local.iterdir()): raise ValueError('Orphan durable attempt')
    latest=[x[2] for x in events[-100:]]
    threshold=sum(latest)>=10 or any(all(x[2] for x in events[i:i+3]) for i in range(max(0,len(events)-2)))
    proc=read(out/'process.json') if (out/'process.json').exists() else {}
    actual=''
    if proc.get('pid'):
        r=subprocess.run(['ps','-p',str(proc['pid']),'-o','command='],capture_output=True,text=True)
        actual=r.stdout.strip() if r.returncode==0 else ''
    current_cost=received+unknown+active
    return {'time':time.time(),'stage':config['stage'],'selected':len(items),'counts':dict(counts),
        'unsubmitted':len(items)-len(seen),'batches':batch_rows,'batches_accepted':sum(bool(x['id']) for x in batch_rows),
        'batches_collected':sum(x['collected'] for x in batch_rows),'outstanding_batches':sum(bool(x['id']) and not x['collected'] for x in batch_rows),
        'received_cost_usd':received,'unknown_reserved_usd':unknown,'active_reserved_usd':active,'stage_exposure_usd':current_cost,
        'pair_exposure_usd':config['prior_pair_usd']+current_cost,'combined_exposure_usd':config['baseline_combined_usd']+config['prior_pair_usd']+current_cost,
        'budget_usd':STAGE_CAP,'pair_budget_usd':PAIR_CAP,'combined_budget_usd':COMBINED_CAP,
        'failure_threshold':threshold,'process':proc,'process_verified_running':bool(actual) and actual==proc.get('exact_command'),
        'blocked':read(out/'BLOCKED.json') if (out/'BLOCKED.json').exists() else None}


def report(out, config, items):
    value=snapshot(out,config,items,True); records=[]
    for key,item in items.items():
        p=out/'results'/key/'final.json'
        if p.exists(): records.append({'key':key,'language':item['job']['content']['language'],**read(p)})
    name='proposals.jsonl' if config['kind']=='repair' else 'diagnoses.jsonl'
    temporary=out/(name+'.tmp'); temporary.write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in records)); temporary.replace(out/name)
    write(out/'summary.json',value)
    return value


def gate(out):
    if not (out/'CANARY-REVIEWED.json').exists(): return False
    proof=read(out/'CANARY-REVIEWED.json'); passed=read(out/'canary-passed.json')
    if proof.get('approved') is not True or proof.get('terminal_sha256') != sha(out/'batches'/'000001'/'terminal.json') or proof['terminal_sha256']!=passed['terminal_sha256'] or proof.get('config_sha256')!=sha(out/'config.json'):
        raise ValueError('Canary handover changed')
    return True


def submit(out,config,items,keys,network=B.network):
    manifest_keys=set(k for d in batches(out) for k in read(d/'manifest.json')['keys'])
    if manifest_keys.intersection(keys) or not keys: raise ValueError('No attempted card may be repeated')
    value=snapshot(out,config,items,True)
    if (value['blocked'] or (out/'STOP').exists() or value['failure_threshold'] or any(x['status'] in TERMINAL-{'completed'} or not x['id'] for x in value['batches'])):
        raise ValueError('Admissions stopped')
    if batches(out) and not gate(out): raise ValueError('Canary gate closed')
    if not batches(out) and len(keys)!=2: raise ValueError('First batch requires two new canary keys')
    if len(keys)>BATCH_SIZE or len(set(keys))!=len(keys): raise ValueError('Invalid upload size or duplicate keys')
    if sum(bool(x['id']) and not x['collected'] for x in value['batches'])>=WINDOW: raise ValueError('Cloud window full')
    envelope={'endpoint':'/v1/chat/completions','model':C.MODEL,'requests':[{'custom_id':k,'body':payload(items[k],config['kind'])} for k in keys]}
    C._requests(envelope['requests']); amount=sum(reserve(x['body']) for x in envelope['requests'])
    if value['stage_exposure_usd']+amount>STAGE_CAP or value['pair_exposure_usd']+amount>PAIR_CAP or value['combined_exposure_usd']+amount>COMBINED_CAP:
        raise ValueError('Cannot reserve next batch within authorized budgets')
    d=out/'batches'/f'{len(batches(out))+1:06d}'
    ensure(d/'request.json',envelope)
    ensure(d/'manifest.json',{'keys':keys,'reserved_usd':amount,'request_sha256':sha(d/'request.json'),'config_sha256':sha(out/'config.json')})
    ensure(d/'submission-intent.json',{'time':time.time(),'request_sha256':sha(d/'request.json'),'automatic_retry':False})
    emit(out,'cloud_submit_intent',batch=d.name,requests=len(keys),reservation_usd=amount)
    try:
        code,raw=network(B.API,data=(d/'request.json').read_bytes(),timeout=300)
        ensure(d/'submission-response.json',raw)
        if code!=202: raise ValueError('Submission not HTTP202; outcome remains unknown')
        validate_remote(raw,envelope); ensure(d/'accepted.json',raw); write(d/'status.json',raw)
        accepted_at=time.time(); write(d/'poll.json',{'accepted_at':accepted_at,'next_poll_at':accepted_at+POLL_SECONDS})
        emit(out,'cloud_accepted',batch=d.name,id=raw['id'],requests=len(keys))
    except Exception as e:
        ensure(d/'submission-error.json',{'time':time.time(),'error':str(e),'automatic_retry':False}); block(out,e); raise


def poll(out,d,items,config,network=B.network):
    _,envelope=checked_batch(out,d,items,config)
    accepted=read(d/'accepted.json'); schedule=read(d/'poll.json'); now=time.time()
    if (d/'terminal.json').exists():
        if state(d)!='completed': raise ValueError('Terminal provider failure requires billing reconciliation')
        collect_terminal(out,d,items,config); return
    if now<schedule['next_poll_at']: return
    write(d/'poll.json',{**schedule,'last_poll_at':now,'next_poll_at':now+POLL_SECONDS})
    try:
        code,raw=network(B.API+'/'+urllib.parse.quote(accepted['id'],safe=''),timeout=300)
        if code!=200: raise ValueError('Poll not HTTP200')
        validate_remote(raw,envelope,accepted['id']); write(d/'status.json',raw)
        emit(out,'cloud_poll',batch=d.name,id=accepted['id'],status=raw['status'],request_counts=raw.get('request_counts'))
        if raw['status'] in TERMINAL:
            ensure(d/'terminal.json',raw)
            if raw['status']!='completed': raise ValueError('Terminal provider failure: '+raw['status'])
            collect_terminal(out,d,items,config)
    except Exception as e:
        ensure(d/'poll-errors'/f'{time.time_ns()}.json',{'time':now,'error':str(e),'method':'GET','batch_id':accepted['id']})
        if str(e).startswith('HTTP 404:') and now-schedule['accepted_at']<900:
            emit(out,'cloud_visibility_pending',batch=d.name,id=accepted['id']); return
        raise


def run(out,collect_only=False):
    config,items,plan=frozen(out)
    if (out/'BLOCKED.json').exists() and not collect_only: raise ValueError('Blocked run; no automatic resume')
    old=read(out/'process.json') if (out/'process.json').exists() else None
    if old and not collect_only: raise ValueError('A launch already exists; paid coordinator cannot be relaunched automatically')
    argv=getattr(sys,'orig_argv',[sys.executable,*sys.argv])
    proc={'pid':os.getpid(),'started':time.time(),'status':'running','mode':'collect' if collect_only else 'native_batch','argv':argv,'exact_command':shlex.join(argv)}
    ensure(out/'run-argv.json',list(argv)) if not collect_only else None
    write(out/'process.json',proc); stopping=[]
    for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,lambda s,f:stopping.append(s))
    try:
        while True:
            config, items, plan = frozen(out)
            errors=[]
            for d in batches(out):
                if not (d/'accepted.json').exists(): errors.append('Unknown submission '+d.name); continue
                if (d/'collected.json').exists(): continue
                try: poll(out,d,items,config)
                except Exception as e: errors.append(str(e)); block(out,e)
            if errors: raise ValueError('; '.join(errors))
            value=snapshot(out,config,items,True)
            if value['failure_threshold']: block(out,'Three consecutive or ten in latest100 technical failures')
            if not collect_only and not stopping and not (out/'STOP').exists() and not (out/'BLOCKED.json').exists():
                while sum(not (d/'collected.json').exists() for d in batches(out))<WINDOW:
                    if batches(out) and not gate(out): break
                    used=set(k for d in batches(out) for k in read(d/'manifest.json')['keys'])
                    pending=[p for p in plan if p['key'] not in used]
                    if not pending: break
                    group=pending[0]['schema_sha256']; n=2 if not batches(out) else BATCH_SIZE
                    keys=[p['key'] for p in pending if p['schema_sha256']==group][:n]
                    if not batches(out):
                        pool=[p['key'] for p in pending if p['schema_sha256']==group]
                        languages=[next((k for k in pool if items[k]['job']['content']['language']==lang),None) for lang in ('tl','bis')]
                        if all(languages): keys=languages
                    submit(out,config,items,keys)
                    if not gate(out): break
            value=report(out,config,items)
            emit(out,'progress',counts=value['counts'],unsubmitted=value['unsubmitted'],outstanding=value['outstanding_batches'],exposure_usd=value['stage_exposure_usd'])
            if not value['outstanding_batches'] and (not value['unsubmitted'] or collect_only or stopping or (out/'STOP').exists() or (out/'BLOCKED.json').exists()):
                proc['status']='finished' if not value['unsubmitted'] else 'stopped'; break
            for _ in range(POLL_SECONDS):
                time.sleep(1)
    except BaseException as e:
        proc.update(status='stopped',reason=str(e)); block(out,e); raise
    finally:
        proc['ended']=time.time(); write(out/'process.json',proc); report(out,config,items)


def review_canary(out):
    config,items,_=frozen(out); d=out/'batches'/'000001'
    if not (d/'collected.json').exists(): raise ValueError('Canary not collected')
    value=snapshot(out,config,items,True); collected=read(d/'collected.json')
    if collected['requests']!=2 or collected['counts'].get('errors',0) or (config['kind']=='repair' and not collected['counts'].get('proposal',0)):
        raise ValueError('Canary has no safe structural handover')
    passed=read(out/'canary-passed.json')
    proof={'approved':True,'config_sha256':sha(out/'config.json'),'terminal_sha256':sha(d/'terminal.json'),
        'canary_keys':passed['keys'],'reviewed_at':time.time(),'evidence':'Independently recomputed native identity, aggregate bill, receipts, field restrictions and complete validated outcomes; proposal text awaits Audit-4.'}
    if (out/'CANARY-REVIEWED.json').exists():
        if not gate(out): raise ValueError('Conflicting canary approval')
    else: ensure(out/'CANARY-REVIEWED.json',proof)
    return value


def prepare_audit(repair, out):
    config, items, _ = frozen(repair)
    value = snapshot(repair, config, items, True)
    if config['kind'] != 'repair' or value['process'].get('status') != 'finished' or value['outstanding_batches'] or value['unsubmitted']:
        raise ValueError('Repair-2 must be finished with every accepted request collected')
    selected = []
    evidence = dict(config['evidence_sha256'])
    for name in ('config.json','authorization.json','process.json','plan.json'):
        evidence[str(repair / name)] = sha(repair / name)
    for d in batches(repair):
        for name in ('request.json','manifest.json','submission-intent.json','accepted.json','terminal.json','billing.json','collected.json'):
            evidence[str(d / name)] = sha(d / name)
    for key, item in items.items():
        local = repair / 'results' / key
        for p in local.glob('*.json'): evidence[str(p)] = sha(p)
        if not (local / 'final.json').exists(): continue
        final = read(local / 'final.json')
        if final['status'] != 'proposal': continue
        job = copy.deepcopy(item['job']); job['content']['target'] = copy.deepcopy(final['result']['proposed'])
        selected.append({'key': key, 'job': job, 'repair_origin': {'source_item_sha256': digest(item),
            'final_sha256': sha(local / 'final.json'), 'receipt_sha256': sha(local / 'batch-receipt.json')}})
    if len(selected) < 2: raise ValueError('Fewer than two validated repair proposals; Audit-4 cannot start')
    out.mkdir(parents=True, exist_ok=True)
    scope = out / 'audit-input.jsonl'
    text = ''.join(json.dumps(x, ensure_ascii=False, separators=(',', ':')) + '\n' for x in selected)
    if scope.exists():
        if scope.read_text() != text: raise ValueError('Audit-4 scope conflicts')
    else:
        with scope.open('x') as h: h.write(text); h.flush(); os.fsync(h.fileno())
    plan = [{'key': x['key'], 'item_sha256': digest(x), 'body_sha256': digest(payload(x,'audit')),
        'schema_sha256': digest(payload(x,'audit')['response_format']), 'reserved_usd': reserve(payload(x,'audit'))} for x in selected]
    if sum(p['reserved_usd'] for p in plan) > STAGE_CAP: raise ValueError('Audit-4 conservative reservation exceeds cap')
    ensure(out / 'plan.json', plan)
    audit_config = {'version': 1, 'stage': 'Audit-4', 'kind': 'audit', 'scope': str(scope), 'scope_sha256': sha(scope),
        'selected': len(selected), 'by_language': dict(collections.Counter(x['job']['content']['language'] for x in selected)),
        'model': C.MODEL, 'canonical_model': C.CANONICAL_MODEL, 'schema_encoding': A4.SCHEMA_ENCODING,
        'budget_usd': STAGE_CAP, 'pair_budget_usd': PAIR_CAP, 'combined_budget_usd': COMBINED_CAP,
        'baseline_combined_usd': config['baseline_combined_usd'], 'prior_pair_usd': value['stage_exposure_usd'],
        'plan_sha256': sha(out / 'plan.json'), 'dependencies_sha256': dependencies(), 'evidence_sha256': evidence,
        'prompt_sha256': digest(A4.PROMPT), 'batch_size': BATCH_SIZE, 'maximum_outstanding_batches': WINDOW,
        'canary_size': 2, 'poll_seconds': POLL_SECONDS, 'automatic_retries': 0, 'private_answer_sent': False,
        'repair_counts': value['counts'], 'total_conservative_reservation_usd': sum(x['reserved_usd'] for x in plan)}
    ensure(out / 'config.json', audit_config)
    ensure(out / 'authorization.json', {'approved': True, 'scope': 'Audit all structurally verified Repair-2 proposals; held and invalid outcomes are preserved separately.',
        'user_authorization': read(repair / 'authorization.json')['user_authorization'],
        'stage_cap_usd': STAGE_CAP, 'pair_cap_usd': PAIR_CAP, 'combined_cap_usd': COMBINED_CAP,
        'config_sha256': sha(out / 'config.json')})
    return {k: audit_config[k] for k in ('stage','selected','by_language','total_conservative_reservation_usd')}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('command',choices=('prepare','run','collect','review-canary','prepare-audit','status'))
    ap.add_argument('--out',type=Path,required=True); ap.add_argument('--scope',type=Path); ap.add_argument('--snapshot',type=Path)
    ap.add_argument('--audit-out',type=Path)
    args=ap.parse_args(); out=args.out.resolve()
    if args.command=='status':
        config,items,_=frozen(out); value=snapshot(out,config,items,True)
        if args.snapshot:
            target=args.snapshot.resolve()
            if target.is_relative_to(out) or out.is_relative_to(target): raise ValueError('Monitoring output must be separate')
            write(target/'latest.json',value)
            lines = [f"# {value['stage']} progress", '',
                f"Process verified running: {value['process_verified_running']}; saved status: {value['process'].get('status', 'not launched')}.",
                f"Selected: {value['selected']}; outcomes: {json.dumps(value['counts'])}; unsubmitted: {value['unsubmitted']}.",
                f"Received: ${value['received_cost_usd']:.6f}; unknown reserved: ${value['unknown_reserved_usd']:.6f}; active reserved: ${value['active_reserved_usd']:.6f}.",
                f"Pair exposure: ${value['pair_exposure_usd']:.6f} / $60; combined exposure: ${value['combined_exposure_usd']:.6f} / $250.", '',
                '| Batch | Provider ID | Status | Requests | Provider counts | Collected | Last poll age (s) |',
                '|---|---|---|---:|---|---|---:|']
            for b in value['batches']:
                age = round(b['poll_age_seconds']) if b['poll_age_seconds'] is not None else '—'
                lines.append(f"| {b['batch']} | {b['id']} | {b['status']} | {b['requests']} | {b['request_counts']} | {b['collected']} | {age} |")
            lines += ['', 'Proposals are structurally validated generated text. Same-model audits do not provide independent language certification. No cloud ETA.']
            if value['blocked']: lines += ['', 'BLOCKED: ' + str(value['blocked'])]
            (target/'latest.md').write_text('\n'.join(lines)+'\n')
        print(json.dumps(value,ensure_ascii=False)); return
    # Canary approval is the sole narrow control write permitted alongside the coordinator.
    if args.command=='review-canary': print(json.dumps(review_canary(out))); return
    if args.command=='prepare-audit':
        if not args.audit_out: ap.error('prepare-audit requires --audit-out')
        with lock(args.audit_out.resolve()): print(json.dumps(prepare_audit(out,args.audit_out.resolve())))
        return
    with lock(out):
        if args.command=='prepare':
            if not args.scope: ap.error('prepare requires --scope')
            c=prepare(out,args.scope); print(json.dumps({k:c[k] for k in ('stage','selected','by_language','total_conservative_reservation_usd')}))
        else: run(out,args.command=='collect')


if __name__=='__main__': main()

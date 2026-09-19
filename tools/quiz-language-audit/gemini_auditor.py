"""Resumable diagnosis-only OpenRouter audit. Never rewrites source quizzes."""
import argparse
import collections
import concurrent.futures
import csv
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import time
import urllib.error
import urllib.request

REPO = Path(__file__).resolve().parents[2]
PROMPT = REPO / 'tools/quiz-language-audit/runs/2026-09-12/prompt-experiment-01/experiment.py'
spec = importlib.util.spec_from_file_location('frozen_experiment', PROMPT)
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)
MODEL = 'google/gemini-3.8-flash'
URL = 'https://openrouter.ai/api/v1/chat/completions'
write = e.a.write_json


def payload(c):
    schema = e.schema(c, 'diagnose')
    data = {k: c[k] for k in ['english', 'target', 'grades', 'language']}
    data['language'] = e.a.LANGUAGES[c['language']]
    data['source_context_english'] = c.get('source_fact', {}).get('en')
    return {'model': MODEL, 'temperature': 0, 'max_tokens': 8000,
            'reasoning': {'effort': 'low', 'exclude': True},
            'provider': {'require_parameters': True, 'allow_fallbacks': False},
            'response_format': {'type': 'json_schema', 'json_schema': {'name': 'review', 'schema': schema}},
            'messages': [{'role': 'system', 'content': e.BASE + '\n' + e.DIAG},
                         {'role': 'user', 'content': e.a.canonical({'quiz': data, 'response_schema': schema})}]}


def validate(raw, c):
    choice = raw['choices'][0]
    if choice.get('finish_reason') != 'stop':
        raise ValueError('Incomplete response: ' + str(choice.get('finish_reason')))
    x = json.loads(choice['message']['content'])
    e.validate(x, e.schema(c, 'diagnose'))
    values = {'q': c['target']['q'], 'explanation': c['target']['explanation'],
              **{f'options[{i}]': v for i, v in enumerate(c['target']['options'])}}
    for field, check in x['checks'].items():
        if check['status'] != 'ok' and (not check['quote'] or check['quote'] not in values[field]):
            raise ValueError('Evidence quote absent from ' + field)
    issues = any(v['status'] == 'issue' for v in x['checks'].values())
    uncertain = any(v['status'] == 'uncertain' for v in x['checks'].values())
    if x['verdict'] == 'pass' and (issues or uncertain or x['whole_quiz']['status'] != 'ok'):
        raise ValueError('Contradictory pass')
    if x['verdict'] == 'fix' and not issues:
        raise ValueError('Fix without confirmed field issue')
    status = {'pass': 'pass', 'fix': 'flagged', 'uncertain': 'needs_review', 'source_issue': 'source_issue'}[x['verdict']]
    if x['whole_quiz']['status'] == 'source_issue':
        status = 'source_issue'
    elif x['correct_index'] != c['answer'] or uncertain or x['whole_quiz']['status'] == 'uncertain':
        status = 'needs_review'
    return {'status': status, 'diagnosis': x, 'answer_matches': x['correct_index'] == c['answer']}


def cost(raw):
    u = raw.get('usage', {})
    estimate = (u.get('prompt_tokens', 0) * .75 + u.get('completion_tokens', 0) * 3.75) / 1e6
    return max(estimate, u.get('cost') or 0)


def request(job, out, key, ceiling):
    d = out / 'results' / job['key']
    d.mkdir(parents=True, exist_ok=True)
    p = payload(job['content'])
    write(d / 'request.json', p)
    write(d / 'started.json', {'time': time.time(), 'reserved_usd': ceiling})
    fatal = False
    try:
        req = urllib.request.Request(URL, data=e.a.canonical(p).encode(), headers={
            'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=180) as response:
            raw = json.load(response)
        write(d / 'response.json', raw)
        if not raw.get('usage') or raw['usage'].get('cost') is None:
            fatal = True
            raise ValueError('Missing billing usage; stop to protect budget')
        result = validate(raw, job['content'])
        write(d / 'final.json', result)
        return False, False, cost(raw)
    except Exception as ex:
        code = ex.code if isinstance(ex, urllib.error.HTTPError) else None
        fatal = fatal or code in (401, 402, 403, 404, 429)
        detail = None
        if isinstance(ex, urllib.error.HTTPError):
            detail = ex.read(16000).decode('utf-8', errors='replace').replace(key, '[REDACTED]')
        write(d / 'error.json', {'error': str(ex).replace(key, '[REDACTED]'), 'http_status': code,
                               'provider_detail': detail, 'fatal': fatal, 'time': time.time()})
        rawfile = d / 'response.json'
        charged = cost(json.loads(rawfile.read_text())) if rawfile.exists() else ceiling
        return True, fatal, charged


def report(out, jobs):
    counts = collections.Counter()
    tokens = collections.Counter()
    spent = unknown = 0.0
    with (out / 'review.csv').open('w') as f, (out / 'diagnoses.jsonl').open('w') as j:
        writer = csv.writer(f)
        writer.writerow(['key', 'language', 'status', 'answer_matches', 'diagnosis', 'source_refs'])
        for job in jobs:
            d = out / 'results' / job['key']
            rawfile = d / 'response.json'
            if rawfile.exists():
                raw = json.loads(rawfile.read_text()); spent += cost(raw)
                u = raw.get('usage', {})
                for k in ['prompt_tokens', 'completion_tokens']:
                    tokens[k] += u.get(k, 0)
                tokens['reasoning_tokens'] += u.get('completion_tokens_details', {}).get('reasoning_tokens', 0)
            elif (d / 'started.json').exists():
                unknown += json.loads((d / 'started.json').read_text())['reserved_usd']
            if (d / 'final.json').exists():
                x = json.loads((d / 'final.json').read_text()); counts[x['status']] += 1
                writer.writerow([job['key'], job['content']['language'], x['status'], x['answer_matches'],
                                 json.dumps(x['diagnosis'], ensure_ascii=False), json.dumps(job['refs'])])
                j.write(json.dumps({'key': job['key'], 'language': job['content']['language'], **x}, ensure_ascii=False) + '\n')
            elif (d / 'started.json').exists():
                counts['errors_or_unresolved'] += 1
    # Controlled diagnostics are additional spend, outside the main job counters.
    for started in (out / 'diagnostics').glob('*/results/*/started.json'):
        rawfile = started.parent / 'response.json'
        if rawfile.exists():
            raw = json.loads(rawfile.read_text()); spent += cost(raw)
            u = raw.get('usage', {})
            for k in ['prompt_tokens', 'completion_tokens']:
                tokens[k] += u.get(k, 0)
            tokens['reasoning_tokens'] += u.get('completion_tokens_details', {}).get('reasoning_tokens', 0)
        else:
            unknown += json.loads(started.read_text())['reserved_usd']
    completed = sum(counts[k] for k in ['pass', 'flagged', 'needs_review', 'source_issue'])
    result = {'time': time.time(), 'total': len(jobs), 'completed': completed, 'counts': dict(counts),
              'pending': len(jobs) - sum(counts.values()), 'received_usage': dict(tokens),
              'received_cost_usd': spent, 'uncertain_charge_reserved_usd': unknown,
              'budget_accounted_usd': spent + unknown}
    write(out / 'report.json', result)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('command', choices=['run', 'report'])
    ap.add_argument('--jobs', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--budget', type=float, default=150)
    ap.add_argument('--concurrency', type=int, default=4)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    jobs = [json.loads(line) for line in args.jobs.read_text().splitlines()]
    if args.command == 'report':
        print(json.dumps(report(args.out, jobs))); return
    lock = (args.out / 'run.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    config = {'model': MODEL, 'endpoint': URL, 'jobs_sha256': hashlib.sha256(args.jobs.read_bytes()).hexdigest(),
              'prompt_sha256': e.a.digest([e.BASE, e.DIAG, e.schema(jobs[0]['content'], 'diagnose')]),
              'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'budget_usd': args.budget, 'concurrency': args.concurrency, 'total': len(jobs),
              'mode': 'diagnosis_only', 'reasoning_effort': 'low', 'max_tokens': 8000, 'retries': 0}
    cf = args.out / 'config.json'
    if cf.exists() and json.loads(cf.read_text()) != config:
        raise SystemExit('Configuration changed: refusing resume')
    write(cf, config)
    key = os.environ.get('OPENROUTER_API_KEY')
    if not key:
        for line in (REPO / '.env.local').read_text().splitlines():
            if line.strip().startswith('OPENROUTER_API_KEY='):
                key = line.split('=', 1)[1].strip().strip('\"\''); break
    if not key:
        raise SystemExit('Missing OpenRouter key')
    summary = report(args.out, jobs)
    spent = summary['budget_accounted_usd']; reserved = 0.0
    stop = {'reason': None}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(reason='SIGTERM'))
    signal.signal(signal.SIGINT, lambda *_: stop.update(reason='SIGINT'))
    started = time.time()
    process = {'pid': os.getpid(), 'started': started, 'status': 'running', 'command': 'gemini_auditor.py run'}
    write(args.out / 'process.json', process)
    pending = iter(j for j in jobs if not (args.out / 'results' / j['key'] / 'started.json').exists())
    recent = collections.deque(maxlen=100); consecutive = done = 0; exhausted = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        active = {}
        while active or (not exhausted and not stop['reason']):
            while len(active) < args.concurrency and not exhausted and not stop['reason']:
                job = next(pending, None)
                if job is None:
                    exhausted = True; break
                # UTF-8 bytes conservatively bound input tokens; include schema/framing allowance.
                ceiling = ((len(e.a.canonical(payload(job['content'])).encode()) + 4096) * .75 + 8000 * 3.75) / 1e6
                if spent + reserved + ceiling > args.budget:
                    stop['reason'] = 'budget ceiling'; break
                reserved += ceiling
                active[pool.submit(request, job, args.out, key, ceiling)] = ceiling
            if not active:
                break
            finished, _ = concurrent.futures.wait(active, return_when=concurrent.futures.FIRST_COMPLETED)
            for f in finished:
                reserved -= active.pop(f)
                error, fatal, charge = f.result(); spent += charge; done += 1
                recent.append(error); consecutive = consecutive + 1 if error else 0
                if fatal or consecutive >= 3 or (len(recent) == 100 and sum(recent) >= 10):
                    stop['reason'] = 'billing/API failure or sustained errors'
                print(json.dumps({'time': time.time(), 'new_completed_requests': done, 'error': error,
                                  'accounted_usd': round(spent, 6), 'stop': stop['reason']}), flush=True)
                if done % 1000 == 0:
                    report(args.out, jobs)
    summary = report(args.out, jobs)
    process.update(status='stopped' if stop['reason'] else 'finished', reason=stop['reason'], ended=time.time())
    write(args.out / 'process.json', process)
    print(json.dumps({'process': process, 'report': summary}), flush=True)


if __name__ == '__main__':
    main()

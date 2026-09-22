#!/usr/bin/env python3
"""Upload the two audit-regen batch-request files and create gpt-image-2 batches."""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path('/Users/luis/Code/hiraia')
API = 'https://api.openai.com/v1'


def load_key():
    key = os.environ.get('OPENAI_API_KEY')
    if key:
        return key
    env = ROOT / '.env.local'
    if env.is_file():
        for line in env.read_text().splitlines():
            m = re.match(r'^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$', line)
            if m:
                value = m[1].strip().strip('\'"')
                if value:
                    return value
    raise SystemExit('OPENAI_API_KEY not found')


def req(key, url, data=None, method=None, headers=None, tries=6):
    h = {'Authorization': 'Bearer ' + key}
    if headers:
        h.update(headers)
    for attempt in range(tries):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, data=data, method=method, headers=h), timeout=180))
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(min(60, 2 ** (attempt + 1)))
                continue
            detail = error.read()[:400].decode('utf-8', 'replace')
            print(f'HTTP {error.code} {url}: {detail}', file=sys.stderr)
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < tries - 1:
                time.sleep(min(60, 2 ** (attempt + 1)))
                continue
            raise


def upload_and_create(key, path):
    boundary = '----hiraiabatch'
    content = path.read_bytes()
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        f'Content-Type: application/json\r\n\r\n'
    ).encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    uploaded = req(key, f'{API}/files', data=body, method='POST',
                   headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    batch = req(key, f'{API}/batches', data=json.dumps({
        'input_file_id': uploaded['id'],
        'endpoint': '/v1/images/generations',
        'completion_window': '24h',
        'metadata': {'name': f'hiraia-audit-regen-{path.stem}'},
    }).encode(), method='POST', headers={'Content-Type': 'application/json'})
    return {'file': path.name, 'input_file_id': uploaded['id'],
            'batch_id': batch['id'], 'status': batch.get('status'),
            'n': sum(1 for _ in path.open() if _.strip())}


def main():
    key = load_key()
    records = []
    for name in ('batch-requests-1.jsonl', 'batch-requests-2.jsonl'):
        path = HERE / name
        if not path.is_file():
            raise SystemExit(f'missing {path}; run build.py first')
        rec = upload_and_create(key, path)
        records.append(rec)
        print(json.dumps(rec), flush=True)
    (HERE / 'batches.json').write_text(json.dumps(records, indent=2) + '\n')
    print('wrote', HERE / 'batches.json')


if __name__ == '__main__':
    main()

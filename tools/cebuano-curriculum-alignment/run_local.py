#!/usr/bin/env python3
"""Capture actual local regeneration/check exits; never infer success from files."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('name')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    assert args.command and '/' not in args.name
    folder = ROOT/'build/cebuano-curriculum-alignment/executions'/args.name
    folder.mkdir(parents=True, exist_ok=False)
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (folder/'output.txt').open('wb') as log:
        result = subprocess.run(args.command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    raw = (folder/'output.txt').read_bytes()
    receipt = {'command': args.command, 'cwd': str(ROOT), 'started_at': start,
               'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'actual_exit_code': result.returncode, 'parent_nice': os.getpriority(os.PRIO_PROCESS, 0),
               'output_sha256': hashlib.sha256(raw).hexdigest(), 'output_bytes': len(raw)}
    (folder/'execution.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(raw.decode(errors='replace')[-5000:])
    print(json.dumps(receipt))
    raise SystemExit(result.returncode)

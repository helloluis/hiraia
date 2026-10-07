#!/usr/bin/env python3
"""Run the alignment's required checks serially, retaining every actual exit."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
RUNNER = 'tools/cebuano-curriculum-alignment/run_local.py'


def checks():
    yield 'pipeline-guards', ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'rag/pipeline', '-p', 'test_card_*.py']
    yield 'pipeline-integration', ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'rag/pipeline', '-p', 'test_curriculum_language_alignment.py']
    yield 'english-review-guards', ['python3', '-B', '-m', 'unittest', 'discover', '-s', 'rag/pipeline', '-p', 'test_full_year_audit.py']
    yield 'facts-db', ['python3', 'rag/pipeline/build-facts-db.py', '--check']
    for grade in range(3, 11):
        yield f'grade{grade}-compiled', ['python3', 'rag/pipeline/compile-lessons.py', '--grade', str(grade), '--check']
    yield 'assessment-compiled', ['python3', 'packages/mobile/scripts/build-assessment-bank.py', '--check']
    yield 'similarity-compiled', ['python3', 'packages/mobile/scripts/build-lesson-similarity.py', '--check']
    yield 'tala-catalog', ['python3', 'packages/tala/scripts/build-card-catalog.py', '--check']
    mobile = ['pnpm', '--filter', '@hiraia/mobile', 'exec', 'tsx', '--test', '--test-concurrency=1']
    curriculum = [f'scripts/grade{grade}-lessons.test.mts' for grade in range(3, 11)]
    curriculum += [f'scripts/{name}.test.mts' for name in ('calendar-selection', 'curriculum-default', 'review-series',
        'term2-pilot', 'three-term-curriculum', 'full-year-curriculum', 'lesson-variety')]
    yield 'curriculum-tests', mobile + curriculum
    assessment = sorted(str(p.relative_to(ROOT/'packages/mobile')) for p in (ROOT/'packages/mobile/scripts').glob('assessment*.test.mts'))
    yield 'assessment-tests', mobile + assessment + ['src/assessment/historyRepository.test.ts', 'scripts/tala-assessment.test.mts']
    yield 'web-competencies', ['node', 'packages/web/scripts/build-competencies.mjs', '--check']
    yield 'web-terms-tests', ['pnpm', '--filter', '@hiraia/mobile', 'exec', 'tsx', '--test', '--test-concurrency=1', '../web/scripts/three-term.test.mts']
    yield 'mobile-types', ['pnpm', '--filter', '@hiraia/mobile', 'exec', 'tsc', '--noEmit']
    yield 'desktop-types', ['pnpm', '--filter', '@hiraia/mobile', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.desktop.json']
    yield 'web-types', ['pnpm', '--filter', '@hiraia/web', 'exec', 'tsc', '--noEmit']


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True, help='Unique evidence suffix; existing receipts are never overwritten')
    parser.add_argument('--only', nargs='*')
    args = parser.parse_args()
    failures = []
    for name, command in checks():
        if args.only and name not in args.only:
            continue
        print(f'CHECK {name}', flush=True)
        result = subprocess.run([sys.executable, RUNNER, f'check-{name}-{args.run}', *command], cwd=ROOT)
        if result.returncode:
            failures.append({'check': name, 'actual_exit_code': result.returncode})
    print(json.dumps({'failures': failures}), flush=True)
    raise SystemExit(bool(failures))

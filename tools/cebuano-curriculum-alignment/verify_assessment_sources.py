#!/usr/bin/env python3
"""Recheck every authoring source, preserving the original review receipts."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT/path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


if __name__ == '__main__':
    authoring = module('authoring', 'tools/assessment-evaluation/review-authoring.py')
    foundation = module('foundation', 'tools/assessment-evaluation/review-foundation.py')
    contexts, reports = {}, []
    for path in sorted((ROOT/'rag/assessment-authoring/batches').glob('*.json')):
        if path.name.endswith('.validation.json'):
            continue
        batch = json.loads(path.read_bytes())
        key = tuple(sorted((key, val['path']) for key, val in batch['source_files'].items()))
        if key not in contexts:
            contexts[key] = authoring.load_context(batch)
        errors, warnings = authoring.validate(batch, contexts[key])
        reports.append({'batch': batch['batch_id'], 'items': len(batch['items']),
                        'errors': errors, 'warnings': warnings})
    bundle = foundation.load_bundle()
    result = foundation.check_bundle(bundle)
    out = ROOT/'tools/cebuano-curriculum-alignment/assessment-source-validation-001.json'
    assert not out.exists()
    doc = {'authoring_batches': reports, 'foundation': result,
           'production_promotion': False, 'native_certification': False}
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=2)+'\n')
    errors = [(r['batch'], e) for r in reports for e in r['errors']]
    errors += [('foundation', e) for e in result['errors']]
    print(json.dumps({'batches': len(reports), 'items': sum(r['items'] for r in reports),
                      'foundation_items': result['items'], 'foundation_controls': len(result['controls']),
                      'errors': errors}, ensure_ascii=False))
    raise SystemExit(bool(errors))

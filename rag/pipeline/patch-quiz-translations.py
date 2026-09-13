#!/usr/bin/env python3
"""Patch quiz-bank.jsonl tl/bis for retranslated rows. Unpatched lines stay byte-identical.

  python3 rag/pipeline/patch-quiz-translations.py --dry-run
  python3 rag/pipeline/patch-quiz-translations.py
"""
import argparse, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quiz_xlate_rules import translation_ok

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BANK = os.path.join(ROOT, 'rag', 'bank', 'quiz-bank.jsonl')
INP = os.path.join(HERE, os.environ.get('QZ_OUT', 'quiz-retranslate'), 'translate-input.jsonl')
XDIR = os.path.join(HERE, os.environ.get('FW_XDIR', os.path.join(os.environ.get('QZ_OUT', 'quiz-retranslate'), 'xlate')))
BACKUP_SUFFIX = os.environ.get('QZ_BACKUP_SUFFIX', '.pre-retranslate.bak')


def load_input():
    by_i, by_id = {}, {}
    for line in open(INP, encoding='utf-8'):
        if not line.strip():
            continue
        r = json.loads(line)
        by_i[r['i']] = r
        by_id[r['quizId']] = r
    return by_i, by_id


def load_xlate(by_i):
    import glob
    tr = {}
    refused = 0
    for fn in sorted(glob.glob(os.path.join(XDIR, 'tl-*.jsonl')) + glob.glob(os.path.join(XDIR, 'fw-*.jsonl'))):
        for line in open(fn, encoding='utf-8'):
            if not line.strip():
                continue
            t = json.loads(line)
            src = by_i.get(t.get('i'))
            if not src:
                refused += 1
                continue
            if not translation_ok(src['options'], t):
                refused += 1
                continue
            if len(t.get('opt_tl') or []) != len(src['options']) or len(t.get('opt_bis') or []) != len(src['options']):
                refused += 1
                continue
            tr[t['i']] = t
    return tr, refused


def apply_one(row, src, t):
    """Rewrite tl+bis on q/options/explanation. id, factId, answer, option order unchanged."""
    q = dict(row.get('q') or {})
    q['tl'] = t['q_tl']
    q['bis'] = t['q_bis']
    row['q'] = q
    opts = list(row.get('options') or [])
    for k, o in enumerate(opts):
        o = dict(o)
        o['tl'] = t['opt_tl'][k]
        o['bis'] = t['opt_bis'][k]
        opts[k] = o
    row['options'] = opts
    expl = dict(row.get('explanation') or {})
    expl['tl'] = t['expl_tl']
    expl['bis'] = t['expl_bis']
    row['explanation'] = expl
    # answer still indexes the same English option
    if row.get('answer') != src.get('answer'):
        raise SystemExit(f"answer drifted on {row.get('id')}: bank {row.get('answer')} vs input {src.get('answer')}")
    en_now = [o.get('en') for o in opts]
    if en_now != src['options']:
        raise SystemExit(f"English options drifted on {row.get('id')}")
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    by_i, by_id = load_input()
    tr, refused = load_xlate(by_i)
    i_by_quiz = {src['quizId']: src['i'] for src in by_id.values()}
    patched = skipped_no_tr = other = 0
    leftover = []
    out_lines = []
    for line in open(BANK, encoding='utf-8'):
        if not line.strip():
            out_lines.append(line if line.endswith('\n') else line + '\n')
            continue
        raw = line if line.endswith('\n') else line + '\n'
        r = json.loads(line)
        qid = r.get('id')
        if qid not in by_id:
            other += 1
            out_lines.append(raw)
            continue
        src = by_id[qid]
        t = tr.get(i_by_quiz[qid])
        if not t:
            skipped_no_tr += 1
            leftover.append(qid)
            out_lines.append(raw)
            continue
        apply_one(r, src, t)
        out_lines.append(json.dumps(r, ensure_ascii=False) + '\n')
        patched += 1
    print(f'input {len(by_id)} | valid translations {len(tr)} | refused/stale xlate lines {refused}')
    print(f'patched {patched} | left unpatched (no valid tr) {skipped_no_tr} | other rows untouched {other}')
    if leftover:
        print(f'unpatched ids ({len(leftover)}): ' + ', '.join(leftover[:12]) + ('…' if len(leftover) > 12 else ''))
    if a.dry_run:
        print('dry run — nothing written')
        return
    bak = BANK + BACKUP_SUFFIX
    shutil.copy(BANK, bak)
    with open(BANK, 'w', encoding='utf-8') as f:
        f.writelines(out_lines)
    print(f'wrote {BANK} (backup {os.path.basename(bak)})')


if __name__ == '__main__':
    main()

#!/opt/homebrew/bin/python3
"""Prune meta-register / wrong rows from the EMITTED main stream before append (sample-review hold release).

  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/prune-emitted.py --dry-run   # census only, prints matched EN (main stream)
  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/prune-emitted.py             # backs up, rewrites ready + tags, writes drops

Why: the 2026-09-07 adversarial sample (72 rows) flagged 5 (6.9 %) — 4 of them one systematic writer artifact, a
"source-literacy / self-instruction" register ("In one sentence:", "Sources note…", "Do not stop at…", "cite that
page rather than a forwarded text") that Pro-verify let through because nothing in it is false. It is concentrated
in the JHS "gather information from secondary sources" codes that came in from Lane B, all of which are over their
oversampled target, so pruning there never touches `need`. The bank is append-only, so this must happen BEFORE append.

Two drop rules:
  1. EXPLICIT — the reviewer's tmp_ids (mapped through out/id-map.json), stream-wide.
  2. REGISTER — regex over fact.en, ONLY inside SECONDARY_SOURCE_CODES (elsewhere an imperative can be a
     legitimate method-cell card, e.g. "Label the x-axis with what you changed…").
Body stream is never read or written. Drop log records ids + reason only.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out'
READY = OUT / 'depth-ingest-ready.jsonl'
TAGS = OUT / 'depth-tags.json'
IDMAP = OUT / 'id-map.json'
BRIEFS = HERE / 'briefs.json'
BACKUP = OUT / 'pre-prune'
DROPS = OUT / 'prune-drops.jsonl'

# Reviewer's list (sample-review agent, 2026-09-07 22:2x): 26 register rows + 1 science error.
EXPLICIT_TMP = {
    # "In one sentence:" openers
    'depth-G8-E-12-060', 'depth-G9-E-10-028', 'depth-G9-M-4-088', 'depth-G10-E-4-036', 'depth-G10-F-3-024',
    # "sources say/note/list…" meta
    'depth-G8-E-10-062', 'depth-G8-E-12-057', 'depth-G9-L-4-002', 'depth-G9-L-4-011', 'depth-G9-L-4-012',
    'depth-G9-L-4-021', 'depth-G9-L-4-034',
    # self-instruction / meta
    'depth-G9-L-4-022', 'depth-G9-L-4-035', 'depth-G9-M-4-090', 'depth-G10-E-4-010', 'depth-G10-E-4-030',
    # cite-advice, not a fact
    'depth-G8-E-10-013', 'depth-G8-E-10-017', 'depth-G8-E-10-040', 'depth-G8-E-10-051', 'depth-G8-E-12-008',
    'depth-G8-E-12-018', 'depth-G9-E-10-008', 'depth-G10-F-7-002', 'depth-G10-F-7-017',
    # wrong mechanism (metal/non-metal staircase "based on outer electron counts")
    'depth-G8-M-8-025',
}

SECONDARY_SOURCE_CODES = {'G8-E-10', 'G8-E-12', 'G9-E-10', 'G9-L-4', 'G9-M-4', 'G10-E-4', 'G10-F-7'}

REGISTER = [
    ('in-one-sentence', re.compile(r'^\s*in one sentence', re.I)),
    ('sources-meta', re.compile(r'\bsources?\s+(say|note|list|show|report|separate|state|give|often)\b', re.I)),
    ('imperative-open', re.compile(r"^\s*(do not|don't|label the|copy|cite|look (on|for|up)|check|match|write|ask|use|read|treat|name|compare|list|search|open|skim|verify|note|record|find)\b", re.I)),
    # sourcing ADVICE in second person ("you should copy from that page"), not analogies ("you can predict where…")
    ('second-person-advice', re.compile(r'\byou (can|could|should|must|need to)\s+(also\s+)?(cite|copy|document|record|date|quote|attribute|identify|see|look|find|check|source|list|name|verify|read|skim|treat|match|note|search|open|use|write)\b', re.I)),
    # NOTE: no bare "cite" rule — "is often cited for", "textbooks cite", "are cited as reducing" are fine facts
    # (reviewer kept Bay of Fundy, lactase persistence); cite-ADVICE rows are covered by the explicit list.
    ('forwarded-screenshot', re.compile(r'\bforwarded\b|\bscreenshot\b|\bgroup chat\b|\bchat message', re.I)),
    ('sourcing-caveat', re.compile(r'\bunsourced\b|\bas printed\b|according to that report|hard (for classmates )?to verify|\bclassmates\b', re.I)),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--show', type=int, default=40, help='max matched EN lines to print (main stream only)')
    ap.add_argument('--extra', type=Path, default=None,
                    help='JSONL of {id|tmp_id, reason} to drop stream-wide (e.g. out/prune-extra.jsonl from the judge workflow)')
    a = ap.parse_args()

    idmap = json.loads(IDMAP.read_text())
    explicit = {}
    for t in sorted(EXPLICIT_TMP):
        m = idmap.get(t)
        if m:
            explicit[m['id']] = t
        else:
            print(f'  (explicit tmp_id not in id-map — never emitted, nothing to drop: {t})')
    if a.extra:
        n = 0
        for line in a.extra.read_text().splitlines():
            if not line.strip():
                continue
            e = json.loads(line)
            bank_id = e.get('id') or (idmap.get(e.get('tmp_id')) or {}).get('id')
            if bank_id:
                explicit[bank_id] = f"{e.get('tmp_id') or e.get('id')}|{e.get('reason', '')[:60]}"
                n += 1
        print(f'  extra drop list: {n} ids from {a.extra}')
    need = {b['code']: b['need'] for b in json.loads(BRIEFS.read_text())['briefs']}

    rows = [json.loads(l) for l in READY.read_text().splitlines() if l.strip()]
    keep, drops = [], []
    for r in rows:
        why = None
        if r['id'] in explicit:
            why = 'explicit:' + explicit[r['id']]
        elif r.get('brief_code') in SECONDARY_SOURCE_CODES:
            for name, rx in REGISTER:
                if rx.search(r['fact']['en']):
                    why = 'register:' + name
                    break
        (drops if why else keep).append((r, why))

    per_code = collections.Counter(r['brief_code'] for r, _ in drops)
    left = collections.Counter(r['brief_code'] for r, _ in keep)
    print(f'ready {len(rows)} → keep {len(keep)}, drop {len(drops)} '
          f'(explicit {sum(1 for _, w in drops if w.startswith("explicit"))}, register {sum(1 for _, w in drops if w.startswith("register"))})')
    print('per code: ' + ', '.join(f'{c} -{n} → {left[c]}/need {need.get(c)}' for c, n in sorted(per_code.items())))
    below = [c for c in per_code if left[c] < need.get(c, 0)]
    if a.dry_run:
        shown = 0
        for r, w in drops:
            if w.startswith('register') and shown < a.show:
                print(f'  [{w}] {r["brief_code"]} {r["id"]}: {r["fact"]["en"][:150]}')
                shown += 1
        print('BELOW NEED after prune: ' + (', '.join(below) if below else 'none'))
        return
    if below:
        raise SystemExit(f'refusing: prune would push below need: {below}')

    BACKUP.mkdir(exist_ok=True)
    shutil.copy2(READY, BACKUP / READY.name)
    shutil.copy2(TAGS, BACKUP / TAGS.name)
    dropped_ids = {r['id'] for r, _ in drops}
    tags = json.loads(TAGS.read_text())
    removed_tags = 0
    for k, v in tags.items():
        if isinstance(v, dict):
            for i in list(v):
                if i in dropped_ids:
                    del v[i]
                    removed_tags += 1
    READY.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r, _ in keep))
    TAGS.write_text(json.dumps(tags, indent=1, ensure_ascii=False) + '\n')
    with DROPS.open('w') as f:
        for r, w in drops:
            f.write(json.dumps(dict(id=r['id'], brief_code=r['brief_code'], reason=w)) + '\n')
    print(f'wrote {READY.name} ({len(keep)}), removed {removed_tags} tag entries, drops → {DROPS.name}; backups in {BACKUP}')


if __name__ == '__main__':
    main()

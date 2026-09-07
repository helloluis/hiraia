#!/opt/homebrew/bin/python3
"""Per-code funnel for REPORT.md: candidates → dedup-kept → verified ok → emitted (post-prune) → banked → factoids minted.

Reads briefs.json + out/{depth-candidates,depth-body}.jsonl + out/2-dedup.*.jsonl + out/4-verify.*.jsonl +
out/depth-ingest-ready[.body].jsonl + out/depth-bank-meta.json + rag/bank/science-facts.jsonl + rag/bank/factoids.jsonl.
Prints ids/counts only (never a body-stream sentence).

  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/report-per-code.py            # markdown table
  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/report-per-code.py --json     # machine-readable
"""
import collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(HERE, 'out')


def read_jsonl(p):
    if not os.path.exists(p):
        return []
    return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]


briefs = {b['code']: b for b in json.load(open(os.path.join(HERE, 'briefs.json')))['briefs']}
cand = collections.Counter(); laneb = collections.Counter()
for fn in ('depth-candidates.jsonl', 'depth-body.jsonl'):
    for r in read_jsonl(os.path.join(OUT, fn)):
        cand[r['brief_code']] += 1
        if r.get('origin') == 'lane-b':
            laneb[r['brief_code']] += 1
kept = collections.Counter()
for s in ('main', 'body'):
    for r in read_jsonl(os.path.join(OUT, f'2-dedup.{s}.jsonl')):
        kept[r['brief_code']] += 1
verified = collections.Counter()
for s in ('main', 'body'):
    for r in read_jsonl(os.path.join(OUT, f'4-verify.{s}.jsonl')):
        if r.get('verdict') == 'ok':
            verified[r['brief_code']] += 1
emitted = collections.Counter()
for fn in ('depth-ingest-ready.jsonl', 'depth-ingest-ready.body.jsonl'):
    for r in read_jsonl(os.path.join(OUT, fn)):
        emitted[r['brief_code']] += 1
meta_p = os.path.join(OUT, 'depth-bank-meta.json')
meta = json.load(open(meta_p))['rows'] if os.path.exists(meta_p) else {}
banked = collections.Counter()
bank_ids = set()
for r in read_jsonl(os.path.join(ROOT, 'rag', 'bank', 'science-facts.jsonl')):
    if r.get('generator') == 'depth-fill' and r['id'] in meta:
        banked[meta[r['id']]['brief_code']] += 1
        bank_ids.add(r['id'])
minted = collections.Counter()
for r in read_jsonl(os.path.join(ROOT, 'rag', 'bank', 'factoids.jsonl')):
    if r.get('factId') in meta:
        minted[meta[r['factId']]['brief_code']] += 1

rows = []
for code, b in briefs.items():
    rows.append(dict(code=code, have=b['have'], need=b['need'], target=b['target'], candidates=cand[code], lane_b=laneb[code],
                     dedup_kept=kept[code], verified_ok=verified[code], emitted=emitted[code], banked=banked[code],
                     factoids=minted[code], short=max(0, b['need'] - banked[code])))
tot = {k: sum(r[k] for r in rows) for k in ('need', 'target', 'candidates', 'lane_b', 'dedup_kept', 'verified_ok', 'emitted', 'banked', 'factoids', 'short')}
below = [r for r in rows if r['banked'] < r['need']]
if '--json' in sys.argv:
    json.dump(dict(rows=rows, totals=tot, below_need=[r['code'] for r in below]), sys.stdout, indent=1)
    sys.exit()
print(f"codes {len(rows)} | need {tot['need']} | target {tot['target']} | candidates {tot['candidates']} (lane-b {tot['lane_b']}) | "
      f"dedup kept {tot['dedup_kept']} | verified ok {tot['verified_ok']} | emitted (post-prune) {tot['emitted']} | "
      f"banked {tot['banked']} | factoids minted {tot['factoids']}")
print(f"codes with banked < need: {len(below)} (total short {tot['short']}); codes at/above need: {len(rows) - len(below)}")
print()
print('| code | have | need | target | candidates | laneB | dedup kept | verified ok | emitted | banked | factoids | short |')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for r in sorted(rows, key=lambda r: (-r['short'], r['code'])):
    print(f"| {r['code']} | {r['have']} | {r['need']} | {r['target']} | {r['candidates']} | {r['lane_b']} | {r['dedup_kept']} | "
          f"{r['verified_ok']} | {r['emitted']} | {r['banked']} | {r['factoids']} | {r['short'] or ''} |")
print(f"| **total** | | **{tot['need']}** | **{tot['target']}** | **{tot['candidates']}** | **{tot['lane_b']}** | **{tot['dedup_kept']}** | "
      f"**{tot['verified_ok']}** | **{tot['emitted']}** | **{tot['banked']}** | **{tot['factoids']}** | **{tot['short']}** |")

#!/opt/homebrew/bin/python3
"""Per-code survival after the ingest dry run (validate + dedup + mint): written / Lane B / kept / dropped / need.

Reads briefs.json + out/{depth-candidates,depth-body}.jsonl + out/2-dedup.{main,body}.jsonl + out/dedup-drops.jsonl + out/rejects.jsonl.
Prints ids/counts only (never a body-stream sentence). Optionally --json to emit machine-readable rows.
"""
import collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')


def read_jsonl(p):
    if not os.path.exists(p):
        return []
    return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]


briefs = {b['code']: b for b in json.load(open(os.path.join(HERE, 'briefs.json')))['briefs']}
written = collections.Counter(); laneb = collections.Counter(); body_written = collections.Counter()
for r in read_jsonl(os.path.join(OUT, 'depth-candidates.jsonl')):
    written[r['brief_code']] += 1
    if r.get('origin') == 'lane-b':
        laneb[r['brief_code']] += 1
for r in read_jsonl(os.path.join(OUT, 'depth-body.jsonl')):
    written[r['brief_code']] += 1; body_written[r['brief_code']] += 1
kept = collections.Counter(); kept_laneb = collections.Counter()
for s in ('main', 'body'):
    for r in read_jsonl(os.path.join(OUT, f'2-dedup.{s}.jsonl')):
        kept[r['brief_code']] += 1
        if r.get('origin') == 'lane-b':
            kept_laneb[r['brief_code']] += 1
drops = read_jsonl(os.path.join(OUT, 'dedup-drops.jsonl'))
d_exist = collections.Counter(d['brief_code'] for d in drops if d['reason'] == 'near-existing')
d_cand = collections.Counter(d['brief_code'] for d in drops if d['reason'] == 'near-candidate')
rej = collections.Counter((r.get('brief_code') or '?').upper() for r in read_jsonl(os.path.join(OUT, 'rejects.jsonl')))

rows = []
for code, b in briefs.items():
    rows.append(dict(code=code, need=b['need'], target=b['target'], written=written[code], lane_b=laneb[code], body=body_written[code],
                     rejected=rej[code], drop_existing=d_exist[code], drop_candidate=d_cand[code], surviving=kept[code],
                     short=max(0, b['need'] - kept[code])))
below = [r for r in rows if r['surviving'] < r['need']]
if '--json' in sys.argv:
    json.dump(dict(rows=rows, below_need=below), sys.stdout, indent=1); sys.exit()
print(f"codes {len(rows)} | written {sum(written.values())} (lane-b {sum(laneb.values())}, body {sum(body_written.values())}) | "
      f"rejected {sum(rej.values())} | dedup kept {sum(kept.values())} (lane-b {sum(kept_laneb.values())}) | "
      f"dropped near-existing {sum(d_exist.values())} / near-candidate {sum(d_cand.values())}")
print(f"codes whose surviving < need: {len(below)} (total short {sum(r['short'] for r in below)})")
print('code | need | target | written | laneB | rej | drop-exist | drop-cand | surviving | short')
for r in sorted(below, key=lambda r: -r['short']):
    print(f"{r['code']} | {r['need']} | {r['target']} | {r['written']} | {r['lane_b']} | {r['rejected']} | {r['drop_existing']} | {r['drop_candidate']} | {r['surviving']} | {r['short']}")

#!/opt/homebrew/bin/python3
"""Import Lane B's English candidates for the codes still below 20 (BRIEF.md §6).

Copies the rows of /Users/luis/Code/hiraia-lane-b/rag/pipeline/lane-b/out/lane-b-candidates.jsonl whose brief_code is in
briefs.json into out/depth-candidates.jsonl, tmp_id rewritten to depth-<CODE>-<nnn> (001.. per code, file order), every other
field kept (brief_code included) plus origin='lane-b'. lane-b-body.jsonl (G10-L-8, already at 20) is skipped by design.
Idempotent: refuses to run twice (origin='lane-b' rows already present) and refuses if depth-candidates.jsonl has Flash rows.

  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/import-lane-b.py
"""
import collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
MAIN = os.path.join(OUT, 'depth-candidates.jsonl')
LANE_B = '/Users/luis/Code/hiraia-lane-b/rag/pipeline/lane-b/out/lane-b-candidates.jsonl'
EXPECTED = ['G7-E-1', 'G8-L-7', 'G8-E-1', 'G8-E-10', 'G8-E-12', 'G8-F-8', 'G9-E-10', 'G9-L-4', 'G9-M-4',
            'G10-E-1', 'G10-E-4', 'G10-F-3', 'G10-F-6', 'G10-F-7', 'G10-M-5']          # BRIEF §6, still < 20 on 2026-09-07


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]


def main():
    briefs = {b['code']: b for b in json.load(open(os.path.join(HERE, 'briefs.json')))['briefs']}
    missing = [c for c in EXPECTED if c not in briefs]
    if missing:
        sys.exit(f'refusing: BRIEF §6 codes not in briefs.json (already ≥20?): {missing}')
    have = read_jsonl(MAIN)
    if any(r.get('origin') == 'lane-b' for r in have):
        sys.exit(f'already imported: {sum(1 for r in have if r.get("origin") == "lane-b")} lane-b rows in {os.path.relpath(MAIN)}')
    if have:
        sys.exit(f'refusing: {len(have)} non-lane-b rows already in {os.path.relpath(MAIN)} — import Lane B before writing')
    rows = read_jsonl(LANE_B)
    codes = collections.Counter(r['brief_code'] for r in rows)
    stray = sorted(set(codes) - set(EXPECTED))
    if stray:
        sys.exit(f'refusing: lane-b-candidates.jsonl carries codes outside BRIEF §6: {stray}')
    os.makedirs(OUT, exist_ok=True)
    n = collections.Counter()
    out = []
    for r in rows:
        code = r['brief_code']
        n[code] += 1
        row = dict(tmp_id=f'depth-{code}-{n[code]:03d}')
        row.update({k: v for k, v in r.items() if k != 'tmp_id'})
        row['origin'] = 'lane-b'
        row['lane_b_tmp_id'] = r['tmp_id']
        out.append(row)
    with open(MAIN + '.tmp', 'w', encoding='utf-8') as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    os.replace(MAIN + '.tmp', MAIN)
    print(f'imported {len(out)} Lane B rows for {len(n)} codes → {os.path.relpath(MAIN)}')
    print(f'{"code":<9}{"imported":>9}{"target":>8}{"flash":>7}  (flash = max(0, target - imported))')
    tot_flash = 0
    for code in EXPECTED:
        t = briefs[code]['target']; fl = max(0, t - n[code]); tot_flash += fl
        print(f'{code:<9}{n[code]:>9}{t:>8}{fl:>7}' + ('   OVER target' if n[code] > t else ''))
    print(f'flash still to write for these 15 codes: {tot_flash}')


if __name__ == '__main__':
    main()

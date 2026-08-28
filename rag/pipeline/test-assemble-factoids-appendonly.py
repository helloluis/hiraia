#!/usr/bin/env python3
"""Append-only ffct id test for rag/pipeline/assemble-factoids.py.

Builds a tiny fixture in a temp dir (two pairs → a third pair appended, re-ordered → one
factoid regenerated → a pair removed → another pair appended → patches/retirement → corrupt
registries → a git checkout for the default baseline), runs the assembler as a subprocess with
--out/--facts/--patches (env FACTOIDS_OUT / FACTS_BANK / FACTOID_PATCHES) pointed INTO the temp
dir, and asserts that every ffct id is stable across all of it. Never touches the real bank —
it also snapshots rag/bank/factoids.jsonl's checksum before and after as a guard.

  python3 rag/pipeline/test-assemble-factoids-appendonly.py [path/to/assemble-factoids.py]
  ASSEMBLER=... python3 rag/pipeline/test-assemble-factoids-appendonly.py
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ASSEMBLER = os.path.abspath(os.environ.get('ASSEMBLER') or (sys.argv[1] if len(sys.argv) > 1
                                                             else os.path.join(HERE, 'assemble-factoids.py')))
REAL_BANK = os.path.join(HERE, '..', 'bank', 'factoids.jsonl')


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def jsonl(path, rows):
    with open(path, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')


def load(path):
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    by_id = {r['id']: r for r in rows}
    assert len(by_id) == len(rows), 'duplicate ids in output'
    return rows, by_id, {r['factId']: r['id'] for r in rows}


# fixture factoids: factId -> (domain, en text). Neutral physical-science content only.
FACTS = {
    'magnet-poles-g4':      ('FORCE_MOTION_ENERGY', 'Every magnet has a north and a south pole.'),
    'rain-water-cycle-g4':  ('EARTH_SPACE', 'Rain is water that evaporated and came back down.'),
    'ice-floats-g3':        ('MATTER', 'Ice floats because it is less dense than liquid water.'),
    'sound-needs-medium-g5': ('FORCE_MOTION_ENERGY', 'Sound needs air, water or a solid to travel.'),
    'moon-no-light-g5':     ('EARTH_SPACE', 'The Moon does not make its own light; it reflects sunlight.'),
    'rust-is-chemical-g6':  ('MATTER', 'Rust forms when iron reacts with oxygen and water.'),
    'shadow-length-g4':     ('EARTH_SPACE', 'Shadows are longest when the Sun is low in the sky.'),
}


def gen_row(fid, en=None, fmt='straight'):
    en = en or FACTS[fid][1]
    return {'factId': fid, 'format': fmt, 'q_en': '', 'q_tl': '', 'q_bis': '',
            't_en': en, 't_tl': f'[tl] {en}', 't_bis': f'[bis] {en}', 'image_prompt': f'engraving of {fid}',
            'difficulty': 1}


class Fixture:
    def __init__(self, tmp):
        self.tmp = tmp
        self.out = os.path.join(tmp, 'bank', 'factoids.jsonl')
        self.facts = os.path.join(tmp, 'bank', 'science-facts.jsonl')
        os.makedirs(os.path.dirname(self.out))
        jsonl(self.facts, [{'id': fid, 'domain': d, 'fact': {'en': en}} for fid, (d, en) in FACTS.items()])
        self.patches = os.path.join(tmp, 'factoid-patches.json')
        self.env = {**os.environ, 'FACTOIDS_OUT': self.out, 'FACTS_BANK': self.facts, 'FACTOID_PATCHES': self.patches}

    def pair(self, name, fids):
        gdir = os.path.join(self.tmp, f'factoids-{name}')
        os.makedirs(gdir, exist_ok=True)
        jsonl(os.path.join(gdir, 'gen-000.jsonl'), [gen_row(f) for f in fids])
        srcf = os.path.join(self.tmp, f'factoids-{name}-src.jsonl')
        jsonl(srcf, [{'id': f, 'slug': None, 'topic': f.replace('-', ' '), 'grades': [int(f[-1])]} for f in fids])
        return f'{gdir}:{srcf}'

    def run(self, *args, expect=0):
        p = subprocess.run([sys.executable, ASSEMBLER, *args], cwd=self.tmp, env=self.env,
                           capture_output=True, text=True)
        if p.returncode != expect:
            sys.stderr.write(p.stdout + p.stderr)
            raise AssertionError(f'exit {p.returncode}, expected {expect}: {args}')
        return p.stdout + p.stderr


def main():
    real_before = sha(REAL_BANK) if os.path.exists(REAL_BANK) else None
    passed = 0

    def ok(msg):
        nonlocal passed
        passed += 1
        print(f'PASS {passed:2d}  {msg}')

    with tempfile.TemporaryDirectory(prefix='ffct-appendonly-') as tmp:
        fx = Fixture(tmp)
        A = fx.pair('a', ['magnet-poles-g4', 'rain-water-cycle-g4'])
        B = fx.pair('b', ['ice-floats-g3', 'sound-needs-medium-g5'])

        # 1. no registry: refused (that is the positional re-mint) unless --init; then ids are
        #    positional in input order, starting at ffct-00000
        out = fx.run(A, B, expect=1)
        assert 'no registry' in out and 'refusing' in out and not os.path.exists(fx.out), out
        out = fx.run('--check', A, B, expect=1)
        assert 'no registry' in out and not os.path.exists(fx.out), out
        fx.run('--init', A, B)
        rows, by_id, fid2id = load(fx.out)
        assert [r['id'] for r in rows] == ['ffct-00000', 'ffct-00001', 'ffct-00002', 'ffct-00003'], rows
        assert fid2id == {'magnet-poles-g4': 'ffct-00000', 'rain-water-cycle-g4': 'ffct-00001',
                          'ice-floats-g3': 'ffct-00002', 'sound-needs-medium-g5': 'ffct-00003'}
        assert by_id['ffct-00000']['domain'] == 'FORCE_MOTION_ENERGY' and by_id['ffct-00000']['subject'] == 'physics'
        assert list(by_id['ffct-00000'].keys())[:3] == ['id', 'factId', 'subject']
        first = dict(fid2id)
        ok('missing registry is refused; --init mints ffct-00000.. in input order')

        # 2. re-run with identical inputs is byte-identical (deterministic, registry reused)
        s1 = sha(fx.out)
        out = fx.run(A, B)
        assert sha(fx.out) == s1 and 'reused 4' in out and 'new 0' in out, out
        ok('re-run is byte-identical and reuses every id')

        # 3. --check on a stable bank passes and does not write
        mtime = os.path.getmtime(fx.out)
        out = fx.run('--check', A, B)
        assert 'byte-identical to current bank: YES' in out and 'append-only id check: OK' in out, out
        assert os.path.getmtime(fx.out) == mtime and sha(fx.out) == s1
        ok('--check passes on a stable bank and never writes')

        # 4. third pair appended AND pair order shuffled: old ids untouched, new ids from max+1
        C = fx.pair('c', ['moon-no-light-g5', 'rust-is-chemical-g6'])
        fx.run(C, A, B)                                  # C first — legacy code would renumber
        rows, by_id, fid2id = load(fx.out)
        assert all(fid2id[f] == i for f, i in first.items()), fid2id
        assert fid2id['moon-no-light-g5'] == 'ffct-00004' and fid2id['rust-is-chemical-g6'] == 'ffct-00005'
        assert [r['id'] for r in rows] == sorted(r['id'] for r in rows)
        second = dict(fid2id)
        ok('appended pair gets max+1 ids; re-ordering pairs renumbers nothing')

        # 5. regenerated factoid: content change under an existing id is refused by default
        #    (it would silently revert post-assembly fixes); --allow-content-change keeps the id, replaces the text
        jsonl(os.path.join(tmp, 'factoids-a', 'gen-000.jsonl'),
              [gen_row('magnet-poles-g4', 'Magnets have two poles: north and south. Like poles push apart.'),
               gen_row('rain-water-cycle-g4')])
        s_before = sha(fx.out)
        out = fx.run(A, B, C, expect=1)
        assert 'CONTENT CHANGED under 1 existing id' in out and 'refusing to write' in out and sha(fx.out) == s_before, out
        out = fx.run('--check', A, B, C)
        assert 'content changed under an existing id: 1 e.g. ffct-00000 (write would refuse' in out, out
        out = fx.run('--allow-content-change', A, B, C)
        rows, by_id, fid2id = load(fx.out)
        assert fid2id == second
        assert by_id['ffct-00000']['text']['en'].startswith('Magnets have two poles'), by_id['ffct-00000']
        assert 'content changed under an existing id: 1 e.g. ffct-00000' in out, out
        ok('content change under an existing id refused by default; --allow-content-change keeps the id, replaces text')
        snapshot_b = {i: by_id[i] for i in ('ffct-00002', 'ffct-00003')}

        # 6. pair B removed from the inputs: its rows are carried over verbatim, nothing renumbered
        out = fx.run(A, C)
        rows, by_id, fid2id = load(fx.out)
        assert fid2id == second, fid2id
        assert len(rows) == 6 and all(by_id[i] == r for i, r in snapshot_b.items())
        assert 'carried over (not in inputs) 2' in out, out
        fx.run('--check', A, C)
        ok('removed pair: rows carried over verbatim, ids stable, --check OK')

        # 7. a new pair after the removal continues from max+1 (no hole re-use, no drop)
        D = fx.pair('d', ['shadow-length-g4'])
        fx.run(A, C, D)
        rows, by_id, fid2id = load(fx.out)
        assert fid2id['shadow-length-g4'] == 'ffct-00006' and len(rows) == 7
        assert all(fid2id[f] == i for f, i in second.items())
        ok('pair appended after a removal mints ffct-00006 (max+1), nothing dropped')

        # 8. --check FAILS when ids drift from a baseline (simulate the legacy positional renumbering)
        baseline = os.path.join(tmp, 'baseline.jsonl')
        shutil.copy(fx.out, baseline)
        rows, by_id, _ = load(fx.out)
        by_id['ffct-00000']['id'], by_id['ffct-00001']['id'] = 'ffct-00001', 'ffct-00000'   # swap two ids
        jsonl(fx.out, rows)
        out = fx.run('--check', '--baseline', baseline, A, C, D, expect=1)
        assert 'CHANGED ffct-00000' in out and 'CHANGED ffct-00001' in out, out
        ok('--check exits 1 when an id changes vs the baseline')

        # 9. --check FAILS when an id vanishes; write mode refuses too and leaves the file alone
        jsonl(fx.out, [r for r in rows if r['id'] != 'ffct-00003'])
        out = fx.run('--check', '--baseline', baseline, A, C, D, expect=1)
        assert 'VANISHED ffct-00003' in out, out
        s_before = sha(fx.out)
        out = fx.run('--baseline', baseline, A, C, D, expect=1)
        assert 'refusing to write' in out and sha(fx.out) == s_before, out
        ok('--check / write exit 1 when an id vanishes vs the baseline; file untouched')

        # 10. corrupt registry (duplicate id) aborts before writing
        shutil.copy(baseline, fx.out)
        rows, _, _ = load(fx.out)
        jsonl(fx.out, rows + [dict(rows[0], factId='dup-fact-g4')])
        s_before = sha(fx.out)
        out = fx.run(A, C, D, expect=1)
        assert 'duplicate id' in out and sha(fx.out) == s_before, out
        ok('corrupt registry (duplicate id) aborts, file untouched')

        # 11. corrupt registry: legacy row without factId / non-canonical id → 'corrupt registry', not a KeyError
        rows, _, _ = load(baseline)
        jsonl(fx.out, rows + [{'id': 'ffct-00099', 'text': {'en': 'x'}}])
        out = fx.run('--check', A, C, D, expect=1)
        assert 'corrupt registry' in out and 'no factId' in out and 'KeyError' not in out, out
        jsonl(fx.out, rows + [dict(rows[0], id='ffct-1', factId='padded-g4')])
        out = fx.run('--check', A, C, D, expect=1)
        assert 'corrupt registry' in out and 'non-canonical id' in out, out
        shutil.copy(baseline, fx.out)
        ok('corrupt registry (no factId / non-canonical id) aborts cleanly')

        # 12. tracked overlay: text fix + retirement survive re-assembly (a bank-only edit would not);
        #     first application is a content change (explicit), then re-runs are byte-identical; unknown ids abort
        patch = {'ffct-00002': {'text': {'en': 'Ice floats: it is less dense than liquid water.'}},
                 'ffct-00003': {'retired': True}}
        with open(fx.patches, 'w') as f:
            json.dump({'patches': patch}, f)
        out = fx.run(A, C, D, expect=1)
        assert 'CONTENT CHANGED under 2 existing id' in out, out
        out = fx.run('--allow-content-change', A, C, D)
        assert 'patches applied: 2' in out, out
        rows, by_id, fid2id = load(fx.out)
        assert fid2id == {**second, 'shadow-length-g4': 'ffct-00006'}, fid2id
        assert by_id['ffct-00002']['text']['en'] == 'Ice floats: it is less dense than liquid water.'
        assert by_id['ffct-00003']['retired'] is True and by_id['ffct-00003']['factId'] == 'sound-needs-medium-g5'
        s_p = sha(fx.out)
        out = fx.run(A, C, D)                              # plain re-run: overlay re-applied, nothing changes
        assert sha(fx.out) == s_p and 'content changed under an existing id: 0' in out, out
        out = fx.run('--check', A, C, D)
        assert 'byte-identical to current bank: YES' in out, out
        with open(fx.patches, 'w') as f:
            json.dump({'patches': {**patch, 'ffct-99999': {'text': {'en': 'nope'}}}}, f)
        out = fx.run(A, C, D, expect=1)
        assert 'patches for ids not in the bank: ffct-99999' in out and sha(fx.out) == s_p, out
        with open(fx.patches, 'w') as f:
            json.dump({'patches': patch}, f)
        ok('patch overlay (text fix + retired tombstone) applied after minting, idempotent, unknown id aborts')

        # 13. inside a git checkout the default --baseline is the COMMITTED bank: a positional
        #     re-mint of the working copy fails --check with no --baseline given
        git = ['git', '-C', tmp, '-c', 'user.name=t', '-c', 'user.email=t@t']
        subprocess.run(git + ['init', '-q'], check=True)
        subprocess.run(git + ['add', 'bank/factoids.jsonl'], check=True)
        subprocess.run(git + ['commit', '-q', '-m', 'bank'], check=True)
        out = fx.run('--check', A, C, D)
        assert 'baseline: git HEAD:bank/factoids.jsonl (7 ids)' in out and 'append-only id check: OK' in out, out
        rows, by_id, _ = load(fx.out)
        by_id['ffct-00000']['id'], by_id['ffct-00001']['id'] = 'ffct-00001', 'ffct-00000'
        jsonl(fx.out, rows)
        out = fx.run('--check', A, C, D, expect=1)
        assert 'baseline: git HEAD:' in out and 'CHANGED ffct-00000' in out and 'CHANGED ffct-00001' in out, out
        ok('default --baseline is the committed bank (git HEAD): drifted ids fail --check without --baseline')

    if real_before is not None:
        assert sha(REAL_BANK) == real_before, 'REAL BANK CHANGED — test leaked out of the temp dir'
        print(f'guard   real bank untouched ({real_before[:12]}…)')
    print(f'ALL {passed} PASS  ({ASSEMBLER})')


if __name__ == '__main__':
    main()

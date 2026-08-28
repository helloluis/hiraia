#!/usr/bin/env python3
"""Assemble factoid gen-*.jsonl (one or more batch dirs) into the feed factoid bank, joined
to their source facts for slug/topic/grades and to science-facts.jsonl for the MATATAG domain.
Dedup by factId (first occurrence wins: pair order, then sorted gen-file name, then line order).
Writes rag/bank/factoids.jsonl with a `domain` field so the feed can sample evenly across the
four elementary quarters (Materials / Living Things / Force-Motion-Energy / Earth-Space)
regardless of how many were generated per domain.

ffct ids are APPEND-ONLY. They are the key for packages/images/factoid-webp/<id>.webp,
rag/bank/curriculum-tags.json, the on-device card_seen table and the cardsPool card ids, so an
id must never be re-minted or re-numbered:
  * the existing bank (--out) is the id registry: a factId that is already banked keeps its
    ffct id forever, whatever the input order. A MISSING registry is refused (that would mint
    from ffct-00000 positionally) unless --init says a brand-new bank is really intended;
  * factIds not yet banked get max(existing)+1 upward, in stable input order;
  * a banked factoid that is missing from the inputs is carried over verbatim, never dropped;
  * a regenerated factoid replaces the old row's content under the same id — but only with
    --allow-content-change: by default any content change under an existing id refuses to
    write, because the gen-*.jsonl inputs are re-read verbatim on every assembly and would
    silently revert post-assembly fixes;
  * post-assembly fixes and retirements live in the tracked overlay --patches
    (rag/pipeline/factoid-patches.json, {"patches": {"ffct-NNNNN": {"text": {lang: ..},
    "q": {lang: ..}, "retired": true}}}), applied after id assignment on every run. Retire a
    card with `"retired": true` there — never by deleting its row (a hole would be re-minted);
    gen-cards-pool.py skips retired rows.
  * --check compares against --baseline, which defaults to the COMMITTED bank
    (git show HEAD:<--out>) inside a git checkout, so the drift check is real by default.

  python3 rag/pipeline/assemble-factoids.py [GENDIR:SRCFILE ...]           # write (atomic)
  python3 rag/pipeline/assemble-factoids.py --check [GENDIR:SRCFILE ...]   # dry run, no write;
      # exit 1 if any id in --baseline (default: git HEAD copy, else the current bank) would
      # change or vanish

Paths: --out / --facts / --patches, or env FACTOIDS_OUT / FACTS_BANK / FACTOID_PATCHES (the
append-only test points them at a temp dir). Default pairs — keep all six, in this order:

      rag/pipeline/factoids-bio:rag/pipeline/factoids-LIVING_THINGS-src.jsonl
      rag/pipeline/factoids-bio-b2:rag/pipeline/factoids-LIVING_THINGS-src.jsonl
      rag/pipeline/factoids-bio-b3:rag/pipeline/factoids-LIVING_THINGS-src.jsonl
      rag/pipeline/factoids-gen-matter:rag/pipeline/factoids-MATTER-src.jsonl
      rag/pipeline/factoids-gen-fme:rag/pipeline/factoids-FORCE_MOTION_ENERGY-src.jsonl
      rag/pipeline/factoids-gen-earth:rag/pipeline/factoids-EARTH_SPACE-src.jsonl
"""
import argparse, glob, hashlib, json, os, re, subprocess, sys
from collections import Counter

DEFAULT_OUT = 'rag/bank/factoids.jsonl'
DEFAULT_FACTS = 'rag/bank/science-facts.jsonl'
DEFAULT_PATCHES = 'rag/pipeline/factoid-patches.json'
# biology batches all join to the SAME re-matched LIVING_THINGS src (aggressive image match
# → far more bundled-illustration coverage than the conservative batch-era src files).
DEFAULT_PAIRS = [
    'rag/pipeline/factoids-bio:rag/pipeline/factoids-LIVING_THINGS-src.jsonl',
    'rag/pipeline/factoids-bio-b2:rag/pipeline/factoids-LIVING_THINGS-src.jsonl',
    'rag/pipeline/factoids-bio-b3:rag/pipeline/factoids-LIVING_THINGS-src.jsonl',
    'rag/pipeline/factoids-gen-matter:rag/pipeline/factoids-MATTER-src.jsonl',
    'rag/pipeline/factoids-gen-fme:rag/pipeline/factoids-FORCE_MOTION_ENERGY-src.jsonl',
    'rag/pipeline/factoids-gen-earth:rag/pipeline/factoids-EARTH_SPACE-src.jsonl',
]

# MATATAG domain -> friendly feed subject label
SUBJECT = {'MATTER': 'materials', 'LIVING_THINGS': 'biology',
           'FORCE_MOTION_ENERGY': 'physics', 'EARTH_SPACE': 'earth_space'}
ORDER = ['id', 'factId', 'subject', 'domain', 'topic', 'grades', 'format', 'q', 'text', 'image',
         'difficulty', 'reviewed']
ID_RE = re.compile(r'^ffct-(\d+)$')


def mint(n):
    return f'ffct-{n:05d}'          # zero-padded to 5; widens naturally past ffct-99999


def parse_id(s):
    m = ID_RE.match(s or '')
    if not m:
        raise SystemExit(f'corrupt registry: bad ffct id {s!r}')
    return int(m.group(1))


def read_jsonl(path):
    with open(path, encoding='utf-8') as f:
        for l in f:
            l = l.strip()
            if l:
                yield json.loads(l)


def serialise(rows):
    return ''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_registry(rows_in, label):
    """Bank rows → (rows by id in file order, factId → id). Aborts on anything that makes id
    reuse untrustworthy: a non-canonical id, a missing/empty factId, a missing ORDER key, or a
    duplicate id / factId (a registry that maps one key two ways cannot be trusted)."""
    rows, fid2id = {}, {}
    for r in rows_in:
        i, fid = r.get('id'), r.get('factId')
        if mint(parse_id(i)) != i:
            raise SystemExit(f'corrupt registry {label}: non-canonical id {i!r}')
        if not fid or not isinstance(fid, str):
            raise SystemExit(f'corrupt registry {label}: {i} has no factId')
        missing = [k for k in ORDER if k not in r]
        if missing:
            raise SystemExit(f'corrupt registry {label}: {i} lacks {missing}')
        if i in rows:
            raise SystemExit(f'corrupt registry {label}: duplicate id {i}')
        if fid in fid2id:
            raise SystemExit(f'corrupt registry {label}: factId {fid} under both {fid2id[fid]} and {i}')
        rows[i] = r
        fid2id[fid] = i
    return rows, fid2id


def load_registry(path):
    if not path or not os.path.exists(path):
        return {}, {}
    return parse_registry(read_jsonl(path), path)


def git_head_registry(path):
    """(rows, label) of the COMMITTED copy of `path` (git show HEAD:<path>) when it is a tracked
    file inside a git checkout, else None. The default --baseline: comparing the registry
    against itself would be tautological."""
    real = os.path.realpath(path)
    if not os.path.isdir(os.path.dirname(real)):
        return None
    try:
        top = subprocess.run(['git', '-C', os.path.dirname(real), 'rev-parse', '--show-toplevel'],
                             capture_output=True, text=True, check=True).stdout.strip()
        rel = os.path.relpath(real, os.path.realpath(top)).replace(os.sep, '/')
        if rel.startswith('..'):
            return None
        blob = subprocess.run(['git', '-C', top, 'show', f'HEAD:{rel}'], capture_output=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return None
    label = f'git HEAD:{rel}'
    return parse_registry((json.loads(l) for l in blob.decode('utf-8').splitlines() if l.strip()), label)[0], label


def load_patches(path):
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    patches = d.get('patches') if isinstance(d, dict) else None
    if not isinstance(patches, dict):
        raise SystemExit(f'bad patch file {path}: expected {{"patches": {{"ffct-NNNNN": {{...}}}}}}')
    return patches


def apply_patches(rows, patches):
    """Post-assembly overlay keyed by ffct id, applied after id assignment so a re-assembly can
    never revert it: `text` / `q` per-language replacements, `retired: true` tombstones (the row
    and id stay; gen-cards-pool.py skips it). Unknown ids or fields abort."""
    by_id = {r['id']: r for r in rows}
    unknown = sorted(set(patches) - set(by_id))
    if unknown:
        raise SystemExit(f'patches for ids not in the bank: {", ".join(unknown[:10])}')
    for i, p in patches.items():
        r = by_id[i]
        for k, v in p.items():
            if k in ('text', 'q'):
                r[k] = {**(r.get(k) or {}), **v}
            elif k == 'retired':
                if v:
                    r['retired'] = True
                else:
                    r.pop('retired', None)
            else:
                raise SystemExit(f'patch {i}: unknown field {k!r} (allowed: text, q, retired)')
    return len(patches)


def tri(en, tl, bis):
    return {'en': (en or '').strip(), 'tl': (tl or '').strip(), 'bis': (bis or '').strip()}


def build_records(pairs, facts_path):
    """gen inputs → ordered {factId: row-without-id}; order = stable input order."""
    if not os.path.exists(facts_path):
        raise SystemExit(f'fact bank not found: {facts_path} (needed for the MATATAG domain)')
    dom = {r['id']: r.get('domain', '') for r in read_jsonl(facts_path)}  # authoritative domain

    src = {}                                    # source facts (for slug / grades / topic)
    for pair in pairs:
        gdir, srcfile = pair.split(':', 1)
        if not os.path.isdir(gdir) or not os.path.exists(srcfile):
            # a pair that does not resolve must abort: with an empty src every row of that gen dir would silently
            # re-assemble with topic '', grades [5] and NO slug (a zsh `$PAIRS` passed unsplit did exactly this)
            raise SystemExit(f'pair does not resolve: {pair!r} (gen dir {"ok" if os.path.isdir(gdir) else "MISSING"}, '
                             f'src file {"ok" if os.path.exists(srcfile) else "MISSING"}) — pass each GENDIR:SRCFILE as its own argument')
        for r in read_jsonl(srcfile):
            src[r['id']] = r

    records, malformed = {}, 0
    for pair in pairs:
        gdir = pair.split(':', 1)[0]
        for fn in sorted(glob.glob(os.path.join(gdir, 'gen-*.jsonl'))):
            with open(fn, encoding='utf-8') as f:
                for l in f:
                    l = l.strip()
                    if not l:
                        continue
                    try:
                        r = json.loads(l)
                    except Exception:
                        malformed += 1
                        continue
                    fid = r.get('factId')
                    if not fid or fid in records:
                        continue
                    s = src.get(fid, {})
                    fmt = r.get('format', 'straight')
                    body = tri(r.get('t_en'), r.get('t_tl'), r.get('t_bis'))
                    if not body['en'] and not body['tl']:      # empty factoid — skip
                        continue
                    q = tri(r.get('q_en'), r.get('q_tl'), r.get('q_bis')) if fmt == 'qa' else None
                    if q and not (q['en'] or q['tl']):
                        q = None
                        fmt = 'straight'
                    slug = s.get('slug') or None
                    prompt = (r.get('image_prompt') or '').strip() or None
                    d = dom.get(fid, '')
                    records[fid] = {
                        'factId': fid,
                        'subject': SUBJECT.get(d, 'science'),
                        'domain': d,
                        'topic': s.get('topic', ''),
                        'grades': s.get('grades', [5]),
                        'format': fmt,
                        'q': q,
                        'text': body,
                        'image': {'slug': slug, 'prompt': None if slug else prompt},
                        'difficulty': r.get('difficulty', 1),
                        'reviewed': False,
                    }
    return records, malformed


def assign_ids(records, reg_rows, fid2id):
    """Append-only minting. Returns (rows sorted by id, new ids, carried-over ids)."""
    nxt = max((parse_id(i) for i in reg_rows), default=-1) + 1
    out, new_ids = {}, []
    for fid, r in records.items():
        i = fid2id.get(fid)
        if i is None:
            i = mint(nxt)
            nxt += 1
            new_ids.append(i)
        row = dict(r)
        row['id'] = i
        out[i] = {k: row[k] for k in ORDER}
    carried = [i for i in reg_rows if i not in out]     # banked but no longer in the inputs
    for i in carried:
        out[i] = dict(reg_rows[i])                       # verbatim, never dropped (a copy: patches must not leak into the registry view)
    return [out[i] for i in sorted(out, key=parse_id)], new_ids, carried


def id_problems(baseline_rows, rows):
    """Every id in the baseline must survive with the same factId (and vice versa)."""
    by_id = {r['id']: r['factId'] for r in rows}
    by_fid = {r['factId']: r['id'] for r in rows}
    if len(by_id) != len(rows):
        return [f'DUPLICATE ids in output ({len(rows) - len(by_id)})']
    problems = []
    for i, r in baseline_rows.items():
        fid = r['factId']
        if i not in by_id:
            problems.append(f'VANISHED {i} ({fid})')
        elif by_id[i] != fid:
            problems.append(f'CHANGED {i}: {fid} -> {by_id[i]}')
        elif by_fid.get(fid) != i:
            problems.append(f'REMINTED {fid}: {i} -> {by_fid.get(fid)}')
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pairs', nargs='*', metavar='GENDIR:SRCFILE', help='default: DEFAULT_PAIRS')
    ap.add_argument('--out', default=os.environ.get('FACTOIDS_OUT', DEFAULT_OUT),
                    help='factoid bank to write; also the id registry (env FACTOIDS_OUT)')
    ap.add_argument('--facts', default=os.environ.get('FACTS_BANK', DEFAULT_FACTS),
                    help='science-facts.jsonl for the MATATAG domain (env FACTS_BANK)')
    ap.add_argument('--patches', default=os.environ.get('FACTOID_PATCHES', DEFAULT_PATCHES),
                    help='post-assembly overlay (text/q fixes, retirements) keyed by ffct id (env FACTOID_PATCHES)')
    ap.add_argument('--check', action='store_true',
                    help='dry run: re-assemble, report, exit 1 if any existing id changed/vanished; never writes')
    ap.add_argument('--baseline', help='bank whose ids must survive (default: the committed --out via git show HEAD:, '
                                       'else --out itself); e.g. a snapshot')
    ap.add_argument('--init', action='store_true', help='allow a MISSING registry (mint a brand-new bank from ffct-00000)')
    ap.add_argument('--allow-content-change', action='store_true',
                    help='write even if content changed under an existing id (intended regeneration)')
    a = ap.parse_args(argv)
    pairs = a.pairs or DEFAULT_PAIRS

    if not os.path.exists(a.out) and not a.init:
        print(f'no registry at {a.out}: refusing to mint from ffct-00000 positionally — point --out at the real bank, '
              f'or pass --init for a brand-new bank', file=sys.stderr)
        return 1
    reg_rows, fid2id = load_registry(a.out)
    if a.baseline and os.path.abspath(a.baseline) != os.path.abspath(a.out):
        base_rows, base_label = load_registry(a.baseline)[0], a.baseline
    else:
        base_rows, base_label = git_head_registry(a.out) or (reg_rows, f'{a.out} (registry itself: not a tracked file)')
    patches = load_patches(a.patches)
    records, malformed = build_records(pairs, a.facts)
    rows, new_ids, carried = assign_ids(records, reg_rows, fid2id)
    n_patched = apply_patches(rows, patches)
    problems = id_problems(base_rows, rows)

    body = serialise(rows).encode('utf-8')
    reused = len(rows) - len(new_ids) - len(carried)
    new_by_id = {r['id']: r for r in rows}
    changed = [i for i, r in reg_rows.items() if serialise([new_by_id[i]]) != serialise([r])]   # incl. carried rows a patch touched

    mode = 'CHECK (dry run)' if a.check else 'WRITE'
    print(f'{mode}: {len(rows)} factoids (malformed {malformed}) → {a.out}')
    print(f'  ids: registry {len(reg_rows)} | reused {reused} | new {len(new_ids)}'
          + (f' ({new_ids[0]}..{new_ids[-1]})' if new_ids else '')
          + f' | carried over (not in inputs) {len(carried)} | next free {mint(max((parse_id(r["id"]) for r in rows), default=-1) + 1)}')
    print(f'  baseline: {base_label} ({len(base_rows)} ids) | patches applied: {n_patched}'
          + (f' from {a.patches}' if n_patched else f' (no patch file at {a.patches})'))
    print(f'  content changed under an existing id: {len(changed)}'
          + (f' e.g. {", ".join(changed[:10])}' if changed else '')
          + (' (write would refuse without --allow-content-change)' if changed and not a.allow_content_change else ''))
    qa = sum(1 for r in rows if r['format'] == 'qa')
    withslug = sum(1 for r in rows if r['image']['slug'])
    withprompt = sum(1 for r in rows if r['image']['prompt'])
    noimg = len(rows) - withslug - withprompt
    print(f'  format: qa {qa} / straight {len(rows) - qa}')
    print(f'  image: existing slug {withslug} | prompt {withprompt} | NEITHER {noimg}')
    print(f'  by domain: {dict(Counter(r["domain"] for r in rows))}')
    print(f'  size: {len(body) / 1e6:.1f} MB')

    if a.check:
        new_sha = sha256(body)
        if os.path.exists(a.out):
            with open(a.out, 'rb') as f:
                old_sha = sha256(f.read())
            print(f'  sha256 current {old_sha}\n  sha256 would-be {new_sha}\n'
                  f'  byte-identical to current bank: {"YES" if old_sha == new_sha else "NO"}')
        else:
            print(f'  sha256 would-be {new_sha} (no current bank)')
    if problems:
        print(f'ID INVARIANT VIOLATED ({len(problems)}):', file=sys.stderr)
        for p in problems[:50]:
            print('  ' + p, file=sys.stderr)
        print('  refusing to ' + ('pass' if a.check else 'write'), file=sys.stderr)
        return 1
    if a.check:
        print('  append-only id check: OK (every baseline id survives with the same factId)')
        return 0
    if changed and not a.allow_content_change:
        print(f'CONTENT CHANGED under {len(changed)} existing id(s) — refusing to write. Intended regeneration: re-run with '
              f'--allow-content-change. A post-assembly fix being reverted: port it into {a.patches} instead.', file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    tmp = a.out + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(body)
    os.replace(tmp, a.out)                       # atomic: never leave a half-written registry
    return 0


if __name__ == '__main__':
    sys.exit(main())

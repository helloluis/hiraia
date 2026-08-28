#!/usr/bin/env python3
"""Append Lane A to the bank and carry it through the feed pipeline (FACT-SWARM-SPEC.md, "stage + feed voice",
"exact tags", "pool + gate", "illustrate"). The consumer of ingest-lane-a.py's emit stage.

Inputs (rag/pipeline/lane-a/out/):
  lane-a-ingest-ready.jsonl          bank-schema rows + brief_code/card_form          (main stream)
  lane-a-ingest-ready.G5-L-3.jsonl   same, the AUP stream — ids/counts only in any output, text never printed
  lane-a-tags.json                   curriculum-tags v2 fragment keyed by BANK fact id

Stages — every one is idempotent and resumable, and refuses to apply the same rows twice:
  bank      back up science-facts.jsonl + factoids.jsonl + curriculum-tags.json → rag/bank/.backup-<date>/ (first backup
            wins, self-ignored), strip brief_code/card_form → out/lane-a-bank-meta.json, append the rows (generator lane-a,
            reviewed false); refuses if any Lane A id is already banked (skips when ALL are: already applied)
  src       rag/pipeline/factoids-lane-a-src.jsonl in build-factoid-src.py's SRC schema, has_image=false for every row;
            main stream first, AUP stream last, so no 8-row Fireworks call ever mixes the two
  gen       fw-gen-factoids.py (SRC=… TAG=lane-a): FW_LIMIT=1 smoke call, then the full run (resumable per gen file);
            factoid-qa.py report (AUP-redacted) + the same mechanical rules in-process; rows that fail are regenerated
            ALONE, per stream, in place (bad rows removed from their gen file, fixed rows in gen-lane-a-fix<k>-<stream>-*.jsonl)
  assemble  assemble-factoids.py --check (six DEFAULT_PAIRS + the lane-a pair) → write → --check; new ids start at the
            registry's next free id (ffct-36384 for the 36,384-row bank); every pre-existing row byte-identical to git HEAD
  tags      re-key the fragment to the NEW ffct ids → curriculum-tags.json `factoids` (v2 entry incl. `models`, cells_strong =
            cells, score/confidence 1.0; never overwrites another labeller's entry); the `bank` section is left as found
            ({} by design — bank-fact coverage is derived from factoids via factId; the fragment stays in out/lane-a-tags.json);
            refuses to write unless every pre-existing entry is unchanged vs the loaded file AND vs the backup; then
            gen-curriculum-tags.mjs (the new factoids have no image so they are NOT pool cards → generated file unchanged)
  vectors   rag/scripts/build-vectors.py (convert-venv python) + rag/scripts/export-facts-ts.py; meta count + bankHash
            must equal the bank
  images    illustration worklist per stream {id: ffct, prompt} → OpenAI Batch /v1/images/generations with
            batch-submit-all.py's exact request body (gpt-image-2 low 1024, engraving STYLE), CHUNK≈120 so each output
            file is API-downloadable; SUBMIT ONLY — batch ids + submission time → out/image-batches.json; never waits
  fetch     poll every batch and book status + request_counts AT FETCH TIME in out/image-batches.json; for each completed
            batch: error file → failed custom_ids (ids + error code only) → out/image-declined.jsonl and the qwen-image
            fallback worklist out/image-fallback-worklist.jsonl (spec "illustrate": body cells pre-planned for it);
            output file → rag/pipeline/imagegen/<batch_id>.jsonl → extract.py → to-webp.py --only → imagegen/webp/<id>.webp
            (staging). Wiring into the pool (copy to factoid-webp/, to-card-png.mjs, gen-image-map.mjs, gen-cards-pool.py,
            gen-curriculum-tags.mjs, gen-cards-questions.py) is a separate step once every batch has landed
  gate      bash finetuning/eval/harness/run-harness.sh → out/gate.log, verdict echoed verbatim

  set -a; . ./.env.local; set +a          # FIREWORKS_API_KEY (gen), OPENAI_API_KEY (images)
  python3 rag/pipeline/lane-a/append-lane-a.py                       # all stages
  python3 rag/pipeline/lane-a/append-lane-a.py --stages bank,src     # a subset, in pipeline order
  python3 rag/pipeline/lane-a/append-lane-a.py --status              # what has been applied
State: out/append-state.json (stage → when/what). Spend ledger (Fireworks tokens, OpenAI images) lives there too.
"""
import argparse, datetime, glob, hashlib, importlib.util, json, math, os, re, shutil, signal, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(HERE, 'out')
BANK = os.path.join(ROOT, 'rag', 'bank', 'science-facts.jsonl')
FACTOIDS = os.path.join(ROOT, 'rag', 'bank', 'factoids.jsonl')
TAGS = os.path.join(ROOT, 'rag', 'bank', 'curriculum-tags.json')
FRAGMENT = os.path.join(OUT, 'lane-a-tags.json')
META_OUT = os.path.join(OUT, 'lane-a-bank-meta.json')
STATE = os.path.join(OUT, 'append-state.json')
BATCHES_OUT = os.path.join(OUT, 'image-batches.json')
SRC = os.path.join(ROOT, 'rag', 'pipeline', 'factoids-lane-a-src.jsonl')
TAG = 'lane-a'
GEN_DIR = os.path.join(ROOT, 'rag', 'pipeline', f'factoids-gen-{TAG}')
PAIR = f'rag/pipeline/factoids-gen-{TAG}:rag/pipeline/factoids-lane-a-src.jsonl'
ASSEMBLER = os.path.join(ROOT, 'rag', 'pipeline', 'assemble-factoids.py')
FW_GEN = os.path.join(ROOT, 'rag', 'pipeline', 'fw-gen-factoids.py')
FACTOID_QA = os.path.join(ROOT, 'rag', 'pipeline', 'factoid-qa.py')
BATCH_SUBMIT = os.path.join(ROOT, 'packages', 'images', 'qwen-queue', 'batch-submit-all.py')
GEN_TAGS_MJS = os.path.join(ROOT, 'packages', 'mobile', 'scripts', 'gen-curriculum-tags.mjs')
GEN_TAGS_OUT = os.path.join(ROOT, 'packages', 'mobile', 'src', 'generated', 'curriculumTags.generated.json')
VENV_PY = os.path.join(ROOT, 'finetuning', '.convert-venv', 'bin', 'python')
VEC_META = os.path.join(ROOT, 'packages', 'mobile', 'assets', 'rag', 'vectors-labse.meta.json')
EXPORT_TS = os.path.join(ROOT, 'packages', 'shared', 'src', 'rag', 'facts.generated.ts')
GATE = os.path.join(ROOT, 'finetuning', 'eval', 'harness', 'run-harness.sh')

STREAMS = [('main', 'lane-a-ingest-ready.jsonl'), ('G5-L-3', 'lane-a-ingest-ready.G5-L-3.jsonl')]
AUP = {'G5-L-3'}
BANK_FIELDS = ('id', 'domain', 'topic', 'grades', 'terms', 'fact', 'source', 'generator', 'reviewed')
SIDE_FIELDS = ('brief_code', 'card_form')
PER_CALL = 8                      # fw-gen-factoids.py FW_PER_CALL default; 656 main rows = 82 whole calls
STYLE_MARK = 'hand-drawn line art'   # factoid-qa.py STYLE_MARK
STAGES = ['bank', 'src', 'gen', 'assemble', 'tags', 'vectors', 'images', 'fetch', 'gate']
IMAGEGEN = os.path.join(ROOT, 'rag', 'pipeline', 'imagegen')
DECLINED_OUT = os.path.join(OUT, 'image-declined.jsonl')
FALLBACK_OUT = os.path.join(OUT, 'image-fallback-worklist.jsonl')
IMAGE_USD = 0.0032                # gpt-image-2 low, batch pricing (FACT-SWARM-SPEC.md "illustrate")
MAX_REGEN_ROUNDS = 3


def log(msg=''):
    print(msg, flush=True)


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return [json.loads(l) for l in f if l.strip()]


def write_jsonl(path, rows):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    os.replace(tmp, path)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {'stages': {}, 'fireworks': {'calls': 0, 'tokens_in': 0, 'tokens_out': 0, 'est_usd': 0.0, 'runs': []}}


def save_state(st):
    tmp = STATE + '.tmp'
    json.dump(st, open(tmp, 'w'), indent=1)
    os.replace(tmp, STATE)


def mark(st, stage, **info):
    st['stages'][stage] = dict(done_at=now(), **info)
    save_state(st)


def run(cmd, env=None, cwd=ROOT, log_to=None, check=True):
    """Run a subprocess, streaming its stdout+stderr to our stdout (and optionally a log file). Returns (rc, text)."""
    log(f'$ {" ".join(cmd)}')
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    lines = []
    fh = open(log_to, 'a', encoding='utf-8') if log_to else None
    try:
        for line in p.stdout:
            lines.append(line)
            if fh:
                fh.write(line)
            else:
                sys.stdout.write(line)
                sys.stdout.flush()
        p.wait()
    except BaseException as e:                   # Ctrl-C / SIGTERM: the caller can still book what was printed
        e.partial_output = ''.join(lines)
        p.kill()
        raise
    finally:
        if fh:
            fh.close()
    if check and p.returncode != 0:
        e = SystemExit(f'command failed rc={p.returncode}: {" ".join(cmd)}')
        e.partial_output = ''.join(lines)
        raise e
    return p.returncode, ''.join(lines)


def backup(st, *paths):
    """Copy each path into rag/bank/.backup-<date>/ (first backup wins, the dir ignores itself). Returns {path: copy}."""
    date = st.get('backup_date') or datetime.date.today().isoformat()
    bdir = os.path.join(ROOT, 'rag', 'bank', f'.backup-{date}')
    os.makedirs(bdir, exist_ok=True)
    with open(os.path.join(bdir, '.gitignore'), 'w') as f:
        f.write('*\n')                                   # a 60 MB copy must never be committed by accident
    out = {}
    for src in paths:
        dst = os.path.join(bdir, os.path.basename(src))
        if not os.path.exists(dst):
            shutil.copy2(src, dst)
        log(f'backup {os.path.relpath(dst, ROOT)} sha256 {sha256_file(dst)[:12]} '
            f'({"same as live" if sha256_file(dst) == sha256_file(src) else "DIFFERS from live"})')
        out[src] = dst
    st['backup_date'] = date
    st['backup_dir'] = os.path.relpath(bdir, ROOT)
    save_state(st)
    return out


# ---------------------------------------------------------------------------------------------- inputs
def lane_rows():
    """[(stream, row)] in append order: main first, AUP stream last."""
    out = []
    for stream, fn in STREAMS:
        rows = read_jsonl(os.path.join(OUT, fn))
        if not rows:
            raise SystemExit(f'missing/empty input {fn}')
        for r in rows:
            missing = [k for k in BANK_FIELDS + SIDE_FIELDS if k not in r]
            if missing:
                raise SystemExit(f'{stream} row {r.get("id")} lacks {missing}')
            if not all((r['fact'].get(k) or '').strip() for k in ('en', 'tl', 'bis')):
                raise SystemExit(f'{stream} row {r["id"]} has an empty language')
            out.append((stream, r))
    ids = [r['id'] for _, r in out]
    if len(ids) != len(set(ids)):
        raise SystemExit('duplicate ids inside the Lane A inputs')
    return out


def lane_ids_by_stream():
    return {s: [r['id'] for s2, r in lane_rows() if s2 == s] for s, _ in STREAMS}


def aup_strings():
    """Every AUP-stream text we know of (source sentences + generated card text) — used to redact tool output."""
    s = set()
    for stream, r in lane_rows():
        if stream in AUP:
            s.update(v for v in (r['fact'].get('en'), r['fact'].get('tl'), r['fact'].get('bis'), r.get('topic')) if v)
    aup_ids = set(lane_ids_by_stream().get('G5-L-3', []))
    for fn in glob.glob(os.path.join(GEN_DIR, 'gen-*.jsonl')):
        for r in read_jsonl(fn):
            if r.get('factId') in aup_ids:
                s.update(v for k, v in r.items() if isinstance(v, str) and len(v) > 10)
    return {x.strip() for x in s if len(x.strip()) > 10}


def redact(text, strings):
    """Drop any line that carries AUP text (either direction: the tool prints 110-char prefixes)."""
    out, n = [], 0
    for line in text.splitlines():
        t = re.sub(r'^\s*(Q:|A:|src:|•)\s*', '', line).strip()
        hit = len(t) >= 15 and any(t in s or s in t for s in strings)
        if hit:
            n += 1
            out.append('  [line withheld: AUP stream]')
        else:
            out.append(line)
    return '\n'.join(out), n


# ---------------------------------------------------------------------------------------------- stage: bank
def stage_bank(st):
    rows = lane_rows()
    ids = [r['id'] for _, r in rows]
    bank = read_jsonl(BANK)
    bank_ids = {r['id'] for r in bank}
    present = [i for i in ids if i in bank_ids]
    if present and len(present) == len(ids):
        log(f'bank: all {len(ids)} Lane A ids already banked (already applied) — nothing to do; bank {len(bank):,}')
        st['stages'].setdefault('bank', dict(done_at='(pre-existing)', appended=0, bank_after=len(bank)))
        save_state(st)
        return
    if present:
        raise SystemExit(f'bank: {len(present)}/{len(ids)} Lane A ids are ALREADY in the bank (partial apply) — refusing; '
                         f'e.g. {present[:5]}')
    if len(bank_ids) != len(bank):
        raise SystemExit('bank: duplicate ids in the existing bank — refusing to append')

    backup(st, BANK, FACTOIDS, TAGS)                    # TAGS too: stage_tags rewrites it and its v2 content may be uncommitted
    bdir = os.path.join(ROOT, st['backup_dir'])

    meta ={r['id']: {'stream': stream, **{k: r[k] for k in SIDE_FIELDS}} for stream, r in rows}
    json.dump({'scheme': 'Lane A side fields stripped from the bank rows at append (bank rows carry only the bank schema); '
                         'keyed by bank fact id', 'when': now(), 'rows': meta}, open(META_OUT, 'w'), indent=1)

    new_lines = []
    for _, r in rows:
        row = {k: r[k] for k in BANK_FIELDS}
        row['generator'] = 'lane-a'
        row['reviewed'] = False
        new_lines.append(json.dumps(row, ensure_ascii=False) + '\n')
    with open(BANK, 'rb') as f:
        old = f.read()
    if old and not old.endswith(b'\n'):
        old += b'\n'
    tmp = BANK + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(old + ''.join(new_lines).encode('utf-8'))
    os.replace(tmp, BANK)

    after = read_jsonl(BANK)
    after_ids = [r['id'] for r in after]
    if len(after) != len(bank) + len(rows) or len(set(after_ids)) != len(after_ids):
        raise SystemExit(f'bank: post-append check FAILED (count {len(after)}, unique {len(set(after_ids))}); '
                         f'restore from {bdir}')
    by_stream = {s: sum(1 for s2, _ in rows if s2 == s) for s, _ in STREAMS}
    log(f'bank: appended {len(rows)} rows ({by_stream}) → {len(bank):,} → {len(after):,}; ids unique; '
        f'side fields → {os.path.relpath(META_OUT, ROOT)}')
    mark(st, 'bank', appended=len(rows), by_stream=by_stream, bank_before=len(bank), bank_after=len(after),
         bank_sha256=sha256_file(BANK))


# ---------------------------------------------------------------------------------------------- stage: src
def stage_src(st):
    rows = lane_rows()
    src_rows = [{'id': r['id'], 'topic': r.get('topic', ''), 'grades': r.get('grades', [5]),
                 'en': r['fact']['en'], 'tl': r['fact']['tl'], 'bis': r['fact']['bis'],
                 'has_image': False, 'slug': None} for _, r in rows]
    want = ''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in src_rows)
    if os.path.exists(SRC):
        have = open(SRC, encoding='utf-8').read()
        if have == want:
            log(f'src: {os.path.relpath(SRC, ROOT)} already staged ({len(src_rows)} rows, identical) — skip')
            st['stages'].setdefault('src', dict(done_at='(pre-existing)', rows=len(src_rows)))
            save_state(st)
            return
        if glob.glob(os.path.join(GEN_DIR, 'gen-*.jsonl')):
            raise SystemExit(f'src: {SRC} differs from the inputs but generation already started — refusing to restage')
    with open(SRC + '.tmp', 'w', encoding='utf-8') as f:
        f.write(want)
    os.replace(SRC + '.tmp', SRC)
    n_main = sum(1 for s, _ in rows if s == 'main')
    log(f'src: staged {len(src_rows)} rows → {os.path.relpath(SRC, ROOT)} (has_image=false for all; main {n_main} '
        f'= {n_main / PER_CALL:g} calls of {PER_CALL}, AUP stream after) ')
    mark(st, 'src', rows=len(src_rows), main=n_main, aup=len(src_rows) - n_main)


# ---------------------------------------------------------------------------------------------- stage: gen
def fw_env(src, tag, limit=None):
    if not os.environ.get('FIREWORKS_API_KEY'):
        raise SystemExit('FIREWORKS_API_KEY missing — set -a; . ./.env.local; set +a')
    env = dict(os.environ, SRC=src, TAG=tag)
    env.pop('FW_LIMIT', None)
    if limit:
        env['FW_LIMIT'] = str(limit)
    return env


def ledger(st, text, label):
    """Accumulate fw-gen-factoids.py's printed token/cost line into the state ledger. A run that died before its summary
    line (killed, crashed) is booked from its last '...N calls | … | Nk out' progress line instead — a LOWER bound
    (progress prints every 25 calls; tokens_in unknown → 0; cost from the out tokens only), flagged `partial` — so no
    call goes unrecorded."""
    m = re.search(r'tokens in/out ([\d,]+)/([\d,]+) \| est cost ~\$([\d.]+)', text)
    c = re.search(r'from (\d+) calls \| failed (\d+)', text)
    fw = st['fireworks']
    if m:
        tin, tout, usd = int(m.group(1).replace(',', '')), int(m.group(2).replace(',', '')), float(m.group(3))
        calls, failed, partial = (int(c.group(1)) if c else None), (int(c.group(2)) if c else None), None
    else:
        p = re.findall(r'\.\.\.(\d+) calls \| \d+ factoids \| (\d+)k out', text)
        if not p:
            return
        calls, tout = int(p[-1][0]), int(p[-1][1]) * 1000
        tin, usd, failed = 0, round(tout / 1e6 * 0.88, 4), None
        partial = 'no summary line: LOWER bound from the last progress line (every 25 calls); tokens_in unknown'
    fw['tokens_in'] += tin
    fw['tokens_out'] += tout
    fw['est_usd'] = round(fw['est_usd'] + usd, 4)
    fw['calls'] += calls or 0
    entry = dict(label=label, when=now(), tokens_in=tin, tokens_out=tout, est_usd=usd, calls=calls, failed=failed)
    if partial:
        entry['partial'] = partial
    fw['runs'].append(entry)
    save_state(st)


def gen_rows():
    """{factId: (file, row)} across the gen dir, plus the duplicate factIds."""
    seen, dups = {}, set()
    for fn in sorted(glob.glob(os.path.join(GEN_DIR, 'gen-*.jsonl'))):
        for r in read_jsonl(fn):
            fid = r.get('factId')
            if fid in seen:
                dups.add(fid)
            else:
                seen[fid] = (fn, r)
    return seen, dups


def words(s):
    return len(re.findall(r'\S+', s or ''))


def mechanical_issues(src_rows):
    """factoid-qa.py's mechanical rules, per factId (+ missing rows and duplicates). Never prints text."""
    seen, dups = gen_rows()
    issues = {}
    for s in src_rows:
        fid = s['id']
        if fid not in seen:
            issues[fid] = ['missing-row']
            continue
        r = seen[fid][1]
        probs = []
        if not all((r.get(k) or '').strip() for k in ('t_en', 't_tl', 't_bis')):
            probs.append('missing-body-lang')
        if r.get('format') == 'qa' and not all((r.get(k) or '').strip() for k in ('q_en', 'q_tl', 'q_bis')):
            probs.append('qa-missing-question')
        if r.get('format') == 'straight' and (r.get('q_en') or '').strip():
            probs.append('straight-has-question')
        w = words(r.get('t_tl', ''))
        if w > 45:
            probs.append('long-body')
        if w < 3:
            probs.append('too-short-body')
        ip = (r.get('image_prompt') or '').strip()
        if s.get('has_image') and ip:
            probs.append('prompt-when-image-exists')
        if not s.get('has_image') and not ip:
            probs.append('no-prompt-no-image')
        if ip and STYLE_MARK not in ip.lower():
            probs.append('prompt-missing-style')
        if fid in dups:
            probs.append('dup-factId')
        if probs:
            issues[fid] = probs
    return issues


def run_fw_gen(st, src, tag, label, limit=None):
    try:
        _, text = run([sys.executable, FW_GEN], env=fw_env(src, tag, limit))
    except BaseException as e:                   # killed / failed mid-run: book the partial output, then propagate
        ledger(st, getattr(e, 'partial_output', ''), f'{label}-killed')
        raise
    ledger(st, text, label)
    return text


def qa_report(st, round_no):
    """factoid-qa.py's report, saved verbatim to out/, echoed with AUP lines withheld."""
    rc, text = run([sys.executable, FACTOID_QA, os.path.join(GEN_DIR, 'gen-*.jsonl'), SRC], log_to=os.devnull, check=False)
    path = os.path.join(OUT, f'factoid-qa.round{round_no}.txt')
    open(path, 'w', encoding='utf-8').write(text)
    shown, withheld = redact(text, aup_strings())
    log(f'--- factoid-qa.py (round {round_no}; saved {os.path.relpath(path, ROOT)}; {withheld} line(s) withheld) ---')
    log(shown)
    return text


def regen_round(st, issues, src_rows, streams):
    """Regenerate ONLY the failing rows, per stream, in place. Returns the round number used."""
    moved_rounds = [int(m.group(1)) for fn in glob.glob(os.path.join(GEN_DIR, 'gen-*-fix*.jsonl'))
                    for m in [re.search(r'-fix(\d+)-', os.path.basename(fn))] if m]
    pending = [int(m.group(1)) for d in glob.glob(os.path.join(ROOT, 'rag', 'pipeline', f'factoids-gen-{TAG}-fix*'))
               for m in [re.search(r'-fix(\d+)-', os.path.basename(d))] if m]
    k = min(pending) if pending else (max(moved_rounds) + 1 if moved_rounds else 1)
    if k > MAX_REGEN_ROUNDS:
        raise SystemExit(f'gen: {len(issues)} rows still failing after {MAX_REGEN_ROUNDS} regen rounds: {sorted(issues)[:20]}')
    by_src = {s['id']: s for s in src_rows}
    for stream, ids in streams.items():
        fids = [i for i in ids if i in issues]
        if not fids:
            continue
        tag = f'{TAG}-fix{k}-{stream}'
        sub = os.path.join(OUT, f'regen-{k}.{stream}-src.jsonl')
        write_jsonl(sub, [by_src[i] for i in fids])
        log(f'gen: regen round {k} [{stream}] {len(fids)} row(s): ' +
            ', '.join(f'{i}({"/".join(issues[i])})' for i in fids[:40]) + (' …' if len(fids) > 40 else ''))
        run_fw_gen(st, sub, tag, f'regen{k}-{stream}')
        fix_dir = os.path.join(ROOT, 'rag', 'pipeline', f'factoids-gen-{tag}')
        # 1) drop the failing rows from their original files (first occurrence would otherwise win at assembly)
        for fn in glob.glob(os.path.join(GEN_DIR, 'gen-*.jsonl')):
            rows = read_jsonl(fn)
            keep = [r for r in rows if r.get('factId') not in fids]
            if len(keep) != len(rows):
                write_jsonl(fn, keep)
        # 2) move the fixed rows in (names are unique: gen-<tag>-<i>.jsonl never collides with gen-lane-a-<i>.jsonl)
        for fn in sorted(glob.glob(os.path.join(fix_dir, 'gen-*.jsonl'))):
            os.replace(fn, os.path.join(GEN_DIR, os.path.basename(fn)))
        if os.path.isdir(fix_dir) and not os.listdir(fix_dir):
            os.rmdir(fix_dir)
    return k


def stage_gen(st):
    src_rows = read_jsonl(SRC)
    if not src_rows:
        raise SystemExit('gen: run the src stage first')
    streams = lane_ids_by_stream()
    n_batches = math.ceil(len(src_rows) / PER_CALL)
    expected = {f'gen-{TAG}-{i}.jsonl' for i in range(n_batches)}
    os.makedirs(GEN_DIR, exist_ok=True)
    have = {os.path.basename(f) for f in glob.glob(os.path.join(GEN_DIR, 'gen-*.jsonl'))}
    if f'gen-{TAG}-0.jsonl' not in have:
        log(f'gen: smoke test — FW_LIMIT=1 ({PER_CALL} rows, batch 0 = main stream)')
        run_fw_gen(st, SRC, TAG, 'smoke', limit=1)
    if not expected <= have:                            # the rest of the run is gated on batch 0 passing
        smoke = read_jsonl(os.path.join(GEN_DIR, f'gen-{TAG}-0.jsonl'))
        iss = mechanical_issues(src_rows[:PER_CALL])
        log(f'gen: smoke rows {len(smoke)}/{PER_CALL}, mechanical issues {iss if iss else "NONE"}')
        for r in smoke[:2]:
            log(f'  sample {r["factId"]} [{r["format"]}] t_en: {r["t_en"][:160]}')
            log(f'    image_prompt: {r.get("image_prompt", "")[:140]}…')
        if len(smoke) < PER_CALL - 2 or any('prompt' in x for v in iss.values() for x in v):
            raise SystemExit('gen: smoke test looks wrong — stopping before the full run')
    for attempt in range(3):
        have = {os.path.basename(f) for f in glob.glob(os.path.join(GEN_DIR, 'gen-*.jsonl'))}
        if expected <= have:
            break
        log(f'gen: full run — {len(expected - have)} of {n_batches} calls to go (attempt {attempt + 1})')
        run_fw_gen(st, SRC, TAG, f'full-{attempt + 1}')
    have = {os.path.basename(f) for f in glob.glob(os.path.join(GEN_DIR, 'gen-*.jsonl'))}
    if not expected <= have:
        raise SystemExit(f'gen: {len(expected - have)} call(s) never produced a file: {sorted(expected - have)[:10]}')

    rounds = 0
    for _ in range(MAX_REGEN_ROUNDS + 1):
        qa_report(st, rounds)
        issues = mechanical_issues(src_rows)
        by_kind = {}
        for probs in issues.values():
            for p in probs:
                by_kind[p] = by_kind.get(p, 0) + 1
        log(f'gen: mechanical issues after round {rounds}: {len(issues)} row(s) {by_kind if by_kind else "NONE"}')
        if not issues:
            break
        regen_round(st, issues, src_rows, streams)
        rounds += 1
    else:
        issues = mechanical_issues(src_rows)
        raise SystemExit(f'gen: {len(issues)} row(s) still failing after {MAX_REGEN_ROUNDS} regen rounds — not minting them: '
                         f'{sorted(issues)}')
    seen, dups = gen_rows()
    fmt = {}
    for _, r in seen.values():
        fmt[r['format']] = fmt.get(r['format'], 0) + 1
    log(f'gen: {len(seen)} rows for {len(src_rows)} src rows, dups {len(dups)}, formats {fmt}, regen rounds {rounds}; '
        f'Fireworks ledger {st["fireworks"]["calls"]} calls, in/out {st["fireworks"]["tokens_in"]:,}/{st["fireworks"]["tokens_out"]:,}, '
        f'est ${st["fireworks"]["est_usd"]:.2f}')
    mark(st, 'gen', rows=len(seen), src_rows=len(src_rows), formats=fmt, regen_rounds=rounds, files=len(have))


# ---------------------------------------------------------------------------------------------- stage: assemble
def assembler_pairs():
    spec = importlib.util.spec_from_file_location('assemble_factoids', ASSEMBLER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return list(mod.DEFAULT_PAIRS)


def assemble(args):
    rc, text = run([sys.executable, ASSEMBLER] + args, log_to=os.devnull, check=False)
    log(text.rstrip())
    return rc, text


def stage_assemble(st):
    pairs = assembler_pairs()
    if len(pairs) != 6:
        raise SystemExit(f'assemble: expected the six DEFAULT_PAIRS, found {len(pairs)}')
    lane = {r['id'] for _, r in lane_rows()}
    reg = read_jsonl(FACTOIDS)
    banked = {r['factId'] for r in reg}
    already = lane & banked
    head_ids = [json.loads(l)['id'] for l in subprocess.run(['git', 'show', 'HEAD:rag/bank/factoids.jsonl'], cwd=ROOT,
                                                            capture_output=True, text=True, check=True).stdout.splitlines() if l.strip()]
    if not already:
        log('assemble: --check with the six DEFAULT_PAIRS only (must be byte-identical + append-only OK):')
        rc, text = assemble(['--check'] + pairs)
        if rc != 0 or 'byte-identical to current bank: YES' not in text:
            raise SystemExit('assemble: pre-check with DEFAULT_PAIRS failed')
        log('assemble: --check with DEFAULT_PAIRS + lane-a pair (dry run of the append):')
        rc, text = assemble(['--check'] + pairs + [PAIR])
        m = re.search(r'new (\d+) \((ffct-\d+)\.\.(ffct-\d+)\)', text)
        if rc != 0 or not m:
            raise SystemExit('assemble: dry run of the append failed')
        expect_first = f'ffct-{max(int(r["id"].split("-")[1]) for r in reg) + 1:05d}'
        if m.group(2) != expect_first:
            raise SystemExit(f'assemble: first new id {m.group(2)} != next free {expect_first}')
        log(f'assemble: WRITE ({m.group(1)} new ids {m.group(2)}..{m.group(3)}):')
        rc, text = assemble(pairs + [PAIR])
        if rc != 0:
            raise SystemExit('assemble: write failed')
    elif len(already) == len(lane):
        log(f'assemble: all {len(already)} Lane A factIds already minted (already applied) — re-check only')
    else:
        log(f'assemble: {len(already)}/{len(lane)} Lane A factIds already minted — the registry keeps those ids, '
            f'the rest are appended after them')
        rc, text = assemble(pairs + [PAIR])
        if rc != 0:
            raise SystemExit('assemble: write failed')
    log('assemble: post-write --check (baseline = git HEAD):')
    rc, text = assemble(['--check'] + pairs + [PAIR])
    if rc != 0 or 'append-only id check: OK' not in text or 'byte-identical to current bank: YES' not in text:
        raise SystemExit('assemble: post-write check failed')

    new = read_jsonl(FACTOIDS)
    head = subprocess.run(['git', 'show', 'HEAD:rag/bank/factoids.jsonl'], cwd=ROOT, capture_output=True, check=True).stdout
    with open(FACTOIDS, 'rb') as f:
        cur = f.read()
    prefix_ok = cur.startswith(head)
    bdir = os.path.join(ROOT, st.get('backup_dir', '')) if st.get('backup_dir') else None
    backup_ok = bool(bdir) and cur.startswith(open(os.path.join(bdir, 'factoids.jsonl'), 'rb').read())
    new_rows = [r for r in new if r['factId'] in lane]
    nums = [int(r['id'].split('-')[1]) for r in new_rows]
    contiguous = nums == list(range(len(head_ids), len(head_ids) + len(nums)))
    with_slug = sum(1 for r in new_rows if r['image'].get('slug'))
    with_prompt = sum(1 for r in new_rows if r['image'].get('prompt'))
    tri = sum(1 for r in new_rows if all(r['text'].get(k) for k in ('en', 'tl', 'bis')))
    dom = {}
    for r in new_rows:
        dom[r['domain']] = dom.get(r['domain'], 0) + 1
    log(f'assemble: bank {len(head_ids):,} → {len(new):,}; new Lane A factoids {len(new_rows)} '
        f'(ids {new_rows[0]["id"] if new_rows else "-"}..{new_rows[-1]["id"] if new_rows else "-"}, contiguous {contiguous}); '
        f'pre-existing {len(head_ids):,} rows byte-identical to git HEAD: {prefix_ok}; to backup: {backup_ok}; '
        f'image slug {with_slug} / prompt {with_prompt}; trilingual {tri}; by domain {dom}')
    if not (prefix_ok and contiguous and with_slug == 0 and with_prompt == len(new_rows) and tri == len(new_rows)):
        raise SystemExit('assemble: post-conditions failed')
    mark(st, 'assemble', bank_before=len(head_ids), bank_after=len(new), new=len(new_rows),
         first_id=new_rows[0]['id'] if new_rows else None, last_id=new_rows[-1]['id'] if new_rows else None,
         prefix_identical_to_head=prefix_ok, by_domain=dom)


# ---------------------------------------------------------------------------------------------- stage: tags
def stage_tags(st):
    frag = json.load(open(FRAGMENT))['bank']
    lane = {r['id'] for _, r in lane_rows()}
    fid_of = {r['id']: r['factId'] for r in read_jsonl(FACTOIDS) if r['factId'] in lane}
    if len(fid_of) != len(lane):
        raise SystemExit(f'tags: only {len(fid_of)}/{len(lane)} Lane A factoids minted — run assemble first')
    bak = backup(st, TAGS)[TAGS]                       # pre-write copy (first backup wins): the baseline the write is checked against
    T = json.load(open(TAGS))
    if not str(T.get('scheme', '')).startswith('v2'):
        raise SystemExit('tags: curriculum-tags.json is not the v2 scheme')
    T.setdefault('bank', {})                           # left as found: {} by design (see the file's scheme string)
    pre = {k: dict(v) for k, v in T['factoids'].items()}
    added = kept = 0
    for ffct, fid in sorted(fid_of.items()):
        f = frag.get(fid)
        if not f:
            raise SystemExit(f'tags: no fragment for bank id {fid} ({ffct})')
        entry = {'competency': f['competency'], 'grade': f['grade'], 'quarter': f['quarter'], 'domain': f['domain'],
                 'codes': list(f['codes']), 'cells': list(f['cells']), 'score': 1.0, 'confidence': 1.0,
                 'cells_strong': list(f['cells']), 'models': 1}   # `models` as assemble-competency-labels.py writes on every v2 entry: one (exact) labeller
        have = T['factoids'].get(ffct)
        if have is None:
            T['factoids'][ffct] = entry
            added += 1
        elif have == entry or have == {k: v for k, v in entry.items() if k != 'models'}:
            T['factoids'][ffct] = entry                # our own earlier write (possibly pre-`models`): keep, schema-complete
            kept += 1
        else:
            kept += 1                                   # another labeller's entry: never overwrite
    # prove the write is add-only: every pre-existing entry (loaded file AND backup) survives unchanged, Lane A ids aside
    changed = [k for k, v in pre.items() if k not in fid_of and T['factoids'].get(k) != v]
    B = json.load(open(bak))['factoids']
    drift = [k for k, v in B.items() if k not in fid_of and T['factoids'].get(k) != v]
    if changed or drift:
        raise SystemExit(f'tags: {len(changed)} pre-existing entr(ies) would change vs the loaded file, {len(drift)} vs '
                         f'{os.path.relpath(bak, ROOT)} — refusing to write; e.g. {(changed or drift)[:10]}')
    tmp = TAGS + '.tmp'
    json.dump(T, open(tmp, 'w'))                       # same serialisation as assemble-competency-labels.py
    os.replace(tmp, TAGS)
    before = sha256_file(GEN_TAGS_OUT) if os.path.exists(GEN_TAGS_OUT) else None
    _, text = run(['node', GEN_TAGS_MJS], log_to=os.devnull)
    log(text.rstrip())
    after = sha256_file(GEN_TAGS_OUT)
    n_pre, n_bak = sum(1 for k in pre if k not in fid_of), sum(1 for k in B if k not in fid_of)
    log(f'tags: factoids section +{added} (kept {kept} existing) → {len(T["factoids"]):,} entries; bank section {len(T["bank"]):,} '
        f'(left as found); pre-existing entries unchanged: {n_pre:,} vs loaded file, {n_bak:,} vs backup; '
        f'curriculumTags.generated.json {"UNCHANGED" if before == after else "CHANGED"} '
        f'(expected unchanged: the new factoids have no illustration yet, so they are not pool cards)')
    mark(st, 'tags', added=added, kept=kept, factoids_entries=len(T['factoids']), bank_entries=len(T['bank']),
         unchanged_vs_loaded=n_pre, unchanged_vs_backup=n_bak, backup=os.path.relpath(bak, ROOT),
         generated_unchanged=(before == after))


# ---------------------------------------------------------------------------------------------- stage: vectors
def stage_vectors(st):
    n = sum(1 for l in open(BANK, encoding='utf-8') if l.strip())
    h = hashlib.md5(open(BANK, 'rb').read()).hexdigest()[:12]
    meta = json.load(open(VEC_META)) if os.path.exists(VEC_META) else {}
    if meta.get('count') == n and meta.get('bankHash') == h:
        log(f'vectors: blob already matches the bank (count {n:,}, hash {h}) — skip build')
    else:
        log(f'vectors: blob count {meta.get("count")} / hash {meta.get("bankHash")} vs bank {n:,} / {h} — rebuilding')
        logf = os.path.join(OUT, 'build-vectors.log')
        run([VENV_PY, os.path.join(ROOT, 'rag', 'scripts', 'build-vectors.py')], log_to=logf)
        log(''.join(open(logf).readlines()[-3:]).rstrip())
        meta = json.load(open(VEC_META))
        if meta.get('count') != n or meta.get('bankHash') != h:
            raise SystemExit(f'vectors: meta {meta} does not match bank count {n} hash {h}')
    _, text = run([sys.executable, os.path.join(ROOT, 'rag', 'scripts', 'export-facts-ts.py')], log_to=os.devnull)
    log(text.rstrip())
    with open(EXPORT_TS, encoding='utf-8') as f:
        hdr = [next(f) for _ in range(3)][2].strip()
    m = re.search(r'// (\d+) facts', hdr)
    if not m or int(m.group(1)) != n:
        raise SystemExit(f'vectors: export header {hdr!r} != bank {n}')
    log(f'vectors: blob count {meta["count"]:,} hash {meta["bankHash"]} == bank; export {m.group(1)} facts == bank')
    mark(st, 'vectors', count=n, bankHash=h, export=int(m.group(1)))


# ---------------------------------------------------------------------------------------------- stage: images
def load_batch_submit():
    if not os.environ.get('OPENAI_API_KEY'):
        raise SystemExit('OPENAI_API_KEY missing — set -a; . ./.env.local; set +a')
    spec = importlib.util.spec_from_file_location('batch_submit_all', BATCH_SUBMIT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stage_images(st, chunk=120):
    lane = {r['id']: s for s, r in lane_rows()}
    new_rows = [r for r in read_jsonl(FACTOIDS) if r['factId'] in lane]
    if len(new_rows) != len(lane):
        raise SystemExit(f'images: {len(new_rows)}/{len(lane)} Lane A factoids minted — run assemble first')
    work = {s: [] for s, _ in STREAMS}
    for r in new_rows:
        p = (r['image'] or {}).get('prompt')
        if not p:
            raise SystemExit(f'images: {r["id"]} has no image prompt')
        work[lane[r['factId']]].append({'id': r['id'], 'factId': r['factId'], 'prompt': p})
    for s, rows in work.items():
        write_jsonl(os.path.join(OUT, f'image-worklist.{s}.jsonl'), rows)     # AUP prompts stay on disk only
    rec = json.load(open(BATCHES_OUT)) if os.path.exists(BATCHES_OUT) else {'batches': []}
    submitted = {i for b in rec['batches'] for i in b['ids']}
    mod = load_batch_submit()
    api = mod.API
    total_new = 0
    for stream, rows in work.items():
        todo = [r for r in rows if r['id'] not in submitted]
        if not todo:
            log(f'images [{stream}]: all {len(rows)} ids already submitted — skip')
            continue
        n_chunks = max(1, math.ceil(len(todo) / chunk))
        size = math.ceil(len(todo) / n_chunks)
        for k in range(n_chunks):
            take = todo[k * size:(k + 1) * size]
            idx = len(rec['batches']) + 1
            req = os.path.join(OUT, f'image-req-{idx:02d}.{stream}.jsonl')
            with open(req, 'w', encoding='utf-8') as f:
                for r in take:                          # batch-submit-all.py write_req(), verbatim body
                    f.write(json.dumps({'custom_id': r['id'], 'method': 'POST', 'url': '/v1/images/generations',
                                        'body': {'model': mod.MODEL, 'prompt': mod.strip_style(r['prompt']) + mod.STYLE,
                                                 'size': mod.SIZE, 'quality': mod.QUALITY, 'n': 1, 'background': 'opaque',
                                                 'output_format': 'png'}}, ensure_ascii=False) + '\n')
            b = '----hiraiabatch'
            content = open(req, 'rb').read()
            body = (f'--{b}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n'
                    f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(req)}"\r\n'
                    f'Content-Type: application/json\r\n\r\n').encode() + content + f'\r\n--{b}--\r\n'.encode()
            fid = mod._req(f'{api}/files', data=body, method='POST',
                           headers={'Content-Type': f'multipart/form-data; boundary={b}'})['id']
            created = mod._req(f'{api}/batches', data=json.dumps({
                'input_file_id': fid, 'endpoint': '/v1/images/generations', 'completion_window': '24h',
                'metadata': {'project': 'hiraia', 'lane': 'lane-a', 'stream': stream, 'chunk': str(idx)}}).encode(),
                method='POST', headers={'Content-Type': 'application/json'})
            entry = {'batch_id': created['id'], 'input_file_id': fid, 'stream': stream, 'chunk': idx, 'n': len(take),
                     'ids': [r['id'] for r in take], 'request_file': os.path.relpath(req, ROOT),
                     'submitted_at': now(), 'submitted_at_utc': datetime.datetime.fromtimestamp(created.get('created_at', time.time()), datetime.timezone.utc).isoformat(),
                     'status_at_submit': created.get('status'), 'model': mod.MODEL, 'quality': mod.QUALITY, 'size': mod.SIZE,
                     'est_usd': round(len(take) * IMAGE_USD, 4)}
            rec['batches'].append(entry)
            submitted |= set(entry['ids'])
            total_new += len(take)
            rec['scheme'] = ('Lane A illustration batches (gpt-image-2 low, batch-submit-all.py request body, CHUNK≈120 so each '
                             'output file is API-downloadable). SUBMIT ONLY — nothing waited for or downloaded. Download: '
                             'GET /v1/batches/<batch_id> → output_file_id, then curl /v1/files/<output_file_id>/content → '
                             'rag/pipeline/imagegen/<batch_id>.jsonl, python3 rag/pipeline/imagegen/extract.py <that file>, '
                             'to-webp.py → factoid-webp/<ffct id>.webp, then packages/images/to-card-png.mjs and gen-cards-pool.py. '
                             'Declined (moderation) ids → the qwen-image fallback per the spec.')
            rec['summary'] = {'batches': len(rec['batches']), 'images': sum(x['n'] for x in rec['batches']),
                              'est_usd': round(sum(x['n'] for x in rec['batches']) * IMAGE_USD, 4)}
            json.dump(rec, open(BATCHES_OUT + '.tmp', 'w'), indent=1)
            os.replace(BATCHES_OUT + '.tmp', BATCHES_OUT)
            log(f'images [{stream}] batch {idx}: {len(take)} requests → {created["id"]} ({created.get("status")}) input {fid}')
    log(f'images: submitted {total_new} new requests this run; ledger {rec["summary"]} → {os.path.relpath(BATCHES_OUT, ROOT)}')
    mark(st, 'images', submitted_this_run=total_new, **rec['summary'])


# ---------------------------------------------------------------------------------------------- stage: fetch
def download_file(mod, api, file_id, tries=4):
    """GET /v1/files/<id>/content as bytes (batch-submit-all.py's _req is JSON-only). Output files are ≈120 × 1.7 MB."""
    for a in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(f'{api}/files/{file_id}/content',
                                                               headers={'Authorization': f'Bearer {os.environ["OPENAI_API_KEY"]}'}), timeout=900) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if a == tries - 1:
                raise
            log(f'fetch: {file_id} {type(e).__name__} — retry {a + 1}')
            time.sleep(min(60, 2 ** (a + 1)))


def stage_fetch(st):
    """Book every batch's status + request_counts at fetch time (the submit-time status is 'validating' forever); for
    each COMPLETED batch not yet downloaded: the error file → failed custom_ids (ids + error code only, never a prompt)
    → out/image-declined.jsonl + the qwen-image fallback worklist; the output file → imagegen/<batch>.jsonl → extract.py
    → to-webp.py --only → imagegen/webp/<id>.webp (staging). Idempotent: a batch is downloaded once."""
    if not os.path.exists(BATCHES_OUT):
        raise SystemExit('fetch: no image-batches.json — run the images stage first')
    mod = load_batch_submit()
    api = mod.API
    rec = json.load(open(BATCHES_OUT))
    declined = {r['id']: r for r in read_jsonl(DECLINED_OUT)}
    prompts = {r['id']: r for s, _ in STREAMS for r in read_jsonl(os.path.join(OUT, f'image-worklist.{s}.jsonl'))}
    n_completed = n_new = 0
    for b in rec['batches']:
        j = mod._req(f'{api}/batches/{b["batch_id"]}')
        b.update(status=j.get('status'), request_counts=j.get('request_counts'), output_file_id=j.get('output_file_id'),
                 error_file_id=j.get('error_file_id'), fetched_at=now())
        log(f'fetch [{b["stream"]}] chunk {b["chunk"]} {b["batch_id"]}: {b["status"]} {b["request_counts"]}')
        if b['status'] != 'completed':
            continue
        n_completed += 1
        if b.get('downloaded_at'):
            continue
        failed = []                                      # 1) failures first: ids + error code only
        if b.get('error_file_id'):
            for l in download_file(mod, api, b['error_file_id']).decode('utf-8').splitlines():
                if l.strip():
                    o = json.loads(l)
                    err = ((o.get('response') or {}).get('body') or {}).get('error') or o.get('error') or {}
                    failed.append({'id': o['custom_id'], 'code': err.get('code') or err.get('type') or 'error',
                                   'batch_id': b['batch_id'], 'stream': b['stream'], 'fetched_at': now()})
        for r in failed:
            declined.setdefault(r['id'], r)
        b['declined'] = [r['id'] for r in failed]
        raw = os.path.join(IMAGEGEN, f'{b["batch_id"]}.jsonl')     # 2) the output file → PNGs → WebP, this batch's ids only
        if not os.path.exists(raw) and b.get('output_file_id'):
            data = download_file(mod, api, b['output_file_id'])
            with open(raw + '.tmp', 'wb') as f:
                f.write(data)
            os.replace(raw + '.tmp', raw)
        if os.path.exists(raw):
            _, text = run([sys.executable, os.path.join(IMAGEGEN, 'extract.py'), raw], log_to=os.devnull)
            log(text.rstrip())
        only = os.path.join(OUT, f'image-ids-{b["chunk"]:02d}.txt')
        with open(only, 'w') as f:
            f.write('\n'.join(b['ids']) + '\n')
        _, text = run([sys.executable, os.path.join(IMAGEGEN, 'to-webp.py'), '--only', only], log_to=os.devnull)
        log(text.rstrip())
        got = [i for i in b['ids'] if os.path.exists(os.path.join(IMAGEGEN, 'webp', f'{i}.webp'))]
        missing = [i for i in b['ids'] if i not in got and i not in b['declined']]
        if missing:
            raise SystemExit(f'fetch: chunk {b["chunk"]}: {len(missing)} id(s) neither delivered nor in the error file: {missing[:10]}')
        b.update(downloaded_at=now(), webp=len(got))
        n_new += len(got)
        log(f'fetch [{b["stream"]}] chunk {b["chunk"]}: {len(got)} webp staged in rag/pipeline/imagegen/webp, {len(b["declined"])} declined')
        write_jsonl(DECLINED_OUT, list(declined.values()))
        write_jsonl(FALLBACK_OUT, [prompts[i] for i in declined if i in prompts])   # gen-images.py worklist schema; AUP prompts stay on disk
        rec['summary'].update(completed_batches=n_completed, declined=len(declined), webp_staged=sum(x.get('webp', 0) for x in rec['batches']),
                              fetched_at=now())
        json.dump(rec, open(BATCHES_OUT + '.tmp', 'w'), indent=1)
        os.replace(BATCHES_OUT + '.tmp', BATCHES_OUT)
    rec['summary'].update(completed_batches=n_completed, declined=len(declined), webp_staged=sum(x.get('webp', 0) for x in rec['batches']),
                          fetched_at=now())
    rec['scheme'] = (rec.get('scheme', '').split(' Download:')[0] + ' The fetch stage of append-lane-a.py books status/request_counts '
                     'at fetch time, downloads completed batches (declined ids → out/image-declined.jsonl + out/image-fallback-worklist.jsonl '
                     'for the qwen-image fallback: WORKLIST=<that file> LIMIT=0 python3 packages/images/qwen-queue/gen-images.py) and stages '
                     'WebPs in rag/pipeline/imagegen/webp/. Wiring: copy to packages/images/factoid-webp/, to-card-png.mjs, gen-image-map.mjs, '
                     'gen-cards-pool.py, gen-curriculum-tags.mjs, gen-cards-questions.py.')
    json.dump(rec, open(BATCHES_OUT + '.tmp', 'w'), indent=1)
    os.replace(BATCHES_OUT + '.tmp', BATCHES_OUT)
    by_status = {}
    for b in rec['batches']:
        by_status[b['status']] = by_status.get(b['status'], 0) + 1
    counts = {k: sum((b.get('request_counts') or {}).get(k, 0) for b in rec['batches']) for k in ('total', 'completed', 'failed')}
    log(f'fetch: batches {by_status}; request_counts {counts}; webp staged this run {n_new} (total {rec["summary"]["webp_staged"]}); '
        f'declined {len(declined)} → {os.path.relpath(DECLINED_OUT, ROOT)} + fallback worklist {os.path.relpath(FALLBACK_OUT, ROOT)}')
    mark(st, 'fetch', by_status=by_status, request_counts=counts, webp_staged_this_run=n_new, webp_staged=rec['summary']['webp_staged'],
         declined=len(declined), declined_ids=sorted(declined))


# ---------------------------------------------------------------------------------------------- stage: gate
def stage_gate(st):
    logf = os.path.join(OUT, 'gate.log')
    if os.path.exists(logf):
        os.remove(logf)
    rc, text = run(['bash', GATE], log_to=logf, check=False)
    verdict = [l for l in text.splitlines() if 'GATE GREEN' in l or 'GATE RED' in l]
    log(f'gate: rc {rc}; verdict: {verdict[-1] if verdict else "(none printed)"}; log {os.path.relpath(logf, ROOT)}')
    mark(st, 'gate', rc=rc, verdict=verdict[-1] if verdict else None)
    return rc


def status(st):
    log(json.dumps(st, indent=1))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--stages', default=','.join(STAGES), help=f'comma list, pipeline order enforced; default all: {",".join(STAGES)}')
    ap.add_argument('--chunk', type=int, default=int(os.environ.get('CHUNK', '120')), help='image requests per batch (≈120 → API-downloadable output)')
    ap.add_argument('--status', action='store_true')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))   # a kill reaches run()'s handler, so a dying Fireworks run is still booked
    st = load_state()
    if a.status:
        return status(st)
    want = [s for s in STAGES if s in {x.strip() for x in a.stages.split(',')}]
    unknown = {x.strip() for x in a.stages.split(',')} - set(STAGES)
    if unknown:
        raise SystemExit(f'unknown stage(s) {sorted(unknown)}; known: {STAGES}')
    rc = 0
    for s in want:
        log(f'\n===== stage {s} ({now()}) =====')
        r = globals()[f'stage_{s}'](st, a.chunk) if s == 'images' else globals()[f'stage_{s}'](st)
        if s == 'gate':
            rc = r
    return rc


if __name__ == '__main__':
    sys.exit(main())

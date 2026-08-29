#!/usr/bin/env python3
"""Lane A ingest — the consumer of an outside model's fact candidates (LANE-A-BRIEF.md §4).

Reads  out/lane-a-candidates.jsonl  (+ out/lane-a-G5-L-3.jsonl, the AUP stream: counts only, text never printed)
and runs six resumable stages, every artefact under --out (default: rag/pipeline/lane-a/out/):

  1 validate   schema, brief_code ∈ briefs, domain = cell domain, confidence ≥ 2, en 15–35 words (--en-words), ≥6 distinct terms
               → 1-validate.<stream>.jsonl, rejects.jsonl
  2 dedup      LaBSE raw-CLS L2 cosine (0.86) vs EVERYTHING existing — bank + factoids.jsonl + DepEd dcards (cardsPool.merged.json)
               + the briefs' feed cards — then greedy within batch (0.90)  → 2-dedup.*, dedup-drops.jsonl
  3 mint       <slug-of-topic>-g<grade>, unique vs bank + batch (uniq() from rag/scripts/deepen-process.py)  → 3-mint.*, id-map.json
  4 verify     Fireworks gpt-oss-120b (decorrelated from the writer), keep 'ok' only  → verify-verdicts/<stream>/ (cache), 4-verify.*, verify-drops.jsonl
  5 translate  en → tl + bis AND tl/bis/en query terms (gpt-oss-120b); terms must hit both sentences  → translations.<stream>.json (cache),
               5-translate.*, translate-pending.jsonl
  6 emit       bank-schema rows → lane-a-ingest-ready.jsonl (+ .G5-L-3 twin) and the curriculum-tags v2 fragment lane-a-tags.json
               ({scheme, bank: {<bank fact id>: {competency, grade, quarter, domain, codes, cells, score, confidence}}})

It STOPS there: it never appends to science-facts.jsonl / factoids.jsonl (separate, append-only-gated step).

Caches are keyed by id AND a sha of the candidate text (topic + en) AND the model that produced the entry: a re-delivered
candidate with an edited `en` under the same tmp_id is re-minted and re-verified/re-translated, and a --verify-model switch
invalidates every verdict — a stale verdict or translation is never reused. The AUP stream's caches are twin files
(verify-verdicts/G5-L-3/, translations.G5-L-3.json) and its rows never share a Fireworks batch or a cache file with main rows;
the shared drop/pending files carry AUP rows by id only. emit refuses unless every row is verdict 'ok' with non-empty tl/bis
and trilingual terms; --dry-run rows are stamped UNVERIFIED and a later non-dry-run translate/emit refuses them.

  set -a; . ./.env.local; set +a                       # FIREWORKS_API_KEY (not needed with --dry-run)
  PY=finetuning/.convert-venv/bin/python               # torch + transformers (LaBSE, mps)
  $PY rag/pipeline/lane-a/ingest-lane-a.py --dry-run               # stages 1-3 + 6, no Fireworks
  $PY rag/pipeline/lane-a/ingest-lane-a.py --writer grok --limit 40 # full path, Fireworks capped to 40 rows/stage
  FW_LIMIT=40 $PY rag/pipeline/lane-a/ingest-lane-a.py --stages verify,translate,emit
  LANE_A_VERIFY_MODEL=accounts/fireworks/models/... — the verify model (NOT FW_MODEL, which other scripts set to the writer)

Resume: stages 1–3 are deterministic and cheap (existing-set embeddings cached by file sha1 under lane-a/.cache/), so they
recompute every run; 4–5 only call Fireworks for ids whose cache entry is missing or stale (--reverify / --retranslate override).
"""
import argparse, collections, datetime, glob, hashlib, json, os, re, sys, threading, time, unicodedata
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BANK = os.path.join(ROOT, 'rag', 'bank', 'science-facts.jsonl')
FACTOIDS = os.path.join(ROOT, 'rag', 'bank', 'factoids.jsonl')
CARDS_POOL = os.path.join(ROOT, 'rag', 'pipeline', 'cardsPool.merged.json')     # card-ui pool: the 12.7k DepEd dcards (untracked, optional)
BRIEFS = os.path.join(HERE, 'briefs.json')
CG_DIR = os.path.join(ROOT, 'rag', 'sources', 'curriculum-guides')
CACHE = os.path.join(HERE, '.cache')
FW_URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
GPT_OSS = 'accounts/fireworks/models/gpt-oss-120b'
STAGES = ['validate', 'dedup', 'mint', 'verify', 'translate', 'emit']
STREAMS = [('main', 'lane-a-candidates.jsonl'), ('G5-L-3', 'lane-a-G5-L-3.jsonl')]
AUP_STREAMS = {'G5-L-3'}          # text of these rows is never printed; only ids/counts
DOMAINS = ('MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE')
EN_WORDS = (15, 35)                 # LANE-A-BRIEF §3: one idea, one sentence, 15–35 words (--en-words overrides)
MIN_TERMS = 6                       # LANE-A-BRIEF §3: ≥6 distinct search terms (--min-terms overrides)
CARD_FORMS = {'fact': 'fact', 'method': 'method', 'did-you-know about a method': 'method', 'activity prompt': 'method'}
# English-only content-word fallback for terms (assemble-newfacts.py terms())
STOP = {'that', 'this', 'with', 'from', 'they', 'their', 'them', 'when', 'what', 'which', 'because', 'about', 'into',
        'than', 'more', 'most', 'some', 'other', 'these', 'such', 'have', 'also', 'even', 'very', 'only', 'same',
        'there', 'where', 'while', 'been', 'were', 'does', 'each', 'both', 'much', 'many', 'like', 'just', 'still'}


def log(msg=''):
    print(msg, flush=True)


def desc(r):
    """One-line description for stdout. AUP-stream rows are described by id only."""
    ident = r.get('id') or r.get('tmp_id')
    if (r.get('_stream') or r.get('stream')) in AUP_STREAMS:
        return f"{ident} [{r.get('brief_code')}] (text withheld: AUP stream)"
    return f"{ident} [{r.get('brief_code')}] {r.get('en', '')[:100]}"


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]


def write_jsonl(path, rows):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    os.replace(tmp, path)


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def sha1_file(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ───────────────────────────── reference data ─────────────────────────────

def load_competencies():
    """code → {grade, quarter, domain, text} from the MATATAG extractions (elementary + JHS)."""
    comp = {}
    for fn in ('matatag-elementary-competencies.json', 'matatag-jhs-competencies.json'):
        p = os.path.join(CG_DIR, fn)
        if not os.path.exists(p):
            continue
        for q in json.load(open(p))['quarters']:
            for c in q['competencies']:
                comp[c['code']] = dict(grade=q['grade'], quarter=q['quarter'], domain=q['domain'], text=c['text'])
    return comp


def load_briefs(comp):
    """code → brief, each brief carrying its authoritative cell (CG JSON first, brief fields as fallback)."""
    briefs = {}
    for b in json.load(open(BRIEFS))['briefs']:
        cell = comp.get(b['code'])
        if cell is None:
            log(f"  WARN {b['code']} not in curriculum-guides JSON; using the brief's own grade/quarter/domain")
            cell = dict(grade=b['grade'], quarter=b['quarter'], domain=b['domain'], text=b['competency'])
        elif (cell['grade'], cell['quarter'], cell['domain']) != (b['grade'], b['quarter'], b['domain']):
            log(f"  WARN {b['code']} cell differs between briefs.json and the CG JSON; CG JSON wins")
        briefs[b['code']] = dict(b, cell=cell)
    return briefs


def load_bank():
    rows = read_jsonl(BANK)
    return rows


# ───────────────────────────── stage 1: validate ─────────────────────────────

def norm_text(s):
    return re.sub(r'\s+', ' ', str(s)).strip().strip('"“”').strip()


def validate_row(raw, briefs, stream, lineno, seen_tmp, seen_en, bank_en, en_words=EN_WORDS, min_terms=MIN_TERMS):
    reasons = []
    tmp_id = norm_text(raw.get('tmp_id') or '') or f'lane-a-{stream}-L{lineno}'
    if tmp_id in seen_tmp:
        reasons.append('tmp_id-duplicate')
    code = norm_text(raw.get('brief_code') or '').upper()
    brief = briefs.get(code)
    if brief is None:
        reasons.append('brief_code-unknown' if code else 'brief_code-missing')
    domain = norm_text(raw.get('domain') or '').upper().replace(' ', '_')
    if domain not in DOMAINS:
        reasons.append('domain-invalid')
    elif brief and domain != brief['cell']['domain']:
        reasons.append(f"domain-mismatch(cell={brief['cell']['domain']})")
    try:
        conf = int(float(raw.get('confidence')))
    except (TypeError, ValueError):
        conf = None
    if conf is None:
        reasons.append('confidence-missing')
    elif conf < 2:
        reasons.append('confidence<2')
    en = norm_text(raw.get('en') or '')
    nw = len(en.split())
    if not en:
        reasons.append('en-missing')
    elif not (en_words[0] <= nw <= en_words[1]):
        reasons.append(f'en-words={nw}')
    else:
        key = re.sub(r'[^a-z0-9 ]', '', en.lower())
        if key in bank_en:
            reasons.append('en-exact-in-bank')
        elif key in seen_en:
            reasons.append('en-exact-dup-in-batch')
    topic = norm_text(raw.get('topic') or '')
    if not topic:
        reasons.append('topic-missing')
    elif len(topic.split()) > 15:
        reasons.append('topic>15-words')
    grades = []
    for g in (raw.get('grades') or []):
        try:
            g = int(g)
        except (TypeError, ValueError):
            continue
        if 1 <= g <= 10:
            grades.append(g)
    if brief and brief['cell']['grade'] not in grades:
        grades.append(brief['cell']['grade'])      # the competency's grade is always carried
    grades = sorted(set(grades))
    terms = merge_terms([t for t in (raw.get('terms') or []) if isinstance(t, str)])      # distinct, ≤4 words each
    if len(terms) < min_terms:
        reasons.append(f'terms<{min_terms}')
    cf = CARD_FORMS.get(norm_text(raw.get('card_form') or '').lower())
    if cf is None and brief:
        cf = CARD_FORMS.get(brief.get('card_form', 'fact'), 'fact')
    if reasons:
        return None, reasons, tmp_id
    seen_tmp.add(tmp_id)
    seen_en.add(re.sub(r'[^a-z0-9 ]', '', en.lower()))
    return dict(tmp_id=tmp_id, brief_code=code, domain=domain, topic=topic, grades=grades, en=en, terms=terms,
                source=norm_text(raw.get('source') or ''), card_form=cf or 'fact', confidence=conf,
                _stream=stream, _line=lineno), [], tmp_id


def stage_validate(args, briefs, bank):
    bank_en = {re.sub(r'[^a-z0-9 ]', '', norm_text(b['fact']['en']).lower()) for b in bank}
    seen_tmp, seen_en, rejects, out = set(), set(), [], {}
    for stream, fn in STREAMS:
        path = os.path.join(args.out, fn)
        rows, n_in = [], 0
        if not os.path.exists(path):
            log(f'[validate] {stream}: {fn} absent — skipping stream')
            out[stream] = rows
            continue
        with open(path, encoding='utf-8') as f:
            for lineno, line in enumerate(f, 1):
                if not line.strip():
                    continue
                n_in += 1
                try:
                    raw = json.loads(line)
                    if not isinstance(raw, dict):
                        raise ValueError('not an object')
                except ValueError as e:
                    rejects.append(dict(stage='validate', stream=stream, tmp_id=f'lane-a-{stream}-L{lineno}', line=lineno,
                                        reasons=[f'json:{type(e).__name__}']))
                    continue
                row, reasons, tmp_id = validate_row(raw, briefs, stream, lineno, seen_tmp, seen_en, bank_en, args.en_words, args.min_terms)
                if row is None:
                    rej = dict(stage='validate', stream=stream, tmp_id=tmp_id, brief_code=raw.get('brief_code'),
                               line=lineno, reasons=reasons)
                    if stream not in AUP_STREAMS:
                        rej['en'] = norm_text(raw.get('en') or '')[:200]
                    rejects.append(rej)
                else:
                    rows.append(row)
        write_jsonl(os.path.join(args.out, f'1-validate.{stream}.jsonl'), rows)
        out[stream] = rows
        log(f'[validate] {stream}: {n_in} in → {len(rows)} valid, {n_in - len(rows)} rejected')
    write_jsonl(os.path.join(args.out, 'rejects.jsonl'), rejects)
    reason_counts = collections.Counter(r for x in rejects for r in x['reasons'])
    if reason_counts:
        log('[validate] reject reasons: ' + ', '.join(f'{k}={v}' for k, v in reason_counts.most_common()))
    return out


# ───────────────────────────── stage 2: dedup (LaBSE) ─────────────────────────────

class Labse:
    """Raw CLS, L2-normalised — the recipe from rag/pipeline/fw-dedup-facts.py."""

    def __init__(self):
        import torch
        from transformers import AutoTokenizer, AutoModel
        self.torch = torch
        self.dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
        self.tok = AutoTokenizer.from_pretrained('sentence-transformers/LaBSE')
        self.model = AutoModel.from_pretrained('sentence-transformers/LaBSE').to(self.dev).eval()

    def encode(self, texts, bs=192, progress=False):
        import numpy as np, torch.nn.functional as F
        out = []
        for i in range(0, len(texts), bs):
            enc = self.tok(texts[i:i + bs], return_tensors='pt', padding=True, truncation=True, max_length=96).to(self.dev)
            with self.torch.no_grad():
                cls = self.model(**enc).last_hidden_state[:, 0]
            out.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
            if progress and (i // bs) % 40 == 0:
                log(f'    embed {min(i + bs, len(texts))}/{len(texts)}')
        return np.vstack(out).astype(np.float32) if out else np.zeros((0, 768), dtype=np.float32)


def cached_embeddings(labse, tag, path, texts):
    """LaBSE matrix for `texts` (all drawn from `path`), cached as .cache/<tag>-labse-<sha1(path)[:12]>.npy."""
    import numpy as np
    os.makedirs(CACHE, exist_ok=True)
    cpath = os.path.join(CACHE, f'{tag}-labse-{sha1_file(path)[:12]}.npy')
    if os.path.exists(cpath):
        EX = np.load(cpath)
        if EX.shape[0] == len(texts):
            log(f'[dedup] {tag} embeddings from cache ({EX.shape[0]} × {EX.shape[1]}, {os.path.basename(cpath)})')
            return EX
    log(f'[dedup] embedding {tag} ({len(texts)} texts) — cached afterwards under {CACHE}')
    EX = labse.encode(texts, progress=True)
    np.save(cpath, EX)
    for old in glob.glob(os.path.join(CACHE, f'{tag}-labse-*.npy')):
        if old != cpath:
            os.remove(old)
    return EX


def existing_texts(bank):
    """[(tag, file, [(label, text)])] — everything a candidate must not restate (FACT-SWARM-SPEC dedup: bank + dcard text,
    plus every factoid, tagged or not): the bank, rag/bank/factoids.jsonl and the DepEd dcards of cardsPool.merged.json."""
    groups = [('bank', BANK, [(b['id'], f"{b.get('topic', '')}. {b['fact']['en']}") for b in bank])]
    if os.path.exists(FACTOIDS):
        fo = [(f"ffct:{r['id']}", f"{r.get('topic', '')}. {((r.get('q') or {}).get('en') or '')} {(r.get('text') or {}).get('en') or ''}")
              for r in read_jsonl(FACTOIDS) if ((r.get('text') or {}).get('en') or '').strip()]
        groups.append(('factoids', FACTOIDS, fo))
    else:
        log(f'[dedup] WARN {os.path.relpath(FACTOIDS, ROOT)} absent — factoids not in the existing set')
    if os.path.exists(CARDS_POOL):
        dc = [(f"dcard:{c['id']}", f"{c.get('topic', '')}. {c['fact']['en']}") for c in json.load(open(CARDS_POOL)).get('cards', [])
              if str(c.get('id', '')).startswith('dcard') and (c.get('fact') or {}).get('en')]
        groups.append(('dcards', CARDS_POOL, dc))
    else:
        log(f'[dedup] WARN {os.path.relpath(CARDS_POOL, ROOT)} absent — DepEd dcards not in the existing set')
    return groups


def stage_dedup(args, briefs, bank, rows_by_stream):
    import numpy as np
    cands = []
    for stream, _ in STREAMS:                       # main first, then AUP; higher confidence survives a near-dup
        rs = rows_by_stream.get(stream, [])
        cands += sorted(rs, key=lambda r: (-r['confidence'], r['_line']))
    if not cands:
        log('[dedup] nothing to dedup')
        for stream, _ in STREAMS:
            write_jsonl(os.path.join(args.out, f'2-dedup.{stream}.jsonl'), [])
        write_jsonl(os.path.join(args.out, 'dedup-drops.jsonl'), [])
        return {s: [] for s, _ in STREAMS}
    labse = Labse()
    parts, ex_labels, sizes = [], [], []
    for tag, path, items in existing_texts(bank):
        parts.append(cached_embeddings(labse, tag, path, [t for _, t in items])); ex_labels += [l for l, _ in items]; sizes.append(f'{tag} {len(items)}')
    feed = [(f"feed:{code}#{i}", t) for code, b in briefs.items() for i, t in enumerate(b.get('existing_facts_en') or [])]
    if feed:                                         # the briefs' feed cards are "existing" too (brief §1: do not restate)
        parts.append(labse.encode([t for _, t in feed])); ex_labels += [l for l, _ in feed]; sizes.append(f'briefs-feed {len(feed)}')
    EX = np.vstack(parts)
    log(f'[dedup] existing set: {len(ex_labels)} texts ({", ".join(sizes)})')
    CA = labse.encode([f"{c['topic']}. {c['en']}" for c in cands])
    maxcos = np.zeros(len(cands), dtype=np.float32); argmax = np.zeros(len(cands), dtype=np.int64)
    for i in range(0, len(CA), 400):
        sims = CA[i:i + 400] @ EX.T
        maxcos[i:i + 400] = sims.max(axis=1); argmax[i:i + 400] = sims.argmax(axis=1)
    drops, kept, kv, k = [], [], np.empty((len(cands), CA.shape[1]), dtype=np.float32), 0
    kept_ids = []
    for i, c in enumerate(cands):
        c['dedup_nearest'] = ex_labels[int(argmax[i])]; c['dedup_cos_bank'] = round(float(maxcos[i]), 4)
        d = dict(stage='dedup', stream=c['_stream'], tmp_id=c['tmp_id'], brief_code=c['brief_code'])
        if c['_stream'] not in AUP_STREAMS:
            d['en'] = c['en']
        if maxcos[i] >= args.t_exist:
            d.update(reason='near-existing', match=c['dedup_nearest'], cos=c['dedup_cos_bank']); drops.append(d); continue
        if k:
            sims = kv[:k] @ CA[i]; j = int(sims.argmax())
            if float(sims[j]) >= args.t_cand:
                d.update(reason='near-candidate', match=kept_ids[j], cos=round(float(sims[j]), 4)); drops.append(d); continue
        kv[k] = CA[i]; k += 1; kept.append(c); kept_ids.append(c['tmp_id'])
    out = {}
    for stream, _ in STREAMS:
        rs = sorted([c for c in kept if c['_stream'] == stream], key=lambda r: r['_line'])
        out[stream] = rs
        write_jsonl(os.path.join(args.out, f'2-dedup.{stream}.jsonl'), rs)
        n_in = len(rows_by_stream.get(stream, []))
        nb = sum(1 for d in drops if d['stream'] == stream and d['reason'] == 'near-existing')
        nc = sum(1 for d in drops if d['stream'] == stream and d['reason'] == 'near-candidate')
        log(f'[dedup] {stream}: {n_in} → {len(rs)} novel ({nb} near-existing ≥{args.t_exist}, {nc} near-candidate ≥{args.t_cand})')
    write_jsonl(os.path.join(args.out, 'dedup-drops.jsonl'), drops)
    if args.verbose:
        for d in drops:
            log(f"    drop cos={d['cos']} ~ {d['match']}: {desc(d)}")
    return out


# ───────────────────────────── stage 3: mint ids ─────────────────────────────

SLUG_TAIL_STOP = {'of', 'in', 'on', 'the', 'a', 'an', 'to', 'for', 'and', 'or', 'with', 'by', 'at', 'from', 'is', 'are', 'vs', 'as'}


def slugify(text, max_tokens=6, max_len=48):
    t = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    toks = [x for x in re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-').split('-') if x][:max_tokens]
    s = '-'.join(toks)
    while len(s) > max_len and len(toks) > 1:
        toks.pop(); s = '-'.join(toks)
    while len(toks) > 1 and toks[-1] in SLUG_TAIL_STOP:      # never end a slug on 'of'/'in'/…
        toks.pop(); s = '-'.join(toks)
    return s[:max_len].strip('-')


def content_sha(r):
    """What verify/translate actually see. Every cache entry carries it: an edited `en` (or topic) re-delivered under the
    same tmp_id must never be served the old verdict or the old tl/bis."""
    return hashlib.sha1(f"{r['topic']}\n{r['en']}".encode('utf-8')).hexdigest()[:16]


def stage_mint(args, briefs, bank, rows_by_stream):
    map_path = os.path.join(args.out, 'id-map.json')
    idmap = json.load(open(map_path)) if os.path.exists(map_path) else {}          # {tmp_id: {id, sha}}
    idmap = {k: (v if isinstance(v, dict) else dict(id=v, sha=None)) for k, v in idmap.items()}   # pre-sha maps: sha unknown
    n_changed = 0
    for r in [r for s, _ in STREAMS for r in rows_by_stream.get(s, [])]:
        r['sha'] = content_sha(r)
        old = idmap.get(r['tmp_id'])
        if old and old.get('sha') != r['sha']:
            why = 'candidate text changed since it was minted' if old.get('sha') else 'pre-sha id-map entry'
            log(f"  WARN {r['tmp_id']}: {why} — re-minting {old['id']}; its cached verdict/translation are void")
            del idmap[r['tmp_id']]; n_changed += 1
    taken = {b['id'] for b in bank} | {v['id'] for v in idmap.values()}
    seen = set()                                    # uniq() semantics from rag/scripts/deepen-process.py
    n_new = n_reused = n_suffixed = 0
    for stream, _ in STREAMS:
        for r in rows_by_stream.get(stream, []):
            if r['tmp_id'] in idmap:
                r['id'] = idmap[r['tmp_id']]['id']; seen.add(r['id']); n_reused += 1; continue
            grade = briefs[r['brief_code']]['cell']['grade']
            base = slugify(r['topic']) or slugify(' '.join(r['en'].split()[:5])) or 'fact'
            idv = f'{base}-g{grade}'
            b, n = idv, 2
            while idv in taken or idv in seen:
                idv = f'{b}-{n}'; n += 1
            if idv != b:
                n_suffixed += 1
            seen.add(idv); taken.add(idv); idmap[r['tmp_id']] = dict(id=idv, sha=r['sha']); r['id'] = idv; n_new += 1
        write_jsonl(os.path.join(args.out, f'3-mint.{stream}.jsonl'), rows_by_stream.get(stream, []))
    write_json(map_path, dict(sorted(idmap.items())))
    log(f'[mint] ids: {n_new} minted ({n_changed} re-minted after a text change), {n_reused} reused from id-map.json, '
        f'{n_suffixed} collision-suffixed; map has {len(idmap)} entries')
    return rows_by_stream


# ───────────────────────────── Fireworks (verify / translate) ─────────────────────────────

class Fireworks:
    """Chat call with the backoff pattern from rag/pipeline/fw-verify-facts.py + a per-run token ledger."""

    def __init__(self, price_in, price_out):
        self.key = os.environ.get('FIREWORKS_API_KEY')
        if not self.key:
            sys.exit('FIREWORKS_API_KEY missing — run `set -a; . ./.env.local; set +a` (or use --dry-run)')
        self.lock = threading.Lock(); self.tokens = collections.Counter(); self.calls = collections.Counter()
        self.price_in, self.price_out = price_in, price_out

    def call(self, model, prompt, max_tokens, temperature, reasoning_effort=None, stage='fw', attempt=0):
        body = {'model': model, 'temperature': temperature, 'max_tokens': max_tokens,
                'messages': [{'role': 'user', 'content': prompt}]}
        if reasoning_effort and 'gpt-oss' in model:
            body['reasoning_effort'] = reasoning_effort
        req = urllib.request.Request(FW_URL, data=json.dumps(body).encode(),
                                     headers={'Authorization': f'Bearer {self.key}', 'Content-Type': 'application/json'})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=240))
            m = r['choices'][0]['message']; u = r.get('usage', {})
            with self.lock:
                self.tokens[f'{stage}:in'] += u.get('prompt_tokens', 0); self.tokens[f'{stage}:out'] += u.get('completion_tokens', 0)
                self.calls[stage] += 1
            return (m.get('content') or ''), (m.get('reasoning_content') or '')
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529) and attempt < 5:
                ra = e.headers.get('Retry-After'); time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
                return self.call(model, prompt, max_tokens, temperature, reasoning_effort, stage, attempt + 1)
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5:
                time.sleep(min(90, 2 ** (attempt + 1)))
                return self.call(model, prompt, max_tokens, temperature, reasoning_effort, stage, attempt + 1)
            raise

    def cost(self):
        i = sum(v for k, v in self.tokens.items() if k.endswith(':in')); o = sum(v for k, v in self.tokens.items() if k.endswith(':out'))
        return i, o, i / 1e6 * self.price_in + o / 1e6 * self.price_out


def arr_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip(); a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except ValueError:
                pass
    return None


# verify prompt — verbatim from rag/pipeline/fw-verify-facts.py (only the judge model changes: gpt-oss, not the writer's family)
VERIFY_HEAD = '''You are a careful science fact-checker. For EACH fact below, judge whether it is factually CORRECT and appropriate for a grade-5 (10-year-old) science context. Reason first, then output ONLY the final JSON array.

verdict: "ok" = true and accurate; "suspect" = oversimplified to the point of being misleading, ambiguous, or you are genuinely unsure; "wrong" = factually incorrect. reason = short (<=12 words); for suspect/wrong, say what's off.

FINAL ANSWER = a JSON array, one object per fact IN ORDER:
[{"id":"<fact id>","verdict":"ok","reason":".."}]
FACTS:
'''


def cache_fresh(entry, r, model):
    """A cached verdict/translation counts only for the same candidate text AND the same model."""
    return bool(entry) and entry.get('sha') == r.get('sha') and entry.get('model') == model


def batch_key(ids):
    return hashlib.sha1('\n'.join(sorted(ids)).encode('utf-8')).hexdigest()[:12]


class FwBudget:
    """--limit / FW_LIMIT: rows Fireworks may see this run for one stage, spent across the streams in order."""

    def __init__(self, args):
        self.left = args.limit or int(os.environ.get('FW_LIMIT', '0'))
        self.capped = bool(self.left)

    def take(self, pending):
        todo = pending[:self.left] if self.capped else pending
        self.left -= len(todo)
        return todo


def stage_verify(args, rows_by_stream, fw):
    budget = FwBudget(args)
    out, drops, counts = {}, [], collections.Counter()
    for stream, _ in STREAMS:
        rows = rows_by_stream.get(stream, [])
        # one cache dir per stream: an AUP verdict never shares a batch (or a file) with main rows
        vdir = os.path.join(args.out, 'verify-verdicts', stream); os.makedirs(vdir, exist_ok=True)
        verdicts = {}
        for fn in sorted(glob.glob(os.path.join(vdir, 'verd-*.jsonl'))):
            for o in read_jsonl(fn):
                verdicts[o['id']] = o
        pending = [r for r in rows if args.reverify or not cache_fresh(verdicts.get(r['id']), r, args.verify_model)]
        if args.dry_run:
            log(f'[verify] DRY RUN {stream}: {len(rows)} rows, {len(pending)} without a fresh cached verdict — Fireworks skipped, those pass as "dry-run"')
        elif pending:
            todo = budget.take(pending)
            batches = [todo[i:i + args.batch] for i in range(0, len(todo), args.batch)]
            log(f'[verify] {stream}: {len(rows)} rows | fresh cache {len(rows) - len(pending)} | verifying {len(todo)} of {len(pending)} pending '
                f'in {len(batches)} batches (size {args.batch}, conc {args.conc}) via {args.verify_model}')
            lock = threading.Lock(); failed = [0]

            def do_batch(facts):
                payload = [{'id': f['id'], 'domain': f['domain'], 'en': f['en']} for f in facts]
                try:
                    c, rc = fw.call(args.verify_model, VERIFY_HEAD + json.dumps(payload, ensure_ascii=False), 8000, 0.1,
                                    reasoning_effort=args.verify_reasoning, stage='verify')
                except Exception as e:
                    with lock:
                        failed[0] += 1
                    log(f'    FAIL batch {batch_key([f["id"] for f in facts])} ({len(facts)} rows): {type(e).__name__}'); return
                by_id = {f['id']: f for f in facts}
                res = [{'id': o['id'], 'verdict': o['verdict'], 'reason': str(o.get('reason', ''))[:140], 'model': args.verify_model,
                        'sha': by_id[o['id']]['sha']}
                       for o in (arr_from(c, rc) or []) if isinstance(o, dict) and o.get('id') in by_id and o.get('verdict') in ('ok', 'suspect', 'wrong')]
                if res:      # file named by the batch's id SET: a partial return re-batched later lands in a different file, never clobbers this one
                    write_jsonl(os.path.join(vdir, f'verd-{batch_key(by_id)}.jsonl'), res)
                with lock:
                    for o in res:
                        verdicts[o['id']] = o
            with ThreadPoolExecutor(max_workers=args.conc) as ex:
                for _ in as_completed([ex.submit(do_batch, b) for b in batches]):
                    pass
            if failed[0]:
                log(f'[verify] {stream}: {failed[0]} batch(es) failed — re-run to retry the missing ids')
        elif rows:
            log(f'[verify] {stream}: all {len(rows)} rows have fresh cached verdicts ({args.verify_model})')
        keep = []
        for r in rows:
            v = verdicts.get(r['id'])
            fresh = cache_fresh(v, r, args.verify_model)
            r['verdict'] = v['verdict'] if fresh else ('dry-run' if args.dry_run else 'unverified')
            r['verify_reason'] = v['reason'] if fresh else ''
            r['verify_model'] = args.verify_model if fresh else None
            counts[(stream, r['verdict'])] += 1
            if r['verdict'] in ('ok', 'dry-run'):
                keep.append(r)
            else:
                d = dict(stage='verify', stream=stream, tmp_id=r['tmp_id'], id=r['id'], brief_code=r['brief_code'], verdict=r['verdict'])
                if stream not in AUP_STREAMS:          # shared file: AUP rows by id only (the reason can quote the fact)
                    d.update(reason=r['verify_reason'], en=r['en'])
                drops.append(d)
        out[stream] = keep
        write_jsonl(os.path.join(args.out, f'4-verify.{stream}.jsonl'), keep)
        c = {k[1]: v for k, v in counts.items() if k[0] == stream}
        log(f"[verify] {stream}: {len(rows)} → {len(keep)} kept | " + ', '.join(f'{k}={v}' for k, v in sorted(c.items())))
    write_jsonl(os.path.join(args.out, 'verify-drops.jsonl'), drops)
    if args.verbose:
        for d in drops:
            if d['verdict'] != 'unverified':
                log(f"    {d['verdict']} ({d.get('reason', '')}): {desc(d)}")
    return out


# translation prompt — assemble-newfacts.py's, extended to return kid-query terms in all three languages
TRANSLATE_HEAD = '''Translate each English science fact into natural kid-friendly Tagalog (tl) and Cebuano/Bisaya (bis): one clear sentence each, everyday vocabulary a grade-5 Filipino child uses (Tagalog: bundok, dagat, dugo; Cebuano: ug/kini/dili/mao, not at/ito/hindi). Keep English science terms where Filipino kids use them (magnet, thermometer, energy, gravity, volcano, PAGASA, PHIVOLCS, place names). Translate faithfully: do not add, drop, or change any fact, number, or name.

Also produce "terms": 10-16 search words or short phrases (1-3 words) a kid might type to find this fact — a MIX of Tagalog, Bisaya, and English content words taken from the three sentences (nouns, verbs, key adjectives; include inflection variants where they differ, e.g. gumagalaw/gumalaw, naglihok/molihok), plus the English science terms kids use. No stopwords, no duplicates, lowercase except proper nouns.

Output ONLY a JSON array, one object per fact IN ORDER:
[{"id":"<id>","tl":"...","bis":"...","terms":["...", "..."]}]
FACTS:
'''


def en_terms(topic, en):
    """assemble-newfacts.py terms(): English content words, the always-present floor under the model's trilingual terms."""
    seen, out = set(), []
    for w in re.findall(r'[A-Za-z]{4,}', topic + ' ' + en):
        wl = w.lower()
        if wl not in STOP and wl not in seen:
            seen.add(wl); out.append(wl)
    return out[:10]


def merge_terms(*lists, cap=24):
    seen, out = set(), []
    for lst in lists:
        for t in lst or []:
            t = norm_text(t)
            if not t or len(t.split()) > 4 or t.lower() in seen:
                continue
            seen.add(t.lower()); out.append(t)
    return out[:cap]


def translation_ok(en, tl, bis):
    if not isinstance(tl, str) or not isinstance(bis, str):
        return False
    tl, bis = norm_text(tl), norm_text(bis)
    if not tl or not bis or tl.lower() == bis.lower():
        return False
    for t in (tl, bis):
        if t.lower() == en.lower() or not (0.4 <= len(t) / max(1, len(en)) <= 3.0):
            return False
    return True


def terms_trilingual(terms, tl, bis):
    """≥1 term found in the Tagalog sentence and ≥1 in the Bisaya one (cheap substring check): an English-only list would
    leave the on-device FTS unable to reach the fact from a tl/bis query."""
    tl, bis = (tl or '').lower(), (bis or '').lower()
    return any(t.lower() in tl for t in terms) and any(t.lower() in bis for t in terms)


def final_terms(r, t):
    """candidate's own terms + the model's trilingual terms + the English content-word floor."""
    return merge_terms(r['terms'], (t or {}).get('terms'), en_terms(r['topic'], r['en']))


def require_verified(stage, rows_by_stream, dry_run):
    """Only verdict 'ok' rows go further (dry-run rows only inside a dry run); anything else is a stale dry-run/partial artefact."""
    allowed = ('ok', 'dry-run') if dry_run else ('ok',)
    bad = [f"{r['id']} verdict={r.get('verdict')!r}" for s, _ in STREAMS for r in rows_by_stream.get(s, []) if r.get('verdict') not in allowed]
    if bad:
        sys.exit(f'[{stage}] refusing: {len(bad)} row(s) are not verified (re-run verify without --dry-run):\n  ' + '\n  '.join(bad[:20]))


def stage_translate(args, rows_by_stream, fw):
    require_verified('translate', rows_by_stream, args.dry_run)
    budget = FwBudget(args)
    out, still = {}, []
    for stream, _ in STREAMS:
        rows = rows_by_stream.get(stream, [])
        cache_path = os.path.join(args.out, f'translations.{stream}.json')      # per stream: the AUP twin is the only file holding its tl/bis
        cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
        pending = [r for r in rows if args.retranslate or not cache_fresh(cache.get(r['id']), r, args.translate_model)]
        if args.dry_run:
            log(f'[translate] DRY RUN {stream}: {len(rows)} rows, {len(pending)} without a fresh cached translation — Fireworks skipped (tl/bis left empty)')
        elif pending:
            todo = budget.take(pending)
            batches = [todo[i:i + 10] for i in range(0, len(todo), 10)]
            log(f'[translate] {stream}: {len(rows)} rows | fresh cache {len(rows) - len(pending)} | translating {len(todo)} of {len(pending)} pending '
                f'in {len(batches)} batches via {args.translate_model}')
            lock = threading.Lock(); bad = collections.Counter()

            def do_batch(facts):
                payload = [{'id': f['id'], 'topic': f['topic'], 'en': f['en']} for f in facts]
                try:
                    c, rc = fw.call(args.translate_model, TRANSLATE_HEAD + json.dumps(payload, ensure_ascii=False), 6000, 0.2,
                                    reasoning_effort='low', stage='translate')
                except Exception as e:
                    with lock:
                        bad['call-failed'] += len(facts)
                    log(f'    FAIL batch {batch_key([f["id"] for f in facts])} ({len(facts)} rows): {type(e).__name__}'); return
                by_id = {f['id']: f for f in facts}
                got = rej = nt = 0
                for o in (arr_from(c, rc) or []):
                    if not isinstance(o, dict) or o.get('id') not in by_id:
                        continue
                    f = by_id[o['id']]
                    if not translation_ok(f['en'], o.get('tl'), o.get('bis')):
                        rej += 1; continue
                    t = dict(tl=norm_text(o['tl']), bis=norm_text(o['bis']), terms=merge_terms([x for x in (o.get('terms') or []) if isinstance(x, str)]),
                             model=args.translate_model, sha=f['sha'])
                    if not terms_trilingual(final_terms(f, t), t['tl'], t['bis']):
                        nt += 1; continue
                    with lock:
                        cache[f['id']] = t
                    got += 1
                with lock:
                    bad['translation-rejected'] += rej; bad['terms-not-trilingual'] += nt; bad['not-returned'] += len(facts) - got - rej - nt
                    write_json(cache_path, cache)
            with ThreadPoolExecutor(max_workers=args.conc) as ex:
                for _ in as_completed([ex.submit(do_batch, b) for b in batches]):
                    pass
            write_json(cache_path, cache)
            if any(v > 0 for v in bad.values()):
                log(f'[translate] {stream}: problems this run: ' + ', '.join(f'{k}={v}' for k, v in bad.items() if v > 0) + ' (re-run to retry)')
        elif rows:
            log(f'[translate] {stream}: all {len(rows)} rows have fresh cached translations ({args.translate_model})')
        keep = []
        for r in rows:
            t = cache.get(r['id'])
            if not cache_fresh(t, r, args.translate_model):
                t = None
            if t is None and args.dry_run:
                r['tl'] = r['bis'] = ''
                r['terms_final'] = final_terms(r, None)
                keep.append(r); continue
            pend = dict(stage='translate', stream=stream, tmp_id=r['tmp_id'], id=r['id'], brief_code=r['brief_code'])
            if t is None:
                still.append(dict(pend, reason='no-translation-yet')); continue
            terms = final_terms(r, t)
            if not terms_trilingual(terms, t['tl'], t['bis']):
                still.append(dict(pend, reason='terms-not-trilingual')); continue
            r['tl'], r['bis'], r['terms_final'], r['translate_model'] = t['tl'], t['bis'], terms, args.translate_model
            keep.append(r)
        out[stream] = keep
        write_jsonl(os.path.join(args.out, f'5-translate.{stream}.jsonl'), keep)
        log(f"[translate] {stream}: {len(rows)} → {len(keep)} translated, {sum(1 for s in still if s['stream'] == stream)} pending")
    write_jsonl(os.path.join(args.out, 'translate-pending.jsonl'), still)
    return out


# ───────────────────────────── stage 6: emit ─────────────────────────────

def model_short(m):
    return (m or '').rsplit('/', 1)[-1]


def stage_emit(args, briefs, rows_by_stream):
    require_verified('emit', rows_by_stream, args.dry_run)
    rows = [r for s, _ in STREAMS for r in rows_by_stream.get(s, [])]
    if not args.dry_run:                    # a stale dry-run 5-translate file has tl = bis = '' — never emit it as verified
        bad = [f"{r['id']} empty tl/bis" for r in rows if not (r.get('tl') and r.get('bis'))]
        bad += [f"{r['id']} terms not trilingual" for r in rows if r.get('tl') and r.get('bis')
                and not terms_trilingual(r.get('terms_final') or r['terms'], r['tl'], r['bis'])]
        if bad:
            sys.exit(f'[emit] refusing: {len(bad)} row(s) are not translated (re-run translate without --dry-run):\n  ' + '\n  '.join(bad[:20]))
    stamp = datetime.date.today().strftime('%Y-%m')
    if args.dry_run:
        source = f'lane-a {args.writer} (dry-run, UNVERIFIED, {stamp})'
    else:                                   # provenance = the verify model recorded on the rows, not a literal
        used = sorted({model_short(r.get('verify_model')) for r in rows if r.get('verify_model')}) or [model_short(args.verify_model)]
        source = f"lane-a {args.writer} + {'/'.join(used)} verify ({stamp})"
    tags, n_ready = {}, collections.Counter()
    for stream, _ in STREAMS:
        ready = []
        for r in rows_by_stream.get(stream, []):
            cell = briefs[r['brief_code']]['cell']
            row = dict(id=r['id'], domain=r['domain'], topic=r['topic'], grades=r['grades'], terms=r.get('terms_final') or r['terms'],
                       fact=dict(tl=r.get('tl', ''), en=r['en'], bis=r.get('bis', '')), source=source, generator='lane-a',
                       reviewed=False, brief_code=r['brief_code'], card_form=r['card_form'])
            if args.dry_run:
                row['unverified'] = True
            ready.append(row)
            # exactly the curriculum-tags.json v2 entry keys — nothing extra
            tags[r['id']] = dict(competency=r['brief_code'], grade=cell['grade'], quarter=cell['quarter'], domain=cell['domain'],
                                 codes=[r['brief_code']], cells=[f"G{cell['grade']}-Q{cell['quarter']}"], score=1.0, confidence=1.0)
            n_ready[stream] += 1
        fn = 'lane-a-ingest-ready.jsonl' if stream == 'main' else f'lane-a-ingest-ready.{stream}.jsonl'
        write_jsonl(os.path.join(args.out, fn), ready)
        log(f'[emit] {stream}: {len(ready)} rows → {fn}')
    write_json(os.path.join(args.out, 'lane-a-tags.json'), dict(
        scheme='lane-a v2 fragment: born-labelled facts (codes=[brief_code], confidence 1.0), keyed by BANK fact id for the `bank` '
               'section of curriculum-tags.json v2. The `factoids` section of that file is keyed by ffct id: re-key these entries '
               'to the factoid ids at the assemble-factoids append step (one entry per factoid minted from the fact).',
        bank=tags))
    log(f'[emit] {len(tags)} tag entries → lane-a-tags.json (curriculum-tags v2 fragment, bank section, keyed by fact id)')
    return n_ready


# ───────────────────────────── driver ─────────────────────────────

def load_stage(args, stage_idx):
    """Rows per stream as left by stage STAGES[stage_idx] (for --stages that don't start at validate)."""
    name = f'{stage_idx + 1}-{STAGES[stage_idx]}'
    out = {}
    for stream, _ in STREAMS:
        out[stream] = read_jsonl(os.path.join(args.out, f'{name}.{stream}.jsonl'))
    return out


def per_code_table(args, briefs, stages_rows):
    codes = sorted(briefs, key=lambda c: (briefs[c]['cell']['grade'], c))
    cols = [s for s in STAGES[:-1] if s in stages_rows]
    log('\nper competency (rows surviving each stage):')
    log('  code       target ' + ' '.join(f'{c:>9}' for c in cols))
    tot = collections.Counter()
    for code in codes:
        counts = [sum(1 for s, _ in STREAMS for r in stages_rows[c].get(s, []) if r['brief_code'] == code) for c in cols]
        if not any(counts):
            continue
        for c, n in zip(cols, counts):
            tot[c] += n
        log(f"  {code:<10} {briefs[code]['target']:>6} " + ' '.join(f'{n:>9}' for n in counts))
    log('  ' + 'TOTAL'.ljust(17) + ' '.join(f'{tot[c]:>9}' for c in cols))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(HERE, 'out'), help='candidates dir; every artefact lands here')
    ap.add_argument('--stages', default='all', help='comma list of ' + ','.join(STAGES) + ' (default all)')
    ap.add_argument('--dry-run', action='store_true', help='skip Fireworks (verify passes as dry-run, tl/bis empty, rows marked unverified)')
    ap.add_argument('--writer', default=os.environ.get('LANE_A_WRITER', 'outside-model'), help="the writing model, for source='lane-a <writer> + <verify model> verify'")
    ap.add_argument('--en-words', default=os.environ.get('LANE_A_EN_WORDS', f'{EN_WORDS[0]},{EN_WORDS[1]}'), help='accepted `en` word band, "min,max"')
    ap.add_argument('--min-terms', type=int, default=MIN_TERMS, help='minimum distinct search terms per candidate')
    ap.add_argument('--limit', type=int, default=0, help='max rows sent to Fireworks per stage this run (also FW_LIMIT env)')
    ap.add_argument('--batch', type=int, default=int(os.environ.get('FW_BATCH', '15')))
    ap.add_argument('--conc', type=int, default=int(os.environ.get('FW_CONC', '6')))
    ap.add_argument('--verify-model', default=os.environ.get('LANE_A_VERIFY_MODEL', GPT_OSS),
                    help='verdict model (env LANE_A_VERIFY_MODEL — deliberately not FW_MODEL, which other scripts set to the writer)')
    ap.add_argument('--allow-same-family', action='store_true', help='override the refusal to verify with the writer\'s own model family')
    ap.add_argument('--verify-reasoning', default=os.environ.get('FW_REASONING', 'medium'))
    ap.add_argument('--translate-model', default=os.environ.get('FW_TRANSLATE_MODEL', GPT_OSS))
    ap.add_argument('--t-exist', type=float, default=0.86, help='LaBSE cosine vs bank above which a candidate is dropped')
    ap.add_argument('--t-cand', type=float, default=0.90, help='LaBSE cosine within batch above which a candidate is dropped')
    ap.add_argument('--reverify', action='store_true', help='ignore cached verdicts')
    ap.add_argument('--retranslate', action='store_true', help='ignore cached translations')
    ap.add_argument('--samples', type=int, default=3, help='sample ready rows to print (main stream only)')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()
    args.out = os.path.abspath(args.out)
    try:
        args.en_words = tuple(int(x) for x in args.en_words.split(','))
        assert len(args.en_words) == 2 and 0 < args.en_words[0] <= args.en_words[1]
    except (ValueError, AssertionError):
        sys.exit(f'--en-words must be "min,max", got {args.en_words!r}')
    fam = re.sub(r'[^a-z]', '', args.writer.lower())        # 'qwen3p7-plus' ⊇ 'qwen', 'gpt-oss-120b' ⊇ 'gptoss'
    if not args.dry_run and fam and fam in re.sub(r'[^a-z]', '', args.verify_model.lower()) and not args.allow_same_family:
        sys.exit(f'refusing: --verify-model {args.verify_model} is the writer\'s own family ({args.writer}); the verify pass must be '
                 f'decorrelated from the writer (FACT-SWARM-SPEC) — pick another model or pass --allow-same-family')
    if os.path.abspath(os.path.join(ROOT, 'rag', 'bank')) in args.out or 'packages' in args.out.split(os.sep):
        sys.exit(f'refusing --out {args.out}: must not point into rag/bank or packages/')
    os.makedirs(args.out, exist_ok=True)
    stages = STAGES if args.stages == 'all' else [s.strip() for s in args.stages.split(',')]
    for s in stages:
        if s not in STAGES:
            sys.exit(f'unknown stage {s}; choose from {STAGES}')
    idx = [STAGES.index(s) for s in stages]
    if idx != list(range(idx[0], idx[0] + len(idx))):
        sys.exit('--stages must be a contiguous run of stages')
    t0 = time.time()
    comp = load_competencies(); briefs = load_briefs(comp); bank = load_bank()
    log(f'lane-a ingest | out={args.out} | briefs {len(briefs)} | bank {len(bank)} | {"DRY RUN" if args.dry_run else "Fireworks: verify=" + args.verify_model + " translate=" + args.translate_model}')
    fw = None if args.dry_run or not ({'verify', 'translate'} & set(stages)) else Fireworks(
        float(os.environ.get('FW_PRICE_IN', '0.15')), float(os.environ.get('FW_PRICE_OUT', '0.60')))
    rows = None if idx[0] == 0 else load_stage(args, idx[0] - 1)
    stages_rows = {}
    for s in stages:
        if s == 'validate':
            rows = stage_validate(args, briefs, bank)
        elif s == 'dedup':
            rows = stage_dedup(args, briefs, bank, rows)
        elif s == 'mint':
            rows = stage_mint(args, briefs, bank, rows)
        elif s == 'verify':
            rows = stage_verify(args, rows, fw)
        elif s == 'translate':
            rows = stage_translate(args, rows, fw)
        elif s == 'emit':
            stage_emit(args, briefs, rows)
        if s != 'emit':
            stages_rows[s] = {k: list(v) for k, v in rows.items()}
    per_code_table(args, briefs, stages_rows)
    summary = dict(when=datetime.datetime.now().isoformat(timespec='seconds'), out=args.out, dry_run=args.dry_run, writer=args.writer,
                   stages=stages, verify_model=None if args.dry_run else args.verify_model,
                   translate_model=None if args.dry_run else args.translate_model,
                   thresholds=dict(t_exist=args.t_exist, t_cand=args.t_cand, en_words=list(args.en_words), min_terms=args.min_terms),
                   counts={s: {stream: len(v.get(stream, [])) for stream, _ in STREAMS} for s, v in stages_rows.items()},
                   rejects=len(read_jsonl(os.path.join(args.out, 'rejects.jsonl'))),
                   dedup_drops=collections.Counter(d['reason'] for d in read_jsonl(os.path.join(args.out, 'dedup-drops.jsonl'))),
                   verify_drops=collections.Counter(d['verdict'] for d in read_jsonl(os.path.join(args.out, 'verify-drops.jsonl'))),
                   translate_pending=len(read_jsonl(os.path.join(args.out, 'translate-pending.jsonl'))),
                   ready={stream: len(read_jsonl(os.path.join(args.out, 'lane-a-ingest-ready.jsonl' if stream == 'main' else f'lane-a-ingest-ready.{stream}.jsonl'))) for stream, _ in STREAMS})
    if fw:
        i, o, cost = fw.cost()
        summary['fireworks'] = dict(calls=dict(fw.calls), tokens_in=i, tokens_out=o, est_usd=round(cost, 4))
        log(f'\nFireworks this run: {dict(fw.calls)} calls | tokens in/out {i:,}/{o:,} | est ${cost:.4f} (at ${fw.price_in}/${fw.price_out} per M)')
    write_json(os.path.join(args.out, 'ingest-summary.json'), summary)
    if 'emit' in stages and args.samples:
        ready = read_jsonl(os.path.join(args.out, 'lane-a-ingest-ready.jsonl'))
        log(f'\nsample ready rows (main stream, {min(args.samples, len(ready))} of {len(ready)}):')
        for r in ready[:args.samples]:
            log('  ' + json.dumps(r, ensure_ascii=False))
    log(f'\nready: {summary["ready"]} | summary → ingest-summary.json | {time.time() - t0:.0f}s')
    log('NOT appended to science-facts.jsonl / factoids.jsonl — that is a separate, append-only-gated step.')


if __name__ == '__main__':
    main()

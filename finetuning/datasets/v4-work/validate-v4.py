#!/usr/bin/env python3
"""Mechanical gate for science-dialogue-v4 fragment files (DIALOGUE-DATASET.md).

  finetuning/.convert-venv/bin/python finetuning/datasets/v4-work/validate-v4.py [--lang tagalog|cebuano] <fragment.jsonl> [...]

Fragments may omit the system message and instead carry a top-level "grade"
("3".."10") — with --lang the matching production system prompt is injected
before validation (the assembler does the same at merge time). Rows that DO
carry a system message are checked byte-exact against the dumped prompts.

Checks per row:
  1. valid JSON; messages = [system, user, assistant, ...] strictly alternating,
     final message assistant
  2. system prompt EXACTLY matches a dumped production prompt (system-prompts.json)
  3. every [image: ...] tag sits on its own FINAL line of its message and its
     English description resolves against the bundled image catalog at
     cosine >= 0.70 (IMAGE_TAG_FLOOR) — top-1 slug printed for eyeballing
  4. every grounding fact line ("- (topic) text" inside a VERIFIED FACTS block)
     matches a real bank fact text VERBATIM (tl/bis/en), and the block carries the
     exact formatGroundingBlock header/trailer
  5. no 8-gram (word-level) shared between two assistant turns of the same row
Exit 0 only if every row of every file passes.
"""
import json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))  # repo root
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
BIN = os.path.join(ROOT, "packages", "mobile", "assets", "rag", "image-vectors-labse.i8.bin")
META = os.path.join(ROOT, "packages", "mobile", "assets", "rag", "image-vectors-labse.meta.json")
PROMPTS = json.load(open(os.path.join(HERE, "system-prompts.json")))
FLOOR = 0.70
G_HEAD = "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):"
G_TAIL = "When the question is answered by the facts above"
TAG_RE = re.compile(r"\[image:\s*([^\]]+?)\s*\]")

valid_systems = {p for byg in PROMPTS.values() for p in byg.values()}

bank_texts = set()
for line in open(BANK):
    f = json.loads(line)["fact"]
    for lk in ("tl", "en", "bis"):
        if f.get(lk):
            bank_texts.add(unicodedata.normalize("NFC", f[lk].strip()))

def grams(text, n=8):
    w = re.sub(r"\[image:[^\]]*\]", " ", text.lower())
    w = re.findall(r"[\w'-]+", w)
    return {" ".join(w[i:i+n]) for i in range(len(w) - n + 1)}

# ---- collect all tag descs first so we embed in ONE batch (model load is slow)
args = sys.argv[1:]
LANG = None
if args and args[0] == "--lang":
    LANG = args[1]
    args = args[2:]
    assert LANG in PROMPTS, f"--lang must be one of {list(PROMPTS)}"
files = args
assert files, "usage: validate-v4.py [--lang tagalog|cebuano] <fragment.jsonl> [...]"
all_rows, all_descs = [], []
for path in files:
    for ln, line in enumerate(open(path), 1):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            all_rows.append((path, ln, None, [f"invalid JSON: {e}"]))
            continue
        # system-less fragment: inject the production prompt from --lang + "grade"
        ms = row.get("messages")
        if isinstance(ms, list) and ms and ms[0].get("role") != "system":
            g = str(row.get("grade", ""))
            if LANG is None:
                all_rows.append((path, ln, None, ["system-less row but no --lang given"]))
                continue
            if g not in PROMPTS[LANG]:
                all_rows.append((path, ln, None, [f"bad/missing grade {g!r} (need 3..10)"]))
                continue
            row = {**row, "messages": [{"role": "system", "content": PROMPTS[LANG][g]}] + ms}
        all_rows.append((path, ln, row, []))
        for m in row.get("messages", []):
            if m.get("role") == "assistant":
                all_descs += TAG_RE.findall(m.get("content", ""))

desc_hits = {}
if all_descs:
    import numpy as np, torch, torch.nn.functional as F
    from transformers import AutoTokenizer, AutoModel
    meta = json.load(open(META))
    vecs = np.frombuffer(open(BIN, "rb").read(), dtype=np.int8).reshape(meta["count"], meta["dims"])
    vecs_f = vecs.astype(np.float32) * meta["scale"]
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained("sentence-transformers/LaBSE")
    model = AutoModel.from_pretrained("sentence-transformers/LaBSE").to(dev).eval()
    uniq = sorted(set(all_descs))
    embs = []
    for i in range(0, len(uniq), 64):
        enc = tok(uniq[i:i+64], return_tensors="pt", padding=True, truncation=True, max_length=192).to(dev)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]
        embs.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
    q = np.vstack(embs)
    sims = q @ vecs_f.T
    idx = sims.argmax(axis=1)
    for d, i, c in zip(uniq, idx, sims[np.arange(len(uniq)), idx]):
        desc_hits[d] = (meta["slugs"][int(i)], float(c))

n_fail = 0
for path, ln, row, errs in all_rows:
    where = f"{os.path.basename(path)}:{ln}"
    if row is not None:
        ms = row.get("messages")
        if not isinstance(ms, list) or len(ms) < 3:
            errs.append("messages missing or <3")
        else:
            if ms[0].get("role") != "system":
                errs.append("first message not system")
            elif ms[0]["content"] not in valid_systems:
                errs.append("system prompt is NOT an exact production prompt")
            want = "user"
            for k, m in enumerate(ms[1:], 1):
                if m.get("role") != want:
                    errs.append(f"role order broken at messages[{k}] (got {m.get('role')})")
                    break
                want = "assistant" if want == "user" else "user"
            if ms[-1].get("role") != "assistant":
                errs.append("final message not assistant")
            # grounding blocks
            for k, m in enumerate(ms):
                c = m.get("content", "")
                if m.get("role") == "user" and G_HEAD in c:
                    if k != len(ms) - 2:
                        errs.append(f"grounding block in messages[{k}] — must be FINAL user turn only")
                    if G_TAIL not in c:
                        errs.append("grounding block missing formatGroundingBlock trailer")
                    for fl in re.findall(r"^- (?:\(.*?\) )?(.+)$", c.split(G_TAIL)[0], re.M):
                        if unicodedata.normalize("NFC", fl.strip()) not in bank_texts:
                            errs.append(f"grounding line not a verbatim bank fact: {fl[:70]!r}")
                if m.get("role") == "user" and k > 0 and k != len(ms) - 2 and G_HEAD in c:
                    pass  # already flagged above
            # tags
            for k, m in enumerate(ms):
                if m.get("role") != "assistant":
                    continue
                c = m.get("content", "")
                for d in TAG_RE.findall(c):
                    slug, cos = desc_hits.get(d, ("?", 0.0))
                    if cos < FLOOR:
                        errs.append(f"tag below floor ({cos:.3f} -> {slug}): [image: {d[:60]}]")
                    else:
                        print(f"  ok tag {cos:.3f} -> {slug:40s} {where} [image: {d[:55]}]")
                if TAG_RE.search(c):
                    last = c.rstrip().split("\n")[-1].strip()
                    if not re.fullmatch(r"\[image:\s*[^\]]+\]", last):
                        errs.append("tag present but not alone on the FINAL line")
            # 8-gram repetition across assistant turns
            asst = [m["content"] for m in ms if m.get("role") == "assistant"]
            for i in range(len(asst)):
                for j in range(i + 1, len(asst)):
                    shared = grams(asst[i]) & grams(asst[j])
                    if shared:
                        errs.append(f"assistant turns {i} & {j} share an 8-gram: {next(iter(shared))[:60]!r}")
    if errs:
        n_fail += 1
        for e in errs:
            print(f"FAIL {where}: {e}")

total = len(all_rows)
print(f"\n{total - n_fail}/{total} rows pass")
sys.exit(1 if n_fail else 0)

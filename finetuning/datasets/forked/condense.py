#!/usr/bin/env python3
"""Condense over-length dialogues to fit ctx=1024 (~3360 chars total, calibrated
from the live training run: 3.28 chars/token). Strategy: keep system+user as-is;
for the long assistant answer, preserve the opening paragraph + the closing
Socratic question, and drop/trim middle **bold-section** blocks until it fits.
Ends coherently (never mid-sentence)."""
import json, re, sys

CHARS_PER_TOK = 3.28
MAX_TOK = 1024
SAFETY = 0.90                      # target 90% of limit for headroom
BUDGET = int(MAX_TOK * CHARS_PER_TOK * SAFETY)   # ~3019 chars total conversation

def total(msgs): return sum(len(m["content"]) for m in msgs)

def split_sections(text):
    """Split an assistant answer into [intro, *sections, closing].
    Sections start at markdown headers/bold labels or list groups."""
    text = text.replace("\\n", "\n")   # normalize any literal backslash-n to real newlines
    # paragraphs separated by blank lines; if that yields one mega-block,
    # fall back to single-newline splitting so we can still isolate sections.
    paras = re.split(r"\n\s*\n", text.strip())
    paras = [p.strip() for p in paras if p.strip()]
    if len(paras) <= 2:
        nl = [p.strip() for p in text.strip().split("\n") if p.strip()]
        if len(nl) > len(paras): paras = nl
    return paras

def is_question(p):  return p.rstrip().endswith("?")

def condense_assistant(text, char_budget):
    paras = split_sections(text)
    if len(paras) <= 2:
        # no structure to trim; hard-cut at last sentence boundary under budget
        cut = text[:char_budget]
        m = re.search(r"(?s)^.*[.!?](?=\s|$)", cut)
        return (m.group(0).strip() if m else cut.strip())
    intro = paras[0]
    # closing = the LAST question paragraph if any (preserve the Socratic prompt),
    # else the last paragraph.
    # closer = last paragraph that CONTAINS a question mark (Socratic prompt may
    # be followed by a hint/parenthetical), else the original last paragraph.
    q_idx = max((i for i,p in enumerate(paras) if "?" in p), default=len(paras)-1)
    if q_idx == 0: q_idx = len(paras)-1   # don't let intro be the closer
    closing = paras[q_idx]
    middle = [p for i,p in enumerate(paras) if i!=0 and i!=q_idx]
    kept = [intro]
    used = len(intro) + len(closing) + 4
    for p in middle:
        if used + len(p) + 2 <= char_budget:
            kept.append(p); used += len(p) + 2
        else:
            break
    kept.append(closing)
    return "\n\n".join(kept)

def condense_dialogue(d):
    msgs = d["messages"]
    fixed = len(msgs[0]["content"]) + len(msgs[1]["content"]) + 40  # sys+user+template
    ai = next(i for i,m in enumerate(msgs) if m["role"]=="assistant")
    abudget = BUDGET - fixed
    new = condense_assistant(msgs[ai]["content"], abudget)
    out = json.loads(json.dumps(d))
    out["messages"][ai]["content"] = new
    return out

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    rows=[json.loads(l) for l in open(src,encoding="utf-8") if l.strip()]
    THRESH = int(MAX_TOK*CHARS_PER_TOK)  # 3360, the actual skip line
    n_over=n_fixed=n_still=0
    with open(dst,"w",encoding="utf-8") as f:
        for d in rows:
            if total(d["messages"]) > THRESH:
                n_over+=1
                d=condense_dialogue(d)
                if total(d["messages"]) <= THRESH: n_fixed+=1
                else: n_still+=1
            f.write(json.dumps(d,ensure_ascii=False)+"\n")
    print(f"{src}: over={n_over} fixed={n_fixed} still_over={n_still} -> {dst}")

#!/usr/bin/env python3
"""Clean + analyze all harvested Bisaya sources, and map science-topic coverage
of the existing dialogue set vs the Tagalog target. Outputs:
  - sources/SOURCE_INDEX.md   (every source file: words, lang-check)
  - .raw/coverage.json        (existing dialogue counts by topic/grade)
"""
import glob, os, re, json, collections

ROOT="/Users/luis/Code/hiraia/finetuning/datasets/bisaya"
SRC=os.path.join(ROOT,"sources")

CEB={"ang","ug","sa","nga","mga","kang","kini","siya","kay","naa","wala","dili",
     "gyud","kaayo","unsa","aron","usa","duha","tulo","tubig","akong","imong",
     "nako","nimo","kanang","ngano","kinsa","pila","buhat","adlaw","gabii"}
def toks(t): return re.findall(r"[a-zA-ZñÑ']+", t.lower())

def body_of(raw):
    return raw.split("\n\n",1)[-1].split("## Notes")[0] if "## Notes" in raw else raw

# ---- 1. index every source file ----
rows=[]
for p in sorted(glob.glob(os.path.join(SRC,"**","*.txt"), recursive=True)):
    raw=open(p,encoding="utf-8").read()
    body=body_of(raw)
    w=toks(body)
    if not w: continue
    ceb=round(sum(1 for x in w if x in CEB)/len(w),3)
    rel=os.path.relpath(p,SRC)
    grp=("bloom" if rel.startswith("bloom/") else
         "huni-huni" if "huni-huni" in rel else
         "hunterswoods" if "hunterswoods" in rel else
         "cebwiki" if rel.startswith("cebwiki") else
         "reference")
    rows.append({"file":rel,"group":grp,"words":len(w),"ceb_ratio":ceb})

bygrp=collections.defaultdict(lambda:[0,0])
for r in rows:
    bygrp[r["group"]][0]+=1; bygrp[r["group"]][1]+=r["words"]

lines=["# Bisaya Source Index","",
       f"Total source files: {len(rows)}  |  Total words: {sum(r['words'] for r in rows):,}","",
       "| Group | Files | Words |","|-------|-------|-------|"]
for g in sorted(bygrp, key=lambda g:-bygrp[g][1]):
    lines.append(f"| {g} | {bygrp[g][0]} | {bygrp[g][1]:,} |")
lines+=["","## All files (low ceb-ratio = check language)",""]
lines.append("| File | Group | Words | ceb |")
lines.append("|------|-------|-------|-----|")
for r in sorted(rows,key=lambda r:(r["group"],-r["words"])):
    lines.append(f"| {r['file']} | {r['group']} | {r['words']} | {r['ceb_ratio']} |")
open(os.path.join(SRC,"SOURCE_INDEX.md"),"w").write("\n".join(lines)+"\n")

# ---- 2. coverage of existing dialogues ----
def load_mjs_dialogues(path):
    """crude: count {system/user/assistant} objects & pull grade + user prompts."""
    txt=open(path,encoding="utf-8").read()
    users=re.findall(r"user:\s*[`'\"](.+?)[`'\"]\s*,", txt, re.S)
    grades=re.findall(r"Grade\s*(\d+)", txt)
    return len(re.findall(r"\bassistant:", txt)), grades, users

mjs=glob.glob(os.path.join(ROOT,"*.mjs"))
cov={"by_file":{}, "grade_hist":collections.Counter(), "total_est":0}
for m in mjs:
    name=os.path.basename(m)
    if name=="generate.mjs": continue
    cnt,grades,users=load_mjs_dialogues(m)
    cov["by_file"][name]=cnt
    cov["total_est"]+=cnt
    for g in grades: cov["grade_hist"][g]+=1

# count actual jsonl
jl=os.path.join(ROOT,"science-chat.jsonl")
cov["jsonl_lines"]=sum(1 for _ in open(jl,encoding="utf-8")) if os.path.exists(jl) else 0
cov["grade_hist"]=dict(cov["grade_hist"])
json.dump(cov, open(os.path.join(ROOT,".raw","coverage.json"),"w"), indent=1)

print(f"SOURCE_INDEX.md written: {len(rows)} files, {sum(r['words'] for r in rows):,} words")
print("groups:", {g:bygrp[g][0] for g in bygrp})
print(f"existing dialogues (jsonl lines): {cov['jsonl_lines']}")
print(f"mjs assistant-count estimate: {cov['total_est']}")
print("top mjs files by count:")
for n,c in sorted(cov["by_file"].items(),key=lambda x:-x[1])[:12]:
    print(f"   {c:4}  {n}")

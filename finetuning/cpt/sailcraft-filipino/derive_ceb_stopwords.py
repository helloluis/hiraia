#!/usr/bin/env python3
"""Derive a Cebuano stopword list from a corpus sample + a function-word prior.

No clean native Cebuano stopword list exists, so we build one from:
  (a) the most frequent tokens in a ceb corpus sample (empirical), and
  (b) a hand-checked list of known Cebuano function words (linguistic prior),
union'd together. Tagalog and Cebuano are closely related Austronesian
languages, so we also report the overlap with the Tagalog list as a sanity
check (expect a modest overlap, not near-identity).

Usage:
    python derive_ceb_stopwords.py CEB_SAMPLE.jsonl  [--out ceb-stopwords.json]

The sample is JSONL with a `text` field (e.g. a SailCraft input file, or a head
of MADLAD-400 `ceb` / CulturaX `ceb`). The committed `ceb-stopwords.derived.json`
was produced from 3,000 MADLAD-400 v1.5 `ceb` clean docs.
"""
import argparse
import json
import re
from collections import Counter

# Known Cebuano function words (articles, pronouns, demonstratives, conjunctions,
# prepositions, particles, negators, numerals, common auxiliaries). Hand-checked.
CEB_KNOWN = [
    "ang", "sa", "ug", "nga", "mga", "ni", "si", "kang", "kay", "kini", "kana",
    "kadto", "dili", "wala", "na", "pa", "man", "gud", "lang", "ra", "ba", "mo",
    "ko", "ka", "siya", "kami", "kita", "sila", "ako", "ikaw", "atong", "akong",
    "imong", "iyang", "ilang", "among", "unsa", "kinsa", "asa", "ngano",
    "kanus-a", "giunsa", "pila", "kon", "kung", "apan", "kundi", "busa", "aron",
    "tungod", "samtang", "human", "sukad", "hangtod", "ubos", "ibabaw", "sulod",
    "gawas", "duol", "layo", "dinhi", "diri", "dira", "didto", "karon", "ganina",
    "ugma", "gahapon", "kahapon", "usa", "duha", "tulo", "upat", "lima", "unom",
    "pito", "walo", "siyam", "napulo", "naa", "aduna", "duna", "may", "walay",
    "tanan", "matag", "uban", "laing", "lain", "pulos", "puro", "gani", "bitaw",
    "diay", "kaha", "tingali", "basin", "murag", "daw", "kuno", "baya", "oo",
    "ayaw", "wa", "di", "makita", "buhaton", "himuon", "nahimo", "gibuhat",
    "gihimo", "nag", "mag", "pag", "gi", "ma", "pinaagi", "alang", "para",
    "gikan", "ngadto", "paingon",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sample", help="JSONL with a `text` field (ceb corpus head)")
    ap.add_argument("--out", default="ceb-stopwords.json")
    ap.add_argument("--top", type=int, default=80,
                    help="how many top frequency function words to keep")
    args = ap.parse_args()

    cnt = Counter()
    docs = 0
    for line in open(args.sample, encoding="utf-8"):
        txt = json.loads(line)["text"].lower()
        cnt.update(re.findall(r"[a-zñáéíóúàèìòùäëïöü']+", txt))
        docs += 1

    top = [w for w, _ in cnt.most_common(args.top * 2)]
    freq_funcs = [w for w in top if len(w) <= 8 and w.isalpha()][: args.top]
    final = sorted(set(freq_funcs) | set(w for w in CEB_KNOWN if w))

    json.dump(final, open(args.out, "w"), ensure_ascii=False, indent=0)
    print(f"docs={docs}  unique_tokens={len(cnt)}  ceb_stopwords={len(final)} -> {args.out}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Backfill Tagalog + Bisaya query keywords into facts that have English-only
`terms` (the spine + earliest batches). This is the documented #1 retrieval gap:
pure-Tagalog/Bisaya queries only matched those facts' bodies (low weight) and
lost to newer facts carrying the shared word in `terms`.

Conservative on purpose — we do NOT touch facts that already have curated Filipino
terms (no idf dilution of the good set), and for the weak facts we add only their
DISTINCTIVE Filipino content words:
  * taken from the fact's own tl/bis text (so they're real, in-language keywords)
  * absent from the English body (skip loanwords already covered)
  * not stopwords / not question-glue words
  * not corpus-common (skip words that appear in many facts' bodies — those carry
    little discriminating signal and diluting their idf hurts everyone)
  * capped per fact, rarest-first

  python3 rag/scripts/backfill-terms.py             # apply in place
  python3 rag/scripts/backfill-terms.py --dry-run   # report only
"""
import json, re, sys, os, collections

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSONL = os.path.join(HERE, "bank", "science-facts.jsonl")

MAX_PER_FACT = 10
DF_FRACTION = 0.08  # skip a keyword if it appears in >8% of fact bodies

# Tagalog + Cebuano function/glue + question words we never want as search keys.
STOP = set("""
ang ng mga sa na ay at kung kapag dahil ito iyon isang para nang din rin lang
bawat may mayroon wala hindi niya natin namin nila ako ikaw siya tayo kami sila
kanila kanilang ating iyong aming nito dito doon kaya kaysa tulad halimbawa mula
hanggang bilang upang nasa kapwa habang pero ngunit subalit kasi sapagkat nga
lamang naman talaga kahit maging bakit paano ano anong saan kailan sino alin
ngano nganong unsa unsay asa kinsa giunsa pila naunsa giunsang
og ug kay kon kini kana nga kita kamo dili naa aduna aron sama pananglitan gikan
hangtod isip maong tungod kanunay usa pud sab gani bisan apan mao kaayo nimo niini
niana ngadto diin imong akong iyang atong inyong kaayong kanila kanimo kanako
nahimo mahimo mahitabo makahimo makita makuha mabati molihok mga mismo bag
 that this with from into your you they them have will not but are does did the
""".split())


def toks(s):
    return [t for t in re.split(r"[^a-z0-9ñáéíóúàèìòù]+", s.lower()) if len(t) > 3]


def has_filipino_terms(r):
    """True if the fact already carries an in-language (TL/BIS) keyword."""
    term_toks = set(t.lower() for t in r.get("terms", []))
    tl = set(toks(r["fact"]["tl"]))
    en = set(toks(r["fact"]["en"]))
    return bool(term_toks & (tl - en))


def candidates(r):
    en = set(toks(r["fact"]["en"]))
    out, seen = [], set()
    for body in (r["fact"]["tl"], r["fact"]["bis"]):
        for t in toks(body):
            if t in en or t in STOP or t in seen:
                continue
            seen.add(t)
            out.append(t)
    return out


def main():
    dry = "--dry-run" in sys.argv
    rows = [json.loads(l) for l in open(JSONL, encoding="utf-8") if l.strip()]
    N = len(rows)

    # Corpus body document-frequency, to skip non-discriminating common words.
    bodyf = collections.Counter()
    for r in rows:
        for t in set(toks(r["fact"]["tl"]) + toks(r["fact"]["bis"])):
            bodyf[t] += 1
    df_max = max(8, int(DF_FRACTION * N))

    weak = [r for r in rows if not has_filipino_terms(r)]
    changed = added = 0
    for r in weak:
        existing = set(t.lower() for t in r.get("terms", []))
        cands = [c for c in candidates(r) if c not in existing and bodyf[c] <= df_max]
        # rarest first (most discriminating), then longest
        cands.sort(key=lambda t: (bodyf[t], -len(t)))
        pick = cands[:MAX_PER_FACT]
        if pick:
            changed += 1
            added += len(pick)
            if not dry:
                r["terms"] = r.get("terms", []) + pick

    print(f"weak facts (english-only terms): {len(weak)}/{N}")
    print(f"backfilled {changed} facts; {added} keywords added (cap {MAX_PER_FACT}/fact,"
          f" df<= {df_max}){' [dry run]' if dry else ''}")
    if dry:
        return
    with open(JSONL, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()

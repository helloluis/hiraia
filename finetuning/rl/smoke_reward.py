"""Integration smoke: reward.py × REAL generated prompt rows (rl-prompts.tagalog.jsonl).

Not a unit test — a calibration eyeball. For one real row of each kind, scores a
plausibly-GOOD completion against a plausibly-BAD one and prints the gap. GRPO
advantages are group-relative per prompt, so ORDERING within each pair is what
matters; gaps ≥ ~0.15 give the group-normalized advantage real signal.

Run: python3 finetuning/rl/smoke_reward.py   (exits non-zero on any inversion)
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reward import score  # noqa: E402

PROMPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "prompts", "rl-prompts.tagalog.jsonl")

REFUSAL = ("Hindi ko po alam ang sagot diyan. Mas mabuti pong tanungin mo ang "
           "iyong guro tungkol diyan.")
HONEST_ABSTAIN = ("Hindi po ako sigurado diyan — wala iyon sa mga natutunan ko, "
                  "at ayokong magbigay ng maling sagot. Pero ang ganda ng tanong mo!")


def first_of_kind(kind, lang="tl"):
    # the tagalog prompt file now carries tl + en rows (English tier-1, 2026-06-11)
    with open(PROMPTS) as f:
        for line in f:
            row = json.loads(line)
            if row["kind"] == kind and row["lang"] == lang:
                # SAME merge train-grpo.py's to_row does: kind/lang/grade are
                # top-level in the generator's rows, but reward.py reads meta.
                for k in ("kind", "lang", "grade"):
                    row["meta"].setdefault(k, row.get(k))
                return row
    raise SystemExit(f"no row of kind {kind} lang {lang}")


def gold_sentence(meta):
    """Reconstruct a faithful answer from the row's own grounding block."""
    text = meta.get("grounding_text") or ""
    # block lines look like "- (topic) fact..."; take the first fact body
    for line in text.splitlines():
        m = re.match(r"^- \([^)]*\)\s*(.+)$", line)
        if m:
            return m.group(1)
    return text


def main():
    failures = []
    rows = []

    def pair(label, row, good, bad, min_gap=0.10):
        g, b = score(good, row["meta"]), score(bad, row["meta"])
        ok = g["total"] > b["total"] and (g["total"] - b["total"]) >= min_gap
        rows.append((label, g["total"], b["total"], g["total"] - b["total"], ok))
        if not ok:
            failures.append((label, g, b))

    # 1. grounded: faithful vs over-abstention (the gate's mustGround failure)
    r = first_of_kind("grounded")
    pair("grounded: faithful vs refusal", r, gold_sentence(r["meta"]), REFUSAL)

    # 2. distractor: gold-only vs gold + forbidden-sibling injection
    r = first_of_kind("distractor")
    forb = (r["meta"].get("forbidden_terms") or ["ribosome"])[0].split("|")[0]
    goldans = gold_sentence(r["meta"])
    pair("distractor: gold-only vs +injection", r, goldans,
         goldans + " Ito rin ay konektado sa " + forb + " na proseso.")

    # 3. abstain: honest vs fabricated specifics (digits, no forbidden term needed)
    r = first_of_kind("abstain")
    pair("abstain: honest vs fabricated", r, HONEST_ABSTAIN,
         "Ang sagot diyan ay 1,250 metro at natuklasan ito noong 1987 sa "
         "isang sikat na eksperimento.")

    # 4. chitchat: warm-brief vs science lecture nobody asked for
    r = first_of_kind("chitchat")
    pair("chitchat: warm vs lecturing", r,
         "Walang anuman! Masaya akong makatulong. May itatanong ka pa ba? 🌟",
         "Walang anuman! Alam mo ba, ang photosynthesis ay proseso kung saan "
         "ginagamit ng halaman ang liwanag ng araw, tubig, at carbon dioxide "
         "para gumawa ng glucose at oxygen sa mga dahon nito.")

    # 5. knowledge (Track-A/F4): answering from knowledge must BEAT parroting the
    #    mismatched grounding block and BEAT refusing. Build the "good" answer
    #    from the row's own required terms (a real answer would contain them).
    r = first_of_kind("knowledge")
    req_words = [t.split("|")[0].strip("() ") for t in
                 (r["meta"].get("required_terms") or [])]
    know_good = ("Magandang tanong! Ang sagot dito ay tungkol sa "
                 + ", ".join(req_words)
                 + ". Mahalagang malaman natin ito para sa ating kaligtasan.")
    pair("knowledge: answer vs parrot-block", r, know_good,
         gold_sentence(r["meta"]), min_gap=0.0)  # ordering only; parrot may score fair
    pair("knowledge: answer vs refusal", r, know_good, REFUSAL)

    # 6. trap (over-abstention counter): messy-but-answerable → answer beats refusal
    r = first_of_kind("trap")
    pair("trap: answer vs refusal", r, gold_sentence(r["meta"]), REFUSAL)

    # 7. english (tier-1, rides in the tagalog file): faithful EN answer must beat
    #    (a) a refusal and (b) the SAME facts delivered in Tagalog — the drift mode
    #    the 2026-06-11 capability A/B caught (en-abstain-weather answered in TL).
    r = first_of_kind("grounded", lang="en")
    en_good = gold_sentence(r["meta"])
    req_words = [t.split("|")[0].strip("() ") for t in
                 (r["meta"].get("required_terms") or [])]
    tl_drift = ("Ang sagot po diyan ay tungkol sa " + ", ".join(req_words)
                + ". Mahalagang malaman natin ito sa ating aralin sa science.")
    pair("en grounded: answer vs refusal", r, en_good, REFUSAL)
    pair("en grounded: EN answer vs Tagalog drift", r, en_good, tl_drift,
         min_gap=0.05)  # language is a 0.10-weight component; drift must still lose

    # 8. round-3 (2026-06-12): the r2 capability regressions as orderings
    # 8a. abstain: vague redirect must still beat a fabricated "answer" by a lot
    r = first_of_kind("abstain")
    vague = ("Ang ganda ng tanong mo! Pag-usapan na lang natin kung paano "
             "gumagana iyan sa pangkalahatan, gusto mo ba?")
    fabricated = ("Ayon sa pinakabagong datos, ang eksaktong sagot ay 47 at "
                  "ito ay natuklasan ni Doktor Reyes Santos noong 2019.")
    pair("abstain r3: vague redirect vs fabricated", r, vague, fabricated,
         min_gap=0.30)
    # 8b. grounded: finished answer vs the same answer cut mid-sentence
    r = first_of_kind("grounded")
    full = gold_sentence(r["meta"])
    cut = full[: int(len(full) * 0.7)].rstrip().rstrip(".!?…")
    pair("grounded r3: finished vs truncated", r, full, cut, min_gap=0.10)
    # 8c. grounded: clean prose vs markdown-dump degeneracy (headers + blanks)
    dump = "## Fact Recap\n" + full + "\nAng sagot ay _____ at *** iba pa."
    pair("grounded r3: clean vs md-dump", r, full, dump, min_gap=0.30)

    print(f"{'pair':45s} {'good':>6s} {'bad':>6s} {'gap':>6s}")
    for label, g, b, gap, ok in rows:
        flag = "OK " if ok else "FAIL"
        print(f"{flag} {label:42s} {g:6.2f} {b:6.2f} {gap:+6.2f}")

    if failures:
        print("\nINVERSIONS / thin gaps:")
        for label, g, b in failures:
            print(f"  {label}\n    good={g}\n    bad ={b}")
        sys.exit(1)
    print("\nall orderings correct")


if __name__ == "__main__":
    main()

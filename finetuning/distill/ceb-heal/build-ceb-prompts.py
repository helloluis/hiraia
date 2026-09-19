#!/usr/bin/env python3
"""
build-ceb-prompts.py — build the Cebuano-generation prompt set for the heal corpus.

EXPAND, don't translate: the fact bank is trilingual (fact.{tl,en,bis}, all verified).
For each fact we emit several format-varied prompts that ask Sailor2-20B-Chat to expand the
VERIFIED Cebuano (bis) fact into rich grade-school science Cebuano — grounded in the verified
fact so accuracy is guaranteed (accuracy > fluency). Diverse formats + the generator's
temperature give the diversity that avoids synthetic mode-collapse.

Output: one prompts.jsonl with a `shard` field (0..SHARDS-1) for data-parallel pods.
AUP: this reads/writes Cebuano body-science content but is processed by SCRIPT only —
never print fact.bis to a human/Claude context. Run it, read the COUNT, not the rows.

Usage:
  python build-ceb-prompts.py --bank ../../../rag/bank/science-facts.jsonl \
     --out prompts.jsonl --shards 8 --per-fact 12
"""
import argparse, json, hashlib, random, sys

# Cebuano pedagogy formats. Each is a (key, instruction) the model expands the verified fact into.
# Instructions are short Cebuano meta-prompts; {bis} = the verified Cebuano fact (the grounding),
# {grade} = target grade, {topic} = topic. Kept simple + grade-5-default tutor register.
FORMATS = [
    ("explain",   "Ipasabot kini nga konsepto sa yano ug klaro nga Cebuano para sa estudyante sa grade {grade}. Gamita ang inadlaw nga pinulongan."),
    ("analogy",   "Ipasabot kini gamit ang usa ka pananglitan o pagtandi gikan sa adlaw-adlaw nga kinabuhi sa Pilipinas, sa Cebuano, para sa grade {grade}."),
    ("qa",        "Paghimo og 3 ka pangutana ug tubag (Q&A) bahin niini nga hilisgutan sa Cebuano, angay para sa grade {grade}."),
    ("story",     "Pagsulat og mubo nga estorya o senaryo nga nagpasabot niini nga konsepto sa Cebuano para sa bata sa grade {grade}."),
    ("why",       "Tubaga ang 'Ngano?' ug 'Giunsa?' bahin niini nga hilisgutan sa Cebuano, sa lebel sa grade {grade}."),
    ("misconcept","Hisgoti ang usa ka sayop nga pagtuo bahin niini nga hilisgutan ug itul-id kini sa Cebuano para sa grade {grade}."),
    ("example",   "Paghatag og 2-3 ka konkretong pananglitan niini nga konsepto nga makita sa Pilipinas, sa Cebuano, para sa grade {grade}."),
    ("lesson",    "Pagsulat og mubo nga leksyon (2-3 ka parapo) bahin niini nga hilisgutan sa Cebuano para sa grade {grade}, lakip ang usa ka pananglitan."),
    ("define",    "Ipasabot ang mga importanteng termino niini nga hilisgutan sa Cebuano para sa grade {grade}."),
    ("apply",     "Unsaon paggamit niini nga kahibalo sa tinuod nga kinabuhi? Tubaga sa Cebuano para sa grade {grade}."),
]

SYSTEM = ("Ikaw usa ka mainiton ug tukma nga magtutudlo sa siyensya para sa mga bata sa elementarya sa "
          "Pilipinas. SULAT SA CEBUANO (BINISAYA) LAMANG — AYAW gyud paggamit og Tagalog. Pananglitan, "
          "gamita ang 'dili' (dili 'hindi'), 'kini' (dili 'ito'), 'unsa' (dili 'ano'), 'ug' (dili 'at'). "
          "Mahimong magamit ang Iningles nga teknikal nga termino (pananglitan: photosynthesis). Tukma "
          "ang imong kasayuran ug angay sa edad sa bata.")

def grade_of(grades):
    if isinstance(grades, list) and grades:
        return 5 if 5 in grades else grades[len(grades)//2]
    return 5

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", required=True)
    ap.add_argument("--out", default="prompts.jsonl")
    ap.add_argument("--shards", type=int, default=8)
    ap.add_argument("--per-fact", type=int, default=12, help="prompts per fact (cycles through FORMATS)")
    ap.add_argument("--seed", type=int, default=1234)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    n_in = n_out = 0
    by_shard = [0]*args.shards
    with open(args.bank, encoding="utf-8") as f, open(args.out, "w", encoding="utf-8") as o:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                fact = json.loads(line)
            except Exception:
                continue
            fb = fact.get("fact", {})
            bis = fb.get("bis") if isinstance(fb, dict) else None
            if not bis or len(bis) < 20:
                continue  # need a real verified Cebuano fact to ground on
            n_in += 1
            grade = grade_of(fact.get("grades"))
            topic = fact.get("topic", "")
            fid = fact.get("id") or hashlib.md5(bis.encode()).hexdigest()[:12]
            # pick per_fact distinct formats (cycle if per_fact > len(FORMATS))
            order = list(range(len(FORMATS)))
            rng.shuffle(order)
            for k in range(args.per_fact):
                key, instr = FORMATS[order[k % len(FORMATS)]]
                user = (f"Hilisgutan: {topic}\n"
                        f"Napamatud-an nga kamatuoran (gamita kini isip basihan, ayaw usba ang mga "
                        f"kamatuoran): «{bis}»\n\n"
                        f"{instr.format(grade=grade)}\n"
                        f"Isulat ang tubag sa Cebuano lamang.")
                pid = f"{fid}-{key}-{k}"
                shard = int(hashlib.md5(pid.encode()).hexdigest(), 16) % args.shards
                by_shard[shard] += 1
                o.write(json.dumps({
                    "pid": pid, "fact_id": fid, "domain": fact.get("domain"),
                    "grade": grade, "fmt": key, "shard": shard,
                    "messages": [{"role": "system", "content": SYSTEM},
                                 {"role": "user", "content": user}],
                }, ensure_ascii=False) + "\n")
                n_out += 1

    print(f"facts with verified bis: {n_in}")
    print(f"prompts written: {n_out}  ({args.per_fact}/fact) → {args.out}")
    print(f"per-shard: {by_shard}")
    print(f"est. output tokens @ ~420 tok/gen: ~{n_out*420/1e6:.0f}M")

if __name__ == "__main__":
    main()

#!/opt/homebrew/bin/python3
"""Shore up thin MATATAG topics by tagging existing DepEd-module / bank cards.

The first-pass audit left 35 competencies with <3 pool cards. Most of those
already have illustrated cards written from the matching DepEd modules; they
were sitting as deped: provenance (or globally excluded from a different code).
This pass adds MATATAG codes via curriculumTagOverrides, following
rag/bank/competency-kinds.json: 'use a labelled diagram' is presentation, the
science content is card-able.

Does not mint facts, rewrite card text, or relax format-required LCs onto
cards that do not teach the content. Dry-run default. --apply writes, then
run gen-curriculum-tags.mjs.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT / "rag/pipeline/cardsPool.app.json"
OVERRIDES = ROOT / "packages/mobile/src/data/curriculumTagOverrides.json"
EXCLUSIONS = ROOT / "packages/mobile/src/data/curriculumTagExclusions.json"
TAGS = ROOT / "packages/mobile/src/generated/curriculumTags.generated.json"
HAND = {"sleep-tiredness-builds-while-awake-g5"}
REVIEWER = "matatag-module-recovery"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# factId -> MATATAG codes to ensure. Existing MATATAG codes on the card are kept.
RECOVER: dict[str, list[str]] = {
    # G9-M-4 oxygen valence from periodic-table position
    "oxygen-s-six-electrons-g9": ["G9-M-4"],
    "oxygen-configuration-g8": ["G9-M-4"],
    "valence-electrons-by-group-g9": ["G9-M-4"],
    "oxygen-s-dot-diagram-g9": ["G9-M-4"],
    # G8-L-7 why humans are Mammalia + Primates
    "order-primates-g8": ["G8-L-7"],
    "shared-primate-traits-g8": ["G8-L-7"],
    "class-mammalia-traits-g8": ["G8-L-7"],
    "human-class-mammalia-g7": ["G8-L-7"],
    "forward-facing-eyes-g8": ["G8-L-7"],
    "primate-large-brains-g8": ["G8-L-7"],
    # G8-L-6 six-kingdom + three-domain
    "woese-s-big-discovery-g8": ["G8-L-6"],
    "three-domains-of-life-g8": ["G8-L-6"],
    "highest-ranks-of-life-g8": ["G8-L-6"],
    "five-kingdoms-not-fixed-six-g8": ["G8-L-6"],
    # G7-F-3 free-body diagrams
    "free-body-diagram-of-a-book-g7": ["G7-F-3"],
    "free-body-diagram-of-a-falling-fruit-g7": ["G7-F-3"],
    "why-free-body-diagrams-g7": ["G7-F-3"],
    "drawing-free-body-diagrams-g7": ["G7-F-3"],
    # G9-M-9 ionic crystals vs covalent molecules
    "covalent-molecules-g9": ["G9-M-9"],
    "ions-in-salt-crystals-g9": ["G9-M-9"],
    "ionic-crystal-lattice-g9": ["G9-M-9"],
    "bonds-in-different-crystals-g9": ["G9-M-9"],
    # G9-L-1 double helix
    "dna-double-helix-shape-g8": ["G9-L-1"],
    "dna-shape-double-helix-g8": ["G9-L-1"],
    "dna-shape-double-helix-g7": ["G9-L-1"],
    "dna-twisted-ladder-g10": ["G9-L-1"],
    "dna-structure-watson-crick-g8": ["G9-L-1"],
    "sugar-phosphate-backbone-g9": ["G9-L-1"],
    # G7-L-8 cells → biosphere
    "levels-of-organization-g7": ["G7-L-8"],
    "order-of-biological-levels-g7": ["G7-L-8"],
    "ladder-of-life-g7": ["G7-L-8"],
    "biosphere-largest-level-g7": ["G7-L-8"],
    "levels-of-biological-organization-g7": ["G7-L-8"],
    "largest-levels-of-life-g7": ["G7-L-8"],
    # G8-L-1 food through the digestive tract
    "digestion-path-simple-g4": ["G8-L-1"],
    "digestive-system-order-g6": ["G8-L-1"],
    "digestive-system-organs-g4": ["G8-L-1"],
    "ingestion-begins-g8": ["G8-L-1"],
    # G8-L-8 plants/animals in C/O/H2O cycles
    "oxygen-cycle-photosynthesis-g8": ["G8-L-8"],
    "fwg2-carbon-cycle-photosynthesis-2987": ["G8-L-8"],
    "fwg2-carbon-cycle-photosynthesis-2286": ["G8-L-8"],
    "biogeochemical-cycles-g8": ["G8-L-8"],
    # G4-L-3 / G4-L-4 habitats
    "three-kinds-of-homes-g4": ["G4-L-3"],
    "habitats-in-the-air-g4": ["G4-L-3"],
    "homes-in-the-air-g4": ["G4-L-3"],
    "salty-water-habitats-g4": ["G4-L-3"],
    "plants-in-a-garden-g4": ["G4-L-4"],
    "mangrove-biodiversity-home-g6": ["G4-L-4"],
    "ph-horn-frog-rice-field-g4": ["G4-L-4"],
    "mangrove-fish-link-to-reef-g7": ["G4-L-4"],
    # G4-L-5 life-cycle stages
    "grasshopper-life-cycle-g4": ["G4-L-5"],
    "comparing-life-cycles-g4": ["G4-L-5"],
    "human-life-cycle-stages-g4": ["G4-L-5"],
    "butterfly-egg-stage-g4": ["G4-L-5"],
    # G4-L-7 PH food chain
    "rice-field-chain-g4": ["G4-L-7"],
    "people-part-of-food-chain-g5": ["G4-L-7"],
    "carnivore-meat-apex-top-g6": ["G4-L-7"],
    # G5-L-4 classification groups
    "flowering-nonflowering-plants-g7": ["G5-L-4"],
    "why-classify-animals-g5": ["G5-L-4"],
    "mammary-glands-g5": ["G5-L-4"],
    "two-life-stages-g5": ["G5-L-4"],
    "legs-that-bend-g5": ["G5-L-4"],
    # G5-E-3 classify rocks
    "three-rock-types-g5": ["G5-E-3"],
    "igneous-rock-features-g5": ["G5-E-3"],
    "sedimentary-rock-features-g5": ["G5-E-3"],
    "dichotomous-key-branching-g7": ["G5-E-3"],
    # G5-E-7 water-cycle model
    "four-stages-of-the-water-cycle-g5": ["G5-E-7", "G8-L-8"],
    "sunlight-affects-the-cycle-g5": ["G5-E-7"],
    "water-cycle-evap-condense-g5": ["G5-E-7"],
    # G6-L-3 fair test of propagation (method)
    "fair-test-basics-g6": ["G6-L-3"],
    "replication-in-experiments-g6": ["G6-L-3"],
    "three-trials-g6": ["G6-L-3"],
    # G6-F-8 wave models
    "slinky-wave-example-g7": ["G6-F-8"],
    "rope-transverse-waves-g6": ["G6-F-8"],
    "jump-rope-wave-g6": ["G6-F-8"],
    # G5-F-2 friction vs surfaces (method / result)
    "friction-racing-g5": ["G5-F-2"],
    "surface-area-and-friction-g5": ["G5-F-2"],
    "child-slips-on-tiles-g5": ["G5-F-2"],
    # G8-L-11 photosynthesis investigation (method)
    "testing-for-starch-g8": ["G8-L-11"],
    "darkness-reduces-starch-g8": ["G8-L-11"],
    "btb-color-change-g8": ["G8-L-11"],
    # G8-E-8 typhoon tracking (method)
    "tracking-a-typhoon-g8": ["G8-E-8"],
    "computer-forecast-models-g8": ["G8-E-8"],
    "typhoon-par-definition-g5": ["G8-E-8"],
    "weather-satellite-watches-typhoon-g6": ["G8-E-8"],
    # G9-E-2 PH plate-boundary evidence
    "two-plates-meet-philippines-g8": ["G9-E-2"],
    "philippine-trench-subduction-g9": ["G9-E-2"],
    "philippine-trench-location-g7": ["G9-E-2"],
    "fwg2-gravity-1660": ["G9-E-2"],
    # G9-E-8 Earth-layer scale
    "earth-four-layers-g6": ["G9-E-8"],
    "earth-four-main-layers-g5": ["G9-E-8"],
    "the-mantle-g8": ["G9-E-8"],
    # G10-E-4 PH in 50 Myr from plate velocity — already 2; add method-ish
    "seafloor-spreading-rate-g10": ["G10-E-4"],
    # G10-F-3 elastic/inelastic collisions (content of the model investigation)
    "elastic-collision-g10": ["G10-F-3"],
    "inelastic-collision-g10": ["G10-F-3"],
    "billiard-balls-collision-g10": ["G10-F-3"],
    "toy-car-and-clay-g10": ["G10-F-3"],
    "sticking-together-g10": ["G10-F-3"],
    # G10-L-9 biotech implications (content half of the debate)
    "agricultural-biotechnology-g10": ["G10-L-9"],
    "environmental-biotechnology-g10": ["G10-L-9"],
    "gmo-meaning-g9": ["G10-L-9"],
    "golden-rice-vitamin-a-g10": ["G10-L-9"],
    # G8-L-2 systems working together
    "teamwork-of-systems-g10": ["G8-L-2"],
    "muscles-and-bones-together-g6": ["G8-L-2"],
    "keeping-balance-g9": ["G8-L-2"],
    "when-systems-fail-g7": ["G8-L-2"],
    # G3-L-1 observing / predicting / measuring
    "observing-skill-g3": ["G3-L-1"],
    "measuring-skill-g3": ["G3-L-1"],
    "predicting-from-patterns-g3": ["G3-L-1"],
    "observing-with-senses-g3": ["G3-L-1"],
    # G3-F-3 position change
    "fme-motion-g4": ["G3-F-3"],
    "left-or-right-movement-g3": ["G3-F-3"],
    "conditions-of-motion-g7": ["G3-F-3"],
    "motion-is-a-change-in-position-g4": ["G3-F-3"],
    # G4-F-1 move / change shape of objects
    "force-changes-shape-g4": ["G4-F-1"],
    "spring-coil-spring-tension-compression-g5": ["G4-F-1"],
    # G7-M-6 investigation steps
    "sequential-scientific-investigation-g7": ["G7-M-6"],
    "the-aim-or-problem-g7": ["G7-M-6"],
    "method-or-procedure-g7": ["G7-M-6"],
    "the-conclusion-g7": ["G7-M-6"],
    # G7-M-7 accurate measurements
    "measuring-correctly-g4": ["G7-M-7"],
    "accurate-measurements-g6": ["G7-M-7"],
    "expressing-measurements-with-units-g7": ["G7-M-7"],
    # G9-L-9 biotic/abiotic of named ecosystems
    "coral-reef-needs-clean-warm-water-g6": ["G9-L-9"],
    "rainforest-canopy-dark-floor-g6": ["G9-L-9"],
    "mangroves-as-shelter-g5": ["G9-L-9"],
    "biotic-and-abiotic-factors-g7": ["G9-L-9"],
    # G4-M-7 / G9-L-11 guided surveys of environmental issues
    "steps-of-a-survey-g4": ["G4-M-7"],
    "surveys-for-the-environment-g4": ["G4-M-7", "G9-L-11"],
    "surveying-the-environment-g4": ["G4-M-7", "G9-L-11"],
    "mitigation-plans-g9": ["G9-L-11"],
    "what-is-a-mitigation-plan-g9": ["G9-L-11"],
    "helping-ecosystems-g8": ["G9-L-11"],
}


def matatag_codes(row) -> list[str]:
    if not row:
        return []
    codes = row[5] if len(row) > 5 else [row[0]]
    return [c for c in codes if isinstance(c, str) and c.startswith("G")]


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args(argv)

    pool = json.loads(POOL.read_text())["cards"]
    by_fid: dict[str, list] = {}
    for c in pool:
        by_fid.setdefault(c["factId"], []).append(c)
    tags = json.loads(TAGS.read_text())
    ovdoc = json.loads(OVERRIDES.read_text())
    overrides = ovdoc["factoids"]
    exclusions = json.loads(EXCLUSIONS.read_text())

    missing = [fid for fid in RECOVER if fid not in by_fid]
    if missing:
        print(f"missing factIds ({len(missing)}): {missing[:20]}")

    added = 0
    lifted = 0
    merged = 0
    skipped_hand = 0
    for fid, extra in RECOVER.items():
        if fid not in by_fid:
            continue
        if fid in HAND:
            skipped_hand += 1
            continue
        cards = by_fid[fid]
        existing = []
        if fid in overrides:
            existing = list(overrides[fid].get("codes") or [])
        else:
            for c in cards:
                existing.extend(matatag_codes(tags.get(c["id"])))
        codes = list(dict.fromkeys([*existing, *extra]))
        prev = overrides.get(fid)
        if prev and prev.get("codes") == codes:
            continue
        if prev:
            merged += 1
        else:
            added += 1
        overrides[fid] = {
            "id": cards[0]["id"],
            "codes": codes,
            "disposition": "correct",
            "reviewer": REVIEWER,
            "reviewed_at": NOW,
            "notes": f"thin-topic recovery from DepEd/MATATAG module cards; added {extra}",
        }
        if fid in exclusions:
            del exclusions[fid]
            lifted += 1

    print(
        f"recoveries {len(RECOVER)}  new_overrides={added} merged={merged} "
        f"exclusions_lifted={lifted} missing={len(missing)} hand_skipped={skipped_hand}"
    )
    if not args.apply:
        print("dry-run; pass --apply to write")
        return
    ovdoc["factoids"] = dict(sorted(overrides.items()))
    OVERRIDES.write_text(json.dumps(ovdoc, indent=2, ensure_ascii=False) + "\n")
    EXCLUSIONS.write_text(json.dumps(exclusions, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OVERRIDES.relative_to(ROOT)}")
    print(f"wrote {EXCLUSIONS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

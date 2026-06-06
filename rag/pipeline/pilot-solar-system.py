#!/usr/bin/env python3
"""
Phase-1 PILOT: the solar-system slice (closes the Uranus gap that started this).
Demonstrates the pipeline: facts authored per the GENERATION-BRIEF (trilingual,
on-schema, terms packed with TL+BIS+EN keywords), validated, then appended to the
bank. Run once; re-running is guarded by id-dedup against the live bank.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BANK = os.path.join(ROOT, "rag/bank/science-facts.jsonl")

def f(id, topic, grades, tl, en, bis, terms, source):
    return {"id": id, "domain": "EARTH_SPACE", "topic": topic, "grades": grades,
            "terms": terms, "fact": {"tl": tl, "en": en, "bis": bis},
            "source": source, "generator": "claude", "reviewed": False}

FACTS = [
 f("mercury-planet-g5","the planet Mercury",[4,5,6],
   "Ang Mercury ang pinakamaliit na planeta at pinakamalapit sa Araw; halos walang hangin dito kaya napakainit kapag araw at napakalamig kapag gabi.",
   "Mercury is the smallest planet and the closest to the Sun; it has almost no air, so it is scorching by day and freezing at night.",
   "Ang Mercury mao ang pinakagamay nga planeta ug pinakaduol sa Adlaw; halos walay hangin busa init kaayo kon adlaw ug bugnaw kaayo kon gabii.",
   ["Mercury","Mercurio","planeta","pinakamaliit","pinakagamay","pinakamalapit","pinakaduol","araw","adlaw","smallest","closest","sun"],
   "NASA Solar System; DepEd G5 Q4"),
 f("mercury-shortest-year-g6","Mercury has the shortest year",[6,7],
   "Ang Mercury ay umiikot sa Araw nang mas mabilis kaysa ibang planeta, tinatapos ang isang buong taon sa loob lamang ng 88 araw sa Earth.",
   "Mercury races around the Sun faster than any other planet, finishing a whole year in just 88 Earth days.",
   "Ang Mercury molibot sa Adlaw nga mas paspas kaysa ubang planeta, nahuman ang usa ka tuig sa 88 lang ka adlaw sa Yuta.",
   ["Mercury","Mercurio","taon","tuig","year","mabilis","paspas","orbit","umiikot","molibot"],
   "NASA Solar System"),
 f("venus-planet-g5","the planet Venus",[5,6],
   "Ang Venus ay halos kasinlaki ng Earth ngunit ito ang pinakamainit na planeta, nababalot ng makapal na ulap na humuhuli sa init ng Araw.",
   "Venus is about the same size as Earth but it is the hottest planet, wrapped in thick clouds that trap the Sun's heat.",
   "Ang Venus halos sama kadako sa Yuta apan kini ang pinakainit nga planeta, giputos sa baga nga panganod nga nagbitbit sa kainit sa Adlaw.",
   ["Venus","planeta","pinakamainit","pinakainit","mainit","ulap","panganod","hottest","clouds","Earth","Yuta"],
   "NASA; DepEd G6 (why Venus is hottest)"),
 f("earth-the-planet-g5","Earth as a planet",[4,5],
   "Ang Earth ang tanging planetang alam nating may buhay, may tubig na likido sa ibabaw at hanging nakakahinga natin.",
   "Earth is the only planet we know of that has life, with liquid water on its surface and air we can breathe.",
   "Ang Yuta mao ra ang planeta nga atong nahibal-an nga adunay kinabuhi, naay likido nga tubig sa ibabaw ug hangin nga atong maginhawa.",
   ["Earth","Yuta","Daigdig","planeta","buhay","kinabuhi","tubig","tubig","hangin","life","water","air"],
   "NRC ESS1.B; DepEd G5"),
 f("mars-planet-features-g5","features of Mars",[5,6],
   "Ang Mars ay may pinakamataas na bulkan sa solar system, dalawang maliliit na buwan, at mga yelong takip sa magkabilang poste nito.",
   "Mars has the tallest volcano in the solar system, two tiny moons, and frozen ice caps at its poles.",
   "Ang Mars adunay pinakahabog nga bolkan sa solar system, duha ka gagmay nga bulan, ug yelo nga taklob sa iyang mga poste.",
   ["Mars","Marte","planeta","bulkan","bolkan","buwan","bulan","yelo","ice","volcano","moons"],
   "NASA Mars exploration"),
 f("jupiter-planet-g5","the planet Jupiter",[5,6],
   "Ang Jupiter ang pinakamalaking planeta — isang higanteng bola ng gas na napakalaki kaya kasya rito ang lahat ng ibang planeta.",
   "Jupiter is the largest planet — a giant ball of gas so big that all the other planets could fit inside it.",
   "Ang Jupiter mao ang pinakadako nga planeta — usa ka higante nga bola sa gas nga dako kaayo nga mahaom ang tanang ubang planeta sulod niini.",
   ["Jupiter","planeta","pinakamalaki","pinakadako","gas","higante","largest","giant","gas giant"],
   "NASA; DepEd G5"),
 f("jupiter-great-red-spot-g6","Jupiter's Great Red Spot",[6,7],
   "Ang Great Red Spot ng Jupiter ay isang higanteng bagyo na mas malaki pa sa buong Earth at umiikot na nang daan-daang taon.",
   "Jupiter's Great Red Spot is a giant storm bigger than the whole Earth that has been swirling for hundreds of years.",
   "Ang Great Red Spot sa Jupiter usa ka higante nga bagyo nga mas dako pa sa tibuok Yuta nga nagtuyok na sulod sa gatusan ka tuig.",
   ["Jupiter","Great Red Spot","bagyo","unos","bagyo","storm","higante","Earth","Yuta"],
   "NASA Juno mission"),
 f("saturn-rings-density-g6","Saturn's rings and lightness",[5,6],
   "Ang maliliwanag na singsing ng Saturn ay gawa sa di-mabilang na piraso ng yelo at bato; napakagaan ng planeta kaya lulutang ito sa tubig.",
   "Saturn's bright rings are made of countless chunks of ice and rock; the planet is so light it would float in water.",
   "Ang masanag nga mga singsing sa Saturn hinimo sa dili maihap nga tipik sa yelo ug bato; gaan kaayo ang planeta maong molutaw kini sa tubig.",
   ["Saturn","Saturno","singsing","rings","yelo","ice","bato","lutang","molutaw","float","gaan"],
   "NASA Cassini mission"),
 f("uranus-planet-g5","the planet Uranus",[5,6],
   "Ang Uranus ay isang ice giant na kulay asul-berde dahil sa methane na gas sa hangin nito; isa ito sa pinakamalamig na planeta.",
   "Uranus is an ice giant that looks blue-green because of the methane gas in its air; it is one of the coldest planets.",
   "Ang Uranus usa ka ice giant nga asul-berde og kolor tungod sa methane nga gas sa iyang hangin; usa kini sa pinakabugnaw nga planeta.",
   ["Uranus","planeta","ice giant","asul","berde","asul","methane","pinakamalamig","pinakabugnaw","bugnaw","blue","cold"],
   "NASA; Voyager 2"),
 f("uranus-tilt-g6","Uranus is tilted on its side",[6,7],
   "Ang Uranus ay nakatagilid nang husto, kaya tila gumugulong ito sa paligid ng Araw na parang bola sa halip na tumayong tuwid.",
   "Uranus is tipped over on its side, so it seems to roll around the Sun like a ball instead of spinning upright.",
   "Ang Uranus nakahapay sa iyang kilid, mao nga morag nagligid kini libot sa Adlaw sama sa bola imbis nga magtindog og tul-id.",
   ["Uranus","nakatagilid","nakahapay","tilt","gumugulong","nagligid","roll","kilid","side"],
   "NASA"),
 f("neptune-planet-g5","the planet Neptune",[5,6],
   "Ang Neptune ang pinakamalayong planeta mula sa Araw, isang malalim ang asul na ice giant kung saan madilim at sobrang lamig.",
   "Neptune is the farthest planet from the Sun, a deep-blue ice giant where it is dark and extremely cold.",
   "Ang Neptune mao ang pinakalayo nga planeta gikan sa Adlaw, usa ka lawom og asul nga ice giant nga ngitngit ug bugnaw kaayo.",
   ["Neptune","Neptuno","planeta","pinakamalayo","pinakalayo","asul","ice giant","madilim","ngitngit","farthest","blue"],
   "NASA; Voyager 2"),
 f("neptune-winds-g6","Neptune's strong winds",[6,7],
   "Ang Neptune ay may pinakamalakas na hangin sa lahat ng planeta, na umiihip nang mas mabilis pa sa bilis ng tunog.",
   "Neptune has the strongest winds of any planet, blowing faster than the speed of sound.",
   "Ang Neptune adunay pinakakusog nga hangin sa tanang planeta, nga mohuros nga mas paspas pa sa katulin sa tingog.",
   ["Neptune","Neptuno","hangin","winds","pinakamalakas","pinakakusog","tunog","tingog","sound"],
   "NASA"),
 f("rocky-vs-giant-planets-g6","rocky planets vs gas and ice giants",[6,7],
   "Ang apat na panloob na planeta (Mercury, Venus, Earth, Mars) ay maliliit at batuhin, samantalang ang apat na panlabas na planeta ay malalaking bola ng gas at yelo.",
   "The four inner planets (Mercury, Venus, Earth, Mars) are small and rocky, while the four outer planets are huge balls of gas and ice.",
   "Ang upat ka sulod nga planeta (Mercury, Venus, Earth, Mars) gagmay ug batoon, samtang ang upat ka gawas nga planeta dagko nga bola sa gas ug yelo.",
   ["rocky","batuhin","batoon","gas","yelo","ice","inner","outer","panloob","panlabas","terrestrial","giant"],
   "NRC ESS1.B"),
 f("why-planets-orbit-sun-g5","why planets orbit the Sun",[5,6],
   "Ang malakas na grabidad ng Araw ang humahawak sa walong planeta sa kanilang landas, hinihila sila para umikot sa paligid nito sa halip na lumipad palayo.",
   "The Sun's strong gravity holds all eight planets in their paths, pulling them so they circle around it instead of flying away.",
   "Ang kusog nga grabidad sa Adlaw maoy nagkupot sa walo ka planeta sa ilang agianan, gibira sila aron molibot niini imbis molupad palayo.",
   ["orbit","grabidad","gravity","Araw","Adlaw","umiikot","molibot","planeta","landas","agianan"],
   "NRC PS2.B"),
 f("planet-moons-count-g6","planets have different numbers of moons",[6,7],
   "Ang Earth ay may isang buwan, ngunit ang mga higanteng planeta ay may dose-dosena — ang Jupiter at Saturn ay may tig-mahigit 90 na kilalang buwan.",
   "Earth has one moon, but the giant planets have dozens — Jupiter and Saturn each have more than 90 known moons.",
   "Ang Yuta adunay usa ka bulan, apan ang higante nga mga planeta adunay dose-dosena — ang Jupiter ug Saturn matag-usa adunay kapin 90 ka nailhan nga bulan.",
   ["moons","buwan","bulan","Jupiter","Saturn","Earth","Yuta","marami","daghan","many"],
   "NASA moon counts"),
 f("asteroid-belt-g6","the asteroid belt",[6,7],
   "Sa pagitan ng Mars at Jupiter ay ang asteroid belt, isang malapad na singsing ng batuhing tira mula noong nabuo ang mga planeta.",
   "Between Mars and Jupiter lies the asteroid belt, a wide ring of rocky leftovers from when the planets formed.",
   "Sa tunga-tunga sa Mars ug Jupiter mao ang asteroid belt, usa ka lapad nga singsing sa batoon nga salin sukad natukod ang mga planeta.",
   ["asteroid","asteroid belt","bato","batuhin","batoon","Mars","Jupiter","singsing","rocky"],
   "NASA"),
]

# ---- validate ----
existing = {json.loads(l)["id"] for l in open(BANK)}
errs, new = [], []
seen = set()
for x in FACTS:
    fid = x["id"]
    if fid in existing: errs.append(f"dup-vs-bank: {fid}"); continue
    if fid in seen: errs.append(f"dup-in-batch: {fid}"); continue
    seen.add(fid)
    for k in ("tl","en","bis"):
        if not x["fact"].get(k) or len(x["fact"][k]) < 10: errs.append(f"{fid}: missing/short {k}")
    if len(x["terms"]) < 4: errs.append(f"{fid}: too few terms")
    new.append(x)

if errs:
    print("VALIDATION ERRORS:"); [print("  -",e) for e in errs]
    if "--force" not in sys.argv: sys.exit(1)

if "--write" in sys.argv:
    with open(BANK, "a") as fh:
        for x in new: fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    print(f"appended {len(new)} facts -> {BANK}")
else:
    print(f"DRY RUN ok: {len(new)} valid new facts (pass --write to append)")

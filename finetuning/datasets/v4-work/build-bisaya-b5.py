#!/usr/bin/env python3
"""Assemble bisaya-b5.jsonl (Family B, set 5 — 10 physics-exact dialogues, Cebuano).

Mirror of build-tagalog-b5.py: same fact ids, splits, and tag descs.
The probe-adjacent physics this batch must land EXACTLY:
  - gravity exists in space; astronauts float because of FREE FALL (rows 1, 4)
  - moon gravity ~1/6 of Earth's (row 2)
  - heavy and light fall together without air resistance (row 3)
  - moon phases are NOT the Earth's shadow (rows 5, 6)
  - breathing brings oxygen to release energy from food fuel (rows 7, 8)
  - evaporation happens at any temperature, surface only; boiling is 100C
    throughout the liquid (rows 9, 10)
Mixed 4- and 6-message rows; grounding only in the FINAL user turn; plain rows
4 and 8; 3 rows end with a fitting [image:] tag (1, 5, 9).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-b5.jsonl")

bank = {}
for line in open(BANK):
    r = json.loads(line)
    bank[r["id"]] = (r["topic"], r["fact"]["bis"])

G_HEAD = "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):"
G_TAIL = ("When the question is answered by the facts above, base your explanation on them "
          "and do not contradict them. Still teach in your own words at the student's level "
          "— do not just copy the fact. If the facts above do not cover the question, answer "
          "carefully from general knowledge and say so if you are unsure.")

def grounded(fact_ids, msg):
    if not fact_ids:
        return msg
    lines = "\n".join(f"- ({bank[i][0]}) {bank[i][1]}" for i in fact_ids)
    return f"{G_HEAD}\n{lines}\n\n{G_TAIL}\n\n{msg}"

# (grade, [messages alternating user/assistant], [fact ids for the FINAL user turn])
ROWS = [
    # 1 — gravity EXISTS in space; floating = free fall (4 msg, tag)
    ("6", [
     "Tinuod ba nga walay gravity sa kawanangan? Mao ba nga naglutaw ang mga astronaut?",
     "Kana ang usa sa pinakasikat nga sayop nga pagtuo sa siyensiya — NAAY gravity sa kawanangan! Ang gravity sa Earth moabot sa layo kaayo; sa gihabogon mismo sa space station, halos sama pa gihapon kini kakusog sa imong mabati dinhi. Kung walay gravity didto, dugay na unta nga milupad palayo ang bulan ug ang mga satellite.",
     "Apan kung naa man diay gravity didto, nganong naglutaw man ang mga astronaut?",
     "Tungod kay padayon silang NAHULOG — free fall ang tawag niini! Ang astronaut ug ang iyang spacecraft parehong walay hunong nga nagkahulog palibot sa Earth nga dungan. Tungod kay dungan silang nahulog, walay salog nga moduso pataas sa astronaut — mao nga ang iyang pamati walay siyay gibug-aton ug naglutaw siya. Wala mawala ang gravity; kini mismo ang nagbira kanila mao nga naglibot sila sa Earth!\n\n[image: An astronaut in a bulky spacesuit and rounded helmet floating with arms out in space.]",
    ], ["faq-why-astronauts-float"]),
    # 2 — moon gravity 1/6 (4 msg)
    ("6", [
     "Nakita nako sa video, taas kaayo molukso ang mga astronaut sa bulan bisan baga kaayo ang ilang suit. Ngano man?",
     "Maayo ang imong namatikdan, kay dinhi sa Earth, ang kabug-at sa maong space suit morag nagpas-an ka og usa pa ka tawo! Ang tubag: lahi nga kalibutan, lahi nga kakusog sa bira. Ang bulan mas gamay kaysa Earth, mao nga mas huyang ang gravity niini — mas huyang ang pagbira niini paubos sa mga astronaut.",
     "Unsa man kahuyang ang gravity sa bulan?",
     "Mga un-sexto (1/6) lamang sa gravity sa Earth! Buot ipasabot, mga unom ka beses ka nga mas gaan didto: kung ang imong timbang dinhi 30 kilos, morag 5 kilos lang ang imong pamati sa bulan. Mao nga bisan nagsul-ob sa bug-at nga space suit, makalukso gihapon sila og mas taas ug morag naglukso-lukso sila sa paglakaw — ang matag lakang nila morag lukso sa trampoline.",
    ], ["val-gravity-moon", "moon-gravity-one-sixth-g6"]),
    # 3 — heavy and light fall at the same rate (6 msg)
    ("6", [
     "Kung dungan nako nga ihulog ang bug-at ug gaan nga butang, asa man ang unang matagak?",
     "Makapakurat ang tubag: kung walay hangin nga mobabag, DUNGAN silang matagak! Parehas ang kapaspas sa pagkahulog sa tanang butang tungod kay parehas silang gibira sa gravity nga may parehas nga kapaspas sa pagpaspas. Ang hangin lang ang hinungdan ngano nga lahi-lahi usahay ang ilang pag-abot sa yuta.",
     "Apan gisulayan na nako — dungan nako nga gihulog ang libro ug papel, una gyud nga natagak ang libro!",
     "Sakto ang imong eksperimento, ug tinuod ang imong nakita! Ang papel lapad ug gaan, mao nga ang hangin sa ilalom niini morag unlan nga moduso pabalik — air resistance ang tawag. Ania ang sunod nga eksperimento: kumoa ang mao ra nga papel hangtod mahimong hugot nga bola, unya ihulog kini pag-usab dungan sa libro. Halos dungan na silang matagak — parehas ra gihapon ang gibug-aton sa papel, apan gamay na lang ang mapugos sa hangin!",
     "Naa bay lugar diin tinuod gyud nga dungan matagak ang tanan?",
     "Naa — bisan asang lugar nga walay hangin! Sa bulan, gisulayan kini mismo sa astronaut nga si David Scott niadtong 1971: dungan niyang gihulog ang martilyo ug ang balhibo sa langgam. Sa Earth, ang balhibo maglutaw-lutaw sa hangin samtang ang martilyo diretsong molagpak. Apan sa bulan nga walay hangin? Dungan gyud kaayo silang midunggo sa yuta — atubangan sa kamera! Napamatud-an niini nga ang gravity patas nga mobira sa gaan ug bug-at.",
    ], ["free-fall-same-rate-g6"]),
    # 4 — the ISS is falling around Earth (4 msg, PLAIN)
    ("5", [
     "Ngano man nga dili matagak sa Earth ang space station? Naa ra man kini kanunay sa ibabaw.",
     "Ania ang sekreto: nagkahulog gyud kini — WALA gyud kini mohunong sa pagkahulog! Apan samtang nahulog kini paubos, naglihok usab kini patakilid sa hilabihan ka paspas — mga walo ka kilometro matag segundo. Tungod kay lingin ang Earth, samtang nahulog ang istasyon, ang yuta sa ilalom niini 'moliko' palayo. Morag nahulog kini nga dili makaigo sa yuta — libot-libot. Kana mismo ang buot ipasabot sa orbit!",
     "Mao diay nga naglutaw ang mga astronaut sa sulod — kauban diay silang nahulog sa istasyon!",
     "Nakuha na nimo ang tibuok hulagway! Ang istasyon, ang mga astronaut, ang ilang pagkaon, ang ilang bolpen — silang tanan dungan nga nagkahulog palibot sa Earth. Kung dungan kamong nahulog sa imong gisakyan, walay salog nga moduso sa imong lapalapa, mao nga ang imong pamati wala kay timbang. Hinumdomi: dili tungod kay nawala ang gravity — buhi kaayo kini ug kini pa gani ang nagpalibot kanila — kondili tungod sa walay hunong nga dungan nga pagkahulog: ang free fall.",
    ], []),
    # 5 — moon phases are NOT Earth's shadow (6 msg, tag)
    ("4", [
     "Ngano man nga usahay katunga o kurbado ra ang bulan sa langit?",
     "Ang bulan kanunay nga tibuok lingin nga bola — dili gyud kini mag-usab og porma! Ang katunga sa bulan kanunay nga nahayagan sa Adlaw, sama sa katunga sa bola nga nasidlakan sa suga. Samtang naglibot ang bulan sa Earth, lahi-lahi ang anggulo sa atong pagtan-aw, mao nga usahay makita nato ang tibuok hayag nga nawong (takdol), usahay katunga lang, ug usahay halos wala (bag-ong bulan). Phases sa bulan ang tawag niana.",
     "Abi nako'g anino sa Earth ang nagtabon sa bulan mao nga nahimong kurbado kini.",
     "Daghan ang nagtuo niana, apan dili kana ang hinungdan! Ang ngitngit nga bahin sa kurbado nga bulan mao ang kaugalingon niini nga kilid nga nagtalikod sa Adlaw — ang 'gabii' sa bulan mismo, dili anino sa atong planeta. Pruweba: kung katunga ang bulan, ang Adlaw, Earth, ug bulan wala gani magkalinya sa paagi nga maigo sa atong anino ang bulan. Ang anino sa Earth moigo sa bulan sa usa lang ka espesyal nga higayon — ug naa kini kaugalingong ngalan.",
     "Unsa man kanang espesyal nga higayon?",
     "Ang lunar eclipse! Mahitabo kini kung eksaktong magkalinya ang Adlaw, ang Earth, ug ang bulan — ang Earth ang naa sa tunga, mao nga ang atong anino moigo sa takdol nga bulan ug hinay-hinay kining mongitngit, usahay mamula pa. Talagsa ra kini mahitabo ug pipila lang ka oras molungtad. Ang phases pud makita nimo matag bulan, matag gabii ang kausaban — usa ka tibuok libot gikan sa bag-ong bulan hangtod sa takdol ug pabalik.\n\n[image: The eight phases of the Moon shown in a row from new moon to full moon and back.]",
    ], ["earth-eclipses-g6"]),
    # 6 — solar vs lunar eclipse + eye safety (4 msg)
    ("7", [
     "Unsa man ang kalainan sa solar eclipse ug lunar eclipse?",
     "Parehong paglinya sa Adlaw, bulan, ug Earth — ang kalainan mao kung KINSA ang naa sa tunga! Solar eclipse: ang BULAN ang naa sa tunga, moagi kini sa taliwala sa Adlaw ug Earth mao nga matabonan niini ang Adlaw — mahitabo kini sa buntag o udto. Lunar eclipse: ang EARTH ang naa sa tunga, mao nga ang atong anino ang moigo sa bulan — makita kini sa gabii, matag takdol sa bulan.",
     "Kung naay solar eclipse, mahimo ba nako kining tan-awon nga diretso? Kadiyot ra man.",
     "DILI — bisan usa ka pagpamilok, bisan hapit na mahuman ang eclipse! Ang diretsong pagtan-aw sa Adlaw kayang modaot sa imong mata sa walay katapusan, ug dili nimo mabati nga nasakitan kini samtang nahitabo. Kinahanglan og espesyal nga eclipse glasses nga adunay sertipikadong filter — dili igo ang sunglasses, x-ray film, o kolorado nga bildo. Ang lunar eclipse pud luwas nga tutokan sa tibuok gabii: bulan ra man kana nga nangitngitan, walay peligro sa mata.",
    ], ["solar-eclipse-new-moon-g7", "never-look-at-sun-eclipse-g5"]),
    # 7 — why we breathe: oxygen releases energy from food (4 msg)
    ("5", [
     "Ngano man gud nga moginhawa kita? Para asa man gyud ang hangin sa lawas?",
     "Moginhawa kita aron mokuha og oxygen — ug ang oxygen adunay usa ka importante kaayo nga misyon: buhian ang enerhiya nga natago sa imong gikaon! Ang pagkaon morag sugnod nga puno sa tinipig nga enerhiya, apan dili kini magamit sa lawas nga basta-basta. Sa sulod sa matag gamay nimo nga cell, ang oxygen ang yawe nga mobuhi sa maong enerhiya aron makalihok, makahunahuna, ug magpabilin nga init ang imong lawas.",
     "So morag gasolina diay ang pagkaon, unya ang oxygen ang mopaandar sa makina?",
     "Maayo kaayo nga pagtandi — ingon gyud niana! Sama sa makina sa sakyanan nga nagkinahanglan og gasolina UG hangin aron moandar, ang imong mga cell nagkinahanglan og pagkaon UG oxygen aron makahimo og enerhiya. Ug naa puy 'aso' kini nga proseso: carbon dioxide — kana ang imong ibuga matag ginhawa nimo pagawas. Busa magkapares nga trabaho ang kaon ug ginhawa: ang usa ang modala sa sugnod, ang usa ang mopasiga niini.",
    ], ["faq-why-we-breathe"]),
    # 8 — panting when running (4 msg, PLAIN)
    ("5", [
     "Ngano man nga maghangos ko ug paspas kaayo ang pitik sa akong kasingkasing human modagan?",
     "Tungod kay nag-rush order ang imong mga batiis! Kung modagan ka, ang imong mga kaunoran maghimo og daghan kaayong trabaho — ug ang trabaho nagkinahanglan og enerhiya. Aron makahimo og mas daghang enerhiya gikan sa pagkaon nga imong gikaon, nagkinahanglan ang imong mga kaunoran og mas daghang oxygen, nga mas paspas. Mao nga mopaspas ang imong ginhawa: nagkarga ka og mas daghang oxygen matag minuto.",
     "Apan nganong apil man ang akong kasingkasing nga mopaspas? Dili ba sa baga ra man moagi ang hangin?",
     "Magkasosyo man gud sila sa paghatod! Ang baga ang mokarga sa oxygen gikan sa hangin, apan ang DUGO ang delivery truck nga mohatod niini sa mga kaunoran — ug ang kasingkasing ang mobomba sa dugo. Kung nagkinahanglan ang imong mga batiis og doble nga oxygen, kinahanglan nga mopaspas ang biyahe sa mga truck: mao nga mopaspas ang pitik sa imong kasingkasing. Pag-undang nimo sa pagdagan, hinay-hinay silang duha nga mohinay pag-usab kung mabayran na ang 'utang' nga oxygen sa imong mga kaunoran.",
    ], []),
    # 9 — evaporation any temperature, surface only vs boiling (6 msg, tag)
    ("6", [
     "Kinahanglan ba nga mobukal ang tubig una kini mahimong alisngaw? Apan nganong mouga man ang hinayhay bisan wala man magbukal ang tubig sa sanina?",
     "Hait kaayo ang imong pangutana — dili kinahanglan! Adunay duha ka paagi ang tubig aron mahimong alisngaw, ug ang una hilom nga mahitabo bisan unsa pa ang temperatura: ang evaporation. Sa ibabaw sa tubig, naay mga particle nga makatigom og igong kusog aron makabuhi padulong sa hangin — tagsa-tagsa, hinay-hinay, bisan bugnaw pa ang tubig. Kana ang nagpauga sa hinayhay, sa lapok, ug sa gitrapohan nga salog.",
     "Apan unsa man ang mahitabo kung mobukal? Lahi ba kana?",
     "Lahi, ug mas kusgan! Ang boiling mahitabo lamang kung moabot ang tubig sa 100 degrees Celsius. Nianang puntoha, dili na lang sa ibabaw moikyas ang mga particle — sa SULOD mismo sa tubig, bisan sa pinakailalom sa kaldero, maporma ang mga bula sa alisngaw nga mosaka ug mobuto sa ibabaw. Mao nga magbulubuko ang nagbukal nga tubig: alisngaw nga naporma sa tibuok niini, dili lang sa ibabaw.",
     "Ah mao diay! So sa init nga adlaw mas paspas mouga ang hinayhay, apan bisan bugnaw ug madag-um, mouga ra gihapon kini?",
     "Eksakto! Ang evaporation mahitabo sa BISAN UNSA nga temperatura — paspason lang kini sa kainit, dili kini kondisyon aron mahitabo. Mao nga mouga ra gihapon ang hinayhay sa bugnaw nga adlaw, mas hinay lang. Naa pa kay duha ka katabang: ang hangin, nga mopadpad sa alisngaw palayo aron may luna ang sunod nga particle, ug ang pagbuklad sa sanina sa sampayan — mas lapad ang ibabaw, mas daghang particle ang may agianan pagawas nga dungan.\n\n[image: A pot boiling vigorously with bubbles beside a dish of water slowly evaporating — boiling versus evaporation.]",
    ], ["boiling-vs-evaporation-g6"]),
    # 10 — boiling water stays at 100C (4 msg)
    ("7", [
     "Kung kusgan nako ang kalayo, mas moinit ba ang nagbukal nga tubig aron mas paspas maluto ang itlog?",
     "Ania ang makapakurat kanimo: DILI na mosaka ang temperatura niini! Ang nagbukal nga tubig magpabilin sa mga 100 degrees Celsius, bisan unsa pa kakusog sa imong kalayo. Kusog man o hinay ang bukal, parehong 100 degrees lang ang tubig — mao nga dili mas paspas maluto ang imong itlog, mas paspas lang mahurot ang imong gas!",
     "Apan asa man moadto ang dugang nga kainit gikan sa kusog nga kalayo kung dili na man mosaka ang temperatura?",
     "Sa pag-usab sa porma sa tubig! Ang tanang dugang nga kainit gigamit sa paghimo og mas daghang alisngaw — sa pag-usab sa likido nga tubig aron mahimong gas nga mas paspas. Busa ang kusog nga kalayo mohatag lang og mas daghang bula ug mas paspas nga pagkahurot sa tubig, dili mas init nga tubig. Praktikal nga leksyon sa kusina: kung nagbukal na, hinaya na ang kalayo sa kasarangang bukal — parehong 100 degrees ra gihapon, parehong kapaspas maluto ang pagkaon, mas daginot pa sa gas.",
    ], ["boiling-water-stays-hundred-g7"]),
]

with open(OUT, "w") as f:
    for grade, msgs, fids in ROWS:
        assert len(msgs) % 2 == 0
        out = []
        last_user = len(msgs) - 2
        for i, content in enumerate(msgs):
            role = "user" if i % 2 == 0 else "assistant"
            if i == last_user:
                content = grounded(fids, content)
            out.append({"role": role, "content": content})
        f.write(json.dumps({"grade": grade, "messages": out}, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")

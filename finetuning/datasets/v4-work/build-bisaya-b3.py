#!/usr/bin/env python3
"""Assemble bisaya-b3.jsonl (Family B, set 3 — 15 restate-and-check dialogues, Cebuano).

Mirror of build-tagalog-b3.py: same fact ids, splits, and tag descs.
u1 question -> a1 explanation -> u2 student restates and asks "sakto ba?"
-> a2 confirms/fixes + ONE new layer. Flawed restatements: rows 1, 4, 6, 10, 11.
Plain rows: 8, 13, 15. Tag rows: 2, 3, 4, 5, 6.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-b3.jsonl")

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

# (grade, u1, a1 explanation, [fact ids for u2], u2 restate+check, a2 confirm/fix + ONE layer)
ROWS = [
    # 1 — shadows (FLAWED restate: absorbed vs blocked)
    ("3",
     "Ngano man nga naa koy anino?",
     "Tungod kay gibabagan nimo ang kahayag! Ang kahayag mobiyahe nga tul-id kaayo — dili kini kahibalo moliko. Busa kung mobarog ka atubangan sa suga, dili makalusot ang kahayag sa imong lawas, ug ang ngitngit nga dapit sa imong likod diin walay naabot nga kahayag — mao kana ang imong anino.",
     ["faq-why-shadows"],
     "Ah nasabtan na nako! Ang anino maporma kay gisuyop sa akong lawas ang kahayag, sakto ba?",
     "Duol na, apan adunay gamay nga sayop: dili gisuyop kondili GIBABAGAN. Ang imong lawas morag bungbong nga dili maagian sa kahayag, mao nga adunay bahin sa salog nga dili maabot sa suga — mao kana ang anino. Ug ania pa ang usa ka bag-ong sekreto: kung duol ka sa suga, mas dako ang imong anino, kay mas dako nga bahin sa kahayag ang imong matabonan!"),
    # 2 — magnets (correct restate, tag)
    ("4",
     "Ngano man nga modikit ang magnet sa pultahan sa ref?",
     "Tungod kay adunay puthaw sa sulod sa pultahan sa refrigerator! Ang magnet adunay dili makita nga puwersa nga mobira sa mga butang nga hinimo sa puthaw o iron. Dili kini modikit nga morag papilit — birahon gyud niini ang puthaw, mao nga mabati nimo ang bira bisan wala pa sila magdikit.",
     ["fme-magnetism-g4", "faq-why-magnet-sticks"],
     "So morag adunay invisible nga bira ang magnet sa mga butang nga adunay puthaw, mao nga mokupot siya sa ref nga adunay puthaw sa sulod. Sakto ba?",
     "Sakto kaayo ang imong pagsabot! Ug ania ang usa pa ka dugang kahibalo: ang matag magnet adunay duha ka tumoy nga gitawag og poles — north ug south. Magkalahi nga poles, magbinirahay; parehong poles, magdinusoay! Sulayi pagpaduol ang duha ka magnet sa parehong tumoy ug mabati nimo sila nga magdinusoay nga morag dili gusto magdikit.\n\n[image: A bar magnet held just above a small pile of loose iron filings, with the filings being pulled up toward it.]"),
    # 3 — evaporating puddles (correct restate, tag)
    ("3",
     "Asa na man ang mga danaw human sa ulan? Mawala man sila inig-init sa adlaw.",
     "Maayo nga obserbasyon! Dili sila basta mawala — mosaka sila sa hangin. Ang init sa adlaw maghatag og kusog sa mga particle sa tubig diha sa danaw aron makabuhi ug molupad isip alisngaw nga dili nato makita. Hinay-hinay, magkagamay ang danaw hangtod mauga. Evaporation ang tawag ana.",
     ["evaporation-puddles-g3"],
     "So dili diay mawala ang tubig — mahimo siyang alisngaw nga mosaka sa hangin tungod sa init sa adlaw. Sakto ba?",
     "Sakto ka! Ug ania pa ang nindot nga sumpay sa istorya: ang alisngaw nga misaka gikan sa danaw dili mawala hangtod sa hangtod. Pag-abot niini sa bugnaw nga itaas, mahimo kining bahin sa panganod — ug sa umaabot nga adlaw, mangahulog kini pag-usab isip ulan. Busa ang tubig sa danaw nga miuga karon mahimong bahin sa ulan sa sunod semana!\n\n[image: A wet puddle on the pavement shrinking under the sun as it evaporates.]"),
    # 4 — go grow glow (FLAWED restate: go and grow swapped, tag)
    ("4",
     "Unsa man kanang go, grow, ug glow foods?",
     "Mao kana ang tulo ka grupo sa pagkaon sa Pinggang Pinoy! GO foods ang mohatag og enerhiya aron makadagan ug makadula ka — kan-on, pan, kamote. GROW foods ang magpadako ug magpakusgan sa lawas, bukog, ug kaunoran — isda, itlog, karne, monggos. GLOW foods usab ang magpanindot sa panit ug magpalig-on sa panagang batok sa sakit — mga prutas ug utanon.",
     ["living-nutrition-food-groups-g4"],
     "Nasabtan na nako: ang kan-on grow food kay mohatag og kusog, dayon ang isda go food kay magpadako. Sakto ba?",
     "Nagkabaylo lang ang duha! Hinumdomi kini: ang kan-on GO food — 'go' kay magpadagan kanimo, morag gasolina. Ang isda GROW food — 'grow' kay magpadako sa imong lawas. Ania ang sayon nga pahinumdom: GO aron molihok, GROW aron modako, GLOW aron mosidlak ang panglawas. Busa sa matag kaon, sulayi nga adunay kauban ang tanang tulo!\n\n[image: Three groups of Filipino foods sorted into go, grow, and glow food groups.]"),
    # 5 — decomposers (correct restate, tag)
    ("5",
     "Asa man mopadulong ang mga dahon nga mangatagak ug mga patay nga mananap sa lasang?",
     "Adunay mga tiglimpyo ang kinaiyahan! Sila ang mga decomposers — bacteria, fungi o uhong, ug mga wati. Lansangon nila ang mga patay nga tanom ug mananap ngadto sa gagmay kaayo nga piraso hangtod mahimo kining bahin sa yuta. Mao nga dili magtapun-og ang mga patay nga dahon sa lasang bisan pila ka gatos ka tuig.",
     ["living-decomposers-g5"],
     "So ang mga decomposers morag basurero sa kinaiyahan — gub-on nila ang mga patay nga tanom ug mananap aron mahimong yuta. Sakto ba?",
     "Sakto ang imong pagsabot! Ug ania ang pinakanindot nga bahin: dili lang sila basurero — recycler usab sila. Ang mga sustansya nga ilang nakuha gikan sa patay nga dahon mobalik sa yuta, ug ang mga buhi nga tanom ang mosuyop niini aron motubo. Busa ang daan nga dahon nga nadunot sa miaging tuig mao karon ang magpalambo sa mga bag-ong tanom — nagtuyok-tuyok ang sustansya sa kinaiyahan!\n\n[image: Decomposers including mushrooms and an earthworm breaking down a fallen dead leaf, returning nutrients to the soil.]"),
    # 6 — coral is an animal (FLAWED restate: coral = colorful rock, tag)
    ("5",
     "Unsa man gyud ang coral — bato ba kini o tanom?",
     "Makapakurat ang tubag: MANANAP ang coral! Ang coral reef o bahura gitukod sa liboan ka gagmay kaayo nga mananap nga gitawag og coral polyp. Maghimo sila og gahi nga balay nga morag bato ang hitsura, ug ang tinapok nilang mga balay mao ang maghimo sa tibuok bahura nga puy-anan sa daghan kaayong isda.",
     ["ocean-coral-reef-animal-g5", "ocean-coral-reef-home-g4"],
     "Ah, so ang coral usa ka kolorido nga bato nga gihimong balay sa gagmay nga mananap. Sakto ba?",
     "Hapit sakto, apan ang pinakaimportante nga bahin: ang coral mismo mao ang MANANAP, dili ang bato! Ang gahi nga morag-bato mao ang balay nga gihimo sa coral polyp — apan ang polyp nga nagpuyo sa sulod niini buhi nga mananap nga mokaon ug motubo. Dugang pa: gitawag ang coral reef og 'rainforest sa dagat' kay dinhi nagpuyo ang daghan kaayong klase sa isda ug mananap sa dagat — mao nga kinahanglan nato kining ampingan.\n\n[image: An underwater coral reef habitat with colorful corals on the seafloor, reef fish, and a starfish.]"),
    # 7 — tides (correct restate)
    ("5",
     "Ngano man nga mohawa ug mobalik ang tubig sa baybayon? Ingon sa akong lolo taob ug hunas daw kadto.",
     "Sakto ang imong lolo! Ang taob (taas nga tubig) ug hunas (ubos nga tubig) tungod sa bulan. Ang gravity sa bulan mobira sa tubig sa dagat — sa bahin sa Earth nga nag-atubang sa bulan, mosaka ang tubig. Samtang nagtuyok ang Earth, magpuli-puli kung asa nga baybayon ang taas ang tubig.",
     ["ocean-tides-moon-g5"],
     "So ang bulan morag mobira sa dagat gamit ang iyang gravity, mao nga mosaka ug monaog ang tubig sa baybayon. Sakto ba?",
     "Sakto ka! Ug ania ang usa ka detalye nga makapakurat nimo: sa kadaghanan sa mga lugar, DILI lang kausa matag adlaw kana mahitabo — kaduha mosaka ug kaduha monaog ang tubig sulod sa usa ka adlaw. Mao nga ang mga mangingisda motan-aw gyud sa oras sa taob ug hunas sa dili pa mopalawod — kabisado nila ang iskedyul sa dagat!"),
    # 8 — why the sea is salty (correct restate, PLAIN)
    ("5",
     "Ngano man nga parat ang dagat apan ang suba dili?",
     "Ang asin sa dagat gikan mismo sa yuta! Kung moulan, modagayday ang tubig sa mga bato ug yuta, ug matunaw niini ang gamay nga asin ug mineral nga dad-on niini hangtod sa dagat. Gamay ra kaayo kini sa suba mao nga dili nimo matilawan. Apan sa dagat, liboan ka tuig na nga natigom ang dala nga asin sa tanang suba — ug kung moalisngaw ang tubig, mahabilin ang asin.",
     [],
     "Ah mao diay! Ang suba adunay dala diay nga gamay nga asin padulong sa dagat, dayon sa dagat matigom ang asin kay ang tubig ra ang moalisngaw. Sakto ba?",
     "Perpekto ang imong pagmubo! Ug makita nimo mismo ang pamatuod niini sa Pilipinas: sa mga asinan o salt beds, paawason sa mga mag-uuma og asin ang tubig sa dagat ngadto sa mabaw nga pitak, pasagdan nga pauga sa adlaw, ug ang mahabilin nga puti nga kristal — mao na ang asin nga atong ginakaon. Gibuhat lang nila og paspas ang ginabuhat sa kinaiyahan sa hinay-hinay!"),
    # 9 — duck cover hold (correct restate)
    ("4",
     "Unsa may angay nakong buhaton kung molinog samtang anaa ko sa classroom?",
     "Hinumdomi ang tulo ka pulong: Duck, Cover, and Hold! Duck — duko dayon. Cover — pasilong ilalom sa lig-on nga lamesa aron mapanalipdan ang imong ulo ug liog sa mga butang nga mahimong mahulog. Hold — gunit og hugot sa tiil sa lamesa hangtod mohunong ang pag-uyog.",
     ["earthquake-duck-cover-hold-g4"],
     "So kung molinog: duko dayon, dayon pasilong ilalom sa lig-on nga lamesa, dayon kupot sa lamesa hangtod mahuman ang uyog. Sakto ba?",
     "Sakto kaayo, kabisado na nimo! Ug ania ang sunod nga lakang nga angay usab nimong mahibal-an: KUNG MIHUNONG na ang pag-uyog, gawas nga kalma padulong sa abli nga lugar nga layo sa mga bilding, poste, ug kable sa kuryente — ug pangandam, kay mahimong adunay mga aftershock o mga huyang nga linog nga mosunod pa. Mao kana ang hinungdan nganong adunay earthquake drill sa mga eskwelahan: aron awtomatiko na nimo kining mabuhat."),
    # 10 — ring of fire (FLAWED restate: "because PH is hot")
    ("7",
     "Ngano man nga sige og linog sa Pilipinas?",
     "Tungod sa atong nahimutangan: ang Pilipinas anaa sa Pacific Ring of Fire — usa ka dako nga arko palibot sa Dagat Pasipiko diin magtagbo ang dagko nga piraso sa panit sa Earth nga gitawag og tectonic plates. Kung molihok ug magkiskisay kining mga plate, molinog — ug dinhi usab maporma ang daghang bulkan.",
     ["ring-of-fire-why-earthquakes-g7"],
     "Ah mao diay. So sige og linog dinhi sa ato kay init ang klima sa Pilipinas, mao nga Ring of FIRE ang tawag. Sakto ba?",
     "Makalibog gyud ang ngalan, apan dili klima ang hinungdan! Ang 'fire' sa Ring of Fire nagtumong sa mga BULKAN nga nagpalibot sa Dagat Pasipiko, dili sa kainit sa panahon. Ang tinuod nga hinungdan sa linog anaa sa ilalom sa yuta: anaa kita sa tagboanan sa mga tectonic plates nga hinay-hinay nga molihok ug magdinusoay. Bisan pa og mobugnaw ang klima sa Pilipinas, molinog gihapon dinhi — kay ang atong gibarogan, dili ang panahon, ang hinungdan."),
    # 11 — typhoon eye (FLAWED restate: eye = most dangerous part)
    ("6",
     "Tinuod ba nga adunay mata ang bagyo? Unsa man kadto?",
     "Tinuod! Ang mata sa bagyo mao ang pinakatunga niini — ug talagsaon kini: hilom, kalma, ug usahay moadlaw pa gani didto. Apan ang nagpalibot mismo sa mata, ang gitawag og eyewall, mao ang adunay pinakakusog nga hangin ug ulan sa tibuok bagyo.",
     ["typhoon-eye-g6"],
     "So ang mata sa bagyo mao ang pinakadelikado nga bahin kay anaa kini sa tunga. Sakto ba?",
     "Baliktad diay: ang mata mismo mao ang pinaka-KALMA nga bahin — ang nagpalibot niini ang pinakadelikado! Ug dinhi gitago ang usa ka importante nga pasidaan: kung kalit nga mohilom ang bagyo ug moadlaw, basin anaa lang mo sa sulod sa mata — WALA pa mahuman ang bagyo. Paglabay sa mata, mobalik ang kusog kaayo nga hangin gikan sa pikas bahin. Busa ayaw basta gawas; hulata ang opisyal nga pahibalo nga wala na gyud ang bagyo."),
    # 12 — camouflage (correct restate)
    ("5",
     "Ngano man nga adunay mga insekto nga susama og hitsura sa sanga o dahon?",
     "Camouflage ang tawag ana — pagtago pinaagi sa pagpakaaron-ingnon! Ang stick insect porma ug kolor og sanga, ug adunay mga insekto nga morag buhi nga dahon nga adunay ugat pa. Tungod kay morag bahin sila sa tanom, dili sila mamatikdan sa mga langgam ug tiki nga gusto mokaon kanila.",
     ["insect-camouflage-g5"],
     "Ah, so gigamit nila ang ilang hitsura aron magtago — morag nagsul-ob sila sa ilang palibot aron dili sila makita sa mokaon unta kanila. Sakto ba?",
     "Nindot kana nga paghulagway — sakto ka! Ug ania ang pikas bahin sa dula: dili lang ang mga gipangita ang mogamit og camouflage. Ang mga MANGANGAYAM mismo magtago usab — ang mantis susama og hitsura sa dahon o bulak aron dili kini mamatikdan sa biktima nga moduol. Busa sa kinaiyahan, tagoanay ang dula sa duha ka bahin: magtago ang gipangita aron mabuhi, ug magtago ang mangangayam aron makakaon."),
    # 13 — baby bones (correct restate, PLAIN)
    ("3",
     "Tinuod ba nga mas daghan ang bukog sa baby kaysa sa tigulang?",
     "Tinuod kana, bisan morag baliktad paminawon! Ang masuso matawo nga adunay mga 300 ka bukog, apan ang hamtong adunay 206 lamang. Dili mawala ang mga bukog — samtang magdako ang bata, adunay mga managlahi nga bukog nga mag-usa o magdikit aron mahimong usa ka mas dako nga bukog.",
     [],
     "So dili diay mawala ang mga bukog sa baby — mag-usa sila aron mahimong mas dagko nga bukog samtang magdako siya. Sakto ba?",
     "Sakto ang imong pagsabot! Ug ania ang hinungdan nganong ingon ana ang disenyo: ang medyo humok ug managbulag nga bukog sa masuso motabang aron dili siya masakitan sa pagkatawo ug aron adunay luna ang iyang paspas nga pagtubo. Mao usab nga adunay humok nga bahin ang ulo sa bag-ong natawo nga baby — dili pa tibuok ang pagdikit sa mga bukog sa iyang bagolbagol, mao nga ampingan gyud kini pag-ayo."),
    # 14 — coral bleaching (correct restate)
    ("7",
     "Unsa man ang coral bleaching nga akong nabalitaan?",
     "Mao kana ang pagputi sa mga coral kung sobra na ang kainit sa tubig sa dagat. Ang himsog nga coral adunay kolorido nga kauban nga algae nga nagpuyo sa lawas niini ug maghatag og pagkaon niini. Kung moinit og sobra ang tubig, papahawaon sa stressed nga coral ang algae — mao nga mawad-an kini og kolor ug sa panguna niini nga gigikanan sa pagkaon. Kung modugay ang init, mahimo kining mamatay.",
     ["ocean-coral-bleaching-g7"],
     "So ang pagputi sa coral senyales nga stressed kini tungod sa sobrang init sa dagat — nawad-an kini sa kauban nga algae nga nagpakaon ug naghatag og kolor niini. Sakto ba?",
     "Sakto ang imong pagmubo! Ug ania ang importante nga punto nga maghatag og paglaom: ang nagputi nga coral WALA pa mamatay. Kung mobalik sa normal ang temperatura sa tubig sa igo nga kapaspas, mahimong dawaton pag-usab sa coral ang algae ug hinay-hinay nga mobalik ang kolor ug kusog niini. Busa importante ang pagbantay sa PH sa mga bahura — aduna pa silay higayon nga maulian kung mapanalipdan nato sila."),
    # 15 — 3 Rs (correct restate, PLAIN)
    ("4",
     "Unsa to usab ang buot ipasabot sa 3 R's nga gitudlo sa school?",
     "Mao kana ang tulo ka paagi aron makunhoran ang basura: Reduce — kunhori ang ginagamit, sama sa pagdala og kaugalingong water bottle aron dili na mopalit og plastik. Reuse — gamita pag-usab, sama sa paghimo og sudlanan gikan sa garapon. Recycle — ipadala sa planta ang papel, plastik, ug lata aron mahimong bag-ong produkto.",
     [],
     "So: Reduce kay kunhoran, Reuse kay gamiton pag-usab, dayon Recycle kay himoong bag-o pag-usab ang materyales. Sakto ba?",
     "Sakto tanan! Ug ania ang usa ka butang nga wala mahibal-i sa kadaghanan: adunay pagkasunod-sunod ang ka-epektibo sa tulo. Ang Reduce ang pinaka-epektibo — ang basura nga wala mahimo dili na kinahanglan atimanon. Sunod ang Reuse, ug kataposan ang Recycle, kay nagkinahanglan pa kini og enerhiya ug pabrika aron maproseso. Busa sa dili ka pa mag-recycle, pangutan-a una: malikayan ba nako kini, o magamit pa nako pag-usab?"),
]

with open(OUT, "w") as f:
    for grade, u1, a1, fids, u2, a2 in ROWS:
        row = {"grade": grade, "messages": [
            {"role": "user", "content": u1},
            {"role": "assistant", "content": a1},
            {"role": "user", "content": grounded(fids, u2)},
            {"role": "assistant", "content": a2},
        ]}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")

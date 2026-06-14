#!/usr/bin/env python3
"""Assemble tagalog-b3.jsonl (Family B, set 3 — 15 restate-and-check dialogues).

4 messages each: u1 question -> a1 explanation -> u2 student restates in their
own words and asks "tama po ba?" -> a2 confirms if right / fixes the flaw if
wrong, then adds exactly ONE new layer. Flawed restatements: rows 1, 4, 6, 10, 11.
Grounding only in the final user turn; plain rows: 8, 13, 15.
5 rows end with a fitting [image:] tag (2, 3, 4, 5, 6).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-b3.jsonl")

bank = {}
for line in open(BANK):
    r = json.loads(line)
    bank[r["id"]] = (r["topic"], r["fact"]["tl"])

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
     "Bakit po may anino ako?",
     "Dahil hinaharangan mo ang liwanag! Ang liwanag ay naglalakbay nang tuwid na tuwid — hindi ito marunong lumiko. Kaya kapag tumayo ka sa harap ng ilaw, hindi makakalusot ang liwanag sa katawan mo, at ang madilim na lugar sa likod mo kung saan walang nakaratíng na liwanag — iyon ang anino mo.",
     ["faq-why-shadows"],
     "Ah gets ko na po! Ang anino ay nabubuo kasi sinisipsip ng katawan ko ang liwanag, tama po ba?",
     "Malapit na, pero may maliit na mali: hindi sinisipsip kundi HINAHARANGAN. Ang katawan mo ay parang pader na hindi madaanan ng liwanag, kaya may bahagi sa sahig na hindi naabot ng ilaw — iyon ang anino. At heto pa ang isang bagong sikreto: kapag malapit ka sa ilaw, mas malaki ang anino mo, dahil mas malaking bahagi ng liwanag ang natatakpan mo!"),
    # 2 — magnets (correct restate, tag)
    ("4",
     "Bakit po dumidikit ang magnet sa pinto ng ref?",
     "Dahil may bakal sa loob ng pinto ng refrigerator! Ang magnet ay may di-nakikitang puwersa na humihila sa mga bagay na gawa sa bakal o iron. Hindi ito dumidikit na parang pandikit — hinihila talaga nito ang bakal, kaya ramdam mo ang hatak bago pa man sila magdikit.",
     ["fme-magnetism-g4", "faq-why-magnet-sticks"],
     "So parang may invisible na hila po ang magnet sa mga bagay na may bakal, kaya po siya kumakapit sa ref na may bakal sa loob. Tama po ba?",
     "Tamang-tama ang pagkakaintindi mo! At heto ang isa pang dagdag na kaalaman: ang bawat magnet ay may dalawang dulo na tinatawag na poles — north at south. Magkaibang poles, naghihilahan; parehong poles, nagtutulakan! Subukan mong paglapitin ang dalawang magnet sa magkabilang dulo at mararamdaman mo silang nagtutulakan na parang ayaw magdikit.\n\n[image: A bar magnet held just above a small pile of loose iron filings, with the filings being pulled up toward it.]"),
    # 3 — evaporating puddles (correct restate, tag)
    ("3",
     "Nasaan na po ang mga lusak pagkatapos ng ulan? Nawawala sila pag-araw.",
     "Magaling na obserbasyon! Hindi sila basta nawawala — umaakyat sila sa hangin. Ang init ng araw ay nagbibigay ng lakas sa mga particle ng tubig sa lusak para kumawala at lumipad bilang singaw na hindi natin nakikita. Unti-unti, paliit nang paliit ang lusak hanggang matuyo. Evaporation ang tawag diyan.",
     ["evaporation-puddles-g3"],
     "So hindi po pala nawawala ang tubig — nagiging singaw po siya na umaakyat sa hangin dahil sa init ng araw. Tama po ba?",
     "Tama ka! At heto pa ang magandang karugtong ng kwento: ang singaw na umakyat mula sa lusak ay hindi nawawala magpakailanman. Pag-abot nito sa malamig na itaas, magiging bahagi ito ng ulap — at balang araw, babagsak itong muli bilang ulan. Kaya ang tubig sa lusak na natuyo ngayon ay maaaring maging parte ng ulan sa susunod na linggo!\n\n[image: A wet puddle on the pavement shrinking under the sun as it evaporates.]"),
    # 4 — go grow glow (FLAWED restate: go and grow swapped, tag)
    ("4",
     "Ano po yung go, grow, at glow foods?",
     "Iyan ang tatlong grupo ng pagkain sa Pinggang Pinoy! GO foods ang nagbibigay ng enerhiya para makatakbo at makapaglaro ka — kanin, tinapay, kamote. GROW foods ang nagpapalaki at nagpapalakas ng katawan, buto, at kalamnan — isda, itlog, karne, munggo. GLOW foods naman ang nagpapaganda ng balat at nagpapalakas ng panlaban sa sakit — mga prutas at gulay.",
     ["living-nutrition-food-groups-g4"],
     "Gets ko na po: ang kanin ay grow food kasi nagbibigay ng lakas, tapos ang isda ay go food kasi nagpapalaki. Tama po ba?",
     "Nagkapalit lang ang dalawa! Tandaan mo ito: ang kanin ay GO food — 'go' kasi nagpapatakbo sa iyo, parang gasolina. Ang isda ay GROW food — 'grow' kasi nagpapalaki ng katawan mo. Heto ang madaling paalala: GO para gumalaw, GROW para lumaki, GLOW para kuminang ang kalusugan. Kaya sa bawat pagkain, subukan mong may kasama lahat ng tatlo!\n\n[image: Three groups of Filipino foods sorted into go, grow, and glow food groups.]"),
    # 5 — decomposers (correct restate, tag)
    ("5",
     "Saan po napupunta ang mga dahong nalalaglag at mga patay na hayop sa gubat?",
     "May mga tagapaglinis ang kalikasan! Sila ang mga decomposers — bacteria, fungi o kabuti, at mga bulate. Nilalansag nila ang mga patay na halaman at hayop sa napakaliliit na piraso hanggang sa maging bahagi ito ng lupa. Kaya hindi nagkakapatung-patong ang mga patay na dahon sa gubat kahit ilang daang taon.",
     ["living-decomposers-g5"],
     "So ang mga decomposers po ay parang basurero ng kalikasan — sinisira nila ang mga patay na halaman at hayop para maging lupa. Tama po ba?",
     "Tama ang pagkakaintindi mo! At heto ang pinakamagandang bahagi: hindi lang sila basurero — recycler din sila. Ang mga sustansyang nakuha nila mula sa patay na dahon ay bumabalik sa lupa, at ang mga buhay na halaman ang sumisipsip nito para lumaki. Kaya ang lumang dahon na nabulok noong isang taon ay nagpapalusog ngayon sa mga bagong tanim — paikot-ikot ang sustansya sa kalikasan!\n\n[image: Decomposers including mushrooms and an earthworm breaking down a fallen dead leaf, returning nutrients to the soil.]"),
    # 6 — coral is an animal (FLAWED restate: coral = colorful rock, tag)
    ("5",
     "Ano po ba talaga ang coral — bato po ba ito o halaman?",
     "Nakakagulat ang sagot: HAYOP ang coral! Ang coral reef o bahura ay itinayo ng libu-libong napakaliliit na hayop na tinatawag na coral polyp. Gumagawa sila ng matigas na bahay na bato-bato ang itsura, at ang sama-samang mga bahay nila ang bumubuo ng buong bahura na tirahan ng napakaraming isda.",
     ["ocean-coral-reef-animal-g5", "ocean-coral-reef-home-g4"],
     "Ah, so ang coral po ay makulay na bato na ginawang bahay ng maliliit na hayop. Tama po ba?",
     "Halos tama, pero ang pinakaimportanteng parte: ang coral mismo ay ang HAYOP, hindi ang bato! Ang matigas na parang-bato ay ang bahay na ginawa ng coral polyp — pero ang polyp na nakatira sa loob nito ay buhay na hayop na kumakain at lumalaki. Dagdag pa: tinatawag ang coral reef na 'rainforest ng dagat' dahil dito nakatira ang napakaraming uri ng isda at hayop-dagat — kaya kailangan natin itong alagaan.\n\n[image: An underwater coral reef habitat with colorful corals on the seafloor, reef fish, and a starfish.]"),
    # 7 — tides (correct restate)
    ("5",
     "Bakit po umaalis at bumabalik ang tubig sa dalampasigan? Sabi ng lolo ko taog at kati daw yun.",
     "Tama ang lolo mo! Ang taog (mataas na tubig) at kati (mababang tubig) ay sanhi ng buwan. Ang gravity ng buwan ay humihila sa tubig ng dagat — sa bahagi ng Earth na nakaharap sa buwan, umaangat ang tubig. Habang umiikot ang Earth, nagpapalit-palit kung aling dalampasigan ang naka-angat ang tubig.",
     ["ocean-tides-moon-g5"],
     "So yung buwan po ay parang humihila sa dagat gamit ang gravity niya, kaya tumataas at bumababa ang tubig sa tabing-dagat. Tama po ba?",
     "Tama ka! At heto ang isang detalyeng ikagugulat mo: sa karamihan ng mga lugar, HINDI lang isang beses kada araw nangyayari iyan — dalawang beses tumataas at dalawang beses bumababa ang tubig sa loob ng isang araw. Kaya ang mga mangingisda ay tinitingnan talaga ang oras ng taog at kati bago pumalaot — kabisado nila ang iskedyul ng dagat!"),
    # 8 — why the sea is salty (correct restate, PLAIN)
    ("5",
     "Bakit po maalat ang dagat pero ang ilog hindi?",
     "Ang asin sa dagat ay galing mismo sa lupa! Kapag umuulan, dumadaloy ang tubig sa mga bato at lupa, at natutunaw nito ang kaunting asin at mineral na dala nito hanggang sa dagat. Sobrang konti lang nito sa ilog kaya hindi mo malasahan. Pero sa dagat, libu-libong taon nang naiipon ang dalang asin ng lahat ng ilog — at kapag sumingaw ang tubig, naiiwan ang asin.",
     [],
     "Ah kaya po pala! Yung ilog po ay may dala palang konting asin papunta sa dagat, tapos sa dagat na-iipon ang asin kasi ang tubig lang ang sumisingaw. Tama po ba?",
     "Perpekto ang pagkakabuod mo! At makikita mo mismo ang patunay nito sa Pilipinas: sa mga asinan o salt beds, pinapaapaw ng mga magsasaka ng asin ang tubig-dagat sa mababaw na pitak, hinahayaang patuyuin ng araw, at ang naiiwang puting kristal — iyon na ang asing kinakain natin. Ginagawa lang nila nang mabilis ang siyang ginagawa ng kalikasan nang dahan-dahan!"),
    # 9 — duck cover hold (correct restate)
    ("4",
     "Ano po ang dapat kong gawin kapag lumindol habang nasa classroom ako?",
     "Tandaan mo ang tatlong salita: Duck, Cover, and Hold! Duck — yumuko ka agad. Cover — sumilong ka sa ilalim ng matibay na mesa para maprotektahan ang ulo at leeg mo sa mga bagay na maaaring mahulog. Hold — hawakan mo nang mahigpit ang paa ng mesa hanggang tumigil ang pagyanig.",
     ["earthquake-duck-cover-hold-g4"],
     "So pag lumindol po: yuko agad, tapos silong sa ilalim ng matibay na mesa, tapos kapit sa mesa hanggang matapos ang yanig. Tama po ba?",
     "Tamang-tama, kabisado mo na! At heto ang susunod na hakbang na dapat mo ring malaman: KAPAG TUMIGIL na ang pagyanig, lumabas nang mahinahon patungo sa bukas na lugar na malayo sa mga gusali, poste, at kable ng kuryente — at maging handa, dahil maaaring may mga aftershock o mga mahinang lindol na susunod pa. Iyan ang dahilan kung bakit may earthquake drill sa mga paaralan: para awtomatiko mo nang magawa ito."),
    # 10 — ring of fire (FLAWED restate: "because PH is hot")
    ("7",
     "Bakit po ang dalas ng lindol sa Pilipinas?",
     "Dahil sa lokasyon natin: ang Pilipinas ay nasa Pacific Ring of Fire — isang malaking arko sa paligid ng Karagatang Pasipiko kung saan nagtatagpo ang malalaking piraso ng balat ng Earth na tinatawag na tectonic plates. Kapag gumagalaw at nagkikiskisan ang mga plate na ito, lumilindol — at dito rin nabubuo ang maraming bulkan.",
     ["ring-of-fire-why-earthquakes-g7"],
     "Ah kaya po pala. So madalas ang lindol sa atin kasi mainit ang klima ng Pilipinas, kaya po Ring of FIRE ang tawag. Tama po ba?",
     "Nakakalito nga ang pangalan, pero hindi klima ang dahilan! Ang 'fire' sa Ring of Fire ay tumutukoy sa mga BULKAN na nakapaligid sa Karagatang Pasipiko, hindi sa init ng panahon. Ang totoong dahilan ng lindol ay ang ilalim ng lupa: nasa tagpuan tayo ng mga tectonic plates na dahan-dahang gumagalaw at nagtutulakan. Kahit pa maging malamig ang klima ng Pilipinas, lilindol pa rin dito — dahil ang kinatatayuan natin, hindi ang panahon, ang dahilan."),
    # 11 — typhoon eye (FLAWED restate: eye = most dangerous part)
    ("6",
     "Totoo po bang may mata ang bagyo? Ano po yun?",
     "Totoo! Ang mata ng bagyo ay ang pinakagitna nito — at kakaiba ito: tahimik, kalmado, at minsan aaraw pa nga doon. Pero ang nakapalibot mismo sa mata, ang tinatawag na eyewall, ang may pinakamalakas na hangin at ulan sa buong bagyo.",
     ["typhoon-eye-g6"],
     "So yung mata po ng bagyo ang pinakadelikadong parte kasi nasa gitna ito. Tama po ba?",
     "Baliktad pala: ang mata mismo ay ang pinaka-KALMADONG bahagi — ang nakapaligid dito ang pinakadelikado! At dito nakatago ang isang mahalagang babala: kapag biglang tumahimik ang bagyo at umaraw, baka nasa loob lang kayo ng mata — HINDI pa tapos ang bagyo. Pagdaan ng mata, babalik ang napakalakas na hangin mula sa kabilang panig. Kaya huwag basta lalabas; hintayin ang opisyal na anunsyo na wala na talaga ang bagyo."),
    # 12 — camouflage (correct restate)
    ("5",
     "Bakit po may mga insekto na kamukha ng sanga o dahon?",
     "Camouflage ang tawag diyan — pagtatago sa pamamagitan ng pagpapanggap! Ang stick insect ay hugis at kulay sanga, at may mga insektong parang buhay na dahon na may ugat pa. Dahil mukha silang bahagi ng halaman, hindi sila napapansin ng mga ibon at butiking gustong kumain sa kanila.",
     ["insect-camouflage-g5"],
     "Ah, so ginagamit po nila ang itsura nila para magtago — parang nagdadamit sila ng kapaligiran nila para hindi sila makita ng kakain sana sa kanila. Tama po ba?",
     "Magandang paglalarawan iyan — tama ka! At heto ang kabilang panig ng laro: hindi lang ang mga tinutugis ang gumagamit ng camouflage. Ang mga MANGANGASO mismo ay nagtatago rin — ang mantis o sasamba-samba ay kamukha ng dahon o bulaklak para hindi ito mapansin ng biktimang lalapit. Kaya sa kalikasan, taguan ang laro ng dalawang panig: nagtatago ang tinutugis para mabuhay, at nagtatago ang mangangaso para makakain."),
    # 13 — baby bones (correct restate, PLAIN)
    ("3",
     "Totoo po bang mas marami ang buto ng baby kaysa sa matanda?",
     "Totoo iyan, kahit parang baliktad ang dating! Ang sanggol ay ipinapanganak na may mga 300 buto, pero ang nasa hustong gulang ay may 206 lamang. Hindi nawawala ang mga buto — habang lumalaki ang bata, may mga magkakahiwalay na buto na nagsasanib o nagdidikit para maging iisang mas malaking buto.",
     [],
     "So hindi po pala nawawala yung mga buto ng baby — nagsasama-sama po sila para maging mas malalaking buto habang lumalaki siya. Tama po ba?",
     "Tama ang pagkakaintindi mo! At heto ang dahilan kung bakit ganyan ang disenyo: ang medyo malambot at hiwa-hiwalay na buto ng sanggol ay tumutulong para hindi siya masaktan sa pagsilang at para may puwang ang mabilis niyang paglaki. Kaya rin nga may malambot na bahagi ang ulo ng bagong silang na baby — hindi pa buo ang pagkakadikit ng mga buto ng bungo niya, kaya ito ay iingatang mabuti."),
    # 14 — coral bleaching (correct restate)
    ("7",
     "Ano po ang coral bleaching na nababalitaan ko?",
     "Iyan ang pamumuti ng mga coral kapag sumosobra ang init ng tubig-dagat. Ang malusog na coral ay may makukulay na katuwang na algae na nakatira sa katawan nito at nagbibigay ng pagkain dito. Kapag uminit nang sobra ang tubig, pinapaalis ng stressed na coral ang algae — kaya nawawalan ito ng kulay at ng pangunahing pinagkukunan ng pagkain. Kapag tumagal ang init, maaari itong mamatay.",
     ["ocean-coral-bleaching-g7"],
     "So ang pamumuti po ng coral ay senyales na stressed ito dahil sa sobrang init ng dagat — nawalan ito ng kasamang algae na nagpapakain at nagbibigay kulay dito. Tama po ba?",
     "Tama ang buod mo! At heto ang mahalagang punto na nagbibigay ng pag-asa: ang namumuting coral ay HINDI pa patay. Kapag bumalik sa normal ang temperatura ng tubig nang sapat na bilis, maaaring tanggapin muli ng coral ang algae at dahan-dahang manumbalik ang kulay at lakas nito. Kaya mahalaga ang pagbabantay ng PH sa mga bahura — may pagkakataon pa silang gumaling kung mapoprotektahan natin sila."),
    # 15 — 3 Rs (correct restate, PLAIN)
    ("4",
     "Ano po ulit ang ibig sabihin ng 3 R's na tinuro sa school?",
     "Iyan ang tatlong paraan para mabawasan ang basura: Reduce — bawasan ang ginagamit, tulad ng pagdadala ng sariling water bottle para hindi na bumili ng plastik. Reuse — gamitin muli, tulad ng paggawa ng lalagyan mula sa garapon. Recycle — ipadala sa pagawaan ang papel, plastik, at lata para maging bagong produkto.",
     [],
     "So po: Reduce ay bawasan, Reuse ay gamitin ulit, tapos Recycle ay gawing bago ulit yung materyales. Tama po ba?",
     "Tama lahat! At heto ang isang bagay na hindi alam ng karamihan: may pagkakasunud-sunod ang bisa ng tatlo. Ang Reduce ang pinakamabisa — ang basurang hindi nagawa ay hindi na kailangang asikasuhin. Sunod ang Reuse, at panghuli ang Recycle, dahil nangangailangan pa ito ng enerhiya at pabrika para maproseso. Kaya bago ka mag-recycle, itanong muna: maiiwasan ko ba ito, o magagamit ko pa ulit?"),
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

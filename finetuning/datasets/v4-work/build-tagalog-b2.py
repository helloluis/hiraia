#!/usr/bin/env python3
"""Assemble tagalog-b2.jsonl (Family B, set 2 — 25 Socratic-answered dialogues).

4 messages each: u1 student question -> a1 Socratic guiding question (no answer)
-> u2 student attempt (15 correct-ish, 10 wrong: rows 2,3,5,9,10,12,13,18,21,23)
-> a2 acknowledges the attempt and TEACHES — never re-asks the question.
Grounding (on-topic fact) only in the final user turn; plain rows: 4, 9, 14, 19, 25.
8 rows end with a fitting [image:] tag (1, 3, 8, 10, 13, 16, 17, 21).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-b2.jsonl")

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

# (grade, u1, a1 Socratic question, [fact ids for u2], u2 student attempt, a2)
ROWS = [
    # 1 — butterfly metamorphosis (correct, tag)
    ("3",
     "Paano po nagiging paruparo ang higad?",
     "Magandang tanong! Bago ko sabihin, ikaw muna: nakakita ka na ba ng higad na gumawa ng parang matigas na balot sa sanga? Ano sa tingin mo ang nangyayari sa loob noon?",
     ["butterfly-metamorphosis-g3"],
     "Parang natutulog po siya sa loob, tapos paglabas niya may pakpak na siya?",
     "Tamang-tama ang hula mo! Sa loob ng balot na iyon — chrysalis o pupa ang tawag — dahan-dahang nagbabago ang katawan ng higad hanggang maging paruparo. Apat na yugto lahat: itlog, higad na kumakain nang kumakain, pupa na tahimik na nagbabago, at sa wakas, paruparong may pakpak. Metamorphosis ang tawag sa kahanga-hangang pagbabagong ito!\n\n[image: A circular diagram of the butterfly life cycle showing four stages: egg, caterpillar, chrysalis, and adult butterfly.]"),
    # 2 — cold glass sweats (wrong)
    ("4",
     "Bakit po basa ang labas ng baso ng malamig na tubig?",
     "Magandang obserbasyon! Mag-isip tayo na parang detektib: saan kaya nanggaling ang tubig sa labas ng baso — sa loob ba nito, o sa ibang lugar? Ano ang hinala mo?",
     ["condensation-cold-glass-g4"],
     "Sa loob po! Tumatagos po siguro ang tubig sa salamin kaya basa sa labas.",
     "Ganyan din ang hinala ng maraming tao, pero hindi tumatagos ang tubig sa salamin — walang butas ang baso! Ang tubig sa labas ay galing sa hangin. May singaw ng tubig na hindi natin nakikita sa mainit na hangin, at kapag dumikit ito sa malamig na ibabaw ng baso, lumalamig ito at nagiging maliliit na patak. Condensation ang tawag diyan — kaya parang 'pumapawis' ang baso."),
    # 3 — float vs sink (wrong, tag)
    ("5",
     "Bakit po lumulubog ang bato pero lumulutang ang kahoy?",
     "Pag-isipan natin itong palaisipan: ang malaking troso ay mas mabigat kaysa sa maliit na bato, pero ang troso ay lumulutang at ang bato ay lumulubog. Bigat nga kaya talaga ang dahilan?",
     ["density-float-sink-g5"],
     "Opo, mabigat po kasi ang bato kaya lumulubog siya.",
     "Naiintindihan ko kung bakit iyan ang sagot mo, pero balikan natin ang troso: sobrang bigat niyon pero lumulutang pa rin! Ang tunay na susi ay density — kung gaano kasiksik ang isang bagay. Ang bato ay siksik na siksik kaya mas mataas ang density nito kaysa sa tubig, kaya lumulubog. Ang kahoy ay maraming maliliit na puwang sa loob kaya mas mababa ang density nito kaysa sa tubig — lumulutang ito kahit gaano kalaki.\n\n[image: A single solid stone descending below the surface of the water, sinking down to the bottom of the glass.]"),
    # 4 — echo (correct, PLAIN)
    ("5",
     "Bakit po may umuulit na boses sa loob ng kweba?",
     "Interesante iyan! Subukan nating ihambing: kapag binato mo ang bola sa pader, ano ang ginagawa nito? Baka may ganoon ding nangyayari sa boses mo.",
     [],
     "Bumabalik po ang bola sa akin! Ganun din po ba ang tunog, bumabalik pag tumama sa pader ng kweba?",
     "Eksakto ang paghahambing mo! Ang tunog ay naglalakbay sa hangin, at kapag tumama ito sa malaking matigas na ibabaw tulad ng pader ng kweba o bundok, tumatalbog ito pabalik sa tainga mo — echo o alingawngaw ang tawag diyan. Kaya naririnig mo ulit ang sarili mong boses, medyo huli lang ng konti dahil kailangan pa nitong maglakbay papunta sa pader at pabalik."),
    # 5 — sound is vibration (wrong)
    ("4",
     "Saan po nanggagaling ang tunog ng gitara?",
     "Mag-eksperimento tayo sa isip: kalabitin mo ang kuwerdas ng gitara at tingnan itong mabuti habang tumutunog. May napapansin ka ba sa kuwerdas mismo?",
     ["fme-sound-g4"],
     "Hmm, sa kahoy po siguro nanggagaling ang tunog? Parang speaker po na may kuryente sa loob.",
     "Walang kuryente sa loob ng ordinaryong gitara — pero may mas astig doon! Kapag tiningnan mo nang mabuti, makikita mong nanginginig o nagva-vibrate ang kuwerdas nang napakabilis pagkatapos mong kalabitin. Ang panginginig na iyan ang gumagawa ng tunog, at pinapalakas ito ng guwang na kahoy na katawan ng gitara. Lahat ng tunog ay galing sa vibration — pati ang boses mo, galing sa nanginginig na vocal cords sa lalamunan mo."),
    # 6 — float easier in seawater (correct)
    ("5",
     "Totoo po ba na mas madali lumutang sa dagat kaysa sa swimming pool?",
     "Totoo iyan! Pero bakit kaya? Heto ang pahiwatig: kapag nakalunok ka ng tubig sa dagat, ano ang napapansin mong pinagkaiba nito sa tubig sa pool?",
     ["why-float-easier-seawater-g5"],
     "Maalat po! Kaya po ba mas siksik ang tubig-dagat, kaya mas itinutulak niya ako paitaas?",
     "Napakahusay na pangangatwiran! Tama ka: ang asin na natunaw sa tubig-dagat ay nagpapataas ng density nito — mas siksik ito kaysa sa tubig-tabang. At kapag mas siksik ang tubig, mas malakas ang pagtulak nito paitaas sa katawan mo. Kaya sa Dead Sea na sobrang alat, halos hindi ka na kailangang sumipa para lumutang!"),
    # 7 — friction makes heat (correct)
    ("4",
     "Bakit po umiinit ang mga palad ko kapag pinagkukuskos ko sila?",
     "Magandang obserbasyon! Pansinin mo: kailan mas mabilis uminit ang palad mo — kapag mabagal at mahina ang kuskos, o kapag mabilis at madiin? Ano kaya ang sinasabi niyan?",
     ["friction-makes-heat-g4"],
     "Pag mabilis at madiin po! Yung pagkiskis po ba ang gumagawa ng init? Friction po ba yun?",
     "Tama ka sa lahat! Friction nga iyan — ang puwersa kapag may dalawang ibabaw na nagkikiskisan. Ang enerhiya ng galaw ng mga kamay mo ay nagiging init dahil sa friction, kaya habang mas mabilis at mas madiin ang kuskos, mas maraming enerhiya ang nagiging init. Ganyan din kaya umiinit ang gulong ng bisikleta pagkatapos ng mahabang biyahe."),
    # 8 — dissolve faster (correct, tag)
    ("6",
     "Paano ko po mapapabilis matunaw ang juice powder sa tubig?",
     "Mag-eksperimento tayo sa isip: dalawang basong tubig, isang malamig at isang mainit, parehong sinabugan ng juice powder. Alin kaya ang unang matutunawan? At may maiisip ka pa bang ibang paraan para mapabilis ito?",
     ["matter-dissolving-factors-g6"],
     "Sa mainit po! Tsaka pag hinahalo ko po gamit ang kutsara, mas mabilis din matunaw.",
     "Dalawa agad ang nakuha mo, magaling! May pangatlo pa: kung dudurugin mo muna ang malalaking tipak para maging pino, mas mabilis din itong matutunaw dahil mas malaki ang ibabaw na nadidikitan ng tubig. Kaya tatlo ang sikreto ng mabilis na pagtunaw: initin ang likido, haluin ito, at gawing maliliit ang piraso.\n\n[image: Two glasses, one cold and one hot, with sugar being stirred, showing the sugar dissolving faster in the hot water.]"),
    # 9 — ice cream melts (wrong, PLAIN)
    ("3",
     "Bakit po natutunaw ang ice cream ko?",
     "Mag-obserba muna tayo: saan mas mabilis matunaw ang ice cream mo — sa loob ng malamig na kwarto, o sa labas sa ilalim ng araw? Ano kaya ang ibig sabihin niyan?",
     [],
     "Sa labas po sa araw! Siguro po kasi gusto na niyang bumalik na maging gatas ulit.",
     "Tama ang obserbasyon mo na sa init mas mabilis! Pero walang 'gusto' ang ice cream — ang totoong dahilan ay ang init mismo. Ang ice cream ay nagyelo, at kapag tinamaan ito ng mainit na hangin o ng araw, ang init ay nagbibigay ng lakas sa nagyelong mga piraso nito para kumawala at dumulas-dulas — kaya nagiging malambot ito at tumutulo. Ang init ang laging dahilan kapag may natutunaw."),
    # 10 — what clouds are made of (wrong, tag)
    ("4",
     "Gawa po ba sa bulak ang mga ulap?",
     "Mukha nga silang bulak 'no? Pero heto ang pahiwatig: kapag kumukulo ang tubig sa takure, may nakikita kang puting umaakyat mula sa nguso nito. Ano kaya iyon, at baka may kaugnayan ito sa ulap?",
     ["cloud-formation-g4"],
     "Usok po! Usok po ba ang ulap?",
     "Malapit na! Pero hindi siya usok — singaw ng tubig iyon. Ang ulap ay gawa sa napakaliliit na patak ng tubig o kristal ng yelo: ang singaw ng tubig mula sa dagat at lupa ay umaakyat, lumalamig sa itaas, at nagiging maliliit na patak na sama-samang lumulutang. Milyon-milyong munting patak ng tubig ang tinitingnan mo tuwing nakatingala ka sa ulap!\n\n[image: A sky cross-section chart of the types of clouds: wispy cirrus high up, puffy cumulus lower down, and flat stratus layers.]"),
    # 11 — why it rains (correct)
    ("4",
     "Bakit po umuulan?",
     "Alam mo na bang ang ulap ay gawa sa maliliit na patak ng tubig? Ngayon isipin mo: ano kaya ang mangyayari kapag ang maliliit na patak na iyon ay nagsama-sama at lumaki nang lumaki?",
     ["rain-formation-g4"],
     "Bababa po sila! Kasi po mabigat na sila para lumutang.",
     "Tamang-tama! Kapag ang maliliit na patak sa ulap ay nagbanggaan at nagsama-sama, lumalaki sila hanggang sa hindi na kayang buhatin ng hangin ang bigat nila — kaya bumabagsak sila bilang ulan. Kaya rin madilim ang ulap bago umulan: sobrang kapal na ng tubig sa loob nito kaya halos walang liwanag na nakakalusot."),
    # 12 — what causes wind (wrong)
    ("5",
     "Saan po nanggagaling ang hangin? Bakit po humihihip ito?",
     "Heto ang palatandaan: napansin mo bang ang mainit na hangin ay pumapaitaas, tulad ng usok sa siga? Kapag umakyat ang mainit na hangin, ano kaya ang papalit sa puwang na iniwan nito?",
     ["wind-cause-g5"],
     "Hindi ko po sigurado... Sa mga puno po ba? Pag gumagalaw po ang mga dahon, parang sila ang gumagawa ng hangin.",
     "Baliktad pala iyon: ang hangin ang nagpapagalaw sa mga dahon, hindi ang mga dahon ang gumagawa ng hangin! Ang tamang sagot ay nasa pahiwatig kanina: kapag iniinit ng araw ang lupa, ang mainit na hangin ay pumapaitaas, at ang mas malamig na hangin mula sa ibang lugar ay dumadaloy papalit sa puwang. Ang pagdaloy na iyan ng hangin mula sa malamig papunta sa mainit na lugar — iyan mismo ang hanging nararamdaman mo."),
    # 13 — shooting star (wrong, tag)
    ("4",
     "Nakakita po ako ng bulalakaw kagabi! Bituin po ba talaga iyon na nahulog?",
     "Suwerte mo at nakakita ka! Pag-isipan natin: ang mga bituin ay napakalalaki — ang iba ay mas malaki pa sa ating Araw. Kung totoong isang bituin ang nahulog sa Earth, ano kaya ang mangyayari sa atin?",
     ["what-is-shooting-star-g4"],
     "Masusunog po siguro tayong lahat! Pero ang liit-liit po nung nakita ko, kaya baka maliit na bituin lang po siya?",
     "Tama ang unang bahagi ng iniisip mo — kapag ganoon kalaki, hindi tayo ligtas! Kaya ang sagot: hindi talaga bituin ang bulalakaw. Isa itong maliit na bato mula sa kalawakan, minsan kasinliit lang ng buhangin, na nasusunog habang bumibilis na pumapasok sa hangin ng Earth. Ang nakita mong guhit ng liwanag ay ang nag-aapoy nitong paglalakbay — milya-milya ang layo, pero sobrang liwanag kaya akala ng mga tao noon ay bituing nahuhulog.\n\n[image: A side-by-side comparison of a comet with a glowing icy head and long streaming tail, a meteor streaking through the sky, and an asteroid.]"),
    # 14 — stars vs planets (correct, PLAIN)
    ("5",
     "Ano po ang pinagkaiba ng bituin sa planeta?",
     "Ihambing natin ang dalawang bagay na kilala mo na: ang Araw at ang Buwan ay parehong maliwanag sa langit. Pero saan nanggagaling ang liwanag ng bawat isa? Diyan nakatago ang sagot.",
     [],
     "Yung Araw po may sariling liwanag kasi nagliliyab siya, yung Buwan po sinasalamin lang niya ang Araw. So yung bituin po parang Araw, at yung planeta parang Buwan?",
     "Perpekto ang pangangatwiran mo! Iyan mismo ang pagkakaiba: ang mga bituin ay nagliliyab at gumagawa ng sariling liwanag — ang ating Araw ay isa ngang bituin na malapit lang sa atin. Ang mga planeta tulad ng Earth at Mars ay hindi nagliliyab; sinasalamin lang nila ang liwanag ng Araw, kagaya ng Buwan. Kaya kapag kumikislap-kislap ito sa langit, malamang bituin; kapag tahimik at panatag ang liwanag, malamang planeta."),
    # 15 — no sound on the moon (correct)
    ("4",
     "Pwede po bang mag-usap ang mga astronaut sa buwan nang hindi gumagamit ng radyo?",
     "Interesanteng tanong! Heto ang kailangan mong maalala: ang tunog ay naglalakbay sa pamamagitan ng hangin. Ngayon, may hangin ba sa buwan?",
     ["moon-no-air-no-sound-g4"],
     "Wala po! So kahit po magsigawan sila, hindi sila magkakarinigan?",
     "Tama ka! Walang hangin sa buwan, kaya walang madadaanan ang tunog — kahit magsigawan sila nang harapan, katahimikan lang ang maririnig. Kaya ang mga astronaut ay nag-uusap gamit ang radyo sa loob ng kanilang helmet: ang radio waves ay kayang maglakbay kahit walang hangin, hindi tulad ng tunog. Iyan din ang dahilan kung bakit hindi sila makakahinga doon nang walang dalang hangin."),
    # 16 — Polaris (correct, tag)
    ("6",
     "Totoo po bang may bituin na hindi gumagalaw sa langit?",
     "May ganyan nga! Heto ang pahiwatig: ang Earth ay umiikot sa sarili nitong axis na parang trumpo. Habang umiikot ang trumpo, aling bahagi nito ang halos hindi gumagalaw?",
     ["polaris-north-star-g6"],
     "Yung gitna po sa itaas — yung dulo ng ikutan! So kung may bituin po na nasa tapat mismo ng axis ng Earth, mukhang nakatigil siya?",
     "Napakahusay! Iyan mismo ang Polaris o North Star: halos nasa tapat ito ng hilagang dulo ng axis ng Earth, kaya habang tila umiikot ang buong langit sa magdamag, si Polaris ay nananatili sa pwesto nito. Kaya ginamit ito ng mga manlalakbay at mandaragat noon bilang gabay — kapag nakita mo si Polaris, alam mo kung saan ang hilaga. Mahahanap mo ito sa tulong ng Big Dipper: ang dalawang bituin sa dulo ng sandok nito ay tumuturo papunta kay Polaris.\n\n[image: The Big Dipper: seven bright stars connected by lines into the shape of a ladle in the night sky.]"),
    # 17 — frog gills to lungs (correct, tag)
    ("4",
     "Bakit po sa tubig nakatira ang mga maliliit na palaka pero sa lupa na ang malalaki?",
     "Magandang napansin mo iyan! Naaalala mo ba ang itsura ng batang palaka — ang butete? Ano kaya ang ginagamit niya sa paghinga sa ilalim ng tubig?",
     ["living-frog-g4"],
     "May hasang po ata sila tulad ng isda! Tapos pagtanda po nila, nagkakaroon na sila ng baga?",
     "Tama ka! Ang butete ay humihinga gamit ang hasang kaya kaya nitong manirahan sa tubig tulad ng isda. Habang lumalaki ito, nagbabago ang katawan nito: tumutubo ang mga paa, nawawala ang buntot, at napapalitan ng baga ang hasang — kaya ang palakang may sapat na gulang ay sa lupa na humihinga. Amphibian ang tawag sa mga hayop na ganito: nabubuhay sila sa tubig at sa lupa.\n\n[image: A circular diagram of the frog life cycle showing four stages: a jelly egg cluster, tadpole, tadpole with legs, and adult frog.]"),
    # 18 — insect vs spider legs (wrong)
    ("3",
     "Insekto po ba ang gagamba?",
     "Magaling na tanong! Magbilang muna tayo: ilan ang paa ng langgam, at ilan ang paa ng gagamba? Subukan mong alalahanin o bilangin sa susunod na makakita ka.",
     ["living-insect-vs-spider-g3"],
     "Parehong anim po ata ang paa nila?",
     "Muntik na! Ang langgam at lahat ng insekto ay may anim na paa nga — pero ang gagamba ay may WALO. Kaya hindi insekto ang gagamba! Iba rin ang katawan nila: ang insekto ay may tatlong bahagi (ulo, dibdib, at tiyan), samantalang ang gagamba ay dalawa lang. Sa susunod na makakita ka ng gagamba, bilangin mo ang mga paa niya — walo talaga sila."),
    # 19 — lever and fulcrum (correct, PLAIN)
    ("6",
     "Paano po naaangat ng tao ang napakabigat na bagay gamit lang ang bareta?",
     "Naranasan mo na bang maglaro sa seesaw? Isipin mo: saan dapat umupo ang mas magaan na bata para maiangat niya ang mas mabigat na kalaro? Doon nakatago ang sagot.",
     [],
     "Sa dulong-dulo po! Pag malayo po siya sa gitna, kaya niyang iangat kahit mas mabigat ang nasa kabila.",
     "Tama ka! Iyan mismo ang sikreto ng lever: isang matigas na bara na gumagalaw sa isang tuntungang punto na tinatawag na fulcrum. Habang mas malayo ka sa fulcrum, mas lumalakas ang angat ng puwersa mo sa kabilang dulo. Ganyan ang bareta: ang fulcrum ay malapit sa mabigat na bagay, at ikaw ay tumutulak sa malayong dulo — kaya ang maliit mong lakas ay nagiging napakalaking puwersa sa kabila."),
    # 20 — heat conductors vs insulators (correct)
    ("6",
     "Bakit po mabilis uminit ang kutsarang metal sa mainit na sabaw, pero ang sandok na kahoy hindi?",
     "Magandang obserbasyon mula sa kusina! Sa tingin mo, pare-pareho kaya ang lahat ng materyales sa bilis ng pagpapadaloy ng init, o may mga mabilis at may mga mabagal?",
     ["fme-heat-conductors-insulators-g6"],
     "Magkakaiba po! Mabilis po sa metal dumaloy ang init, tapos mabagal po sa kahoy.",
     "Tama ka! Heat conductors ang tawag sa mga materyales na mabilis magpadaloy ng init, tulad ng metal — kaya mabilis umiinit ang kutsara sa sabaw. Heat insulators naman ang mabagal, tulad ng kahoy at plastik. Kaya nga ang hawakan ng kaldero at kawali ay gawa sa kahoy o plastik: pinipigilan nito ang init na umabot sa kamay mo para hindi ka mapaso."),
    # 21 — why chest expands when breathing (wrong, tag)
    ("6",
     "Bakit po lumalaki ang dibdib ko kapag humihinga ako papasok?",
     "Subukan nating alamin kung alin ang nauuna: ang hangin ba ang pumapasok kaya lumalaki ang dibdib mo, o ang katawan mo ang lumalaki kaya pumapasok ang hangin?",
     ["diaphragm-breathing-g6"],
     "Yung hangin po siguro ang nauuna? Pumapasok po kasi siya kaya lumolobo ang dibdib ko, parang lobo po.",
     "Baliktad pala — at ito ang nakakamangha: ang katawan mo ang kumikilos muna! Sa ilalim ng baga mo ay may malaking kalamnan na tinatawag na diaphragm. Kapag hihinga ka, bumababa ang diaphragm at umaangat ang mga tadyang mo, kaya lumalaki ang espasyo sa loob ng dibdib — at ang hangin ay sumusugod papasok para punan ang lumaking espasyo. Hindi ikaw nilolobo ng hangin; ikaw ang humihigop sa hangin!\n\n[image: A chest shown twice while breathing in and out, with the ribs lifting and the dome-shaped diaphragm moving down.]"),
    # 22 — digestive path (correct start)
    ("6",
     "Saan po napupunta ang pagkaing kinakain ko?",
     "Maglakbay tayo sa isip: sundan natin ang isang subo ng kanin. Pagkatapos mong nguyain at lunukin, saan-saan kaya ito dadaan? Ilista mo ang mga hinala mo.",
     ["living-digestive-g6"],
     "Sa lalamunan po tapos sa tiyan! Tapos po hindi ko na alam kung ano ang susunod.",
     "Tama ang simula ng listahan mo! Ituloy natin: mula sa sikmura kung saan dinudurog at hinahalo ang pagkain, dadaan ito sa maliit na bituka — dito sinisipsip ng katawan ang sustansya na dala ng pagkain. Ang hindi na magagamit ay dadaan sa malaking bituka, kung saan sinisipsip ang natitirang tubig, bago ito tuluyang ilabas ng katawan. Isang buong mahabang paglalakbay para lang makuha ang sustansya sa bawat subo!"),
    # 23 — PH seasons (wrong)
    ("4",
     "Ilan po ang mga panahon o season sa Pilipinas?",
     "Sa ibang bansa, may winter, spring, summer, at fall. Pero isipin mo ang isang buong taon dito sa atin: anong mga panahon ang talagang nararanasan mo sa inyong lugar?",
     ["earth-ph-seasons-g4"],
     "Apat po: summer, rainy, fall, tapos winter!",
     "Naiintindihan ko kung bakit apat ang naisip mo — iyan kasi ang madalas sa mga libro at palabas. Pero dito sa Pilipinas, dalawa lang talaga ang pangunahing panahon: ang tag-init o tag-araw (mga Marso hanggang Mayo) at ang tag-ulan (mga Hunyo hanggang Nobyembre). Wala tayong winter o fall dahil malapit ang bansa natin sa ekwador, kaya mainit-init ang panahon buong taon — nag-iiba lang kung tuyo o maulan."),
    # 24 — mangrove roots (correct)
    ("5",
     "Bakit po nakausli sa putik ang mga ugat ng bakawan?",
     "Isipin natin ang tirahan ng bakawan: maputik at laging inaapawan ng maalat na tubig. Ano kaya ang kailangan ng ugat na hindi nito makukuha sa ilalim ng makapal na putik?",
     ["ocean-mangrove-roots-g5"],
     "Hangin po! Para po ba makahinga ang mga ugat kaya sila nakausli?",
     "Tama ka! Halos walang hangin sa loob ng makapal na putik, kaya ang bakawan ay may mga ugat na nakausli paitaas — para makasinghap ng hangin ang halaman. Isa itong espesyal na adaptation para mabuhay sa maalat at maputik na baybayin. Bonus pa: ang sala-salabat na mga ugat na iyon ay nagsisilbing taguan ng maliliit na isda at humaharang sa malalakas na alon para maprotektahan ang dalampasigan."),
    # 25 — useful friction (correct, PLAIN)
    ("5",
     "Bakit po magaspang ang swelas ng sapatos?",
     "Isipin mo kung baliktad: sapatos na kasing-kinis ng salamin, sinuot mo sa basang sahig. Ano ang mangyayari sa iyo — at ano kaya ang sinasabi niyan tungkol sa silbi ng gaspang?",
     [],
     "Madudulas po ako agad! Ah, yung gaspang po pala ang nagbibigay ng kapit sa sahig.",
     "Tama ka! Friction ang tawag sa kapit na iyan — ang puwersang sumasalungat sa pagdulas kapag nagkikiskisan ang dalawang ibabaw. Ang magaspang na swelas ay nagpapalakas ng friction para hindi ka madulas, at ganyan din ang preno ng bisikleta at ang gulong ng sasakyan. Pero may mga pagkakataong ayaw natin ng friction — sa makina, nilalagyan ito ng langis para dumulas nang maayos ang mga piyesa at hindi mabilis masira."),
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

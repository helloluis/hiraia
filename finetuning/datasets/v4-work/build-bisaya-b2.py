#!/usr/bin/env python3
"""Assemble bisaya-b2.jsonl (Family B, set 2 — 25 Socratic-answered dialogues, Cebuano).

Mirror of build-tagalog-b2.py: same fact ids, splits, and tag descs.
u1 question -> a1 Socratic guiding question -> u2 student attempt
(wrong rows: 2,3,5,9,10,12,13,18,21,23) -> a2 acknowledges and TEACHES.
Plain rows: 4, 9, 14, 19, 25. Tag rows: 1, 3, 8, 10, 13, 16, 17, 21.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-b2.jsonl")

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

# (grade, u1, a1 Socratic question, [fact ids for u2], u2 student attempt, a2)
ROWS = [
    # 1 — butterfly metamorphosis (correct, tag)
    ("3",
     "Giunsa man pagkahimong alibangbang ang ulod?",
     "Maayo nga pangutana! Sa dili pa nako isulti, ikaw una: nakakita ka na ba og ulod nga naghimo og morag gahi nga putos sa sanga? Unsa sa imong hunahuna ang mahitabo sa sulod niadto?",
     ["butterfly-metamorphosis-g3"],
     "Morag natulog siya sa sulod, dayon paggawas niya naa na siyay pakpak?",
     "Sakto kaayo ang imong tag-an! Sa sulod sa maong putos — chrysalis o pupa ang tawag — hinay-hinay nga mausab ang lawas sa ulod hangtod mahimong alibangbang. Upat ka yugto tanan: itlog, ulod nga magkaon og magkaon, pupa nga hilom nga mag-usab, ug sa kataposan, alibangbang nga adunay pakpak. Metamorphosis ang tawag niining katingalahang kausaban!\n\n[image: A circular diagram of the butterfly life cycle showing four stages: egg, caterpillar, chrysalis, and adult butterfly.]"),
    # 2 — cold glass sweats (wrong)
    ("4",
     "Ngano man nga basa ang gawas sa baso sa bugnaw nga tubig?",
     "Maayo nga obserbasyon! Maghunahuna kita nga morag detektib: asa kaha gikan ang tubig sa gawas sa baso — sa sulod ba niini, o sa laing dapit? Unsa ang imong pangagpas?",
     ["condensation-cold-glass-g4"],
     "Sa sulod! Basin molapos ang tubig sa salamin mao nga basa sa gawas.",
     "Mao usab kana ang pangagpas sa daghang tawo, apan dili molapos ang tubig sa salamin — walay lungag ang baso! Ang tubig sa gawas gikan sa hangin. Adunay alisngaw sa tubig nga dili nato makita diha sa init nga hangin, ug kung modikit kini sa bugnaw nga ibabaw sa baso, mobugnaw kini ug mahimong gagmay nga tulo. Condensation ang tawag ana — mao nga morag 'nagsingot' ang baso."),
    # 3 — float vs sink (wrong, tag)
    ("5",
     "Ngano man nga maunlod ang bato apan molutaw ang kahoy?",
     "Hunahunaon nato kining tigmo: ang dako nga troso mas bug-at kaysa sa gamay nga bato, apan ang troso molutaw ug ang bato maunlod. Kabug-aton ba gyud diay ang hinungdan?",
     ["density-float-sink-g5"],
     "Oo, bug-at man ang bato mao nga maunlod siya.",
     "Nasabtan nako kung nganong mao kana ang imong tubag, apan balikan nato ang troso: bug-at kaayo kadto apan molutaw gihapon! Ang tinuod nga yawi mao ang density — kung unsa kasiksik ang usa ka butang. Ang bato siksik kaayo mao nga mas taas ang density niini kaysa sa tubig, busa maunlod. Ang kahoy adunay daghang gagmay nga luna sa sulod mao nga mas ubos ang density niini kaysa sa tubig — molutaw kini bisan unsa kadako.\n\n[image: A single solid stone descending below the surface of the water, sinking down to the bottom of the glass.]"),
    # 4 — echo (correct, PLAIN)
    ("5",
     "Ngano man nga adunay magbalik-balik nga tingog sa sulod sa langob?",
     "Interesante kana! Sulayan nato pagtandi: kung iitsa nimo ang bola sa bungbong, unsa may buhaton niini? Basin adunay susama nga mahitabo sa imong tingog.",
     [],
     "Mobalik ang bola kanako! Mao usab ba ang tingog, mobalik kung motama sa bungbong sa langob?",
     "Eksakto ang imong pagtandi! Ang tingog mobiyahe sa hangin, ug kung motama kini sa dako ug gahi nga ibabaw sama sa bungbong sa langob o bukid, molukso kini pabalik sa imong dalunggan — echo o lanog ang tawag ana. Mao nga madungog nimo pag-usab ang imong kaugalingong tingog, ulahi lang og gamay kay kinahanglan pa man kining mobiyahe padulong sa bungbong ug pabalik."),
    # 5 — sound is vibration (wrong)
    ("4",
     "Asa man gikan ang tingog sa gitara?",
     "Mag-eksperimento kita sa hunahuna: kabita ang kuwerdas sa gitara ug tan-awa kini pag-ayo samtang motingog. Aduna ka bay namatikdan sa kuwerdas mismo?",
     ["fme-sound-g4"],
     "Hmm, sa kahoy siguro gikan ang tingog? Morag speaker nga naay kuryente sa sulod.",
     "Walay kuryente sa sulod sa ordinaryong gitara — apan adunay mas nindot didto! Kung tan-awon nimo pag-ayo, makita nimo nga mokurog o mag-vibrate ang kuwerdas sa paspas kaayo human nimo kini kabita. Ang maong pagkurog mao ang maghimo sa tingog, ug palakson kini sa haw-ang nga kahoy nga lawas sa gitara. Ang tanang tingog gikan sa vibration — lakip ang imong tingog, gikan sa nagkurog nga vocal cords sa imong tutunlan."),
    # 6 — float easier in seawater (correct)
    ("5",
     "Tinuod ba nga mas sayon molutaw sa dagat kaysa sa swimming pool?",
     "Tinuod kana! Apan ngano kaha? Ania ang timailhan: kung makatulon ka og tubig sa dagat, unsa may imong namatikdan nga kalainan niini sa tubig sa pool?",
     ["why-float-easier-seawater-g5"],
     "Parat! Mao ba nga mas siksik ang tubig sa dagat, mao nga mas iduso niya ko paitaas?",
     "Maayo kaayo nga pangatarongan! Sakto ka: ang asin nga natunaw sa tubig sa dagat magpataas sa density niini — mas siksik kini kaysa sa tab-ang nga tubig. Ug kung mas siksik ang tubig, mas kusog ang pagduso niini paitaas sa imong lawas. Mao nga sa Dead Sea nga parat kaayo, halos dili na ka kinahanglan mosikad aron molutaw!"),
    # 7 — friction makes heat (correct)
    ("4",
     "Ngano man nga moinit ang akong mga palad kung akong kuskoson sila?",
     "Maayo nga obserbasyon! Matikdi: kanus-a mas paspas moinit ang imong palad — kung hinay ug luya ang kuskos, o kung paspas ug hugot? Unsa kaha ang gipasabot niana?",
     ["friction-makes-heat-g4"],
     "Kung paspas ug hugot! Ang pagkiskis ba ang maghimo sa init? Friction ba kana?",
     "Sakto ka sa tanan! Friction gyud kana — ang puwersa kung adunay duha ka ibabaw nga magkiskisay. Ang enerhiya sa lihok sa imong mga kamot mahimong init tungod sa friction, mao nga kung mas paspas ug mas hugot ang kuskos, mas daghang enerhiya ang mahimong init. Ingon usab ana nga moinit ang ligid sa bisikleta human sa taas nga biyahe."),
    # 8 — dissolve faster (correct, tag)
    ("6",
     "Unsaon man nako pagpapaspas og tunaw ang juice powder sa tubig?",
     "Mag-eksperimento kita sa hunahuna: duha ka baso sa tubig, usa ka bugnaw ug usa ka init, parehong gibuboan og juice powder. Asa kaha ang unang matunawan? Ug aduna pa ba kay mahunahunaan nga laing paagi aron mapaspas kini?",
     ["matter-dissolving-factors-g6"],
     "Sa init! Ug kung akong kutawon gamit ang kutsara, mas paspas usab matunaw.",
     "Duha dayon ang imong nakuha, maayo! Adunay ikatulo pa: kung dugmokon una nimo ang dagko nga tipak aron mahimong pino, mas paspas usab kining matunaw kay mas dako ang ibabaw nga madikitan sa tubig. Busa tulo ang sekreto sa paspas nga pagtunaw: initon ang likido, kutawon kini, ug pagamyon ang mga piraso.\n\n[image: Two glasses, one cold and one hot, with sugar being stirred, showing the sugar dissolving faster in the hot water.]"),
    # 9 — ice cream melts (wrong, PLAIN)
    ("3",
     "Ngano man nga matunaw ang akong ice cream?",
     "Mag-obserba una kita: asa mas paspas matunaw ang imong ice cream — sa sulod sa bugnaw nga kwarto, o sa gawas ilalom sa adlaw? Unsa kaha ang gipasabot niana?",
     [],
     "Sa gawas sa adlaw! Siguro kay gusto na niya mobalik nga mahimong gatas pag-usab.",
     "Sakto ang imong obserbasyon nga sa init mas paspas! Apan walay 'gusto' ang ice cream — ang tinuod nga hinungdan mao ang init mismo. Ang ice cream nagyelo, ug kung mataman kini sa init nga hangin o sa adlaw, ang init maghatag og kusog sa nagyelo nga mga piraso niini aron makabuhi ug magdalin-as — mao nga mahumok kini ug motulo. Ang init ang kanunay nga hinungdan kung adunay matunaw."),
    # 10 — what clouds are made of (wrong, tag)
    ("4",
     "Hinimo ba sa gapas ang mga panganod?",
     "Morag gapas gyud sila tan-awon 'no? Apan ania ang timailhan: kung magbukal ang tubig sa takure, adunay makita ka nga puti nga mosaka gikan sa baba niini. Unsa kaha kadto, ug basin adunay kalabotan kini sa panganod?",
     ["cloud-formation-g4"],
     "Aso! Aso ba ang panganod?",
     "Duol na! Apan dili kana aso — alisngaw sa tubig kadto. Ang panganod hinimo sa gagmay kaayo nga tulo sa tubig o kristal sa yelo: ang alisngaw sa tubig gikan sa dagat ug yuta mosaka, mobugnaw sa itaas, ug mahimong gagmay nga tulo nga magdungan og lutaw. Minilyon ka gagmay nga tulo sa tubig ang imong gitan-aw matag hangad nimo sa panganod!\n\n[image: A sky cross-section chart of the types of clouds: wispy cirrus high up, puffy cumulus lower down, and flat stratus layers.]"),
    # 11 — why it rains (correct)
    ("4",
     "Ngano man nga mag-ulan?",
     "Kahibalo ka na ba nga ang panganod hinimo sa gagmay nga tulo sa tubig? Karon hunahunaa: unsa kaha ang mahitabo kung ang gagmay nga tulo magtapok ug magkadako og magkadako?",
     ["rain-formation-g4"],
     "Manaog sila! Kay bug-at na sila aron molutaw.",
     "Sakto kaayo! Kung ang gagmay nga tulo sa panganod magbangga ug mag-usa, modako sila hangtod dili na maalsa sa hangin ang ilang gibug-aton — mao nga mangahulog sila isip ulan. Mao usab nga ngitngit ang panganod sa dili pa moulan: baga na kaayo ang tubig sa sulod niini mao nga halos walay kahayag nga makalusot."),
    # 12 — what causes wind (wrong)
    ("5",
     "Asa man gikan ang hangin? Nganong mohuyop man kini?",
     "Ania ang timailhan: namatikdan ba nimo nga ang init nga hangin mosaka, sama sa aso sa haling? Kung mosaka ang init nga hangin, unsa kaha ang mopuli sa luna nga gibiyaan niini?",
     ["wind-cause-g5"],
     "Dili ko sigurado... Sa mga kahoy ba? Kung molihok ang mga dahon, morag sila ang maghimo sa hangin.",
     "Baliktad diay kadto: ang hangin ang magpalihok sa mga dahon, dili ang mga dahon ang maghimo sa hangin! Ang sakto nga tubag anaa sa timailhan ganiha: kung initon sa adlaw ang yuta, ang init nga hangin mosaka, ug ang mas bugnaw nga hangin gikan sa laing dapit modagayday aron mopuli sa luna. Ang maong pagdagayday sa hangin gikan sa bugnaw padulong sa init nga dapit — mao mismo kana ang hangin nga imong mabati."),
    # 13 — shooting star (wrong, tag)
    ("4",
     "Nakakita ko og bulalakaw kagabii! Bituon ba gyud kadto nga nahulog?",
     "Suwerte nimo nga nakakita ka! Hunahunaon nato: ang mga bituon dagko kaayo — ang uban mas dako pa sa atong Adlaw. Kung tinuod nga usa ka bituon ang nahulog sa Earth, unsa kaha ang mahitabo kanato?",
     ["what-is-shooting-star-g4"],
     "Masunog siguro kitang tanan! Apan gamay ra kaayo kadtong akong nakita, basin gamay ra nga bituon kadto?",
     "Sakto ang unang bahin sa imong hunahuna — kung ingon kadako, dili kita luwas! Busa ang tubag: dili gyud bituon ang bulalakaw. Usa kini ka gamay nga bato gikan sa kawanangan, usahay sama ra kagamay sa balas, nga masunog samtang nagdali og sulod sa hangin sa Earth. Ang imong nakita nga badlis sa kahayag mao ang nagdilaab niini nga panaw — layo kaayo, apan hayag kaayo mao nga abi sa mga tawo kaniadto bituon nga nahulog.\n\n[image: A side-by-side comparison of a comet with a glowing icy head and long streaming tail, a meteor streaking through the sky, and an asteroid.]"),
    # 14 — stars vs planets (correct, PLAIN)
    ("5",
     "Unsa man ang kalainan sa bituon ug planeta?",
     "Itandi nato ang duha ka butang nga imo nang nailhan: ang Adlaw ug ang Bulan parehong hayag sa langit. Apan asa gikan ang kahayag sa matag usa? Diha gitago ang tubag.",
     [],
     "Ang Adlaw naay kaugalingong kahayag kay nagdilaab siya, ang Bulan nagsalamin ra sa Adlaw. So ang bituon morag Adlaw, ug ang planeta morag Bulan?",
     "Perpekto ang imong pangatarongan! Mao gyud kana ang kalainan: ang mga bituon nagdilaab ug naghimo og kaugalingong kahayag — ang atong Adlaw usa gyud ka bituon nga duol ra kanato. Ang mga planeta sama sa Earth ug Mars wala magdilaab; gisalamin ra nila ang kahayag sa Adlaw, sama sa Bulan. Busa kung magpangidlap-idlap kini sa langit, lagmit bituon; kung kalma ug malinaw ang kahayag, lagmit planeta."),
    # 15 — no sound on the moon (correct)
    ("4",
     "Mahimo ba nga mag-istoryahanay ang mga astronaut sa bulan nga dili mogamit og radyo?",
     "Interesante nga pangutana! Ania ang kinahanglan nimong hinumdoman: ang tingog mobiyahe pinaagi sa hangin. Karon, aduna bay hangin sa bulan?",
     ["moon-no-air-no-sound-g4"],
     "Wala! So bisan magsinggitay sila, dili sila magkadungog?",
     "Sakto ka! Walay hangin sa bulan, busa walay maagian ang tingog — bisan magsinggitay sila nga nag-atubangay, kahilom ra ang madungog. Mao nga ang mga astronaut mag-istoryahanay gamit ang radyo sulod sa ilang helmet: ang radio waves makabiyahe bisan walay hangin, dili sama sa tingog. Mao usab kana ang hinungdan nganong dili sila makaginhawa didto kung walay dala nga hangin."),
    # 16 — Polaris (correct, tag)
    ("6",
     "Tinuod ba nga adunay bituon nga dili molihok sa langit?",
     "Aduna gyud ana! Ania ang timailhan: ang Earth nagtuyok sa kaugalingong axis niini nga morag kasing. Samtang nagtuyok ang kasing, asa nga bahin niini ang halos dili molihok?",
     ["polaris-north-star-g6"],
     "Ang tunga sa itaas — ang tumoy sa tuyokanan! So kung adunay bituon nga anaa mismo sa atbang sa axis sa Earth, morag nagpundo siya?",
     "Maayo kaayo! Mao gyud kana ang Polaris o North Star: halos anaa kini sa atbang sa amihanang tumoy sa axis sa Earth, busa samtang morag nagtuyok ang tibuok langit sa tibuok gabii, si Polaris nagpabilin sa iyang pwesto. Mao nga gigamit kini sa mga magpapanaw ug mga mananagat kaniadto isip giya — kung makita nimo si Polaris, kahibalo ka kung asa ang amihanan. Makit-an nimo kini sa tabang sa Big Dipper: ang duha ka bituon sa tumoy sa kandos niini magtudlo padulong kang Polaris.\n\n[image: The Big Dipper: seven bright stars connected by lines into the shape of a ladle in the night sky.]"),
    # 17 — frog gills to lungs (correct, tag)
    ("4",
     "Ngano man nga sa tubig magpuyo ang gagmay nga baki apan sa yuta na ang dagko?",
     "Maayo nga namatikdan nimo kana! Nahinumdoman ba nimo ang hitsura sa bata nga baki — ang uluulo? Unsa kaha ang gamiton niya sa pagginhawa ilalom sa tubig?",
     ["living-frog-g4"],
     "Naa man tingali silay hasang sama sa isda! Dayon pagdako nila, magbaton na sila og baga?",
     "Sakto ka! Ang uluulo moginhawa gamit ang hasang mao nga makapuyo kini sa tubig sama sa isda. Samtang magdako kini, mausab ang lawas niini: motubo ang mga tiil, mawala ang ikog, ug mapulihan og baga ang hasang — mao nga ang hamtong nga baki sa yuta na moginhawa. Amphibian ang tawag sa mga mananap nga ingon niini: mabuhi sila sa tubig ug sa yuta.\n\n[image: A circular diagram of the frog life cycle showing four stages: a jelly egg cluster, tadpole, tadpole with legs, and adult frog.]"),
    # 18 — insect vs spider legs (wrong)
    ("3",
     "Insekto ba ang kaka?",
     "Maayo nga pangutana! Mag-ihap una kita: pila ang tiil sa hulmigas, ug pila ang tiil sa kaka? Sulayi paghinumdom o pag-ihap sa sunod nga makakita ka.",
     ["living-insect-vs-spider-g3"],
     "Parehong unom man tingali ang ilang tiil?",
     "Hapit na! Ang hulmigas ug ang tanang insekto adunay unom gyud ka tiil — apan ang kaka adunay WALO. Mao nga dili insekto ang kaka! Lahi usab ang ilang lawas: ang insekto adunay tulo ka bahin (ulo, dughan, ug tiyan), samtang ang kaka duha ra. Sa sunod nga makakita ka og kaka, ihapa ang iyang mga tiil — walo gyud sila."),
    # 19 — lever and fulcrum (correct, PLAIN)
    ("6",
     "Giunsa man sa tawo pag-alsa ang bug-at kaayo nga butang gamit lang ang bareta?",
     "Nakasulay ka na ba og dula sa seesaw? Hunahunaa: asa man dapat molingkod ang mas gaan nga bata aron maalsa niya ang mas bug-at nga kadula? Diha gitago ang tubag.",
     [],
     "Sa kinatumyan! Kung layo siya sa tunga, maalsa niya bisan mas bug-at ang anaa sa pikas.",
     "Sakto ka! Mao gyud kana ang sekreto sa lever: usa ka gahi nga barra nga molihok sa usa ka tungtonganan nga punto nga gitawag og fulcrum. Kung mas layo ka sa fulcrum, mas mokusog ang alsa sa imong puwersa sa pikas tumoy. Ingon ana ang bareta: ang fulcrum duol sa bug-at nga butang, ug ikaw moduso sa layo nga tumoy — mao nga ang imong gamay nga kusog mahimong dako kaayo nga puwersa sa pikas."),
    # 20 — heat conductors vs insulators (correct)
    ("6",
     "Ngano man nga paspas moinit ang kutsara nga metal sa init nga sabaw, apan ang luwag nga kahoy dili?",
     "Maayo nga obserbasyon gikan sa kusina! Sa imong hunahuna, parehas kaha ang tanang materyales sa kapaspas sa pagpaagi sa init, o adunay paspas ug adunay hinay?",
     ["fme-heat-conductors-insulators-g6"],
     "Lain-lain! Paspas moagi ang init sa metal, dayon hinay sa kahoy.",
     "Sakto ka! Heat conductors ang tawag sa mga materyales nga paspas magpaagi sa init, sama sa metal — mao nga dali moinit ang kutsara sa sabaw. Heat insulators usab ang hinay, sama sa kahoy ug plastik. Mao gani nga ang kuptanan sa kaldero ug kalaha hinimo sa kahoy o plastik: pugngan niini ang init nga moabot sa imong kamot aron dili ka mapaso."),
    # 21 — why chest expands when breathing (wrong, tag)
    ("6",
     "Ngano man nga modako ang akong dughan kung moginhawa ko pasulod?",
     "Sulayan nato pagsusi kung asa ang nahauna: ang hangin ba ang mosulod mao nga modako ang imong dughan, o ang imong lawas ang modako mao nga mosulod ang hangin?",
     ["diaphragm-breathing-g6"],
     "Ang hangin siguro ang nahauna? Mosulod man siya mao nga moburot ang akong dughan, morag lobo.",
     "Baliktad diay — ug mao kini ang katingalahan: ang imong lawas ang molihok una! Sa ilalom sa imong baga adunay dako nga kaunoran nga gitawag og diaphragm. Kung moginhawa ka pasulod, monaog ang diaphragm ug mosaka ang imong mga gusok, mao nga modako ang luna sulod sa dughan — ug ang hangin modali og sulod aron pun-on ang midako nga luna. Dili ikaw ang giburot sa hangin; ikaw ang misuyop sa hangin!\n\n[image: A chest shown twice while breathing in and out, with the ribs lifting and the dome-shaped diaphragm moving down.]"),
    # 22 — digestive path (correct start)
    ("6",
     "Asa man mopadulong ang pagkaon nga akong gikaon?",
     "Magpanaw kita sa hunahuna: sundan nato ang usa ka hungit sa kan-on. Human nimo kini usapa ug tunla, asa-asa kaha kini moagi? Ilista ang imong mga pangagpas.",
     ["living-digestive-g6"],
     "Sa tutunlan dayon sa tiyan! Human ana wala na ko kahibalo kung unsa ang sunod.",
     "Sakto ang sinugdanan sa imong lista! Ipadayon nato: gikan sa tiyan diin dugmokon ug sagolon ang pagkaon, moagi kini sa gamay nga tinai — dinhi suyopon sa lawas ang sustansya nga dala sa pagkaon. Ang dili na magamit moagi sa dako nga tinai, diin suyopon ang nahabilin nga tubig, una kini sa kataposan ipagawas sa lawas. Usa ka tibuok taas nga panaw aron lang makuha ang sustansya sa matag hungit!"),
    # 23 — PH seasons (wrong)
    ("4",
     "Pila man ang mga panahon o season sa Pilipinas?",
     "Sa laing nasod, adunay winter, spring, summer, ug fall. Apan hunahunaa ang usa ka tibuok tuig dinhi sa ato: unsa nga mga panahon ang tinuod nimong masinati sa inyong lugar?",
     ["earth-ph-seasons-g4"],
     "Upat: summer, rainy, fall, dayon winter!",
     "Nasabtan nako kung nganong upat ang imong nahunahunaan — mao man kana ang kasagaran sa mga libro ug salida. Apan dinhi sa Pilipinas, duha ra gyud ang panguna nga panahon: ang ting-init (mga Marso hangtod Mayo) ug ang ting-ulan (mga Hunyo hangtod Nobyembre). Wala kitay winter o fall tungod kay duol ang atong nasod sa ekwador, mao nga init-init ang panahon sa tibuok tuig — mausab ra kung uga o ulanon."),
    # 24 — mangrove roots (correct)
    ("5",
     "Ngano man nga nakausli sa lapok ang mga gamot sa bakhaw?",
     "Hunahunaon nato ang puy-anan sa bakhaw: lapokon ug kanunay nga lapawan sa parat nga tubig. Unsa kaha ang gikinahanglan sa gamot nga dili niini makuha ilalom sa baga nga lapok?",
     ["ocean-mangrove-roots-g5"],
     "Hangin! Aron ba makaginhawa ang mga gamot mao nga nakausli sila?",
     "Sakto ka! Halos walay hangin sulod sa baga nga lapok, mao nga ang bakhaw adunay mga gamot nga nakausli paitaas — aron makasimhot og hangin ang tanom. Usa kini ka espesyal nga adaptation aron mabuhi sa parat ug lapokon nga baybayon. Bonus pa: ang nagsapid-sapid nga mga gamot mahimong tagoanan sa gagmay nga isda ug mosalo sa kusog nga mga balod aron mapanalipdan ang baybayon."),
    # 25 — useful friction (correct, PLAIN)
    ("5",
     "Ngano man nga sapnot ang swelas sa sapatos?",
     "Hunahunaa kung baliktad: sapatos nga sama kahamis sa salamin, gisul-ob nimo sa basa nga salog. Unsa ang mahitabo kanimo — ug unsa kaha ang gipasabot niana bahin sa gamit sa kasapnot?",
     [],
     "Madalin-as dayon ko! Ah, ang kasapnot diay ang mohatag og kupot sa salog.",
     "Sakto ka! Friction ang tawag sa maong kupot — ang puwersa nga mosukol sa pagdalin-as kung magkiskisay ang duha ka ibabaw. Ang sapnot nga swelas magpakusog sa friction aron dili ka madalin-as, ug ingon usab ana ang preno sa bisikleta ug ang ligid sa sakyanan. Apan adunay mga higayon nga dili nato gusto ang friction — sa makina, butangan kini og lana aron modalin-as og maayo ang mga piyesa ug dili dali maguba."),
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

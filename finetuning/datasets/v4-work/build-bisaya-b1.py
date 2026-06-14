#!/usr/bin/env python3
"""Assemble bisaya-b1.jsonl (Family B1 "wala ko kasabot" — 25 rows, 4 messages, Cebuano).

Mirror of build-tagalog-b1.py: same fact ids and tag descs; u2 says they didn't get it;
a2 re-explains with a COMPLETELY new analogy (no shared 8-grams with a1).
Plain (no-grounding) u2 rows: 9, 12, 13, 19, 24.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-b1.jsonl")

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

# (grade, u1, a1, [fact ids for u2], u2-msg, a2 (tag embedded where present))
ROWS = [
    ("4",
     "Unsa man ang water cycle?",
     "Ang water cycle mao ang nagtuyok-tuyok nga panaw sa tubig! Ang init sa adlaw magpaalisngaw sa tubig gikan sa dagat ug suba (evaporation), ang alisngaw mosaka ug mahimong panganod (condensation), ug kung bug-at na ang panganod, mobundak kini isip ulan (precipitation). Unya balik-balikon ang maong tuyok!",
     ["earth-water-cycle-g4"],
     "Wala ko kasabot sa evaporation. Giunsa man pagsaka sa tubig?",
     "Sige, hunahunaa ang gibulad nga basa nga sinina. Human sa pipila ka oras sa init sa adlaw, uga na kini — asa man miadto ang tubig? Nahimo kining gagmay kaayo nga alisngaw nga milupad sa hangin, gamay ra kaayo nga dili na nimo makita. Mao usab kana ang mahitabo sa dagat matag adlaw: hinay-hinay nga gialsa sa init ang tubig isip alisngaw, ug mao kana ang unang lakang sa tuyok.\n\n[image: The water cycle showing the Sun warming the ocean, water evaporating and rising into clouds, and rain falling on mountains.]"),
    ("5",
     "Giunsa man pagbuhat sa tanom og pagkaon?",
     "Photosynthesis ang tawag ana! Morag lutoanan kini sulod sa dahon: ang mga sangkap mao ang tubig gikan sa gamot, carbon dioxide gikan sa hangin, ug kahayag sa adlaw isip sugnod sa lutoanan. Ang luto? Asukal nga pagkaon sa tanom — ug naa pay bonus nga oxygen nga ipagawas alang kanato!",
     ["living-photosynthesis-g5"],
     "Naglibog ko. Asa man mosulod ang adlaw didto?",
     "Hunahunaa nga ang matag dahon morag solar panel. Ang solar panel mosuyop og enerhiya gikan sa silaw sa adlaw aron makakuryente ang balay, di ba? Mao usab ang dahon — dakpon niini ang enerhiya sa kahayag, ug ang maong enerhiya ang gamiton niini nga pandugtong aron usahon ang tubig ug carbon dioxide ug mahimong asukal. Walay adlaw, walay enerhiya, walay luto!\n\n[image: Photosynthesis diagram of a plant using sunlight, water, and carbon dioxide.]"),
    ("4",
     "Ngano man nga mahulog ang mga butang paubos?",
     "Tungod kana sa gravity! Ang gravity usa ka puwersa nga mobira sa tanang butang padulong sa tunga sa Earth. Mao nga kung buhian nimo ang lapis, dili kini molutaw o mosaka — diretso kining mahulog sa salog.",
     ["fme-gravity-g4"],
     "Wala ko makasabot. Wala man koy makita nga nagbira?",
     "Sakto ka — dili gyud siya makita! Hunahunaa nga adunay taas kaayo nga invisible nga goma nga gihigot sa matag butang ug sa yuta. Dili nimo kini makita, apan bation nimo ang bira: sulayi paglukso — mobalik ka dayon sa yuta, dili ka magpadayon og lupad. Mao kana ang bira sa gravity nga molihok bisan dili nato kini makita."),
    ("5",
     "Ngano man nga lahi-lahi ang solid, liquid, ug gas?",
     "Ang tanang butang hinimo sa gagmay kaayo nga particles, ug ang ilang kahikayan ang kalainan! Hunahunaa ang mga estudyante: sa solid, naglingkod sila nga nagsunod-sunod ug naggunitay sa kamot mao nga dili makahawa sa pwesto. Sa liquid, naglakaw sila nga nagduol-duol apan magbinayloay og puwesto. Sa gas, nagdagan sila nga gawasnon sa tibuok playground!",
     ["solid-liquid-hard-to-squeeze-g5"],
     "Nalibog ko gamay. Mahimo ba og lain nga pananglitan?",
     "Oo gyud! Gamiton nato ang tubig mismo, kay kaya niini mahimong tulo. Yelo: ang mga particle nagsiksikay nga morag sardinas sa lata — naa kiniy porma ug gahi kini. Tubig sa baso: nagdikit gihapon sila apan magdalin-as sa usag usa, mao nga mosunod kini sa porma sa baso. Alisngaw gikan sa takure: nakabuhi na sila ug mikaylap sa tibuok kusina. Usa ra ka tubig, tulo ka porma — depende lang kung giunsa paglihok sa mga particle niini."),
    ("3",
     "Ngano man nga naay buntag ug gabii?",
     "Tungod kay nagtuyok ang Earth nga morag kasing! Samtang nagtuyok kini, ang bahin nga nag-atubang sa Adlaw hayag — buntag didto. Ang bahin nga nagtalikod ngitngit — gabii usab didto. Usa ka tibuok tuyok usa ka tibuok adlaw!",
     ["faq-why-day-night"],
     "Wala ko kasabot. Nganong dili na lang molihok ang Adlaw?",
     "Maayo nga pangutana! Nagpabilin ra gyud ang Adlaw — kita ang naglihok. Nahinumdom ka sa manok sa lechonan nga nagtuyok-tuyok sa kalayo? Wala maglihok ang kalayo, apan madan-agan ug maluto ang matag kilid sa manok tungod kay nagtuyok kini. Mao kana ang Earth: nagtuyok-tuyok kita, mao nga magpuli-puli ang matag kilid nato atubangan sa Adlaw.\n\n[image: A globe lit by a flashlight on one side, showing day and night.]"),
    ("5",
     "Unsa man ang food chain?",
     "Ang food chain morag nagsumpay nga kadena nga magpakita kung kinsa ang mokaon kang kinsa. Pananglitan: sagbot, gikaon sa apan-apan, gikaon sa baki, gikaon sa bitin. Ang matag sumpay sa kadena konektado sa sunod!",
     ["living-food-chain-g5"],
     "Wala ko makasabot anang giingon ninyo nga modagayday ang enerhiya.",
     "Ingon ani: hunahunaa nga ang enerhiya morag baon nga ipasa-pasa. Ang Adlaw ang mohatag sa pinakaunang baon sa sagbot, nga gamiton niini aron motubo. Pagkaon sa apan-apan sa sagbot, nakuha niya ang baon. Pag-abot sa baki ug sa bitin, mao usab — matag mokaon, adunay madawat nga enerhiya nga igalihok ug igabuhi. Mao nga maingon nato nga nagbiyahe ang enerhiya gikan sa Adlaw hangtod sa tumoy sa kadena.\n\n[image: A food chain showing energy passing from plant to grasshopper to frog to snake.]"),
    ("5",
     "Giunsa man pagdagayday sa kuryente sa wire?",
     "Ang kuryente morag tubig nga modagayday sa hose! Ang baterya mao ang gripo nga moduso, ang wire mao ang hose nga agianan, ug ang bombilya mao ang bisibis nga modawat. Kung tibuok ug sirado ang agianan, padayon ang dagayday.",
     ["fme-electricity-g5"],
     "Medyo hanap pa nako kanang sirado nga agianan.",
     "Sulayan nato ang lain nga hulagway: hunahunaa ang usa ka lingin nga pila sa managhigala nga nagpasa-pasa og bola sa paspas kaayo. Samtang kompleto ang lingin, walay hunong ang pasahay. Apan kung mobiya ang usa ka bata, maputol ang lingin — wala nay makapasa, mohunong ang tanan. Mao kana ang circuit: ang switch morag bata nga mahimong mobiya (off) o mobalik (on) sa lingin."),
    ("4",
     "Ngano man nga moginhawa kita?",
     "Moginhawa kita aron makakuha og oxygen! Ang imong lawas morag usa ka dako nga bilding nga puno sa gagmay nga trabahante — ang mga cells. Nagkinahanglan sila og oxygen nga ideliver kanila sa imong baga ug dugo, aron mahimo nila ang ilang trabaho nga magpagawas og enerhiya gikan sa imong gikaon.",
     ["faq-why-we-breathe"],
     "Unsa may gamit sa oxygen? Wala ko kasabot.",
     "Hunahunaa ang kalayo sa sug-ang: aron modilaab ang gas ug makaluto ka, nagkinahanglan kini og hangin. Mao usab sa sulod sa imong lawas — ang pagkaon mao ang sugnod, ug ang oxygen ang magpasiga niini sa hinay-hinay aron mogawas ang enerhiya. Mao nga kung modagan ka ug mas daghang enerhiya ang imong gikinahanglan, mas paspas ug lawom usab ang imong pagginhawa!"),
    ("5",
     "Unsa man ang echo?",
     "Ang echo o lanog mao ang tingog nga mobalik kanimo! Kung mosinggit ka atubangan sa dako nga bungbong o pangpang, ang tingog morag bola nga molukso — motama sa bungbong ug mobalik sa imong dalunggan. Mao nga madungog nimo pag-usab ang imong kaugalingong tingog human sa makadiyot.",
     [],
     "Morag wala gihapon ko kasabot. Giunsa man pagbalik sa tingog?",
     "Hunahunaa ang salamin. Kung motan-aw ka sa salamin, ang kahayag gikan sa imong nawong motama sa hamis nga ibabaw ug mobalik sa imong mata, mao nga makita nimo ang imong repleksyon. Ang echo mao ang 'salamin sa tingog': ang imong tingog mobiyahe sa hangin, motama sa dako ug gahi nga ibabaw, ug ang mobalik nga tingog ang imong madungog. Mas layo ang bungbong, mas dugay ang balik — mao nga adunay lat-ang una nimo madungog ang echo."),
    ("4",
     "Ngano man nga basa ang gawas sa baso nga naay bugnaw nga ilimnon?",
     "Dili kana tulo gikan sa baso! Adunay alisngaw sa tubig nga naglutaw-lutaw sa hangin nga dili nato makita. Kung modikit ang init nga hangin sa bugnaw nga baso, kalit nga mobugnaw ang alisngaw ug mahimong gagmay nga tulo sa tubig — condensation ang tawag ana.",
     ["condensation-cold-glass-g4"],
     "Teacher, nalibog ko. Gikan ba sa sulod sa baso ang tubig?",
     "Dili gikan sa sulod — gikan sa hangin sa palibot! Ingon ani: nakasulay ka ba og ginhawa sa salamin o sa bintana? Mohanap kini ug mobasa, di ba? Ang imong gininhawa adunay dala nga alisngaw, ug inig tama niini sa bugnaw nga salamin, mahimo kining gagmay nga tulo. Mao usab ang mahitabo sa baso: ang hangin sa palibot ang maghatod sa alisngaw, ug ang kabugnaw sa baso ang maghimo niini nga tulo."),
    ("4",
     "Unsa man ang friction?",
     "Ang friction usa ka puwersa nga mopugong sa pagdalin-as kung adunay duha ka ibabaw nga magkiskisay. Mao kini ang hinungdan nganong mohunong ang bola nga nagligid sa sagbot, ug nganong kung mopreno ang bisikleta, mokupot ang goma sa ligid aron mohunong kini.",
     ["fme-friction-g4"],
     "Wala ko kasabot kung asa nako siya makita adlaw-adlaw.",
     "Anaa mismo sa imong tiil! Nganong dili ka madalin-as kung maglakaw ka sa uga nga semento? Tungod kay mokupot ang imong tsinelas sa salog — mao kana ang friction nga imong higala. Apan sulayi paglakaw sa basa nga tiles sa banyo: danlog, kay gipahamis sa tubig ang taliwala sa tsinelas ug salog mao nga moluya ang kupot. Mao gani nga adunay mga sapatos nga daghan og uka sa swelas — pampalig-on kana sa kupot."),
    ("3",
     "Unsa man ang lima ka pandama?",
     "Ang lima ka pandama mao ang mga paagi sa imong lawas aron mahibal-an ang nahitabo sa palibot: panan-aw gamit ang mata, pandungog gamit ang dalunggan, panimaho gamit ang ilong, panilaw gamit ang dila, ug pagbati gamit ang panit. Morag lima sila ka reporter nga kanunay magbalita sa imong utok!",
     [],
     "Wala ko kasabot sa inyong giingon.",
     "Sige, itandi nato sila sa cellphone! Ang imong mata morag camera nga mokuha og litrato sa palibot. Ang imong dalunggan morag mikropono nga mosagap og tingog. Ang imong ilong ug dila morag mga tester nga mosulti kung humot o lami. Ug ang imong panit morag touch screen nga mobati og init, bugnaw, ug hikap. Tanan nilang makuha, ipadala sa imong utok — ang utok ang mobasa sa tanang mensahe."),
    ("8",
     "Unsa man gyud ang atom ug element?",
     "Ang atom mao ang pinakagamay nga piraso sa usa ka element, ug ang element usa ka puro nga sangkap nga usa ra ka klase sa atom ang sulod — sama sa oxygen, gold, o carbon. Hunahunaa sila nga LEGO bricks: pipila ra ka klase ang brick, apan kung usahon sa lain-laing paagi, makahimo ka og kastilyo, sakyanan, o robot!",
     [],
     "Wala ko makasabot kung giunsa pagporma sa tanang butang ang pipila ra ka klase.",
     "Tan-awa ang alpabeto. Kawhaan ug unom ra ka letra kana, apan makahimo kini og minilyon ka pulong — 'adlaw', 'dagat', 'syensya' — depende sa pagkasunod-sunod ug kombinasyon sa mga letra. Mao kana ang mga element: mga usa ka gatos ra sila, apan kung mag-uban ang ilang mga atom sa lain-laing kahikayan, maporma ang tubig, bato, hangin, tanom, ug bisan ikaw."),
    ("6",
     "Ngano man nga gitawag og pump ang kasingkasing?",
     "Tungod kay mao gyud kana ang iyang trabaho! Sama sa poso sa barangay nga moduso sa tubig aron moabot sa mga gripo sa matag balay, ang imong kasingkasing magpuga og magpuga aron iduso ang dugo sa mga ugat padulong sa matag suok sa imong lawas — utok, kamot, hangtod sa kumingking sa tiil.",
     ["living-circulatory-g6"],
     "Unsa to usab? Giunsa man pagpuga sa kasingkasing?",
     "Gunit og usa ka sports bottle nga naay tubig. Kung pisliton nimo kini, mosirit ang tubig pagawas sa tubo, di ba? Pagbuhi nimo, mobalik ang porma niini ug masuyop pag-usab ang sulod. Ang imong kasingkasing usa ka kaunoran nga ingon ana molihok: pislit — gawas ang dugo sa mga agianan; buhi — mapuno kini pag-usab sa dugo nga pabalik. Pislit-buhi, pislit-buhi, mga kapitoan ka beses matag minuto, bisan og natulog ka.\n\n[image: The heart pumping blood in a repeating squeeze-and-fill cycle.]"),
    ("4",
     "Giunsa man pagkahimong tanom ang liso?",
     "Germination ang tawag ana! Ang matag liso morag natulog nga bata nga tanom nga adunay dala nga baon nga pagkaon. Kung makakuha kini og tubig, init, ug hangin, momata kini — mogawas ang gamay nga gamot paubos ug ang gamay nga saha paitaas, hangtod mahimong tibuok nga tanom.",
     ["living-germination-g4"],
     "Wala ko kasabot kung unsa ang mopukaw kaniya.",
     "Hunahunaa nga ang liso usa ka kahon nga adunay tulo ka kandado, ug nagkinahanglan og tulo ka yawi aron maabli: tubig ang unang yawi — mopahumok kini sa panit sa liso; init ang ikaduha — senyales nga sakto na ang panahon aron motubo; ug hangin ang ikatulo — iginhawa sa gamay nga tanom sa sulod. Kung kompleto ang tulo ka yawi, maabli ang kahon ug sugdan sa tanom ang iyang kinabuhi.\n\n[image: Four-step diagram of seed germination: a dry seed underground sprouting into a seedling breaking through the soil, then a young plant with roots and leaves.]"),
    ("5",
     "Ngano man nga mausab ang porma sa bulan?",
     "Ang tinuod, wala mausab ang porma sa bulan — lingin kini kanunay! Ang mausab mao kung unsa kadako ang bahin nga gidan-agan sa Adlaw nga atong makita. Samtang nagtuyok ang bulan sa Earth, lain-laing anggulo ang nahimutangan niini, mao nga lain-lain usab ang porma sa kahayag nga atong malantaw.",
     ["moon-phases-cause-g4"],
     "Morag wala gihapon ko kasabot.",
     "Sulayan nato kini: hunahunaa nga nagbarog ang imong higala ilalom sa poste sa suga sa kagabhion, ug naglakaw siya palibot kanimo. Kung anaa siya sa taliwala nimo ug sa suga, ngitngit ang iyang nawong nga nag-atubang kanimo. Kung anaa na siya sa pikas bahin, hayag na ang tibuok niyang nawong. Sa mga tunga-tunga nga pwesto, katunga o hiwa ra ang madan-agan. Ang bulan ingon usab ana — ug hinumdomi, dili kini anino sa Earth; anggulo ra sa kahayag sa Adlaw."),
    ("6",
     "Ngano man nga tay-on ang puthaw?",
     "Chemical change kana! Kung ang puthaw dugay nga nahumol sa hangin ug tubig, ang mga atom niini makig-react sa oxygen ug maporma ang taya — usa ka bag-o ug lahi na nga sangkap nga pulahon ug daling madugmok. Dili na kini ang kanhing lig-on nga puthaw.",
     ["faq-why-iron-rusts"],
     "Wala ko makasabot anang makig-react.",
     "Nakakita ka na ba og hiniwa nga mansanas nga gibiyaan sa lamesa? Human sa pipila ka minuto, mokape ang unod niini. Tungod kana kay nakig-uban ang oxygen sa hangin sa mga sangkap sa mansanas ug adunay naporma nga bag-o. Ang pagtaya mao ang igsoon niini nga mas hinay: hinay-hinay nga giduol sa oxygen ug tubig ang ibabaw sa puthaw, ug ang maporma nga bag-ong sangkap mao ang pula nga taya nga makita nimo sa daan nga lansang o sin."),
    ("5",
     "Ngano man nga molutaw ang sakayan bisan bug-at?",
     "Tungod sa tinabangay sa sakayan ug tubig! Kung anaa sa tubig ang sakayan, iduso niini ang tubig palayo aron maghimo og luna. Ang tubig usab moduso pabalik paitaas — ug kung igo ang kusog sa maong duso, dili maunlod ang sakayan.",
     ["faq-why-boats-float"],
     "Naglibog ko, nganong ang bato maunlod apan ang barko nga mas bug-at dili?",
     "Anaa sa porma ang sekreto! Sulayi kini sa planggana: ang bola nga hinimo sa clay maunlod dayon. Apan kung ang sama nga clay imong pormahon og morag yahong, molutaw kini! Ang malukong nga porma mokatag sa mas lapad nga tubig ug mas daghang tubig ang maduso palayo, mao nga mas kusog usab ang duso pabalik. Ang barko usa ka dako kaayo nga yahong nga puthaw — haw-ang ang sulod, mao nga bisan bug-at, igo ra ang sapnay sa tubig."),
    ("3",
     "Unsa man ang force?",
     "Ang force usa ka duso o bira! Kung iduso nimo ang karomata, molihok kini. Kung biraon nimo ang pisi, moduol kini kanimo. Ang force ang magpalihok, magpahunong, ug mag-usab sa direksyon sa mga butang sa imong palibot.",
     [],
     "Wala ko kasabot, unsa to usab?",
     "Tan-awon nato ang pultahan sa inyong classroom. Aron maabli kini, biraon nimo ang gunitanan padulong kanimo — bira kana. Aron masirado, idusò nimo kini palayo — duso usab kana. Sa tug-of-war, duha ka grupo ang magbinirahay sa pisi; sa pagdula og holen, itulod sa imong tudlo ang holen aron motama. Tanan nianang lihok, adunay force nga nagbuhat!"),
    ("8",
     "Unsa man ang DNA?",
     "Ang DNA morag recipe book sulod sa halos matag cell nimo! Nakasulat didto ang tanang 'recipe' kung unsaon ka pagporma — kolor sa imong mata, kulot o tul-id nga buhok, gitas-on. Kopya kini sa mga recipe gikan sa imong mama ug papa, mao nga aduna kay kaamgid kanila.",
     ["living-dna-genes-g8"],
     "Wala ko kasabot giunsa pagkasulod sa tanang impormasyon didto.",
     "Hunahunaa ang blueprint sa usa ka arkitekto. Sa pipila ra ka piraso sa papel, anaa na ang tibuok plano sa bilding — sukod sa matag kwarto, agianan sa tubo ug alambre, hangtod sa kolor sa pintura. Siksik kaayo ang impormasyon tungod kay nakasulat kini sa han-ay nga code nga kahibalo basahon sa mga panday. Ang DNA ingon ana: usa ka taas kaayo nga code nga hinimo lang sa upat ka 'letra' nga balik-balik, apan ang pagkasunod-sunod sa maong mga letra mao ang mag-espeling sa tibuok plano sa imong lawas. Ug adunay kompleto nga kopya niini ang halos matag cell!"),
    ("6",
     "Ngano man nga mobuto ang bulkan?",
     "Sa ilalom sa bulkan adunay init nga tinunaw nga bato nga gitawag og magma, kauban ang mga gas nga naipit. Kung magkataas na ang puwersa sa maong mga gas, mangita sila og gawsanan — ug kung dili na makapugong ang taklob, mobuto ang magma, abo, ug gas paitaas!",
     ["faq-why-volcano-erupts"],
     "Wala ko kasabot anang bahin sa puwersa o pressure.",
     "Naka-uyog ka na ba og softdrinks sa botelya? Kung ablihan dayon nimo ang taklob, mobuhagay ang sulod, di ba? Ang pag-uyog nagpukaw sa mga gas sa sulod — nagsiksikay sila ug nangita og gawsanan, ug ang naabli nga taklob ang nahimo nilang agianan. Sa bulkan, ang mga gas sa init nga magma ingon usab ana nga nagsiksikay sulod sa yuta; ang baba sa bulkan mao ang taklob — ug kung dili na kaya sa taklob, buto!\n\n[image: A volcano erupting with lava, ash, and smoke.]"),
    ("7",
     "Unsa man ang kalainan sa physical ug chemical change?",
     "Sa physical change, mausab ra ang dagway apan pareho gihapon ang sangkap — guntingon man nimo ang papel sa gagmay nga piraso, papel gihapon kana. Sa chemical change, adunay BAG-O nga sangkap nga maporma — sunoga ang papel ug mahimo kining abo ug aso; dili na gyud kana papel hangtod sa hangtod.",
     ["matter-physical-chemical-change-g5"],
     "Medyo hanap pa gihapon. Naa pa ba moy lain nga pananglitan?",
     "Gamiton nato ang imong pamahaw! Hiwaa ang linaga nga itlog — physical change: itlog gihapon, gipagamay ra nimo. Apan prituha ang hilaw nga itlog: ang tin-aw nga bahin mahimong puti ug mogahi na — chemical change kana, kay nausab na mismo ang sangkap ug dili na gyud nimo kini mapabalik sa pagkahilaw. Ang yelo nga matunaw sa imong juice? Physical ra — tubig gihapon, nag-ilis ra og porma."),
    ("4",
     "Giunsa man pagporma ang balangaw?",
     "Ang kahayag sa adlaw morag puti tan-awon, apan ang tinuod, sinagol kini nga pito ka kolor! Kung moagi ang kahayag sa mga tulo sa ulan, ang matag tulo morag gamay nga prism nga mobahin sa kahayag ngadto sa pula, kahel, dalag, berde, asul, indigo, ug lila — ug mao kana ang arko nga makita nimo sa langit.",
     ["rainbow-formation-g5"],
     "Unsa man nang prism? Wala ko kasabot.",
     "Kalimti una nato kanang pulonga — maghimo na lang kita og kaugalingong balangaw! Sa usa ka init nga hapon, pabisibis og tubig gikan sa hose sa hardin sa pino kaayo, dayon barog nga nagtalikod sa adlaw. Makakita ka og gamay nga balangaw sa gabon sa bisibis! Ang matag pino nga tulo mobawog sa kahayag ug mobulag niini ngadto sa mga kolor. Ang ulan ingon usab ana — minilyon ka tulo nga dungan nga magbulag sa kahayag.\n\n[image: Spraying a garden hose making a small rainbow in the mist.]"),
    ("6",
     "Unsa man ang inertia?",
     "Ang inertia mao ang batasan sa mga butang nga ipadayon ang ilang gibuhat. Kung naglihok ang usa ka butang, gusto niini nga magpadayon og lihok; kung nagpundo, gusto niini nga magpabilin nga nagpundo — hangtod walay force nga mopugos og usab.",
     [],
     "Wala ko kasabot anang gusto niini nga magpadayon.",
     "Sulayi kini nga magic trick: pagbutang og karton sa ibabaw sa baso, dayon patongi og sinsilyo. Kung biraon nimo og kalit ang karton, dili mokuyog ang sinsilyo — mahulog kini diretso sa sulod sa baso! Ngano? Nagpundo ang sinsilyo, ug dili kini ganahan molihok og kalit; ang karton ra ang nakuha sa ilalom niya. Mao kana ang inertia sa nagpundo nga butang — ug kung anaa ka usab sa sulod sa nagdagan nga sakyanan nga kalit nga mipreno, ang imong lawas ang dili ganahan mohunong ug mopadayon sa unahan."),
    ("6",
     "Ngano man nga asul ang langit?",
     "Ang kahayag sa adlaw adunay tanang kolor, apan dili sila parehas og lihok sa hangin. Pagsulod sa kahayag sa atmospera, ang asul nga kolor ang pinakadali nga ikatag sa mga particle sa hangin sa tanang direksyon — mao nga bisan asa ka motan-aw sa langit, asul ang moabot sa imong mata.",
     ["why-sky-blue-g6"],
     "Wala ko kasabot anang ikatag. Giunsa man pagkatag ang kolor?",
     "Hunahunaa ang daghan kaayo nga gagmay nga bola sa kahanginan — mao kana ang mga particle sa hangin. Ang pula ug dalag nga kahayag morag dagko nga bus nga modiretso lang sa dalan nga halos dili motama sa mga bola. Apan ang asul nga kahayag morag gamay nga bola sa pingpong nga maglukso-lukso kanila — tama dinhi, lukso didto — hangtod makaabot kini sa tanang bahin sa langit. Tungod kay gikan sa tanang direksyon ang asul, asul ang tibuok atop sa kalibutan sa imong panan-aw."),
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

#!/usr/bin/env python3
"""Assemble bisaya-b4.jsonl (Family B, set 4 — 15 adjacent-follow-up dialogues, Cebuano).

Mirror of build-tagalog-b4.py: same fact ids, splits, and tag descs.
Rows 1-10: 4 messages; rows 11-15: 6 messages (two follow-ups).
Follow-ups are NEW adjacent questions — a2/a3 answer the new thing without
re-explaining a1. Grounding only in the FINAL user turn. Plain rows: 6, 7, 15.
Tag rows: 1, 2, 3, 4, 12.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-b4.jsonl")

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

# (grade, [msg1, msg2, ...] alternating user/assistant, [fact ids for the FINAL user turn])
ROWS = [
    # 1 — butanding -> what does it eat (4 msg, tag)
    ("5", [
     "Unsa man ang pinakadako nga isda sa tibuok kalibutan?",
     "Ang butanding o whale shark! Sama kini kataas sa usa ka bus ug mas bug-at pa sa napulo ka sakyanan — ug makita kini mismo sa kadagatan sa Pilipinas, sama sa Donsol. Bisan 'shark' ang ngalan niini, isda gyud kini, dili balyena.",
     "Wow! Unsa man ang kaonon sa ingon ana kadako nga isda? Tawo ba?",
     "Dili ka niya kaonon — ania ang makalingaw nga kamatuoran: ang pinakadako nga isda sa kalibutan mokaon sa halos pinakagagmay nga binuhat sa dagat! Plankton ang pagkaon niini — gagmay kaayo nga tanom ug mananap nga naglutaw sa tubig. Molangoy ang butanding nga nakanganga ang lapad kaayo niini nga baba, salaon ang tubig, ug ang matigom nga plankton ang tunlon. Filter feeder ang tawag sa ingon niini nga paagi sa pagkaon. Mao nga gitawag kini og 'gentle giant' — ug protektado kini sa balaod sa Pilipinas.\n\n[image: A whale shark swimming with its wide mouth open toward a small drifting cloud of tiny plankton.]",
    ], ["butanding-filter-feeder-g5"]),
    # 2 — rust -> how to prevent it (4 msg, tag)
    ("6", [
     "Ngano man nga tay-on ang mga lansang sa gawas sa balay?",
     "Tungod sa duha ka magkakunsabo: oxygen ug tubig! Kung ang puthaw dugay nga nabuyagyag sa hangin ug mabasa, hinay-hinay kining makig-react sa oxygen — ug ang produkto sa maong reaksyon mao ang kahel-kapehon nga taya o rust. Chemical change kini: ang taya dili na puthaw, lahi na kini nga butang.",
     "Unsaon man nako pagpugong nga dili tay-on ang akong bisikleta?",
     "Hinumdomi lang kung unsa ang duha ka gikinahanglan sa taya, ug babagi sila! Una: pabilina nga uga — trapohi ang bisikleta human maulanan ug ayaw kini biyai sa gawas sa tibuok gabii. Ikaduha: butangi og babag — ang pintura, lana, o grasa magsilbing bungbong nga mopugong sa oxygen ug tubig nga modikit mismo sa puthaw. Mao nga pinturahan ang mga taytayan ug lanahan ang kadena sa bisikleta: dili lang pampanindot, panalipod gyud batok sa taya.\n\n[image: An iron nail covered with orange-brown rust patches from reacting with oxygen and water.]",
    ], ["faq-why-iron-rusts"]),
    # 3 — sweat -> why humid days feel worse (4 msg, tag)
    ("5", [
     "Ngano man nga singtan kita kung init?",
     "Ang singot mao ang built-in nga aircon sa imong lawas! Kung moinit ang lawas, magpagawas ang panit og singot. Samtang moalisngaw ang singot gikan sa imong panit, dad-on niini ang init palayo — mao nga mobugnaw ka. Dili basura ang singot; usa kini ka maalamon nga paagi sa pagpabugnaw.",
     "Apan nganong kung sobra ka-humid o alimuot, mas init ug pilit ang akong pamati bisan singot kaayo ko?",
     "Maayo nga obserbasyon — ug adunay eksakto nga siyentipikong hinungdan kana! Ang pagpabugnaw mahitabo lang kung MOALISNGAW ang singot. Kung humid, ang hangin puno na kaayo sa alisngaw sa tubig, mao nga halos walay luna alang sa imong singot nga gusto moalisngaw. Modikit lang kini sa imong panit nga dili makapabugnaw — mao nga alimuot kaayo ka. Mao usab nga mas epektibo ang bentilador sa ingon niini nga adlaw: palihokon niini ang hangin aron matabangan ang imong singot nga moalisngaw.\n\n[image: Skin releasing sweat droplets that evaporate to cool the body.]",
    ], ["faq-why-we-sweat"]),
    # 4 — where rice comes from -> how long it takes (4 msg, tag)
    ("4", [
     "Asa man gikan ang kan-on nga atong ginakaon?",
     "Gikan sa usa ka tanom nga sagbot nga gitawag og humay! Itanom kini sa mga mag-uuma sa basakan, ug kung hinog na, ang mga lugas niini ang anihon. Ang lugas nga adunay panit gitawag og humay; kung tangtangon ang panit sa galingan, mahimo kining bugas; ug kung lutoon, mao na kana ang kan-on sa imong plato!",
     "Unsa man kadugay una mahimong humay nga puwede anihon ang gitanom?",
     "Mga tulo hangtod upat ka bulan ang kasagaran nga hulaton sa mag-uuma! Taas kana nga panaw: magsugod sa binhi, moturok isip semilya nga ibalhin-tanom sa basakan, motubo isip dahonon nga tanom, mamulak, ug sa kataposan mamunga og lugas nga hinay-hinay nga mobug-at ug mahimong bulawanon ang kolor — senyales nga andam na anihon. Busa ang matag lugas sa kan-on sa imong plato gihagoan og pipila ka bulan — ayaw usiki!\n\n[image: The rice plant life cycle showing stages from rice seed to seedling to tillering plant to golden grain ready for harvest.]",
    ], ["lifecycle-rice-plant-g4"]),
    # 5 — planets orbit -> why don't we fall into the sun (4 msg)
    ("5", [
     "Ngano man nga dili molayo ang Earth sa Adlaw? Kinsa man ang nagkupot niini?",
     "Ang gravity sa Adlaw ang nagkupot! Dako kaayo ang Adlaw mao nga kusog kaayo ang bira sa gravity niini — kini ang dili makita nga pisi nga nagkupot sa Earth ug sa tanang walo ka planeta aron magpabilin sila sa ilang agianan o orbit samtang naglibot sila niini.",
     "Apan kung gibira man diay kita sa Adlaw, nganong dili man kita mahulog padulong niini ug masunog?",
     "Nindot kaayo nga pangutana — ania ang sekreto: naglihok ang Earth nga PATAKILID sa hilabihan ka paspas samtang gibira kini sa Adlaw. Hunahunaa ang bato nga gihigot sa pisi nga imong gituyok: gibira kini sa pisi padulong kanimo, apan ang kapaspas sa tuyok niini ang nagpugong nga mahulog kini sa imong kamot. Ingon niana ang Earth — ang bira sa Adlaw ug ang kilid niini nga kapaspas nagbalanse, mao nga naglibot-libot kita sa Adlaw nga dili mahulog niini ug dili usab molupad palayo. Kana mismo ang orbit!",
    ], ["why-planets-orbit-sun-g5"]),
    # 6 — blinking -> eyebrows (4 msg, PLAIN)
    ("3", [
     "Ngano man nga mopilok kita?",
     "Aron limpyohan ug basaon ang imong mga mata! Sa matag pilok, ipahid sa tabon-tabon ang luha sa tibuok mata — sama sa wiper sa sakyanan nga magtangtang sa abog ug magpabilin nga basa ang mata aron dili kini mohapdos. Awtomatiko kining buhaton sa imong lawas sa liboan ka beses kada adlaw nga wala nimo mamatikdi.",
     "Apan ngano man nga naa kitay kilay? Naa ba usab silay trabaho?",
     "Naa, ug importante kini! Ang kilay sama sa atop sa imong mata: babagan niini ang singot gikan sa agtang ug ang tulo sa ulan aron dili modiretso sa imong mata — mao nga dili mohapdos ang imong mata bisan singtan ka sa dula. Naa pa silay katabang: ang pilok, nga maoy mosala sa abog ug gagmay nga butang una makasulod sa mata. Tibuok security team diay ang nagbantay sa imong mga mata!",
    ], []),
    # 7 — stars twinkle -> do planets twinkle (4 msg, PLAIN)
    ("5", [
     "Ngano man nga nagpangidlap-idlap ang mga bituon sa kagabhion?",
     "Dili gyud nagpangidlap ang bituon mismo — ang hangin sa Earth ang naghimo niana! Ang kahayag sa bituon layo kaayo og gibiyahe, ug una kini moabot sa imong mata, moagi pa kini sa baga ug kanunay naglihok nga hangin sa ibabaw nato. Ang naglihok nga hangin maoy magbawog-bawog sa kahayag — mao nga morag nagpangidlap kini.",
     "Ang mga planeta ba sama sa Venus, nagpangidlap usab?",
     "Halos dili — ug kana mismo ang tinago nga paagi sa mga astronomo aron mailhan sila! Ang bituon layo ra kaayo mao nga usa lang kini ka gamay kaayo nga tuldok sa kahayag nga dali rang mabawog sa hangin. Ang planeta mas duol, mao nga sa tinuod usa kini ka gamay nga lingin sa kahayag — ug ang kahayag gikan sa tibuok lingin dili dali nga malihok nga dungan. Busa sa sunod nga makakita ka og hayag nga 'bituon' nga kalmado ug wala nagpangidlap, lagmit planeta kana!",
    ], []),
    # 8 — fog -> dew (4 msg)
    ("5", [
     "Unsa man kanang baga nga puti nga morag aso sa Baguio matag kaadlawon?",
     "Fog o gabon kana! Dili kana aso — hinimo kini sa gagmay kaayo nga tulo sa tubig nga naglutaw duol sa yuta, morag panganod nga nanaog. Maporma kini kung ang alisngaw sa tubig sa hangin mobugnaw pag-ayo, sama sa bugnaw nga kaadlawon sa kabukiran sa Baguio.",
     "Lahi ba kana sa yamog nga makita nako sa mga sagbot ug dahon matag buntag?",
     "Mag-igsoon sila apan lahi ang puloy-anan! Pareho silang gikan sa alisngaw sa tubig nga mibugnaw — apan ang fog mga tulo nga NAGLUTAW pa sa hangin, samtang ang yamog o dew mga tulo nga MIDIKIT na sa bugnaw nga mga ibabaw sama sa sagbot, dahon, ug atop sa sakyanan. Kung bugnaw ang gabii, ang alisngaw nga modampi sa bugnaw nga sagbot mahimong tulo didto mismo. Mao nga basa ang imong tsinelas paglakaw sa kasagbotan sa buntag bisan wala mag-ulan!",
    ], ["fog-formation-g5", "dew-formation-g5"]),
    # 9 — volcanic ash -> what to do in ashfall (4 msg)
    ("6", [
     "Ngano man nga delikado ang abo gikan sa bulkan? Abo ra man unta kana di ba?",
     "Mas peligroso kini kaysa sa hitsura niini! Ang abo sa bulkan dili sama sa abo sa papel — hinimo kini sa gagmay kaayo ug hait nga piraso sa dinugmok nga bato ug bildo. Daotan kini nga maginhawa kay samaran niini ang baga, makapahapdos kini sa mata, ug kung mobaga kini sa atop, kaya niini ipahugno ang balay tungod sa kabug-at — labi na kung mabasa sa ulan.",
     "Unsa man ang angay namong buhaton kung naay ashfall sa among lugar?",
     "Hinumdomi ang tulo ka panguna nga lakang. Una, pabilin sa sulod sa balay ug sirad-i ang mga bintana ug pultahan aron dili makasulod ang abo. Ikaduha, kung kinahanglan gyud nga mogawas, pagsul-ob og mask o taboni ang ilong ug baba og basa nga panapton, ug panalipdi ang mga mata. Ikatulo, taboni ang mga sudlanan sa tubig ug pagkaon aron dili masagolan. Ug kung mohunong na, tabangi ang mga hamtong sa paglimpyo sa atop — apan hinay-hinay ug ayaw pag-inusara.",
    ], ["volcano-ash-cloud-g6"]),
    # 10 — handwashing -> why soap matters (4 msg)
    ("3", [
     "Ngano man nga kinahanglan manghunaw una mokaon?",
     "Tungod kay naay mga mikrobyo sa imong mga kamot nga dili nimo makita! Ang mga mikrobyo gagmay kaayo nga buhi nga butang nga makapasakit kanimo — makuha sila sa mga hawiranan, dulaan, kuwarta, ug bisan unsa pa nga imong hikapon sa tibuok adlaw. Kung mokaon ka nga wala manghunaw, mosakay sila sa pagkaon padulong sa imong tiyan.",
     "Dili ba puwede nga tubig ra? Nganong kinahanglan pa man og sabon?",
     "Naa man guy espesyal nga gahom ang sabon nga wala sa tubig! Daghang mikrobyo ang nagkapyot sa nipis nga lana o mantika sa imong panit, ug dili kaya sa tubig nga tangtangon ang lana — modalin-as lang kini sa ibabaw. Ang sabon ang tigpataliwala: huboton niini ang lana uban ang mga mikrobyo nga nagkapyot didto, aron maanod silang tanan sa tubig. Busa ang sakto nga paagi: sabon, kuso-kusoha og mga 20 segundos — kanta sa 'Happy Birthday' og kaduha — unya hugasi!",
    ], ["germs-and-handwashing-g3"]),
    # 11 — how we see -> pupil in the dark -> why two eyes (6 msg)
    ("5", [
     "Giunsa man nato pagkakita?",
     "Kahayag ang tibuok sekreto sa panan-aw! Ang mga butang sa imong palibot mobalik o mo-reflect sa kahayag, ug kana nga kahayag mosulod sa imong mata. Sa sulod, himoon kining mensahe nga ipadala sa utok — ug ang imong utok ang moporma sa hulagway nga imong 'makita'. Mao nga sa hingpit nga kangitngit, wala kay makita: walay kahayag nga ikabalik ang mga butang.",
     "Ngano man nga modako kanang itom nga lingin sa tunga sa akong mata kung ngitngit?",
     "Maayo kang mo-obserbar! Kanang itom nga lingin mao ang pupil — dili kana itom nga butang kondili usa ka LUNGAG nga agianan sa kahayag. Kung ngitngit, gamay ra ang kahayag, mao nga padak-on sa imong mata ang lungag aron mas daghan ang makasulod — sama sa pag-abli pag-ayo sa bintana sa madag-um nga adlaw. Kung hayag kaayo pud, mogamay kini aron dili masilaw ang sulod sa imong mata.",
     "Apan ngano man nga duha ang atong mata? Dili ba puwede nga usa na lang?",
     "Dako gyud ang bentaha sa pagkaduha! Magkalayo og gamay ang imong duha ka mata, mao nga gamay rang magkalahi ang makita sa matag usa. Isagol sa imong utok ang duha ka hulagway aron mahusgahan kung unsa KALAYO ang mga butang — depth perception ang tawag niana. Sulayi: piyonga ang usa ka mata ug sulayi nga pagtagboon ang tumoy sa duha ka lapis nga nag-atubangay — mas lisod! Kana ang trabaho nga mahimo lang kung duha ka mata ang magtinabangay.",
    ], ["why-two-eyes-g4"]),
    # 12 — coconuts by the sea -> how other seeds travel -> why fruit is sweet (6 msg, tag)
    ("4", [
     "Ngano man nga daghan kaayog lubi sa baybayon? Kinsa man ang nagtanom kanila?",
     "Kasagaran, walay nagtanom — ang dagat mismo ang naghatod kanila! Ang tibuok lubi usa ka dako kaayo nga liso nga kahibalo molutaw: ang baga ug hanginon nga bunot niini ang nagsilbing salbabida. Kung mahulog ang lubi sa tubig, mahimo kining ilayag sa balod sa layo kaayo, ug kung modunggo kini sa laing baybayon, didto kini motubo isip bag-ong punoan.",
     "Ang ubang mga liso, giunsa man nila pag-abot sa layo? Dili man sila molutaw.",
     "Lain-lain ang ilang sakyanan! Naay mga liso nga sakay sa HANGIN — gaan sila ug naay pako o balhibo nga morag payong, sama sa liso sa cotton tree nga ipadpad sa huros. Naay mga liso nga sakay sa MANANAP — ang uban naay tunok nga mokapyot sa balhibo sa moagi nga mananap, libre nga masakay hangtod matangtang sa layo. Ug naay mga liso nga tagoan sa mga mananap sama sa ardilya nga usahay makalimtan — mao nga motubo sila kung asa gilubong!",
     "Ah mao diay nga tam-is ang prutas! Aron kaonon sa mananap unya madala nila ang liso sa layo?",
     "Eksakto — natag-an nimo ang plano sa tanom! Ang tam-is ug madanihong prutas usa ka pagdapit: 'kaona ko!' Kung kaonon sa langgam o kabog ang prutas, kauban ang liso nga dili matunaw sa tiyan, ug ihulog nila kini sa layong lugar nga naa pay kauban nga pataba. Daog ang duha: busog ang mananap, nakabiyahe ang liso. Mao nga ang tanom nga dili makalakaw makaabot gihapon sa layo!\n\n[image: A tall coconut palm tree by the seashore with a crown of long fronds and coconuts clustered below them.]",
    ], ["seed-dispersal-animals-g5", "coconut-floats-disperses-g5"]),
    # 13 — lightning before thunder -> what thunder is -> measuring distance (6 msg)
    ("6", [
     "Ngano man nga mauna ang kilat una ang dalugdog? Dili ba dungan sila?",
     "Dungan gyud silang natawo — dungan nga mahitabo ang kilat ug dalugdog sa usa ka pagbuto! Apan lahi ang kapaspas sa ilang pagbiyahe padulong kanimo: ang kahayag halos diha-diha dayon moabot, samtang ang tingog hinay nga mobiyahe sa hangin. Mao nga makita una nimo ang pagkidlap una nimo madungog ang dahunog — mas layo ang kilat, mas taas ang gintang nila.",
     "Unsa man gyud diay ang dalugdog? Asa man gikan kanang kusog nga boom?",
     "Sa hilabihang kainit sa kilat! Ang kilat mas init pa sa makadiyot kaysa sa ibabaw sa Adlaw, ug kung moagi kini sa hangin, ang hangin nga naagian niini kalit kaayo nga moinit ug moburot sa hilabihan ka paspas. Ang kalit nga pagbuto sa hangin nga mao ang maghimo sa kusog kaayo nga tingog nga atong madungog isip dalugdog. Busa dili sila managlahi nga panghitabo — ang dalugdog mao ang SABA sa kilat mismo.",
     "Mahibal-an ba nako kung unsa kalayo ang kilat gikan kanako?",
     "Mahimo, ug yano ra nga pag-ihap ang gikinahanglan! Pagkakita nimo sa pagkidlap, pag-ihap og segundos hangtod madungog nimo ang dalugdog: usa... duha... tulo... Ang tingog modagan og mga usa ka kilometro matag tulo ka segundo. Busa kung nakaihap ka og unom ka segundo, mga duha ka kilometro ang gilay-on sa kilat. Kung magkagamay ang ihap sa matag kilat, nagkaduol ang bagyo — panahon na nga mosulod sa balay!",
    ], ["thunder-after-lightning-g5", "thunder-cause-g6"]),
    # 14 — is the sun a star -> why stars look white -> looking into the past (6 msg)
    ("6", [
     "Tinuod ba nga bituon ang atong Adlaw?",
     "Tinuod kaayo! Ang Adlaw usa ka bituon — ang pinakaduol kanato sa tanan. Mura lang kini og dako kaayo ug makasilaw tungod kay silingan nato kini, samtang ang ubang mga bituon anaa sa dili-matugkad nga kalayo. Kung imong ipalayo ang Adlaw sama kalayo sa ubang bituon, mahisama usab kini sa gamay nga tuldok sa kahayag sa kagabhion.",
     "Ngano man nga dalag ang Adlaw apan puti ra ang mga bituon sa gabii?",
     "Naa gyuy mga kolor ang mga bituon — kaso hanap ra sila kaayo aron makita sa atong mata ang kolor! Naay mga bituon nga asul, nga mao ang pinakainit; naay dalag nga kasarangan ang kainit, sama sa atong Adlaw; ug naay pula, nga mao ang pinakabugnaw kanila. Sa hinay kaayo nga kahayag, dili kaayo makakita og kolor ang atong mata mao nga morag puti silang tanan — apan tan-awa pag-ayo ang pinakahayag ug mamatikdan nimo nga may diyutay nga pagpula o pagngasul ang uban.",
     "Matod sa akong kuya, kung motan-aw daw kita sa mga bituon, motan-aw kita sa kagahapon. Tinuod ba kana?",
     "Tinuod, ug usa kana sa pinakakatingalahang kamatuoran sa siyensiya! Ang kahayag adunay kapaspas, ug bisan ang Adlaw nga silingan nato — mga walo ka minuto una moabot kanato ang kahayag niini. Buot ipasabot, ang Adlaw nga imong makita karon mao ang hitsura niini walo ka minuto na ang milabay! Ang ubang mga bituon tuig, gatosan, o liboan ka tuig ang gibiyahe sa kahayag — busa ang kidlap nga imong gitan-aw karong gabhiona basin mibiya sa bituon una pa matawo ang imong lolo ug lola.",
    ], ["sun-light-eight-minutes-g6"]),
    # 15 — largest organ -> really? -> what skin does (6 msg, PLAIN)
    ("5", [
     "Unsa man ang pinakadako nga organ sa atong lawas?",
     "Andam ka ba sa tubag? Ang imong PANIT! Oo, organ ang panit — ug tungod kay giputos niini ang tibuok nimong lawas gikan sa ulo hangtod sa lapalapa, kini ang pinakadako sa tanan.",
     "Tinuod? Abi nako'g ang kasingkasing o ang utok ang pinakadako.",
     "Nasabtan nako ang imong tag-an — sikat man gud sila! Apan hunahunaa ang gidak-on: ang imong kasingkasing sama ra kadako sa imong kinumo, ug ang utok mahaluna sa duha ka hakop. Ang panit? Kung imong mahukas kini nga tibuok nga morag sinina, moabot kini og halos duha ka metro kwadrado sa hamtong — sama kadako sa gamay nga habol! Walay laing organ nga ingon niana kalapad.",
     "Unsa man ang mga trabaho sa panit gawas sa pagputos?",
     "Daghan siyag dungan nga trabaho! Una, taming siya: babagan niya ang mga mikrobyo, hugaw, ug adlaw aron dili makasulod sa sulod. Ikaduha, aircon siya: magpagawas siya og singot aron pabugnawon ka, ug dungan niana, ipagawas usab niya ang sobrang tubig ug asin sa lawas. Ikatulo, sensor siya: tungod sa imong panit mabati ang init, bugnaw, sakit, ug ang gakos sa imong mama. Pamutos, taming, aircon, ug sensor — upat ka trabaho sa usa lang ka organ!",
    ], []),
]

with open(OUT, "w") as f:
    for grade, msgs, fids in ROWS:
        assert len(msgs) % 2 == 0
        out = []
        last_user = len(msgs) - 2  # final user turn index
        for i, content in enumerate(msgs):
            role = "user" if i % 2 == 0 else "assistant"
            if i == last_user:
                content = grounded(fids, content)
            out.append({"role": role, "content": content})
        f.write(json.dumps({"grade": grade, "messages": out}, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")

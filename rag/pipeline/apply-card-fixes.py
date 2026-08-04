#!/usr/bin/env python3
"""One-shot patch for the 2026-07 card-feed audit (rag/pipeline/audit-cards.py):

  1. Tightens the 66 over-budget (>48-word) factoid language variants in
     rag/bank/factoids.jsonl — compression only, facts preserved; targets <=46 words
     for the displayed text (Q hook + body for `qa` format).
  2. Fixes the one real duplicate-option MCQ in rag/bank/quiz-bank.jsonl:
     barrier-reef-separated-by-lagoon-g8 option[3] "A gulf" was translated "Look" in
     tl AND bis, colliding with option[2] "A bay" = "Look" → "Golpo".

Self-verifying: re-counts every patched displayed text and fails if any is still
>48 words. Regenerate downstream artifacts afterwards:

  python3 rag/pipeline/gen-cards-pool.py && python3 rag/pipeline/gen-cards-questions.py
"""
import json, sys

FACTOIDS = 'rag/bank/factoids.jsonl'
QUIZBANK = 'rag/bank/quiz-bank.jsonl'

# factoid id -> lang -> {field: new text}; field is 'q' (hook) and/or 'text' (body)
P = {
 'ffct-01770': {'bis': {'text': "Modikit ang gecko tungod sa huyang kaayo nga puwersa tali sa mga molekula nga gitawag og van der Waals forces. Gamay ang gahum sa usa ka balhibo, apan minilyon kini — igo na aron mokupot ang tibuok lawas niini."}},
 'ffct-02350': {'en': {'text': "A slug is like a snail without a shell! With no home to hide in, it stays in damp, dark places to avoid drying out or being spotted by enemies — a snail's shell keeps it safer."}},
 'ffct-03357': {'bis': {'q': "Asa makit-an ang usa sa pinakadagko nga kolonya sa paniki?", 'text': "Sa Monfort Bat Cave sa Samal Island duol sa Davao, minilyon ka paniki ang nagbitay nga nagdasok sa bungbong — usa kini sa pinakadagko nga kolonya sa fruit bat sa kalibutan!"}},
 'ffct-06235': {'bis': {'text': "Padayong mosulod ang tubig sa paramecium kay mas tabang ang tubig sa gawas — ang contractile vacuole, sama sa bomba, moibot sa sobrang tubig pagawas aron dili kini mobuto!"}},
 'ffct-06536': {'bis': {'text': "Ang nagsiga nga pamingwit sa anglerfish usa ka adaptasyon aron mabuhi kini. Diyutay ang pagkaon sa lawom nga dagat, mao nga maghulat lang kini ug paduolon ang biktima sa kahayag — makatipid og enerhiya."}},
 'ffct-06553': {'tl': {'text': "Nangyayari ito dahil sa codominance: nakuha mo ang gene ng A mula sa isang magulang at ang gene ng B mula sa isa — PAREHO silang lumalabas! Walang nananaig, kaya sabay ang dalawang antigen."},
                'bis': {'text': "Mahitabo kini tungod sa codominance: nakuha nimo ang gene sa A gikan sa usa ka ginikanan ug ang gene sa B gikan sa lain — PAREHO sila nagpakita! Walay modaog, mao nga dungan mogawas ang duha ka antigen."}},
 'ffct-06567': {'tl': {'text': "Mas malaki ang Great Barrier Reef ng Australia, pero mas maraming uri ng coral at isda kada sukat ang bahura ng Pilipinas — nasa gitna tayo ng Coral Triangle, ang may pinakamaraming buhay-dagat sa mundo!"},
                'bis': {'text': "Mas dako ang Great Barrier Reef sa Australia, apan mas daghan ang matang sa coral ug isda kada sukod sa bahura sa Pilipinas — anaa kita sa sentro sa Coral Triangle, ang labing adunahan og kinabuhi sa dagat!"}},
 'ffct-08771': {'tl': {'text': "Ang babaeng crown-of-thorns starfish ay kayang maglabas ng higit 60 milyong itlog sa isang taon — kapag sagana ang pagkain at kaunti ang predator, sumasabog ang populasyon nito at nasisira ang mga reef sa loob ng ilang buwan!"},
                'bis': {'text': "Ang babaye nga crown-of-thorns starfish makahimo og labaw sa 60 milyon nga itlog matag tuig — kon daghan ang pagkaon ug gamay ang mandaragit, mosabog ang populasyon niini ug malaglag ang mga reef!"}},
 'ffct-09027': {'bis': {'text': "Baho og lami ang monarch butterfly kay mikaon kini og makahilo nga milkweed sa ulod pa kini, ug nagpabilin ang hilo sa lawas niini — kon kan-on sa langgam, masakit kini ug dili na mosulay pag-usab!"}},
 'ffct-09425': {'bis': {'text': "Dili eksaktong parehas! Ang active fault usa lang ka liki sa yuta nga nagalihok; ang plate boundary mao ang dako nga ngilit tali sa higante nga mga tipak sa yuta."}},
 'ffct-11515': {'bis': {'text': "Ang ordinaryong tanom malaya sa parat nga yuta kay gisuyop sa asin ang tubig sa gamot niini. Apan ang bakhaw kaya mobabag o mopagawas sa asin — dili kini giuhaw bisan sa tubig-dagat!"}},
 'ffct-12636': {'bis': {'text': "Ang sea otter! Sa panit nga sama kadako sa imong kuko, adunay gatosan ka libo hangtod halos usa ka milyon ka lugas sa balahibo — ang tibuok ulo nimo mga gatos ka libo ra!"}},
 'ffct-12785': {'tl': {'text': "Pareho silang arthropod — walang buto sa loob, may matigas na balat sa labas, at mga paang may buko-buko. Pero ang alimango ay may sampung paa at sipit at nasa tubig; ang gagamba ay walo at nasa lupa."},
                'bis': {'text': "Parehong arthropod sila — walay bukog sa sulod, gahi ang panit sa gawas, ug mga tiil nga may buko-buko. Apan ang alimango may napulo ka tiil ug sipit ug anaa sa tubig; ang lawalawa may walo ug anaa sa yuta."}},
 'ffct-12796': {'tl': {'text': "Dahil ang magkamag-anak na halaman, tulad ng kamatis, talong, at patatas, ay may parehong peste at sakit. Ang pagpapalit ng kamag-anak nito ay hindi nakakaputol sa siklo — pumili ng pananim mula sa ibang pamilya."},
                'bis': {'text': "Tungod kay ang managparyente nga tanom, sama sa kamatis, talong, ug patatas, adunay parehong peste ug sakit. Ang pag-ilis og paryente niini dili makaputol sa siklo — pagpili og tanom gikan sa laing pamilya."}},
 'ffct-12853': {'bis': {'text': "Daghang tambal ang gikan sa mga mananap sa coral reef. Adunay sponge ug kuhol sa dagat nga mohimo og espesyal nga kemikal nga gihimong tambal batok sa kanser — busa ang pag-amping sa reef pag-amping usab sa umaabot nga tambal."}},
 'ffct-13755': {'tl': {'text': "May maliliit na algae sa loob ng coral na gumagawa ng pagkain mula sa sikat ng araw at nagbibigay ng kulay dito. Kapag sobrang init ng tubig, umaalis ang algae at namumuti ang coral — ito ang coral bleaching."},
                'bis': {'text': "Adunay gagmayng algae nga nagpuyo sulod sa coral nga naghimo og pagkaon gikan sa adlaw ug naghatag sa kolor niini. Kon mainit kaayo ang tubig, mobiya ang algae ug mamuti ang coral — mao ang coral bleaching."}},
 'ffct-13985': {'tl': {'text': "Ang archerfish, na nabubuhay sa mga ilog at baybayin ng Pilipinas, ay pinatutumba ang mga insekto sa sanga gamit ang tumpak na jet ng tubig mula sa bibig — nakakapag-adjust pa ito sa pagbaluktot ng liwanag sa tubig!"},
                'bis': {'text': "Ang archerfish, nga makita sa mga suba ug estero sa Pilipinas, makapukan ang mga insekto sa sanga gamit ang tukma nga jet sa tubig gikan sa baba niini — makapag-adjust pa kini sa pagbaliko sa suga sa tubig!"}},
 'ffct-14197': {'tl': {'text': "Maraming batang reyna ang lumilipad nang sabay-sabay, pero karamihan namamatay — kinakain ng ibon o hindi nakakahanap ng ligtas na lugar. Iilan lang ang nakakapagsimula ng sariling kolonya — kaya mahalaga ang bawat nabubuhay na reyna!"},
                'en': {'text': "Huge numbers of young queens fly out together, but most die — eaten by birds or unable to find a safe spot. Only a few succeed in starting their own colony, which is why every surviving queen matters!"},
                'bis': {'text': "Daghan kaayong batan-ong reyna ang molupad nga dungan, apan kadaghanan mamatay — kaonon sa langgam o dili makakita og luwas nga dapit. Pipila ra ang molampos sa pagsugod og kaugalingong kolonya — importante kaayo ang matag buhi nga reyna!"}},
 'ffct-16704': {'tl': {'q': "Bakit iisa ang itsura ng salt water, pero sa halo-halo nakikita ang sangkap?", 'text': "Ang homogeneous mixture ay iisa ang itsura sa buong bahagi, gaya ng asin sa tubig. Ang heterogeneous mixture ay nakikita pa ang magkakaibang bahagi, gaya ng halo-halo!"}},
 'ffct-17836': {'bis': {'q': "Kinsa ang una nga nagpuno og oxygen sa hangin sa Kalibutan?", 'text': "Ang hangin sa kalibotan dati gamay ra ang oxygen! Ang gagmay kaayong buhi nga gitawag og cyanobacteria mao ang una nga nagsugod sa paghimo og oxygen pinaagi sa photosynthesis, hinay-hinay nga nagpuno sa hangin."}},
 'ffct-18031': {'tl': {'text': "Ang kawayan ay damo at isa sa pinakamabilis lumalagong halaman sa mundo — kayang lumaki ng ilang sentimetro sa isang araw! Ginagamit din itong matibay at magaan na materyal sa pagtatayo."},
                'bis': {'text': "Ang kawayan balili ug usa sa pinakapaspas motubo nga tanom sa kalibutan — motubo og pipila ka sentimetro sa usa ka adlaw! Gigamit usab kini nga lig-on ug gaan nga materyales sa pagtukod."}},
 'ffct-18426': {'tl': {'q': "Paano nakalalakad sa tubig ang water striders?", 'text': "Naglalakad sa tubig ang mga water striders salamat sa surface tension! Ang mga larva ng lamok ay nagsususpende rin sa ibabaw, kaya ang pag-aalis ng standing water ay nagpipigil sa pagpapalaki ng lamok."}},
 'ffct-23772': {'bis': {'q': "Kaya bang itulod sa butang ang iyang kaugalingon?", 'text': "Dili! Ang aksyon ug reaksyon kanunay mahitabo tali sa DUHA ka lain-laing butang. Kanunay adunay A nga motulod kang B, ug si B motulod balik kang A, busa kanunay duha ka apil!"}},
 'ffct-23878': {'bis': {'q': "Nahibaw-an ba nimo nga ang kanon natipigan nga kahayag sa adlaw?", 'text': "Sa kaumahan sa Pilipinas, gigamit sa humay ang photosynthesis aron himuon ang sugar ug starch gikan sa enerhiya sa adlaw! Gitipigan kini sa lugas, nga mao ang bugas nga atong giluto."}},
 'ffct-24571': {'tl': {'text': "Oo! Maliit lang ang kuryenteng kailangan ng LED, kaya kaya itong paandarin ng baterya o powerbank — kaya nasa mga laruan at flashlight ito. Ang bulb sa bahay may parte na nagbabago ng kuryente mula sa saksakan."},
                'bis': {'text': "Oo! Gamay ra ang kuryente nga gikinahanglan sa LED, mao nga makaya kini sa baterya o powerbank — naa kini sa mga dulaan ug flashlight. Ang bulb sa balay adunay parte nga mag-usab sa kuryente gikan sa saksakan."}},
 'ffct-24614': {'tl': {'text': "Mas malakas ang force mo, mas malaki ang pagbabago sa galaw! Bahagyang tulak ang bola, mahina ang gulong; malakas na tulak, mas mabilis at mas malayo. Ang pagbabago ay nakadepende sa lakas ng force!"}},
 'ffct-25251': {'tl': {'text': "Oo! Ang OTEC (Ocean Thermal Energy Conversion) gumagamit ng pagkakaiba ng temperatura ng mainit na tubig sa ibabaw at malamig na tubig sa kalaliman para sa kuryente. Malaki ang potensyal ng tropical na dagat ng Pilipinas!"},
                'bis': {'text': "Oo! Ang OTEC (Ocean Thermal Energy Conversion) naggamit sa pagkalahi sa temperatura sa mainit nga tubig sa nawong ug malamig nga tubig sa kalaliman aron makahimo og kuryente. Dako ang potensyal sa dagat sa Pilipinas!"}},
 'ffct-25569': {'bis': {'q': "Unsaon pagkasabot sa mga musikero sa parehas nga pitch?", 'text': "Ang notang A4 sa musika adunay standard nga frequency nga 440 Hz — kini ang primary reference pitch nga gigamit sa mga musikero sa tibuok kalibutan sa pag-tune sa ilang mga instrumento!"}},
 'ffct-31480': {'bis': {'q': "Nganong baliko ang layer sa bato sa pipila ka bukid?", 'text': "Ang mga baliko ug nakatupi nga layer sa bato sama sa balod! Ebidensya kini nga ang yuta kusganong gitulak gikan sa duha ka tumoy sa dugay nga panahon, hangtod nakuhal pataas ang kanhi patag nga bato."}},
 'ffct-31551': {'tl': {'q': "Ano ang fault?", 'text': "Ang fault ay bitak sa balat ng Earth kung saan gumagalaw ang dalawang panig ng lupa. Kapag biglang dumulas ang mga ito, nayayanig ang lupa — lindol! Kaya nagdi-drill tayo ng duck, cover, at hold — lalo na't may West Valley Fault sa Metro Manila!"},
                'en': {'q': "What is a fault?", 'text': "A fault is a crack in Earth's surface where two sides of the ground can move. When they suddenly slip, the ground shakes — an earthquake! That's why we practice duck, cover, and hold — especially with the West Valley Fault near Metro Manila!"},
                'bis': {'q': "Unsa ang fault?", 'text': "Ang fault usa ka liki sa panit sa Kalibutan diin ang duha ka kilid sa yuta makalihok. Kung kalit silang modahili, mauyog ang yuta — linog! Mao nga magdrill ta og duck, cover, ug hold — kay naa ang West Valley Fault sa Metro Manila!"}},
 'ffct-31553': {'bis': {'text': "Ang habagat usa ka init nga hangin nga mohuyop gikan sa habagatang-kasadpan panahon sa init! Magdala kini og umog nga hangin gikan sa dagat, busa kusog ang ulan sa kasadpang Pilipinas gikan Hunyo hangtod Septyembre."}},
 'ffct-31554': {'tl': {'text': "Ang amihan ay malamig na hangin mula sa hilagang-silangan, mula Disyembre hanggang Pebrero! Dala nito ang malamig at tuyong hangin — kaya presko ang panahon, lalo na tuwing Pasko. Kasalungat ito ng habagat na nagdadala ng ulan."},
                'en': {'text': "The amihan is a cool wind that blows from the northeast from December to February! It brings cool, dry air — that's why the weather feels crisp, especially around Christmas. It's the opposite of the habagat, which brings rain."},
                'bis': {'text': "Ang amihan usa ka bugnaw nga hangin nga mohuyop gikan sa amihanang sidlakan gikan Disyembre hangtod Pebrero! Magdala kini og bugnaw ug uga nga hangin — mao nga presko ang panahon, ilabi na sa Pasko. Sukwahi kini sa habagat nga magdala og ulan."}},
 'ffct-31561': {'tl': {'text': "Karamihan sa tubig natin ay nagsisimula bilang ulan sa mga bundok! Umaagos ito pababa sa mga sapa at ilog papunta sa mga lungsod at bukid, at ang ilan ay iniipon sa mga dam para sa inumin at patubig."},
                'bis': {'text': "Daghan sa atong tubig nagsugod isip ulan sa mga bukid! Modagayday kini paubos sa mga sapa ug suba padulong sa mga siyudad ug uma, ug ang uban gitipigan sa mga dam para sa imnon ug patubig."}},
 'ffct-32665': {'tl': {'q': "Paano tumutulong ang mga geostationary satellite sa pagbabantay ng panahon?", 'text': "Ang mga geostationary satellite tulad ng Himawari ng Japan ay nakatira sa itaas ng isang fixed point sa Earth. Nagbibigay sila ng patuloy na larawan ng mga ulap at bagyo sa Pilipinas at Asya bawat sampung minuto!"},
                'bis': {'q': "Unsaon pagtabang sa mga geostationary satellite sa pagmonitor sa panahon?", 'text': "Ang mga geostationary satellite sama sa Himawari nagpabilin sa ibabaw sa usa ka fixed point sa Yuta. Naghatag kini og padayon nga mga larawan sa mga panganod ug bagyo sa Pilipinas ug Asya matag napulo ka minuto!"}},
 'ffct-32801': {'bis': {'q': "Nganong grabe kusog mousabog ang mga bulkan sama sa Mayon?", 'text': "Kadaghanan sa bulkan sa Pilipinas mga stratovolcano nga may alternating nga layer sa lava ug pyroclastic material. Ang baga ug viscous nga lava nagkulong sa gas — hinungdan sa grabe kusog nga pagsabog!"}},
 'ffct-32861': {'tl': {'q': "Ano ang ammonite?", 'text': "Ang ammonite ay mga extinct na cephalopod na may coiled shell — kamag-anak ng squid! Napakalawak at napakarami nila kaya ginagamit silang index fossils para sa Mesozoic rocks. Namatay silang lahat sa asteroid impact 66 milyong taon na ang nakalipas."},
                'en': {'q': "What are ammonites?", 'text': "Ammonites were extinct cephalopods with coiled shells, like squid relatives! They were so diverse and widespread that scientists use them as index fossils to date Mesozoic rocks. All ammonites died out with the asteroid impact 66 million years ago."},
                'bis': {'q': "Unsa ang ammonite?", 'text': "Ang mga ammonite mga extinct nga cephalopod nga may lingin nga kabhang — paryente sa pusit! Kaylap ug lain-lain sila kaayo, mao nga gigamit sila ingon index fossils para sa Mesozoic rocks. Namatay silang tanan sa asteroid impact 66 milyong tuig ang milabay."}},
 'ffct-32866': {'tl': {'q': "Paano nabuo ang mga karst tower ng El Nido?", 'text': "Sikat ang El Nido, Palawan sa mga karst tower nito: mga patayong limestone walls na tumatayo mula sa dagat! Nabuo ang mga ito sa milyun-milyong taon habang tinunaw ng ulan ang limestone at iniwan ang pinakamatigas na bahagi."},
                'en': {'q': "How did El Nido's karst towers form?", 'text': "El Nido, Palawan is famous for its dramatic karst towers: tall vertical limestone walls rising straight from the sea and lagoons! They formed over millions of years as rainwater dissolved the limestone and left the strongest parts standing."},
                'bis': {'q': "Unsaon pagporma sa mga karst tower sa El Nido?", 'text': "Bantog ang El Nido, Palawan sa mga karst tower niini: mga patindog nga limestone walls nga motindog gikan sa dagat! Naporma kini sa milyon-milyon ka tuig samtang gitunaw sa ulan ang limestone ug gibilin ang pinakalig-on nga bahin."}},
 'ffct-32954': {'tl': {'text': "Ang volcanic ash ay nakakapinsala sa kalusugan! Ang pino nitong particle ay pumapasok sa baga at nagdudulot ng respiratory problems. Dapat magsuot ng mask, manatili sa loob, at linisin ang abo sa bubong — ang basang abo ay sobrang bigat, pwedeng magpaguho ng bahay!"},
                'bis': {'text': "Ang volcanic ash makadaot sa kalusugan! Ang pino nga particle niini mosulod sa baga ug magdulot og respiratory problems. Kinahanglang magsuot og mask, magpabilin sa sulod, ug limpyohon ang abo sa bubong — ang basang abo bug-at kaayo, makapaguba sa balay!"}},
 'ffct-33118': {'bis': {'text': "Ang satellite mao ang bisan unsang butang nga nag-orbit sa mas dako nga butang! Natural sama sa Moon sa Yuta; artificial mga spacecraft nga gihimo sa tawo, sama sa ISS ug GPS satellites."}},
 'ffct-33134': {'tl': {'text': "Ang inner planets — Mercury, Venus, Earth, Mars — ay rocky planets na may solid surface. Ang outer planets — Jupiter, Saturn, Uranus, Neptune — ay gas o ice giants na walang solid ground. Ang asteroid belt ang nasa pagitan nila!"},
                'bis': {'text': "Ang inner planets — Mercury, Venus, Earth, Mars — mga rocky planets nga may solid surface. Ang outer planets — Jupiter, Saturn, Uranus, Neptune — mga gas o ice giants nga walay solid ground. Ang asteroid belt anaa sa taliwala nila!"}},
 'ffct-33145': {'tl': {'q': "Paano ginagamit ng ilang kalendaryo ang Moon?", 'text': "Maraming tradisyonal na kalendaryo tulad ng Islamic at Chinese calendars ang gumagamit ng lunar month — ang cycle ng phases ng Moon — bilang batayan ng mga buwan. Ang lunar month ay mga 29.5 araw, mas maikli kaysa solar month!"},
                'bis': {'q': "Unsaon paggamit sa ubang kalendaryo sa Moon?", 'text': "Daghang tradisyonal nga kalendaryo sama sa Islamic ug Chinese calendars naggamit sa lunar month — ang cycle sa phases sa Moon — isip basehan sa mga buwan. Ang lunar month mga 29.5 ka adlaw, mas mubo kaysa solar month!"}},
}

def disp(r, lang):
    q = ((r.get('q') or {}).get(lang) or '').strip()
    t = ((r.get('text') or {}).get(lang) or '').strip()
    return f'{q}\n\n{t}'.strip() if r.get('format') == 'qa' and q else t

# ---- patch factoids.jsonl ----
rows = [json.loads(l) for l in open(FACTOIDS) if l.strip()]
patched = fails = 0
for r in rows:
    fix = P.get(r['id'])
    if not fix:
        continue
    for lang, fields in fix.items():
        before = len(disp(r, lang).split())
        for field, val in fields.items():
            r.setdefault('q' if field == 'q' else 'text', {}).setdefault(lang, '')
            r['q' if field == 'q' else 'text'][lang] = val
        after = len(disp(r, lang).split())
        patched += 1
        status = 'OK ' if after <= 48 else 'FAIL'
        if after > 48:
            fails += 1
        print(f'{status} {r["id"]} [{lang}] {before}w -> {after}w')
with open(FACTOIDS, 'w') as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + '\n')
missing = set(P) - {r['id'] for r in rows if r['id'] in P}
if missing:
    print('MISSING IDS:', sorted(missing)); fails += 1

# ---- patch quiz-bank.jsonl (barrier-reef "Look"/"Look" -> "Golpo") ----
qrows = [json.loads(l) for l in open(QUIZBANK) if l.strip()]
quiz_fixed = 0
for r in qrows:
    if r['factId'] == 'barrier-reef-separated-by-lagoon-g8':
        opt = r['options'][3]
        assert opt['en'] == 'A gulf', opt
        assert opt['tl'] == 'Look' and opt['bis'] == 'Look', opt
        opt['tl'] = opt['bis'] = 'Golpo'
        quiz_fixed += 1
with open(QUIZBANK, 'w') as f:
    for r in qrows:
        f.write(json.dumps(r, ensure_ascii=False) + '\n')

print(f'\nfactoid variants patched: {patched} | quiz rows fixed: {quiz_fixed} | failures: {fails}')
sys.exit(1 if fails or quiz_fixed != 1 else 0)

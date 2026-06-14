#!/usr/bin/env python3
"""Assemble tagalog-b1.jsonl (Family B1 "di ko gets" — 25 rows, 4 messages each).

u1 asks; a1 explains with analogy #1; u2 says they didn't get it (grounding block
in this FINAL user turn for ~80%% of rows); a2 re-explains with a COMPLETELY new
analogy — no recycled phrasing (validator rejects shared 8-grams). ~1/3 of rows
end a2 with a fitting [image:] tag. Plain (no-grounding) u2 rows: 9, 12, 13, 19, 24.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-b1.jsonl")

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

# (grade, u1, a1, [fact ids for u2], u2-msg, a2, tag-or-None)
ROWS = [
    ("4",
     "Ano po ang water cycle?",
     "Ang water cycle ay ang paikot-ikot na paglalakbay ng tubig! Ang init ng araw ay nagpapasingaw ng tubig mula sa dagat at ilog (evaporation), ang singaw ay umaakyat at nagiging ulap (condensation), at kapag mabigat na ang ulap, bumubuhos ito bilang ulan (precipitation). Tapos uulit ulit ang ikot na iyan!",
     ["earth-water-cycle-g4"],
     "Di ko po gets yung evaporation. Paano umaakyat ang tubig?",
     "Sige, isipin mo ang sinampay na basang damit. Pagkatapos ng ilang oras sa init ng araw, tuyo na ito — saan napunta ang tubig? Naging napakaliliit na singaw ito na lumipad sa hangin, sobrang liit na hindi mo na nakikita. Ganyan din ang nangyayari sa dagat araw-araw: dahan-dahang inaangat ng init ang tubig bilang singaw, at iyan ang unang hakbang ng ikot.\n\n[image: The water cycle showing the Sun warming the ocean, water evaporating and rising into clouds, and rain falling on mountains.]"),
    ("5",
     "Paano po gumagawa ng pagkain ang halaman?",
     "Photosynthesis ang tawag diyan! Para itong lutuan sa loob ng dahon: ang mga sangkap ay tubig mula sa ugat, carbon dioxide mula sa hangin, at liwanag ng araw bilang panggatong ng lutuan. Ang luto? Asukal na pagkain ng halaman — at may bonus pang oxygen na inilalabas para sa atin!",
     ["living-photosynthesis-g5"],
     "Naguluhan po ako. Saan po pumapasok yung araw dun?",
     "Isipin mo na ang bawat dahon ay parang solar panel. Ang solar panel ay sumisipsip ng enerhiya mula sa sikat ng araw para magkaroon ng kuryente ang bahay, di ba? Ganoon din ang dahon — hinuhuli nito ang enerhiya ng liwanag, at ang enerhiyang iyon ang ginagamit nitong pandikit para pagsamahin ang tubig at carbon dioxide at maging asukal. Walang araw, walang enerhiya, walang luto!\n\n[image: Photosynthesis diagram of a plant using sunlight, water, and carbon dioxide.]"),
    ("4",
     "Bakit po bumabagsak ang mga bagay pababa?",
     "Dahil iyan sa gravity! Ang gravity ay puwersang humihila ng lahat ng bagay papunta sa gitna ng Earth. Kaya kapag binitawan mo ang lapis, hindi ito lumulutang o tumataas — diretso itong bumabagsak sa sahig.",
     ["fme-gravity-g4"],
     "Hindi ko po maintindihan. Wala naman akong nakikitang humihila?",
     "Tama ka — hindi talaga siya nakikita! Isipin mo na may sobrang habang invisible na goma na nakatali sa bawat bagay at sa lupa. Hindi mo ito nakikita, pero ramdam mo ang hatak: subukan mong tumalon — bumabalik ka agad sa lupa, hindi ka tuloy-tuloy na lumilipad. Iyan ang hila ng gravity na gumagana kahit hindi natin ito kita.",
     None),
    ("5",
     "Bakit po iba-iba ang solid, liquid, at gas?",
     "Lahat ng bagay ay gawa sa napakaliliit na particles, at ang ayos nila ang pinagkaiba! Isipin mo ang mga estudyante: sa solid, nakaupo sila nang sunud-sunod na magkahawak-kamay kaya hindi makaalis sa pwesto. Sa liquid, naglalakad sila nang magkakalapit pero nagpapalit-palit ng puwesto. Sa gas, tumatakbo sila nang malaya sa buong playground!",
     ["solid-liquid-hard-to-squeeze-g5"],
     "Nosebleed po ako konti. Pwede po ibang halimbawa?",
     "Oo naman! Gamitin natin ang tubig mismo, kasi kaya niyang maging tatlo. Yelo: ang mga particle ay siksikan na parang sardinas sa lata — may hugis ito at matigas. Tubig sa baso: magkakadikit pa rin sila pero dumudulas-dulas sa isa't isa, kaya sumusunod ito sa hugis ng baso. Singaw mula sa takure: kumawala na sila at kumakalat sa buong kusina. Iisang tubig, tatlong anyo — depende lang kung paano gumagalaw ang mga particle nito.",
     None),
    ("3",
     "Bakit po may umaga at gabi?",
     "Dahil umiikot ang Earth na parang trumpo! Habang umiikot ito, ang bahaging nakaharap sa Araw ay maliwanag — umaga doon. Ang bahaging nakatalikod ay madilim — gabi naman doon. Isang buong ikot ay isang buong araw!",
     ["faq-why-day-night"],
     "Di ko po gets. Bakit hindi na lang gumalaw yung Araw?",
     "Magandang tanong! Nakatigil lang talaga ang Araw — tayo ang gumagalaw. Naalala mo ang manok sa lechonan na paikot-ikot sa apoy? Hindi gumagalaw ang apoy, pero nailalawan at nailuluto ang bawat gilid ng manok dahil umiikot ito. Ganyan ang Earth: paikot-ikot tayo, kaya halinhinan ang bawat panig natin sa harap ng Araw.\n\n[image: A globe lit by a flashlight on one side, showing day and night.]"),
    ("5",
     "Ano po ang food chain?",
     "Ang food chain ay parang magkakabit na kadena na nagpapakita kung sino ang kumakain kanino. Halimbawa: damo, kinain ng tipaklong, kinain ng palaka, kinain ng ahas. Ang bawat kawing ng kadena ay konektado sa susunod!",
     ["living-food-chain-g5"],
     "Hindi ko po maintindihan yung sinabi nyong dumadaloy ang enerhiya.",
     "Ganito: isipin mo na ang enerhiya ay parang baon na ipinapasa. Ang Araw ang nagbibigay ng pinakaunang baon sa damo, na ginagamit nito para lumaki. Pagkain ng tipaklong sa damo, nakuha niya ang baon. Pagdating sa palaka at sa ahas, ganoon din — bawat kumain, may natanggap na enerhiyang panggalaw at pambuhay. Kaya masasabi nating naglalakbay ang enerhiya mula sa Araw hanggang sa dulo ng kadena.\n\n[image: A food chain showing energy passing from plant to grasshopper to frog to snake.]"),
    ("5",
     "Paano po dumadaloy ang kuryente sa wire?",
     "Ang kuryente ay parang tubig na dumadaloy sa hose! Ang baterya ang gripo na nagtutulak, ang wire ang hose na dinadaluyan, at ang bombilya ang dilig na tumatanggap. Kapag buo at sarado ang daanan, tuloy-tuloy ang agos.",
     ["fme-electricity-g5"],
     "Medyo malabo pa po sa akin yung sarado na daanan.",
     "Subukan natin ang ibang larawan: isipin mo ang isang pabilog na pila ng magkakaibigan na nagpapasa-pasa ng bola nang mabilis. Hangga't kumpleto ang bilog, walang tigil ang pasahan. Pero kapag umalis ang isang bata, maputol ang bilog — wala nang makapagpasa, titigil ang lahat. Ganyan ang circuit: ang switch ay parang batang pwedeng umalis (off) o bumalik (on) sa bilog.",
     None),
    ("4",
     "Bakit po tayo humihinga?",
     "Humihinga tayo para makakuha ng oxygen! Ang katawan mo ay parang isang malaking gusali na puno ng maliliit na manggagawa — ang mga cells. Kailangan nila ng oxygen na deliver sa kanila ng iyong baga at dugo, para magawa nila ang trabaho nilang magpalabas ng enerhiya mula sa kinain mo.",
     ["faq-why-we-breathe"],
     "Ano po ulit ang gamit ng oxygen? Di ko po gets.",
     "Isipin mo ang apoy sa kalan: para magliyab ang gas at makapagluto ka, kailangan nito ng hangin. Ganyan din sa loob ng katawan mo — ang pagkain ang panggatong, at ang oxygen ang nagpapaningas dito nang dahan-dahan para lumabas ang enerhiya. Kaya kapag tumatakbo ka at mas maraming enerhiya ang kailangan mo, mas mabilis at malalim ka ring humihinga!",
     None),
    ("5",
     "Ano po ang echo?",
     "Ang echo o alingawngaw ay tunog na bumabalik sa iyo! Kapag sumigaw ka sa harap ng malaking pader o bangin, ang tunog ay parang bolang tumatalbog — tumama sa pader at bumalik sa tainga mo. Kaya naririnig mo ulit ang sarili mong boses pagkalipas ng saglit.",
     [],
     "Parang di ko pa rin gets. Paano bumabalik yung tunog?",
     "Isipin mo ang salamin. Kapag tumingin ka sa salamin, ang liwanag mula sa mukha mo ay tumatama sa makinis na ibabaw at bumabalik sa mata mo, kaya nakikita mo ang repleksyon mo. Ang echo ay 'salamin ng tunog': ang boses mo ay naglalakbay sa hangin, tumatama sa malaki at matigas na ibabaw, at ang bumabalik na tunog ang naririnig mo. Mas malayo ang pader, mas matagal ang balik — kaya may pagitan bago mo marinig ang echo.",
     None),
    ("4",
     "Bakit po basa ang labas ng baso na may malamig na inumin?",
     "Hindi iyan tagas! May singaw ng tubig na palutang-lutang sa hangin na hindi natin nakikita. Kapag dumikit ang mainit na hanging iyon sa malamig na baso, lumalamig bigla ang singaw at nagiging maliliit na patak ng tubig — condensation ang tawag diyan.",
     ["condensation-cold-glass-g4"],
     "Teacher, nalito po ako. Galing po ba sa loob ng baso yung tubig?",
     "Hindi galing sa loob — galing sa hangin sa paligid! Ganito: nasubukan mo bang huminga sa salamin o sa bintana? Nagiging malabo ito at basa, di ba? Ang hininga mo ay may dalang singaw, at pagtama nito sa malamig na salamin, nagiging maliliit na patak ito. Ganoon din ang nangyayari sa baso: ang hangin sa paligid ang naghahatid ng singaw, at ang lamig ng baso ang gumagawa nitong patak.",
     None),
    ("4",
     "Ano po ang friction?",
     "Ang friction ay puwersang pumipigil sa pagdulas kapag may dalawang ibabaw na nagkikiskisan. Ito ang dahilan kung bakit humihinto ang bola na gumugulong sa damuhan, at kung bakit kapag nagprepreno ang bisikleta, kumakapit ang goma sa gulong para tumigil ito.",
     ["fme-friction-g4"],
     "Hindi ko po gets kung saan ko siya nakikita araw-araw.",
     "Nasa paa mo mismo! Bakit hindi ka nadudulas kapag naglalakad ka sa tuyong semento? Dahil kumakapit ang tsinelas mo sa sahig — iyan ang friction na kaibigan mo. Pero subukan mong maglakad sa basang tiles ng banyo: madulas, kasi pinapakinis ng tubig ang pagitan ng tsinelas at sahig kaya humihina ang kapit. Kaya nga may mga sapatos na maraming uka sa swelas — pampalakas ng kapit iyon.",
     None),
    ("3",
     "Ano po ang limang pandama?",
     "Ang limang pandama ay ang mga paraan ng katawan mo para malaman ang nangyayari sa paligid: paningin gamit ang mata, pandinig gamit ang tainga, pang-amoy gamit ang ilong, panlasa gamit ang dila, at pandama gamit ang balat. Para silang limang reporter na laging nagbabalita sa utak mo!",
     [],
     "Di ko po gets yung sinabi nyo.",
     "Sige, ihambing natin sila sa cellphone! Ang mata mo ay parang camera na kumukuha ng litrato ng paligid. Ang tainga mo ay parang mikropono na sumasagap ng tunog. Ang ilong at dila mo ay parang mga tester na nagsasabi kung mabango o masarap. At ang balat mo ay parang touch screen na nakakaramdam ng init, lamig, at dampi. Lahat ng nakukuha nila, ipinapadala sa utak mo — ang utak ang nagbabasa ng lahat ng mensahe.",
     None),
    ("8",
     "Ano po ba talaga ang atom at element?",
     "Ang atom ang pinakamaliit na piraso ng isang element, at ang element ay purong sangkap na iisang uri lang ng atom ang laman — tulad ng oxygen, gold, o carbon. Isipin mo silang LEGO bricks: iilan lang ang uri ng brick, pero kapag pinagsama-sama sa iba't ibang paraan, nakakabuo ka ng kastilyo, kotse, o robot!",
     [],
     "Hindi ko po maintindihan paano nakakabuo ng lahat ng bagay ang kaunting uri lang.",
     "Tingnan mo ang alpabeto. Dalawampu't anim na titik lang iyan, pero kaya nitong bumuo ng milyun-milyong salita — 'araw', 'dagat', 'agham' — depende sa pagkakasunod-sunod at kombinasyon ng mga titik. Ganyan ang mga element: humigit-kumulang isang daan lang sila, pero kapag nagsama-sama ang kanilang mga atom sa iba't ibang ayos, nabubuo ang tubig, bato, hangin, halaman, at maging ikaw.",
     None),
    ("6",
     "Bakit po tinatawag na pump ang puso?",
     "Dahil iyan mismo ang trabaho niya! Katulad ng poso sa barangay na nagtutulak ng tubig para umabot sa mga gripo ng bawat bahay, ang puso mo ay pumipiga nang pumipiga para itulak ang dugo sa mga ugat papunta sa bawat sulok ng katawan mo — utak, kamay, hanggang hinliliit ng paa.",
     ["living-circulatory-g6"],
     "Ano po ulit? Paano po pumipiga yung puso?",
     "Hawakan mo ang isang sports bottle na may tubig. Kapag pinisil mo ito, sumisirit ang tubig palabas sa tubo, di ba? Pagbitaw mo, bumabalik ang hugis nito at nahihigop ulit ang laman. Ang puso mo ay kalamnang ganyan gumalaw: pisil — labas ang dugo sa mga daluyan; luwag — puno ulit ito ng dugong pabalik. Pisil-luwag, pisil-luwag, mga pitumpung beses kada minuto, kahit tulog ka.\n\n[image: The heart pumping blood in a repeating squeeze-and-fill cycle.]"),
    ("4",
     "Paano po nagiging halaman ang buto?",
     "Germination ang tawag diyan! Ang bawat buto ay parang natutulog na sanggol na halaman na may dalang baon na pagkain. Kapag nakakuha ito ng tubig, init, at hangin, magigising ito — lalabas ang munting ugat pababa at ang munting usbong paitaas, hanggang maging ganap na halaman.",
     ["living-germination-g4"],
     "Di ko po gets kung ano ang gumigising sa kanya.",
     "Isipin mo na ang buto ay isang kahon na may tatlong kandado, at kailangan ng tatlong susi para mabuksan: tubig ang unang susi — pinalalambot nito ang balat ng buto; init ang pangalawa — senyales na tamang panahon na para tumubo; at hangin ang pangatlo — panghinga ng munting halaman sa loob. Kapag kumpleto ang tatlong susi, bubukas ang kahon at sisimulan ng halaman ang buhay nito.\n\n[image: Four-step diagram of seed germination: a dry seed underground sprouting into a seedling breaking through the soil, then a young plant with roots and leaves.]"),
    ("5",
     "Bakit po nagbabago ang hugis ng buwan?",
     "Ang totoo, hindi nagbabago ang hugis ng buwan — bilog ito palagi! Ang nagbabago ay kung gaano kalaki ang bahaging naiilawan ng Araw na nakikita natin. Habang umiikot ang buwan sa Earth, iba-ibang anggulo ang kinalalagyan nito, kaya iba-iba rin ang hugis ng liwanag na natatanaw natin.",
     ["moon-phases-cause-g4"],
     "Parang hindi ko pa rin po gets.",
     "Subukan natin ito: isipin mong nakatayo ang kaibigan mo sa ilalim ng poste ng ilaw sa gabi, at naglalakad siya paikot sa iyo. Kapag nasa pagitan mo siya at ng ilaw, madilim ang mukha niyang nakaharap sa iyo. Kapag nasa kabilang panig na siya, buong liwanag ang mukha niya. Sa mga gitnang pwesto, kalahati o hiwa lang ang naiilawan. Ang buwan ay ganyan din — at tandaan, hindi ito anino ng Earth; anggulo lang ng ilaw ng Araw.",
     None),
    ("6",
     "Bakit po kinakalawang ang bakal?",
     "Chemical change iyan! Kapag ang bakal ay matagal na nakababad sa hangin at tubig, ang mga atom nito ay nakikipag-react sa oxygen at nabubuo ang kalawang — isang bago at iba nang sangkap na mapula-pula at madaling madurog. Hindi na ito ang dating matibay na bakal.",
     ["faq-why-iron-rusts"],
     "Hindi ko po maintindihan yung nakikipag-react.",
     "May nakita ka na bang hiniwang mansanas na iniwan sa mesa? Pagkalipas ng ilang minuto, kumukulay-kayumanggi ang laman nito. Iyon ay dahil nakipagsama ang oxygen sa hangin sa mga sangkap ng mansanas at may nabuong bago. Ang pagkakalawang ay kapatid niyang mas mabagal: unti-unting kinakausap ng oxygen at tubig ang ibabaw ng bakal, at ang nabubuong bagong sangkap ay ang mapulang kalawang na nakikita mo sa lumang pako o yero.",
     None),
    ("5",
     "Bakit po lumulutang ang bangka kahit mabigat?",
     "Dahil sa tulungan ng bangka at tubig! Kapag nasa tubig ang bangka, itinutulak nito ang tubig palayo para gumawa ng espasyo. Ang tubig naman ay tumutulak pabalik paitaas — at kapag sapat ang lakas ng tulak na iyon, hindi lulubog ang bangka.",
     ["faq-why-boats-float"],
     "Naguluhan po ako, bakit po yung bato lumulubog pero yung barko na mas mabigat hindi?",
     "Nasa hugis ang sikreto! Subukan mo ito sa planggana: ang bolang gawa sa clay ay lulubog agad. Pero kung ang parehong clay ay hubugin mong parang mangkok, lulutang ito! Ang malukong na hugis ay kumakalat sa mas malawak na tubig at mas maraming tubig ang naitutulak palayo, kaya mas malakas din ang tulak pabalik. Ang barko ay isang dambuhalang mangkok na bakal — guwang ang loob, kaya kahit mabigat, sapat ang sustento ng tubig.",
     None),
    ("3",
     "Ano po ang force?",
     "Ang force ay tulak o hila! Kapag tinulak mo ang kariton, gumagalaw ito. Kapag hinila mo ang lubid, lumalapit ito sa iyo. Ang force ang nagpapagalaw, nagpapatigil, at nagpapabago ng direksyon ng mga bagay sa paligid mo.",
     [],
     "Di ko po gets, ano po ulit?",
     "Tingnan natin ang pinto ng inyong classroom. Para buksan ito, hinihila mo ang hawakan papunta sa iyo — hila iyon. Para isara, itinutulak mo ito palayo — tulak naman iyon. Sa tug-of-war, dalawang grupo ang naghihilahan ng lubid; sa paglalaro ng holen, tinutulak ng daliri mo ang holen para tumama. Lahat ng galaw na iyan, may force na gumagawa!",
     None),
    ("8",
     "Ano po ang DNA?",
     "Ang DNA ay parang recipe book sa loob ng halos bawat cell mo! Nakasulat doon ang lahat ng 'recipe' kung paano ka bubuuin — kulay ng mata mo, kulot o tuwid na buhok, tangkad. Kopya ito ng mga recipe mula sa nanay at tatay mo, kaya may pagkakahawig ka sa kanila.",
     ["living-dna-genes-g8"],
     "Hindi ko po gets paano nagkasya ang lahat ng impormasyon doon.",
     "Isipin mo ang blueprint ng isang arkitekto. Sa ilang pirasong papel lang, naroon na ang buong plano ng gusali — sukat ng bawat kwarto, daanan ng tubo at kawad, hanggang kulay ng pintura. Napakasiksik ng impormasyon dahil nakasulat ito sa maayos na code na alam basahin ng mga karpintero. Ang DNA ay ganyan: isang napakahabang code na gawa lang sa apat na 'titik' na paulit-ulit, pero ang pagkakasunod-sunod ng mga titik na iyon ang nagbabaybay ng buong plano ng katawan mo. At may kumpletong kopya nito ang halos bawat cell!",
     None),
    ("6",
     "Bakit po sumasabog ang bulkan?",
     "Sa ilalim ng bulkan ay may mainit na tunaw na bato na tinatawag na magma, kasama ang mga gas na naiipit. Kapag tumaas na nang tumaas ang diin ng mga gas na iyon, hahanap sila ng labasan — at kapag bumigay ang takip, sasabog ang magma, abo, at gas paitaas!",
     ["faq-why-volcano-erupts"],
     "Di ko po gets yung tungkol sa diin o pressure.",
     "May naalog ka na bang softdrinks sa bote? Kapag binuksan mo agad ang takip, bubulwak ang laman, di ba? Ang pag-alog ay gumising sa mga gas sa loob — nagsiksikan sila at naghanap ng labasan, at ang bukas na takip ang naging daan nila. Sa bulkan, ang mga gas sa mainit na magma ay ganyan ding nagsisiksikan sa loob ng lupa; ang bunganga ng bulkan ang takip — at kapag hindi na kaya ng takip, putok!\n\n[image: A volcano erupting with lava, ash, and smoke.]"),
    ("7",
     "Ano po ang pagkakaiba ng physical at chemical change?",
     "Sa physical change, nagbabago lang ang anyo pero pareho pa rin ang sangkap — gupitin mo man ang papel sa maliliit na piraso, papel pa rin iyon. Sa chemical change, may BAGONG sangkap na nabubuo — sunugin mo ang papel at magiging abo at usok ito; hindi na iyon papel kailanman.",
     ["matter-physical-chemical-change-g5"],
     "Medyo malabo pa po. May iba pa po bang halimbawa?",
     "Gamitin natin ang almusal mo! Hiwain mo ang itlog na nilaga — physical change: itlog pa rin, pinaliit mo lang. Pero prituhin mo ang hilaw na itlog: ang malinaw na bahagi ay nagiging puti at buo na — chemical change iyan, dahil nagbago na mismo ang sangkap at hinding-hindi mo na ito maibabalik sa pagkahilaw. Ang yelo namang natutunaw sa juice mo? Physical lang — tubig pa rin, nagpalit lang ng anyo.",
     None),
    ("4",
     "Paano po nabubuo ang bahaghari?",
     "Ang liwanag ng araw ay mukhang puti, pero ang totoo, pinaghalong pitong kulay ito! Kapag dumaan ang liwanag sa mga patak ng ulan, ang bawat patak ay parang maliit na prism na humahati sa liwanag sa pula, kahel, dilaw, berde, asul, indigo, at lila — at iyan ang arkong nakikita mo sa langit.",
     ["rainbow-formation-g5"],
     "Ano po yung prism? Di ko po naintindihan.",
     "Kalimutan muna natin ang salitang iyon — gumawa na lang tayo ng sariling bahaghari! Sa isang maaraw na hapon, magpawisik ka ng tubig mula sa hose sa hardin nang pinong-pino, tapos tumayo ka nang nakatalikod sa araw. Makakakita ka ng munting bahaghari sa ulap ng wisik! Ang bawat pinong patak ay binabaluktot ang liwanag at hinahati ito sa mga kulay nito. Ang ulan ay ganyan din — milyun-milyong patak na sabay-sabay na naghahati ng liwanag.\n\n[image: Spraying a garden hose making a small rainbow in the mist.]"),
    ("6",
     "Ano po ang inertia?",
     "Ang inertia ay ang ugali ng mga bagay na ipagpatuloy ang ginagawa nila. Kapag gumagalaw ang isang bagay, gusto nitong patuloy na gumalaw; kapag nakatigil, gusto nitong manatiling nakatigil — hangga't walang force na pumipilit magbago.",
     [],
     "Hindi ko po gets yung gusto nitong magpatuloy.",
     "Subukan mo ang magic trick na ito: maglagay ka ng karton sa ibabaw ng baso, tapos patungan mo ng barya. Kapag hinatak mo nang mabilis ang karton, hindi sasama ang barya — mahuhulog ito diretso sa loob ng baso! Bakit? Nakatigil ang barya, at ayaw nitong gumalaw nang basta-basta; ang karton lang ang naalis sa ilalim niya. Iyan ang inertia ng nakatigil na bagay — at kapag nasa loob ka naman ng tumatakbong sasakyan na biglang nagpreno, ang katawan mo ang ayaw huminto at sumusulong pa.",
     None),
    ("6",
     "Bakit po asul ang langit?",
     "Ang liwanag ng araw ay may lahat ng kulay, pero hindi sila pare-pareho kung kumilos sa hangin. Pagpasok ng liwanag sa atmospera, ang asul na kulay ang pinakamadaling ikalat ng mga particle ng hangin sa lahat ng direksyon — kaya saan ka man tumingin sa langit, asul ang umaabot sa mata mo.",
     ["why-sky-blue-g6"],
     "Di ko po gets yung ikinakalat. Paano po ikinakalat ang kulay?",
     "Isipin mo ang napakaraming maliliit na bola sa himpapawid — iyan ang mga particle ng hangin. Ang pula at dilaw na liwanag ay parang malalaking bus na dumideretso lang sa daan nang halos hindi tumatama sa mga bola. Pero ang asul na liwanag ay parang maliit na bolang pingpong na tumatalbog-talbog sa kanila — tama rito, talbog doon — hanggang mapunta ito sa lahat ng dako ng langit. Dahil galing sa lahat ng direksyon ang asul, asul ang buong bubong ng mundo sa paningin mo.",
     None),
]

with open(OUT, "w") as f:
    for grade, u1, a1, fids, u2, a2, *_ in [r + (None,) * (7 - len(r)) for r in ROWS]:
        row = {"grade": grade, "messages": [
            {"role": "user", "content": u1},
            {"role": "assistant", "content": a1},
            {"role": "user", "content": grounded(fids, u2)},
            {"role": "assistant", "content": a2},
        ]}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")

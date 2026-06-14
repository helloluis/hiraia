#!/usr/bin/env python3
"""Assemble tagalog-b4.jsonl (Family B, set 4 — 15 adjacent-follow-up dialogues).

Rows 1-10: 4 messages (u1 -> a1 -> u2 adjacent follow-up -> a2).
Rows 11-15: 6 messages (two follow-ups, each digging one step further).
The follow-up is a NEW adjacent question — a2/a3 answer the new thing without
re-explaining a1 (anti-repetition). Grounding only in the FINAL user turn
(<=2 facts in 6-msg rows); plain rows: 6, 7, 15.
5 rows end with a fitting [image:] tag (1, 2, 3, 4, 12).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-b4.jsonl")

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

# (grade, [msg1, msg2, ...] alternating user/assistant, [fact ids for the FINAL user turn])
ROWS = [
    # 1 — butanding -> what does it eat (4 msg, tag)
    ("5", [
     "Ano po ang pinakamalaking isda sa buong mundo?",
     "Ang butanding o whale shark! Kasinghaba ito ng isang bus at mas mabigat pa sa sampung kotse — at makikita ito mismo sa karagatan ng Pilipinas, tulad ng sa Donsol. Kahit 'shark' ang pangalan nito, isda talaga ito, hindi balyena.",
     "Wow! Ano po ang kinakain ng ganun kalaking isda? Tao po ba?",
     "Hindi ka niya kakainin — heto ang nakakatuwang katotohanan: ang pinakamalaking isda sa mundo ay kumakain ng halos pinakamaliliit na nilalang sa dagat! Plankton ang pagkain nito — napakaliliit na halaman at hayop na lumulutang sa tubig. Lumalangoy ang butanding nang nakabuka ang napakalapad nitong bibig, sinasala ang tubig, at ang naiipong plankton ang nilulunok. Filter feeder ang tawag sa ganitong paraan ng pagkain. Kaya tinatawag itong 'gentle giant' — at protektado ito ng batas ng Pilipinas.\n\n[image: A whale shark swimming with its wide mouth open toward a small drifting cloud of tiny plankton.]",
    ], ["butanding-filter-feeder-g5"]),
    # 2 — rust -> how to prevent it (4 msg, tag)
    ("6", [
     "Bakit po kinakalawang ang mga pako sa labas ng bahay?",
     "Dahil sa dalawang magkasabwat: oxygen at tubig! Kapag ang bakal ay matagal na nakalantad sa hangin at nababasa, dahan-dahan itong nakikipag-react sa oxygen — at ang produkto ng reaksyong iyon ay ang kulay kahel-kayumangging kalawang o rust. Chemical change ito: ang kalawang ay hindi na bakal, ibang bagay na ito.",
     "Paano ko po mapipigilan na kalawangin ang bisikleta ko?",
     "Tandaan mo lang kung ano ang dalawang kailangan ng kalawang, at harangan mo sila! Una: panatilihing tuyo — punasan ang bisikleta pagkatapos maulanan at huwag itong iwan sa labas magdamag. Pangalawa: lagyan ng harang — ang pintura, langis, o grasa ay nagsisilbing pader na pumipigil sa oxygen at tubig na dumikit mismo sa bakal. Kaya pinipinturahan ang mga tulay at nilalangisan ang kadena ng bisikleta: hindi lang pampaganda, pananggalang talaga laban sa kalawang.\n\n[image: An iron nail covered with orange-brown rust patches from reacting with oxygen and water.]",
    ], ["faq-why-iron-rusts"]),
    # 3 — sweat -> why humid days feel worse (4 msg, tag)
    ("5", [
     "Bakit po tayo pinapawisan kapag mainit?",
     "Ang pawis ay ang built-in na aircon ng katawan mo! Kapag uminit ang katawan, naglalabas ang balat ng pawis. Habang sumisingaw ang pawis mula sa balat mo, dala-dala nito ang init palayo — kaya lumalamig ka. Hindi basura ang pawis; isa itong matalinong paraan ng pagpapalamig.",
     "Eh bakit po kapag sobrang humid o banas, mas mainit at malagkit ang pakiramdam ko kahit pawis na pawis ako?",
     "Magaling na obserbasyon — at may eksaktong siyentipikong dahilan iyan! Ang pagpapalamig ay nangyayari lang kapag SUMISINGAW ang pawis. Kapag humid, ang hangin ay punong-puno na ng singaw ng tubig, kaya halos walang puwang para sa pawis mong gustong sumingaw. Dumidikit lang ito sa balat mo nang hindi nakakapagpalamig — kaya banas na banas ka. Kaya rin mas mabisa ang bentilador sa ganitong araw: pinapagalaw nito ang hangin para matulungan ang pawis mong sumingaw.\n\n[image: Skin releasing sweat droplets that evaporate to cool the body.]",
    ], ["faq-why-we-sweat"]),
    # 4 — where rice comes from -> how long it takes (4 msg, tag)
    ("4", [
     "Saan po galing ang kanin na kinakain natin?",
     "Mula sa isang halamang damo na tinatawag na palay! Itinatanim ito ng mga magsasaka sa palayan, at kapag hinog na, ang mga butil nito ang inaani. Ang butil na may balat ay tinatawag na palay; kapag tinanggal ang balat sa kiskisan, nagiging bigas ito; at kapag niluto, iyan na ang kanin sa pinggan mo!",
     "Gaano po katagal bago maging palay na pwedeng anihin ang itinanim?",
     "Mga tatlo hanggang apat na buwan ang karaniwang hinihintay ng magsasaka! Mahabang paglalakbay iyon: nagsisimula sa binhi, sumisibol bilang punla na inililipat-tanim sa palayan, lumalago bilang madahong halaman, namumulaklak, at sa wakas ay nagkakabutil na unti-unting bumibigat at nagiging ginintuang kulay — senyales na handa nang anihin. Kaya bawat butil ng kanin sa pinggan mo ay pinaghirapan nang ilang buwan — huwag sayangin!\n\n[image: The rice plant life cycle showing stages from rice seed to seedling to tillering plant to golden grain ready for harvest.]",
    ], ["lifecycle-rice-plant-g4"]),
    # 5 — planets orbit -> why don't we fall into the sun (4 msg)
    ("5", [
     "Bakit po hindi lumalayo ang Earth sa Araw? Sino po ang humahawak dito?",
     "Ang gravity ng Araw ang humahawak! Napakalaki ng Araw kaya napakalakas ng hila ng gravity nito — ito ang di-nakikitang tali na humahawak sa Earth at sa lahat ng walong planeta para manatili sila sa kanilang landas o orbit habang umiikot sila rito.",
     "Eh kung hinihila po pala tayo ng Araw, bakit po hindi tayo nahuhulog papunta dito at masunog?",
     "Napakagandang tanong — heto ang sikreto: gumagalaw ang Earth nang PATAGILID nang napakabilis habang hinihila ito ng Araw. Isipin mo ang batong itinali sa lubid na pinapaikot mo: hila ito ng lubid palapit sa iyo, pero ang bilis ng ikot nito ang pumipigil na bumagsak ito sa kamay mo. Ganyan ang Earth — ang hila ng Araw at ang tagiliran nitong bilis ay nagbabalanse, kaya paikot-ikot tayo sa Araw nang hindi nahuhulog dito at hindi rin lumilipad palayo. Iyan mismo ang orbit!",
    ], ["why-planets-orbit-sun-g5"]),
    # 6 — blinking -> eyebrows (4 msg, PLAIN)
    ("3", [
     "Bakit po tayo kumukurap?",
     "Para linisin at basain ang mga mata mo! Sa bawat kurap, ipinapahid ng talukap ang luha sa buong mata — parang wiper ng kotse na nagtatanggal ng alikabok at nagpapanatiling basa ang mata para hindi ito mahapdi. Awtomatiko itong ginagawa ng katawan mo libu-libong beses bawat araw nang hindi mo namamalayan.",
     "Eh bakit po may kilay tayo? May trabaho rin po ba sila?",
     "Meron, at mahalaga ito! Ang kilay ay parang bubong ng mata mo: hinaharang nito ang pawis mula sa noo at ang patak ng ulan para hindi dumiretso sa mata mo — kaya hindi mahapdi ang mata mo kahit pawisan ka sa laro. May katulong pa sila: ang pilikmata, na sumasala naman ng alikabok at maliliit na bagay bago makapasok sa mata. Buong security team pala ang nakabantay sa mga mata mo!",
    ], []),
    # 7 — stars twinkle -> do planets twinkle (4 msg, PLAIN)
    ("5", [
     "Bakit po kumikislap-kislap ang mga bituin sa gabi?",
     "Hindi talaga kumikislap ang bituin mismo — ang hangin ng Earth ang may gawa niyan! Ang liwanag ng bituin ay napakalayo ng nilakbay, at bago ito umabot sa mata mo, dadaan pa ito sa makapal at laging gumagalaw na hangin sa itaas natin. Ang gumagalaw na hangin ay binabaluktot nang pabago-bago ang liwanag — kaya para itong kumukutitap.",
     "Yung mga planeta po ba tulad ng Venus, kumikislap din?",
     "Halos hindi — at iyan nga ang lihim na paraan ng mga astronomo para makilala sila! Ang bituin ay sobrang layo kaya isang napakaliit na tuldok ng liwanag lang ito na madaling mabaluktot ng hangin. Ang planeta ay mas malapit, kaya sa totoo ay isa itong munting bilog ng liwanag — at ang liwanag mula sa buong bilog ay hindi madaling pagalawin nang sabay-sabay. Kaya sa susunod na may makita kang maliwanag na 'bituin' na panatag at hindi kumukutitap, malamang planeta iyon!",
    ], []),
    # 8 — fog -> dew (4 msg)
    ("5", [
     "Ano po yung makapal na puting parang usok sa Baguio tuwing madaling-araw?",
     "Fog o ulap-lupa iyon! Hindi siya usok — gawa siya sa napakaliliit na patak ng tubig na lumulutang malapit sa lupa, parang ulap na bumaba. Nabubuo ito kapag ang singaw ng tubig sa hangin ay lumamig nang husto, tulad ng malamig na madaling-araw sa kabundukan ng Baguio.",
     "Iba po ba yun sa hamog na nakikita ko sa mga damo at dahon tuwing umaga?",
     "Magkapatid sila pero magkaiba ang tinitirhan! Pareho silang galing sa singaw ng tubig na lumamig — pero ang fog ay mga patak na LUMULUTANG pa sa hangin, samantalang ang hamog o dew ay mga patak na DUMIKIT na sa malalamig na ibabaw tulad ng damo, dahon, at bubong ng sasakyan. Kapag malamig ang gabi, ang singaw na dumampi sa malamig na damo ay nagiging patak doon mismo. Kaya basa ang tsinelas mo paglakad sa damuhan nang umaga kahit hindi umulan!",
    ], ["fog-formation-g5", "dew-formation-g5"]),
    # 9 — volcanic ash -> what to do in ashfall (4 msg)
    ("6", [
     "Bakit po delikado ang abo mula sa bulkan? Abo lang naman po yun di ba?",
     "Mas mapanganib siya kaysa sa hitsura niya! Ang abo ng bulkan ay hindi tulad ng abo ng papel — gawa ito sa napakaliliit at matatalas na piraso ng durog na bato at bubog. Masama itong malanghap dahil sinusugatan nito ang baga, nakakairita ito sa mata, at kapag kumapal ito sa bubong, kaya nitong magpaguho ng bahay dahil sa bigat — lalo na kapag nabasa ng ulan.",
     "Ano po ang dapat naming gawin kung may ashfall sa lugar namin?",
     "Tandaan ang tatlong pangunahing hakbang. Una, manatili sa loob ng bahay at isara ang mga bintana at pinto para hindi makapasok ang abo. Pangalawa, kung talagang kailangang lumabas, magsuot ng mask o takpan ang ilong at bibig ng basang tela, at protektahan ang mga mata. Pangatlo, takpan ang mga lalagyan ng tubig at pagkain para hindi mahaluan. At kapag humupa na, tulungan ang nakatatanda na linisin ang bubong — pero dahan-dahan at huwag mag-isa.",
    ], ["volcano-ash-cloud-g6"]),
    # 10 — handwashing -> why soap matters (4 msg)
    ("3", [
     "Bakit po kailangan maghugas ng kamay bago kumain?",
     "Dahil may mga mikrobyo sa mga kamay mo na hindi mo nakikita! Ang mga mikrobyo ay napakaliliit na nabubuhay na bagay na maaaring magpasakit sa iyo — nakukuha sila sa mga hawakan, laruan, pera, at kung anu-ano pang hinahawakan mo buong araw. Kapag kumain ka nang hindi naghuhugas, sumasakay sila sa pagkain papunta sa tiyan mo.",
     "Hindi po ba pwedeng tubig lang? Bakit po kailangan pa ng sabon?",
     "May espesyal na kapangyarihan kasi ang sabon na wala sa tubig! Maraming mikrobyo ang nakakapit sa manipis na langis o mantika sa balat mo, at hindi kayang tanggalin ng tubig ang langis — nagdudulas lang ito sa ibabaw. Ang sabon ang tagapamagitan: hinahablot nito ang langis kasama ang mga mikrobyong nakakapit doon, para maanod silang lahat ng tubig. Kaya ang tamang paraan: sabon, kuskos nang mga 20 segundo — kanta ng 'Happy Birthday' nang dalawang beses — saka banlaw!",
    ], ["germs-and-handwashing-g3"]),
    # 11 — how we see -> pupil in the dark -> why two eyes (6 msg)
    ("5", [
     "Paano po ba tayo nakakakita?",
     "Liwanag ang buong sikreto ng paningin! Ang mga bagay sa paligid mo ay nagbabalik o nagre-reflect ng liwanag, at ang liwanag na iyon ay pumapasok sa mata mo. Sa loob, ginagawa itong mensahe na ipinapadala sa utak — at ang utak mo ang bumubuo ng larawang 'nakikita' mo. Kaya sa ganap na kadiliman, wala kang makita: walang liwanag na maibabalik ang mga bagay.",
     "Bakit po lumalaki yung itim na bilog sa gitna ng mata ko kapag madilim?",
     "Magaling kang mag-obserba! Ang itim na bilog na iyan ay ang pupil — hindi siya kulay na itim na bagay kundi isang BUTAS na pinapasukan ng liwanag. Kapag madilim, kaunti lang ang liwanag, kaya nilalakihan ng mata mo ang butas para mas marami ang makapasok — parang binubuksan nang husto ang bintana sa makulimlim na araw. Kapag sobrang liwanag naman, lumiliit ito para hindi masilaw ang loob ng mata mo.",
     "Eh bakit po dalawa ang mata natin? Hindi po ba pwedeng isa na lang?",
     "May malaking pakinabang ang pagiging dalawa! Magkalayo nang kaunti ang dalawang mata mo, kaya bahagyang magkaiba ang nakikita ng bawat isa. Pinagsasama ng utak mo ang dalawang larawang iyon para mahusgahan kung gaano KALAYO ang mga bagay — depth perception ang tawag diyan. Subukan mo: ipikit ang isang mata at subukang pagdikitin ang dulo ng dalawang lapis na magkaharap — mas mahirap! Iyan ang trabahong nagagawa lang kapag dalawa ang matang magkatulong.",
    ], ["why-two-eyes-g4"]),
    # 12 — coconuts by the sea -> how other seeds travel -> why fruit is sweet (6 msg, tag)
    ("4", [
     "Bakit po ang daming puno ng niyog sa tabing-dagat? Sino po ang nagtanim sa kanila?",
     "Kadalasan, walang nagtanim — ang dagat mismo ang naghatid sa kanila! Ang buong niyog ay isang napakalaking buto na marunong lumutang: ang makapal at mahanging bunot nito ang nagsisilbing salbabida. Kapag nahulog ang niyog sa tubig, maaari itong ilayag ng alon nang napakalayo, at kapag sumadsad ito sa ibang dalampasigan, doon ito tutubo bilang bagong puno.",
     "Yung ibang mga buto po, paano sila nakakarating sa malayo? Hindi naman po sila lumulutang.",
     "Iba-iba ang sasakyan nila! May mga butong sakay ng HANGIN — magagaan sila at may pakpak o himulmol na parang payong, tulad ng buto ng cotton tree na tinatangay ng ihip. May mga butong sakay ng HAYOP — ang ilan ay may tinik na kumakapit sa balahibo ng dumadaang hayop, libreng masakay hanggang matanggal sa malayo. At may mga butong itinatago ng mga hayop tulad ng ardilya na minsan ay nakakalimutan — kaya tumutubo sila kung saan ibinaon!",
     "Ah kaya po pala matamis ang prutas! Para kainin ng hayop tapos madadala nila yung buto sa malayo?",
     "Eksakto — nahulaan mo ang plano ng halaman! Ang matamis at makulay na prutas ay paanyaya: 'kainin mo ako!' Kapag kinain ng ibon o paniki ang prutas, kasama ang buto na hindi natutunaw sa tiyan, at ibinabagsak nila ito sa malayong lugar na may kasama pang pataba. Panalo ang dalawa: busog ang hayop, nakapaglakbay ang buto. Kaya ang halamang hindi makalakad ay nakakarating pa rin sa malayo!\n\n[image: A tall coconut palm tree by the seashore with a crown of long fronds and coconuts clustered below them.]",
    ], ["seed-dispersal-animals-g5", "coconut-floats-disperses-g5"]),
    # 13 — lightning before thunder -> what thunder is -> measuring distance (6 msg)
    ("6", [
     "Bakit po nauuna ang kidlat bago ang kulog? Hindi po ba sabay sila?",
     "Sabay nga silang ipinanganak — magkasabay na nangyayari ang kidlat at kulog sa iisang pagputok! Pero magkaiba ang bilis ng kanilang paglalakbay papunta sa iyo: ang liwanag ay halos agad-agad dumarating, samantalang ang tunog ay mabagal na maglakbay sa hangin. Kaya nakikita mo muna ang kislap bago mo marinig ang dagundong — mas malayo ang kidlat, mas mahaba ang pagitan nila.",
     "Ano po ba talaga ang kulog? Saan po galing yung lakas ng boom na yun?",
     "Sa sobrang init ng kidlat! Ang kidlat ay mas mainit pa sandali kaysa sa ibabaw ng Araw, at kapag dumaan ito sa hangin, ang hanging nadaanan nito ay biglang-biglang umiinit at lumolobo nang napakabilis. Ang biglaang pagsabog ng hangin na iyon ang lumilikha ng napakalakas na tunog na naririnig nating kulog. Kaya hindi sila magkahiwalay na pangyayari — ang kulog ay ang INGAY ng kidlat mismo.",
     "Pwede ko po bang malaman kung gaano kalayo ang kidlat sa akin?",
     "Pwede, at simpleng bilangan lang ang kailangan! Pagkakita mo ng kislap, magbilang ka ng segundo hanggang marinig mo ang kulog: isa... dalawa... tatlo... Ang tunog ay tumatakbo nang mga isang kilometro kada tatlong segundo. Kaya kung nakabilang ka ng anim na segundo, mga dalawang kilometro ang layo ng kidlat. Kapag paliit nang paliit ang bilang sa bawat kidlat, papalapit ang bagyo — panahon na para pumasok sa loob ng bahay!",
    ], ["thunder-after-lightning-g5", "thunder-cause-g6"]),
    # 14 — is the sun a star -> why stars look white -> looking into the past (6 msg)
    ("6", [
     "Totoo po bang bituin ang ating Araw?",
     "Totoong-totoo! Ang Araw ay isang bituin — ang pinaka-malapit sa atin sa lahat. Mukha lang itong napakalaki at nakakasilaw dahil kalapit-bahay natin ito, samantalang ang ibang mga bituin ay nasa di-kayang-isipin na layo. Kung mailalayo mo ang Araw kasinlayo ng ibang bituin, magmumukha rin itong maliit na tuldok ng liwanag sa gabi.",
     "Bakit po dilaw ang Araw pero puti lang ang mga bituin sa gabi?",
     "May mga kulay talaga ang mga bituin — kaya lang masyado silang malabo para makita ng mata natin ang kulay! May mga bituing asul, na siyang pinakamaiinit; may dilaw na katamtaman ang init, tulad ng ating Araw; at may pula, na siyang pinakamalalamig sa kanila. Sa napakahinang liwanag, hindi gaanong nakakakita ng kulay ang mata natin kaya mukhang puti silang lahat — pero tingnan mong mabuti ang pinakamaliliwanag at mapapansin mong may bahagyang pamumula o pangangasul ang ilan.",
     "Sabi po ng kuya ko, kapag tumitingin daw tayo sa mga bituin, tumitingin tayo sa nakaraan. Totoo po ba yun?",
     "Totoo, at isa iyan sa pinaka-nakakamanghang katotohanan sa agham! Ang liwanag ay may bilis, at kahit ang Araw na kalapit-bahay natin — mga walong minuto bago umabot sa atin ang liwanag nito. Ibig sabihin, ang Araw na nakikita mo ngayon ay ang itsura nito walong minuto na ang nakararaan! Ang ibang mga bituin ay taon, daan, o libong taon ang nilalakbay ng liwanag — kaya ang kislap na tinitingnan mo ngayong gabi ay maaaring umalis sa bituin bago pa man ipanganak ang lolo't lola mo.",
    ], ["sun-light-eight-minutes-g6"]),
    # 15 — largest organ -> really? -> what skin does (6 msg, PLAIN)
    ("5", [
     "Ano po ang pinakamalaking organ ng katawan natin?",
     "Handa ka ba sa sagot? Ang BALAT mo! Oo, organ ang balat — at dahil binabalot nito ang buo mong katawan mula ulo hanggang talampakan, ito ang pinakamalaki sa lahat.",
     "Talaga po? Akala ko po yung puso o yung utak ang pinakamalaki.",
     "Naiintindihan ko ang hula mo — sikat kasi sila! Pero isipin mo ang sukat: ang puso mo ay kasinglaki lang ng kamao mo, at ang utak ay kasya sa dalawang dakot. Ang balat? Kung maibabalat mo ito nang buo na parang damit, aabot ito nang halos dalawang metro kwadrado sa nasa hustong gulang — kasinglaki ng maliit na kumot! Walang ibang organ na ganyan kalawak.",
     "Ano po ba ang mga trabaho ng balat bukod sa pambalot?",
     "Marami siyang sabay-sabay na trabaho! Una, kalasag siya: hinaharangan niya ang mga mikrobyo, dumi, at araw para hindi makapasok sa loob. Pangalawa, aircon siya: naglalabas siya ng pawis para palamigin ka, at kasabay noon ay inilalabas din niya ang sobrang tubig at asin ng katawan. Pangatlo, sensor siya: dahil sa balat mo nararamdaman ang init, lamig, sakit, at ang yakap ng nanay mo. Pambalot, kalasag, aircon, at sensor — apat na trabaho ng iisang organ!",
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

#!/usr/bin/env python3
"""Assemble tagalog-b5.jsonl (Family B, set 5 — 10 physics-exact dialogues).

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
OUT = os.path.join(HERE, "tagalog-b5.jsonl")

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

# (grade, [messages alternating user/assistant], [fact ids for the FINAL user turn])
ROWS = [
    # 1 — gravity EXISTS in space; floating = free fall (4 msg, tag)
    ("6", [
     "Totoo po bang walang gravity sa kalawakan? Kaya po lumulutang ang mga astronaut?",
     "Iyan ang isa sa pinakasikat na maling akala sa agham — MAY gravity sa kalawakan! Ang gravity ng Earth ay umaabot nang napakalayo; sa taas mismo ng space station, halos kasinlakas pa rin ito ng nararamdaman mo rito. Kung walang gravity doon, matagal nang lumipad palayo ang buwan at ang mga satellite.",
     "Eh kung may gravity po pala doon, bakit po lumulutang ang mga astronaut?",
     "Dahil patuloy silang NAHUHULOG — free fall ang tawag dito! Ang astronaut at ang kanyang spacecraft ay parehong tuloy-tuloy na bumabagsak paikot sa Earth nang magkasabay. Dahil magkasabay silang nahuhulog, walang sahig na tumutulak pataas sa astronaut — kaya pakiramdam niya ay wala siyang bigat at lumulutang siya. Hindi nawala ang gravity; ito nga mismo ang humihila sa kanila kaya sila umiikot sa Earth!\n\n[image: An astronaut in a bulky spacesuit and rounded helmet floating with arms out in space.]",
    ], ["faq-why-astronauts-float"]),
    # 2 — moon gravity 1/6 (4 msg)
    ("6", [
     "Nakita ko po sa video, ang taas-taas tumalon ng mga astronaut sa buwan kahit ang kapal ng suit nila. Bakit po?",
     "Magandang napansin mo, dahil sa Earth, ang bigat ng space suit na iyan ay parang may pasan kang isa pang tao! Ang sagot: ibang mundo, ibang lakas ng hila. Ang buwan ay mas maliit kaysa sa Earth, kaya mas mahina ang gravity nito — mas mahina ang paghila nito pababa sa mga astronaut.",
     "Gaano po kahina ang gravity sa buwan?",
     "Mga isang-kaanim (1/6) lamang ng gravity ng Earth! Ibig sabihin, mga anim na beses kang mas magaan doon: kung ang timbang mo rito ay 30 kilo, parang 5 kilo lang ang pakiramdam mo sa buwan. Kaya kahit suot ang mabigat na space suit, nakakatalon pa rin sila nang mas mataas at parang lumulukso-lukso sila sa paglalakad — ang bawat hakbang nila ay parang talon sa trampoline.",
    ], ["val-gravity-moon", "moon-gravity-one-sixth-g6"]),
    # 3 — heavy and light fall at the same rate (6 msg)
    ("6", [
     "Kapag sabay kong hinulog ang mabigat at magaang bagay, alin po ang unang babagsak?",
     "Nakakagulat ang sagot: kung walang hangin na humaharang, SABAY silang babagsak! Pare-pareho ang bilis ng pagbagsak ng lahat ng bagay dahil pare-pareho silang hinihila ng gravity nang may parehong bilis ng pagbilis. Ang hangin lang ang dahilan kaya iba-iba minsan ang dating nila sa lupa.",
     "Pero po sinubukan ko na — sabay kong hinulog ang libro at papel, una talagang bumagsak ang libro!",
     "Tama ang eksperimento mo, at totoo ang nakita mo! Ang papel ay malawak at magaan, kaya ang hangin sa ilalim nito ay parang unan na tumutulak pabalik — air resistance ang tawag. Heto ang susunod na eksperimento: yupiin mo ang parehong papel hanggang maging masikip na bola, saka mo ulit ihulog kasabay ng libro. Halos sabay na silang babagsak — pareho pa rin ang bigat ng papel, pero maliit na ang naipupuwersa ng hangin!",
     "May lugar po ba kung saan talagang sabay-sabay bumabagsak ang lahat?",
     "Meron — kahit saang lugar na walang hangin! Sa buwan, sinubukan ito mismo ng astronaut na si David Scott noong 1971: sabay niyang hinulog ang martilyo at ang balahibo ng ibon. Sa Earth, ang balahibo ay aapung-apo sa hangin habang ang martilyo ay diretsong lalagpak. Pero sa buwan na walang hangin? Sabay na sabay silang lumapag sa lupa — sa harap ng kamera! Pinatunayan nito na ang gravity ay pantay humila sa magaan at mabigat.",
    ], ["free-fall-same-rate-g6"]),
    # 4 — the ISS is falling around Earth (4 msg, PLAIN)
    ("5", [
     "Bakit po hindi bumabagsak sa Earth ang space station? Nasa itaas lang po siya palagi.",
     "Heto ang lihim: bumabagsak talaga ito — KAHIT KAILAN hindi ito tumigil sa pagbagsak! Pero habang nahuhulog ito pababa, gumagalaw din ito patagilid nang napakabilis — mga walong kilometro kada segundo. Dahil bilog ang Earth, habang bumabagsak ang istasyon, ang lupa sa ilalim nito ay 'lumiliko' palayo. Parang nahuhulog ito nang hindi tumatama sa lupa — paikot-ikot. Iyan mismo ang ibig sabihin ng orbit!",
     "Kaya po pala lumulutang ang mga astronaut sa loob — kasama po silang nahuhulog ng istasyon!",
     "Nakuha mo na ang buong larawan! Ang istasyon, ang mga astronaut, ang kanilang pagkain, ang bolpen nila — lahat sila ay sabay-sabay na nahuhulog paikot sa Earth. Kapag sabay kayong nahuhulog ng sinasakyan mo, walang tumutulak na sahig sa talampakan mo, kaya pakiramdam mo ay wala kang timbang. Tandaan: hindi dahil nawala ang gravity — buhay na buhay ito at siya pa nga ang nagpapaikot sa kanila — kundi dahil sa tuloy-tuloy na magkasabay na pagbagsak: ang free fall.",
    ], []),
    # 5 — moon phases are NOT Earth's shadow (6 msg, tag)
    ("4", [
     "Bakit po minsan kalahati o pa-kurba lang ang buwan sa langit?",
     "Ang buwan ay laging buong bilog na bola — hindi talaga ito nagbabago ng hugis! Ang kalahati ng buwan ay laging naiilawan ng Araw, tulad ng kalahati ng bola na sinisinagan ng ilaw. Habang umiikot ang buwan sa Earth, iba-iba ang anggulo ng pagtingin natin, kaya minsan kita natin ang buong maliwanag na mukha (kabilugan), minsan kalahati lang, at minsan halos wala (bagong buwan). Phases ng buwan ang tawag diyan.",
     "Akala ko po anino ng Earth ang tumatakip sa buwan kaya nagiging pa-kurba ito.",
     "Maraming nag-aakala niyan, pero hindi iyan ang dahilan! Ang madilim na bahagi ng pa-kurbang buwan ay ang sarili nitong panig na nakatalikod sa Araw — ang 'gabi' ng buwan mismo, hindi anino ng ating planeta. Patunay: kapag kalahating buwan, ang Araw, Earth, at buwan ay hindi man lang nakahanay sa paraang tatamaan ng anino natin ang buwan. Ang anino ng Earth ay tumatama sa buwan sa iisang espesyal na pagkakataon lang — at may sariling pangalan iyon.",
     "Ano po yung espesyal na pagkakataon na yun?",
     "Ang lunar eclipse! Nangyayari ito kapag eksaktong nagkahanay ang Araw, ang Earth, at ang buwan — ang Earth ang nasa gitna, kaya ang anino natin ay tumatama sa kabilugan ng buwan at unti-unti itong dumidilim, minsan ay namumula pa. Bihira itong mangyari at ilang oras lang tumatagal. Ang phases naman ay nakikita mo buwan-buwan, gabi-gabi ang pagbabago — isang buong ikot mula bagong buwan hanggang kabilugan at pabalik.\n\n[image: The eight phases of the Moon shown in a row from new moon to full moon and back.]",
    ], ["earth-eclipses-g6"]),
    # 6 — solar vs lunar eclipse + eye safety (4 msg)
    ("7", [
     "Ano po ang pinagkaiba ng solar eclipse sa lunar eclipse?",
     "Parehong paghahanay ng Araw, buwan, at Earth — ang pinagkaiba ay kung SINO ang nasa gitna! Solar eclipse: ang BUWAN ang nasa gitna, dumadaan ito sa pagitan ng Araw at Earth kaya natatakpan nito ang Araw — nangyayari ito sa umaga o tanghali. Lunar eclipse: ang EARTH ang nasa gitna, kaya ang anino natin ang tumatama sa buwan — nakikita ito sa gabi, tuwing kabilugan ng buwan.",
     "Pag may solar eclipse po, pwede ko po ba itong tingnan nang diretso? Saglit lang naman po.",
     "HINDI — kahit isang saglit, kahit halos tapos na ang eclipse! Ang tuwirang pagtingin sa Araw ay kayang sumira sa mata mo nang tuluyan, at hindi mo mararamdamang nasasaktan ito habang nangyayari. Kailangan ng espesyal na eclipse glasses na may sertipikadong filter — hindi sapat ang sunglasses, x-ray film, o makulay na salamin. Ang lunar eclipse naman ay ligtas titigan nang buong magdamag: buwan lang iyon na nadidiliman, walang panganib sa mata.",
    ], ["solar-eclipse-new-moon-g7", "never-look-at-sun-eclipse-g5"]),
    # 7 — why we breathe: oxygen releases energy from food (4 msg)
    ("5", [
     "Bakit po ba tayo humihinga? Para saan po talaga ang hangin sa katawan?",
     "Humihinga tayo para kumuha ng oxygen — at ang oxygen ay may iisang napakahalagang misyon: pakawalan ang enerhiyang nakatago sa kinain mo! Ang pagkain ay parang panggatong na puno ng nakaimbak na enerhiya, pero hindi ito magagamit ng katawan nang basta-basta. Sa loob ng bawat maliit na cell mo, ang oxygen ang susi na nagpapakawala ng enerhiyang iyon para makagalaw, makapag-isip, at manatiling mainit ang katawan mo.",
     "So parang gasolina po ang pagkain, tapos ang oxygen ang nagpapaandar ng makina?",
     "Napakagaling na paghahambing — ganyang-ganyan nga! Tulad ng makina ng sasakyan na nangangailangan ng gasolina AT hangin para umandar, ang mga cell mo ay nangangailangan ng pagkain AT oxygen para makagawa ng enerhiya. At may 'usok' din ang prosesong ito: carbon dioxide — iyan ang ibinubuga mo tuwing humihinga ka palabas. Kaya magkapares na trabaho ang kain at hinga: ang isa ang nagdadala ng panggatong, ang isa ang nagpapaningas nito.",
    ], ["faq-why-we-breathe"]),
    # 8 — panting when running (4 msg, PLAIN)
    ("5", [
     "Bakit po ako hinihingal at ang bilis ng tibok ng puso ko pagkatapos tumakbo?",
     "Dahil nag-rush order ang mga binti mo! Kapag tumatakbo ka, ang mga kalamnan mo ay gumagawa ng napakaraming trabaho — at ang trabaho ay nangangailangan ng enerhiya. Para makagawa ng mas maraming enerhiya mula sa pagkaing kinain mo, kailangan ng mga kalamnan mo ng mas maraming oxygen, mas mabilis. Kaya bumibilis ang hinga mo: nagkakarga ka ng mas maraming oxygen kada minuto.",
     "Eh bakit po pati ang puso ko bumibilis? Hindi po ba sa baga lang dumadaan ang hangin?",
     "Magkasosyo kasi sila sa paghahatid! Ang baga ang nagkakarga ng oxygen mula sa hangin, pero ang DUGO ang delivery truck na naghahatid nito sa mga kalamnan — at ang puso ang bumobomba ng dugo. Kapag kailangan ng mga binti mo ng dobleng oxygen, kailangang bumilis ang biyahe ng mga truck: kaya bumibilis ang tibok ng puso mo. Paghinto mo sa pagtakbo, unti-unting babagal ulit silang dalawa kapag bayad na ang 'utang' na oxygen ng mga kalamnan mo.",
    ], []),
    # 9 — evaporation any temperature, surface only vs boiling (6 msg, tag)
    ("6", [
     "Kailangan po bang kumulo ang tubig bago ito maging singaw? Eh bakit po natutuyo ang sinampay kahit hindi naman kumukulo ang tubig sa damit?",
     "Napakatalas ng tanong mo — hindi kailangan! May dalawang paraan ang tubig para maging singaw, at ang una ay tahimik na nangyayari kahit anong temperatura: ang evaporation. Sa ibabaw ng tubig, may mga particle na nakakaipon ng sapat na lakas para kumawala papunta sa hangin — isa-isa, dahan-dahan, kahit malamig pa ang tubig. Iyan ang nagpapatuyo sa sinampay, sa lusak, at sa pinagpunasang sahig.",
     "Eh ano po ang nangyayari kapag kumukulo? Iba po ba iyon?",
     "Iba, at mas marahas! Ang boiling ay nangyayari lamang kapag umabot ang tubig sa 100 digri Celsius. Sa puntong iyon, hindi na lang sa ibabaw tumatakas ang mga particle — sa LOOB mismo ng tubig, kahit sa pinakailalim ng palayok, nabubuo ang mga bula ng singaw na umaakyat at sumasabog sa ibabaw. Kaya nagbubulubok ang kumukulong tubig: singaw na nabubuo sa kabuuan nito, hindi lang sa ibabaw.",
     "Ah kaya po pala! So sa mainit na araw mas mabilis matuyo ang sinampay, pero kahit malamig at maulap, matutuyo pa rin ito?",
     "Eksakto! Ang evaporation ay nangyayari sa ANUMANG temperatura — binibilisan lang ito ng init, hindi ito kundisyon para mangyari. Kaya natutuyo pa rin ang sinampay sa malamig na araw, mas mabagal nga lang. May dalawa ka pang katulong: ang hangin, na nagtatangay ng singaw palayo para may puwang ang susunod na particle, at ang pagbuka ng damit sa sampayan — mas malawak ang ibabaw, mas maraming particle ang may daanang palabas nang sabay-sabay.\n\n[image: A pot boiling vigorously with bubbles beside a dish of water slowly evaporating — boiling versus evaporation.]",
    ], ["boiling-vs-evaporation-g6"]),
    # 10 — boiling water stays at 100C (4 msg)
    ("7", [
     "Kapag nilakasan ko po ang apoy, mas iinit po ba ang kumukulong tubig kaya mas mabilis maluluto ang itlog?",
     "Heto ang ikagugulat mo: HINDI na tataas ang temperatura nito! Ang kumukulong tubig ay nananatili sa mga 100 digri Celsius, kahit gaano mo kalakas ang apoy. Malakas man o mahina ang kulo, parehong 100 digri lang ang tubig — kaya hindi mas mabilis maluluto ang itlog mo, mas mabilis lang mauubos ang gas mo!",
     "Eh saan po napupunta ang dagdag na init mula sa malakas na apoy kung hindi na tumataas ang temperatura?",
     "Sa pagpapalit-anyo ng tubig! Ang lahat ng dagdag na init ay ginagamit sa paggawa ng mas maraming singaw — sa pagbabago ng likidong tubig para maging gas nang mas mabilis. Kaya ang malakas na apoy ay nagbibigay lang ng mas maraming bula at mas mabilis na pagkaubos ng tubig, hindi mas mainit na tubig. Praktikal na aral sa kusina: kapag kumukulo na, hinaan mo na ang apoy sa katamtamang kulo — parehong 100 digri pa rin, parehong bilis maluluto ang pagkain, mas matipid pa sa gas.",
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

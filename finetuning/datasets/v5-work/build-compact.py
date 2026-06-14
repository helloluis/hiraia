#!/usr/bin/env python3
"""Build the v5 c-compact rows (compaction/summarization SFT).

Targets the v4 gate failure compaction:gravity — the model invented a "gravity
suit", barely compressed (371 vs 378 chars), and kept the greeting. Rows here
match the device call exactly (LocalEngine.ts: the Tagalog instruction with NO
system message — the same instruction is sent even in Bisaya sessions, so the
bisaya file uses Cebuano SAGOT bodies under the Tagalog instruction).

Summary discipline trained: (1) much shorter than the SAGOT, (2) zero invented
terms/names, (3) drop the greeting, examples/analogies, [image:] tags, and the
closing question — keep ONLY the science facts and terms.

Emits: compact-tagalog.jsonl (10 rows), compact-bisaya.jsonl (6 rows) — final
{"messages":[user,assistant]} rows (NOT system-less fragments; the assembler
appends them as-is).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))

INSTRUCTION = (
    "Ibuod ang sumusunod na sagot ng science tutor sa ISA o DALAWANG napakaikling pangungusap, "
    "para magamit bilang maikling alaala (memory) sa susunod na usapan. Panatilihin LANG ang "
    "mahalagang science fact at termino. Alisin ang pagbati, mga halimbawa, at ang tanong sa dulo. "
    "Sumagot ng buod lamang, walang ibang sasabihin.\n\nSAGOT:\n"
)

# (sagot, buod) — tagalog bodies
TAGALOG = [
    # gravity / free fall — the exact failing family
    ("Magandang tanong po! May gravity pa rin sa kalawakan — hindi ito nawawala. Lumulutang ang mga "
     "astronaut dahil sila at ang kanilang spacecraft ay parehong nahuhulog nang sabay paikot sa Earth "
     "— free fall ang tawag dito. Parang nasa elevator kang mabilis bumababa — pakiramdam mo gumagaan "
     "ka! Kaya hindi totoo na 'walang gravity' sa space. Gusto mo bang malaman kung bakit hindi "
     "bumabagsak ang buwan sa Earth?",
     "May gravity pa rin sa kalawakan; lumulutang ang mga astronaut dahil nasa free fall sila kasama "
     "ng kanilang spacecraft habang umiikot sa Earth."),
    ("Uy, astig na tanong! Ang buwan ay may sariling gravity — humigit-kumulang 1/6 lang ng gravity ng "
     "Earth. Kaya kapag tumalon ang astronaut sa buwan, mas mataas at mas mabagal ang talon nila, pero "
     "bumabalik pa rin sila sa lupa — hindi sila lumilipad palayo. Isipin mo: kung 30 kilo ang timbang "
     "mo sa Earth, parang 5 kilo ka lang sa buwan! May tanong ka pa ba tungkol sa buwan?",
     "Ang buwan ay may sariling gravity na mga 1/6 ng sa Earth, kaya mas mataas ang talon doon pero "
     "bumabalik pa rin sa lupa ang mga astronaut."),
    # water cycle (with an [image:] tag that must be dropped)
    ("Paborito kong paksa ito! Ang ulan ay bahagi ng water cycle. Sinisingaw ng init ng araw ang tubig "
     "mula sa dagat at mga ilog — evaporation ang tawag. Pag-akyat sa malamig na itaas, nagiging "
     "maliliit na patak ito at bumubuo ng ulap — condensation. Kapag bumigat ang mga patak, bumabagsak "
     "ang mga ito bilang ulan — precipitation. Paulit-ulit na ikot ito!\n\n[image: The water cycle "
     "showing evaporation from the sea, cloud formation, and rain falling.]\n\nAnong bahagi ang gusto "
     "mong pag-usapan pa?",
     "Ang ulan ay bahagi ng water cycle: evaporation (pagsingaw ng tubig), condensation (pagbuo ng "
     "ulap), at precipitation (pagbagsak ng ulan)."),
    # density
    ("Magandang obserbasyon! Ang paglutang o paglubog ay nakadepende sa density — kung gaano kasiksik "
     "ang isang bagay. Kapag mas siksik ang bagay kaysa sa tubig, lulubog ito; kapag mas maluwag ang "
     "pagkakasiksik, lulutang. Kaya lumulubog ang maliit na bato pero lumulutang ang malaking troso! "
     "Ano sa tingin mo ang mangyayari sa isang itlog kapag inilagay sa tubig na maraming asin?",
     "Ang paglutang o paglubog ay nakadepende sa density: lumulubog ang mas siksik kaysa sa tubig, "
     "lumulutang ang mas maluwag ang pagkakasiksik."),
    # circuit
    ("Heto po ang sagot! Para umilaw ang bombilya, kailangan ng saradong circuit: baterya, kawad, at "
     "bombilya na magkakadugtong sa isang kumpletong ikot — doon dadaloy ang kuryente. Kapag may putol, "
     "tulad ng bukas na switch o tanggal na kawad, hindi dadaloy ang kuryente at hindi iilaw. Parang "
     "tulay na may butas: hindi makakatawid ang sasakyan! Gusto mo bang subukan nating i-trace ang "
     "isang circuit?",
     "Umiilaw ang bombilya kapag sarado at buo ang circuit (baterya, kawad, at bombilya na "
     "magkakadugtong); kapag may putol, hindi dadaloy ang kuryente."),
    # sound
    ("Astig na tanong! Ang tunog ay gawa ng vibration o pagyanig. Kapag yumanig ang isang bagay — "
     "tulad ng kuwerdas ng gitara — niyayanig din nito ang hangin sa paligid, at ang yanig na iyon ang "
     "naglalakbay hanggang sa tainga mo. Subukan mong hawakan ang lalamunan mo habang nagsasalita — may "
     "mararamdaman kang kiliti, yanig iyon ng vocal cords mo! Ano pa ang gusto mong malaman tungkol sa "
     "tunog?",
     "Ang tunog ay mula sa vibration: ang yumayanig na bagay ay nagpapayanig sa hangin, at ang yanig "
     "na ito ang naglalakbay hanggang sa tainga."),
    # volcano
    ("Magandang tanong po! Pumuputok ang bulkan dahil sa magma — sobrang init na tunaw na bato sa "
     "ilalim ng lupa. Kapag naipon ang magma at mga gas sa loob, tumataas ang presyon, hanggang sa "
     "pumutok ito palabas. Kapag lumabas na ang magma sa ibabaw, lava na ang tawag dito. Parang "
     "inalog na bote ng soda na biglang binuksan! May gusto ka pa bang itanong tungkol sa mga bulkan?",
     "Pumuputok ang bulkan kapag tumaas ang presyon ng naipong magma at mga gas sa ilalim; ang magma "
     "na lumabas sa ibabaw ay tinatawag na lava."),
    # blue sky
    ("Klasikong tanong ito! Asul ang langit dahil sa tinatawag na scattering. Ang liwanag ng araw ay "
     "may lahat ng kulay, pero pagpasok nito sa hangin ng Earth, ang asul na liwanag ang pinakamadaling "
     "kumalat sa lahat ng direksyon dahil maikli ang alon nito. Kaya saan ka man tumingin sa langit, "
     "asul ang inaabot ng mata mo! Gusto mo bang malaman kung bakit naman kulay kahel ang langit sa "
     "dapit-hapon?",
     "Asul ang langit dahil sa scattering: ang asul na liwanag ng araw ang pinakamadaling kumalat sa "
     "hangin ng Earth dahil maikli ang alon nito."),
    # evaporation at any temperature
    ("Magaling na obserbasyon! Hindi kailangang kumulo ang tubig para sumingaw. Ang evaporation ay "
     "nangyayari sa kahit anong temperatura — sa ibabaw ng tubig, may mga maliliit na particle na "
     "nakakatakas papunta sa hangin. Kaya natutuyo ang sampay kahit makulimlim, mas mabagal nga lang "
     "kaysa kapag mainit. Ang pagkulo naman ay ang pinakamabilis na anyo nito. May tanong ka pa ba?",
     "Ang evaporation ay nangyayari sa kahit anong temperatura sa ibabaw ng tubig, kaya natutuyo ang "
     "sampay kahit makulimlim; mas mabilis lang ito kapag mas mainit."),
    # rainbow (with tag to drop)
    ("Wow, bahaghari! Nabubuo ito kapag sabay na may sikat ng araw at ulan. Ang liwanag ng araw ay "
     "pumapasok sa mga patak ng ulan, bumabaluktot, at humihiwalay sa mga kulay — katulad ng ginagawa "
     "ng prism. Kaya laging nasa tapat ng araw ang bahaghari!\n\n[image: A rainbow arching across the "
     "sky with rain clouds and the sun.]\n\nNakakita ka na ba ng buong arko ng bahaghari?",
     "Nabubuo ang bahaghari kapag ang liwanag ng araw ay bumabaluktot at humihiwalay sa mga kulay sa "
     "loob ng mga patak ng ulan, katulad ng sa prism."),
]

# Cebuano SAGOT bodies under the SAME Tagalog instruction (device behavior);
# summaries in Cebuano so bisaya-session memory stays Cebuano.
BISAYA = [
    ("Maayong pangutana! Naa gihapoy gravity sa kawanangan — wala kini mawala. Naglutaw ang mga "
     "astronaut kay sila ug ang ilang spacecraft parehong nagkahulog nga magkauban libot sa Earth — "
     "free fall ang tawag niini. Murag gibati nimo nga migaan ka kon kalit nga monaog ang elevator! "
     "Busa dili tinuod nga 'walay gravity' sa space. Gusto ka bang mahibalo nganong dili mahulog ang "
     "bulan sa Earth?",
     "Naa gihapoy gravity sa kawanangan; naglutaw ang mga astronaut kay naa sila sa free fall uban sa "
     "ilang spacecraft samtang naglibot sa Earth."),
    ("Nindot nga pangutana! Ang bulan adunay kaugalingong gravity — mga 1/6 lang sa gravity sa Earth. "
     "Mao nga kon molukso ang astronaut sa bulan, mas taas ug mas hinay ang ilang lukso, apan mobalik "
     "gihapon sila sa yuta — dili sila molupad palayo. Hunahunaa: kon 30 ka kilo ka sa Earth, murag 5 "
     "ka kilo ra ka sa bulan! Naa ka pay pangutana bahin sa bulan?",
     "Ang bulan adunay kaugalingong gravity nga mga 1/6 sa Earth, mao nga mas taas ang lukso didto "
     "apan mobalik gihapon sa yuta ang mga astronaut."),
    ("Paborito nako ni nga topic! Ang ulan kabahin sa water cycle. Ang kainit sa adlaw mag-alisngaw sa "
     "tubig gikan sa dagat ug mga suba — evaporation. Pag-abot sa bugnaw nga itaas, mahimong gagmayng "
     "tulo kini ug maporma ang panganod — condensation. Kon mobug-at na ang mga tulo, mahulog kini "
     "isip ulan — precipitation. Walay hunong nga tuyok kini! Unsang bahina ang gusto nimong hisgotan "
     "pa?",
     "Ang ulan kabahin sa water cycle: evaporation (pag-alisngaw sa tubig), condensation (pagporma sa "
     "panganod), ug precipitation (pagkahulog sa ulan)."),
    ("Maayong pangutana! Mobuto ang bulkan tungod sa magma — init kaayo nga natunaw nga bato ilalom sa "
     "yuta. Kon magtigom ang magma ug mga gas sa sulod, mosaka ang presyon hangtod mobuto kini "
     "pagawas. Kon makagawas na ang magma sa ibabaw, lava na ang tawag niini. Murag giuyog nga botelya "
     "sa soda nga kalit giablihan! Unsa pay gusto nimong mahibaloan bahin sa mga bulkan?",
     "Mobuto ang bulkan kon mosaka ang presyon sa natigom nga magma ug mga gas; ang magma nga mogawas "
     "sa ibabaw gitawag og lava."),
    ("Nindot kaayo nga pangutana! Ang tingog gikan sa vibration o pag-uyog. Kon mouyog ang usa ka "
     "butang — sama sa kuwerdas sa gitara — mouyog usab ang hangin sa palibot, ug kana nga pag-uyog "
     "ang mobiyahe hangtod sa imong dalunggan. Sulayi paggunit ang imong tutunlan samtang nagsulti ka "
     "— mabati nimo ang pag-uyog sa imong vocal cords! Unsa pay gusto nimong mahibaloan bahin sa "
     "tingog?",
     "Ang tingog gikan sa vibration: ang nag-uyog nga butang mopauyog sa hangin, ug kini nga pag-uyog "
     "ang mobiyahe hangtod sa dalunggan."),
    ("Klasiko ni nga pangutana! Asul ang langit tungod sa gitawag og scattering. Ang kahayag sa adlaw "
     "adunay tanang kolor, apan pagsulod niini sa hangin sa Earth, ang asul nga kahayag ang "
     "pinakasayon mokatag sa tanang direksyon kay mubo ang balod niini. Mao nga bisan asa ka motan-aw "
     "sa langit, asul ang imong makita! Gusto ka bang mahibalo nganong kahel ang langit sa pagsalop "
     "sa adlaw?",
     "Asul ang langit tungod sa scattering: ang asul nga kahayag sa adlaw ang pinakasayon mokatag sa "
     "hangin sa Earth kay mubo ang balod niini."),
]

for name, rows in (("tagalog", TAGALOG), ("bisaya", BISAYA)):
    path = os.path.join(HERE, f"compact-{name}.jsonl")
    with open(path, "w") as out:
        for sagot, buod in rows:
            assert len(buod) < 0.6 * len(sagot), f"summary not compressed enough: {buod[:50]}"
            assert "[image:" not in buod and "?" not in buod, f"summary kept tag/question: {buod[:50]}"
            row = {"messages": [
                {"role": "user", "content": INSTRUCTION + sagot},
                {"role": "assistant", "content": buod},
            ]}
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"{path}: {len(rows)} rows")

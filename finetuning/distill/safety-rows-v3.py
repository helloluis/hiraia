#!/usr/bin/env python3
"""kitten-v3 safety augmentation — fix the v2 regression where the 1B reflexively
opened with 'Hindi po' on yes/no safety questions and confabulated positive content
(e.g. "Hindi po, napakabuti ng manigarilyo"). The 18 v2 rows × 3 weight (54 in 10k)
was too weak for the 1B. v3: ~38 rows × 10 weight (~380 in 10k = ~4%) and EVERY
smoking/harm row explicitly opens "Oo po, [harm]" so the lexical pattern wins.

Output: finetuning/distill/safety-rows-v3.json (consumed by build-v9plus-assemble.mts).
"""
import json

def row(seed, think, ans):
    return {"type": "safety", "seed": seed,
            "assistant": f"<think>\n{think}\n</think>\n\n{ans}"}

# --- SMOKING/VAPING — bumped 3 → 12 rows, all "Oo po, masama/delikado" openers ---
SMOKING = [
    row("Masama po ba ang manigarilyo?",
        "Yes/no smoking question — settled: it IS harmful. Open with 'Oo po, masama' so the 1B's reflex opener matches the correct polarity.",
        "Oo po, masama at delikado ang manigarilyo. 🚭 May lason itong kemikal na sumisira sa baga, kaya nahihirapan huminga ang naninigarilyo at madalas inuubo. Nakakahumaling din ito — mahirap nang itigil kapag nasanay na ang katawan.\n\nKaya mas mabuting huwag kang magsimula kahit kailan. May gusto ka pa bang itanong kung paano pananatilihing malusog ang baga?"),
    row("Masama ba talaga ang sigarilyo?",
        "Alternate phrasing of smoking-harm question. Correct polarity: Oo po, masama.",
        "Oo po, talagang masama ang sigarilyo. ⚠️ Sumisira ito sa baga at puso, at puwedeng magdulot ng cancer kapag ginagawa nang matagal. Nakakahumaling din ang nicotine sa loob nito.\n\nKaya iniiwasan ng matatanda ang sigarilyo. Anong iba pang tanong meron ka?"),
    row("Delikado ba ang manigarilyo?",
        "Smoking-harm phrased as 'delikado ba' — still requires Oo po opener.",
        "Oo po, talagang delikado ang manigarilyo. 🚭 Pumapasok sa baga ang usok at may daan-daang nakakasamang kemikal. Pati ang mga taong nakapaligid sa naninigarilyo ay nakakalanghap ng usok at nasasaktan din.\n\nMabuting iwasan natin ang lugar kung saan may naninigarilyo. May iba ka pa bang gustong itanong tungkol sa malusog na pamumuhay?"),
    row("Nakakasama ba sa katawan ang sigarilyo?",
        "Confirming harm: Oo po opener.",
        "Oo po, nakakasama nang malala sa katawan ang sigarilyo. 🫁 Pinapahina nito ang baga, pinapabilis ang pagtibok ng puso, at nakakabawas ng oxygen sa dugo. Sa katagalan, puwede itong magdulot ng malalang sakit tulad ng cancer.\n\nKaya hindi pinapayagan ang mga bata na manigarilyo. May iba ka pa bang gustong malaman tungkol sa baga?"),
    row("Masama po ba para sa baga ang manigarilyo?",
        "Specifically about lungs — Oo po, masama.",
        "Oo po, sobrang masama para sa baga ang manigarilyo. 🫁 Sumusunog ito sa loob ng mga maliliit na supot ng baga na tumatanggap ng oxygen — kaya unti-unting hinahirapan ng naninigarilyo huminga.\n\nMahalagang protektahan ang ating baga. Gusto mo bang malaman kung paano nagliligtas ng baga ang sariwang hangin?"),
    row("OK lang po ba manigarilyo kung minsan lang naman?",
        "Occasional smoking — still harmful. Open Hindi po (no), but the SUBSTANCE remains anti-smoking.",
        "Hindi po, hindi OK kahit minsan lang. ⚠️ Kahit isang sigarilyo ay may lason na pumapasok sa baga, at madalas dito nagsisimula ang paghahabit — unti-unti, nadadagdagan hanggang mahirap nang itigil.\n\nWalang ligtas na dami ng paninigarilyo para sa bata. Gusto mo bang malaman kung paano nananatiling malusog ang baga?"),
    row("Pwede po bang sumubok lang ng sigarilyo isang beses?",
        "Trial smoking — still no, with firm 'Hindi po' on the action.",
        "Hindi po, hindi mabuti sumubok kahit isang beses. 🚭 Kahit isang sigarilyo ay maaaring maging simula ng masamang gawi, at agad na nakakapasok ang lason sa baga. Marami sa mga naninigarilyo ay nagsimula sa 'isang beses lang.'\n\nMas mabuting iwasan ang sigarilyo. May ibang gusto mo pa bang itanong tungkol sa kalusugan?"),
    row("Nakakabuti ba ang manigarilyo?",
        "INVERTED framing — 'is smoking good?' — must firmly say NO. This directly counters the v2 bug ('napakabuti').",
        "Hindi po, hindi nakakabuti ang manigarilyo. 🚭 Wala itong magandang naidudulot sa katawan — masama ito sa baga, sa puso, at nakakahumaling. Maraming sakit ang dulot ng matagal na paninigarilyo.\n\nPara maging malusog, mas mabuting iwasan ito kahit kailan. Gusto mo bang malaman kung anong mga gawain ang totoong nakakatulong sa katawan?"),
    row("Mabuti po ba para sa kalusugan ang sigarilyo?",
        "Same inverted question. Firm Hindi po.",
        "Hindi po, hindi mabuti para sa kalusugan ang sigarilyo. ❌ Sa halip na tumulong, sumisira ito sa katawan — sa baga, sa puso, sa balat, at sa lahat halos ng bahagi. Walang sustansyang naidudulot ang sigarilyo.\n\nPara malusog, mas mabuti ang pag-eehersisyo, sapat na tulog, at masustansiyang pagkain. May iba ka pa bang gustong itanong?"),
    row("Nakakatulong ba ang manigarilyo sa stress?",
        "Common smoker myth. Firm rebuttal.",
        "Hindi po, hindi totoong nakakatulong sa stress ang manigarilyo. 🧘 Pansamantala lang ang pakiramdam ng 'kalma' dahil sa nicotine, pero pagkatapos ay mas lalo pang nadadagdagan ang stress dahil kailangan na ulit manigarilyo.\n\nMay mas mabubuting paraan para mawala ang stress: paglalakad, malalim na paghinga, o pakikipag-usap sa kaibigan. May gusto ka bang malaman kung paano nakaka-relax ang sariwang hangin?"),
    row("Nakakabuti po ba ang vape?",
        "Vaping — frame as 'is good?' → must say no.",
        "Hindi po, hindi nakakabuti ang vape. 💨 Kahit mukhang 'mas malinis' kaysa sa sigarilyo, may nilalanghap pa ring kemikal at nicotine na nakakasama sa baga at nakakahumaling, lalo na sa mga bata at kabataan.\n\nMas mabuting iwasan ito. Ang pinakamabuti sa baga ay ang sariwang hangin. May gusto ka pa bang malaman tungkol sa pag-iingat ng katawan?"),
    row("Masama po ba ang vape?",
        "Vaping — Oo po, masama.",
        "Oo po, masama ang vape, lalo na sa mga bata. 💨 Maraming kemikal sa singaw ng vape na nakakasira sa baga, at ang nicotine ay nakakahumaling — pareho ito sa sigarilyo sa ganitong panig.\n\nKahit mukhang 'fashion' o 'cool' ang vape, hindi ito ligtas. Gusto mo bang malaman kung paano lumalaban ang baga sa mga lason sa hangin?"),
]

# --- OTHER HARM-SET (kid safety) — explicit Oo/Hindi by polarity, used to anchor the pattern ---
HARM = [
    row("Masama po ba uminom ng alak ang mga bata?",
        "Children alcohol — Oo po, masama.",
        "Oo po, masama at delikado ang alak para sa mga bata. 🚫 Nakakaapekto ito sa utak at katawan na patuloy pang lumalaki, kaya bawal ito sa mga menor de edad. Puwede ka nitong malulula o magkasakit.\n\nPara sa bata, mas mabuting tubig at gatas ang inumin. May iba ka pa bang itatanong tungkol sa malusog na pag-inom?"),
    row("Delikado po ba ang alak para sa mga bata?",
        "Same harm, different phrasing — Oo po, delikado.",
        "Oo po, talagang delikado ang alak sa mga bata. ⚠️ Hindi pa kasi handa ang utak at atay ng bata na harapin ito — puwede kang masaktan o magkasakit kahit konting alak lang. Kaya bawal po sa mga menor de edad.\n\nMas ligtas ang malulusog na inumin: tubig, gatas, prutas na juice. Anong iba pang tanong mo tungkol sa kalusugan?"),
    row("Masama po bang suminghot ng rugby o pandikit?",
        "Inhalants — firmly Oo po, napakadelikado.",
        "Oo po, napakadelikado nito. ⚠️ Ang usok ng rugby, pandikit, o gasolina ay may lason na sumisira sa utak at baga — puwede kang malula, mawalan ng malay, o magkaroon ng matinding sakit.\n\nHuwag na huwag mong gagawin ito, at sabihin agad sa isang matanda kung may nakikita kang gumagawa nito. Gusto mo bang malaman kung bakit kailangan ng sariwang hangin ang ating utak?"),
    row("Masama po ba ang bawal na gamot?",
        "Illicit drugs — Oo po, masama.",
        "Oo po, talagang masama at delikado ang bawal na gamot. 🚫 Nakakasira ito sa utak, puso, at iba pang bahagi ng katawan, at nakakahumaling — hirap nang itigil kapag nasimulan na.\n\nKaya bawal po ito sa lahat, lalo na sa mga bata. Kung may makikita kang nagbibenta o gumagamit, mahalagang sabihin agad sa pulis o sa isang matanda. May iba ka pa bang gustong malaman tungkol sa pangangalaga ng katawan?"),
    row("Pwede po bang kumain ng kabute na napupulot sa labas?",
        "Wild mushrooms — Hindi po, delikado.",
        "Hindi po, delikadong kumain ng kabuteng basta na lang napulot sa labas. 🍄 May mga kabute na may lason at hindi mo ito makikilala sa tingin lang — magkakapareho ang anyo ng ligtas at nakakalason.\n\nKumain lang ng kabuteng binili sa tindahan o niluto ng matatanda sa bahay. May gusto ka bang malaman kung paano natin nalalaman na ligtas ang isang pagkain?"),
    row("Ligtas po bang uminom ng tubig sa kanal kapag nauuhaw?",
        "Dirty water — Hindi po, hindi ligtas.",
        "Hindi po, hindi ligtas uminom ng tubig sa kanal o estero. 💧 May mga mikrobyong hindi nakikita sa tubig na iyon na puwedeng magdulot ng pagtatae at sakit sa tiyan.\n\nUminom lang ng malinis na tubig — pinakuluan o mula sa ligtas na pinagkukunan. Gusto mo bang malaman kung paano nagiging ligtas inumin ang tubig?"),
    row("OK lang po bang maglaro ng posporo o lighter?",
        "Matches — Hindi po, delikado.",
        "Hindi po, delikadong maglaro ng posporo o lighter. 🔥 Mabilis kumalat ang apoy at puwedeng magdulot ng sunog o paso. Ang apoy ay gamit lang ng matatanda para sa pagluluto, hindi panlaro.\n\nKung may makita kang nakakalat na posporo, ibigay ito sa isang matanda. May gusto ka bang malaman kung ano ang dapat gawin kapag may sunog?"),
    row("Masama po bang tumitig nang diretso sa araw?",
        "Sun-staring — Oo po, masama.",
        "Oo po, masama tumitig nang diretso sa araw. ☀️ Sobrang lakas ng liwanag nito kaya puwede nitong masira ang ating mga mata kahit sandali lang tumitig.\n\nKung gusto mong tingnan ang langit, mas mabuting tumingin sa ibang bahagi nito, hindi sa mismong araw. Gusto mo bang malaman kung bakit napakaliwanag ng araw?"),
    row("Pwede po bang isaksak ang daliri sa saksakan ng kuryente?",
        "Electrical outlet — Hindi po, very firm.",
        "Hindi po, napakadelikado nito! ⚡ Ang kuryente sa saksakan ay puwedeng makakuryente sa iyo at makasama nang malala sa katawan.\n\nHuwag mong ilalapit ang daliri o anumang bagay na metal sa saksakan. Kung may sira kang nakikitang saksakan o kable, sabihin agad sa matanda. May gusto ka bang malaman kung paano ligtas gamitin ang kuryente sa bahay?"),
    row("Ligtas po bang hawakan ang nakabukas na poste ng kuryente pagkatapos ng bagyo?",
        "Downed power line — Hindi po, very dangerous.",
        "Hindi po, huwag na huwag mong hahawakan! ⚡ Pagkatapos ng bagyo, maaaring nakabukas pa rin ang kuryente sa bumagsak na poste o kable, kahit mukhang patay na. Sobrang dali kang makukuryente.\n\nLumayo agad at sabihin sa isang matanda na may bumagsak na kable. May gusto ka bang malaman kung ano pa ang dapat iwasan pagkatapos ng bagyo?"),
]

# --- POSITIVE / SETTLED — Oo po patterns where polarity IS positive (so 1B doesn't over-correct) ---
POSITIVE = [
    row("Mabuti po bang uminom ng maraming tubig araw-araw?",
        "Drinking water — Oo po, mabuti.",
        "Oo po, mabuti at mahalagang uminom ng sapat na tubig araw-araw. 💧 Tumutulong ang tubig para gumana nang maayos ang ating katawan at hindi tayo mauhaw o mapagod agad.\n\nMabuting uminom lalo na kapag mainit ang panahon o pagkatapos maglaro. Gusto mo bang malaman kung gaano karaming tubig ang kailangan natin sa isang araw?"),
    row("Mabuti po ba kumain ng gulay at prutas?",
        "Veggies — Oo po, napakabuti.",
        "Oo po, napakabuting kumain ng gulay at prutas. 🥬 May mga sustansiya ang mga ito na nagpapalakas sa katawan at tumutulong para hindi tayo madaling magkasakit.\n\nSubukan mong kumain ng iba't ibang kulay — kamatis, talong, mangga, saging. May gusto ka bang malaman kung anong sustansiya ang nakukuha natin sa mga prutas?"),
    row("Kailangan po ba talagang matulog nang maaga?",
        "Sleep — Oo po, kailangan.",
        "Oo po, mahalagang matulog nang sapat at maaga. 😴 Habang natutulog ka, nagpapahinga at lumalakas ang iyong katawan at utak, kaya mas magaling kang matuto at maglaro kinabukasan.\n\nMas mabuting matulog nang maaga lalo na kapag may pasok. May gusto ka bang malaman kung bakit napapagod tayo at kailangang magpahinga?"),
    row("Mahalaga po ba talagang maghugas ng kamay bago kumain?",
        "Handwashing — Oo po, mahalaga.",
        "Oo po, napakahalaga maghugas ng kamay bago kumain. 🧼 May maliliit na mikrobyong hindi nakikita sa kamay natin mula sa mga bagay na nahawakan — kapag hindi natin hinugasan, puwede itong makapasok sa atin at magdulot ng sakit sa tiyan.\n\nGumamit ng sabon at tubig nang mga 20 segundo. Gusto mo bang malaman kung bakit hindi natin nakikita ang mga mikrobyo?"),
    row("Kailangan po bang magsuot ng helmet kapag nagbibisikleta?",
        "Helmet — Oo po, kailangan.",
        "Oo po, mahalagang magsuot ng helmet kapag nagbibisikleta. 🚲 Pinoprotektahan nito ang iyong ulo kung sakaling matumba ka — ang ulo ang pinaka-kailangan nating ingatan.\n\nSiguraduhin ding nakakabit nang maayos ang strap. Gusto mo bang malaman kung bakit napakahalaga ng ulo?"),
    row("Mabuti po bang mag-ehersisyo araw-araw?",
        "Exercise — Oo po, mabuti.",
        "Oo po, napakabuting mag-ehersisyo araw-araw. 🏃 Pinapalakas nito ang puso, baga, at kalamnan, at nakakatulong para makatulog ka nang mahimbing. Hindi kailangan mabigat — kahit pagtakbo lang sa labas o sayaw sa bahay ay tumutulong.\n\nGusto mo bang malaman kung paano lumalakas ang puso kapag nag-eehersisyo?"),
]

# --- SAFETY MYTHS — Hindi po totoo openers (debunk) ---
MYTHS = [
    row("Totoo po bang nakakabulag ang pagbasa sa madilim?",
        "Reading in dim light — false; eyes get tired only.",
        "Hindi po totoo na nakakabulag ang pagbasa sa madilim. 👀 Napapagod at nahihirapan lang ang mata kapag madilim, kaya puwede kang sumakit ng ulo o maantok — pero hindi ito nagiging dahilan ng pagkabulag.\n\nKahit ganoon, mas mabuti pa ring magbasa sa maliwanag para hindi mapagod. Gusto mo bang malaman kung paano gumagana ang mata sa liwanag?"),
    row("Totoo po bang nananatili ng 7 taon sa tiyan ang nalunok na bubblegum?",
        "Bubblegum — false.",
        "Hindi po totoo iyan. 🍬 Kahit hindi natutunaw ang bubblegum tulad ng ibang pagkain, hindi naman ito nananatili ng 7 taon — lumalabas din ito nang natural sa loob ng ilang araw lamang.\n\nMas mabuti pa ring huwag lunukin ang bubblegum at itapon na lang ito. May gusto ka pa bang itanong tungkol sa kung paano natutunaw ang pagkain?"),
    row("Totoo po bang 10% lang ng utak ang ginagamit natin?",
        "10% brain myth — false.",
        "Hindi po totoo na 10% lang ang ginagamit nating utak. 🧠 Ang totoo, ginagamit natin ang halos lahat ng bahagi ng utak — kahit sa mga simpleng bagay tulad ng pagsasalita o paglalakad ay maraming bahagi ng utak ang gumagana nang sabay-sabay.\n\nIpinakita ito ng mga scientist gamit ang brain scan. Gusto mo bang malaman kung anong mga bahagi ng utak ang gumagana kapag natutulog tayo?"),
    row("Totoo po bang dapat hintayin ang 30 minuto bago lumangoy pagkatapos kumain?",
        "Eating-before-swimming myth — false but moderation OK.",
        "Hindi po totoo na 30 minuto talaga ang dapat hintayin. 🏊 Hindi nasusubukan ng mga doktor na delikado mismo ang paglangoy pagkatapos kumain. Pero kapag sobrang busog ka, baka mahirapan lang kumilos.\n\nKaya mas mabuting maghintay ng konti hanggang hindi ka na masyadong busog. May gusto ka bang malaman kung paano ginagamit ng katawan ang pagkain?"),
    row("Totoo po bang nakakapuyat ang chocolate?",
        "Chocolate causing insomnia — partly true (caffeine), but the myth/reality nuance matters.",
        "Hindi po laging totoo. 🍫 May kakaunting caffeine sa chocolate na maaaring magpagising ng kaunti, pero karaniwan hindi ito sapat para magdulot ng sobrang puyat — maliban kung sobra-sobra ang kinain mo o napakalapit sa oras ng tulog.\n\nMas mabuti pa ring magpahinga sa matamis bago matulog. May iba ka pa bang gustong itanong tungkol sa pagkain at pagtulog?"),
]

ALL = SMOKING + HARM + POSITIVE + MYTHS
import sys
json.dump(ALL, open('finetuning/distill/safety-rows-v3.json', 'w'), ensure_ascii=False, indent=0)
print(f"wrote safety-rows-v3.json: {len(ALL)} rows", file=sys.stderr)
print(f"  smoking/vape: {len(SMOKING)}  other-harm: {len(HARM)}  positive: {len(POSITIVE)}  myths: {len(MYTHS)}", file=sys.stderr)

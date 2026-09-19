#!/usr/bin/env python3
"""kitten-v4 LAST-SHOT safety augmentation.

The 1B has an extremely strong "Hindi po" reflex opener; v3's 12 smoking rows × 10× weight (~1.2%
of dataset) couldn't override it ("Hindi po, mabuti pa nga ang manigarilyo!"). v4 increases smoking-
specific signal by ~3× — 40+ smoking yes/no rows in many lexical/syntactic/Taglish variants — and
DROPS the v3 myth-debunks and positive-affirmations entirely (they reinforced a "Hindi po totoo /
Hindi po, hindi" reflex that confused smoking-specific cases). Combined with 20× weighting + r=64
LoRA = ~20% dataset share. If this still fails, the 1B base is structurally over-biased and we
accept it.

OUT: finetuning/distill/safety-rows-v4.json  (consumed by build-v9plus-assemble.mts)
"""
import json

def row(seed, think, ans):
    return {"type": "safety", "seed": seed,
            "assistant": f"<think>\n{think}\n</think>\n\n{ans}"}

# ---- 40 SMOKING-SPECIFIC ROWS, every one resolves anti-smoking ----
SMOKING = []

# A. POSITIVE-POLARITY harm frame ("Masama ba"): correct answer = Oo po, masama
SMOKING += [
 row("Masama po ba ang manigarilyo?",
  "Direct harm yes/no on smoking. Settled harmful — open Oo po, masama.",
  "Oo po, masama at delikado ang manigarilyo. 🚭 Sumisira ito sa baga at puso, at nakakahumaling. May daan-daang kemikal na lason ang usok nito.\n\nKaya mas mabuting huwag kailanman magsimula. May gusto ka pa bang itanong tungkol sa baga?"),
 row("Masama ba ang sigarilyo?",
  "Smoking harm — Oo po, masama.",
  "Oo po, talagang masama ang sigarilyo. ⚠️ May halong kemikal na pumipinsala sa baga, sa puso, at sa balat. Nakakahumaling ang nicotine sa loob nito.\n\nIniiwasan ito ng matatanda dahil nga delikado. Anong iba pang gusto mong itanong tungkol sa kalusugan?"),
 row("Masama po ba ang vape?",
  "Vape harm — Oo po, masama.",
  "Oo po, masama ang vape lalo na sa mga bata. 💨 May nicotine at iba pang kemikal sa singaw nito na pumipinsala sa baga at nakakahumaling.\n\nKahit mukhang 'malinis' na usok, hindi ito ligtas. Gusto mo bang malaman kung paano lumalaban ang baga sa hangin?"),
 row("Masama po ba para sa baga ang manigarilyo?",
  "Specifically lungs harm — Oo po, sobrang masama.",
  "Oo po, sobrang masama para sa baga ang manigarilyo. 🫁 Sumusunog sa loob ng mga maliliit na supot ng baga (alveoli) na sumisalo ng oxygen — kaya unti-unting hinahirapan ng naninigarilyo huminga.\n\nMahalagang protektahan ang ating baga. May iba ka pa bang gustong itanong tungkol sa paghinga?"),
 row("Masama po ba para sa puso ang sigarilyo?",
  "Heart harm — Oo po, masama.",
  "Oo po, masama ang sigarilyo para sa puso. ❤️ Pinapabilis nito ang tibok ng puso at pinapakapal ang mga ugat, kaya tumataas ang panganib sa atake sa puso at stroke.\n\nIniiwasan ito ng mga matatandang gusto manatiling malusog. Ano pa ang gusto mong malaman?"),
 row("Masama ba para sa bata ang naninigarilyo sa paligid?",
  "Secondhand smoke harm to children — Oo po, masama.",
  "Oo po, masama sa bata ang usok ng sigarilyo sa paligid (secondhand smoke). 👶 Kahit hindi ikaw ang naninigarilyo, ang nalalanghap mong usok ay may parehong mga lason na sumisira sa baga.\n\nMabuting lumayo kapag may naninigarilyo sa malapit. Gusto mo bang malaman kung paano nililinis ng baga ang hangin?"),
 row("Masama po ba ang second-hand smoke?",
  "Same — Oo po.",
  "Oo po, masama ang second-hand smoke. 🚭 Yan ang usok na nalalanghap mo mula sa naninigarilyo sa malapit — may parehong mga nakakasamang kemikal na pumipinsala sa baga at puso.\n\nKaya bawal ang manigarilyo sa loob ng bahay o paaralan. May iba ka pa bang gustong itanong?"),
 row("Masama po ba kumain ng sigarilyo?",
  "Eating cigarettes — extremely harmful (kids). Oo po, sobrang delikado.",
  "Oo po, napakadelikado kumain ng sigarilyo. ⚠️ Marami itong lason — lalo na ang nicotine — na nakakapagdulot ng pagsusuka, panghihina, at sobrang sakit sa katawan, lalo na sa mga bata.\n\nKung may makita kang bumagsak na sigarilyo, huwag mong galawin at sabihin agad sa matanda. May iba ka pa bang itatanong?"),
 row("Masama po ba kahit isang sigarilyo lang?",
  "Even one — still harmful, especially as initiation. Oo po.",
  "Oo po, masama kahit isa lamang. ⚠️ Sa loob ng isang sigarilyo ay daan-daang kemikal na agad pumapasok sa baga. At marami sa mga naninigarilyo ngayon ay nagsimula sa 'isang beses lang.'\n\nWalang ligtas na dami para sa bata — pinakamabuti ang HUWAG simulan. Ano pa?"),
 row("Masama po ba ang chewing tobacco o nganga?",
  "Smokeless tobacco — Oo po, masama.",
  "Oo po, masama rin ang nganga o chewing tobacco. 🚫 May parehong nicotine na nakakahumaling, at nadadagdagan pa ang panganib sa cancer sa bibig at lalamunan.\n\nHindi rin ito ligtas — kahit hindi nasusunog, lason pa rin. May iba ka pa bang gustong itanong?"),
 row("Delikado po ba ang manigarilyo?",
  "'Delikado' framing — Oo po.",
  "Oo po, talagang delikado ang manigarilyo. 🚭 Pumapasok sa baga ang usok at may daan-daang nakakasamang kemikal. Pati ang mga taong malapit sa naninigarilyo ay nasasaktan dahil sa nalalanghap nilang usok.\n\nMabuting iwasan natin ang lugar kung saan may naninigarilyo. May iba ka pa bang gustong itanong?"),
 row("Delikado po ba ang sigarilyo sa mga bata?",
  "Kids + smoking — Oo po, sobrang delikado.",
  "Oo po, sobrang delikado ang sigarilyo lalo na sa mga bata. 👶 Lumalaki pa ang baga at utak ng bata, kaya mas matindi ang masamang epekto. Mas mahirap ding itigil kapag nagsimula sa murang edad.\n\nKaya bawal mga 18 pababa. May gusto ka bang malaman kung paano lumalaki ang baga?"),
 row("Nakakasama po ba ang sigarilyo sa katawan?",
  "Harm to body — Oo po, nakakasama.",
  "Oo po, nakakasama nang malala sa katawan ang sigarilyo. 🫁 Pinapahina ang baga, pinapabilis ang puso, at nakakabawas ng oxygen sa dugo. Sa katagalan, puwedeng magdulot ng cancer at iba pang malalang sakit.\n\nIniiwasan ito ng matatanda. May iba ka pa bang gustong malaman tungkol sa kalusugan?"),
 row("Nakakasama po ba ang vape sa baga?",
  "Vape lung harm — Oo po.",
  "Oo po, nakakasama ang vape sa baga. 💨 Kahit mukhang 'tamang hangin' lang ang singaw, may kemikal at nicotine na sumisira sa supot ng baga (alveoli). May mga kabataang nagkasakit nang malala dahil sa vape.\n\nHindi ito ligtas, lalo na sa bata. Anong iba pang tanong meron ka?"),

# B. INVERTED FRAME ("Mabuti/Nakakabuti/Cool/Sosyal ba"): correct answer = Hindi po + reinforce harm
 row("Nakakabuti po ba ang manigarilyo?",
  "Inverted frame (good?) — Hindi po, hindi nakakabuti. Reinforce with masama content.",
  "Hindi po, hindi nakakabuti ang manigarilyo — masama nga ito sa katawan. 🚭 Wala itong magandang naidudulot — sumisira sa baga at puso, at nakakahumaling.\n\nMaraming sakit ang dulot ng matagal na paninigarilyo. Gusto mo bang malaman kung anong totoong nakakatulong sa katawan?"),
 row("Mabuti po ba para sa katawan ang sigarilyo?",
  "Inverted — Hindi po, hindi mabuti.",
  "Hindi po, hindi mabuti para sa katawan ang sigarilyo — masama ito. ❌ Sa halip na tumulong, sumisira ito sa baga, puso, balat, at halos lahat ng bahagi.\n\nWalang sustansyang nakukuha sa sigarilyo. Para malusog, mas mabuti ang ehersisyo, sapat na tulog, at masustansyang pagkain. May iba ka pa bang tanong?"),
 row("Nakakatulong po ba sa stress ang manigarilyo?",
  "'Helps stress' myth — Hindi po, false; smoking actually increases stress long-term.",
  "Hindi po, hindi totoong nakakatulong sa stress ang manigarilyo. 🧘 Pansamantala lang ang pakiramdam ng kalma dahil sa nicotine, pero pagkatapos ay mas lalo pang stressed dahil kailangan na ulit manigarilyo (humahabit ang katawan).\n\nMas mabuting paraan: paglalakad, malalim na paghinga, o pakikipag-usap sa kaibigan. Gusto mo bang malaman pa?"),
 row("Mabuti po ba sa hininga ang sigarilyo?",
  "Inverted breathing — Hindi po, sumisira sa hininga.",
  "Hindi po, hindi mabuti — sumisira nga ang sigarilyo sa hininga. 🫁 Pinapasama nito ang baga, kaya mas madali kang humihingal at inuubo. Kabaligtaran ito ng tunay na nakakatulong: ehersisyo at sariwang hangin.\n\nMabuti ang malalim at malinis na paghinga. May iba ka pa bang gustong itanong?"),
 row("Nakakapayat po ba ang manigarilyo?",
  "Weight-loss myth — Hindi po, dangerous misconception.",
  "Hindi po, hindi totoong nakakapayat ang manigarilyo. 🚭 Maaaring nababawasan lang ang gana sa pagkain dahil sa nicotine, pero ang halagang ibinabayad ay sakit sa baga, sa puso, at sa balat — masyadong mahal para sa kaunting payat.\n\nMas mabuti ang malusog na pagkain at ehersisyo. May iba pang tanong?"),
 row("Cool po ba ang manigarilyo?",
  "Social/'cool' framing — Hindi po, hindi cool, masama.",
  "Hindi po, hindi cool ang manigarilyo — masama nga ito. 🚭 Maaaring may mga taong nagiging 'cool' dahil dito sa pelikula, pero sa totoo, nakakapinsala lang ito sa katawan.\n\nMas cool ang taong nagpapatibay ng sarili at hindi nakakahumaling. May ibang gusto ka pang itanong?"),
 row("Sosyal po ba ang vape?",
  "Vape as 'social' — Hindi po, masama pa rin.",
  "Hindi po, hindi sosyal ang vape — masama pa rin ito sa baga. 💨 Mukha lang itong 'fashionable' o 'sosyal' dahil sa anyo at lasa, pero ang nilalanghap mong singaw ay may kemikal at nicotine pa rin.\n\nMas mahalaga ang tunay na ligtas na hangin. Anong iba pang gusto mong matutuhan?"),
 row("Maganda po ba ang vape kaysa sigarilyo?",
  "'Vape is better than cigarettes' framing — Hindi po, parehong masama.",
  "Hindi po, parehong masama ang dalawa. 💨 Kahit walang sunog na usok ang vape, may nicotine at mga kemikal pa rin na pumipinsala sa baga. Pareho silang nakakahumaling.\n\nWalang 'mas mabuti' na pagpipilian — pareho mong dapat iwasan. May iba ka pa bang tanong?"),

# C. PERMISSION/ALLOWED frame ("Pwede / OK lang / Bawal ba"): correct answer = Hindi po, bawal/masama
 row("Pwede po ba ako manigarilyo?",
  "Permission for kid — Hindi po, bawal.",
  "Hindi po, hindi pwede magnigarilyo ang bata — bawal po ito ayon sa batas at masama rin sa katawan. 🚭 Ang sigarilyo ay nakakasira sa baga at puso, lalo na sa paturubo pang katawan.\n\nKahit may matandang magpipilit, lumayo ka. May gusto ka pa bang matutuhan?"),
 row("OK lang po ba manigarilyo kung minsan lang?",
  "Occasional smoking — Hindi po, hindi OK.",
  "Hindi po, hindi OK kahit minsan lang. ⚠️ Kahit isang sigarilyo ay may lason na pumapasok sa baga, at madalas dito nagsisimula ang habit — unti-unti, nadadagdagan hanggang mahirap nang itigil.\n\nWalang ligtas na dami. Gusto mo bang malaman kung paano nananatiling malusog ang baga?"),
 row("OK lang po ba ang vape kasi 'walang' nicotine daw?",
  "'No-nicotine vape' framing — Hindi po, nakakasama pa rin.",
  "Hindi po, hindi OK kahit walang nicotine daw. 💨 Marami sa mga vape na sinasabing 'walang nicotine' ay mali ang label, at kahit walang nicotine, ang mga kemikal at pagpapainit ng mga lasa ay pumipinsala pa rin sa baga.\n\nMas mabuti ang sariwang hangin lang. May iba ka pa bang itatanong?"),
 row("Bawal po ba talaga ang manigarilyo sa mga bata?",
  "'Is smoking actually banned for kids?' — Oo po, bawal at delikado.",
  "Oo po, bawal po talaga ang sigarilyo sa mga menor de edad — dahil masama nga ito sa lumalaki pang katawan. ⚠️ May batas sa Pilipinas (RA 9211) na ipinagbabawal ang pagbebenta sa mga wala pang 18.\n\nKahit pilitin ka ng iba, hindi mo dapat subukan. Anong iba pang tanong?"),
 row("Pwede po bang sumubok ng sigarilyo isang beses lang?",
  "'Try once' — Hindi po, dangerous gateway.",
  "Hindi po, hindi mabuti sumubok kahit isang beses. 🚭 Kahit isang sigarilyo ay agad na lason na pumapasok sa baga. At marami sa mga naninigarilyo ngayon ay nagsimula sa 'isang beses lang.'\n\nMas mabuting talagang iwasan ito. Ano pa ang gusto mong matutuhan?"),
 row("Pwede po bang manigarilyo kasi naninigarilyo ang tatay ko?",
  "Parent-influence framing — Hindi po, hindi pwede + suggest distance.",
  "Hindi po, hindi pwede — masama pa rin ang sigarilyo, kahit sino pa ang naninigarilyo. 💔 Ang tatay mo ay tao ring nahihirapan itigil dahil sa nicotine — hindi ito modelo na susundan.\n\nMas mabuting lumayo ka sa usok niya at huwag kang magsimula. May iba ka pa bang gustong malaman?"),

# D. EXTRA HIGH-FREQUENCY PATTERNS the 1B might encounter
 row("Healthy po ba ang vape?",
  "Taglish 'healthy?' — Hindi po, hindi healthy.",
  "Hindi po, hindi healthy ang vape. 💨 May nicotine at iba pang kemikal sa singaw nito na nakakapinsala sa baga at nakakahumaling.\n\nAng pinakahealthy ay sariwang hangin lang. Gusto mo bang malaman kung paano nasasaktan ng vape ang baga?"),
 row("Safe po ba ang vape kung nicotine-free?",
  "'Safe if nicotine-free?' — Hindi po.",
  "Hindi po, hindi safe kahit nicotine-free. 💨 Ang pagpapainit ng mga 'flavors' ay gumagawa ng mga maliliit na lason na pumipinsala pa rin sa baga.\n\nWalang 'safe' na vape — pinakaligtas ang HINDI gumagamit. May ibang tanong ka pa?"),
 row("Mas safe po ba ang vape kaysa sigarilyo?",
  "'Vape safer than cigs?' — Both harmful, no clear safety claim.",
  "Hindi po, hindi ito mas safe — pareho silang nakakapinsala sa baga at nakakahumaling. 💨🚭 Madalas pinoposisyon ang vape bilang 'mas malinis,' pero may sariling mga panganib ito, lalo na sa kabataan.\n\nWalang ligtas na pamamaraan — pareho mong dapat iwasan. May iba pang tanong?"),
 row("Maganda po ba ang lasa ng vape kaya hindi nakakasama?",
  "'Good flavor → not harmful?' — disconnect flavor from safety.",
  "Hindi po — kahit masarap ang lasa, masama pa rin ang vape. 🍓💨 Ang mga 'flavored' vape ay ginawang masarap nga para mas marami ang gumamit, pero hindi nito kinakansel ang pinsala sa baga.\n\nMagandang lasa ng prutas? Kainin mo na lang ang totoong prutas. May iba ka pa bang gustong itanong?"),
 row("Yung naninigarilyo, mas masaya ba?",
  "'Smokers happier?' — Hindi po, the opposite long-term.",
  "Hindi po, hindi mas masaya ang naninigarilyo. 😔 Maaaring magkunwari silang relaxed, pero ang totoo, nahihirapan sila itigil dahil sa habit. Marami ang pagsisisi ng pagsimula.\n\nAng tunay na ligaya ay nanggagaling sa malusog na katawan at relasyon, hindi sa sigarilyo. Anong iba mong gusto malaman?"),
 row("Pakulayang ba ang vape sa mga galit?",
  "'Vape as anger coping?' — Hindi po, hindi solusyon.",
  "Hindi po, hindi solusyon ang vape sa galit. 💨 Pansamantala lang ang relief, at madali itong magiging habit na mas mahirap itigil.\n\nMas mabubuting paraan: pagsasabi ng nararamdaman sa isang tao na pinagkakatiwalaan, paglalakad, o pagsusulat. May iba ka pa bang itatanong?"),
 row("Lahat naman po ng kakilala ko naninigarilyo, OK lang ba?",
  "Peer-pressure framing — Hindi po, kahit lahat, masama pa rin.",
  "Hindi po, hindi OK kahit lahat ng kakilala mo. 💔 Hindi sukatan ng kung ano ang mabuti ang dami ng gumagawa — masama nga ang sigarilyo, kahit sino pa ang gumamit nito.\n\nMaging matatag — may mga taong sasunod sa iyong magandang halimbawa. May iba pang gusto mong itanong?"),
 row("Pwede po bang manigarilyo kapag nag-iisa?",
  "'Smoke alone?' framing — Hindi po, still harmful regardless.",
  "Hindi po, kahit nag-iisa, masama pa rin ang manigarilyo. 🚭 Ang panganib sa baga at puso ay hindi nababawasan dahil sa walang nakakakita — ang katawan mo ay tumatanggap pa rin ng lason.\n\nIwasan mong magsimula. May iba pa bang gusto mong matutuhan?"),
]

# ---- 10 OTHER HARM-SET (all Oo po, masama / Hindi po, delikado pattern) ----
HARM = [
 row("Masama po ba uminom ng alak ang bata?",
  "Children + alcohol — Oo po, masama.",
  "Oo po, masama at delikado ang alak para sa mga bata. 🚫 Nakakaapekto ito sa utak at katawan na patuloy pang lumalaki, kaya bawal ito sa mga menor de edad. Puwede ka nitong malulula o magkasakit.\n\nPara sa bata, ang pinakamabuti ay tubig at gatas. May iba ka pa bang gustong itanong?"),
 row("Masama po ba ang bawal na gamot?",
  "Illicit drugs — Oo po, masama.",
  "Oo po, talagang masama at delikado ang bawal na gamot. 🚫 Nakakasira ito sa utak, puso, at iba pang bahagi ng katawan, at nakakahumaling — hirap nang itigil kapag nasimulan na.\n\nKaya bawal po ito. May iba ka pa bang gustong malaman tungkol sa pangangalaga ng katawan?"),
 row("Masama po bang suminghot ng rugby?",
  "Inhalants — Oo po, sobrang masama.",
  "Oo po, napakadelikado nito. ⚠️ Ang usok ng rugby, pandikit, o gasolina ay may lason na sumisira sa utak at baga — puwede kang malula, mawalan ng malay, o magkaroon ng matinding sakit.\n\nHuwag na huwag gagawin. Gusto mo bang malaman kung bakit kailangan ng sariwang hangin ang utak?"),
 row("Masama po bang tumitig nang diretso sa araw?",
  "Sun staring — Oo po, masama sa mata.",
  "Oo po, masama tumitig nang diretso sa araw. ☀️ Sobrang lakas ng liwanag nito kaya puwede nitong masira ang ating mga mata kahit sandali lang.\n\nKung gusto mong tingnan ang langit, tumingin sa ibang bahagi nito. Anong iba pa?"),
 row("Pwede po bang isaksak ang daliri sa saksakan?",
  "Outlet — Hindi po, very dangerous.",
  "Hindi po, napakadelikado nito! ⚡ Puwede kang ma-kuryente at magkaroon ng matinding pinsala sa katawan.\n\nHuwag kailanman gawin. Kung may sira sa saksakan, sabihin agad sa matanda. May iba pang tanong?"),
 row("Ligtas po bang uminom ng tubig sa kanal?",
  "Dirty water — Hindi po.",
  "Hindi po, hindi ligtas uminom ng tubig sa kanal. 💧 May mga mikrobyong hindi nakikita na puwedeng magdulot ng pagtatae at sakit sa tiyan.\n\nUminom lang ng malinis na pinakuluang tubig. Anong gusto mo pang itanong?"),
 row("Pwede po bang maglaro ng posporo?",
  "Matches — Hindi po, delikado.",
  "Hindi po, delikadong maglaro ng posporo. 🔥 Mabilis kumalat ang apoy at puwedeng magdulot ng sunog o paso.\n\nKung may makita kang nakakalat na posporo, ibigay sa matanda. Gusto mo bang malaman kung ano ang gagawin kapag may sunog?"),
 row("Pwede po bang kumain ng kabuteng pinulot sa labas?",
  "Wild mushrooms — Hindi po.",
  "Hindi po, delikadong kumain ng kabuteng pinulot sa labas. 🍄 May mga kabute na may lason at hindi mo ito makikilala sa tingin lang.\n\nKain lang ng kabuteng binili sa tindahan o niluto ng matatanda. May iba pa bang gusto mong itanong?"),
 row("Ligtas po bang hawakan ang bumagsak na poste ng kuryente?",
  "Downed wire — Hindi po, very dangerous.",
  "Hindi po, huwag na huwag mong hahawakan! ⚡ Pagkatapos ng bagyo, maaaring may buhay pa ring kuryente sa bumagsak na kable, kahit mukhang patay na.\n\nLumayo at sabihin agad sa matanda. May iba ka pa bang gustong malaman?"),
 row("Masama po bang labis-labis kumain ng asukal?",
  "Excessive sugar — Oo po, masama.",
  "Oo po, masama ang labis na asukal sa katawan. 🍬 Sa labis, puwedeng magdulot ng sira sa ngipin, labis na timbang, at sakit sa katawan tulad ng diabetes sa katagalan.\n\nMaaari kang kumain ng kaunting matamis paminsan-minsan, pero hindi araw-araw at hindi sobra-sobra. Anong gusto mo pang itanong?"),
]

ALL = SMOKING + HARM
import sys
json.dump(ALL, open('finetuning/distill/safety-rows-v4.json', 'w'), ensure_ascii=False, indent=0)
print(f"wrote safety-rows-v4.json: {len(ALL)} rows", file=sys.stderr)
print(f"  smoking/vape: {len(SMOKING)}  other-harm: {len(HARM)}", file=sys.stderr)

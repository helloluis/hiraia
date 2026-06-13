# RL prompt set — stats

seed=42

## tagalog — 2800 rows → rl-prompts.tagalog.jsonl

- kinds: {"knowledge":280,"grounded":1400,"distractor":420,"abstain":280,"chitchat":280,"trap":140}
- gold-fact domains: {"EARTH_SPACE":405,"LIVING_THINGS":1027,"MATTER":348,"FORCE_MOTION_ENERGY":369,"PH_GEOGRAPHY":54,"PH_CIVICS":37}
- grades: {"3":269,"4":424,"5":653,"6":590,"7":586,"undefined":278}
- mean required=2.80 forbidden=1.89 expect_image:true=135

- example grounded: `rl-tl-grounded-01269` user(…tail): "— do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Pwede po bang ipaliwanag kung ano ang babaeng kambing?" meta: req=["babaeng kambing","kambing","kinakain","anak"] forb=["malaking","resesibo"] abstain=false img=null
- example distractor: `rl-tl-distractor-01776` user(…tail): "do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Ano po ba ang lagnat? Hindi ko po maintindihan sa klase." meta: req=["lagnat","sakit","tubig"] forb=["nakaimbak","kemikal","enerhiya"] abstain=false img=null
- example knowledge: `rl-tl-knowledge-01965` user(…tail): "the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Ituro mo naman sa akin ang tungkol sa PHIVOLCS watches for earthquakes 🙏" meta: req=["ahensiya","PHIVOLCS","babala"] forb=["buko shake","tumitining","suspension"] abstain=false img=null
- example abstain: `rl-tl-abstain-02428` user(…tail): "ot just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Ano po ang pangalan ng pinakaunang isda na nabuhay sa mundo?" meta: req=[] forb=["thermal energy"] abstain=true img=false
- example chitchat: `rl-tl-chitchat-02632` user(…tail): "thank you po ulit!" meta: req=[] forb=[] abstain=false img=false
- example trap: `rl-tl-trap-01456` user(…tail): "s level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  yung Tonga daw, ano yun? sabi ng teacher namin" meta: req=["Tonga","pangatlo","Mariana Trench","Challenger Deep"] forb=["bumubuo","mineral"] abstain=false img=null

## cebuano — 1700 rows → rl-prompts.bisaya.jsonl

- kinds: {"grounded":850,"trap":85,"abstain":170,"chitchat":170,"distractor":255,"knowledge":170}
- gold-fact domains: {"LIVING_THINGS":609,"EARTH_SPACE":276,"FORCE_MOTION_ENERGY":197,"MATTER":223,"PH_GEOGRAPHY":35,"PH_CIVICS":20}
- grades: {"3":158,"4":221,"5":395,"6":363,"7":385,"undefined":178}
- mean required=2.71 forbidden=1.84 expect_image:true=87

- example grounded: `rl-bis-grounded-03240` user(…tail): "'s level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Unsa man ang sap-sucking stunts plant growth?" meta: req=["maluya","pagtubo","duga","tanom"] forb=["iring","gabi"] abstain=false img=null
- example distractor: `rl-bis-distractor-03816` user(…tail): "ent's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Pwede ba nimo ipasabot kung unsa ang lima?" meta: req=["lima","petalo","gumamela","bulak"] forb=["coyote","prairie dog","tawo"] abstain=false img=null
- example knowledge: `rl-bis-knowledge-04135` user(…tail): "l — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Unsa po ang booster doses? Wala ko kasabot sa klase." meta: req=["pahinumdom","booster"] forb=["hangin"] abstain=false img=null
- example abstain: `rl-bis-abstain-04201` user(…tail): "Kinsa ang pinakaunang tawo nga nakakita og panganod?" meta: req=[] forb=[] abstain=true img=false
- example chitchat: `rl-bis-chitchat-04448` user(…tail): "sige, bye na!" meta: req=[] forb=[] abstain=false img=false
- example trap: `rl-bis-trap-03710` user(…tail): "ur own words at the student's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  sistemang solar???" meta: req=["sistemang solar","pinakadako","Jupiter","planeta"] forb=["power","geothermal"] abstain=false img=null

## english — 700 rows → rl-prompts.tagalog.jsonl (merged)

- kinds: {"trap":35,"grounded":350,"abstain":70,"chitchat":70,"distractor":105,"knowledge":70}
- gold-fact domains: {"LIVING_THINGS":247,"MATTER":78,"FORCE_MOTION_ENERGY":104,"EARTH_SPACE":111,"PH_GEOGRAPHY":13,"PH_CIVICS":7}
- grades: {"3":56,"4":102,"5":169,"6":134,"7":153,"undefined":86}
- mean required=2.39 forbidden=1.74 expect_image:true=34

- example grounded: `rl-en-grounded-04770` user(…tail): " the student's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Teach me about nipa hut please 🙏" meta: req=["nipa hut","fixed shape","bamboo","solid"] forb=["melted","aluminum"] abstain=false img=null
- example distractor: `rl-en-distractor-04903` user(…tail): "tudent's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  What is yeast producing carbon dioxide?" meta: req=["balloon","yeast","carbon dioxide"] forb=["silkworm","caterpillar","cocoon"] abstain=false img=null
- example knowledge: `rl-en-knowledge-05021` user(…tail): "udent's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  Can you explain what scent particles is?" meta: req=["scent particles","flick","molecules"] forb=["straight line","block","shadow"] abstain=false img=null
- example abstain: `rl-en-abstain-05066` user(…tail): "Who was the first person ever to see a cloud?" meta: req=[] forb=[] abstain=true img=false
- example chitchat: `rl-en-chitchat-05141` user(…tail): "good night" meta: req=[] forb=[] abstain=false img=false
- example trap: `rl-en-trap-04861` user(…tail): "teach in your own words at the student's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure.  snug???" meta: req=["snug","socket"] forb=["tardigrade","moss"] abstain=false img=null


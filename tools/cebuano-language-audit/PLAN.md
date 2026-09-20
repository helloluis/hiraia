# Cebuano (Bisaya) card-language audit

Worktree `/Users/luis/Code/hiraia-card-lang`, branch `cebuano-language-audit`, off `main`
at bd2ff5ea6 (v0.4.19 shipped).

Sibling of `tools/card-language-audit`, which did this for Tagalog. That pass repaired 1,886
cards and shipped in 0.4.18/0.4.19. **Read its REPORT.md before changing anything here** — the
method below is not arbitrary, every rule is a scar.

## The governing constraint

**Claude's Cebuano is weaker than its Tagalog, so this audit does NOT rest on Claude's
judgement of Cebuano style.** In the Tagalog pass the hand-built control set was wrong on 3 of
9 words, and the judge was right each time — because it read the card and Claude read a word
list. Repeating that mistake in a language Claude knows less well would produce confident,
wrong numbers.

So: **every defect must be provable against the card's own English or its own answer.**
Register, idiom, dialect and word-preference are OUT OF SCOPE. Cebuano has wide regional
variation (Cebu / Davao / Mindanao) and a prescriptivist pass would churn good cards — the
Tagalog design workflow refuted 42 of 46 proposed defect classes for exactly that reason.

## Scope, measured 2026-09-20

49,156 cards all carry a Cebuano body; 19,285 open with a Cebuano question.
Structural checks are already CLEAN — the Tagalog pass fixed them across all three languages:
  literal backslash-n in bis .... 0
  bis identical to tl/en ........ 0 / 1
  orphaned bis emphasis spans ... 0 of 27,263
Tagalog bleed into Cebuano is NOT a problem: 5 marker occurrences plus 6 standalone "ay"
across 49,156 cards. (A first probe claimed 1,582 — it was wrong: nila/kanila/niya/ako/kami
are valid Cebuano, and "ay" was matching inside hyphenated words like taghan-ay.)
So the cheap deterministic wins are already banked; what remains is semantic.

## Hard boundaries

- **No cards.db rebuild, no APK, no deploy, no push.** Commit to this branch only.
- **Write a card only when the defect is provable from its own English or answer.**
- **Every edit goes through an emphasis guard**, checked per language against its own text.
  A span not present verbatim stops rendering silently; 27,263 bis spans are in scope.
- **Never apply a grep without triage.** In the Tagalog pass 952 of 1,017 grep candidates were
  FINE; blind application would have corrupted 952 good cards to fix 61.
- **No OpenRouter spend.** In-session on the subscription.

## Stages

- [x] **C0** DONE — 50-item gold set (17 FLAG / 33 PASS), 15 rows marked `native: true`.
      Confidence on the FLAG side is honest: 2 high, 9 medium, 6 low.

      **Negative result first, because it cost three attempts.** I tried to build the gold set
      from "objective" en-vs-bis NUMBER mismatches, needing no Cebuano judgement at all.
      It does not work:
        attempt 1 (78 hits)    \b missed digits glued to letters — 10x, 23rd, COVID-19
        attempt 2 (8,843 hits) mapping number-WORDS was catastrophic: Cebuano `usa` is both
                               "one" AND the indefinite article, so `usa ka insekto` ("an
                               insect") registered as the number 1 across thousands of cards
        attempt 3 (21 hits)    digits only, both sides required — plausible, but most are
                               still fine: `napulo ka beses` IS "10 times", `dekada '90` IS
                               the 1990s, `ika-14 siglo` IS the 1300s, `liboan` IS "thousands"
      Cebuano routinely spells numbers out and uses idiomatic date forms, so number mismatch is
      NOT an objective signal here. That closes off the approach proposed to Luis as the way to
      avoid relying on Claude's Cebuano.

      **What worked instead: corpus-internal frequency.** The proposer had to quote both sides,
      and each disputed word was then checked against how the CORPUS uses it — no appeal to
      Claude's Cebuano intuition:
        `panghupaw` (sighing) used for "sweat" on 4 cards, while `singot` (correct) appears on 152
        `tabanog` appears with English "kite" on 7 cards and "dragonfly" on 2 — the 2 are outliers
        `asin` appears on 551 cards, every one meaning SALT — so a title rendering "smoke" as
        `asin` ("Toxic Asin Plastik") is wrong; smoke is `aso`
      Verification also corrected the proposer once: it called `tabanog` unambiguously "kite",
      but the corpus uses it both ways, so that row dropped from high to needing native review.

      Sample drawn RANDOM and unfiltered on purpose — a filtered pool would bake the filter's
      blind spots into the gold set, and this stage demonstrated three such blind spots.
      Rate: 17 findings in 600 cards (2.8%), against 0.78% for Tagalog.
- [x] **C0-note** Original wording of this stage kept below for provenance:
      Build the Cebuano gold set the EVIDENCE way: do not hand-label from a word list.
      Draw candidates where the Cebuano contradicts its own English, label each WITH the card
      open, and mark every uncertain row `native: true`. Target 40-60 items, FLAG/PASS balanced.
      Record honestly that these labels are Claude's and are not native-verified.
- [x] **C1** PASSED, with the scope narrowed by what it revealed. 3 independent runs over a
      125-card production-shaped batch (50 gold + 75 unseen filler, judge blind to which):

      | run | FLAG precision | recall | flags on unseen filler |
      |---|---|---|---|
      | 1 | 1.00 | .18 | 0 |
      | 2 | 1.00 | .24 | 2 |
      | 3 | 1.00 | .41 | 0 |

      **Precision 1.00 across 375 judgements, zero false positives.** Gate cleared.

      The low recall is NOT blindness — it is a THRESHOLD DIFFERENCE, visible in the notes.
      The judge only flags when the fact is UNRECOVERABLE; the C0 proposer flagged wrong
      wording even when the surrounding text rescued the fact. On ffct-15087 it wrote: title
      'Asin' looks like a typo for 'aso', but "the body correctly says toxic smoke" -> PASS.
      Both standards are defensible; they answer different questions. So the C0 gold labels
      are too aggressive, not the judge too blind.

      Recall against the gold's OWN confidence tiers makes it clean:
        high-confidence FLAGs (unambiguous) .... 2/2  = 100%
        medium ................................ 4/9
        low ................................... 1/6
        false positives on gold PASS rows ..... 0
      The judge is reliable exactly where the gold is reliable, and misses exactly the rows
      marked `native: true` where Claude's Cebuano was already the weak link.

      **Consequence for scope:** this judge is fit for "cards that teach a child something
      FALSE" — the project's accuracy-above-fluency rule — and is not fit for a wording or
      style audit, which was already out of scope. C2 onward therefore targets unrecoverable
      factual defects only, and runs as a 3-run union (41% overall recall, 100% on the
      unambiguous tier, 0 false positives).

      Also measured: 7 of 125 cards got different verdicts across the three runs, which is why
      the union rather than a single run is the production configuration.
- [x] **C1-note** original stage text: Score the judge on C0's gold at PRODUCTION batch size. Report accuracy plus
      precision and recall on FLAG **separately** — never averaged. Gate: FLAG precision >= 0.9.
      If it fails, stop and say so rather than sweeping 19,285 cards with an unmeasured judge.
- [x] **C2** DONE — 1,500 unseen cards, 3-run union, full card record, no truncation.
      **14 flags = 0.93%** (per-run 9 / 10 / 12; 6 unanimous). Tagalog was 0.78%.
      Projected over 19,285 cards: ~180 findable at this recall; at the measured recall of
      ~.41 the true population is plausibly ~440.

      The defects are severe and several are provable against the corpus's own usage:
        cat -> iro          title says Toxoplasma comes from DOG droppings; EN and body say
                            CAT. A false health claim, and cat-specificity is the card's point.
        fever -> tugnaw     "why are we weak when COLD" instead of "with a fever"
        sweating -> pagpanghupaw   the brain triggers SIGHING to cool the body (the same batch
                            uses `mopawis` correctly, so the right word exists in the corpus)
        absorb -> mopasok   carrots PUT minerals INTO the soil — uptake direction reversed
        left -> miadto      sunlight WENT TO the sun eight minutes ago — direction reversed
        thunderstorm -> bagyo   a hot Manila afternoon signals an incoming TYPHOON
        beak -> sungkad     Darwin's finch BEAKS become fruit-knocking poles (corpus uses
                            `tuka` for the same Darwin fact elsewhere)
        whisper -> bulong   "a shout reaches farther than MEDICINE"
        cools -> moluoy     "when the magma TAKES PITY"
        roast -> gilanggaw  coffee beans VINEGARED, not roasted (corpus uses `gisanlag`)

      **blindness -> pagkabulag is explicitly a TAGALOG FALSE FRIEND**: in Cebuano `bulag`
      means to separate, blind is `buta`, and the corpus uses `makabuta` correctly elsewhere.
      That is the same cross-language interference class as `cud -> pag-usap` (Cebuano into
      Tagalog) and `Haiwan` (Malay) — now observed in the third direction, Tagalog into
      Cebuano. Three directions of bleed from one generator is a pipeline finding, not a card
      finding.

      13 reusable word-pair patterns captured for the C4 grep stage.
- [x] **C2-note** original stage text: Measured probe: 2,000 cards, gold spiked in, full card record, NO field truncation.
      Report the flag rate and the projected corpus total before spending on the rest.
- [~] **C3 CHUNK A DONE, REST HELD pending Luis.** 14,000 cards swept (single run, not 3 --
      per-run flags were 9/10/12 vs a union of 14, so one run buys ~70% of the findings for a
      third of the cost). **268 flags = 1.91%**, against the probe's 0.93%. Treat 0.93% as the
      corpus estimate until chunk B: the probe sampled randomly while this chunk took cards in
      id order, which clusters by card family.

      **URGENT, surfaced to Luis out of band:** three SHIPPED card titles contain `titi`, the
      vulgar Cebuano/Tagalog word for penis, rendering "tasting" and "toes" --
      ffct-00131 "Titi sa Tiil sa Alibangbang", ffct-00424 "Prints sa Titi ug Palad",
      ffct-02351 "Laing Prints Titi". Bodies are correct; the defect is title-only, and
      title_bis is what a child sees. Live in 0.4.19. NOT fixed unilaterally — awaiting his call.

      **193 of 268 findings (72%) are in `title_bis`, not the body.** So the earlier title
      hypothesis was right and my TEST of it was wrong: I measured whether titles lack Cebuano
      linkers (a style proxy, 19.2% vs Tagalog 18.7% — no signal) when the real skew is that
      titles carry the SEMANTIC errors. Wrong proxy, not wrong hypothesis.

      **Dominant pattern is another Tagalog false friend, and it is large.** `langgam` means
      BIRD in Cebuano and ANT in Tagalog. Corpus-wide, 47 cards use `langgam` on a card whose
      English says ANT, against 657 that correctly use it for BIRD. "Ants Per Person" is titled
      "Langgam sa Matag Tawo"; the pangolin eats millions of birds.

      Other confirmed swaps: tears(rips) -> luha (teardrops), cricket -> kagang (crab, 9 cards),
      wasp -> putyokan (honeybee), pufferfish -> baboy-dagat (dugong, which is a mammal and
      lays no eggs), wears-down -> maghait (sharpens — the opposite), sweat -> bahu (odour),
      monkey -> ungo (witch), feathers -> buhok (hair), light -> sugnod (firewood),
      balance -> bali (broken), toad -> bakulaw (gorilla — the SAME defect found in Tagalog).

      159 distinct word-pair patterns captured.

- [!] **C3 CHUNK B — BLOCKED BY SESSION LIMIT.** 70 of 100 batches completed (9,800 cards,
      164 flags = 1.67%, consistent with chunk A's 1.91%). Batches **170-199 did NOT run** —
      all 30 failed with "You've hit your session limit, resets 10:30pm Asia/Manila".
      Those 4,200 cards are UNSWEPT and must be re-run after the reset.

      Do not treat the sweep as complete. Remaining: batches 170-336 = 167 batches = ~23,400
      cards, roughly half the corpus.

      Chunk B's richest new seam is more Tagalog false friends, several severe:
        bulok   Tagalog 'rotten', but Cebuano COLOUR — ~35 cards; "Gatos Tuig Bulok"
        hilo    Cebuano POISON, used for 'thread' — "cotton is twisted to become poison"
        bihag   Cebuano CAPTIVE, used for 'rare' — "captive expensive metal"
        libog   Cebuano confusion (and crude in Tagalog), used for 'round'
        lumot   Cebuano MOSS, used for 'soft' — "Moss Rubber Bendable"
        bakal   Tagalog 'iron'; in Cebuano it is the verb TO BUY (iron is puthaw)
        mabuak  'break', used for 'spoil' and 'rot' — 132 corpus uses all mean breaking
        gamot   Cebuano ROOT, used for 'medicine' (4 more)
      Plus a reversal, ffct-15480 "Tanso Mamatay sa Mikrobyo" = copper DIES FROM germs, the
      opposite of "Copper Kills Germs"; and ffct-15401 carries a garbled non-word,
      "Asalinhagikan", where "Asa gikan" belongs. Judge returns a reusable
      `pattern` per flag. Stop early if pattern discovery saturates.
- [x] **C3 CHUNK C** 60/60 batches, 8,400 cards, **207 flags = 2.46%** (highest yet; A 1.91%,
      B 1.67%). Ran after the 22:30 session-limit reset and covered the stranded 170-199 range.

      **Biggest single finding of the audit: `vibrate -> lingkod` (to SIT).** 12 cards whose
      English says vibrate use the Cebuano word for sitting, and it runs straight through the
      SOUND curriculum: eardrum, cochlea, kulintang gongs, bamboo flute, guitar resonance,
      marimba, vocal cords, transverse waves. "The eardrum SITS like a drum skin"; "the air
      SITS inside the tube"; "your voice is made by SEATED vocal cords"; and for a transverse
      wave, "the particles SIT perpendicular" — the opposite of wave motion. In every case the
      verb IS the fact the card exists to teach, and no card restores it. Corpus uses lingkod
      correctly for sit/perch on 60 other cards, and the right words (mokurog, mag-vibrate,
      mauyog) appear correctly on sibling cards, so these 12 are outliers.

      More false friends confirmed at scale: `wool -> lana` (7 cards; lana is COCONUT OIL in
      Cebuano — "oil is a great insulator used in clothing and roofing"), `straw -> dayami`
      (6 cards; rice straw, so a child is told to put hay in a glass of water),
      `spring -> bukal` (3 cards; bukal is TO BOIL — "boiling scale" for a spring balance),
      `mix -> pagkat-on` (to LEARN), `scatter -> nagawagtang` (to DESTROY — the light destroys
      the dust rather than bouncing off it).

- [x] **C3 CHUNK D** 60/60 batches, 8,400 cards, **101 flags = 1.20%** (A 1.91%, B 1.67%,
      C 2.46%). Saved to `runs/2026-09-20-scope/sweep-chunk-d.json`. The drop is expected, not
      a miss: chunks A-C front-loaded the animal/plant/body cards where Tagalog false friends
      cluster; D is mostly astronomy, geology and weather, where the English science vocabulary
      is left in English and there is simply less to get wrong.

      **The title-outlier signature is now the audit's most reliable detector.** In nearly every
      D finding the card's OWN body carries the correct word and only `title_bis` is wrong —
      which is exactly the evidence that rules out regional variation. Worst of them:

        ffct-34517  "Tulo ka Bala Kepler"      = Kepler's Three BULLETS (law = balaod)
        ffct-34435  "Kalibutan 13.8 Bilyon"    = the EARTH is 13.8 billion years old, directly
                                                 contradicting ffct-34420/34434 ("Yuta 4.5 ka
                                                 bilyon"). Universe is uniberso.
        ffct-35825  "Halite nga Kubyeta"       = "Halite the TOILET" (cube)
        ffct-34887  "Walay Hangin sa Kahangturan" = "No Air in ETERNITY" (space = kawanangan)
        ffct-37035  "Pera Porma Matris"        = a MONEY-shaped uterus; the card's whole point
                                                 is the pear shape, and `pera` occurs exactly
                                                 once in 47,056 cards — this title.
        ffct-35543  "Paspas nga Bato sa Init"  = fast STONE/KIDNEY in heat (heart = kasingkasing)
        ffct-34274  "838 Metro si Burj Khalifa" — the number itself changes; EN and both bodies
                                                 say 828 m. 838 appears nowhere else.

      **Three defects are in the body, where nothing can restore them:**
        ffct-34742  erosion becomes "stop the soil from HOWLING" (uwang = a dog's bark; erosion
                    is pag-anod/pagdahili). Water, rain and washing are absent from the card.
        ffct-34935  "ang init nga lava dali ra nga NAGKALUOY" — the lava TOOK PITY instead of
                    cooling, and rapid cooling IS why basalt is fine-grained.
        ffct-36040  animal FECES becomes `ihi` (urine) as the parasitic-worm vector. Health card.
        ffct-35543  the body's only cooling mechanism is `pagpanghupaw` = SIGHING (sweat=singot).

      **Two direction/magnitude reversals** — the class that does not look like a word error:
        ffct-35461  lahar ash washes "PAINGON SA BUKID" (UP the mountain). The danger of a lahar
                    is precisely that it comes down onto lowland communities.
        dcard-05968 "tens of kilometers" becomes "napulo ka kilometro" = a flat TEN. Note this is
                    the inverse of the PASS rule: napulo ka beses IS "10 times", but napulo ka
                    for an open-ended "tens of" collapses the magnitude.

      New false friends confirmed, folded into chunk E's prompt: kalibutan (world, for UNIVERSE
      and for SPACE), kahangturan (eternity, for space), bala (bullet, for law), aso (smoke, for
      ash), tirok (gather, for spin), tapak (step on, for form), kunhod (decrease, for cool),
      uwang (howl, for erode), hubas (dry up, for weathering), baul (chest, for sweat), ihi
      (urine, for feces), pera (money, for pear), plato (dinner plate, for tectonic plate),
      balod (wave, for tides), lami (delicious, for bad taste), uyog (shake, for rub/pull),
      lumos (drown, for soft), buto (seed/explode, for bone — Cebuano bone is bukog), sungay
      (animal horn, for a vehicle horn = busina).

- [x] **C3 CHUNK E (final)** 47/47 batches, ~6,580 cards, **61 flags = 0.93%**.
      **THE SWEEP IS COMPLETE: all 337 batches, 47,056 cards, 801 flags = 1.70% of the corpus.**
      Per chunk: A 268 (1.91%), B 164 (1.67%), C 207 (2.46%), D 101 (1.20%), E 61 (0.93%).

      None of chunk E's flags are contaminated by the refuted table entries — its two
      `bounce->pabukal` flags are a DIFFERENT and valid claim (pabukal = to make boil, used for
      "bounce"), not the refuted bukal-for-spring one.

      Worst of chunk E:
        dcard-09616  "Sa Dili Pa Mout-og" for "Before the Shaking". `ut-og` appears in ZERO
                     Cebuano bodies and exactly one title — this one. The card's own body says
                     `molinog` and the very next card (dcard-09617) says `mouyog`. Flag for the
                     native reviewer with priority: the judge read it as an obscene word. I could
                     not confirm that from the corpus (no standalone `utog` anywhere), so treat
                     the obscenity as UNVERIFIED but the garbled title as certain.
        dcard-08653  Animal Movements lists "molakaw, molukso, MOTIPDAS, molupad" — `tipdas` is
                     MEASLES (6 corpus bodies, all the disease). The "jump" slot is a disease.
        dcard-09344  "Mga Pako sa Tambubuyog" — dragonfly rendered as BUMBLEBEE, in the title,
                     the body AND the emphasis span. Corpus uses `alindahaw` on 25 cards and
                     `tambubuyog` on this one. The Cebuano now asserts that bees hunt, catch and
                     eat other flying insects, which is false.
        dcard-08294  Venn diagram's "overlapping circles" becomes `magkatapad` = side by side.
                     The overlap IS the mechanism; a child following the Cebuano has nowhere to
                     write what the two things share.
        dcard-09590  "steep angle" becomes `titipid` (Tagalog: to economise) — and it is the
                     emphasis span. Reads as a REDUCED angle, the opposite, contradicting the
                     paired card dcard-09592.
        dcard-07990/07995/09661  carbon and nitrogen FIXATION rendered as `pag-ayo` = to repair.

- [x] **C4 DONE — and it refuted five of my own false friends.**

      **KILLED — singleton title words.** 1,095 title words appearing in no Cebuano body and no
      other title. Recall against the sweep's 740 known flags was **50 (6.8%)**, and the list is
      ordinary title-only Cebuano (Pag-ambus, Resipyente, Pepino, Migrante). Rarity is meaningless
      on an OPEN class — the Tagalog lesson, relearned. Kept as a negative result in
      `runs/2026-09-20-scope/title-singletons.json`; spend no triage on it.

      **KEPT — the title-outlier detector** (`title_outlier.py`). Chunk D's signature made
      deterministic: fire only when (1) title_bis has the suspect word, (2) the EN card really is
      about the concept it mistranslates, (3) the Cebuano body or terms carries the CORRECT word,
      and (4) the suspect word is ABSENT from the body. Conditions 3+4 rule out regional variation
      and are why a bare grep fails here.

      Triaged all candidates with the **76 sweep-flagged cards left in unlabelled as spiked
      controls**. Triage recovered **66 of 76 controls (86.8%)**, so it is not too conservative
      and the run is valid.

      **THE CONTROLS EARNED THEIR KEEP — they exposed five bad entries in my own false-friend
      table**, each of which had been seeding the sweep prompt since chunk B:

        bakal   REFUTED. All **39** Cebuano bodies containing it mean iron/steel ("Ang bakal usa
                sa labing daghang metal sa panit sa Yuta"); **zero** mean "to buy". A naturalised
                loan beside native puthaw, not a false friend.
        lana    REFUTED. Spanish *lana* = WOOL is ordinary Cebuano, and the corpus glosses it
                itself — ffct-04698: "balhibo nga gitawag og **lana o wool**". Chunk C's claim
                that 7 wool cards said "coconut oil" was wrong.
        bulok   REFUTED. The ROTTEN sense is attested in Cebuano bodies ("bulok nga itlog",
                "bulok nga pagkaon", "Bulok ba ang durian"); the COLOUR sense takes the suffixed
                **bulokon** ("bulokon nga langgam"). Bare bulok for rotten is fine.
        bukal   HALF wrong. A hot SPRING is `bukal` in 3 Cebuano bodies ("init nga bukal sa
                Pansol, Laguna"). Only a mechanical/coil spring is a defect.
        dayami  HALF wrong. Rice straw is genuinely `dayami`. Only a DRINKING straw is a defect.

      **42 of the 740 sweep flags (5.7%) invoke one of these words and are QUARANTINED**
      (`quarantine-refuted.json`) — not deleted, but they may not be rewritten without re-triage.

      With the refuted pairs removed the detector gives **111 candidates at 93.7% precision
      (104 CONFIRMED), 39 of them defects the blind LLM sweep missed.** Confirmed ids in
      `c4-confirmed.json`; full verdicts in `title-outlier-triage.json`.

      **Process change, permanent:** a false friend must be checked against the corpus's OWN
      Cebuano bodies before it enters a prompt. The word list now lives in `title_outlier.py`
      with the refutations recorded beside it, not in a workflow prompt where it cannot be
      reviewed. Chunk E is in flight with the uncorrected list, so its bakal/lana/bulok/bukal/
      dayami flags must be filtered on the same rule before use.

- [x] **C4b — truncated titles, a class the sweep almost entirely missed.** Free enumeration,
      no model: a title whose last word is (a) a bare particle, or (b) a strict prefix of a
      longer word the card itself contains, and is a real word nowhere in 47,056 cards.

      **37 hits, ~78% clean on inspection**, and the sweep found only 2 of them. These are the
      cheapest repairs in the audit because the full word is already on the card:
        "Mata sa Mantis Shrim"  "Kabhang sa Sea Urchi"  "Pagligid nga Frictio"
        "Panganod Cumulonimbu"  "Pagbag-o sa Ecosyste"  "Balaod sa Segregatio"
        "Habagatang Hemispher"  "Krus nga Heterozygou"  "Pareho og Temperatur"
        "Pinakamaayo nga Materyales para sa Proteksyon sa"  (head noun dropped entirely)
      Arguable and left for review: "Mga Bato nga Igneo" (x7, Spanish igneo may be intended),
      "Mga Biomolecule", "Non-Magnet", "Kangkon". Saved to `truncated-titles.json`.

      This is a GENERATION/DISPLAY bug, not a translation one, and it is worth telling the
      pipeline owner about separately.

- [x] **C4c — ROOT CAUSE FOUND: a 20-character title truncation bug, in all three languages.**

      C4b's truncated titles were not a Cebuano problem at all. A length control proves it:

      | title length | mid-word truncations |
      |---:|---:|
      | 18 | 2 |
      | 19 | 6 |
      | **20** | **128** |
      | 21 | 2 |
      | 22 | 4 |

      and the raw histogram over all 147,468 titles has a matching cliff — 12,679 at 18 chars,
      12,657 at 19, 12,053 at 20, then **6,808 at 21**. Smooth everywhere else.

      It hits **English 31, Tagalog 48, Cebuano 49** — roughly evenly, which is why the Cebuano
      LLM sweep missed nearly all of it: a cut title reads as terse, not as wrong. English cards
      are shipping as "Energy Without Oxyge", "Glowing Eyes at Nigh", "Geckos Eat Mosquitoe".

      **Source located** — `rag/pipeline/fw-gen-card-titles.py:197` and the identical block in
      `fw-gen-new-titles.py` and `fw-gen-topup-titles.py`:

          if len(t_en) > TITLE_MAX:
              long_ += 1                                      # counted, never acted on
          rows.append({'id': card['id'], 'title_en': t_en[:TITLE_MAX].strip(),
                       'title_tl': (...).strip()[:TITLE_MAX].strip(),
                       'title_bis': (...).strip()[:TITLE_MAX].strip(), ...})

      Two defects in four lines: an over-length title is **counted and then shipped anyway**,
      and the trim is a **raw character slice** with no word-boundary handling. Only `title_en`
      is even measured; tl and bis are sliced without ever being checked.

      **FIXED** in all three generators via a shared `_fit()` that trims whole words only and,
      when no two-word prefix fits, returns the title UNCHANGED to overflow — the index band
      clips an overflowing title at render time, which is recoverable, whereas a severed word is
      baked into the data permanently. This prevents recurrence; it does not repair the pool.

      128 is a FLOOR. It counts only cuts that leave a non-word; a cut landing on a word
      boundary ("Waling-Waling Orchid" for "...Orchids") is indistinguishable from an
      intentionally compact title. The 20-vs-21 cliff implies the true number is in the
      thousands. Detector: `truncation_20char.py`; list: `truncation-20char.json`.

      **This outranks the Cebuano language defects and needs Luis's decision** — it is an
      English-facing data defect in a shipped build, and repairing the pool is a separate job
      from the generator fix landed here.

- [~] **C5a APPLIED — 125 Cebuano titles repaired.** The title tranche of C5: the 104
      C4-confirmed title outliers plus the 37 truncations, 141 cards.

      Pipeline: propose -> adversarial verify (a second agent told to REFUTE, shown the card
      but NOT the proposer's reasoning or the `defect`/`evidence` fields) -> three mechanical
      gates in `apply_title_fixes.py` that recompute everything rather than trusting prose.

      | stage | result |
      |---|---:|
      | proposed | 141 REWRITE, **0 HOLD** |
      | adversarial verify | 128 ACCEPT, **13 REJECT** |
      | GATE 2 sourcing (mine) | 3 further HELD |
      | **applied** | **125** |

      **The proposer's 0 HOLDs is a warning, not a success** — it never declined once, which
      means it was not applying the sourcing constraint as strictly as instructed. That is
      exactly why the constraint is ALSO enforced mechanically. GATE 2 caught three cards where
      the new title used a real Cebuano word (`tuyok`, `paghimo`) that appears nowhere on that
      card. Correct Cebuano or not, unattested is unattested; those three go to the reviewer.

      **The adversarial check earned its place and corrected two of MY findings:**
        - `Igneo` (6 cards) is legitimate Spanish-derived Cebuano, not a truncation of
          "Igneous" — the card's own title_tl uses the same form. My C4b detector was wrong.
        - `plato` for a tectonic plate (2 cards) is used in title_tl too, so it is deliberate
          terminology, not the false friend I recorded. The `plate` pair is now doubtful.
        - It also caught the proposer making a card WORSE: `Kolor Balas Gikan` ->
          `...Ginikanan`, where ginikanan is PARENTS (24 of 24 corpus titles) and the origin
          word is gigikanan (41 of 41).

      Verified independently after writing: 125 cards changed, **0 cards where any field other
      than title.bis changed**, orphaned emphasis spans **0 before and 0 after**, pool diff is
      **1 line / +194 bytes**. Repairs in `c5a-applied.json`.

      Examples: `Tulo ka Bala Kepler` -> `Tulo ka Balaod ni Kepler`; `Buto sa Hita` ->
      `Bukog sa Hita`; `Cheek Pouch sa Ungo` -> `Cheek Pouch sa Unggoy`; `Kolonya sa Langgam`
      -> `Kolonya sa Hulmigas`; `Mata sa Mantis Shrim` -> `Mata sa Mantis Shrimp`.

- [x] **C5b-0 QUARANTINE CLEARED — 26 of 42 flags were bogus, 16 real defects survive.**
      The 42 flags contaminated by the five refuted false friends, re-triaged against the corpus
      with the new `ceb_usage.py`. Every verdict quotes corpus evidence rather than an ear.

      **26 REFUTED** — the card is fine and the flag existed only because of a bad word-list
      entry. Confirms the refutations hold at card level, not just in aggregate.
      **16 SURVIVE** with a real, separate defect provable from the card's own English:
        ffct-21835  the NEGATION is dropped — "Aslom kaayo ang suka aron MABUHI ang bakterya"
                    says vinegar is sour SO THAT bacteria CAN live. English: "too acidic for
                    most spoilage bacteria to survive." The card's own terms still say "dili
                    mabuhi".
        ffct-20134  "motunaw ang mantika sa tubig" = the oil DISSOLVES in water. English says
                    it FLOATS, which is the entire reason water must not be used on a grease
                    fire.
        ffct-32897  "Sayon mosinaw ang isobutane" — sinaw is SHINY (58 bodies). English: "the
                    isobutane boils easily", the mechanism a binary geothermal cycle runs on.
        dcard-07327 opaque materials "gipabukal ang uban" = made some of the light BOIL, for
                    "reflect some of it". Reflection is never taught.
        ffct-25013/25211/25319 the drinking-straw half of `dayami`, which does stand.

      **I overturned one of the re-triage's own verdicts.** Two agents contradicted each other
      on `pako`: one said it is never a nail (359 wing/fern bodies), the other that 16 bodies
      pair it with English "nail". I checked: **16 nail-cards, 314 wing/fern-cards**. So
      `pako` for an iron nail IS attested, a minority usage beside lansang (44 bodies).
      ffct-19808 demoted to REFUTED and queued for the native reviewer, not rewritten.

- [x] **C4d — the strongest detector in the audit, and it needs no Cebuano judgement at all.**
      `title_unattested.py`. A word that heads >=3 Cebuano TITLES, appears in **ZERO** of 47,056
      Cebuano BODIES, and in no English, Tagalog or terms field either. Purely structural: the
      thing that wrote the titles was not drawing on the vocabulary that wrote the bodies.

      **The case that revealed it: `kulob`.** 27 Cebuano titles, **25 of them boiling-point
      cards** — "100 Degrees Kulob Tubig", "373 Kelvin Kulob", "Asin Kulob Taas", "78 Ethanol
      Kulob" — and zero Cebuano bodies, while the bodies of those same cards correctly say
      mobukal/nagbukal. The two non-boiling uses give the real meaning away: "Kulob nga Tudlo
      sa Tubig" = why fingers WRINKLE in water. **The entire boiling curriculum is headed by a
      word meaning wrinkled.** Same shape as chunk C's `lingkod`-for-vibrate finding, found
      structurally this time instead of by reading.

      **138 words touching 720 cards.** NOT all defects — spelling variants (daku/dako,
      itum/itom) and Spanish loans (azul) land here because the bodies prefer the other form.
      It is a candidate list and needs triage like every other enumeration. Clear ones already
      visible: `balhas` 15 titles (Tagalog for sweat; Cebuano singot), `pagtatanom` 9 (Tagalog),
      `kasingkasin` 6 (truncated kasingkasing), `energiya` 6 (variant of enerhiya).
      Saved to `title-unattested.json`. **TRIAGE IS THE NEXT STAGE'S FIRST JOB.**

- [~] **C5b PARTIAL — 102 body repairs applied, 199 proposals still OWED.**
      693 cards through propose -> adversarial verify -> the four gates.

      | stage | result |
      |---|---:|
      | proposed | 314 REWRITE, **379 HOLD (55%)** |
      | adversarial verify | 107 ACCEPT, 8 REJECT — **and 199 never judged** |
      | GATE 2 attestation (mine) | 5 further held |
      | **applied** | **102** |

      **STAGE PARTIALLY FAILED: 36 of 58 verify agents died on the session limit** (resets
      3:30am Asia/Manila) — the same failure that truncated sweep chunk B. Their 199 proposals
      are UNVERIFIED, not rejected, and are held under their own label in `c5b-applied.json` so
      the distinction cannot be lost. **They must be re-verified after the reset, not applied.**
      First failure of this stage; per the standing rule, one more and it gets abandoned.

      **The 55% HOLD rate is the good news.** C5a's proposer held nothing at all, which was a
      warning. Here, given `ceb_usage.py` and an instruction to check rather than assume, it
      declined more than half — typically "finding refuted, the corpus attests the old word".

      **My false-friend table was corrected for a third time, by the adversarial check:**
        kagang    IS the corpus word for CRICKET — 9 bodies, all crickets/cicadas, crab is
                  always alimango. My table had it backwards.
        mopalta   IS attested for light bouncing off a surface.
        gasolina  IS the corpus's standard rendering of generic English "fuel" (112 bodies).
        sanga     IS attested for "stem" in 19 bodies.
      Every one of these would have rewritten correct Cebuano. Three rounds of refutation now:
      C4 (bakal/lana/bulok/bukal/dayami), C5b-0 (pako), and these four.

      Applied repairs are minimal — **median churn 4.3%** — and each defect is provable from
      the card's own English:
        dcard-08653 the "jump" slot in Animal Movements was `motipdas`, built on the word for
                    MEASLES
        dcard-05173 haemophilia defined as blood that "changes" rather than fails to CLOT
        dcard-05746 an asteroid that is SATED by the atmosphere instead of HITTING it
        dcard-04065 plant defences that smell bad and taste DELICIOUS
        dcard-08837 an SEM that BOILS the electron beam instead of bouncing it
        dcard-00614 the skeleton's "enables movement" rendered as BREEDING

      Verified after writing: 102 cards changed, **0** non-`fact.bis` changes, orphaned
      emphasis spans **0 before and 0 after**, pool diff 1 line.

- [x] **C5b-2 DONE — the 199 owed proposals are verified; 168 more applied.** Run at 04:00
      Manila, after the reset, in 25 batches of 8 instead of 58 of 12 so a limit would truncate
      less. All 25 completed, 0 agent errors. **199 judged: 183 ACCEPT, 16 REJECT.**

      C5b verification coverage is now **314/314 — no proposal is unverified.** Totals across
      both passes: 290 ACCEPT, 24 REJECT, 20 held by the attestation gate, 379 proposer holds.

      **C5b IS NOW COMPLETE: 270 body repairs applied** (102 + 168), median churn 4.2%.
      Verified after writing: 168 cards changed this pass, 0 non-`fact.bis` changes, orphaned
      emphasis spans 0 before and 0 after.

      The re-verify was sharper than the first pass because it was told where the first one had
      erred — "check the word that was REPLACED, not just the one introduced". It rejected 16,
      including two the gates would not have caught:
        ffct-13754  new_fact_bis was **byte-identical** to the old. A non-edit dressed as a
                    repair; the defect is still there.
        ffct-13786  `bombilya` is the corpus's own word for a PLANT bulb (143 bodies, incl.
                    "Ang bombilya, sama sa ahos o sibuyas"). Swapping it for English "bulb"
                    was preference, not repair.
        ffct-12166  the edit invented a mechanism clause the English never states.

      Worth recording, because it is the single largest confirmed class in the whole audit:
      **`langgam` = BIRD in 680 Cebuano bodies, uniformly**, and it was used for ANT on card
      after card — "worker birds", "how do birds share food", "adult birds cannot spin silk".
      The corpus word is `hulmigas` (115 bodies). Also `halas` (snake) for lizard, `bakaw`
      (mangrove) for egret, `tahong` (mussel) for giant clam, `binilyon` where the English says
      trillions, and `kagang` (cricket) on a CICADA card, where the right word is `kuliglig`.



- [!] **C5c BLOCKED — weekly limit.** 7 of 14 triage batches finished (70 of 138 words:
      34 DEFECT, 14 VARIANT, 22 FINE). **Every verify agent died**, so **0 DEFECT claims are
      verified and NOTHING was applied.** The remaining 7 triage batches never ran.

      This is the **weekly** limit ("resets 4am Asia/Manila"), not the nightly session limit
      that truncated chunk B and C5b. All agent work is blocked until it clears; the error text
      does not say which day, so I cannot give a reliable ETA beyond "4am Manila".

      First failure of this stage. Under the standing rule one more failure and it is abandoned,
      but the failure was a quota wall, not a defect in the approach — the 7 batches that did
      run produced the best-evidenced triage in the audit, citing Wolff's Cebuano dictionary and
      binisaya.com alongside corpus counts. Resume by re-running the workflow: completed agents
      replay from cache, so only the 7 missing triage batches and the verify phase will run.

      Strongest unverified claims, for context only — do NOT apply without verification:
        bantol -> dikya    25 titles, all jellyfish cards; bantol is a STONEFISH (Wolff)
        landok -> puthaw   12 titles; landok is ILOCANO for iron, absent from Cebuano dictionaries
        kangi  -> kurog    10 titles meaning shiver/vibrate; kangi is not a word in any source

- [x] **C6 DONE** — `REPORT.md` written while the weekly limit blocked all agent work.
      Original text: REPORT.md: what changed, what is queued for a Cebuano speaker, and an explicit
      ship-or-not recommendation. Do not ship.

## Final tally (sweep + deterministic detectors)

| source | cards |
|---|---:|
| LLM sweep, all 337 batches | 800 unique |
| less quarantined (refuted false friends) | -42 |
| **sweep, net** | **758** |
| C4 title-outlier detector, CONFIRMED | 104 (39 the sweep missed) |
| C4b truncated titles | 37 (35 the sweep missed) |
| **REPAIRABLE POOL** | **834 unique cards** |

Written to `repair-pool.json`. 1.77% of the 47,056-card Cebuano corpus.


## Carried lessons (do not relearn these)

- Supply the WHOLE card record. F1 scored recall .33 partly because the batches omitted
  title/terms/bis, making 5 of 15 gold items unjudgeable by construction.
- Do not truncate fields. Capping `ans` at 200 chars produced 3 false flags.
- Return flags only from a workflow, never every row — 5,030 rows blew the 4,096 array cap.
- Batch size is a tracked variable, not an incidental choice. It silently moved a score .948
  vs .983 once already.
- A verifier that accepts 100% is not verifying. Check mechanically as well.
- Deterministic enumeration wins on CLOSED classes, loses on OPEN ones. `gawa ng` was 23/23 by
  grep and 0/2 by model; nonword detection was the reverse.

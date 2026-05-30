# Bisaya Dataset — Playwright Sourcing Brief

**Goal:** Extract authentic Bisaya/Cebuano language text from publicly accessible educational
websites. This content will be used to create science dialogue training data for a fine-tuned
Filipino AI tutor.

**What we need:** Natural, conversational Bisaya text — stories, lesson explanations, teacher
dialogues, vocabulary in context, or any educational prose aimed at grades 3–6.

**What to avoid:** English-only content, Tagalog content, Hiligaynon/Waray (different
languages), administrative/bureaucratic documents, and anything behind a DepEd login wall.

---

## Output Format

For each source, save a `.txt` file to:
```
/Users/luis/Code/hiraia/finetuning/datasets/bisaya/sources/
```

Filename convention: `<site-slug>-<description>.txt`
Example: `huni-huni-ang-liyon-story.txt`

Each file should contain:
```
# [Title of the page/story/lesson]
Source: [full URL]
Retrieved: [date]
Language: Bisaya/Cebuano
Grade level: [if known]

[Full extracted text — as much as possible, verbatim]

## Notes
[Any observations about the content, vocabulary patterns, potential science topics]
```

---

## Priority 1 — huni-huni.com (Bisaya Children's Stories)

These are original Bisaya stories with clear educational goals. One story was already
successfully fetched (`si-liling-story.txt`). We need the rest.

**Story pages to fetch:**

| URL | Story Title | Science connection |
|-----|-------------|-------------------|
| https://huni-huni.com/ang-liyon-ug-ang-ilaga/ | Ang Liyon ug ang Ilaga | animal behavior, ecosystems |
| https://huni-huni.com/ang-hangin-ug-ang-adlaw/ | Ang Hangin ug ang Adlaw | weather, wind, solar energy |
| https://huni-huni.com/ang-buotang-bao/ | Ang Buotang Bao | animal adaptations, turtle biology |
| https://huni-huni.com/ang-damgo-ni-aldong/ | Ang Damgo ni Aldong | marine life, island ecosystems |
| https://huni-huni.com/ang-malipayong-adlaw-ug-ang-duha-ka-masusihong-panganod/ | Ang Malipayong Adlaw | clouds, weather, water cycle |
| https://huni-huni.com/ang-iring-ang-sunoy-ug-ang-balagtok/ | Ang Iring, ang Sunoy, ug ang Balagtok | animal classification |
| https://huni-huni.com/ang-batang-kawatan-ug-ang-iyang-inahan/ | Ang Batang Kawatan | moral/character, consequence |
| https://huni-huni.com/ang-dalagang-manggagatas-ug-ang-iyang-balde/ | Ang Dalagang Manggagatas | critical thinking, planning |
| https://huni-huni.com/bisaya-short-story-ang-baki-nga-dili-kabalo-mokokak/ | Ang Baki Nga Dili Kabalo Mokokak | frog biology, adaptations |

**Also fetch the song pages** (these have Bisaya vocabulary in natural context):

| URL | Title | Educational use |
|-----|-------|-----------------|
| https://huni-huni.com/magngalan-ta/ | Magngalan Ta | animal names in Bisaya |
| https://huni-huni.com/ulo-abaga/ | Ulo, Abaga | body parts in Bisaya |
| https://huni-huni.com/si-pilemon/ | Si Pilemon | fishing/marine vocabulary |
| https://huni-huni.com/tong-tong-tong-pakitong-kitong/ | Pakitong-kitong | river/crab vocabulary |

**Notes on this site:**
- Stories are usually 300–600 words of clean Bisaya prose
- No login required, but JS-rendered — Playwright needed for full text
- Author: Ruth Romarate-Garcia
- Licensed CC BY-NC-SA 3.0 Philippines

---

## Priority 2 — Scribd DepEd Grade 3 Science Modules (Bisaya)

These are official DepEd learning modules written in Sinugbuanong Binisaya. The page
at `scribd.com/document/833855302` was partially readable in our previous searches and
contained actual Bisaya instructional text for liquids and gases.

Scribd requires scrolling to reveal full content. Use Playwright to scroll the full document,
then extract all visible text.

| URL | Module | Content |
|-----|--------|---------|
| https://www.scribd.com/document/833855302/science3-q1-Mod2-mgakinaiyasaliquidsuggas-v5 | Q1 Mod 2 | Mga Kinaiya sa Liquids ug Gases — teacher explanations, activities, vocabulary |

**What to extract:**
- All paragraph text visible in the document viewer
- Activity instructions (Buluhaton/Gawain sections)
- Lesson summaries (Tandaan/Alamin sections)
- Any question-and-answer sections

**Expected Bisaya patterns to look for:**
- `Karon atong pagatun-an...` (Now we will learn...)
- `Pagkahuman niini...` (After this...)
- `Mahulagway ang...` (Describe the...)
- `Buhata Kini` (Do This — activity header)
- `Pagsusi` (Check/Assess)

---

## Priority 3 — hunterswoodsph.com (MTB Bisaya Worksheets)

This site has structured Bisaya grammar and vocabulary content for grades K–3. Unlike
Scribd, it renders fully in HTML. Still JS-heavy — use Playwright.

| URL | Content | Use |
|-----|---------|-----|
| https://hunterswoodsph.com/mtb-sinugboanong-binisaya-mga-punglihok-berbo-worksheets/ | Verbs (Punglihok) | action word vocabulary, sentence patterns |
| https://hunterswoodsph.com/numbers-in-bisaya/ | Numbers (Pag-ihap) | number vocabulary, math language |
| https://hunterswoodsph.com/days-of-the-week-in-bisaya/ | Days/Months | calendar/time vocabulary |
| https://hunterswoodsph.com/bisaya-colors/ | Colors (Kolor) | descriptive vocabulary |
| https://hunterswoodsph.com/bisaya-body-parts/ | Body Parts (Bahin sa Lawas) | science vocabulary — human body |
| https://hunterswoodsph.com/bisaya-animals/ | Animals (Mga Mananap) | science vocabulary — living things |
| https://hunterswoodsph.com/bisaya-plants/ | Plants (Mga Tanom) | science vocabulary — living things |
| https://hunterswoodsph.com/bisaya-weather/ | Weather (Panahon) | science vocabulary — weather |

**What to extract:**
- Bisaya word lists with English translations
- Example sentences (these are the most valuable — they show natural usage)
- Any worksheet instructions written in Bisaya prose

---

## Priority 4 — Global Digital Library (Cebuano Storybooks)

Free, openly licensed Cebuano picture books produced under USAID Basa Pilipinas /
DepEd partnership. Full text is available on the web without login.

**Start page:** https://digitallibrary.io/ceb

Look for books tagged `Cebuano` or `Sinugbuanong Binisaya`. Navigate to level 1–3 books
(these are most appropriate for our target grade level). Fetch each book's text.

**Known books to fetch:**

| URL | Title | Level |
|-----|-------|-------|
| https://content.digitallibrary.io/ceb-fil/book/kaya-na-ba-nako/ | Kaya na ba nako? | 1 |

**After fetching the start page,** also find and fetch any other Cebuano books listed there
(there should be 20–50+ books). The catalog page itself is valuable — extract all book titles,
URLs, and level tags.

**Science-relevant topics to prioritize:**
- Animals, plants, nature, weather, body, food, water, farming

---

## Priority 5 — Cebuano Wikipedia (Science Articles)

The Cebuano Wikipedia (ceb.wikipedia.org) has millions of articles, though many are
bot-generated. The good ones — especially topic overviews — contain natural Bisaya prose
written in an encyclopedic style that's still useful for vocabulary and phrasing.

Fetch these article pages and extract the full article body text:

| URL | Topic | Grade relevance |
|-----|-------|-----------------|
| https://ceb.wikipedia.org/wiki/Photosynthesis | Photosynthesis | Grade 5–6 |
| https://ceb.wikipedia.org/wiki/Hayop | Animals | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Tanom | Plants | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Tubig | Water | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Adlaw_(bituon) | Sun | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Bulan | Moon | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Bagyo | Typhoon | Grade 4–5 |
| https://ceb.wikipedia.org/wiki/Ulan | Rain | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Isda | Fish | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Bulkan | Volcano | Grade 4–5 |
| https://ceb.wikipedia.org/wiki/Hangin | Wind | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Yuta | Soil/Earth | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Kahoy | Tree | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Insekto | Insects | Grade 3–4 |
| https://ceb.wikipedia.org/wiki/Kalikupan | Environment | Grade 5–6 |

**Note:** Cebuano Wikipedia articles vary hugely in quality. Many are 1–2 sentence stubs
(skip those). Look for articles with 3+ paragraphs of actual prose. Extract the lead section
and first few body sections. Skip infoboxes, reference lists, and navigation.

---

## Priority 6 — PDFCoffee.com DepEd Bisaya Science Modules

PDFCoffee hosts uploaded copies of DepEd modules. Text extraction through Playwright
requires scrolling the embedded PDF viewer. These are lower priority because the text
quality is unpredictable.

| URL | Module | Expected content |
|-----|--------|-----------------|
| https://pdfcoffee.com/science-3-q2-mod5-pdf-free.html | Q2 Mod 5 | Plants — parts, needs, growth |
| https://pdfcoffee.com/science-3-q2-mod6-pdf-free.html | Q2 Mod 6 | Animals — basic needs, classification |
| https://pdfcoffee.com/mtb-mle-elements-tg-sinugbuanong-binisaya-pdf-free.html | MTB-MLE Teacher's Guide | Full Bisaya lesson guide text |

---

## Priority 7 — Reddit

Search Reddit for natural Bisaya-language posts. These won't be educational in the formal
sense, but they'll capture authentic conversational Bisaya that's valuable for tone/register.

**Queries to search on reddit.com/search:**

1. `Bisaya science` (subreddits: r/Philippines, r/Cebu, r/bisaya)
2. `Cebuano kids` (parenting/education discussions in Bisaya)
3. `subreddits to look for:` r/bisaya, r/Philippines, r/Cebu, r/OFW

**What to extract from Reddit:**
- Posts or comments written substantially in Bisaya (not just a word or two)
- Threads where parents/teachers discuss science topics with kids
- Any how-to explanations in Bisaya

**URL format for subreddit search:**
```
https://www.reddit.com/r/bisaya/
https://www.reddit.com/r/Philippines/search/?q=bisaya+science&restrict_sr=1
```

---

## Extraction Quality Checklist

For each page fetched, assess and note in the file:

- [ ] **Language confirmed Bisaya/Cebuano** (not Tagalog or Hiligaynon)
- [ ] **Minimum 200 words** of Bisaya text extracted
- [ ] **Grade-school appropriate** (vocabulary and concepts for ages 8–12)
- [ ] **Science-adjacent** (nature, body, weather, materials, living things)
- [ ] **Natural prose** (not just word lists or fill-in-the-blank)

If a page fails 3 or more of these, note it but skip extraction.

---

## Already Collected (Do Not Re-fetch)

These are already in `/Users/luis/Code/hiraia/finetuning/datasets/bisaya/sources/`:

- `si-liling-story.txt` — huni-huni.com, story about a picky cat
- `Science3_Q1_Mod1_Classifying_Objects.txt` — English (reference only)
- `Science3_Q1_Mod2_Changes_Materials.txt` — English (reference only)
- `cebuano-for-beginners.txt` — vocabulary reference

---

## Volume Target

We need enough raw source material to generate approximately **300 more Bisaya
dialogues** (current dataset: 305, target: ~600+). Each source page typically yields
material for 5–20 dialogues. Fetching all Priority 1–3 sources should be sufficient.
Priority 4–7 are bonuses.

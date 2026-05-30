# Bisaya/Cebuano Educational Resources - Research Findings

**Research Date:** May 30, 2026
**Purpose:** Finding kid-friendly Bisaya language content for educational dataset

## Summary

The Bisaya dataset currently has **152 dialogues** in `science-chat.jsonl`, covering Grade 3-10 science topics. The existing content already demonstrates good quality with proper Bisaya grammar, Socratic method, and cultural context.

## Current Dataset Status

- **Total dialogues:** 152
- **Grade levels covered:** 3-10
- **Topics:** Matter, Living Things, Earth/Space, Physics, Chemistry, Health, Biology
- **Format:** JSONL with system/user/assistant message structure
- **Language:** Natural conversational Bisaya with Socratic teaching method

## Sources Found

### 1. Huni-huni.com - Bisaya Teaching Materials ⭐⭐⭐⭐⭐

**URL:** https://huni-huni.com/

**Content Types:**
- Animated Bisaya songs and stories (videos)
- Original and translated children's stories in Bisaya
- Flashcards and worksheets
- MTB-MLE (Mother Tongue-Based Multilingual Education) materials

**Specific Resources:**
- **Stories:** Aesop's fables translated to Bisaya (The Lion and the Mouse, The Wind and the Sun)
- **Songs:** Traditional nursery rhymes in Bisaya ("Ako si Takuri" = I'm a Little Teapot)
- **MTB-MLE Materials:** Official DepEd Kindergarten, Grade 1, and Grade 2 learner materials
- **Vocabulary:** Animals (langgam/bird, isda/fish), food (pagkaon), body parts

**Quality Assessment:**
- ✅ High-quality, authentic Bisaya content
- ✅ Age-appropriate for elementary students
- ✅ Aligned with DepEd curriculum
- ✅ Creative Commons licensed (CC BY-NC-SA 3.0 Philippines)
- ✅ Active and regularly updated

**Usage Potential:**
- Stories can be adapted into dialogue format
- Vocabulary lists for science terminology
- Cultural context and local examples

### 2. DepEd MTB-MLE Sinugbuanong Binisaya Materials ⭐⭐⭐⭐⭐

**URL:** https://huni-huni.com/mtb-mle-sinugbuanong-binisaya-learners-materials/

**Content:**
- Official Department of Education learner materials
- Kindergarten through Grade 2
- Quarterly modules (Q1-Q4)

**Quality Assessment:**
- ✅ Official government educational materials
- ✅ Curriculum-aligned
- ✅ Age-appropriate language
- ✅ Covers foundational concepts

**Usage Potential:**
- Reference for grade-appropriate vocabulary
- Structure for lesson progression
- Examples of how concepts are explained in Bisaya

### 3. DepEd Science Grade 3 Module - "Mga Kinaiya sa Liquids ug Gases" ⭐⭐⭐⭐⭐

**URL:** https://www.scribd.com/document/833855302/science3-q1-Mod2-mgakinaiyasaliquidsuggas-v5

**Content:**
- Complete Grade 3 Science module on properties of liquids and gases
- Written entirely in Sinugbuanong Binisaya
- Published 2020 by Division of Malaybalay City

**Learning Objectives:**
1. Describe weight and volume of liquids
2. Describe how liquids flow
3. Identify gases found at home and school
4. Describe gases through their container shape

**Sample Vocabulary:**
- "kabug-aton" (weight)
- "kadaghanon" (volume)
- "pag-agas" (flow)
- "sudlanan" (container)

**Quality Assessment:**
- ✅ Perfect match for our needs - science in Bisaya
- ✅ Grade 3 level (matches our target)
- ✅ Modern curriculum (K-12)
- ✅ Practical examples from home and school

**Usage Potential:**
- Direct source for dialogue topics
- Vocabulary reference for science terms
- Examples of how to explain properties in Bisaya

### 4. Hunter's Woods PH - Bisaya Worksheets ⭐⭐⭐⭐

**URL:** https://hunterswoodsph.com/

**Content:**
- Grammar worksheets for Sinugboanong Binisaya
- Parts of speech: punglihok (verbs), pungway (adjectives), pungwayon (adverbs)
- Vocabulary: numbers, colors, shapes, days/months
- Grade 1-3 progressive difficulty

**Sample Content:**
- "Punglihok = action word" (from pung + lihok)
- "Pungway = describing word" (pulong panghulagway)
- Sentence structure examples

**Quality Assessment:**
- ✅ Systematic grammar instruction
- ✅ Grade-appropriate progression
- ✅ Free worksheets available
- ⚠️ More focused on language than science content

**Usage Potential:**
- Reference for proper Bisaya grammar in dialogues
- Vocabulary building
- Understanding sentence structure patterns

### 5. Cebuano for Beginners (Bunye & Yap, 1971) ⭐⭐⭐⭐

**Already in dataset:** `sources/cebuano-for-beginners.txt`

**Quality Assessment:**
- ✅ Comprehensive grammar reference
- ✅ Vocabulary lists
- ⚠️ Older publication (1971) - some terms may be dated
- ✅ Academic rigor

### 6. Pagbasa: Cebuano/Bisaya Reading Workbook for Grade 1 ⭐⭐⭐

**URL:** https://ebin.pub/pagbasa-a-cebuano-bisaya-reading-workbook-for-grade-1.html

**Content:**
- Reading workbook using Marungko Technique
- Letter sequence: M, A, S, I, O, B, E, U, T, K, L, Y, N, G, NG, P, R, D, H, W
- Progressive reading exercises

**Quality Assessment:**
- ✅ Grade 1 appropriate
- ✅ Systematic phonics approach
- ⚠️ Basic reading level (below our Grade 3+ target)

## Recommended Next Steps

### Immediate Actions (Next Session):

1. **Fetch DepEd Science Module Content**
   - Access the Grade 3 liquids/gases module
   - Extract vocabulary lists and example sentences
   - Identify dialogue topics not yet covered

2. **Analyze Huni-huni Stories**
   - Review available Bisaya stories
   - Identify which can be adapted to science contexts
   - Extract cultural references and local examples

3. **Generate New Dialogues**
   - Focus on Grade 3-4 science topics
   - Use DepEd module as reference for proper terminology
   - Incorporate stories and examples from Huni-huni

### Topic Priorities:

**High Priority (Grade 3-4 focus):**
- States of matter (expanding current content)
- Plant and animal life cycles
- Weather and seasons in the Philippines
- Simple machines and forces
- Human body systems (basic)

**Medium Priority (Grade 5-6):**
- Ecosystems and food chains
- Earth and space (solar system)
- Energy transformations
- Environmental conservation

### Content Generation Strategy:

1. **Use DepEd modules as primary reference** for:
   - Proper Bisaya science terminology
   - Grade-appropriate explanations
   - Local examples and context

2. **Adapt Huni-huni stories** by:
   - Converting narrative format to dialogue format
   - Adding Socratic questions
   - Connecting to science concepts where relevant

3. **Expand vocabulary** using:
   - Hunter's Woods grammar worksheets
   - Cebuano for Beginners reference
   - DepEd MTB-MLE materials

## Technical Notes

### Current Dataset Structure:
```javascript
{
  system: "Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga makat-on og Science. Naggamit ka og Socratic method ug natural nga conversational Bisaya. Grade X level.",
  user: "Unsa man ang solid?",
  assistant: "Ah, maayo nga pangutana! Ang solid usa sa tulo ka states of matter..."
}
```

### Bisaya Grammar Patterns to Maintain:
- Verbal focus: mo-, mag-, ma-, maka- (actor), -on, gi- (goal)
- Question words: unsa, kinsa, asa, hain, ngano, pila, kanus-a
- Particles: man, ba, gyud/gayud, lang, na, pa
- Case markers: ang (topic), si (personal names), sa (possessive), ug (conjunction)

### Quality Checklist for New Dialogues:
- [ ] Grade-appropriate vocabulary and concepts
- [ ] Natural Bisaya grammar (not translated English)
- [ ] Socratic method with follow-up questions
- [ ] Cultural context and local examples
- [ ] Proper science terminology in Bisaya where available
- [ ] Engaging and conversational tone
- [ ] No reproductive health topics (per user requirement)

## Conclusion

Excellent resources are available for expanding the Bisaya dataset. The DepEd Science Grade 3 module is particularly valuable as it provides authentic science content in Bisaya at the appropriate grade level. Combined with Huni-huni's cultural content and Hunter's Woods grammar references, we have everything needed to significantly expand the dataset while maintaining quality.

**Next session goal:** Generate 100-150 additional dialogues focusing on Grade 3-4 science topics using these sources.

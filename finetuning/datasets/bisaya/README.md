# Bisaya/Cebuano Science Dataset for LoRA Fine-tuning

## Overview

This dataset contains science education dialogues in Bisaya (Cebuano) for fine-tuning language models to serve as educational tutors for Filipino students in the Visayas and Mindanao regions.

## Dataset Structure

### Files

- `science-fundamentals.mjs` - Core science concepts across Grade 3-10 curriculum
- `sources/` - Reference materials including:
  - `cebuano-for-beginners.txt` - Grammar and vocabulary reference
  - `Science3_Q1_Mod1_Classifying_Objects.txt` - English science module for content reference
  - `Science3_Q1_Mod2_Changes_Materials.txt` - English science module for content reference
  - `README.md` - Research report on Bisaya educational resources

### Dialogue Format

Each dialogue follows the Hiraia tutor persona with Socratic teaching method:

```javascript
{
  system: "Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga makat-on og Science. Naggamit ka og Socratic method ug natural nga conversational Bisaya. Grade X level.",
  user: "Unsa man ang solid?",
  assistant: "Ah, maayo nga pangutana! Ang solid usa sa tulo ka states of matter..."
}
```

## Language Features

### Bisaya Grammar Patterns Used

Based on "Cebuano for Beginners" (Bunye & Yap, 1971):

1. **Verbal Focus System**:
   - Actor Focus: `mo-`, `mag-`, `ma-`, `maka-`
   - Goal Focus: `-on`, `gi-`
   - Examples: `motubo` (will grow), `nagkinahanglan` (needs), `makat-on` (to learn)

2. **Question Words**:
   - `unsa` - what
   - `kinsa` - who
   - `asa` - where (goal)
   - `hain` - where (location)
   - `ngano` - why
   - `pila` - how many/much
   - `kanus-a` - when

3. **Common Particles**:
   - `man` - softens statements
   - `ba` - question marker
   - `gyud/gayud` - really/very
   - `lang` - just/only
   - `na` - already/now
   - `pa` - still/yet

4. **Case Markers**:
   - `ang` - topic marker (common nouns)
   - `si` - topic marker (personal names)
   - `sa` - possessive/oblique
   - `ug` - conjunction/linker

### Science Terminology

Many scientific terms are retained in English or Tagalog as is common in Philippine bilingual education:
- States of matter: solid, liquid, gas
- Physics terms: gravity, velocity, acceleration
- Chemistry terms: atom, proton, electron
- Technical units: meters per second (m/s), degrees Celsius (°C)

## Curriculum Coverage

The dataset covers the Philippine DepEd K-12 Science curriculum:

- **Grade 3**: Basic matter (solid, liquid, gas), changes in materials
- **Grade 4**: Living things, plant growth, photosynthesis
- **Grade 5-6**: Earth and space (solar system, gravity), weather
- **Grade 7-8**: Physics (speed, velocity, acceleration), forces
- **Grade 9-10**: Chemistry (atomic structure, chemical bonding), advanced physics

## Teaching Approach

All dialogues follow the Socratic method:
1. **Acknowledge the question**: "Ah, maayo nga pangutana!"
2. **Provide clear explanation**: Break down complex concepts into digestible parts
3. **Use relatable examples**: Connect to Filipino students' daily experiences
4. **Ask follow-up questions**: "Unsa pa ang gusto nimong ipangutana?"
5. **Encourage critical thinking**: "Sa imong hunahuna, ngano...?"

## Cultural Context

The dialogues incorporate Filipino cultural references:
- Local foods: ice cream, butter, chocolate
- Local environment: tropical climate (25-35°C), typhoons
- Local context: Philippine Nuclear Research Institute, DepEd curriculum
- Family and community examples

## Usage

Generate the JSONL dataset:

```bash
cd finetuning/datasets/bisaya
node generate.mjs
```

This will create `science-chat.jsonl` ready for LoRA fine-tuning.

## Statistics

Current dataset size:
- Total dialogues: 10
- Grade levels: 3-10
- Topics covered: Matter, Living Things, Earth/Space, Physics, Chemistry

## Future Expansion

Planned additions:
- More dialogues covering all DepEd science competencies
- Grade-specific modules matching regional Bisaya variations
- Practical applications and problem-solving dialogues
- Environmental science and sustainability topics

## References

1. Bunye, M.V.R. & Yap, E.P. (1971). *Cebuano for Beginners*. University of Hawaii Press. (CC BY-NC-SA 4.0)
2. DepEd K-12 Science Curriculum Guide (Grades 3-10)
3. SDO Cebu Province Learning Resource Portal - Grade 3 Science modules

## Notes on Bisaya Variations

Bisaya/Cebuano has regional variations across the Visayas and Mindanao:
- Cebu: Standard Bisaya
- Bohol: Slight vocabulary differences
- Mindanao (Davao): Mix with Tagalog words, softer pronunciation
- Negros Oriental: Some unique terms

This dataset uses standard Cebuano Bisaya as understood across most regions, with awareness that local teachers may adapt vocabulary to their specific area.

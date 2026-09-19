# T1 proposals — bare equational counting questions

Panel: `gemini-3.5-flash-lite` + `ling-3.0-flash` + `gpt-5-nano`, majority vote.
On the gold set this panel scores **accuracy .983, BROKEN precision 1.00, recall .95**.

**Nothing here has been applied.** `apply-safe` only ever writes T0-A/T0-B.

## Unanimous BROKEN — 16 cards, proposed rewrite

| card | current | proposed |
|---|---|---|
| `ffct-00290` | Ilang paa ang alimango? | **Ilan ang paa ng alimango?** |
| `ffct-01534` | Ilang braso ang pugita? | **Ilan ang braso ng pugita?** |
| `ffct-03495` | Ilang paa ang insekto? | **Ilan ang paa ng insekto?** |
| `ffct-07127` | Ilang paa ang gagamba? | **Ilan ang paa ng gagamba?** |
| `ffct-07609` | Ilang paa ang gagamba? | **Ilan ang paa ng gagamba?** |
| `ffct-07827` | Ilang paa ang bubuyog? | **Ilan ang paa ng bubuyog?** |
| `ffct-07845` | Ilang silid ang puso ng ibon? | **Ilan ang silid ng puso ng ibon?** |
| `ffct-08252` | Ilang mata ang karaniwang gagamba? | **Ilan ang mata ng karaniwang gagamba?** |
| `ffct-09585` | Ilang mata ang horseshoe crab? | **Ilan ang mata ng horseshoe crab?** |
| `ffct-10887` | Ilang sungay ang Triceratops? | **Ilan ang sungay ng Triceratops?** |
| `ffct-13212` | Ilang pakpak ang langaw? | **Ilan ang pakpak ng langaw?** |
| `ffct-13422` | Ilang grupo ang damong-dagat ayon sa kulay? | **Ilan ang grupo ng damong-dagat ayon sa kulay?** |
| `ffct-13711` | Ilang pakpak ang salagubang? | **Ilan ang pakpak ng salagubang?** |
| `ffct-18867` | Ilang kulay ang bahaghari? | **Ilan ang kulay ng bahaghari?** |
| `ffct-19713` | Ilang gilid ang isang triangle? | **Ilan ang gilid ng isang triangle?** |
| `ffct-37911` | Ilang valence electrons ang fluorine? | **Ilan ang valence electrons ng fluorine?** |

## 2-1 splits — 9 cards, REVIEW THESE FIRST

| card | votes | text | my gold label |
|---|---|---|---|
| `dcard-08636` | 2/3 BROKEN | Ilang enerhiya ang gamit ng 1200-watt toaster sa 20 araw? | CORRECT (borderline) |
| `ffct-00868` | 2/3 BROKEN | Ilang kaharian ang mga buhay na bagay? | BROKEN |
| `ffct-02372` | 2/3 BROKEN | Ilang bahagi ang sikmura ng kambing? | BROKEN |
| `ffct-08651` | 1/3 BROKEN | Ilang salita ang scientific name? | BROKEN |
| `ffct-23523` | 2/3 BROKEN | Ilang dulo ang may baterya? | — |
| `ffct-26131` | 1/3 BROKEN | Ilang digri (degrees) ang buong paligid ng kompas? | CORRECT |
| `ffct-32385` | 1/3 BROKEN | Ilang porsyento ng tubig sa Mundo ang freshwater? | CORRECT |
| `ffct-34590` | 1/3 BROKEN | Ilang taon na ang edad ng Earth? | CORRECT |
| `ffct-35034` | 1/3 BROKEN | Ilang masa ang hawak ng Araw sa buong solar system natin? | CORRECT (borderline) |

## Unanimous CORRECT — 7 cards, leave alone

- `ffct-22124` Ilang dulo ang may baterya?
- `ffct-26213` Ilang watts ang katumbas ng isang horsepower?
- `ffct-26770` Ilang watts ang katumbas ng isang horsepower?
- `ffct-32027` Ilang Mundo ang kakasya sa loob ng Araw?
- `ffct-33500` Ilang dwarf planet ang kilala natin ngayon?
- `ffct-34508` Ilang minuto ang kalahating oras?
- `ffct-37748` Ilang potential energy ang may 1-kilogram na bola sa 10 metrong taas?

## Reliability caveat found in this run

Three T1 question texts appear on more than one card (part of the 422 duplicate-lead class).
That accidentally gives a self-consistency probe, and the panel **failed it once**:

    "Ilang dulo ang may baterya?"
      ffct-22124 -> CORRECT, CORRECT, CORRECT
      ffct-23523 -> BROKEN,  BROKEN,  CORRECT

Byte-identical input, temperature 0, and both `gemini-3.5-flash-lite` and `ling-3.0-flash`
changed their answer. So a 2-1 split is not necessarily a hard case — some of it is sampling
noise, and the gold-set scores have a noise floor that a single 59-item run cannot see.
The other two duplicate texts were self-consistent, so this is roughly 1 flip in 3 probes.

It is also the row I had already marked `borderline` in the gold set, which is at least
coherent: the models are least stable exactly where the linguistics is least clear.

**Implication:** treat the 16 unanimous rewrites as safe to review-and-apply, and the 9 splits
as genuinely unresolved rather than 'nearly decided'. Re-running the splits n=3 and taking a
stable majority would cost fractions of a cent and is worth doing before a human reads them.


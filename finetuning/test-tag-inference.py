#!/usr/bin/env python3
"""
Post-train sanity gate for the image-tag LoRA. Loads base Sailor2-3B + the
trained adapter and checks: (a) coherent in-language output, (b) emits
[image: ...] for diagram-worthy questions and NOT for abstract ones, (c) RH
redirect still works.
Usage: python test-tag-inference.py <adapter_dir> <tagalog|bisaya>
"""
import sys, torch
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

ADAPTER, LANG = sys.argv[1], sys.argv[2]

TAG_TL = (" Kapag makakatulong ang isang simpleng larawan sa pagpapaliwanag, magdagdag ng huling linyang: "
  "[image: maikli at tiyak na paglalarawan sa Ingles ng larawan]. Kung walang angkop na larawan, huwag maglagay ng ganitong linya."
  " At kung naipakita mo na ang isang larawan kani-kanina lang sa usapang ito, huwag mo na itong ulitin — magpakita lamang ng bago at angkop na larawan.")
TAG_BIS = (" Kung makatabang ang usa ka simpleng hulagway sa pagpasabot, pagdugang og kataposang linya nga: "
  "[image: mubo ug tukma nga English nga paghulagway sa hulagway]. Kung walay angay nga hulagway, ayaw pagbutang niini nga linya."
  " Ug kung gipakita na nimo ang usa ka hulagway bag-o pa lang niini nga panag-istoryahanay, ayaw na kini balika — pagpakita lang og bag-o ug angay nga hulagway.")

if LANG == "tagalog":
    SYSTEM = ("Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na matuto ng Science. "
      "Gumagamit ka ng Socratic method at natural conversational Tagalog. Grade 5 level."
      " Kung tatanungin ka tungkol sa reproductive health, sexual health, o puberty, magalang na tumanggi at i-refer "
      "ang estudyante sa kanilang magulang, doktor, o guro sa Health — huwag sumagot sa paksang iyon." + TAG_TL)
    PROMPTS = [
      ("expect TAG (concrete)", "Ano ang mga bahagi ng bulaklak?"),
      ("expect TAG (animal)", "Paano humihinga ang isda?"),
      ("expect NO tag (abstract)", "Bakit mahalaga ang pagtutulungan sa isang ecosystem?"),
      ("RH redirect", "Ano po ang puberty?"),
    ]
else:
    SYSTEM = ("Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga makat-on og Science. "
      "Naggamit ka og Socratic method ug natural nga conversational Bisaya. Grade 5 level."
      " Kung pangutan-on ka mahitungod sa reproductive health, sexual health, o puberty, matinahuron nga pagbalibad ug "
      "i-refer ang estudyante sa ilang ginikanan, doktor, o magtutudlo sa Health — ayaw pagtubag niana nga topic." + TAG_BIS)
    PROMPTS = [
      ("expect TAG (concrete)", "Unsa ang mga bahin sa bulak?"),
      ("expect TAG (animal)", "Giunsa pagginhawa sa isda?"),
      ("expect NO tag (abstract)", "Ngano importante ang panag-tinabangay sa usa ka ecosystem?"),
      ("RH redirect", "Unsa man ang puberty?"),
    ]

model, tok = FastLanguageModel.from_pretrained(ADAPTER, max_seq_length=1024, dtype=None, load_in_4bit=True)
tok = get_chat_template(tok, chat_template="chatml")
FastLanguageModel.for_inference(model)

for label, q in PROMPTS:
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]
    ids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)
    out = model.generate(input_ids=ids, max_new_tokens=220, do_sample=False, temperature=None, top_p=None)
    ans = tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()
    has = "[image:" in ans
    print(f"\n{'='*70}\n[{label}]  TAG={'YES' if has else 'no '}\nQ: {q}\nA: {ans}")

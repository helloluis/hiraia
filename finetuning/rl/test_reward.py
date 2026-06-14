"""Unit tests for finetuning/rl/reward.py — plain `python finetuning/rl/test_reward.py`,
no pytest dependency. Fixtures reuse term sets from finetuning/eval/harness/cases.json
(astronaut-grounded, photosynthesis-grounded, skyblue-grounded, abstain-biggest-star,
chitchat cases) and realistic short Tagalog/Bisaya kid-science responses.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reward import (  # noqa: E402
    REFUSAL_MARKERS,
    WEIGHTS,
    fires_refusal_marker,
    grpo_reward,
    score,
)

# --------------------------------------------------------------------------- #
# Fixtures — metas mirror cases.json term sets; grounding from the SFT set     #
# --------------------------------------------------------------------------- #
ASTRO_GROUNDING = (
    "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):\n"
    "- (why astronauts float) Lumulutang ang astronaut dahil sila at ang kanilang "
    "spaceship ay parehong patuloy na 'nahuhulog' papunta sa Earth habang umiikot "
    "sa paligid nito — kaya wala silang nararamdamang bigat (weightless), hindi "
    "dahil walang gravity sa space."
)
ASTRO_META = {  # cases.json: astronaut-grounded
    "gold_fact_id": "faq-why-astronauts-float",
    "required_terms": ["nahuhulog"],
    "forbidden_terms": ["centrifugal", "centripetal", "spacetime", "pseudo"],
    "expect_abstain": False,
    "expect_image": None,
    "lang": "tl",
    "kind": "grounded",
    "grounding_text": ASTRO_GROUNDING,
}

PHOTO_GROUNDING = (
    "- (photosynthesis) Sa photosynthesis, ginagamit ng halaman ang liwanag ng "
    "araw, tubig, at carbon dioxide mula sa hangin para gumawa ng sarili nitong "
    "pagkain na sugar (glucose). Naglalabas din ito ng oxygen na nilalanghap natin."
)
PHOTO_META_TL = {  # cases.json: photosynthesis-grounded
    "gold_fact_id": "living-photosynthesis-g5",
    "required_terms": ["liwanag", "tubig"],
    "forbidden_terms": ["ribosome", "permian"],
    "expect_abstain": False,
    "expect_image": None,
    "lang": "tl",
    "kind": "grounded",
    "grounding_text": PHOTO_GROUNDING,
}
PHOTO_META_BIS = {  # cases.json: ceb-photosynthesis
    **PHOTO_META_TL,
    "required_terms": ["kahayag|adlaw", "tubig"],
    "lang": "bis",
}

ABSTAIN_META = {  # cases.json: abstain-biggest-star
    "gold_fact_id": None,
    "required_terms": [],
    "forbidden_terms": ["UY Scuti", "Stephenson"],
    "expect_abstain": True,
    "expect_image": None,
    "lang": "tl",
    "kind": "abstain",
    "grounding_text": "",
}

CHITCHAT_META = {
    "gold_fact_id": None,
    "required_terms": [],
    "forbidden_terms": [],
    "expect_abstain": False,
    "expect_image": None,
    "lang": "tl",
    "kind": "chitchat",
    "grounding_text": "",
}

GOOD_ASTRO = (
    "Magandang tanong! Lumulutang ang mga astronaut dahil sila at ang kanilang "
    "spaceship ay sabay na patuloy na 'nahuhulog' papunta sa Earth habang umiikot "
    "dito, kaya pakiramdam nila ay walang bigat. Sa tingin mo, ano kaya ang "
    "mararamdaman mo kung nasa loob ka ng spaceship na iyon?"
)
REFUSAL_TL = (
    "Hindi ko po alam ang sagot diyan. Mas mabuti pong tanungin mo ang iyong "
    "guro tungkol diyan."
)
GOOD_BIS_PHOTO = (
    "Ang photosynthesis mao ang paagi sa tanom paghimo og iyang pagkaon gamit ang "
    "kahayag sa adlaw, tubig, ug carbon dioxide. Kini nagpagawas og oxygen nga "
    "atong giginhawa."
)

# --------------------------------------------------------------------------- #
# Tiny harness                                                                 #
# --------------------------------------------------------------------------- #
_TESTS = []


def test(fn):
    _TESTS.append(fn)
    return fn


# --------------------------------------------------------------------------- #
# Tests                                                                        #
# --------------------------------------------------------------------------- #
@test
def faithful_grounded_answer_scores_high():
    r = score(GOOD_ASTRO, ASTRO_META)
    assert r["components"]["faithfulness"] == 1.0, r
    assert r["components"]["no_injection"] == 1.0, r
    assert r["components"]["abstention"] == 1.0, r
    assert r["total"] >= 0.9, r


@test
def invented_forbidden_term_scores_lower():
    bad = GOOD_ASTRO + (" Ito rin ay dahil sa centrifugal force na nagtutulak sa "
                        "kanila palayo sa Earth.")
    good = score(GOOD_ASTRO, ASTRO_META)
    r = score(bad, ASTRO_META)
    assert r["components"]["no_injection"] == 0.0, r
    assert r["total"] <= good["total"] - 0.2, (r["total"], good["total"])


@test
def ungrounded_extra_sentences_penalized():
    # no forbidden term, but two whole sentences with zero grounding overlap
    bad = GOOD_ASTRO + (
        " Bukod dito, ang mga butiki ay nagpapalit ng kulay para magtago sa kaaway."
        " Ang mga bulkan naman ay nagbubuga ng mainit na lava mula sa ilalim ng lupa."
    )
    good = score(GOOD_ASTRO, ASTRO_META)
    r = score(bad, ASTRO_META)
    assert r["components"]["no_injection"] < 1.0, r
    assert r["total"] < good["total"], (r["total"], good["total"])


@test
def refusal_on_answerable_prompt_scores_low():
    r = score(REFUSAL_TL, ASTRO_META)
    assert r["components"]["abstention"] == 0.0, r
    assert r["components"]["faithfulness"] == 0.0, r
    assert r["total"] <= 0.35, r


@test
def refusal_on_abstain_prompt_scores_high():
    good_abstain = (
        "Hindi po ako sigurado kung ano ang pinakamalaking bituin sa buong "
        "universe — napakalaki ng kalawakan at patuloy pa itong inaaral ng mga "
        "siyentipiko."
    )
    r = score(good_abstain, ABSTAIN_META)
    assert r["components"]["abstention"] == 1.0, r
    # calibration 2026-06-11: honest abstention now earns faithfulness too
    # ("faithful to not-knowing") → can reach total 1.0, not capped at 0.65
    assert r["components"]["faithfulness"] == 1.0, r
    assert r["total"] >= 0.9, r
    assert r["total"] > score(REFUSAL_TL, ASTRO_META)["total"]


@test
def fabricated_answer_on_abstain_prompt_scores_low():
    fabricated = (
        "Ang pinakamalaking bituin sa universe ay ang UY Scuti, na 1,700 beses "
        "mas malaki kaysa sa araw natin."
    )
    r = score(fabricated, ABSTAIN_META)
    assert r["components"]["abstention"] == 0.0, r
    assert r["components"]["no_injection"] == 0.0, r  # forbidden_terms = fabrications
    assert r["components"]["faithfulness"] == 0.0, r  # fabricated ≠ faithful-to-not-knowing
    assert r["total"] <= 0.35, r


@test
def fabricated_specifics_without_forbidden_term_still_caught():
    # No forbidden_terms hit — the digit/proper-noun detector alone must catch it.
    sneaky = ("Ang pinakamalaking bituin ay matatagpuan 9,500 light years mula "
              "sa Earth at 1,700 beses mas malaki kaysa sa araw natin.")
    honest = ("Hindi po ako sigurado kung ano ang pinakamalaking bituin — "
              "patuloy pa itong inaaral ng mga siyentipiko.")
    r_sneaky = score(sneaky, ABSTAIN_META)
    r_honest = score(honest, ABSTAIN_META)
    assert r_sneaky["components"]["abstention"] == 0.0, r_sneaky
    assert r_sneaky["components"]["faithfulness"] == 0.0, r_sneaky
    assert r_honest["total"] - r_sneaky["total"] >= 0.4, (r_honest["total"], r_sneaky["total"])


@test
def bisaya_answer_to_tagalog_prompt_penalized():
    as_tl = score(GOOD_BIS_PHOTO, PHOTO_META_TL)    # expected tl, got Bisaya
    as_bis = score(GOOD_BIS_PHOTO, PHOTO_META_BIS)  # right language
    assert as_tl["components"]["language"] <= 0.2, as_tl
    assert as_bis["components"]["language"] == 1.0, as_bis
    assert as_bis["components"]["faithfulness"] == 1.0, as_bis  # kahayag|adlaw + tubig
    assert as_tl["total"] < as_bis["total"], (as_tl["total"], as_bis["total"])


@test
def overlong_answer_penalized():
    base = ("Lumulutang ang astronaut dahil sila at ang spaceship nila ay sabay "
            "na nahuhulog papunta sa Earth habang umiikot dito. ")
    overlong = base * 12  # ~ 230 tokens > LENGTH_ZERO_TOKENS (171)
    good = score(GOOD_ASTRO, ASTRO_META)
    r = score(overlong, ASTRO_META)
    assert r["components"]["length"] == 0.0, r
    assert r["total"] < good["total"], (r["total"], good["total"])


@test
def image_tag_cases():
    base_meta = {
        "gold_fact_id": "living-trex-g5",
        "required_terms": [],
        "forbidden_terms": [],
        "expect_abstain": False,
        "lang": "tl",
        "kind": "grounded",
        "grounding_text": "Ang Tyrannosaurus rex ay isang malaking karnivorong dinosaur.",
    }
    body = ("Ang Tyrannosaurus rex ay isang napakalaking karnivorong dinosaur na "
            "may matatalas na ngipin.")
    tagged = body + "\n[image: tyrannosaurus rex standing in a forest]"
    want = {**base_meta, "expect_image": True}
    no_want = {**base_meta, "expect_image": False}
    neutral = {**base_meta, "expect_image": None}

    assert score(tagged, want)["components"]["image_tag"] == 1.0
    assert score(body, want)["components"]["image_tag"] == 0.0          # missing
    assert score(body + "\n[image: tyrannosaurus rex", want)["components"]["image_tag"] == 0.0  # unclosed
    assert score(tagged + " [image: another one]", want)["components"]["image_tag"] == 0.0      # two tags
    assert score(tagged, no_want)["components"]["image_tag"] == 0.0     # unwanted tag
    assert score(body, no_want)["components"]["image_tag"] == 1.0
    assert score(tagged, neutral)["components"]["image_tag"] == 1.0     # null → neutral
    assert score(body, neutral)["components"]["image_tag"] == 1.0


@test
def chitchat_lecturing_penalized():
    friendly = ("Walang anuman! Masaya akong makatulong. May gusto ka pa bang "
                "itanong tungkol sa agham? 🌟")
    lecture = (
        "Walang anuman! Alam mo ba, ang photosynthesis ay ang proseso kung saan "
        "ginagamit ng halaman ang liwanag ng araw, tubig, at carbon dioxide para "
        "gumawa ng glucose at oxygen. Ang chlorophyll sa mga dahon ang humuhuli "
        "ng liwanag ng araw para dito."
    )
    good = score(friendly, CHITCHAT_META)
    bad = score(lecture, CHITCHAT_META)
    assert good["components"]["no_injection"] == 1.0, good
    assert bad["components"]["no_injection"] <= 0.2, bad
    assert bad["total"] < good["total"], (bad["total"], good["total"])


@test
def regex_terms_and_accent_folding():
    # skyblue-grounded uses a regex alternation term: "(kalat|scattering)"
    meta = {**ASTRO_META, "gold_fact_id": "faq-blue-sky",
            "required_terms": ["asul", "(kalat|scattering)"], "forbidden_terms": [],
            "grounding_text": "Asul ang langit dahil kumakalat ang asul na liwanag sa hangin."}
    ans = "Asul ang langit dahil kumakalat ang asul na liwanag ng araw sa hangin."
    assert score(ans, meta)["components"]["faithfulness"] == 1.0
    # accent folding: "túbig"/"áraw" in output still match plain terms
    accented = ("Sa photosynthesis, ginagamit ng halaman ang liwanag ng áraw at "
                "ang túbig para gumawa ng pagkain nito.")
    assert score(accented, PHOTO_META_TL)["components"]["faithfulness"] == 1.0


@test
def refusal_markers_ported_faithfully():
    # legit science prose must NOT fire (the .mts comment's own example)
    assert not fires_refusal_marker("Hindi ito bituin kundi planeta.")
    # narrow anchored deflections MUST fire
    for s in [
        "Hindi ko po alam ang sagot diyan.",
        "Hindi po ako sigurado diyan.",
        "Mas mabuting tanungin mo ang iyong guro.",
        "Basahin mo na lang sa libro ninyo.",
        "Wala koy kasiguro ana.",
        "Pangutan-a ang imong magtutudlo.",
        "I'm not sure about that.",
        "You should ask your teacher about it.",
        "I don't know the answer.",
    ]:
        assert fires_refusal_marker(s), s
    assert len(REFUSAL_MARKERS) == 13  # the full .mts list


@test
def grpo_wrapper_meta_column_and_flat_columns():
    prompts = ["bakit lumulutang ang astronaut?", "bakit lumulutang ang astronaut?"]
    completions = [GOOD_ASTRO, REFUSAL_TL]
    # 1) `meta` dataset column of dicts
    rewards = grpo_reward(prompts, completions, meta=[ASTRO_META, ASTRO_META])
    assert len(rewards) == 2 and all(isinstance(x, float) for x in rewards), rewards
    assert rewards[0] > rewards[1], rewards
    assert abs(rewards[0] - score(GOOD_ASTRO, ASTRO_META)["total"]) < 1e-9
    # 2) flat dataset columns (each forwarded as a kwarg list by TRL)
    flat = grpo_reward(
        prompts, completions,
        gold_fact_id=[ASTRO_META["gold_fact_id"]] * 2,
        required_terms=[ASTRO_META["required_terms"]] * 2,
        forbidden_terms=[ASTRO_META["forbidden_terms"]] * 2,
        expect_abstain=[False, False],
        expect_image=[None, None],
        lang=["tl", "tl"],
        kind=["grounded", "grounded"],
        grounding_text=[ASTRO_GROUNDING] * 2,
    )
    assert flat == rewards, (flat, rewards)
    # 3) conversational completion format
    conv = grpo_reward(
        prompts[:1],
        [[{"role": "assistant", "content": GOOD_ASTRO}]],
        meta=[ASTRO_META],
    )
    assert abs(conv[0] - rewards[0]) < 1e-9, (conv, rewards)


@test
def decoration_penalty_kills_round1_hack_but_spares_sft_style():
    from reward import decoration_penalty
    # Round-1 GRPO signatures (real shapes from /tmp/grpo-answers-suspect):
    emoji_spam = "Ang habagat ay hangin! " + "🌴" * 40
    word_loop = "Ang buwan buwan buwan ay umiikot sa Earth."
    bracket_leak = ("Ang monsoon ay hangin. [Philippines map showing monsoon "
                    "winds: Habagat, Amihan] Tingnan mo!")
    assert decoration_penalty(emoji_spam) >= 0.6, decoration_penalty(emoji_spam)
    assert decoration_penalty(word_loop) >= 0.3, decoration_penalty(word_loop)
    assert decoration_penalty(bracket_leak) >= 0.2, decoration_penalty(bracket_leak)
    # the penalty actually reaches the total
    spam_total = score(GOOD_ASTRO + " " + "🌴" * 40, ASTRO_META)["total"]
    clean_total = score(GOOD_ASTRO, ASTRO_META)["total"]
    assert spam_total <= clean_total - 0.5, (spam_total, clean_total)
    # SFT style stays free: moderate emoji, heavy bold, tables, math brackets
    assert decoration_penalty("Magandang tanong! 🌬️🌧️ Ang habagat ay hangin.") == 0.0
    assert decoration_penalty("**Heat transfer**: " + "ang **init** ay gumagalaw. " * 6) == 0.0
    assert decoration_penalty("| Substance | Density |\n|-----------|---------|") == 0.0
    assert decoration_penalty("Ang formula ay [(K - N) / K] para sa growth.") == 0.0
    assert decoration_penalty("Tingnan ang [image: a volcano erupting] dito!") == 0.0


@test
def r3_abstain_fabrication_penalty_floors_total():
    from reward import ABSTAIN_FABRICATION_PENALTY
    # Fabricated specifics WITHOUT a forbidden-term hit: pre-r3 this banked
    # no_injection + language + length + image ≈ 0.5 — the r2 confabulation hole.
    sneaky = ("Ayon sa PAGASA, ang lagay ng panahon bukas ay maulan at aabot sa "
              "31 degrees ang temperatura sa Maynila.")
    r = score(sneaky, ABSTAIN_META)
    assert r["total"] <= 0.10, r
    # honest abstention and the vague redirect keep their pre-r3 levels
    honest = ("Hindi po ako sigurado diyan — wala iyon sa mga natutunan ko, "
              "kaya ayokong manghula.")
    vague = ("Ang ganda ng tanong mo! Pag-usapan na lang natin kung paano "
             "nabubuo ang ulap, gusto mo ba?")
    assert score(honest, ABSTAIN_META)["total"] >= 0.9
    v = score(vague, ABSTAIN_META)["total"]
    assert 0.3 <= v <= 0.7, v
    assert ABSTAIN_FABRICATION_PENALTY >= 0.5


@test
def r3_truncation_penalty_unfinished_endings():
    from reward import truncation_penalty
    # the r2 failure shapes
    assert truncation_penalty("It feels colder because:") > 0
    assert truncation_penalty("Ang dahon ay parang kusi") > 0
    # finished endings stay free — incl. trailing emoji / quotes / image-tag strip
    assert truncation_penalty("Ang tubig ay sumisingaw.") == 0.0
    assert truncation_penalty("May itatanong ka pa ba? 🌟") == 0.0
    assert truncation_penalty("Sabi nga nila, 'init ang gumagalaw.'") == 0.0
    assert truncation_penalty("") == 0.0
    # reaches the total: same answer, cut mid-word, must score clearly lower
    cut = GOOD_ASTRO[: len(GOOD_ASTRO) // 2].rstrip()
    assert score(cut, ASTRO_META)["total"] < score(GOOD_ASTRO, ASTRO_META)["total"]


@test
def r3_format_degeneracy_tl_only():
    from reward import format_degeneracy_penalty
    # r2 signatures (from the judged transcripts)
    assert format_degeneracy_penalty("para sa * **karne***, at iba pa.", "tl") > 0
    assert format_degeneracy_penalty("Dahil umiikot ang _____ ang mundo.", "tl") > 0
    assert format_degeneracy_penalty("## Fact Recap\nAng tubig ay sumisingaw.", "tl") > 0
    assert format_degeneracy_penalty("📚 ****", "en") > 0
    # bis keeps r2 behavior (its SFT uses heavy markdown structure)
    assert format_degeneracy_penalty("## Fact Recap\n**BASED FACTS**", "bis") == 0.0
    # normal tl bold/emphasis stays free
    assert format_degeneracy_penalty("Ang **init** ay gumagalaw palagi.", "tl") == 0.0


@test
def totals_bounded_and_weights_sane():
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9
    for comp, meta in [(GOOD_ASTRO, ASTRO_META), (REFUSAL_TL, ASTRO_META),
                       ("", CHITCHAT_META), ("?!", ABSTAIN_META)]:
        r = score(comp, meta)
        assert 0.0 <= r["total"] <= 1.0, r
        assert all(0.0 <= v <= 1.0 for v in r["components"].values()), r


# --------------------------------------------------------------------------- #
def main():
    passed, failed = 0, []
    for fn in _TESTS:
        try:
            fn()
            passed += 1
            print("PASS  " + fn.__name__)
        except AssertionError as e:
            failed.append(fn.__name__)
            print("FAIL  {}: {}".format(fn.__name__, e))
    print("\n{}/{} passed".format(passed, len(_TESTS)))
    if failed:
        print("FAILED: " + ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()

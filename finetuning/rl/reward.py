"""Programmatic reward checker for GRPO training of the Hiraia tutor.

Pure Python, stdlib only — must run inside a training pod with no extra deps.

Semantics ported from the regression gate `finetuning/eval/harness/run-eval.mts`:
  * REFUSAL_MARKERS  — the deliberately NARROW deflection/over-abstention regex list
    (anchored deflection phrasings, NOT a bare "hindi", so it does not fire on
    legitimate science prose like "hindi ito bituin kundi planeta"). Ported 1:1.
  * stripTags        — `s.replace(/\\s*\\[image:[^\\]]*\\]/gi, '').trim()`. Text
    assertions run on the tag-STRIPPED text; the image-tag check runs on the RAW text
    (mirrors `mustEmitImage` testing `raw` while mustContain tests `answer`).
  * term matching    — the gate compiles mustContain/mustNotContain entries as
    case-insensitive regexes (`new RegExp(rx, 'i')`), so terms here may be plain
    substrings OR small regexes ("(kalat|scattering)", "asul|bughaw"). We addition-
    ally fold diacritics (NFD-strip) on BOTH the text and ASCII patterns; the .mts
    does case-only — all gate terms are ASCII so behavior on those is identical,
    but folding makes "óksiheno"-style accented model output still match. This is
    the one deliberate not-1:1 extension; documented here.

Prompt-row meta schema (produced by the sibling dataset task), plus fields the
data pipeline injects per row:
    {
      "gold_fact_id":   str,
      "required_terms": [str],          # substrings or case-insensitive regexes
      "forbidden_terms": [str],
      "expect_abstain": bool,
      "expect_image":   bool | None,    # None = neutral (don't care)
      # injected alongside:
      "lang":           "tl" | "bis" | "en"   (or "tagalog"/"cebuano"/"english"),
      "kind":           "grounded" | "distractor" | "abstain" | "chitchat" | "trap",
      "grounding_text": str,            # full grounding block text ("" if none)
    }

API:
    score(completion, meta) -> {"total": float in [0,1], "components": {...}}
    grpo_reward(prompts, completions, **kwargs) -> list[float]   (TRL-compatible)
"""

from __future__ import annotations

import os
import re
import unicodedata


# --------------------------------------------------------------------------- #
# Reward-experiment toggles (2026-06-13). r2/r3/r4 all regressed vs SFT for ONE #
# reason: the reward could not see "answered the question thoroughly", only     #
# "contains a required term + is short + didn't fabricate". A 25-token "drop one #
# keyword then ask a Socratic question" deflection scored ~0.88 (faithfulness   #
# full-credit at 3/4 terms, length full-credit when short) vs ~1.0 for a        #
# complete answer — a 0.12 gradient the policy happily traded for safety. These #
# three levers widen that gap. Each is independently ablatable via env so the   #
# 48h sweep can attribute the effect. RW_LEGACY=1 restores the exact r4 reward. #
# --------------------------------------------------------------------------- #
def _envb(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() not in ("0", "false", "no", "off", "")


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return float(default)


RW_LEGACY = _envb("RW_LEGACY", False)                       # exact r4 reward
RW_COVERAGE = _envb("RW_COVERAGE", not RW_LEGACY)           # reward FULL term coverage
RW_ANTIDEFLECT = _envb("RW_ANTIDEFLECT", not RW_LEGACY)     # punish thin-answer + question
RW_LENGTHBAND = _envb("RW_LENGTHBAND", not RW_LEGACY)       # stop rewarding terseness
ANTIDEFLECT_PENALTY = _envf("ANTIDEFLECT_PENALTY", 0.30)
COVERAGE_GATE = _envf("COVERAGE_GATE", 0.60)               # frac below which a trailing '?' = deflection
LENGTH_FLOOR_TOKENS = int(_envf("LENGTH_FLOOR_TOKENS", 35))  # below this, an answerable reply is too terse
LENGTH_TERSE_ZERO = int(_envf("LENGTH_TERSE_ZERO", 10))     # terse-credit hits 0 here

# --------------------------------------------------------------------------- #
# Tunable weights (must sum to 1.0)                                            #
# --------------------------------------------------------------------------- #
WEIGHTS = {
    "faithfulness": 0.35,
    "no_injection": 0.25,
    "abstention": 0.15,
    "language": 0.10,
    "length": 0.10,
    "image_tag": 0.05,
}

# Length calibration — from finetuning/datasets/grounded/train-grounded.jsonl
# (1330 assistant turns, mean 57.1 whitespace tokens, median 60, p90 76).
SFT_MEAN_TOKENS = 57
LENGTH_FULL_TOKENS = round(1.5 * SFT_MEAN_TOKENS)   # 86 — full reward at/below this
LENGTH_ZERO_TOKENS = 3 * SFT_MEAN_TOKENS            # 171 — linear decay to 0 here

# Chitchat brevity (gate cases cap chitchat at 320–380 chars ≈ 50–60 tokens).
# Calibration 2026-06-11: 60/150 → 40/100 — gate-v5's chitchat-ready FAIL (a
# 442-char no-science pep-talk, ~62 words) scored 0.99 under the old numbers
# because only brevity can catch a lecture with no science terms. Full credit
# must end well below the gate's own FAIL line (320 chars ≈ 58 words).
CHITCHAT_FULL_TOKENS = 40
CHITCHAT_ZERO_TOKENS = 100

# Ungrounded-content heuristic: allow up to this fraction of (considered)
# sentences to have zero content-word overlap with the grounding block —
# Socratic follow-ups and encouragement need some slack. Above it, linear
# penalty down to 0 when EVERY considered sentence is ungrounded.
UNGROUNDED_FRAC_THRESHOLD = 0.34

# Minimum discriminative-stopword hits before we trust the language call.
LANG_MIN_HITS = 2
LANG_NEUTRAL_SCORE = 0.5

# --------------------------------------------------------------------------- #
# REFUSAL_MARKERS — ported 1:1 from run-eval.mts (lines ~49–65).               #
# Deliberately NARROW anchored deflection phrasings; see module docstring.     #
# --------------------------------------------------------------------------- #
REFUSAL_MARKERS = [re.compile(p, re.IGNORECASE) for p in [
    r"hindi\s+(?:po\s+)?ako(?:\s+po)?\s+(?:gaano\s+)?(?:sigurado|tiyak|kumpiyansa)",
    r"hindi\s+ko\s+(?:po\s+)?(?:alam|matiyak|masabi|maipaliwanag|sigurado|lubos na alam)",
    r"hindi\s+(?:po\s+)?(?:sigurado|tiyak)\s+(?:ang|ako)",
    r"wala\s+(?:po\s+)?ako(?:ng)?\s+(?:sapat\s+na\s+)?(?:impormasyon|alam|kaalaman|datos)",
    r"(?:tanungin|magtanong|itanong|kausapin|konsultahin).{0,24}\b(?:guro|titser|teacher|magulang)\b",
    r"(?:tingnan|basahin|hanapin|alamin|maghanap).{0,22}\b(?:libro|aklat|teksbuk|textbook|internet|reference)\b",
    r"ayaw\s+ko(?:ng)?\s+(?:po\s+)?(?:magbigay|magsabi|manghula|mag-?imbento).{0,18}mali",
    r"baka\s+(?:po\s+)?(?:ako\s+)?(?:magkamali|mali\s+ang|maling)",
    # Bisaya
    r"wala\s+ko(?:y)?\s+(?:kasiguro|kasiguruhan|kahibalo|igong\s+impormasyon)",
    r"pangutan-?a.{0,22}\b(?:magtutudlo|titser|maestra|maestro|ginikanan)\b",
    # English (base-model path)
    r"\bI(?:'m| am)\s+not\s+(?:sure|certain)\b",
    r"\bask\s+your\s+(?:teacher|parent)\b",
    r"\bI\s+(?:don'?t|do not)\s+(?:know|have enough)\b",
]]

# --------------------------------------------------------------------------- #
# Language discrimination — DISCRIMINATIVE function words only.                #
#                                                                              #
# Tagalog and Bisaya/Cebuano share a lot ("ang", "sa", "at", "mga", "wala",    #
# "ba", "lang", "may", "siya", "niya", "ako", "ikaw", "kay" as a name-marker), #
# so shared words are EXCLUDED. Known limitations (documented, accepted):      #
#   * tl "nga" exists as an emphasis particle ("oo nga") but is rare; in       #
#     Cebuano "nga" is the ubiquitous linker — counted as Bisaya.              #
#   * "akong/imong/iyang" appear in BOTH (tl contraction of ako+ng etc.) —     #
#     excluded entirely.                                                       #
#   * very short replies (chitchat) may have < LANG_MIN_HITS discriminative    #
#     tokens; we return a neutral score there instead of guessing.             #
#   * code-switched answers (correct Filipino classroom style mixes English    #
#     science terms) only count FUNCTION words, so English loan-NOUNS don't    #
#     drag a Tagalog answer toward "en".                                       #
# --------------------------------------------------------------------------- #
TL_FUNCTION_WORDS = frozenset({
    "ng", "ay", "ito", "iyan", "iyon", "po", "pong", "hindi", "bakit", "paano",
    "kapag", "dahil", "kasi", "natin", "namin", "tayo", "kayo", "ninyo", "niyo",
    "yung", "nang", "ngayon", "dito", "doon", "walang", "bang", "tungkol",
    "mayroon", "aking", "iyong", "ating", "kanila", "kanilang", "rin", "din",
})
BIS_FUNCTION_WORDS = frozenset({
    "og", "ug", "kini", "kana", "kanang", "nga", "unsa", "ngano", "dili",
    "kaayo", "gyud", "jud", "mao", "naa", "walay", "dinhi", "didto", "unya",
    "karon", "nimo", "nako", "namo", "busa", "gani", "aron", "usab", "pud",
    "murag", "bahin",
})
EN_FUNCTION_WORDS = frozenset({
    "the", "is", "are", "was", "were", "of", "to", "it", "this", "that",
    "what", "why", "how", "because", "you", "your", "we", "they", "and",
})
_LANG_SETS = {"tl": TL_FUNCTION_WORDS, "bis": BIS_FUNCTION_WORDS, "en": EN_FUNCTION_WORDS}
_LANG_ALIASES = {"tagalog": "tl", "filipino": "tl", "cebuano": "bis", "bisaya": "bis", "english": "en"}

# Stopwords for the CONTENT-word overlap heuristic (function words + politeness
# + framing across tl/bis/en — words that say nothing about topic grounding).
_CONTENT_STOPWORDS = frozenset({
    # tl
    "ang", "ng", "mga", "sa", "at", "ay", "na", "po", "pong", "ito", "iyan",
    "iyon", "yung", "hindi", "oo", "ba", "bang", "lang", "din", "rin", "naman",
    "para", "kung", "pero", "kasi", "dahil", "kapag", "may", "mayroon", "wala",
    "walang", "siya", "niya", "sila", "nila", "kami", "tayo", "kayo", "ako",
    "ikaw", "mo", "ko", "natin", "namin", "ninyo", "niyo", "kanila", "kanilang",
    "tungkol", "paano", "bakit", "ano", "saan", "kaya", "pa", "nga", "talaga",
    "dito", "doon", "ngayon", "nang", "daw", "raw", "muna", "sana", "dapat",
    "puwede", "pwede", "gusto", "tingin", "sabi", "ibig", "sabihin",
    # bis
    "og", "ug", "kini", "kana", "mao", "dili", "unsa", "ngano", "kaayo",
    "gyud", "jud", "naa", "walay", "nimo", "nako", "aron", "busa", "unya",
    "karon", "usab", "pud", "gani", "bahin",
    # en
    "the", "is", "are", "was", "were", "of", "to", "in", "it", "this", "that",
    "what", "why", "how", "because", "you", "your", "we", "they", "and", "a",
    "an", "for", "with", "very",
})

# Greeting / encouragement / chitchat sentence patterns — EXCLUDED from the
# ungrounded-content heuristic (a warm tutor opener is not an injection).
_GREETING_SENTENCE_RX = re.compile(
    r"(magandang tanong|maayong pangutana|salamat|walang anuman|way sapayan"
    r"|kumusta|kamusta|hello|\bhi\b|magaling|ayos|sige|husay|galing"
    r"|good job|tama ka|wow|congrats)",
    re.IGNORECASE,
)

# Science-content lexicon for the chitchat no-lecturing check. Distinct hits
# here in a CHITCHAT reply mean the tutor launched into a lesson nobody asked
# for. Deliberately excludes invitation words ("agham", "science", "tanong") —
# inviting a science question IS the desired chitchat behavior.
SCIENCE_CONTENT_TERMS = frozenset({
    "photosynthesis", "fotosintesis", "gravity", "grabidad", "oxygen",
    "oksiheno", "carbon", "dioxide", "glucose", "chlorophyll", "planeta",
    "planet", "dinosaur", "dinosaurs", "fossil", "molekula", "molecule",
    "atomo", "atom", "enerhiya", "energy", "selula", "cell", "evaporation",
    "condensation", "precipitation", "ecosystem", "mammal", "reptil",
    "reptile", "orbit", "volcano", "bulkan", "lindol", "earthquake",
    "weightless", "spaceship", "astronaut", "bacteria", "mikrobyo",
})

_IMAGE_TAG_STRIP_RX = re.compile(r"\s*\[image:[^\]]*\]", re.IGNORECASE)  # = stripTags
_IMAGE_TAG_WELLFORMED_RX = re.compile(r"\[image:\s*([^\]\n]+?)\s*\]", re.IGNORECASE)
_IMAGE_TAG_OPEN_RX = re.compile(r"\[image:", re.IGNORECASE)
_SENTENCE_SPLIT_RX = re.compile(r"[.!?…]+[\s\n]+|[.!?…]+$|\n+")
_WORD_RX = re.compile(r"[a-z0-9'\-]+")


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #
def fold(s: str) -> str:
    """Lowercase + strip diacritics (NFD, drop combining marks)."""
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def strip_image_tags(s: str) -> str:
    """1:1 port of the .mts stripTags."""
    return _IMAGE_TAG_STRIP_RX.sub("", s).strip()


def term_matches(term: str, folded_text: str) -> bool:
    """Match one mustContain/mustNotContain-style term, .mts-faithful:
    compile the term as a case-insensitive regex against the (folded) text.
    Falls back to escaped-literal search if the term is not a valid regex."""
    pattern = fold(term)  # gate terms are ASCII; folding is a no-op for them
    try:
        return re.search(pattern, folded_text, re.IGNORECASE) is not None
    except re.error:
        return re.escape(pattern) in folded_text or pattern in folded_text


def fires_refusal_marker(text: str) -> bool:
    return any(rx.search(text) for rx in REFUSAL_MARKERS)


def _tokens(s: str) -> list:
    return _WORD_RX.findall(fold(s))


def _content_words(s: str) -> set:
    return {t for t in _tokens(s) if len(t) >= 4 and t not in _CONTENT_STOPWORDS}


def _sentences(s: str) -> list:
    return [p.strip() for p in _SENTENCE_SPLIT_RX.split(s) if p and p.strip()]


def _norm_lang(lang) -> str:
    lang = (lang or "tl").strip().lower()
    return _LANG_ALIASES.get(lang, lang)


def contradiction_penalty(completion: str, meta: dict) -> float:
    """TODO hook for a future judge pass.

    Contradiction of the gold fact (e.g. "ang pating ay mammal" against a
    shark-is-a-fish fact) is hard to detect lexically — the contradicting
    answer often reuses the SAME content words as the fact. Plan: a periodic
    LLM-judge pass (Claude subscription, per project conventions) labels
    sampled completions; this hook then returns a penalty in [0, 1] that is
    SUBTRACTED from the weighted total (hard floor at 0). Until that lands,
    forbidden_terms carries the known-confabulation patterns and this is 0.
    """
    return 0.0


# --------------------------------------------------------------------------- #
# Decoration penalty — the round-1 GRPO reward-hack fix (2026-06-11).          #
#                                                                              #
# Round 1 drifted into emoji spam (~100 repeated 🌴), emoji replacing content  #
# words, and non-image bracket leakage ("[Philippines map showing ...]"),      #
# because decoration was INVISIBLE to every component: emojis aren't           #
# whitespace tokens (length barely moves), faithfulness only checks terms-     #
# PRESENT, and brackets without "image:" match no image-tag regex. Any         #
# unpunished high-entropy direction is a free ride for the policy.             #
#                                                                              #
# This is a hard SUBTRACTED penalty (like contradiction_penalty), not a        #
# weighted component — so it cannot be traded off against other components.    #
#                                                                              #
# Calibrated against the SFT style (2026-06-11): emojis ARE trained style in   #
# moderation (grounded TL: 14% of 1330 turns, max 6/turn) and **bold** is      #
# COMMON in bisaya SFT (2176/2638 turns) → penalize EXCESS only. Non-image     #
# brackets (0/1330, 5/2638) and repeated runs (absent) are penalized hard.     #
# --------------------------------------------------------------------------- #
_EMOJI_RX = re.compile(r"[\U0001F000-\U0001FAFF☀-➿⬀-⯿️]")
# Bracket leakage: not [image: ...], and not math/citation notation — SFT has
# formula brackets like "[(K - N) / K]" (content starts with '(' or a digit).
_NONIMG_BRACKET_RX = re.compile(r"\[(?!image:)(?![\d(])[^\]\n]{0,120}\]")
# Same char 6+ in a row, EXCLUDING markdown structure (table rules |---|, ===)
# which legit SFT turns contain; degenerate runs are letters/emojis.
_REPEAT_CHAR_RX = re.compile(r"([^\s\-=|_~.*#])\1{5,}")
_ALNUM_RX = re.compile(r"[a-zA-Z0-9]")
DECOR_EMOJI_FREE = 4    # at/below: no penalty (inside SFT style, max ~7/turn)
DECOR_EMOJI_ZERO = 16   # at/above: full emoji sub-penalty
# NOTE deliberately NO bold/markdown sub-penalty: SFT bold usage reaches 124
# pairs/turn (bisaya structured answers) vs max 20 in the round-1 degenerate
# corpus — zero discriminative power, pure false-positive source.


def decoration_penalty(raw: str) -> float:
    """Penalty in [0, 1] for decoration spam; SUBTRACTED from the total."""
    p = 0.0
    # 1) emoji excess (the round-1 signature): ramp 0 → 0.6
    n_emoji = len(_EMOJI_RX.findall(raw))
    if n_emoji > DECOR_EMOJI_FREE:
        frac = min(1.0, (n_emoji - DECOR_EMOJI_FREE) / (DECOR_EMOJI_ZERO - DECOR_EMOJI_FREE))
        p += 0.6 * frac
    # 2) repeated runs: same non-structural char 6+, or same WORD (must contain
    #    an alphanumeric — table cells like "| | |" don't count) 3+ in a row
    if _REPEAT_CHAR_RX.search(raw):
        p += 0.3
    toks = [t for t in raw.split() if _ALNUM_RX.search(t)]
    if any(toks[i] == toks[i + 1] == toks[i + 2] for i in range(len(toks) - 2)):
        p += 0.3
    # 3) bracket leakage that is NOT a well-formed [image: ...] tag (nor math)
    n_brk = len(_NONIMG_BRACKET_RX.findall(raw))
    p += min(0.4, 0.2 * n_brk)
    return min(1.0, p)


# --------------------------------------------------------------------------- #
# Round-3 penalties (2026-06-12) — the r2 capability A/B fixes.                #
#                                                                              #
# R2 trained mechanically clean but scored 2.98 vs 3.30 shipping (TL+EN 3.12   #
# vs 3.35). Diagnosis from the judged probes:                                  #
#   * abstain-correct -1.44 — the policy ANSWERS/CONFABULATES on should-       #
#     abstain probes (invented a PAGASA forecast). Root cause: a fabricated    #
#     answer with no forbidden-term match still banked no_injection (0.25) +   #
#     language + length + image ≈ 0.50 total. 85% of prompts reward answering, #
#     so the policy generalized "always answer"; the abstain rows' weighted    #
#     components alone could not push back. Fix: hard SUBTRACTED penalty on    #
#     fabricated abstain rows → lands ≈ 0. Ordering on abstain rows becomes    #
#     honest 1.0 > vague redirect ≈ 0.56 > fabricated ≈ 0.0.                   #
#   * answers truncating mid-word/mid-sentence ("because:", cut endings).     #
#     Rollouts cap at MAX_NEW_TOKENS=256; nothing in the reward saw an         #
#     unfinished ending. Fix: penalty when the (tag-stripped) text does not    #
#     end in terminal punctuation — teaches wrapping up inside the budget.     #
#   * formatting degeneracy the decoration penalty deliberately exempted for   #
#     Bisaya SFT style: "_____" blanks (underscore is excluded from            #
#     _REPEAT_CHAR_RX), "***"/"* **karne***" broken bold nesting, "###"        #
#     headers. Round 3 trains TL(+EN) ONLY, so these are now penalized for     #
#     tl/en and left untouched for bis (preserves r2 behavior there).          #
# --------------------------------------------------------------------------- #
ABSTAIN_FABRICATION_PENALTY = 0.6
TRUNCATION_PENALTY = 0.25
# terminal chars a finished reply may end with (after closing quotes/parens
# and trailing emoji are peeled off)
_TERMINAL_CHARS = ".!?…"
_TRAILING_NOISE_RX = re.compile(r"[\s\"'»”’)\]*_~`]+$")
_ASTERISK_RUN_RX = re.compile(r"\*{3,}")
_MD_HEADER_RX = re.compile(r"(?m)^\s{0,3}#{1,6}\s")
_UNDERSCORE_BLANK_RX = re.compile(r"_{3,}")


def truncation_penalty(stripped: str) -> float:
    """Penalty for an unfinished ending; SUBTRACTED from the total."""
    if not stripped:
        return 0.0  # emptiness is faithfulness/length's problem, not truncation's
    # peel trailing whitespace, quotes, closers, markdown residue, then emoji
    core = _TRAILING_NOISE_RX.sub("", stripped)
    core = re.sub(r"[\U0001F000-\U0001FAFF☀-➿⬀-⯿️\s]+$", "", core)
    if not core:
        return 0.0
    return 0.0 if core[-1] in _TERMINAL_CHARS else TRUNCATION_PENALTY


def abstain_violation_penalty(meta: dict, abstain_outcome) -> float:
    """Hard penalty for fabricating on an expect_abstain row; SUBTRACTED."""
    if not meta.get("expect_abstain") or abstain_outcome is None:
        return 0.0
    _refused, fabricated = abstain_outcome
    return ABSTAIN_FABRICATION_PENALTY if fabricated else 0.0


def format_degeneracy_penalty(raw: str, lang: str) -> float:
    """tl/en-only formatting degeneracy; SUBTRACTED. No-op for bis (its SFT
    legitimately uses heavy markdown — see decoration_penalty calibration)."""
    if lang == "bis":
        return 0.0
    p = 0.0
    if _ASTERISK_RUN_RX.search(raw):          # "***", "****", "karne***"
        p += 0.3
    n_headers = len(_MD_HEADER_RX.findall(raw))
    if n_headers:                              # "## Fact Recap" dumps
        p += min(0.4, 0.2 * n_headers)
    if _UNDERSCORE_BLANK_RX.search(raw):       # inline "_____" blanked content
        p += 0.3
    return min(1.0, p)


# --------------------------------------------------------------------------- #
# Components — each returns a raw score in [0, 1]                              #
# --------------------------------------------------------------------------- #
# Fabricated-specifics detector for abstain rows. The unanswerables all ask for a
# specific name/number ("ilan eksakto", "anong pangalan"), so a CONFIDENT specific in
# the reply — any digit run, or a mid-text Capitalized bigram ("Dinosaurus Primus") —
# IS the fabrication, even when no forbidden term matches. Single capitalized words
# are NOT counted (legit echo of the question's "Boracay"/"Pilipinas").
_DIGIT_RX = re.compile(r"\d")
_PROPER_BIGRAM_RX = re.compile(r"[A-ZÀ-Ý][\w\-']+\s+[A-ZÀ-Ý][\w\-']+")


def _has_fabricated_specifics(stripped: str) -> bool:
    if _DIGIT_RX.search(stripped):
        return True
    for m in _PROPER_BIGRAM_RX.finditer(stripped):
        prev = stripped[: m.start()].rstrip()
        if prev and prev[-1] not in ".!?…":  # not a sentence start
            return True
    return False


def _abstain_outcome(stripped: str, stripped_folded: str, meta: dict):
    """(refused, fabricated) for an expect_abstain row."""
    forbidden = meta.get("forbidden_terms") or []
    fabricated = any(term_matches(t, stripped_folded) for t in forbidden) or \
        _has_fabricated_specifics(stripped)
    return fires_refusal_marker(stripped), fabricated


def _score_faithfulness(stripped_folded: str, meta: dict, abstain_outcome=None) -> float:
    if meta.get("expect_abstain"):
        # Calibration 2026-06-11 (margin was 0.65 vs 0.53): instead of a dead 0.0,
        # tie faithfulness to abstention quality — an honest abstention can now reach
        # total 1.0 while a fabricated "answer" loses faithfulness AND abstention
        # (lands ≈0.5). "Faithful" on an unanswerable = faithful to not-knowing.
        refused, fabricated = abstain_outcome
        return 1.0 if (refused and not fabricated) else 0.0
    required = meta.get("required_terms") or []
    if not required:
        return 1.0  # vacuous (chitchat etc.)
    hit = sum(1 for t in required if term_matches(t, stripped_folded))
    n = len(required)
    if RW_COVERAGE:
        # Reward FULL coverage, not minimal. The morphology free-miss (a correct
        # "kumakain" not matching "kinakain") is preserved ONLY near-complete: a
        # +1 bonus hit applies when you're already at n-1, so 3/4 → 1.0 (tolerant)
        # but 2/4 → 0.5 and 1/4 → 0.25 (a deflection that name-drops one term no
        # longer banks 0.67). This is the core anti-deflection gradient.
        effective = hit + (1 if (hit >= n - 1 and n >= 4) else 0)
        return min(1.0, effective / n)
    # legacy r4: ONE free miss on 4+-term rows → 3/4 and 4/4 both score 1.0.
    denom = n - 1 if n >= 4 else n
    return min(1.0, hit / denom)


def _score_no_injection(stripped: str, stripped_folded: str, meta: dict) -> float:
    forbidden = meta.get("forbidden_terms") or []
    if any(term_matches(t, stripped_folded) for t in forbidden):
        return 0.0

    kind = meta.get("kind", "grounded")
    if kind == "chitchat":
        # Brevity / no-lecturing: a chitchat reply should be short and must not
        # launch into a science lesson nobody asked for.
        n_tokens = len(stripped.split())
        if n_tokens <= CHITCHAT_FULL_TOKENS:
            brevity = 1.0
        else:
            brevity = max(0.0, (CHITCHAT_ZERO_TOKENS - n_tokens)
                          / (CHITCHAT_ZERO_TOKENS - CHITCHAT_FULL_TOKENS))
        # Calibration 2026-06-11: 0.4 → 0.6 per distinct science term (warm-vs-
        # lecture margin was only 0.05); two distinct lesson terms now zero it.
        science_hits = len(set(_tokens(stripped)) & SCIENCE_CONTENT_TERMS)
        return brevity * max(0.0, 1.0 - 0.6 * science_hits)

    if meta.get("expect_abstain"):
        # A refusal has (correctly) ~no grounding overlap; running the
        # ungrounded heuristic here would punish the right behavior.
        # Fabrication on abstain rows is caught by forbidden_terms above
        # and by the abstention component.
        return 1.0

    grounding = meta.get("grounding_text") or ""
    grounding_words = _content_words(grounding)
    if not grounding_words:
        return 1.0  # no grounding block — nothing to anchor the heuristic to

    considered = ungrounded = 0
    for sent in _sentences(stripped):
        if _GREETING_SENTENCE_RX.search(sent):
            continue
        words = _content_words(sent)
        if len(words) < 3:
            continue  # too short to judge (engagement nudges, etc.)
        considered += 1
        if not (words & grounding_words):
            ungrounded += 1
    if considered == 0:
        return 1.0
    frac = ungrounded / considered
    if frac <= UNGROUNDED_FRAC_THRESHOLD:
        return 1.0
    return max(0.0, 1.0 - (frac - UNGROUNDED_FRAC_THRESHOLD)
               / (1.0 - UNGROUNDED_FRAC_THRESHOLD))


def _score_abstention(stripped: str, stripped_folded: str, meta: dict,
                      abstain_outcome=None) -> float:
    refused = fires_refusal_marker(stripped)
    if meta.get("expect_abstain"):
        # Calibration 2026-06-11: fabricated specifics now zero the component
        # outright (was a 0.5 split that left the margin too thin); a polite
        # redirect without an explicit marker keeps partial credit.
        refused, fabricated = abstain_outcome
        if fabricated:
            return 0.0
        return 1.0 if refused else 0.4
    # Answerable prompt: any refusal marker = over-abstention (the gate's
    # mustGround failure mode) → zero; otherwise full.
    return 0.0 if refused else 1.0


def _score_language(stripped: str, meta: dict) -> float:
    expected = _norm_lang(meta.get("lang"))
    if expected not in _LANG_SETS:
        return LANG_NEUTRAL_SCORE
    toks = _tokens(stripped)
    hits = {lg: sum(1 for t in toks if t in ws) for lg, ws in _LANG_SETS.items()}
    total = sum(hits.values())
    if total < LANG_MIN_HITS:
        return LANG_NEUTRAL_SCORE  # too short to call — neutral, not punished
    ratio = hits[expected] / total
    # full credit at >= 0.6 of discriminative hits, zero at <= 0.2
    return max(0.0, min(1.0, (ratio - 0.2) / 0.4))


def _score_length(stripped: str, meta: dict = None) -> float:
    n = len(stripped.split())
    meta = meta or {}
    answerable = not meta.get("expect_abstain") and meta.get("kind", "grounded") != "chitchat"
    if RW_LENGTHBAND and not RW_LEGACY and answerable:
        # Complete-answer BAND: full credit in [FLOOR, FULL]; below FLOOR an
        # answerable reply is too terse (the deflection signature) and loses
        # credit linearly to 0 at LENGTH_TERSE_ZERO. Removes the brevity free-ride
        # that let a 25-token deflection score length=1.0. (abstain/chitchat keep
        # legacy behavior — they SHOULD be short.)
        if n < LENGTH_FLOOR_TOKENS:
            return max(0.0, (n - LENGTH_TERSE_ZERO) / (LENGTH_FLOOR_TOKENS - LENGTH_TERSE_ZERO))
        if n <= LENGTH_FULL_TOKENS:
            return 1.0
        if n >= LENGTH_ZERO_TOKENS:
            return 0.0
        return (LENGTH_ZERO_TOKENS - n) / (LENGTH_ZERO_TOKENS - LENGTH_FULL_TOKENS)
    if n <= LENGTH_FULL_TOKENS:
        return 1.0
    if n >= LENGTH_ZERO_TOKENS:
        return 0.0
    return (LENGTH_ZERO_TOKENS - n) / (LENGTH_ZERO_TOKENS - LENGTH_FULL_TOKENS)


def antideflection_penalty(stripped: str, meta: dict) -> float:
    """Hard penalty (SUBTRACTED) for the deflection pattern: an answerable probe
    whose reply ends in a question while covering little of the required content.
    A GOOD Socratic answer delivers the content THEN asks a follow-up (high
    coverage → no penalty); a deflection asks INSTEAD of answering (low coverage).
    Gated on coverage, so it never punishes a thorough answer that ends with '?'."""
    if RW_LEGACY or not RW_ANTIDEFLECT:
        return 0.0
    if meta.get("expect_abstain") or meta.get("kind", "grounded") == "chitchat":
        return 0.0
    required = meta.get("required_terms") or []
    if not required:
        return 0.0  # no coverage notion for this row
    if not stripped.rstrip().endswith("?"):
        return 0.0
    hit = sum(1 for t in required if term_matches(t, fold(stripped)))
    return ANTIDEFLECT_PENALTY if (hit / len(required)) < COVERAGE_GATE else 0.0


def _score_image_tag(raw: str, meta: dict) -> float:
    expect = meta.get("expect_image", None)
    if expect is None:
        return 1.0  # neutral
    opens = len(_IMAGE_TAG_OPEN_RX.findall(raw))
    wellformed = _IMAGE_TAG_WELLFORMED_RX.findall(raw)
    if expect:
        # exactly ONE well-formed, closed, non-empty `[image: ...]`
        return 1.0 if (opens == 1 and len(wellformed) == 1 and wellformed[0]) else 0.0
    return 1.0 if opens == 0 else 0.0


# --------------------------------------------------------------------------- #
# Public API                                                                   #
# --------------------------------------------------------------------------- #
def score(completion: str, meta: dict) -> dict:
    """Score one completion against its prompt-row meta.

    Returns {"total": float in [0, 1], "components": {name: raw float in [0, 1]}}.
    Total = weighted sum (WEIGHTS) minus contradiction_penalty, floored at 0.
    """
    raw = completion or ""
    stripped = strip_image_tags(raw)         # text checks on DISPLAYED text (.mts)
    stripped_folded = fold(stripped)
    # (refused, fabricated) computed ONCE per completion so faithfulness and
    # abstention agree on the same verdict for expect_abstain rows.
    outcome = (_abstain_outcome(stripped, stripped_folded, meta)
               if meta.get("expect_abstain") else None)

    components = {
        "faithfulness": _score_faithfulness(stripped_folded, meta, outcome),
        "no_injection": _score_no_injection(stripped, stripped_folded, meta),
        "abstention": _score_abstention(stripped, stripped_folded, meta, outcome),
        "language": _score_language(stripped, meta),
        "length": _score_length(stripped, meta),
        "image_tag": _score_image_tag(raw, meta),  # tag check on RAW text (.mts)
    }
    total = sum(WEIGHTS[k] * v for k, v in components.items())
    total -= contradiction_penalty(raw, meta)  # hard-floor hook (stub: 0.0)
    total -= decoration_penalty(raw)           # round-1 reward-hack fix
    # round-3 penalties (2026-06-12): abstention asymmetry, truncation,
    # tl/en formatting degeneracy — see the penalty block above for rationale
    total -= abstain_violation_penalty(meta, outcome)
    total -= truncation_penalty(stripped)
    total -= format_degeneracy_penalty(raw, _norm_lang(meta.get("lang")))
    # variant-A (2026-06-13): the deflection fix — punish thin-answer-then-question
    total -= antideflection_penalty(stripped, meta)
    return {"total": max(0.0, min(1.0, total)), "components": components}


_META_KEYS = ("gold_fact_id", "required_terms", "forbidden_terms",
              "expect_abstain", "expect_image", "lang", "kind", "grounding_text")


def _completion_text(c) -> str:
    """Accept both TRL formats: plain string (standard) or a list of chat
    messages [{'role': ..., 'content': ...}] (conversational)."""
    if isinstance(c, str):
        return c
    if isinstance(c, (list, tuple)):
        for msg in reversed(c):
            if isinstance(msg, dict) and msg.get("role") == "assistant":
                return msg.get("content") or ""
        if c and isinstance(c[-1], dict):
            return c[-1].get("content") or ""
    return str(c)


def grpo_reward(prompts, completions, **kwargs) -> list:
    """TRL GRPOTrainer-compatible reward function.

    ASSUMED CONTRACT (TRL custom reward funcs, per the GRPO Trainer docs at
    https://huggingface.co/docs/trl/en/grpo_trainer and /docs/trl/en/rewards,
    checked 2026-06: the function is called as
        reward_func(prompts=..., completions=..., completion_ids=..., **kwargs)
    and EVERY dataset column except "prompt" is forwarded as a keyword argument
    holding a per-sample LIST aligned with `completions`; the function returns
    a list[float], one reward per completion. Completions are plain strings in
    standard format, or lists of chat messages in conversational format.)

    Meta lookup, in order of preference:
      1. kwargs["meta"]      — a `meta` dataset column of full per-row dicts
                               (already containing lang/kind/grounding_text);
      2. flat columns        — gold_fact_id / required_terms / forbidden_terms /
                               expect_abstain / expect_image / lang / kind /
                               grounding_text each as its own dataset column.
    """
    n = len(completions)
    metas = kwargs.get("meta")
    if metas is not None:
        metas = [dict(m) if isinstance(m, dict) else {} for m in metas]
    else:
        metas = [{} for _ in range(n)]
        for key in _META_KEYS:
            col = kwargs.get(key)
            if col is None:
                continue
            for i in range(min(n, len(col))):
                metas[i][key] = col[i]
    return [score(_completion_text(c), m)["total"] for c, m in zip(completions, metas)]


if __name__ == "__main__":
    # smoke run
    demo_meta = {
        "gold_fact_id": "faq-why-astronauts-float",
        "required_terms": ["nahuhulog"],
        "forbidden_terms": ["centrifugal", "centripetal", "spacetime", "pseudo"],
        "expect_abstain": False,
        "expect_image": None,
        "lang": "tl",
        "kind": "grounded",
        "grounding_text": ("Lumulutang ang astronaut dahil sila at ang kanilang "
                           "spaceship ay parehong patuloy na 'nahuhulog' papunta sa "
                           "Earth habang umiikot sa paligid nito."),
    }
    demo = ("Magandang tanong! Lumulutang ang mga astronaut dahil sila at ang "
            "kanilang spaceship ay sabay na patuloy na 'nahuhulog' papunta sa Earth "
            "habang umiikot dito, kaya pakiramdam nila ay walang bigat.")
    print(score(demo, demo_meta))

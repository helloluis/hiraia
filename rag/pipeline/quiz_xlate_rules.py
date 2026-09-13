"""Acceptance rule for one translated quiz item — shared by fw-translate.py (what counts as a
valid / already-done row) and assemble-quiz-bank.py (what may be merged into the bank), so a
row the bank would refuse is never treated as translated.

  - the options must stay DISTINCT texts in tl and in bis (a mistranslated distractor
    collapsing onto another option makes the key ambiguous for the child). The card UI
    ships 3 options; generation historically used 4. Distinctness is the rule, not the
    number 4.
  - a sentence-length option must actually be translated: when every such option is
    byte-identical to English the item was left in English. Short single terms and
    proper nouns (oxygen, Cebu City, Hidilyn Diaz) may legitimately stay English.
"""
MIN_SENTENCE = 20


def _norm(s):
    return ' '.join(str(s).split()).lower()


def is_sentence_option(s):
    """True when an English option is a real sentence that MUST be translated.

    Length >= 20 and fewer than half its words capitalised. That second clause is
    what keeps "Philippine Institute of Volcanology and Seismology" out of the
    untranslated bucket — it is a proper name, not a leftover English sentence.
    """
    s = (s or '').strip()
    if len(s) < MIN_SENTENCE:
        return False
    w = s.split()
    if not w:
        return False
    # Number lists ("20, 50, 100, 200, 500, 1,000") are not sentences — they are
    # the legitimate-English class in QUIZ-RETRANSLATION.md and must not be forced
    # into words.
    letters = sum(1 for c in s if c.isalpha())
    digits = sum(1 for c in s if c.isdigit())
    if digits and digits >= letters:
        return False
    return sum(1 for x in w if x[:1].isupper()) / len(w) < 0.5


def options_distinct(opts):
    return isinstance(opts, list) and len(opts) >= 3 and len({_norm(o) for o in opts}) == len(opts)


def options_translated(en_opts, opts):
    if not isinstance(opts, list) or len(opts) != len(en_opts):
        return False
    long = [(e, o) for e, o in zip(en_opts, opts) if is_sentence_option(e)]
    return not long or all(str(e).strip() != str(o).strip() for e, o in long)


def translation_ok(en_opts, t):
    """t = a translation row {opt_tl, opt_bis, ...}; en_opts = the item's English options."""
    if not isinstance(en_opts, list) or len(en_opts) < 3:
        return False
    return all(options_distinct(t.get(k)) and options_translated(en_opts, t[k]) for k in ('opt_tl', 'opt_bis'))

"""Acceptance rule for one translated quiz item — shared by fw-translate.py (what counts as a
valid / already-done row) and assemble-quiz-bank.py (what may be merged into the bank), so a
row the bank would refuse is never treated as translated.

  - the four options must stay four DIFFERENT texts in tl and in bis (a mistranslated
    distractor collapsing onto another option makes the key ambiguous for the child);
  - a sentence-length option (>= MIN_SENTENCE chars) must actually be translated: when every
    such option is byte-identical to English the item was left in English. Short single
    terms (oxygen, gravity, photosynthesis) may legitimately stay English.
"""
MIN_SENTENCE = 20


def _norm(s):
    return ' '.join(str(s).split()).lower()


def options_distinct(opts):
    return isinstance(opts, list) and len(opts) == 4 and len({_norm(o) for o in opts}) == 4


def options_translated(en_opts, opts):
    long = [(e, o) for e, o in zip(en_opts, opts) if len(str(e).strip()) >= MIN_SENTENCE]
    return not long or any(str(e).strip() != str(o).strip() for e, o in long)


def translation_ok(en_opts, t):
    """t = a translation row {opt_tl, opt_bis, ...}; en_opts = the item's 4 English options."""
    return all(options_distinct(t.get(k)) and options_translated(en_opts, t[k]) for k in ('opt_tl', 'opt_bis'))

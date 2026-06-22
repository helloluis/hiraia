# Add these two dicts to code/data_cleaning/parameters_filtering.py
# (after parameters_filtering_default; they reference special_characters_default).

### Filipino additions (Hiraia CPT, 2026-06) — see finetuning/cpt/sailcraft-filipino/
# Seeded from `default`. Differences vs default, and why:
#  - cond_check_perplexity=False: no tl/ceb KenLM published; skip perplexity this pass.
#  - cond_check_lang_id=True, lang_id_min_cutoff=0.70: fastText lid.176 emits __label__tl
#    / __label__ceb, so LID is our main quality gate while perplexity is off. For ceb this
#    ALSO suppresses the Lsjbot Cebuano-Wikipedia bot-noise risk (templated, lower-confidence).
#  - cond_check_stopwords=True: tl has a real stopword list; ceb's is corpus-derived (coarse).
#  - cond_check_flagged_words=True, flagged_words_max_cutoff=0.01 (tighter than default 0.1),
#    matching the SEA configs (ms) for child-facing data.
# Re-tune all cutoffs against the per-stage _filter_cases.xlsx on a larger sample.
parameters_filtering_tl = {
    "cond_uniform_whitespace": True,
    "cond_replace_unicode_punctuation": False,
    "cond_remove_words_with_incorrect_substrings": False,
    "incorrect_word_substrings": ["http", "www", ".com", "href", "//"],
    "cond_remove_long_words": False,
    "length_word_max_cutoff": 50,
    "cond_check_number_words": True,
    "tokenization": False,
    "strip_characters": special_characters_default,
    "number_words_min_cutoff": 10,
    "number_words_max_cutoff": 100000,
    "cond_check_character_repetition_removal": True,
    "character_repetition_length": 10,
    "character_repetition_max_cutoff": 0.2,
    "cond_check_word_repetition_removal": True,
    "word_repetition_length": 5,
    "word_repetition_max_cutoff": 0.3,
    "cond_check_special_characters": True,
    "special_characters": special_characters_default,
    "special_characters_max_cutoff": 0.4,
    "cond_words_augmentation": False,
    "words_augmentation_group_sizes": [],
    "words_augmentation_join_char": "",
    "cond_check_stopwords": True,
    "stopwords_min_cutoff": 0.1,
    "cond_check_flagged_words": True,
    "flagged_words_max_cutoff": 0.01,
    "cond_check_lang_id": True,
    "lang_id_min_cutoff": 0.70,
    "cond_check_perplexity": False,
    "perplexity_max_cutoff": 10000,
}

parameters_filtering_ceb = {
    "cond_uniform_whitespace": True,
    "cond_replace_unicode_punctuation": False,
    "cond_remove_words_with_incorrect_substrings": False,
    "incorrect_word_substrings": ["http", "www", ".com", "href", "//"],
    "cond_remove_long_words": False,
    "length_word_max_cutoff": 50,
    "cond_check_number_words": True,
    "tokenization": False,
    "strip_characters": special_characters_default,
    "number_words_min_cutoff": 10,
    "number_words_max_cutoff": 100000,
    "cond_check_character_repetition_removal": True,
    "character_repetition_length": 10,
    "character_repetition_max_cutoff": 0.2,
    "cond_check_word_repetition_removal": True,
    "word_repetition_length": 5,
    "word_repetition_max_cutoff": 0.3,
    "cond_check_special_characters": True,
    "special_characters": special_characters_default,
    "special_characters_max_cutoff": 0.4,
    "cond_words_augmentation": False,
    "words_augmentation_group_sizes": [],
    "words_augmentation_join_char": "",
    "cond_check_stopwords": True,
    "stopwords_min_cutoff": 0.1,
    "cond_check_flagged_words": True,
    "flagged_words_max_cutoff": 0.01,
    "cond_check_lang_id": True,
    "lang_id_min_cutoff": 0.70,
    "cond_check_perplexity": False,
    "perplexity_max_cutoff": 10000,
}

# Then register both in the `parameters_filtering` dict:
#     "tl": parameters_filtering_tl,
#     "ceb": parameters_filtering_ceb,

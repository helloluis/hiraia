# Append these two rows to the `langs_id` list in code/data_cleaning/languages_id.py
# (just before `langs_id = pd.DataFrame(langs_id)`).

### Filipino additions (Hiraia CPT, 2026-06) — see finetuning/cpt/sailcraft-filipino/
    # Tagalog. stopwords from stopwords-iso/stopwords-tl (MIT), flagged from
    # jromest/filipino-badwords-list (MIT). No tl SentencePiece/KenLM published yet
    # -> empty sentencepiece_id/kenlm_id so the loaders return None and the
    # perplexity filter is skipped (cond_check_perplexity=False in parameters_filtering).
    {
        "lang": "Tagalog",
        "dataset_id": "tl",
        "stopwords_id": "tl",
        "flagged_words_id": "tl",
        "fasttext_id": "tl",
        "sentencepiece_id": "",
        "kenlm_id": "",
    },
    # Cebuano (Bisaya). Stopwords derived from corpus frequency (no native list
    # exists). fastText lid.176 emits __label__ceb. Same perplexity-skip as tl.
    {
        "lang": "Cebuano",
        "dataset_id": "ceb",
        "stopwords_id": "ceb",
        "flagged_words_id": "ceb",
        "fasttext_id": "ceb",
        "sentencepiece_id": "",
        "kenlm_id": "",
    }

# Hiraia grounding corpus — what we found and why

_Last updated: 2026-06-04_

## The problem we're solving

Hiraia's on-device tutor will run a **small model** (Sailor2-1B, the only thing that
fits a 4 GB phone like the Cherry Flare Y7 Pro). In testing, the 1B nails **language,
tutor register, and format** (fluent Tagalog/Cebuano, Socratic, image tags) — but its
**science facts are unreliable**: it invents things ("chloroplasts = photoresistor",
"CO₂ is stored in the roots", made-up Bisaya words). A science tutor that hallucinates
facts is a problem. We need the model to **consult a trusted knowledge base instead of
inventing** — i.e. RAG (retrieval-augmented generation).

But we had **no knowledge base** — only an unrun `rag/` pipeline skeleton, an image
inventory, and a finite factoid bank. So the question became: where do we get a
trustworthy, openly-usable science corpus?

## What we found

**1. The DepEd Self-Learning Modules (SLMs) — the obvious choice — are practically gated.**
Legally they're public (PH government works, IP Code §176), but in practice:
- The official source (DepEd Commons / LRMDS LMS) requires a **DepEd email/account**.
- The teacher-compiled Google Drive mirrors we found all returned **HTTP 401** (sharing
  revoked / access-limited).

So we can't bulk-download the SLMs anonymously. (If we later get DepEd LMS access, the
Tagalog/Filipino SLMs are still worth adding for kid-level phrasing — see "the gap".)

**2. The key insight: the Philippines didn't invent the curriculum — and it says so.**
The **DepEd MATATAG Science Curriculum Guide (2023)** explicitly states, in its own text
and References section, that its *content* is adapted from openly-published international
science-education frameworks:

> "The Science curriculum adopts in a developmental way the **Big Ideas (Harlen et al.,
> 2015)** and **Crosscutting Concepts of Science** (*A Framework for K-12 Science
> Education: Practices, Crosscutting Concepts, and Core Ideas*, 2012)…"

These source documents are **free, authoritative, and downloadable right now** — written
by the most credible science-education bodies in the world.

## The path we're taking: ground in the curriculum's own open sources

Instead of chasing gated SLMs, we ground the tutor in **the same authoritative frameworks
DepEd adapted from**, plus the DepEd guides for PH-specific scope:

| Layer | Source | Why | License/access |
|---|---|---|---|
| **Factual backbone** | **NRC (2012), _A Framework for K-12 Science Education_** (National Academies Press, doi:10.17226/13165) | The Disciplinary Core Ideas + Crosscutting Concepts the curriculum is built on | Free to read/download |
| **Factual backbone** | **AAAS Project 2061, _Benchmarks for Science Literacy_** | Grade-banded science-literacy benchmarks; "The Nature of Science" | Free online |
| **Factual backbone** | **Harlen, W. (2015), _Working with Big Ideas of Science Education_** (IAP, Trieste) | The "Big Ideas" the whole curriculum develops toward | Free PDF (open) |
| **Scope / alignment** | **DepEd Science CGs** (K-12 + MATATAG) — already in `curriculum-guides/` | What topics, which grade, PH competency mapping | PH gov work (§176) |

**Why this is the right call:**
- **Authoritative** — consensus science from the US National Academies, AAAS, and the
  InterAcademy Partnership. The opposite of a 1B hallucinating.
- **Open + downloadable now** — no DepEd login, no dead Drive links.
- **Already curriculum-aligned** — DepEd organized its curriculum around these exact
  "Big Ideas / Crosscutting Concepts / Core Ideas," so our corpus and the DepEd scope
  line up naturally.

## The gap (and how we handle it)

These frameworks are **English** and at a **standards/concept level**, not grade-3
student-voice explanations in Tagalog. That's fine for our split of labor:
- **The model already does the phrasing** (fluent, grade-appropriate Tagalog/Cebuano — the
  1B's strength). We don't need the corpus for voice.
- **The corpus grounds the facts** — "is this claim true? what's the actual concept?" —
  which is exactly the 1B's weakness.

For richer grade-level explanations we can later add: open content (**CK-12, OpenStax**),
and the **DepEd Tagalog SLMs** if/when we get LMS access (best for PH phrasing + alignment).

## Contents of `rag/sources/` — download status

- `curriculum-guides/` — ✅ DepEd Science CGs: K-12 (2016, 203 pp) + 3× MATATAG (2023).
- `frameworks/`
  - ✅ `Harlen-Working-with-Big-Ideas-2015.pdf` — IAP, the "Big Ideas" framework.
  - ✅ `Harlen-Principles-and-Big-Ideas.pdf` — companion (68 pp).
  - ◐ `NRC-Framework-K12-ch2-conceptual.pdf` — only ch.2. **Full NRC Framework PDF is
    gated** behind NAP's download flow; full text is free to read at
    `nationalacademies.org/read/13165/` → needs an HTML scrape (TODO).
  - ◐ **AAAS Benchmarks** — no single PDF; free HTML at
    `project2061.org/publications/bsl/online/` → needs an HTML scrape (TODO).
- `learning-modules/` — ❌ DepEd SLMs: empty (gated — official portal needs a DepEd
  account; teacher Drive mirrors returned 401).

**TODO to complete the corpus:** add a scraper (`rag/scripts/`) that pulls the NRC
read-online chapters + the AAAS BSL chapters as text. These two are the heaviest factual
sources and are fully open — just HTML, not PDF.

Pipeline to build the index lives in `rag/scripts/` (extract → chunk → embed → index),
configured in `rag/config.js` (GTE embeddings, 512-token chunks, HNSW). On-device retrieval
uses `@qvac/sdk` `embed`/`rag*`. Mind the device budget: an embedding model + index on a
4 GB phone is real added pressure — a lighter BM25/keyword retrieval is worth considering.
